"""
EFFANT — Wallet labeling module.
Rules-based classifier that assigns label and entity_type to all wallets in the DB.

Classification priority (highest wins):
  1. known_address  — address in exchange/protocol lookup table
  2. mev_bot        — very high tx frequency or Jito interaction
  3. wash_bot       — circular transactions detected
  4. defi_protocol  — interacts with known DeFi program IDs
  5. exchange       — high volume + many counterparties (behavioral)
  6. whale          — large SOL volume, low tx frequency
  7. unknown        — everything else

Usage:
    python pipeline/labeler.py [--dry-run] [--verbose]
"""

import os
import sys
import logging
import argparse
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("ERROR: Set DATABASE_URL in .env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("effant.labeler")

# ── Known address lookup table ─────────────────────────────────────────────────
# Sources: public blockchain explorers (Solscan, SolanaFM), exchange disclosures.
# Hot wallets rotate — treat as best-effort. Update as new addresses are confirmed.

KNOWN_ADDRESSES: dict[str, tuple[str, str]] = {
    # address → (label, entity_type)

    # ── Binance ──────────────────────────────────────────────────────────────
    "9WzPWqKSn4SjKbbgXL1NmTQs5JHh6CJ5mxKTQPyBCnoe": ("Binance",    "exchange"),
    "AC5RDfQFmDS1deWZos921JpqblVpRCUF9V8V3EKeUxBP":  ("Binance",    "exchange"),
    "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8o":  ("Binance",    "exchange"),
    "5tzFkiKscXHK5ZXCGbXZxdw7gA9kxfeFEmXFfECiRmFo":  ("Binance",    "exchange"),
    "BmFdpraQhkiDosW1ydFBVDuCBhY7c5PApFEqCCJQMkKX":  ("Binance",    "exchange"),
    "8JGLAoFN7BBXhMtmAFVADeyLGwG9mNdaCAiNhcvFwxxx":  ("Binance",    "exchange"),

    # ── Coinbase ─────────────────────────────────────────────────────────────
    "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS":  ("Coinbase",   "exchange"),
    "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE":  ("Coinbase",   "exchange"),
    "CoinbasePrimeVault1111111111111111111111111":     ("Coinbase",   "exchange"),
    "pqx3fCbepJQm8BjnCqxKQ3bHcwBMPcYMRqPBxwpq4tL":   ("Coinbase",   "exchange"),

    # ── Kraken ───────────────────────────────────────────────────────────────
    "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5":   ("Kraken",     "exchange"),
    "BE8Z9sCjFwDWzqVSAGXaSi3aDmxGHHGsbeHpFcMUcaFB":  ("Kraken",     "exchange"),
    "BhKTQL4Z8bfQ1V5gM3nMQPMKkqpMNoubMJrNBjnpFzVp":  ("Kraken",     "exchange"),

    # ── OKX ──────────────────────────────────────────────────────────────────
    "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhx5Lt5j4B7Jh":  ("OKX",        "exchange"),
    "HVH6wHNBR4wKYSUGhXEBfKFarOBFPrJFbNYCHHfqbPef":  ("OKX",        "exchange"),
    "AobVSwjm9nFBRgr6LEBS16ZjjPPHNkY3fZmA3JB7RFnL":  ("OKX",        "exchange"),

    # ── Known DeFi protocols / system programs ────────────────────────────────
    "Vote111111111111111111111111111111111111111":      ("Solana Vote Program",    "system"),
    "11111111111111111111111111111111":                 ("Solana System Program",  "system"),
    "ComputeBudget111111111111111111111111111111":      ("Compute Budget Program", "system"),
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA":    ("SPL Token Program",      "system"),
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb":    ("Token-2022 Program",     "system"),
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bte":   ("Associated Token",       "system"),
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8":   ("Raydium AMM",            "defi_protocol"),
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK":   ("Raydium CLMM",           "defi_protocol"),
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3sFjJ6a":    ("Orca Whirlpool",         "defi_protocol"),
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP":   ("Orca (legacy)",          "defi_protocol"),
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4":    ("Jupiter v6",             "defi_protocol"),
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB":    ("Jupiter v4",             "defi_protocol"),
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin":   ("Serum DEX v3",           "defi_protocol"),
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX":    ("OpenBook",               "defi_protocol"),
    "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD":    ("Marinade Finance",       "defi_protocol"),
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So":    ("Marinade mSOL",          "defi_protocol"),
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj":   ("Lido stSOL",             "defi_protocol"),
    "MFv2hWf31Z9kbCa1snEPdcgp168vLLLRe73fpoBzmbh":    ("Marginfi v2",            "defi_protocol"),
    "So11111111111111111111111111111111111111112":      ("Wrapped SOL",            "system"),
}

# ── Known program IDs for DeFi detection ──────────────────────────────────────
DEFI_PROGRAM_IDS: set[str] = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",  # Raydium AMM v4
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",  # Raydium CLMM
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3sFjJ6a",   # Orca Whirlpool
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",  # Orca (legacy)
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",   # Jupiter v6
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",   # Jupiter v4
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",  # Serum DEX v3
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",   # OpenBook
    "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",   # Marinade Finance
    "MFv2hWf31Z9kbCa1snEPdcgp168vLLLRe73fpoBzmbh",   # Marginfi v2
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",  # Lido
}

MEV_PROGRAM_IDS: set[str] = {
    "jitodontfront1111111111111111JustUseJupiter",     # Jito tip program
    "T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt",   # Jito block engine
    "B2siZ7EQoZJzqQR2g85uXa4aHCLmJwMEwq7DZTM87wSX",  # Jito tip router
}

# ── Thresholds (calibrated from percentile analysis of live data) ──────────────
THRESHOLDS = {
    # MEV: firing > 5 tx/sec in a single observed window
    "mev_txs_per_sec":      5.0,
    # MEV: any interaction with Jito programs
    "mev_jito_min_txs":     1,
    # Wash: bidirectional tx pairs with same counterparty
    "wash_min_pairs":       2,
    # Exchange (behavioral): unique counterparties
    "exchange_min_counterparties": 15,
    # Exchange (behavioral): minimum volume in SOL
    "exchange_min_volume_sol":     5.0,
    # Whale: large volume, low frequency
    "whale_min_volume_sol":        20.0,
    "whale_max_tx_count":          30,
    # DeFi: minimum DeFi program interactions
    "defi_min_txs":                1,
}


# ── DB queries ─────────────────────────────────────────────────────────────────

def load_wallet_features(conn) -> dict[str, dict]:
    """
    Pull all features needed for classification in as few queries as possible.
    Returns dict: address → feature dict.
    """
    features: dict[str, dict] = {}

    # Base wallet stats
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                address,
                tx_count,
                total_volume_sol,
                EXTRACT(EPOCH FROM (last_seen - first_seen)) AS lifespan_secs,
                CASE
                    WHEN EXTRACT(EPOCH FROM (last_seen - first_seen)) > 0
                    THEN tx_count::float / EXTRACT(EPOCH FROM (last_seen - first_seen))
                    ELSE tx_count::float
                END AS txs_per_sec
            FROM wallets
        """)
        for row in cur.fetchall():
            features[row["address"]] = {
                "tx_count":        row["tx_count"],
                "volume_sol":      float(row["total_volume_sol"] or 0),
                "lifespan_secs":   float(row["lifespan_secs"] or 0),
                "txs_per_sec":     float(row["txs_per_sec"] or 0),
                "unique_counterparties": 0,
                "defi_txs":        0,
                "jito_txs":        0,
                "circular_pairs":  0,
            }

    log.info(f"Loaded base stats for {len(features):,} wallets")

    # Unique counterparties per sender
    with conn.cursor() as cur:
        cur.execute("""
            SELECT from_wallet, COUNT(DISTINCT to_wallet) AS uniq
            FROM transactions
            GROUP BY from_wallet
        """)
        for addr, uniq in cur.fetchall():
            if addr in features:
                features[addr]["unique_counterparties"] = uniq

    log.info("Loaded counterparty counts")

    # DeFi program interactions
    defi_ids_sql = "','".join(DEFI_PROGRAM_IDS)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT from_wallet, COUNT(*) AS defi_txs
            FROM transactions
            WHERE program_id IN ('{defi_ids_sql}')
            GROUP BY from_wallet
        """)
        for addr, count in cur.fetchall():
            if addr in features:
                features[addr]["defi_txs"] = count

    log.info("Loaded DeFi interaction counts")

    # Jito (MEV) program interactions
    mev_ids_sql = "','".join(MEV_PROGRAM_IDS)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT from_wallet, COUNT(*) AS jito_txs
            FROM transactions
            WHERE program_id IN ('{mev_ids_sql}')
            GROUP BY from_wallet
        """)
        for addr, count in cur.fetchall():
            if addr in features:
                features[addr]["jito_txs"] = count

    log.info("Loaded Jito interaction counts")

    # Circular transaction pairs (wash trading signal)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT t1.from_wallet, COUNT(*) AS pairs
            FROM transactions t1
            JOIN transactions t2
              ON t1.from_wallet = t2.to_wallet
             AND t1.to_wallet   = t2.from_wallet
            GROUP BY t1.from_wallet
            HAVING COUNT(*) >= %s
        """, (THRESHOLDS["wash_min_pairs"],))
        for addr, pairs in cur.fetchall():
            if addr in features:
                features[addr]["circular_pairs"] = pairs

    log.info("Loaded circular transaction counts")
    return features


# ── Classifier ─────────────────────────────────────────────────────────────────

def classify(address: str, f: dict) -> tuple[str, str]:
    """
    Apply rules in priority order.
    Returns (label, entity_type).
    """
    t = THRESHOLDS

    # 1. Known address lookup (highest confidence)
    if address in KNOWN_ADDRESSES:
        return KNOWN_ADDRESSES[address]

    # 2. MEV bot — high tx frequency OR Jito interaction
    if (
        f["txs_per_sec"] >= t["mev_txs_per_sec"]
        or f["jito_txs"] >= t["mev_jito_min_txs"]
    ):
        return ("mev_bot", "mev_bot")

    # 3. Wash bot — circular transactions
    if f["circular_pairs"] >= t["wash_min_pairs"]:
        return ("wash_bot", "wash_bot")

    # 4. DeFi protocol interaction
    if f["defi_txs"] >= t["defi_min_txs"]:
        return ("defi_user", "defi_protocol")

    # 5. Exchange (behavioral) — high counterparty count + volume
    if (
        f["unique_counterparties"] >= t["exchange_min_counterparties"]
        and f["volume_sol"] >= t["exchange_min_volume_sol"]
    ):
        return ("exchange_hot_wallet", "exchange")

    # 6. Whale — high volume, low tx frequency
    if (
        f["volume_sol"] >= t["whale_min_volume_sol"]
        and f["tx_count"] <= t["whale_max_tx_count"]
    ):
        return ("whale", "whale")

    # 7. Unknown
    return ("unknown", "unknown")


# ── Bulk update ────────────────────────────────────────────────────────────────

def update_labels(conn, results: list[tuple[str, str, str]], dry_run: bool) -> int:
    if not results:
        return 0
    if dry_run:
        log.info(f"[DRY RUN] Would update {len(results):,} wallets")
        return len(results)

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(
            cur,
            """
            UPDATE wallets
            SET label = %s, entity_type = %s
            WHERE address = %s
            """,
            results,
            page_size=500,
        )
    conn.commit()
    return len(results)


# ── Callable entry point (for import by scheduler) ────────────────────────────

def run(conn) -> int:
    """
    Label all wallets using a single SQL UPDATE + CTE.
    No wallet data is loaded into Python — everything stays in Postgres.
    """
    t = THRESHOLDS

    # Build known-address CASE arms
    known_label_cases  = "\n            ".join(
        f"WHEN wallets.address = '{addr}' THEN '{lbl}'"
        for addr, (lbl, _) in KNOWN_ADDRESSES.items()
    )
    known_etype_cases  = "\n            ".join(
        f"WHEN wallets.address = '{addr}' THEN '{et}'"
        for addr, (_, et) in KNOWN_ADDRESSES.items()
    )

    defi_ids = "','".join(DEFI_PROGRAM_IDS)
    mev_ids  = "','".join(MEV_PROGRAM_IDS)

    sql = f"""
    WITH
    defi_counts AS (
        SELECT from_wallet, COUNT(*) AS defi_txs
        FROM transactions
        WHERE success = true AND program_id IN ('{defi_ids}')
        GROUP BY from_wallet
    ),
    jito_counts AS (
        SELECT from_wallet, COUNT(*) AS jito_txs
        FROM transactions
        WHERE success = true AND program_id IN ('{mev_ids}')
        GROUP BY from_wallet
    ),
    counterparty_counts AS (
        SELECT from_wallet, COUNT(DISTINCT to_wallet) AS uniq
        FROM transactions WHERE success = true
        GROUP BY from_wallet
    ),
    circular_counts AS (
        SELECT t1.from_wallet, COUNT(*) AS pairs
        FROM transactions t1
        JOIN transactions t2
          ON t1.from_wallet = t2.to_wallet
         AND t1.to_wallet   = t2.from_wallet
         AND t1.block_time  > NOW() - INTERVAL '48 hours'
        WHERE t1.success = true
        GROUP BY t1.from_wallet
        HAVING COUNT(*) >= {t['wash_min_pairs']}
    ),
    features AS (
        SELECT
            w.address,
            w.tx_count,
            w.total_volume_sol,
            CASE WHEN EXTRACT(EPOCH FROM (w.last_seen - w.first_seen)) > 0
                 THEN w.tx_count::float / EXTRACT(EPOCH FROM (w.last_seen - w.first_seen))
                 ELSE w.tx_count::float END              AS txs_per_sec,
            COALESCE(dc.defi_txs,  0)                   AS defi_txs,
            COALESCE(jc.jito_txs,  0)                   AS jito_txs,
            COALESCE(cc.uniq,      0)                   AS unique_counterparties,
            COALESCE(circ.pairs,   0)                   AS circular_pairs
        FROM wallets w
        LEFT JOIN defi_counts        dc   ON dc.from_wallet  = w.address
        LEFT JOIN jito_counts        jc   ON jc.from_wallet  = w.address
        LEFT JOIN counterparty_counts cc  ON cc.from_wallet  = w.address
        LEFT JOIN circular_counts    circ ON circ.from_wallet = w.address
    )
    UPDATE wallets
    SET
        label = CASE
            {known_label_cases}
            WHEN f.txs_per_sec >= {t['mev_txs_per_sec']}
              OR f.jito_txs    >= {t['mev_jito_min_txs']}       THEN 'mev_bot'
            WHEN f.circular_pairs >= {t['wash_min_pairs']}      THEN 'wash_bot'
            WHEN f.defi_txs       >= {t['defi_min_txs']}        THEN 'defi_user'
            WHEN f.unique_counterparties >= {t['exchange_min_counterparties']}
             AND f.total_volume_sol      >= {t['exchange_min_volume_sol']}  THEN 'exchange_hot_wallet'
            WHEN f.total_volume_sol >= {t['whale_min_volume_sol']}
             AND f.tx_count        <= {t['whale_max_tx_count']}  THEN 'whale'
            ELSE 'unknown'
        END,
        entity_type = CASE
            {known_etype_cases}
            WHEN f.txs_per_sec >= {t['mev_txs_per_sec']}
              OR f.jito_txs    >= {t['mev_jito_min_txs']}       THEN 'mev_bot'
            WHEN f.circular_pairs >= {t['wash_min_pairs']}      THEN 'wash_bot'
            WHEN f.defi_txs       >= {t['defi_min_txs']}        THEN 'defi_protocol'
            WHEN f.unique_counterparties >= {t['exchange_min_counterparties']}
             AND f.total_volume_sol      >= {t['exchange_min_volume_sol']}  THEN 'exchange'
            WHEN f.total_volume_sol >= {t['whale_min_volume_sol']}
             AND f.tx_count        <= {t['whale_max_tx_count']}  THEN 'whale'
            ELSE 'unknown'
        END
    FROM features f
    WHERE wallets.address = f.address
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        n = cur.rowcount
    conn.commit()
    log.info(f"Labeling complete: {n:,} wallets updated")
    return n


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EFFANT wallet labeler")
    parser.add_argument("--dry-run", action="store_true", help="Classify without writing to DB")
    parser.add_argument("--verbose", action="store_true", help="Print every classification")
    args = parser.parse_args()

    if args.dry_run:
        log.info("DRY RUN — no DB writes")

    conn = psycopg2.connect(DATABASE_URL)
    log.info("Connected to database")

    features = load_wallet_features(conn)
    log.info(f"Classifying {len(features):,} wallets...")

    # Tally results
    counts: dict[str, int] = {}
    updates: list[tuple[str, str, str]] = []  # (label, entity_type, address)

    for address, f in features.items():
        label, entity_type = classify(address, f)
        counts[label] = counts.get(label, 0) + 1
        updates.append((label, entity_type, address))

        if args.verbose:
            log.debug(
                f"{address[:20]}..  label={label:<20} "
                f"vol={f['volume_sol']:>10.4f} SOL  "
                f"tx={f['tx_count']:>5}  "
                f"tps={f['txs_per_sec']:>8.2f}  "
                f"cparty={f['unique_counterparties']:>4}  "
                f"defi={f['defi_txs']:>3}  "
                f"jito={f['jito_txs']:>3}  "
                f"circ={f['circular_pairs']:>3}"
            )

    n_updated = update_labels(conn, updates, dry_run=args.dry_run)

    log.info("=" * 50)
    log.info(f"Classification complete — {n_updated:,} wallets labeled")
    log.info("-" * 50)
    for label, count in sorted(counts.items(), key=lambda x: -x[1]):
        pct = count / len(features) * 100
        bar = "█" * int(pct / 2)
        log.info(f"  {label:<22}  {count:>5}  ({pct:5.1f}%)  {bar}")
    log.info("=" * 50)

    conn.close()


if __name__ == "__main__":
    main()
