#!/usr/bin/env python3
"""
EFFANT live anomaly terminal feed.
Usage:  python3 scripts/feed.py

Polls /v1/anomalies every 8s using a rolling 60-second 'since' window.
Shows timestamps in Eastern Time.  No emojis.
"""

import itertools
import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import requests

# ── Config ────────────────────────────────────────────────────────────────────
API_BASE  = "https://api.effant.tech"
API_KEY   = "eff_sk_jxvNyqW5NtXSn0ypJYTZS3oRK8MJNZo0-TuX0V_Rw5o"
POLL_SEC  = 8
LIMIT     = 5
WINDOW_S  = 600     # show anomalies detected in the last 10 minutes

ET_OFFSET = timedelta(hours=-4)   # EDT (UTC-4) — switches to -5 in Nov

HEADERS = {
    "X-API-Key": API_KEY,
    "Accept":    "application/json",
}

# Cycle through combos so feed shows varied data types
FILTER_COMBOS = itertools.cycle([
    {"anomaly_type": "whale_movement",  "severity": "critical"},
    {"anomaly_type": "whale_movement",  "severity": "high"},
    {"anomaly_type": "volume_spike",    "severity": "critical"},
    {"anomaly_type": "volume_spike",    "severity": "high"},
    {"anomaly_type": "wash_trading",    "severity": "critical"},
    {"anomaly_type": "wash_trading",    "severity": "high"},
    {},                                                          # all types
    {"anomaly_type": "sandwich_attack"},
])

seen_ids: set[int] = set()


# ── ANSI colours ──────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
DIM    = "\033[2m"
ORANGE = "\033[38;5;208m"

SEV_COLOR = {
    "critical": RED,
    "high":     ORANGE,
    "medium":   YELLOW,
    "low":      DIM,
}

TYPE_LABEL = {
    "whale_movement":  "WHALE MOVEMENT",
    "volume_spike":    "VOLUME SPIKE",
    "wash_trading":    "WASH TRADING",
    "sandwich_attack": "SANDWICH ATTACK",
}


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def to_et(dt: datetime) -> datetime:
    return dt.astimezone(timezone(ET_OFFSET))


def fmt_ts(ts_str: str) -> str:
    """Return 'HH:MM:SS ET' in Eastern Time."""
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return to_et(dt).strftime("%H:%M:%S ET")
    except Exception:
        return ts_str


def since_str() -> str:
    """ISO timestamp for WINDOW_S seconds ago, URL-safe (Z suffix)."""
    t = utc_now() - timedelta(seconds=WINDOW_S)
    return t.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def fetch_anomalies(params: dict) -> list[dict]:
    p = dict(params)
    p["limit"] = LIMIT
    p["since"] = since_str()
    url = f"{API_BASE}/v1/anomalies?" + urllib.parse.urlencode(p)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        body = r.json()
        data = body.get("data", [])
        if isinstance(data, dict):
            data = data.get("records", [])
        return data if isinstance(data, list) else []
    except requests.exceptions.Timeout:
        print(f"{DIM}  timeout -- retrying...{RESET}")
        return []
    except Exception as e:
        print(f"{DIM}  {e}{RESET}")
        return []


def fetch_wallet(address: str) -> dict:
    try:
        r = requests.get(f"{API_BASE}/v1/wallets/{address}", headers=HEADERS, timeout=15)
        if r.ok:
            return r.json().get("data", {})
    except Exception:
        pass
    return {}


def print_anomaly(a: dict) -> None:
    sev    = a.get("severity", "?")
    atype  = a.get("anomaly_type", "?")
    wallet = a.get("wallet_address", "?")
    ts     = fmt_ts(a.get("detected_at", ""))
    desc   = a.get("description", "")
    wlabel = a.get("wallet_label") or ""

    color = SEV_COLOR.get(sev, "")
    label = TYPE_LABEL.get(atype, atype.upper())

    print(f"\n{color}{BOLD}{'─'*68}{RESET}")
    print(f"{color}{BOLD}  {label}   [{sev.upper()}]{RESET}")
    print(f"  {BOLD}Wallet:{RESET}   {CYAN}{wallet}{RESET}")
    print(f"  {BOLD}Detected:{RESET} {ts}")

    if wlabel and wlabel.lower() not in ("unknown", ""):
        print(f"  {BOLD}Label:{RESET}    {GREEN}{wlabel}{RESET}")
    else:
        w = fetch_wallet(wallet)
        if w:
            label_str = w.get("label") or w.get("entity_name") or ""
            tier_str  = w.get("tier") or w.get("entity_type") or ""
            if label_str and label_str.lower() not in ("unknown", ""):
                print(f"  {BOLD}Label:{RESET}    {GREEN}{label_str}{RESET}" +
                      (f"  ({tier_str})" if tier_str else ""))

    if desc:
        words, line, lines = desc.split(), "", []
        for w_ in words:
            if len(line) + len(w_) + 1 > 64:
                lines.append(line)
                line = w_
            else:
                line = f"{line} {w_}".strip()
        if line:
            lines.append(line)
        print(f"  {BOLD}Detail:{RESET}   {lines[0]}")
        for l in lines[1:]:
            print(f"            {l}")


def banner() -> None:
    now_et = to_et(utc_now()).strftime("%H:%M:%S ET")
    print(f"""
{BOLD}{CYAN}+------------------------------------------------------------------+
|       EFFANT  .  Solana Intelligence  .  Live Anomaly Feed       |
|       {API_BASE:<58} |
|       Started {now_et:<51} |
+------------------------------------------------------------------+{RESET}
Press Ctrl+C to stop.
""")


def main() -> None:
    banner()
    while True:
        params = next(FILTER_COMBOS)
        tag    = ", ".join(f"{k}={v}" for k, v in params.items()) if params else "all"

        now_et = to_et(utc_now()).strftime("%H:%M:%S")
        sys.stdout.write(f"{DIM}[{now_et} ET] polling ({tag})...{RESET}\r")
        sys.stdout.flush()

        records = fetch_anomalies(params)
        new = [r for r in records if r.get("id") not in seen_ids]

        if new:
            for a in new:
                seen_ids.add(a["id"])
                print_anomaly(a)

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{DIM}Feed stopped.{RESET}")
