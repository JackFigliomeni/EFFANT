"""
EFFANT — Scheduled ingestion pipeline.
Wraps ingest logic in APScheduler, running every 30 seconds.

Usage:
    python pipeline/scheduler.py [--interval 30] [--batch 100] [--max-retries 3]

Health check file: ~/effant/logs/health.json
Log file:          ~/effant/logs/pipeline.log
"""

import os
import sys
import json
import time
import logging
import argparse
import requests
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from dotenv import load_dotenv

# Pipeline modules (scheduler.py is run from project root, so these resolve correctly)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anomaly_detector import run as _run_anomaly_detection
from clusterer import run as _run_clustering
from labeler import run as _run_labeler
from webhook_dispatcher import dispatch_new_anomalies as _dispatch_webhooks

load_dotenv()

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR   = Path(__file__).resolve().parent.parent
# In Railway the container WORKDIR is /app; locally it's ~/effant.
# Either way, logs/ is one level below the project root.
LOGS_DIR   = Path(os.getenv("LOGS_DIR", str(BASE_DIR / "logs")))
LOG_FILE   = LOGS_DIR / "pipeline.log"
HEALTH_FILE = LOGS_DIR / "health.json"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY      = os.getenv("HELIUS_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
RPC_URL      = f"https://mainnet.helius-rpc.com/?api-key={API_KEY}"

if not API_KEY or API_KEY == "your_api_key_here":
    sys.exit("ERROR: Set HELIUS_API_KEY in .env")
if not DATABASE_URL:
    sys.exit("ERROR: Set DATABASE_URL in .env")

# ── Logging ───────────────────────────────────────────────────────────────────

log = logging.getLogger("effant.scheduler")
log.setLevel(logging.DEBUG)

_fmt = logging.Formatter(
    fmt="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Console handler
_console = logging.StreamHandler(sys.stdout)
_console.setLevel(logging.INFO)
_console.setFormatter(_fmt)
log.addHandler(_console)

# Rotating file handler — 5 MB × 3 files
_file = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
_file.setLevel(logging.DEBUG)
_file.setFormatter(_fmt)
log.addHandler(_file)

# ── State (shared across scheduled runs) ─────────────────────────────────────

class _State:
    conn:          psycopg2.extensions.connection | None = None
    current_slot:  int  = 0
    total_txs:     int  = 0
    total_wallets: int  = 0
    run_count:     int  = 0
    consecutive_failures: int = 0
    last_dispatch_ts: datetime = datetime(2000, 1, 1, tzinfo=timezone.utc)  # dispatch any undelivered on first run

state = _State()

# ── Health check ──────────────────────────────────────────────────────────────

def write_health(status: str, detail: str = ""):
    payload = {
        "status":           status,           # "ok" | "degraded" | "error"
        "last_success":     state.__dict__.get("last_success_ts", None),
        "last_run":         datetime.now(tz=timezone.utc).isoformat(),
        "run_count":        state.run_count,
        "total_txs":        state.total_txs,
        "total_wallets":    state.total_wallets,
        "current_slot":     state.current_slot,
        "consecutive_failures": state.consecutive_failures,
        "detail":           detail,
    }
    # Write to file (local dev fallback)
    try:
        HEALTH_FILE.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass
    # Write to Redis so the API container (separate Railway service) can read it
    try:
        import redis as _redis
        _redis_url = os.getenv("REDIS_PUBLIC_URL") or os.getenv("REDIS_URL", "redis://localhost:6379")
        r = _redis.from_url(_redis_url, socket_connect_timeout=2)
        r.setex("effant:pipeline:health", 300, json.dumps(payload))  # TTL 5 min
    except Exception as _e:
        log.warning(f"write_health Redis write failed (non-fatal): {_e}")


# ── RPC helpers (same as ingest.py) ──────────────────────────────────────────

def lamports_to_sol(lamports: int) -> float:
    return lamports / 1_000_000_000


def rpc_call(method: str, params: list, retries: int = 3):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(RPC_URL, json=payload, timeout=30)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(f"RPC error [{method}]: {data['error']}")
            return data["result"]
        except Exception as e:
            if attempt == retries:
                raise
            wait = 2 ** attempt  # exponential back-off: 2s, 4s
            log.warning(f"RPC attempt {attempt}/{retries} failed ({e}). Retrying in {wait}s...")
            time.sleep(wait)


def get_finalized_slot() -> int:
    return rpc_call("getSlot", [{"commitment": "finalized"}])


def get_block(slot: int) -> dict | None:
    try:
        return rpc_call("getBlock", [
            slot,
            {
                "encoding": "json",
                "transactionDetails": "accounts",  # ~80% smaller — we only need accounts + balances
                "maxSupportedTransactionVersion": 0,
                "rewards": False,
                "commitment": "finalized",
            }
        ])
    except Exception:
        return None


def parse_transaction(tx: dict, block_time: int | None) -> dict | None:
    meta        = tx.get("meta") or {}
    transaction = tx.get("transaction") or {}
    message     = transaction.get("message") or {}

    sigs = transaction.get("signatures", [])
    if not sigs:
        return None
    signature = sigs[0]

    raw_accounts = message.get("accountKeys", [])
    accounts = [(a["pubkey"] if isinstance(a, dict) else a) for a in raw_accounts]
    if len(accounts) < 2:
        return None

    from_wallet = accounts[0]
    to_wallet   = accounts[1]
    program_id  = accounts[-1] if accounts else None

    fee     = lamports_to_sol(meta.get("fee", 0))
    success = meta.get("err") is None

    pre  = meta.get("preBalances", [])
    post = meta.get("postBalances", [])
    deltas    = [lamports_to_sol(post[i] - pre[i]) for i in range(1, min(len(pre), len(post)))]
    positives = [d for d in deltas if d > 0]
    amount_sol = max(positives) if positives else 0.0

    ts = datetime.fromtimestamp(block_time, tz=timezone.utc) if block_time else None

    return {
        "signature":   signature,
        "block_time":  ts,
        "fee":         fee,
        "success":     success,
        "from_wallet": from_wallet,
        "to_wallet":   to_wallet,
        "amount_sol":  amount_sol,
        "program_id":  program_id,
    }


# ── Database ──────────────────────────────────────────────────────────────────

UPSERT_WALLET = """
    INSERT INTO wallets (address, first_seen, last_seen, tx_count, total_volume_sol)
    VALUES (%(address)s, %(ts)s, %(ts)s, 1, %(volume)s)
    ON CONFLICT (address) DO UPDATE SET
        last_seen        = GREATEST(wallets.last_seen, EXCLUDED.last_seen),
        tx_count         = wallets.tx_count + 1,
        total_volume_sol = wallets.total_volume_sol + EXCLUDED.total_volume_sol
"""

INSERT_TX = """
    INSERT INTO transactions
        (signature, block_time, fee, success, from_wallet, to_wallet, amount_sol, program_id)
    VALUES
        (%(signature)s, %(block_time)s, %(fee)s, %(success)s,
         %(from_wallet)s, %(to_wallet)s, %(amount_sol)s, %(program_id)s)
    ON CONFLICT (signature) DO NOTHING
"""


def get_conn() -> psycopg2.extensions.connection:
    if state.conn is None or state.conn.closed:
        log.info("Opening new database connection...")
        state.conn = psycopg2.connect(DATABASE_URL)
    # Test the connection is still alive
    try:
        state.conn.isolation_level  # cheap probe
    except psycopg2.OperationalError:
        log.warning("DB connection lost. Reconnecting...")
        state.conn = psycopg2.connect(DATABASE_URL)
    return state.conn


def upsert_batch(parsed_txs: list[dict]) -> tuple[int, int]:
    if not parsed_txs:
        return 0, 0

    wallet_params = []
    for tx in parsed_txs:
        wallet_params.append({"address": tx["from_wallet"], "ts": tx["block_time"], "volume": 0})
        wallet_params.append({"address": tx["to_wallet"],   "ts": tx["block_time"], "volume": tx["amount_sol"]})

    conn = get_conn()
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, UPSERT_WALLET, wallet_params, page_size=500)
        psycopg2.extras.execute_batch(cur, INSERT_TX,     parsed_txs,    page_size=500)
        # Retention policy: keep 90 days of history
        cur.execute("""
            DELETE FROM transactions
            WHERE block_time < NOW() - INTERVAL '90 days'
        """)
    conn.commit()

    return len(parsed_txs), len({p["address"] for p in wallet_params})


# ── Targeted wallet fetch ─────────────────────────────────────────────────────

def get_monitored_wallets() -> list[str]:
    """Return all wallet addresses currently tracked in the DB."""
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT address FROM wallets ORDER BY last_seen DESC LIMIT 500")
        return [r[0] for r in cur.fetchall()]


def fetch_wallet_signatures(address: str, limit: int = 50, before: str | None = None) -> list[str]:
    """Return recent confirmed tx signatures for a specific wallet via Helius RPC."""
    params: list = [address, {"limit": limit, "commitment": "finalized"}]
    if before:
        params[1]["before"] = before
    try:
        result = rpc_call("getSignaturesForAddress", params)
        return [r["signature"] for r in (result or []) if not r.get("err")]
    except Exception as e:
        log.warning(f"getSignaturesForAddress({address[:8]}…) failed: {e}")
        return []


def fetch_transaction(sig: str) -> dict | None:
    """Fetch a single transaction by signature."""
    try:
        result = rpc_call("getTransaction", [
            sig,
            {
                "encoding": "json",
                "maxSupportedTransactionVersion": 0,
                "commitment": "finalized",
            }
        ])
        return result
    except Exception:
        return None


def parse_full_transaction(tx: dict) -> dict | None:
    """Parse a full transaction object (from getTransaction)."""
    if not tx:
        return None
    meta        = tx.get("meta") or {}
    transaction = tx.get("transaction") or {}
    message     = transaction.get("message") or {}
    block_time  = tx.get("blockTime")

    sigs = transaction.get("signatures", [])
    if not sigs:
        return None
    signature = sigs[0]

    raw_accounts = message.get("accountKeys", [])
    accounts = [(a["pubkey"] if isinstance(a, dict) else a) for a in raw_accounts]
    if len(accounts) < 2:
        return None

    from_wallet = accounts[0]
    to_wallet   = accounts[1]
    program_id  = accounts[-1] if accounts else None
    fee         = lamports_to_sol(meta.get("fee", 0))
    success     = meta.get("err") is None

    pre  = meta.get("preBalances", [])
    post = meta.get("postBalances", [])
    deltas    = [lamports_to_sol(post[i] - pre[i]) for i in range(1, min(len(pre), len(post)))]
    positives = [d for d in deltas if d > 0]
    amount_sol = max(positives) if positives else 0.0

    ts = datetime.fromtimestamp(block_time, tz=timezone.utc) if block_time else None

    return {
        "signature":   signature,
        "block_time":  ts,
        "fee":         fee,
        "success":     success,
        "from_wallet": from_wallet,
        "to_wallet":   to_wallet,
        "amount_sol":  amount_sol,
        "program_id":  program_id,
    }


def get_known_signatures() -> set[str]:
    """Return all tx signatures already in the DB to avoid re-fetching."""
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT signature FROM transactions ORDER BY block_time DESC LIMIT 50000")
        return {r[0] for r in cur.fetchall()}


# ── Scheduled job ─────────────────────────────────────────────────────────────

def ingest_job(batch_size: int, max_retries: int):
    state.run_count += 1
    run_num = state.run_count
    t0 = time.monotonic()

    log.info(f"── Run #{run_num} starting ──────────────────────────────")

    wallets = get_monitored_wallets()
    if not wallets:
        log.info("No wallets to monitor yet.")
        write_health("ok", "no wallets")
        return

    known_sigs = get_known_signatures()
    parsed_batch: list[dict] = []
    wallets_checked = 0

    for address in wallets:
        if len(parsed_batch) >= batch_size:
            break
        sigs = fetch_wallet_signatures(address, limit=20)
        new_sigs = [s for s in sigs if s not in known_sigs]
        for sig in new_sigs[:5]:  # max 5 new txs per wallet per run
            tx = fetch_transaction(sig)
            parsed = parse_full_transaction(tx)
            if parsed:
                parsed_batch.append(parsed)
                known_sigs.add(sig)
        wallets_checked += 1

    log.info(f"Checked {wallets_checked} wallets, found {len(parsed_batch)} new txs")

    if not parsed_batch:
        log.info("No new transactions found.")
        write_health("ok", "no new txs")
        return

    for attempt in range(1, max_retries + 1):
        try:
            n_txs, n_wallets = upsert_batch(parsed_batch)
            break
        except psycopg2.Error as e:
            log.error(f"DB write attempt {attempt}/{max_retries} failed: {e}")
            if state.conn:
                try:
                    state.conn.rollback()
                except Exception:
                    pass
            state.conn = None
            if attempt == max_retries:
                raise
            time.sleep(2 ** attempt)

    state.total_txs     += n_txs
    state.total_wallets += n_wallets
    state.consecutive_failures = 0
    state.last_success_ts = datetime.now(tz=timezone.utc).isoformat()  # type: ignore[attr-defined]

    elapsed = time.monotonic() - t0
    log.info(
        f"Run #{run_num} done in {elapsed:.2f}s  |  "
        f"new_txs={n_txs}  wallets={n_wallets}  total_txs={state.total_txs:,}"
    )
    write_health("ok", f"last batch: {n_txs} new txs from {wallets_checked} wallets")


# ── Scheduler event listeners ─────────────────────────────────────────────────

def on_job_error(event):
    state.consecutive_failures += 1
    err = str(event.exception)
    log.error(
        f"Job failed (consecutive failures: {state.consecutive_failures})  |  {err}",
        exc_info=event.traceback,
    )
    severity = "error" if state.consecutive_failures >= 3 else "degraded"
    write_health(severity, f"failure #{state.consecutive_failures}: {err[:200]}")


def on_job_executed(event):
    pass  # success path already logged inside ingest_job


# ── Labeling job ──────────────────────────────────────────────────────────────

def label_job():
    log.info("── Wallet labeling starting ────────────────────────────")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        n = _run_labeler(conn)
        conn.close()
        log.info(f"── Wallet labeling done: {n:,} wallets ─────────────")
    except Exception as exc:
        log.error(f"Label job failed: {exc}")


# ── Anomaly detection job ─────────────────────────────────────────────────────

def anomaly_job():
    log.info("── Anomaly detection starting ──────────────────────────")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        n = _run_anomaly_detection(conn)
        log.info(f"── Anomaly detection done: {n} records ────────────")

        # Dispatch new critical/high anomalies to registered webhooks
        since = state.last_dispatch_ts
        state.last_dispatch_ts = datetime.now(tz=timezone.utc)
        try:
            dispatched = _dispatch_webhooks(conn, since)
            if dispatched:
                log.info(f"── Webhook dispatch: {dispatched} events fired ─────")
        except Exception as exc:
            log.error(f"Webhook dispatch failed (non-fatal): {exc}")

        conn.close()
    except Exception as exc:
        log.error(f"Anomaly job failed: {exc}")


# ── Clustering job ────────────────────────────────────────────────────────────

def cluster_job():
    log.info("── Entity clustering starting ──────────────────────────")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        n = _run_clustering(conn)
        conn.close()
        log.info(f"── Entity clustering done: {n} clusters ────────────")
    except Exception as exc:
        log.error(f"Cluster job failed: {exc}")


# ── Vacuum job ───────────────────────────────────────────────────────────────

def vacuum_job():
    """
    VACUUM ANALYZE all data tables to reclaim dead tuple space.
    Required because DELETE leaves dead rows — Postgres won't free disk space
    until VACUUM runs. Without this, heavy DELETE churn fills the volume.
    """
    log.info("── VACUUM ANALYZE starting ─────────────────────────────")
    tables = ["transactions", "wallets", "anomalies", "clusters"]
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True  # VACUUM must run outside a transaction block
        with conn.cursor() as cur:
            for table in tables:
                log.info(f"   VACUUM ANALYZE {table}...")
                cur.execute(f"VACUUM ANALYZE {table}")
        conn.close()
        log.info("── VACUUM ANALYZE done ─────────────────────────────")
    except Exception as exc:
        log.error(f"Vacuum job failed: {exc}")


# ── Daily email digest ────────────────────────────────────────────────────────

SENDGRID_API_KEY   = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM      = os.getenv("SENDGRID_FROM_EMAIL", "noreply@effant.tech")
DIGEST_RECIPIENT   = os.getenv("DIGEST_EMAIL")          # your personal inbox


def send_daily_digest():
    """Send yesterday's stats to DIGEST_EMAIL via SendGrid."""
    if not SENDGRID_API_KEY or not DIGEST_RECIPIENT:
        log.warning("Daily digest skipped: SENDGRID_API_KEY or DIGEST_EMAIL not set")
        return

    try:
        conn = psycopg2.connect(DATABASE_URL)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                  (SELECT COUNT(*) FROM users) AS total_users,
                  (SELECT COUNT(*) FROM subscriptions WHERE status='active') AS active_subs,
                  (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND tier='starter') AS starters,
                  (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND tier='pro') AS pros,
                  (SELECT COUNT(*) FROM api_call_log
                   WHERE called_at >= NOW() - INTERVAL '24 hours') AS calls_24h,
                  (SELECT COUNT(*) FROM wallets) AS wallets,
                  (SELECT COUNT(*) FROM transactions) AS txs
            """)
            s = dict(cur.fetchone())

            cur.execute("""
                SELECT u.email, COUNT(l.id) AS calls
                FROM api_call_log l
                JOIN api_keys k ON k.key_hash = l.key_hash
                JOIN users u ON u.id = k.user_id
                WHERE l.called_at >= NOW() - INTERVAL '24 hours'
                GROUP BY u.email ORDER BY calls DESC LIMIT 5
            """)
            top = cur.fetchall()
        conn.close()

        mrr = s["starters"] * 499 + s["pros"] * 4900
        top_html = "".join(
            f"<tr><td>{r['email']}</td><td>{r['calls']:,}</td></tr>" for r in top
        ) or "<tr><td colspan='2'>No calls yet</td></tr>"

        yesterday = (datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        html = f"""
        <h2>EFFANT Daily Digest — {yesterday}</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Total Users</td><td>{s['total_users']:,}</td></tr>
          <tr><td>Active Subscriptions</td><td>{s['active_subs']:,} ({s['starters']} Starter / {s['pros']} Pro)</td></tr>
          <tr><td>MRR</td><td>${mrr:,}</td></tr>
          <tr><td>API Calls (24h)</td><td>{s['calls_24h']:,}</td></tr>
          <tr><td>Wallets Indexed</td><td>{s['wallets']:,}</td></tr>
          <tr><td>Transactions (30d)</td><td>{s['txs']:,}</td></tr>
        </table>
        <h3>Top 5 Users by API Calls (24h)</h3>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><th>Email</th><th>Calls</th></tr>
          {top_html}
        </table>
        <p style="color:#888;font-size:12px">Sent by EFFANT pipeline · effant.tech</p>
        """

        import urllib.request, json as _json
        payload = _json.dumps({
            "personalizations": [{"to": [{"email": DIGEST_RECIPIENT}]}],
            "from": {"email": SENDGRID_FROM, "name": "EFFANT"},
            "subject": f"EFFANT Daily Digest — {yesterday}",
            "content": [{"type": "text/html", "value": html}],
        }).encode()
        req = urllib.request.Request(
            "https://api.sendgrid.com/v3/mail/send",
            data=payload,
            headers={
                "Authorization": f"Bearer {SENDGRID_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            log.info(f"Daily digest sent to {DIGEST_RECIPIENT} (status {resp.status})")
    except Exception as exc:
        log.error(f"Daily digest failed: {exc}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EFFANT scheduled ingestion")
    parser.add_argument("--interval",    type=int,   default=300, help="Run interval in seconds (default 300)")
    parser.add_argument("--batch",       type=int,   default=25,  help="Max transactions per run (default 25)")
    parser.add_argument("--max-retries", type=int,   default=3,   help="DB write retries per run (default 3)")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("EFFANT scheduler starting")
    log.info(f"  interval    : {args.interval}s")
    log.info(f"  batch size  : {args.batch} txs")
    log.info(f"  max retries : {args.max_retries}")
    log.info(f"  log file    : {LOG_FILE}")
    log.info(f"  health file : {HEALTH_FILE}")
    log.info("=" * 60)

    write_health("ok", "scheduler starting")

    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(
        ingest_job,
        trigger="interval",
        seconds=args.interval,
        kwargs={"batch_size": args.batch, "max_retries": args.max_retries},
        id="ingest",
        name="Helius ingest",
        max_instances=1,          # never overlap runs
        misfire_grace_time=10,    # skip if > 10s late
        coalesce=True,            # merge missed fires into one
    )
    scheduler.add_job(
        label_job,
        trigger="interval",
        minutes=30,
        id="labeling",
        name="Wallet labeling",
        max_instances=1,
        misfire_grace_time=120,
        coalesce=True,
    )
    scheduler.add_job(
        anomaly_job,
        trigger="interval",
        minutes=2,
        id="anomaly_detection",
        name="Anomaly detection",
        max_instances=1,
        misfire_grace_time=30,
        coalesce=True,
    )
    scheduler.add_job(
        cluster_job,
        trigger="interval",
        minutes=5,
        id="clustering",
        name="Entity clustering",
        max_instances=1,
        misfire_grace_time=60,
        coalesce=True,
    )
    # Daily digest at 08:00 UTC
    scheduler.add_job(
        send_daily_digest,
        trigger=CronTrigger(hour=8, minute=0, timezone="UTC"),
        id="daily_digest",
        name="Daily email digest",
        max_instances=1,
    )
    # Weekly VACUUM ANALYZE on all data tables — Sunday 03:00 UTC
    # Reclaims dead tuple space from deletes/updates to prevent volume bloat.
    scheduler.add_job(
        vacuum_job,
        trigger=CronTrigger(day_of_week="sun", hour=3, minute=0, timezone="UTC"),
        id="vacuum",
        name="Weekly VACUUM ANALYZE",
        max_instances=1,
    )
    scheduler.add_listener(on_job_error,    EVENT_JOB_ERROR)
    scheduler.add_listener(on_job_executed, EVENT_JOB_EXECUTED)

    # Run once immediately at startup
    log.info("Running initial jobs immediately...")
    ingest_job(batch_size=args.batch, max_retries=args.max_retries)
    label_job()
    anomaly_job()
    cluster_job()

    log.info(f"Scheduler started. Next run in {args.interval}s. Ctrl+C to stop.")
    try:
        scheduler.start()
    except KeyboardInterrupt:
        log.info("Scheduler stopped.")
        write_health("ok", "scheduler stopped by user")
        if state.conn and not state.conn.closed:
            state.conn.close()


if __name__ == "__main__":
    main()
