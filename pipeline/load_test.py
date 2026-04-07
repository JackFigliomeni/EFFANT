"""
EFFANT — Load test: 100 concurrent requests, before/after caching comparison.

Usage:
    python pipeline/load_test.py --key <api_key> [--host http://localhost:8000]
    python pipeline/load_test.py --key <api_key> --flush   # flush Redis between rounds
"""

import argparse
import asyncio
import statistics
import sys
import time

import httpx


ENDPOINTS = [
    ("/v1/anomalies?limit=100",                          "anomalies (100)"),
    ("/v1/clusters?limit=50",                            "clusters  (50) "),
    ("/v1/wallet/6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix", "wallet profile"),
    ("/v1/flows?min_sol=100",                            "flows     (100 SOL)"),
    ("/v1/health",                                       "/v1/health     "),
]

CONCURRENCY = 100
REQUESTS_PER_ENDPOINT = 20   # 5 endpoints × 20 = 100 total


async def _get(client: httpx.AsyncClient, url: str, key: str) -> tuple[float, int]:
    t0 = time.perf_counter()
    r  = await client.get(url, headers={"X-API-Key": key})
    return (time.perf_counter() - t0) * 1000, r.status_code


async def run_round(host: str, key: str, label: str) -> dict[str, list[float]]:
    tasks = []
    names = []

    for path, name in ENDPOINTS:
        for _ in range(REQUESTS_PER_ENDPOINT):
            tasks.append((host + path, name))

    # Shuffle so all endpoints are hit concurrently, not sequentially
    import random
    random.shuffle(tasks)

    results: dict[str, list[float]] = {name: [] for _, name in ENDPOINTS}
    errors = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        coros = [_get(client, url, key) for url, _ in tasks]
        pairs = await asyncio.gather(*coros, return_exceptions=True)

    for (url, name), result in zip(tasks, pairs):
        if isinstance(result, Exception):
            errors += 1
        else:
            ms, status = result
            if status == 200:
                results[name].append(ms)
            else:
                errors += 1

    print(f"\n{'─'*64}")
    print(f"  Round: {label}  ({len(tasks)} requests, {CONCURRENCY} concurrency)")
    print(f"{'─'*64}")
    print(f"  {'Endpoint':<24} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7} {'n':>4}")
    print(f"  {'─'*60}")

    all_times = []
    for path, name in ENDPOINTS:
        times = results[name]
        if not times:
            print(f"  {name:<24}  — no data —")
            continue
        all_times.extend(times)
        s = sorted(times)
        p50 = statistics.median(s)
        p95 = s[int(len(s) * 0.95)]
        p99 = s[int(len(s) * 0.99)] if len(s) >= 100 else s[-1]
        mx  = max(s)
        print(f"  {name:<24} {p50:>6.1f}ms {p95:>6.1f}ms {p99:>6.1f}ms {mx:>6.1f}ms {len(times):>4}")

    if all_times:
        s = sorted(all_times)
        p50 = statistics.median(s)
        p95 = s[int(len(s) * 0.95)]
        print(f"  {'─'*60}")
        print(f"  {'ALL ENDPOINTS':<24} {p50:>6.1f}ms {p95:>6.1f}ms")

    if errors:
        print(f"\n  ⚠  {errors} errors / timeouts")

    return results


async def flush_cache(host: str, key: str):
    """Ask the server's Redis instance to flush the effant: namespace."""
    import redis as _redis
    r = _redis.from_url("redis://localhost:6379")
    keys = r.keys("effant:*")
    if keys:
        r.delete(*keys)
        print(f"  Flushed {len(keys)} cache keys from Redis")
    else:
        print("  Cache already empty")


async def main():
    parser = argparse.ArgumentParser(description="EFFANT load test")
    parser.add_argument("--key",   required=True, help="API key (X-API-Key)")
    parser.add_argument("--host",  default="http://localhost:8000")
    parser.add_argument("--flush", action="store_true", help="Flush Redis before warm round")
    args = parser.parse_args()

    print(f"\nEFFANT Load Test — {args.host}")
    print(f"  {REQUESTS_PER_ENDPOINT} req × {len(ENDPOINTS)} endpoints = {REQUESTS_PER_ENDPOINT * len(ENDPOINTS)} total")
    print(f"  Concurrency: {CONCURRENCY}")

    # ── Round 1: cold cache ──
    print("\n  Flushing Redis before cold round...")
    await flush_cache(args.host, args.key)
    cold = await run_round(args.host, args.key, "COLD  (cache miss — DB queries)")

    await asyncio.sleep(1)

    # ── Round 2: warm cache ──
    warm = await run_round(args.host, args.key, "WARM  (cache hit — Redis)")

    # ── Summary ──
    print(f"\n{'═'*64}")
    print("  SPEEDUP SUMMARY  (p50 cold → p50 warm)")
    print(f"{'═'*64}")
    for path, name in ENDPOINTS:
        c = sorted(cold.get(name, []))
        w = sorted(warm.get(name, []))
        if not c or not w:
            continue
        p50_cold = statistics.median(c)
        p50_warm = statistics.median(w)
        speedup  = p50_cold / p50_warm if p50_warm > 0 else float("inf")
        bar      = "█" * min(int(speedup), 40)
        print(f"  {name:<24}  {p50_cold:>6.1f}ms → {p50_warm:>5.1f}ms  {speedup:>5.1f}× {bar}")
    print(f"{'═'*64}\n")


if __name__ == "__main__":
    asyncio.run(main())
