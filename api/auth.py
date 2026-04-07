"""
EFFANT — API key authentication + rate limiting middleware.

Flow per request
────────────────
  1. Skip auth for /health and /docs/* (public routes)
  2. Extract X-API-Key header → reject 401 if missing
  3. SHA-256 hash the raw key → look up in api_keys table
  4. Reject 401 if not found or inactive
  5. Reset calls_today if reset_at has passed (new calendar day)
  6. Reject 429 if calls_today >= calls_limit
  7. Increment calls_today + update last_used_at atomically
  8. Attach key record to request.state for downstream logging

Tier limits (calls/day)
────────────────────────
  starter :   10,000
  pro     :  500,000
"""

import hashlib
import logging
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("effant.auth")

# Routes that bypass authentication entirely
PUBLIC_PATHS = {"/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico"}

TIER_LIMITS: dict[str, int] = {
    "starter":    10_000,
    "pro":       500_000,
}


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code":    code,
                "message": message,
            }
        },
    )


class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    Starlette middleware that authenticates every non-public request
    and enforces per-day rate limits.
    """

    def __init__(self, app, pool: psycopg2.pool.ThreadedConnectionPool):
        super().__init__(app)
        self.pool = pool

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Pass through public routes and any /docs sub-paths
        if path in PUBLIC_PATHS or path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/portal") or path.startswith("/billing"):
            return await call_next(request)

        # ── 1. Extract header ─────────────────────────────────────────────
        raw_key = request.headers.get("X-API-Key", "").strip()
        if not raw_key:
            return _error(
                401,
                "MISSING_API_KEY",
                "Provide your API key in the X-API-Key header.",
            )

        # ── 2. Hash + look up ─────────────────────────────────────────────
        key_hash = hash_key(raw_key)
        conn = self.pool.getconn()
        try:
            record = self._fetch_and_update(conn, key_hash)
        except Exception as exc:
            self.pool.putconn(conn)
            log.error(f"Auth DB error: {exc}")
            return _error(500, "AUTH_ERROR", "Authentication service unavailable.")

        if record is None:
            self.pool.putconn(conn)
            return _error(
                401,
                "INVALID_API_KEY",
                "The provided API key is invalid or has been revoked.",
            )

        if not record["active"]:
            self.pool.putconn(conn)
            return _error(
                401,
                "KEY_INACTIVE",
                "This API key has been deactivated. Contact support.",
            )

        if record["calls_today"] > record["calls_limit"]:
            self.pool.putconn(conn)
            return _error(
                429,
                "RATE_LIMIT_EXCEEDED",
                f"Daily limit of {record['calls_limit']:,} calls reached "
                f"(tier: {record['tier']}). Resets at midnight UTC.",
            )

        self.pool.putconn(conn)

        # ── 3. Attach to request state for logging / response headers ─────
        request.state.api_key = record

        # ── 4. Call the actual endpoint ───────────────────────────────────
        t0 = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        # ── 5. Log the call (fire-and-forget, don't fail the request) ─────
        try:
            log_conn = self.pool.getconn()
            with log_conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO api_call_log (key_hash, endpoint, method, status_code, response_ms)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (record["key_hash"], request.url.path, request.method,
                     response.status_code, elapsed_ms),
                )
            log_conn.commit()
            self.pool.putconn(log_conn)
        except Exception as exc:
            log.debug(f"Call log write failed: {exc}")
            try:
                self.pool.putconn(log_conn)
            except Exception:
                pass

        # Add rate-limit headers so clients can self-throttle
        remaining = max(0, record["calls_limit"] - record["calls_today"])
        response.headers["X-RateLimit-Limit"]     = str(record["calls_limit"])
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Tier"]      = record["tier"]

        return response

    def _fetch_and_update(
        self, conn, key_hash: str
    ) -> dict | None:
        """
        Single atomic transaction:
          - Fetch the key row (FOR UPDATE to prevent races)
          - Reset calls_today if the daily window has rolled over
          - Increment calls_today
          - Update last_used_at
        Returns the post-update record, or None if not found.
        """
        now = datetime.now(tz=timezone.utc)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT key_hash, customer_email, tier,
                       calls_today, calls_limit, active,
                       reset_at
                FROM api_keys
                WHERE key_hash = %s
                FOR UPDATE
            """, (key_hash,))
            row = cur.fetchone()

            if row is None:
                conn.rollback()
                return None

            record = dict(row)

            # Roll over the daily counter if we're past reset_at
            reset_at = record["reset_at"]
            if reset_at.tzinfo is None:
                reset_at = reset_at.replace(tzinfo=timezone.utc)

            if now >= reset_at:
                # Advance reset_at by whole days until it's in the future
                from datetime import timedelta
                while reset_at <= now:
                    reset_at = reset_at + timedelta(days=1)
                cur.execute("""
                    UPDATE api_keys
                    SET calls_today  = 1,
                        reset_at     = %s,
                        last_used_at = %s
                    WHERE key_hash = %s
                """, (reset_at, now, key_hash))
                record["calls_today"] = 1
            else:
                cur.execute("""
                    UPDATE api_keys
                    SET calls_today  = calls_today + 1,
                        last_used_at = %s
                    WHERE key_hash = %s
                """, (now, key_hash))
                record["calls_today"] += 1

            conn.commit()
            return record
