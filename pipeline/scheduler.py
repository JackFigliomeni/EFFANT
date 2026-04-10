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
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from dotenv import load_dotenv

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
    HEALTH_FILE.write_text(json.dumps(payload, indent=2))


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
                "transactionDetails": "full",
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
        # Retention policy: delete transactions older than 30 days
        cur.execute("""
            DELETE FROM transactions
            WHERE block_time < NOW() - INTERVAL '30 days'
        """)
    conn.commit()

    return len(parsed_txs), len({p["address"] for p in wallet_params})


# ── Scheduled job ─────────────────────────────────────────────────────────────

def ingest_job(batch_size: int, max_retries: int):
    state.run_count += 1
    run_num = state.run_count
    t0 = time.monotonic()

    log.info(f"── Run #{run_num} starting ──────────────────────────────")

    # Initialize slot cursor on first run
    if state.current_slot == 0:
        state.current_slot = get_finalized_slot()
        log.info(f"Initialized at slot {state.current_slot:,}")
        write_health("ok", "initialized")
        return

    tip = get_finalized_slot()

    if state.current_slot >= tip:
        log.info(f"At chain tip (slot {tip:,}). Nothing to do.")
        write_health("ok", f"at tip slot {tip:,}")
        return

    slots_behind = tip - state.current_slot
    log.info(f"Chain tip: {tip:,}  |  Behind: {slots_behind:,} slots")

    parsed_batch: list[dict] = []
    scan_slot = state.current_slot + 1

    while len(parsed_batch) < batch_size and scan_slot <= tip:
        block = get_block(scan_slot)
        if block and block.get("transactions"):
            block_time = block.get("blockTime")
            for raw_tx in block["transactions"]:
                raw_tx["blockTime"] = block_time
                parsed = parse_transaction(raw_tx, block_time)
                if parsed:
                    parsed_batch.append(parsed)
        scan_slot += 1

    state.current_slot = scan_slot - 1

    if not parsed_batch:
        log.info("No transactions parsed in this window.")
        write_health("ok", "no txs in window")
        return

    # Retry loop for DB writes
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
            state.conn = None  # force reconnect next attempt
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
        f"batch={n_txs} txs  wallets={n_wallets}  "
        f"total_txs={state.total_txs:,}  slot={state.current_slot:,}"
    )

    write_health("ok", f"last batch: {n_txs} txs at slot {state.current_slot:,}")


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


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EFFANT scheduled ingestion")
    parser.add_argument("--interval",    type=int,   default=30,  help="Run interval in seconds (default 30)")
    parser.add_argument("--batch",       type=int,   default=200, help="Max transactions per run (default 200)")
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
    scheduler.add_listener(on_job_error,    EVENT_JOB_ERROR)
    scheduler.add_listener(on_job_executed, EVENT_JOB_EXECUTED)

    # Run once immediately at startup
    log.info("Running initial job immediately...")
    ingest_job(batch_size=args.batch, max_retries=args.max_retries)

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
