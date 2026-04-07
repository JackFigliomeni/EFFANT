"""
Session 1 — Pull last 100 confirmed transactions from Solana mainnet via Helius RPC.
Usage: python pipeline/fetch_transactions.py
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("HELIUS_API_KEY")
if not API_KEY or API_KEY == "your_api_key_here":
    sys.exit("ERROR: Set HELIUS_API_KEY in .env")

RPC_URL = f"https://mainnet.helius-rpc.com/?api-key={API_KEY}"


def rpc(method, params):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    r = requests.post(RPC_URL, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        sys.exit(f"RPC error: {data['error']}")
    return data["result"]


def lamports_to_sol(lamports):
    return lamports / 1_000_000_000


def format_ts(unix_ts):
    if unix_ts is None:
        return "unknown"
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def get_recent_transactions(limit=100):
    slot = rpc("getSlot", [{"commitment": "finalized"}])
    print(f"Latest finalized slot: {slot}\n")

    txs = []
    current_slot = slot

    while len(txs) < limit:
        try:
            block = rpc("getBlock", [
                current_slot,
                {
                    "encoding": "json",
                    "transactionDetails": "full",
                    "maxSupportedTransactionVersion": 0,
                    "rewards": False,
                    "commitment": "finalized",
                }
            ])
            if block and block.get("transactions"):
                block_time = block.get("blockTime")
                for tx in block["transactions"]:
                    tx["blockTime"] = block_time  # inject block-level timestamp
                txs.extend(block["transactions"])
        except Exception:
            pass

        current_slot -= 1
        if slot - current_slot > 500:
            print("Searched 500 slots, stopping.")
            break

    return txs[:limit]


def summarize(tx):
    meta = tx.get("meta", {}) or {}
    transaction = tx.get("transaction", {})

    # Extract accounts
    msg = transaction.get("message", {})
    accounts = msg.get("accountKeys", [])
    if accounts and isinstance(accounts[0], dict):
        accounts = [a.get("pubkey", str(a)) for a in accounts]

    sender = accounts[0] if len(accounts) > 0 else "unknown"
    receiver = accounts[1] if len(accounts) > 1 else "unknown"

    # SOL transferred: largest positive balance increase among non-fee-payer accounts
    pre = meta.get("preBalances", [])
    post = meta.get("postBalances", [])
    sol_delta = 0.0
    if pre and post:
        # skip index 0 (fee payer); find max inflow to any account
        deltas = [lamports_to_sol(post[i] - pre[i]) for i in range(1, min(len(pre), len(post)))]
        positive = [d for d in deltas if d > 0]
        sol_delta = max(positive) if positive else 0.0

    fee = lamports_to_sol(meta.get("fee", 0))
    status = "ok" if meta.get("err") is None else "failed"
    block_time = tx.get("blockTime")

    return {
        "timestamp": format_ts(block_time),
        "sender": sender,
        "receiver": receiver,
        "sol": round(sol_delta, 9),
        "fee_sol": round(fee, 9),
        "status": status,
    }


def main():
    print("Fetching last 100 confirmed transactions from Solana mainnet...\n")
    txs = get_recent_transactions(100)

    print(f"{'#':<4} {'Timestamp':<25} {'Status':<7} {'SOL':>12} {'Fee (SOL)':>12}  Sender → Receiver")
    print("-" * 120)

    for i, tx in enumerate(txs, 1):
        s = summarize(tx)
        sender_short = s["sender"][:8] + ".." if len(s["sender"]) > 10 else s["sender"]
        receiver_short = s["receiver"][:8] + ".." if len(s["receiver"]) > 10 else s["receiver"]
        print(
            f"{i:<4} {s['timestamp']:<25} {s['status']:<7} "
            f"{s['sol']:>12.6f} {s['fee_sol']:>12.9f}  "
            f"{sender_short} → {receiver_short}"
        )

    print(f"\nTotal: {len(txs)} transactions")


if __name__ == "__main__":
    main()
