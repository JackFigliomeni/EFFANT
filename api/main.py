"""
EFFANT — Solana intelligence API
FastAPI server with Redis caching, API key auth, and rate limiting.

Run:
    cd ~/effant
    .venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

Cache TTLs
──────────
  /v1/wallet/{address}              60 s
  /v1/wallet/{address}/transactions 60 s
  /v1/anomalies                     30 s
  /v1/clusters                     300 s  (5 min)
  /v1/flows                         30 s
  /v1/health                        10 s
"""

import json
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.pool
import psycopg2.extras
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_cache.decorator import cache
from pydantic import BaseModel
from redis import asyncio as aioredis

from api.auth import APIKeyMiddleware
from api.billing import router as billing_router, set_pool as billing_set_pool
from api.webhooks import router as webhooks_router, set_pool as webhooks_set_pool
from api.admin import router as admin_router, set_pool as admin_set_pool

load_dotenv()

# ── Sentry error tracking ─────────────────────────────────────────────────────
import sentry_sdk
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=0.1,
        environment=os.getenv("RAILWAY_ENVIRONMENT", "production"),
    )

log = logging.getLogger("effant.api")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
HEALTH_FILE  = Path(__file__).resolve().parent.parent / "logs" / "health.json"

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in .env")

# ── DB connection pool ────────────────────────────────────────────────────────

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=4, maxconn=30, dsn=DATABASE_URL
        )
    return _pool


def query(sql: str, params: tuple = ()) -> list[dict]:
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


def query_one(sql: str, params: tuple = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB pool
    get_pool()
    billing_set_pool(get_pool())
    webhooks_set_pool(get_pool())
    admin_set_pool(get_pool())
    log.info("DB connection pool initialized")

    # Redis + cache
    redis = aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=False)
    FastAPICache.init(RedisBackend(redis), prefix="effant:")
    log.info(f"Redis cache initialized ({REDIS_URL})")

    yield

    if _pool:
        _pool.closeall()
    await redis.aclose() if hasattr(redis, 'aclose') else await redis.close()
    log.info("Shutdown complete")


# ── App + middleware ──────────────────────────────────────────────────────────

app = FastAPI(
    title="EFFANT Solana Intelligence API",
    version="0.1.0",
    description="Wallet profiling, anomaly detection, and entity clustering for Solana.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_middleware(APIKeyMiddleware, pool=get_pool())
app.include_router(billing_router)
app.include_router(webhooks_router)
app.include_router(admin_router)


# ── Cache key builder ─────────────────────────────────────────────────────────
# Strips auth headers so all valid callers share the same cache entries.

def _cache_key(func, namespace: str, request: Request, *args, **kwargs) -> str:
    return f"{namespace}:{request.url.path}?{request.url.query}"


# ── Response helpers ──────────────────────────────────────────────────────────

def _meta(count: int, **extra) -> dict:
    return {"count": count, "generated_at": datetime.now(tz=timezone.utc).isoformat(), **extra}


def ok(data: Any, **meta_extra) -> dict:
    count = len(data) if isinstance(data, list) else (1 if data is not None else 0)
    return {"data": data, "meta": _meta(count, **meta_extra)}


def _fmt_ts(val) -> str | None:
    if val is None:
        return None
    return val.isoformat() if hasattr(val, "isoformat") else str(val)


def _float(val) -> float:
    return float(val) if val is not None else 0.0


# ── Pydantic models ───────────────────────────────────────────────────────────

class ClusterSummary(BaseModel):
    id:            Optional[int]
    name:          Optional[str]
    wallet_count:  Optional[int]
    total_volume:  Optional[float]
    dominant_type: Optional[str]


class WalletProfile(BaseModel):
    address:          str
    label:            Optional[str]
    entity_type:      Optional[str]
    risk_score:       Optional[float]
    tx_count:         int
    total_volume_sol: float
    volume_24h_sol:   float
    first_seen:       Optional[str]
    last_seen:        Optional[str]
    cluster:          Optional[ClusterSummary]
    anomaly_count:    int


class EnrichedTransaction(BaseModel):
    signature:        str
    block_time:       Optional[str]
    from_wallet:      Optional[str]
    from_label:       Optional[str]
    from_entity_type: Optional[str]
    to_wallet:        Optional[str]
    to_label:         Optional[str]
    to_entity_type:   Optional[str]
    amount_sol:       float
    fee:              float
    success:          bool
    program_id:       Optional[str]


class AnomalyRecord(BaseModel):
    id:             int
    wallet_address: str
    wallet_label:   Optional[str]
    anomaly_type:   str
    severity:       str
    detected_at:    str
    description:    str


class ClusterDetail(BaseModel):
    id:            int
    name:          Optional[str]
    wallet_count:  int
    total_volume:  float
    dominant_type: Optional[str]
    algorithm:     Optional[str]
    created_at:    Optional[str]
    top_wallets:   list[dict]


class FlowRecord(BaseModel):
    signature:   str
    block_time:  Optional[str]
    from_wallet: Optional[str]
    from_label:  Optional[str]
    to_wallet:   Optional[str]
    to_label:    Optional[str]
    amount_sol:  float
    program_id:  Optional[str]


# ── GET /health  (public, liveness only) ─────────────────────────────────────

@app.get("/health", tags=["meta"])
def health(request: Request):
    row = query_one("SELECT COUNT(*) AS wallets FROM wallets")
    key = getattr(request.state, "api_key", None)
    return {
        "status":  "ok",
        "wallets": row["wallets"] if row else 0,
        "time":    datetime.now(tz=timezone.utc).isoformat(),
        "auth": {
            "authenticated": key is not None,
            "tier":          key["tier"]        if key else None,
            "calls_today":   key["calls_today"] if key else None,
            "calls_limit":   key["calls_limit"] if key else None,
        },
    }


# ── GET /v1/health  (authenticated, full system status) ──────────────────────

def _db_status() -> dict:
    try:
        row = query_one("""
            SELECT
                (SELECT COUNT(*) FROM wallets)      AS wallets,
                (SELECT COUNT(*) FROM transactions) AS transactions,
                (SELECT COUNT(*) FROM anomalies)    AS anomalies,
                (SELECT COUNT(*) FROM clusters
                 WHERE wallet_count > 1)            AS clusters
        """)
        return {"connected": True, **{k: int(v) for k, v in row.items()}}
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


def _redis_status() -> dict:
    try:
        import redis as _redis
        r = _redis.from_url(REDIS_URL, socket_connect_timeout=1)
        latency_ms = round(r.latency_history("ping")[0] if r.latency_history("ping") else 0, 2)
        info  = r.info("memory")
        return {
            "connected":   True,
            "used_memory": info.get("used_memory_human", "?"),
            "keys":        r.dbsize(),
        }
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


def _pipeline_status() -> dict:
    try:
        data = json.loads(HEALTH_FILE.read_text())
        return {
            "last_success":          data.get("last_success"),
            "last_run":              data.get("last_run"),
            "run_count":             data.get("run_count"),
            "total_txs_ingested":    data.get("total_txs"),
            "current_slot":          data.get("current_slot"),
            "consecutive_failures":  data.get("consecutive_failures", 0),
            "status":                data.get("status"),
        }
    except FileNotFoundError:
        return {"status": "no_data", "detail": "health.json not found — run the scheduler first"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


@app.get("/v1/health", tags=["meta"])
@cache(expire=10, key_builder=_cache_key)
async def v1_health():
    """Full system status: DB, Redis, pipeline, and counts."""
    db       = await run_in_threadpool(_db_status)
    redis    = await run_in_threadpool(_redis_status)
    pipeline = await run_in_threadpool(_pipeline_status)

    overall = "ok"
    if not db["connected"]:
        overall = "degraded"
    if pipeline.get("consecutive_failures", 0) >= 3:
        overall = "degraded"

    return {
        "status":   overall,
        "time":     datetime.now(tz=timezone.utc).isoformat(),
        "version":  "0.1.0",
        "database": db,
        "redis":    redis,
        "pipeline": pipeline,
    }


# ── GET /v1/wallet/{address} ──────────────────────────────────────────────────

def _fetch_wallet(address: str) -> dict:
    row = query_one("""
        SELECT w.address, w.label, w.entity_type, w.risk_score,
               w.tx_count, w.total_volume_sol, w.first_seen, w.last_seen,
               w.cluster_id,
               c.name          AS cluster_name,
               c.wallet_count  AS cluster_wallet_count,
               c.total_volume  AS cluster_total_volume,
               c.dominant_type AS cluster_dominant_type
        FROM wallets w
        LEFT JOIN clusters c ON c.id = w.cluster_id
        WHERE w.address = %s
    """, (address,))

    if row is None:
        return {}

    vol_row  = query_one("""
        SELECT COALESCE(SUM(amount_sol), 0) AS vol FROM transactions
        WHERE from_wallet = %s AND block_time >= NOW() - INTERVAL '24 hours' AND success = true
    """, (address,))
    anom_row = query_one("SELECT COUNT(*) AS n FROM anomalies WHERE wallet_address = %s", (address,))

    cluster = None
    if row["cluster_id"]:
        cluster = ClusterSummary(
            id=row["cluster_id"], name=row["cluster_name"],
            wallet_count=row["cluster_wallet_count"],
            total_volume=_float(row["cluster_total_volume"]),
            dominant_type=row["cluster_dominant_type"],
        ).model_dump()

    return WalletProfile(
        address=row["address"], label=row["label"], entity_type=row["entity_type"],
        risk_score=_float(row["risk_score"]) if row["risk_score"] is not None else None,
        tx_count=row["tx_count"], total_volume_sol=_float(row["total_volume_sol"]),
        volume_24h_sol=_float(vol_row["vol"]) if vol_row else 0.0,
        first_seen=_fmt_ts(row["first_seen"]), last_seen=_fmt_ts(row["last_seen"]),
        cluster=cluster, anomaly_count=anom_row["n"] if anom_row else 0,
    ).model_dump()


@app.get("/v1/wallet/{address}", tags=["wallets"])
@cache(expire=60, key_builder=_cache_key)
async def get_wallet(address: str) -> dict:
    """Wallet profile cached for 60 seconds."""
    data = await run_in_threadpool(_fetch_wallet, address)
    if not data:
        raise HTTPException(status_code=404, detail=f"Wallet {address} not found")
    return ok(data)


# ── GET /v1/wallet/{address}/transactions ─────────────────────────────────────

def _fetch_wallet_txs(address: str, limit: int) -> list[dict] | None:
    if not query_one("SELECT 1 FROM wallets WHERE address = %s", (address,)):
        return None
    rows = query("""
        SELECT t.signature, t.block_time,
               t.from_wallet, w_from.label AS from_label, w_from.entity_type AS from_entity_type,
               t.to_wallet,   w_to.label   AS to_label,   w_to.entity_type   AS to_entity_type,
               t.amount_sol, t.fee, t.success, t.program_id
        FROM transactions t
        LEFT JOIN wallets w_from ON w_from.address = t.from_wallet
        LEFT JOIN wallets w_to   ON w_to.address   = t.to_wallet
        WHERE t.from_wallet = %s OR t.to_wallet = %s
        ORDER BY t.block_time DESC NULLS LAST
        LIMIT %s
    """, (address, address, limit))

    return [EnrichedTransaction(
        signature=r["signature"], block_time=_fmt_ts(r["block_time"]),
        from_wallet=r["from_wallet"], from_label=r["from_label"], from_entity_type=r["from_entity_type"],
        to_wallet=r["to_wallet"],     to_label=r["to_label"],     to_entity_type=r["to_entity_type"],
        amount_sol=_float(r["amount_sol"]), fee=_float(r["fee"]),
        success=r["success"], program_id=r["program_id"],
    ).model_dump() for r in rows]


@app.get("/v1/wallet/{address}/transactions", tags=["wallets"])
@cache(expire=60, key_builder=_cache_key)
async def get_wallet_transactions(
    address: str,
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    """Wallet transaction history, cached for 60 seconds."""
    txs = await run_in_threadpool(_fetch_wallet_txs, address, limit)
    if txs is None:
        raise HTTPException(status_code=404, detail=f"Wallet {address} not found")
    return ok(txs, wallet=address, limit=limit)


# ── GET /v1/anomalies ─────────────────────────────────────────────────────────

VALID_SEVERITIES = {"low", "medium", "high", "critical"}
VALID_ANOM_TYPES = {"wash_trading", "volume_spike", "sandwich_attack", "whale_movement"}


def _fetch_anomalies(severity: str | None, anomaly_type: str | None, limit: int, offset: int) -> dict:
    filters, params = [], []
    if severity:
        filters.append("a.severity = %s"); params.append(severity)
    if anomaly_type:
        filters.append("a.anomaly_type = %s"); params.append(anomaly_type)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    count_row = query_one(f"SELECT COUNT(*) AS n FROM anomalies a {where}", tuple(params))
    rows = query(f"""
        SELECT a.id, a.wallet_address, w.label AS wallet_label,
               a.anomaly_type, a.severity, a.detected_at, a.description
        FROM anomalies a
        LEFT JOIN wallets w ON w.address = a.wallet_address
        {where}
        ORDER BY CASE a.severity
            WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            a.detected_at DESC
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))

    records = [AnomalyRecord(
        id=r["id"], wallet_address=r["wallet_address"], wallet_label=r["wallet_label"],
        anomaly_type=r["anomaly_type"], severity=r["severity"],
        detected_at=_fmt_ts(r["detected_at"]), description=r["description"],
    ).model_dump() for r in rows]

    return {"records": records, "total": count_row["n"] if count_row else 0}


@app.get("/v1/anomalies", tags=["anomalies"])
@cache(expire=30, key_builder=_cache_key)
async def get_anomalies(
    severity:     Optional[str] = Query(None),
    anomaly_type: Optional[str] = Query(None),
    limit:        int           = Query(100, ge=1, le=500),
    offset:       int           = Query(0,   ge=0),
) -> dict:
    """Anomaly feed cached for 30 seconds."""
    if severity     and severity     not in VALID_SEVERITIES:
        raise HTTPException(400, detail=f"severity must be one of {sorted(VALID_SEVERITIES)}")
    if anomaly_type and anomaly_type not in VALID_ANOM_TYPES:
        raise HTTPException(400, detail=f"anomaly_type must be one of {sorted(VALID_ANOM_TYPES)}")

    result = await run_in_threadpool(_fetch_anomalies, severity, anomaly_type, limit, offset)
    return ok(result["records"], total=result["total"], limit=limit, offset=offset,
              filters={"severity": severity, "anomaly_type": anomaly_type})


# ── GET /v1/clusters ──────────────────────────────────────────────────────────

def _fetch_clusters(min_wallets: int, dominant_type: str | None, limit: int, offset: int) -> dict:
    filters = ["c.wallet_count >= %s"]
    params: list = [min_wallets]
    if dominant_type:
        filters.append("c.dominant_type = %s"); params.append(dominant_type)
    where = "WHERE " + " AND ".join(filters)

    count_row = query_one(f"SELECT COUNT(*) AS n FROM clusters c {where}", tuple(params))
    rows = query(f"""
        SELECT c.id, c.name, c.wallet_count, c.total_volume,
               c.dominant_type, c.algorithm, c.created_at
        FROM clusters c {where}
        ORDER BY c.wallet_count DESC, c.total_volume DESC
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))

    cluster_ids = [r["id"] for r in rows]
    top_wallet_map: dict[int, list[dict]] = {cid: [] for cid in cluster_ids}
    if cluster_ids:
        ph = ",".join(["%s"] * len(cluster_ids))
        for wr in query(f"""
            SELECT address, label, entity_type,
                   ROUND(total_volume_sol::numeric, 6) AS volume, cluster_id
            FROM wallets WHERE cluster_id IN ({ph}) ORDER BY total_volume_sol DESC
        """, tuple(cluster_ids)):
            cid = wr["cluster_id"]
            if len(top_wallet_map[cid]) < 3:
                top_wallet_map[cid].append({
                    "address": wr["address"], "label": wr["label"],
                    "entity_type": wr["entity_type"], "volume": float(wr["volume"]),
                })

    clusters = [ClusterDetail(
        id=r["id"], name=r["name"], wallet_count=r["wallet_count"],
        total_volume=_float(r["total_volume"]), dominant_type=r["dominant_type"],
        algorithm=r["algorithm"], created_at=_fmt_ts(r["created_at"]),
        top_wallets=top_wallet_map.get(r["id"], []),
    ).model_dump() for r in rows]

    return {"clusters": clusters, "total": count_row["n"] if count_row else 0}


@app.get("/v1/clusters", tags=["clusters"])
@cache(expire=300, key_builder=_cache_key)
async def get_clusters(
    min_wallets:   int          = Query(2,    ge=1),
    dominant_type: Optional[str]= Query(None),
    limit:         int          = Query(100,  ge=1, le=500),
    offset:        int          = Query(0,    ge=0),
) -> dict:
    """Cluster data cached for 5 minutes."""
    result = await run_in_threadpool(_fetch_clusters, min_wallets, dominant_type, limit, offset)
    return ok(result["clusters"], total=result["total"], limit=limit, offset=offset)


# ── GET /v1/flows ─────────────────────────────────────────────────────────────

def _fetch_flows(min_sol: float, limit: int) -> list[dict]:
    rows = query("""
        SELECT t.signature, t.block_time,
               t.from_wallet, w_from.label AS from_label,
               t.to_wallet,   w_to.label   AS to_label,
               t.amount_sol, t.program_id
        FROM transactions t
        LEFT JOIN wallets w_from ON w_from.address = t.from_wallet
        LEFT JOIN wallets w_to   ON w_to.address   = t.to_wallet
        WHERE t.amount_sol >= %s AND t.success = true
        ORDER BY t.amount_sol DESC, t.block_time DESC
        LIMIT %s
    """, (min_sol, limit))
    return [FlowRecord(
        signature=r["signature"], block_time=_fmt_ts(r["block_time"]),
        from_wallet=r["from_wallet"], from_label=r["from_label"],
        to_wallet=r["to_wallet"],     to_label=r["to_label"],
        amount_sol=_float(r["amount_sol"]), program_id=r["program_id"],
    ).model_dump() for r in rows]


@app.get("/v1/flows", tags=["flows"])
@cache(expire=30, key_builder=_cache_key)
async def get_flows(
    min_sol: float = Query(10_000.0, ge=0),
    limit:   int   = Query(100, ge=1, le=500),
) -> dict:
    """Large fund movements cached for 30 seconds."""
    flows  = await run_in_threadpool(_fetch_flows, min_sol, limit)
    amounts = [f["amount_sol"] for f in flows]
    stats  = {"total_sol": round(sum(amounts), 4), "max_sol": round(max(amounts), 4),
               "min_sol": round(min(amounts), 4)} if flows else {}
    return ok(flows, min_sol_filter=min_sol, stats=stats,
              note="No transactions at this threshold — lower min_sol or ingest more data" if not flows else None)


# ── Customer portal routes ────────────────────────────────────────────────────
# These routes use email/password auth (JWT), NOT the X-API-Key middleware.
# The APIKeyMiddleware skips /portal/* paths.

import hashlib as _hashlib
import secrets as _secrets
import time as _time
from passlib.context import CryptContext as _CryptContext
from jose import jwt as _jwt, JWTError as _JWTError
from fastapi import Depends as _Depends
from fastapi.security import HTTPBearer as _HTTPBearer, HTTPAuthorizationCredentials as _HTTPCreds

_pwd  = _CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = _HTTPBearer(auto_error=False)
def JWT_SECRET() -> str:
    return os.getenv("JWT_SECRET", "")
JWT_ALG    = "HS256"
JWT_TTL    = 60 * 60 * 24 * 7   # 7 days


class _SignupBody(BaseModel):
    email:    str
    password: str


class _LoginBody(BaseModel):
    email:    str
    password: str


def _portal_query(sql: str, params: tuple = ()) -> list[dict]:
    return query(sql, params)


def _portal_query_one(sql: str, params: tuple = ()) -> dict | None:
    return query_one(sql, params)


def _make_token(user_id: int, email: str) -> str:
    payload = {"sub": str(user_id), "email": email, "exp": int(_time.time()) + JWT_TTL}
    return _jwt.encode(payload, JWT_SECRET(), algorithm=JWT_ALG)


def _decode_token(token: str) -> dict:
    return _jwt.decode(token, JWT_SECRET(), algorithms=[JWT_ALG])


async def _current_user(creds: _HTTPCreds | None = _Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = _decode_token(creds.credentials)
    except _JWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = _portal_query_one("SELECT id, email FROM users WHERE id = %s", (int(payload["sub"]),))
    if not user:
        raise HTTPException(401, "User not found")
    return user


# POST /portal/signup
@app.post("/portal/signup", tags=["portal"])
async def portal_signup(body: _SignupBody):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    existing = _portal_query_one("SELECT id FROM users WHERE email = %s", (body.email.lower(),))
    if existing:
        raise HTTPException(409, "Email already registered")

    pw_hash = _pwd.hash(body.password)
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO users (email, password_hash) VALUES (%s, %s) RETURNING id",
                (body.email.lower(), pw_hash),
            )
            user_id = cur.fetchone()["id"]
        conn.commit()
    finally:
        pool.putconn(conn)

    token = _make_token(user_id, body.email.lower())
    return {"token": token, "email": body.email.lower()}


# POST /portal/login
@app.post("/portal/login", tags=["portal"])
async def portal_login(body: _LoginBody):
    user = _portal_query_one(
        "SELECT id, email, password_hash FROM users WHERE email = %s",
        (body.email.lower(),),
    )
    if not user or not _pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = _make_token(user["id"], user["email"])
    return {"token": token, "email": user["email"]}


# GET /portal/me  — key info + usage
@app.get("/portal/me", tags=["portal"])
async def portal_me(user: dict = _Depends(_current_user)):
    key = _portal_query_one(
        """SELECT key_hash, tier, calls_today, calls_limit, active, created_at,
                  last_used_at, reset_at
           FROM api_keys WHERE user_id = %s AND active = TRUE
           ORDER BY created_at DESC LIMIT 1""",
        (user["id"],),
    )
    return {
        "email":      user["email"],
        "api_key":    key,
        "has_key":    key is not None,
    }


# GET /portal/call-log  — last 10 calls
@app.get("/portal/call-log", tags=["portal"])
async def portal_call_log(user: dict = _Depends(_current_user)):
    key = _portal_query_one(
        "SELECT key_hash FROM api_keys WHERE user_id = %s AND active = TRUE ORDER BY created_at DESC LIMIT 1",
        (user["id"],),
    )
    if not key:
        return {"calls": []}
    rows = _portal_query(
        """SELECT endpoint, method, status_code, response_ms, called_at
           FROM api_call_log WHERE key_hash = %s
           ORDER BY called_at DESC LIMIT 10""",
        (key["key_hash"],),
    )
    calls = [
        {
            "endpoint":    r["endpoint"],
            "method":      r["method"],
            "status_code": r["status_code"],
            "response_ms": r["response_ms"],
            "called_at":   r["called_at"].isoformat() if r["called_at"] else None,
        }
        for r in rows
    ]
    return {"calls": calls}


# POST /portal/provision-key  — create key for logged-in user (starter tier)
@app.post("/portal/provision-key", tags=["portal"])
async def portal_provision_key(user: dict = _Depends(_current_user)):
    existing = _portal_query_one(
        "SELECT key_hash FROM api_keys WHERE user_id = %s AND active = TRUE",
        (user["id"],),
    )
    if existing:
        raise HTTPException(409, "You already have an active API key")

    import secrets as _s
    from datetime import timedelta
    raw_key  = "eff_sk_" + _s.token_urlsafe(32)
    key_hash = _hashlib.sha256(raw_key.encode()).hexdigest()
    now      = datetime.now(tz=timezone.utc)
    reset_at = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO api_keys
                   (key_hash, customer_email, tier, calls_today, calls_limit,
                    created_at, reset_at, active, user_id)
                   VALUES (%s, %s, 'starter', 0, 10000, NOW(), %s, TRUE, %s)""",
                (key_hash, user["email"], reset_at, user["id"]),
            )
        conn.commit()
    finally:
        pool.putconn(conn)

    return {"api_key": raw_key, "tier": "starter", "calls_limit": 10000}


# POST /portal/forgot-password
class _ForgotBody(BaseModel):
    email: str


class _ResetBody(BaseModel):
    token:    str
    password: str


def _send_reset_email(email: str, raw_token: str) -> None:
    import urllib.request as _urllib
    import json as _json
    sg_key    = os.getenv("SENDGRID_API_KEY", "")
    from_addr = os.getenv("SENDGRID_FROM_EMAIL", "billing@effant.tech")
    frontend  = os.getenv("FRONTEND_URL", "http://localhost:5173")
    if not sg_key:
        log.warning("SENDGRID_API_KEY not set — skipping reset email")
        return
    reset_url = f"{frontend}?reset={raw_token}"
    html = f"""
    <div style="font-family:monospace;background:#0a0e1a;color:#e2e8f0;padding:40px;max-width:560px">
      <p style="color:#5b6cf8;font-size:20px;font-weight:bold">EFFANT</p>
      <h2 style="color:#fff;font-size:16px;margin:24px 0 8px">Reset your password</h2>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:24px">
        Click the link below to reset your password. This link expires in 1 hour.
      </p>
      <a href="{reset_url}"
         style="display:inline-block;background:#5b6cf8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">
        Reset password →
      </a>
      <p style="color:#475569;font-size:11px;margin-top:24px">
        If you didn't request this, ignore this email — your password won't change.
      </p>
    </div>
    """
    payload = _json.dumps({
        "personalizations": [{"to": [{"email": email}]}],
        "from": {"email": from_addr, "name": "EFFANT"},
        "subject": "EFFANT — Reset your password",
        "content": [{"type": "text/html", "value": html}],
    }).encode()
    try:
        req = _urllib.Request(
            "https://api.sendgrid.com/v3/mail/send",
            data=payload,
            headers={"Authorization": f"Bearer {sg_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with _urllib.urlopen(req, timeout=10) as resp:
            log.info(f"Reset email sent to {email} (status {resp.status})")
    except Exception as exc:
        log.error(f"SendGrid reset email error: {exc}")


@app.post("/portal/forgot-password", tags=["portal"])
async def portal_forgot_password(body: _ForgotBody):
    from datetime import timedelta
    user = _portal_query_one("SELECT id, email FROM users WHERE email = %s", (body.email.lower(),))
    # Always 200 — don't leak whether email exists
    if not user:
        return {"message": "If that email is registered, a reset link has been sent."}

    raw_token  = _secrets.token_urlsafe(48)
    token_hash = _hashlib.sha256(raw_token.encode()).hexdigest()
    expires_at = datetime.now(tz=timezone.utc) + timedelta(hours=1)

    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = %s AND used_at IS NULL",
                (user["id"],),
            )
            cur.execute(
                "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
                (user["id"], token_hash, expires_at),
            )
        conn.commit()
    finally:
        pool.putconn(conn)

    await run_in_threadpool(_send_reset_email, user["email"], raw_token)
    return {"message": "If that email is registered, a reset link has been sent."}


@app.post("/portal/reset-password", tags=["portal"])
async def portal_reset_password(body: _ResetBody):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    token_hash = _hashlib.sha256(body.token.encode()).hexdigest()
    row = _portal_query_one(
        """SELECT t.id, t.user_id, u.email
           FROM password_reset_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = %s AND t.used_at IS NULL AND t.expires_at > NOW()""",
        (token_hash,),
    )
    if not row:
        raise HTTPException(400, "Invalid or expired reset link. Request a new one.")

    pw_hash = _pwd.hash(body.password)
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (pw_hash, row["user_id"]))
            cur.execute("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = %s", (row["id"],))
        conn.commit()
    finally:
        pool.putconn(conn)

    token = _make_token(row["user_id"], row["email"])
    return {"token": token, "email": row["email"]}
