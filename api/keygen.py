"""
EFFANT — API key management CLI.

Commands
────────
  generate  Create and register a new API key
  list      Show all keys for an email (or all keys)
  revoke    Deactivate a key by its prefix
  reset     Zero out calls_today for a key (manual daily reset)

Usage examples
──────────────
  python api/keygen.py generate --email jack@effant.io --tier pro
  python api/keygen.py generate --email demo@effant.io --tier starter
  python api/keygen.py list --email jack@effant.io
  python api/keygen.py list
  python api/keygen.py revoke --prefix eff_sk_a1b2c3
  python api/keygen.py reset --prefix eff_sk_a1b2c3
"""

import argparse
import hashlib
import os
import secrets
import sys
from datetime import datetime, timezone, timedelta

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL not set in .env")

TIER_LIMITS = {
    "starter":   10_000,
    "pro":      500_000,
}

KEY_PREFIX  = "eff_sk_"
KEY_BYTES   = 32          # 256 bits of entropy → 43-char base64url string


def _conn():
    return psycopg2.connect(DATABASE_URL)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _next_midnight_utc() -> datetime:
    now = datetime.now(tz=timezone.utc)
    return (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_generate(email: str, tier: str) -> None:
    tier = tier.lower()
    if tier not in TIER_LIMITS:
        sys.exit(f"ERROR: tier must be one of {list(TIER_LIMITS)}")

    # Generate a cryptographically random key with a readable prefix
    raw_key = KEY_PREFIX + secrets.token_urlsafe(KEY_BYTES)
    key_hash = _hash(raw_key)
    limit    = TIER_LIMITS[tier]
    reset_at = _next_midnight_utc()

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO api_keys
                    (key_hash, customer_email, tier, calls_today, calls_limit,
                     created_at, reset_at, active)
                VALUES (%s, %s, %s, 0, %s, NOW(), %s, TRUE)
            """, (key_hash, email, tier, limit, reset_at))
        conn.commit()
    finally:
        conn.close()

    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║          EFFANT API KEY GENERATED — SAVE THIS NOW        ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  Key    : {raw_key}")
    print(f"  Email  : {email}")
    print(f"  Tier   : {tier}")
    print(f"  Limit  : {limit:,} calls/day")
    print(f"  Resets : {reset_at.strftime('%Y-%m-%d %H:%M UTC')}")
    print()
    print("  Usage:  curl -H 'X-API-Key: <key>' http://localhost:8000/health")
    print()
    print("  ⚠  This key is shown ONCE. Store it securely — only its")
    print("     SHA-256 hash is kept in the database.")
    print()


def cmd_list(email: str | None) -> None:
    conn = _conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if email:
                cur.execute("""
                    SELECT customer_email, tier, calls_today, calls_limit,
                           active, created_at, last_used_at,
                           LEFT(key_hash, 12) AS hash_prefix
                    FROM api_keys
                    WHERE customer_email = %s
                    ORDER BY created_at DESC
                """, (email,))
            else:
                cur.execute("""
                    SELECT customer_email, tier, calls_today, calls_limit,
                           active, created_at, last_used_at,
                           LEFT(key_hash, 12) AS hash_prefix
                    FROM api_keys
                    ORDER BY created_at DESC
                """)
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        print("No API keys found.")
        return

    print()
    print(f"{'Email':<28} {'Tier':<10} {'Calls':<14} {'Active':<8} {'Hash prefix':<14} {'Last used'}")
    print("─" * 100)
    for r in rows:
        used_pct  = f"{r['calls_today']:>6,}/{r['calls_limit']:<7,}"
        last_used = r["last_used_at"].strftime("%Y-%m-%d %H:%M") if r["last_used_at"] else "never"
        status    = "yes" if r["active"] else "no"
        print(
            f"{r['customer_email']:<28} {r['tier']:<10} {used_pct:<14} "
            f"{status:<8} {r['hash_prefix']+'…':<14} {last_used}"
        )
    print()


def cmd_revoke(prefix: str) -> None:
    """Deactivate all keys whose hash starts with `prefix`."""
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE api_keys SET active = FALSE
                WHERE key_hash LIKE %s
                RETURNING customer_email, tier
            """, (prefix + "%",))
            rows = cur.fetchall()
        conn.commit()
    finally:
        conn.close()

    if not rows:
        print(f"No keys found matching hash prefix '{prefix}'.")
    else:
        for email, tier in rows:
            print(f"Revoked key for {email} ({tier})")


def cmd_reset(prefix: str) -> None:
    """Zero out calls_today for keys matching hash prefix."""
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE api_keys SET calls_today = 0
                WHERE key_hash LIKE %s
                RETURNING customer_email, tier
            """, (prefix + "%",))
            rows = cur.fetchall()
        conn.commit()
    finally:
        conn.close()

    if not rows:
        print(f"No keys found matching hash prefix '{prefix}'.")
    else:
        for email, tier in rows:
            print(f"Reset calls_today → 0 for {email} ({tier})")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="EFFANT API key management",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # generate
    p_gen = sub.add_parser("generate", help="Create a new API key")
    p_gen.add_argument("--email", required=True, help="Customer email address")
    p_gen.add_argument("--tier",  required=True, choices=list(TIER_LIMITS),
                       help="Access tier")

    # list
    p_list = sub.add_parser("list", help="List API keys")
    p_list.add_argument("--email", default=None, help="Filter by email (omit for all)")

    # revoke
    p_rev = sub.add_parser("revoke", help="Deactivate a key by hash prefix")
    p_rev.add_argument("--prefix", required=True, help="First N chars of key_hash")

    # reset
    p_rst = sub.add_parser("reset", help="Reset calls_today to 0")
    p_rst.add_argument("--prefix", required=True, help="First N chars of key_hash")

    args = parser.parse_args()

    if args.command == "generate":
        cmd_generate(args.email, args.tier)
    elif args.command == "list":
        cmd_list(args.email)
    elif args.command == "revoke":
        cmd_revoke(args.prefix)
    elif args.command == "reset":
        cmd_reset(args.prefix)


if __name__ == "__main__":
    main()
