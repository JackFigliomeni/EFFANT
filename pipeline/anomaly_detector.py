"""
EFFANT — Anomaly detection engine.
Four detectors, all writing to the anomalies table.

Detectors
─────────
  1. wash_trading   — bidirectional circular flows between wallet pairs
                      within a configurable time window
  2. volume_spike   — wallet whose volume in a rolling window is N× its
                      per-period average (adapts to available data span)
  3. sandwich_attack — MEV bot co-appearing in the same block as a
                       large swap, classic front/back-run pattern
  4. whale_movement  — single wallet moving >= threshold SOL in 1 hour
                       (tiered: medium / high / critical)

Severity scale
──────────────
  low      informational, noise likely
  medium   suspicious, worth monitoring
  high     likely malicious or manipulative
  critical immediate review required

Usage
─────
  python pipeline/anomaly_detector.py [--dry-run] [--clear]
"""

import os
import sys
import logging
import argparse
from datetime import datetime, timezone, timedelta
from collections import defaultdict

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
log = logging.getLogger("effant.anomaly_detector")

# ── Severity helpers ──────────────────────────────────────────────────────────

def _sev(value: float, thresholds: list[tuple[float, str]]) -> str:
    """
    Return the severity for `value` given an ascending list of
    (threshold, severity) pairs. Returns the label of the highest
    threshold exceeded.
    """
    result = "low"
    for threshold, label in thresholds:
        if value >= threshold:
            result = label
    return result


# ── Detector 1: Wash Trading ──────────────────────────────────────────────────

WASH_WINDOW_MINUTES = 10          # circular flow must complete within this window
WASH_MIN_ROUND_TRIPS = 1          # at least this many A→B→A cycles

WASH_SEVERITY_THRESHOLDS = [
    (0.0,  "low"),
    (0.1,  "medium"),
    (1.0,  "high"),
    (10.0, "critical"),
]

def detect_wash_trading(conn) -> list[dict]:
    """
    Find wallet pairs where A sends to B AND B sends to A, with both legs
    occurring within WASH_WINDOW_MINUTES of each other.
    Reports anomalies on both wallets in each confirmed cycle.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                t_out.from_wallet  AS wallet_a,
                t_out.to_wallet    AS wallet_b,
                t_out.amount_sol   AS sol_out,
                t_in.amount_sol    AS sol_in,
                t_out.block_time   AS time_out,
                t_in.block_time    AS time_in,
                t_out.signature    AS sig_out,
                t_in.signature     AS sig_in,
                ABS(EXTRACT(EPOCH FROM (t_in.block_time - t_out.block_time))) AS gap_secs,
                t_out.amount_sol + t_in.amount_sol AS total_cycled
            FROM transactions t_out
            JOIN transactions t_in
              ON t_out.from_wallet = t_in.to_wallet
             AND t_out.to_wallet   = t_in.from_wallet
             AND t_out.success = true
             AND t_in.success  = true
             AND ABS(EXTRACT(EPOCH FROM (t_in.block_time - t_out.block_time)))
                 <= %s
            WHERE t_out.success = true
              AND t_out.from_wallet < t_out.to_wallet  -- deduplicate A↔B vs B↔A
        """, (WASH_WINDOW_MINUTES * 60,))
        rows = cur.fetchall()

    anomalies = []
    seen: set[tuple[str, str]] = set()

    for r in rows:
        pair_key = (r["wallet_a"], r["wallet_b"])
        if pair_key in seen:
            continue
        seen.add(pair_key)

        total = float(r["total_cycled"])
        gap_secs = float(r["gap_secs"])
        severity = _sev(total, WASH_SEVERITY_THRESHOLDS)

        desc = (
            f"Circular flow detected: {r['wallet_a'][:12]}… ↔ {r['wallet_b'][:12]}…  "
            f"| Outbound: {float(r['sol_out']):.4f} SOL  "
            f"| Return: {float(r['sol_in']):.4f} SOL  "
            f"| Total cycled: {total:.4f} SOL  "
            f"| Gap: {gap_secs:.1f}s  "
            f"| Window: {WASH_WINDOW_MINUTES}m"
        )

        for wallet in (r["wallet_a"], r["wallet_b"]):
            anomalies.append({
                "wallet_address": wallet,
                "anomaly_type":   "wash_trading",
                "severity":       severity,
                "description":    desc,
            })

    log.info(f"[wash_trading]    {len(seen)} pairs → {len(anomalies)} anomaly records")
    return anomalies


# ── Detector 2: Volume Spike ──────────────────────────────────────────────────

SPIKE_MULTIPLIER   = 2.0    # peak window must be this many × the baseline rate
SPIKE_WINDOW_SECS  = 3600   # rolling window for peak (1 hour)
SPIKE_MIN_SOL      = 0.01   # ignore dust

SPIKE_SEVERITY_THRESHOLDS = [
    (SPIKE_MULTIPLIER,       "medium"),
    (SPIKE_MULTIPLIER * 2,   "high"),
    (SPIKE_MULTIPLIER * 4,   "critical"),
]

def detect_volume_spikes(conn) -> list[dict]:
    """
    For each wallet, compute per-period volume and flag those whose peak
    period is >= SPIKE_MULTIPLIER × their average period volume.

    With < 1 hour of data: splits the window into 1-minute buckets and
    compares peak minute to average-minute rate.
    With >= 1 hour of data: compares last-hour volume to the hourly rate
    computed from all available history.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Data span
        cur.execute("""
            SELECT
                MIN(block_time) AS earliest,
                MAX(block_time) AS latest,
                EXTRACT(EPOCH FROM (MAX(block_time) - MIN(block_time))) AS span_secs
            FROM transactions WHERE success = true
        """)
        meta = cur.fetchone()
        span_secs = float(meta["span_secs"] or 0)
        earliest  = meta["earliest"]
        latest    = meta["latest"]

    # Choose bucket size based on available data
    if span_secs >= SPIKE_WINDOW_SECS:
        bucket_sql   = "DATE_TRUNC('hour', block_time)"
        bucket_label = "hour"
    else:
        bucket_sql   = "DATE_TRUNC('minute', block_time)"
        bucket_label = "minute"

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT
                from_wallet,
                {bucket_sql}              AS bucket,
                SUM(amount_sol)           AS bucket_vol,
                COUNT(*)                  AS bucket_txs
            FROM transactions
            WHERE success = true
              AND amount_sol >= %s
            GROUP BY from_wallet, {bucket_sql}
        """, (SPIKE_MIN_SOL,))
        rows = cur.fetchall()

    # Group by wallet → list of (bucket, vol)
    wallet_buckets: dict[str, list[float]] = defaultdict(list)
    wallet_peak: dict[str, tuple[float, str]] = {}  # wallet → (peak_vol, bucket_str)

    for r in rows:
        wallet = r["from_wallet"]
        vol    = float(r["bucket_vol"])
        wallet_buckets[wallet].append(vol)
        bucket_str = str(r["bucket"])
        if wallet not in wallet_peak or vol > wallet_peak[wallet][0]:
            wallet_peak[wallet] = (vol, bucket_str)

    anomalies = []

    for wallet, vols in wallet_buckets.items():
        if len(vols) < 1:
            continue
        avg_vol  = sum(vols) / len(vols)
        peak_vol, peak_bucket = wallet_peak[wallet]

        if avg_vol < SPIKE_MIN_SOL:
            continue

        ratio = peak_vol / avg_vol

        if ratio < SPIKE_MULTIPLIER:
            continue

        severity = _sev(ratio, SPIKE_SEVERITY_THRESHOLDS)

        desc = (
            f"Volume spike: peak {bucket_label} = {peak_vol:.4f} SOL  "
            f"| Avg {bucket_label} = {avg_vol:.4f} SOL  "
            f"| Ratio = {ratio:.1f}×  "
            f"| Peak bucket: {peak_bucket}  "
            f"| Data span: {span_secs/60:.1f} min  "
            f"| Note: {'full 7d baseline' if span_secs >= 604800 else 'short window — expand with more ingestion'}"
        )

        anomalies.append({
            "wallet_address": wallet,
            "anomaly_type":   "volume_spike",
            "severity":       severity,
            "description":    desc,
        })

    log.info(f"[volume_spike]    {len(anomalies)} anomalies (threshold {SPIKE_MULTIPLIER}×, bucket={bucket_label})")
    return anomalies


# ── Detector 3: Sandwich Attack ───────────────────────────────────────────────

SANDWICH_MIN_VICTIM_SOL = 1.0    # minimum victim transaction size
SANDWICH_MEV_LABEL      = "mev_bot"

# Raydium / Orca / Jupiter program IDs — victim must interact with one
SANDWICH_DEX_PROGRAMS = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",  # Raydium AMM v4
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",  # Raydium CLMM
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3sFjJ6a",   # Orca Whirlpool
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",  # Orca (legacy)
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",   # Jupiter v6
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",   # Jupiter v4
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",  # Serum v3
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",   # OpenBook
}

# When DEX program is unknown, allow flagging any large tx co-located with MEV
SANDWICH_ALLOW_UNKNOWN_PROGRAM = True

SANDWICH_SEVERITY_THRESHOLDS = [
    (SANDWICH_MIN_VICTIM_SOL, "medium"),
    (10.0,                    "high"),
    (100.0,                   "critical"),
]

def detect_sandwich_attacks(conn) -> list[dict]:
    """
    Sandwich pattern: an MEV bot wallet appears in the same block as a
    large-value transaction from a non-bot wallet, on a known DEX program
    (or any program if SANDWICH_ALLOW_UNKNOWN_PROGRAM is True).

    Both the victim and the bot are flagged.
    """
    dex_ids_sql = "','".join(SANDWICH_DEX_PROGRAMS)

    program_filter = (
        f"(t_victim.program_id IN ('{dex_ids_sql}') OR t_victim.program_id IS NOT NULL)"
        if SANDWICH_ALLOW_UNKNOWN_PROGRAM
        else f"t_victim.program_id IN ('{dex_ids_sql}')"
    )

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT DISTINCT
                t_victim.from_wallet  AS victim_wallet,
                t_victim.amount_sol   AS victim_sol,
                t_victim.block_time   AS block_time,
                t_victim.program_id   AS program_id,
                t_victim.signature    AS victim_sig,
                t_bot.from_wallet     AS bot_wallet
            FROM transactions t_victim
            JOIN transactions t_bot
              ON t_bot.block_time    = t_victim.block_time
             AND t_bot.from_wallet  != t_victim.from_wallet
             AND t_bot.success       = true
            JOIN wallets w_bot
              ON w_bot.address = t_bot.from_wallet
             AND w_bot.label   = %s
            WHERE t_victim.success    = true
              AND t_victim.amount_sol >= %s
              AND {program_filter}
              AND NOT EXISTS (
                SELECT 1 FROM wallets w_v
                WHERE w_v.address = t_victim.from_wallet
                  AND w_v.label = %s
              )
            ORDER BY t_victim.amount_sol DESC
        """, (SANDWICH_MEV_LABEL, SANDWICH_MIN_VICTIM_SOL, SANDWICH_MEV_LABEL))
        rows = cur.fetchall()

    # Deduplicate: one anomaly per victim (worst-case bot match)
    # and one per bot (worst-case victim match)
    victim_best: dict[str, dict] = {}   # victim_wallet → worst row
    bot_best:    dict[str, dict] = {}   # bot_wallet    → worst row

    for r in rows:
        v = r["victim_wallet"]
        b = r["bot_wallet"]
        sol = float(r["victim_sol"])
        if v not in victim_best or sol > float(victim_best[v]["victim_sol"]):
            victim_best[v] = r
        if b not in bot_best   or sol > float(bot_best[b]["victim_sol"]):
            bot_best[b] = r

    anomalies = []

    for v, r in victim_best.items():
        victim_sol = float(r["victim_sol"])
        severity   = _sev(victim_sol, SANDWICH_SEVERITY_THRESHOLDS)
        prog       = r["program_id"] or "unknown"
        prog_short = prog[:12] + "…" if len(prog) > 12 else prog

        # Count how many bots were in this block
        bots_in_block = sum(1 for row in rows if row["victim_wallet"] == v)

        desc = (
            f"Sandwich attack: {bots_in_block} MEV bot(s) co-located with "
            f"{victim_sol:.4f} SOL swap  "
            f"| Block: {r['block_time']}  "
            f"| Program: {prog_short}  "
            f"| Worst bot: {r['bot_wallet'][:12]}…  "
            f"| Sig: {str(r['victim_sig'])[:20]}…"
        )
        anomalies.append({
            "wallet_address": v,
            "anomaly_type":   "sandwich_attack",
            "severity":       severity,
            "description":    desc,
        })

    for b, r in bot_best.items():
        victim_sol = float(r["victim_sol"])
        severity   = _sev(victim_sol, SANDWICH_SEVERITY_THRESHOLDS)
        victims_targeted = sum(1 for row in rows if row["bot_wallet"] == b)
        desc = (
            f"Sandwich perpetrator: bot targeted {victims_targeted} victim(s)  "
            f"| Largest victim tx: {victim_sol:.4f} SOL "
            f"by {r['victim_wallet'][:12]}…  "
            f"| Block: {r['block_time']}"
        )
        anomalies.append({
            "wallet_address": b,
            "anomaly_type":   "sandwich_attack",
            "severity":       severity,
            "description":    desc,
        })

    unique_victims = len(victim_best)
    unique_bots    = len(bot_best)
    log.info(
        f"[sandwich_attack] {unique_victims + unique_bots} events "
        f"({unique_victims} victims, {unique_bots} bots) "
        f"→ {len(anomalies)} anomaly records"
    )
    return anomalies


# ── Detector 4: Whale Movement ────────────────────────────────────────────────

WHALE_WINDOW_HOURS = 1

# Rolling-window thresholds (SOL moved within WHALE_WINDOW_HOURS)
WHALE_HOURLY_THRESHOLDS = [
    (10,    "medium"),
    (100,   "high"),
    (1_000, "critical"),
]

# Single-transaction thresholds (catches large single moves even without history)
WHALE_SINGLE_TX_THRESHOLDS = [
    (5,   "medium"),
    (50,  "high"),
    (200, "critical"),
]

def detect_whale_movements(conn) -> list[dict]:
    """
    Two sub-detectors:

    A) Rolling 1-hour window: flag any wallet whose total outbound volume
       in any WHALE_WINDOW_HOURS period exceeds a threshold.

    B) Single transaction: flag any individual tx above a threshold.
       (Catches large moves even with sparse data.)
    """
    anomalies = []

    # ── A: rolling hourly window ──────────────────────────────────────────
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                from_wallet,
                DATE_TRUNC('hour', block_time) AS hour_bucket,
                SUM(amount_sol)                AS hour_vol,
                COUNT(*)                       AS hour_txs,
                MAX(amount_sol)                AS max_single_tx
            FROM transactions
            WHERE success = true AND amount_sol > 0
            GROUP BY from_wallet, DATE_TRUNC('hour', block_time)
        """)
        hourly_rows = cur.fetchall()

    seen_hourly: set[tuple[str, str]] = set()
    for r in hourly_rows:
        hour_vol = float(r["hour_vol"])
        threshold_met = next(
            (label for thresh, label in reversed(WHALE_HOURLY_THRESHOLDS) if hour_vol >= thresh),
            None
        )
        if not threshold_met:
            continue

        key = (r["from_wallet"], str(r["hour_bucket"]))
        if key in seen_hourly:
            continue
        seen_hourly.add(key)

        desc = (
            f"Whale movement: {hour_vol:,.4f} SOL moved in 1h window  "
            f"| Bucket: {r['hour_bucket']}  "
            f"| Transactions: {r['hour_txs']}  "
            f"| Largest single tx: {float(r['max_single_tx']):,.4f} SOL"
        )

        anomalies.append({
            "wallet_address": r["from_wallet"],
            "anomaly_type":   "whale_movement",
            "severity":       threshold_met,
            "description":    desc,
        })

    # ── B: single large transaction ───────────────────────────────────────
    single_min = min(t for t, _ in WHALE_SINGLE_TX_THRESHOLDS)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT signature, from_wallet, to_wallet,
                   amount_sol, block_time
            FROM transactions
            WHERE success = true AND amount_sol >= %s
            ORDER BY amount_sol DESC
        """, (single_min,))
        single_rows = cur.fetchall()

    seen_single: set[str] = set()
    for r in single_rows:
        sig = r["signature"]
        if sig in seen_single:
            continue
        seen_single.add(sig)

        amount = float(r["amount_sol"])
        threshold_met = next(
            (label for thresh, label in reversed(WHALE_SINGLE_TX_THRESHOLDS) if amount >= thresh),
            None
        )
        if not threshold_met:
            continue

        desc = (
            f"Large single transaction: {amount:,.4f} SOL  "
            f"| From: {r['from_wallet'][:12]}…  "
            f"→ To: {r['to_wallet'][:12]}…  "
            f"| Time: {r['block_time']}  "
            f"| Sig: {sig[:20]}…"
        )

        anomalies.append({
            "wallet_address": r["from_wallet"],
            "anomaly_type":   "whale_movement",
            "severity":       threshold_met,
            "description":    desc,
        })

    log.info(
        f"[whale_movement]  "
        f"{len(seen_hourly)} hourly windows + {len(seen_single)} single txs "
        f"→ {len(anomalies)} anomaly records"
    )
    return anomalies


# ── DB write ──────────────────────────────────────────────────────────────────

INSERT_ANOMALY = """
    INSERT INTO anomalies (wallet_address, anomaly_type, severity, detected_at, description)
    SELECT %(wallet_address)s, %(anomaly_type)s, %(severity)s, NOW(), %(description)s
    WHERE NOT EXISTS (
        SELECT 1 FROM anomalies
        WHERE wallet_address = %(wallet_address)s
          AND anomaly_type   = %(anomaly_type)s
          AND detected_at   > NOW() - INTERVAL '10 minutes'
    )
"""

def write_anomalies(conn, anomalies: list[dict], dry_run: bool) -> int:
    if not anomalies:
        return 0
    if dry_run:
        log.info(f"[DRY RUN] Would insert {len(anomalies)} anomaly records")
        return len(anomalies)

    # Filter out wallet addresses not in wallets table to avoid FK violation
    with conn.cursor() as cur:
        cur.execute("SELECT address FROM wallets")
        known = {row[0] for row in cur.fetchall()}

    valid = [a for a in anomalies if a["wallet_address"] in known]
    skipped = len(anomalies) - len(valid)
    if skipped:
        log.warning(f"Skipped {skipped} anomalies — wallet not in wallets table")

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, INSERT_ANOMALY, valid, page_size=200)
    conn.commit()
    return len(valid)


# ── Reporting ─────────────────────────────────────────────────────────────────

SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
SEVERITY_ICON  = {"low": "·", "medium": "▲", "high": "▲▲", "critical": "⚑"}

def print_report(anomalies: list[dict]):
    if not anomalies:
        log.info("No anomalies detected.")
        return

    by_type: dict[str, list[dict]] = defaultdict(list)
    by_sev:  dict[str, int]        = defaultdict(int)

    for a in anomalies:
        by_type[a["anomaly_type"]].append(a)
        by_sev[a["severity"]] += 1

    log.info("=" * 70)
    log.info(f"ANOMALY REPORT — {len(anomalies)} total records")
    log.info("-" * 70)

    for atype, records in sorted(by_type.items()):
        sev_counts = defaultdict(int)
        for r in records:
            sev_counts[r["severity"]] += 1
        sev_str = "  ".join(
            f"{SEVERITY_ICON[s]}×{sev_counts[s]}"
            for s in ("critical", "high", "medium", "low")
            if sev_counts[s]
        )
        log.info(f"  {atype:<20}  {len(records):>4} records   {sev_str}")

    log.info("-" * 70)
    for sev in ("critical", "high", "medium", "low"):
        if by_sev[sev]:
            log.info(f"  {SEVERITY_ICON[sev]:<4} {sev:<10} {by_sev[sev]:>4}")

    log.info("")
    log.info("Top anomalies by severity:")
    top = sorted(anomalies, key=lambda x: -SEVERITY_ORDER[x["severity"]])[:10]
    for a in top:
        icon = SEVERITY_ICON[a["severity"]]
        log.info(f"  {icon} [{a['anomaly_type']:<20}] {a['wallet_address'][:16]}…")
        log.info(f"      {a['description'][:100]}…" if len(a["description"]) > 100 else f"      {a['description']}")
    log.info("=" * 70)


# ── Callable entry point (for import by scheduler) ────────────────────────────

def run(conn) -> int:
    """Run all detectors against an open DB connection. Returns anomaly count."""
    all_anomalies: list[dict] = []
    all_anomalies.extend(detect_wash_trading(conn))
    all_anomalies.extend(detect_volume_spikes(conn))
    all_anomalies.extend(detect_sandwich_attacks(conn))
    all_anomalies.extend(detect_whale_movements(conn))
    n = write_anomalies(conn, all_anomalies, dry_run=False)
    log.info(f"Anomaly run complete: {n} records written")
    return n


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EFFANT anomaly detector")
    parser.add_argument("--dry-run", action="store_true", help="Detect without writing to DB")
    parser.add_argument("--clear",   action="store_true", help="Delete existing anomalies before running")
    parser.add_argument(
        "--detectors", nargs="+",
        choices=["wash_trading", "volume_spike", "sandwich_attack", "whale_movement", "all"],
        default=["all"],
        help="Which detectors to run (default: all)",
    )
    args = parser.parse_args()

    run_all = "all" in args.detectors
    active  = set(args.detectors) if not run_all else {"wash_trading", "volume_spike", "sandwich_attack", "whale_movement"}

    conn = psycopg2.connect(DATABASE_URL)
    log.info("Connected to database")

    if args.clear and not args.dry_run:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM anomalies")
        conn.commit()
        log.info("Cleared existing anomalies")

    all_anomalies: list[dict] = []

    if "wash_trading" in active:
        all_anomalies.extend(detect_wash_trading(conn))

    if "volume_spike" in active:
        all_anomalies.extend(detect_volume_spikes(conn))

    if "sandwich_attack" in active:
        all_anomalies.extend(detect_sandwich_attacks(conn))

    if "whale_movement" in active:
        all_anomalies.extend(detect_whale_movements(conn))

    n_written = write_anomalies(conn, all_anomalies, dry_run=args.dry_run)
    log.info(f"Wrote {n_written} anomaly records to database")

    print_report(all_anomalies)
    conn.close()


if __name__ == "__main__":
    main()
