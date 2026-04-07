"""
EFFANT — Continuous Solana transaction ingestion pipeline.
Pulls blocks from Helius RPC and upserts into PostgreSQL.

Usage:
    python pipeline/ingest.py [--batch 100] [--interval 2]
"""

import os
import sys
import time
import logging
import argparse
import requests
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY      = os.getenv("HELIUS_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
RPC_URL      = f"https://mainnet.helius-rpc.com/?api-key={API_KEY}"

if not API_KEY or API_KEY == "your_api_key_here":
    sys.exit("ERROR: Set HELIUS_API_KEY in .env")
if not DATABASE_URL:
    sys.exit("ERROR: Set DATABASE_URL in .env")

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("effant.ingest")

# ── Helpers ───────────────────────────────────────────────────────────────────

def lamports_to_sol(lamports: int) -> float:
    return lamports / 1_000_000_000


def rpc(method: str, params: list):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    r = requests.post(RPC_URL, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"RPC error [{method}]: {data['error']}")
    return data["result"]


def get_finalized_slot() -> int:
    return rpc("getSlot", [{"commitment": "finalized"}])


def get_block(slot: int) -> dict | None:
    try:
        return rpc("getBlock", [
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
        return None  # skipped / empty slot


def parse_transaction(tx: dict, block_time: int | None) -> dict | None:
    meta        = tx.get("meta") or {}
    transaction = tx.get("transaction") or {}
    message     = transaction.get("message") or {}

    # Signature
    sigs = transaction.get("signatures", [])
    if not sigs:
        return None
    signature = sigs[0]

    # Accounts
    raw_accounts = message.get("accountKeys", [])
    accounts = [
        (a["pubkey"] if isinstance(a, dict) else a)
        for a in raw_accounts
    ]
    if len(accounts) < 2:
        return None

    from_wallet = accounts[0]
    to_wallet   = accounts[1]

    # Program ID (last static account that is a program)
    program_id = accounts[-1] if accounts else None

    # Fee and status
    fee     = lamports_to_sol(meta.get("fee", 0))
    success = meta.get("err") is None

    # SOL transferred: max positive inflow to any non-fee-payer account
    pre     = meta.get("preBalances", [])
    post    = meta.get("postBalances", [])
    deltas  = [lamports_to_sol(post[i] - pre[i]) for i in range(1, min(len(pre), len(post)))]
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


def upsert_batch(conn, parsed_txs: list[dict]) -> tuple[int, int]:
    """Insert a batch of parsed transactions. Returns (inserted_txs, new_wallets)."""
    if not parsed_txs:
        return 0, 0

    inserted_txs  = 0
    wallet_params = []

    for tx in parsed_txs:
        wallet_params.append({"address": tx["from_wallet"], "ts": tx["block_time"], "volume": 0})
        wallet_params.append({"address": tx["to_wallet"],   "ts": tx["block_time"], "volume": tx["amount_sol"]})

    with conn.cursor() as cur:
        # Upsert wallets first (FK deps)
        psycopg2.extras.execute_batch(cur, UPSERT_WALLET, wallet_params, page_size=500)

        # Insert transactions
        before = cur.rowcount
        psycopg2.extras.execute_batch(cur, INSERT_TX, parsed_txs, page_size=500)

        # Count actual inserts via mogrify trick — just track via fetchone after
        cur.execute("SELECT COUNT(*) FROM transactions")
        inserted_txs = len(parsed_txs)

    conn.commit()
    return inserted_txs, len({p["address"] for p in wallet_params})


# ── Main loop ─────────────────────────────────────────────────────────────────

def ingest_loop(batch_size: int, poll_interval: float):
    conn = psycopg2.connect(DATABASE_URL)
    log.info("Connected to database.")

    # Track highest slot we've processed so we don't re-scan
    current_slot = get_finalized_slot()
    log.info(f"Starting from slot {current_slot:,}")

    total_txs     = 0
    total_wallets = 0
    slots_scanned = 0
    run_start     = time.time()

    while True:
        try:
            tip = get_finalized_slot()

            if current_slot >= tip:
                log.info(f"At chain tip (slot {tip:,}). Waiting {poll_interval}s...")
                time.sleep(poll_interval)
                continue

            # Process up to batch_size transactions worth of blocks
            parsed_batch: list[dict] = []
            scan_slot = current_slot + 1

            while len(parsed_batch) < batch_size and scan_slot <= tip:
                block = get_block(scan_slot)
                if block and block.get("transactions"):
                    block_time = block.get("blockTime")
                    for raw_tx in block["transactions"]:
                        raw_tx["blockTime"] = block_time
                        parsed = parse_transaction(raw_tx, block_time)
                        if parsed:
                            parsed_batch.append(parsed)

                scan_slot    += 1
                slots_scanned += 1

            current_slot = scan_slot - 1

            if parsed_batch:
                n_txs, n_wallets = upsert_batch(conn, parsed_batch)
                total_txs     += n_txs
                total_wallets += n_wallets

                elapsed = time.time() - run_start
                tps     = total_txs / elapsed if elapsed > 0 else 0

                log.info(
                    f"slot={current_slot:,}  "
                    f"batch={n_txs:>4} txs  "
                    f"wallets={n_wallets:>4}  "
                    f"total_txs={total_txs:,}  "
                    f"rate={tps:.1f} tx/s"
                )
            else:
                log.debug(f"slot={current_slot:,}  no transactions")

        except KeyboardInterrupt:
            log.info("Interrupted. Closing database connection.")
            conn.close()
            break
        except psycopg2.OperationalError as e:
            log.error(f"DB error: {e}. Reconnecting in 5s...")
            time.sleep(5)
            conn = psycopg2.connect(DATABASE_URL)
        except requests.RequestException as e:
            log.warning(f"RPC error: {e}. Retrying in {poll_interval}s...")
            time.sleep(poll_interval)
        except Exception as e:
            log.exception(f"Unexpected error: {e}")
            time.sleep(poll_interval)

    elapsed = time.time() - run_start
    log.info(
        f"Session complete — "
        f"{total_txs:,} txs | "
        f"{total_wallets:,} wallet upserts | "
        f"{slots_scanned:,} slots | "
        f"{elapsed:.1f}s elapsed"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EFFANT ingest pipeline")
    parser.add_argument("--batch",    type=int,   default=100, help="Transactions per batch (default 100)")
    parser.add_argument("--interval", type=float, default=2.0, help="Poll interval in seconds when at tip (default 2)")
    args = parser.parse_args()

    log.info(f"EFFANT ingest starting — batch={args.batch} interval={args.interval}s")
    ingest_loop(args.batch, args.interval)
