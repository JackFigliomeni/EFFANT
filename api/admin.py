"""
EFFANT — Internal admin dashboard
GET /admin  — password protected via Basic Auth (ADMIN_PASSWORD env var)
"""

import os
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.concurrency import run_in_threadpool

router = APIRouter()
security = HTTPBasic()

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")
ADMIN_USER     = os.getenv("ADMIN_USER", "admin")

_pool = None

def set_pool(p):
    global _pool
    _pool = p


def _require_auth(credentials: HTTPBasicCredentials = Depends(security)):
    ok_user = secrets.compare_digest(credentials.username.encode(), ADMIN_USER.encode())
    ok_pass = secrets.compare_digest(credentials.password.encode(), ADMIN_PASSWORD.encode())
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


def _query(sql: str, params: tuple = ()):
    conn = _pool.getconn()
    try:
        import psycopg2.extras
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        _pool.putconn(conn)


def _query_one(sql, params=()):
    rows = _query(sql, params)
    return rows[0] if rows else {}


def _get_stats():
    total_users   = _query_one("SELECT COUNT(*) AS n FROM users")["n"]
    active_subs   = _query_one(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE status='active'"
    )["n"]
    starter_rev   = _query_one(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND tier='starter'"
    )["n"]
    pro_rev       = _query_one(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND tier='pro'"
    )["n"]
    monthly_rev   = (starter_rev * 499) + (pro_rev * 4900)

    calls_today   = _query_one(
        "SELECT COUNT(*) AS n FROM api_call_log WHERE called_at >= NOW() - INTERVAL '24 hours'"
    )["n"]
    calls_month   = _query_one(
        "SELECT COUNT(*) AS n FROM api_call_log WHERE called_at >= DATE_TRUNC('month', NOW())"
    )["n"]

    top_customers = _query("""
        SELECT u.email, COUNT(l.id) AS calls
        FROM api_call_log l
        JOIN api_keys k ON k.key_hash = l.key_hash
        JOIN users u ON u.id = k.user_id
        WHERE l.called_at >= NOW() - INTERVAL '24 hours'
        GROUP BY u.email
        ORDER BY calls DESC
        LIMIT 10
    """)

    pipeline = _query_one("""
        SELECT MAX(called_at) AS last_call FROM api_call_log
    """)

    wallets = _query_one("SELECT COUNT(*) AS n FROM wallets")["n"]
    txs     = _query_one("SELECT COUNT(*) AS n FROM transactions")["n"]

    return {
        "total_users": total_users,
        "active_subs": active_subs,
        "monthly_rev": monthly_rev,
        "starter_count": starter_rev,
        "pro_count": pro_rev,
        "calls_today": calls_today,
        "calls_month": calls_month,
        "top_customers": top_customers,
        "wallets": wallets,
        "txs": txs,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }


def _render_html(s: dict) -> str:
    top_rows = "".join(
        f"<tr><td>{c['email']}</td><td style='text-align:right'>{c['calls']:,}</td></tr>"
        for c in s["top_customers"]
    ) or "<tr><td colspan='2' style='color:#666'>No calls yet</td></tr>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EFFANT Admin</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Courier New', monospace; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }}
  h1 {{ color: #7c3aed; margin-bottom: 0.25rem; font-size: 1.5rem; }}
  .sub {{ color: #555; font-size: 0.8rem; margin-bottom: 2rem; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }}
  .card {{ background: #111; border: 1px solid #222; border-radius: 8px; padding: 1.25rem; }}
  .card .label {{ color: #666; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem; }}
  .card .value {{ font-size: 1.75rem; font-weight: bold; color: #fff; }}
  .card .sub-value {{ font-size: 0.8rem; color: #7c3aed; margin-top: 0.25rem; }}
  .revenue {{ border-color: #7c3aed44; }}
  .revenue .value {{ color: #7c3aed; }}
  h2 {{ color: #888; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 1rem; }}
  table {{ width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; overflow: hidden; }}
  th {{ background: #1a1a1a; color: #666; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; padding: 0.75rem 1rem; text-align: left; }}
  td {{ padding: 0.65rem 1rem; border-top: 1px solid #1a1a1a; font-size: 0.9rem; }}
  tr:hover td {{ background: #161616; }}
  .refresh {{ margin-top: 2rem; color: #333; font-size: 0.75rem; }}
  a {{ color: #7c3aed; text-decoration: none; }}
</style>
</head>
<body>
<h1>EFFANT Admin</h1>
<div class="sub">Generated {s['generated_at']} · <a href="/admin">Refresh</a></div>

<div class="grid">
  <div class="card">
    <div class="label">Total Users</div>
    <div class="value">{s['total_users']:,}</div>
  </div>
  <div class="card">
    <div class="label">Active Subscriptions</div>
    <div class="value">{s['active_subs']:,}</div>
    <div class="sub-value">{s['starter_count']} Starter · {s['pro_count']} Pro</div>
  </div>
  <div class="card revenue">
    <div class="label">Monthly Revenue (MRR)</div>
    <div class="value">${s['monthly_rev']:,}</div>
    <div class="sub-value">Active subscribers only</div>
  </div>
  <div class="card">
    <div class="label">API Calls Today</div>
    <div class="value">{s['calls_today']:,}</div>
    <div class="sub-value">{s['calls_month']:,} this month</div>
  </div>
  <div class="card">
    <div class="label">Wallets Indexed</div>
    <div class="value">{s['wallets']:,}</div>
  </div>
  <div class="card">
    <div class="label">Transactions (30d)</div>
    <div class="value">{s['txs']:,}</div>
  </div>
</div>

<h2>Top 10 Customers by API Calls (24h)</h2>
<table>
  <thead><tr><th>Email</th><th style="text-align:right">Calls</th></tr></thead>
  <tbody>{top_rows}</tbody>
</table>

<div class="refresh">Auto-refresh: <a href="/admin">click to reload</a></div>
</body>
</html>"""


@router.get("/admin", response_class=HTMLResponse, include_in_schema=False)
async def admin_dashboard(_: str = Depends(_require_auth)):
    stats = await run_in_threadpool(_get_stats)
    return HTMLResponse(_render_html(stats))
