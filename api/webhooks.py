"""
EFFANT — Webhook delivery for Pro tier customers.

Events
──────
  new_anomaly_critical   Anomaly with severity='critical' detected
  whale_movement         Large fund movement (≥100k SOL)
  new_wallet_label       New wallet label assigned by pipeline

Endpoints (Pro only)
─────────
  GET    /portal/webhooks       List webhooks for current user
  POST   /portal/webhooks       Register a new webhook
  DELETE /portal/webhooks/{id}  Delete a webhook

Delivery
────────
  Signed with HMAC-SHA256.  Header: X-Effant-Signature: sha256=<hex>
  Retries 3× on failure with 2s / 4s / 8s exponential backoff.

Integration
───────────
  Call dispatch_event(event_type, payload_dict) from your anomaly pipeline:

    from api.webhooks import dispatch_event
    dispatch_event("new_anomaly_critical", {
        "wallet": address, "anomaly_type": atype, "severity": "critical", ...
    })
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt as _jwt, JWTError as _JWTError
from fastapi.security import HTTPBearer as _Bearer, HTTPAuthorizationCredentials as _Creds
from pydantic import BaseModel

log = logging.getLogger("effant.webhooks")

router = APIRouter(prefix="/portal", tags=["webhooks"])

VALID_EVENT_TYPES = {"new_anomaly_critical", "whale_movement", "new_wallet_label"}
MAX_WEBHOOKS_PER_USER = 10

# ── DB pool (injected from main.py) ───────────────────────────────────────────

_pool = None

def set_pool(pool):
    global _pool
    _pool = pool


def _query(sql: str, params: tuple = ()) -> list[dict]:
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        _pool.putconn(conn)


def _query_one(sql: str, params: tuple = ()) -> dict | None:
    rows = _query(sql, params)
    return rows[0] if rows else None


def _execute(sql: str, params: tuple = ()) -> None:
    conn = _pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        _pool.putconn(conn)


def _execute_returning(sql: str, params: tuple = ()) -> dict | None:
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        _pool.putconn(conn)


# ── JWT auth (minimal duplicate to keep module self-contained) ────────────────

_bearer  = _Bearer(auto_error=False)
_JWT_ALG = "HS256"


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "")


async def _current_user(creds: _Creds | None = Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = _jwt.decode(creds.credentials, _jwt_secret(), algorithms=[_JWT_ALG])
    except _JWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = _query_one("SELECT id, email FROM users WHERE id = %s", (int(payload["sub"]),))
    if not user:
        raise HTTPException(401, "User not found")
    return user


def _require_pro(user: dict) -> None:
    key = _query_one(
        "SELECT tier FROM api_keys WHERE user_id = %s AND active = TRUE ORDER BY created_at DESC LIMIT 1",
        (user["id"],),
    )
    if not key or key["tier"] != "pro":
        raise HTTPException(403, "Webhooks are a Pro tier feature. Upgrade to access.")


# ── Serialization ─────────────────────────────────────────────────────────────

def _fmt(row: dict, include_secret: bool = False) -> dict:
    out = {
        "id":                row["id"],
        "url":               row["url"],
        "event_types":       list(row["event_types"]) if row["event_types"] else [],
        "active":            row["active"],
        "created_at":        row["created_at"].isoformat() if row.get("created_at") else None,
        "last_triggered_at": row["last_triggered_at"].isoformat() if row.get("last_triggered_at") else None,
        "last_status":       row.get("last_status"),
    }
    if include_secret:
        out["secret_key"] = row.get("secret_key", "")
    return out


# ── Routes ────────────────────────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    url: str
    event_types: list[str]


@router.get("/webhooks")
async def list_webhooks(user: dict = Depends(_current_user)):
    _require_pro(user)
    rows = _query(
        """SELECT id, url, event_types, active, created_at, last_triggered_at, last_status
           FROM webhooks WHERE user_id = %s AND active = TRUE ORDER BY created_at DESC""",
        (user["id"],),
    )
    return {"webhooks": [_fmt(r) for r in rows]}


@router.post("/webhooks", status_code=201)
async def create_webhook(body: WebhookCreate, user: dict = Depends(_current_user)):
    _require_pro(user)

    invalid = [e for e in body.event_types if e not in VALID_EVENT_TYPES]
    if invalid:
        raise HTTPException(400, f"Invalid event types: {invalid}. Valid: {sorted(VALID_EVENT_TYPES)}")
    if not body.event_types:
        raise HTTPException(400, "At least one event type required")
    if not body.url.startswith(("https://", "http://")):
        raise HTTPException(400, "URL must start with https:// or http://")

    count = _query_one(
        "SELECT COUNT(*) AS n FROM webhooks WHERE user_id = %s AND active = TRUE",
        (user["id"],),
    )
    if count and count["n"] >= MAX_WEBHOOKS_PER_USER:
        raise HTTPException(400, f"Maximum {MAX_WEBHOOKS_PER_USER} webhooks per account")

    secret = secrets.token_hex(32)
    row = _execute_returning(
        """INSERT INTO webhooks (user_id, url, event_types, secret_key)
           VALUES (%s, %s, %s, %s)
           RETURNING id, url, event_types, active, created_at, last_triggered_at, last_status, secret_key""",
        (user["id"], body.url, body.event_types, secret),
    )
    return {"webhook": _fmt(row, include_secret=True)}


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: int, user: dict = Depends(_current_user)):
    _require_pro(user)
    wh = _query_one(
        "SELECT id FROM webhooks WHERE id = %s AND user_id = %s AND active = TRUE",
        (webhook_id, user["id"]),
    )
    if not wh:
        raise HTTPException(404, "Webhook not found")
    _execute("UPDATE webhooks SET active = FALSE WHERE id = %s", (webhook_id,))


# ── Delivery engine ───────────────────────────────────────────────────────────

def _sign(payload_bytes: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(
        secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()


def _deliver_one(url: str, payload_bytes: bytes, signature: str, webhook_id: int) -> int:
    """
    POST signed payload to url.  Returns HTTP status (0 = connection error).
    Retries up to 3 times with 2s / 4s / 8s backoff.
    """
    headers = {
        "Content-Type": "application/json",
        "X-Effant-Signature": signature,
        "X-Effant-Timestamp": str(int(time.time())),
        "User-Agent": "Effant-Webhooks/1.0",
    }
    last_status = 0
    for attempt in range(3):
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, content=payload_bytes, headers=headers)
                last_status = resp.status_code
                if resp.is_success:
                    log.info(f"Webhook {webhook_id} → {url} : {resp.status_code}")
                    return last_status
                log.warning(f"Webhook {webhook_id} attempt {attempt + 1} → {resp.status_code}")
        except Exception as exc:
            log.warning(f"Webhook {webhook_id} attempt {attempt + 1} error: {exc}")
            last_status = 0

        if attempt < 2:
            time.sleep(2 ** (attempt + 1))  # 2s then 4s

    log.error(f"Webhook {webhook_id} failed after 3 attempts (last status {last_status})")
    return last_status


def dispatch_event(event_type: str, payload: dict[str, Any]) -> None:
    """
    Fire webhooks for event_type.  Call this from your anomaly pipeline:

        from api.webhooks import dispatch_event
        dispatch_event("new_anomaly_critical", {"wallet": "...", "severity": "critical"})

    Safe to call even if _pool is not set (no-ops gracefully).
    """
    if _pool is None:
        log.debug("dispatch_event: pool not set, skipping")
        return

    rows = _query(
        "SELECT id, url, secret_key FROM webhooks WHERE active = TRUE AND %s = ANY(event_types)",
        (event_type,),
    )
    if not rows:
        return

    envelope = {
        "event":     event_type,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "data":      payload,
    }
    payload_bytes = json.dumps(envelope, default=str).encode()

    for wh in rows:
        sig    = _sign(payload_bytes, wh["secret_key"])
        status = _deliver_one(wh["url"], payload_bytes, sig, wh["id"])
        try:
            _execute(
                "UPDATE webhooks SET last_triggered_at = NOW(), last_status = %s WHERE id = %s",
                (status if status else None, wh["id"]),
            )
        except Exception as exc:
            log.error(f"Failed to update webhook status: {exc}")
