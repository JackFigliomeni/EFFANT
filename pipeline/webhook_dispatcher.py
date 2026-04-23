"""
EFFANT — Outbound webhook dispatcher.

Called by the scheduler after each anomaly detection run. Queries new
critical/high anomalies, finds subscribed webhook endpoints, and POSTs
signed JSON payloads with retry logic.

No FastAPI dependencies — safe to import in the pipeline worker process.

Usage (from scheduler.py):
    from webhook_dispatcher import dispatch_new_anomalies
    dispatched = dispatch_new_anomalies(conn, state.last_dispatch_ts)
    state.last_dispatch_ts = datetime.now(tz=timezone.utc)

Event types
───────────
  new_anomaly_critical  — any critical/high anomaly (wash_trading, volume_spike, sandwich_attack)
  whale_movement        — specifically a whale_movement anomaly at critical/high severity

Payload envelope
────────────────
  {
    "event":     "new_anomaly_critical",
    "timestamp": "2026-04-23T14:20:01+00:00",
    "data": {
      "wallet_address": "DttWaMuV...",
      "wallet_label":   "Jito Tip 1",
      "anomaly_type":   "sandwich_attack",
      "severity":       "critical",
      "detected_at":    "2026-04-23T14:20:00+00:00",
      "description":    "Sandwich perpetrator: bot targeted 3 victim(s)..."
    }
  }

Signature
─────────
  Header: X-Effant-Signature: sha256=<hmac-hex>
  Verify: hmac.new(secret.encode(), body_bytes, sha256).hexdigest()
"""

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone

import httpx
import psycopg2.extras

log = logging.getLogger("effant.webhook_dispatcher")


# ── Severity filter — only fire webhooks for these ───────────────────────────

DISPATCH_SEVERITIES = ("critical", "high")


# ── Map anomaly_type → webhook event_type ────────────────────────────────────

def _event_type(anomaly_type: str) -> str:
    """
    whale_movement anomalies subscribe to 'whale_movement'.
    All other critical/high anomalies subscribe to 'new_anomaly_critical'.
    """
    return "whale_movement" if anomaly_type == "whale_movement" else "new_anomaly_critical"


# ── HMAC signature ────────────────────────────────────────────────────────────

def sign_payload(payload_bytes: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(
        secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()


# ── HTTP delivery with exponential backoff ────────────────────────────────────

def _deliver(url: str, payload_bytes: bytes, signature: str, webhook_id: int) -> int:
    """
    POST to url. Returns HTTP status code (0 = connection/timeout error).
    Retries up to 3 times: immediate, 2s, 4s.
    """
    headers = {
        "Content-Type":      "application/json",
        "X-Effant-Signature": signature,
        "X-Effant-Timestamp": str(int(time.time())),
        "User-Agent":        "Effant-Webhooks/1.0",
    }
    last_status = 0
    for attempt in range(3):
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, content=payload_bytes, headers=headers)
                last_status = resp.status_code
                if resp.is_success:
                    log.info(f"  ✓ Webhook {webhook_id} → {url[:60]} : HTTP {resp.status_code}")
                    return last_status
                log.warning(f"  ✗ Webhook {webhook_id} attempt {attempt+1} → HTTP {resp.status_code}")
        except Exception as exc:
            log.warning(f"  ✗ Webhook {webhook_id} attempt {attempt+1} error: {exc}")
            last_status = 0

        if attempt < 2:
            wait = 2 ** (attempt + 1)   # 2s then 4s
            log.debug(f"    Retrying in {wait}s…")
            time.sleep(wait)

    log.error(f"  ✗ Webhook {webhook_id} failed after 3 attempts (last status {last_status})")
    return last_status


# ── Main dispatcher ───────────────────────────────────────────────────────────

def dispatch_new_anomalies(conn, since: datetime) -> int:
    """
    Find all critical/high anomalies detected after `since`, match them against
    active webhook subscriptions, and POST to each subscribed URL.

    Returns the total number of webhook delivery attempts.

    `since` should be updated by the caller after each run:
        state.last_dispatch_ts = datetime.now(tz=timezone.utc)
    """
    # 1. Pull new anomalies worth dispatching
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT a.id,
                   a.wallet_address,
                   w.label           AS wallet_label,
                   a.anomaly_type,
                   a.severity,
                   a.detected_at,
                   a.description
            FROM anomalies a
            LEFT JOIN wallets w ON w.address = a.wallet_address
            WHERE a.detected_at > %s
              AND a.severity    = ANY(%s)
            ORDER BY a.detected_at ASC
        """, (since, list(DISPATCH_SEVERITIES)))
        anomalies = cur.fetchall()

    if not anomalies:
        return 0

    # 2. Pull all active webhooks once
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, url, secret_key, event_types
            FROM webhooks
            WHERE active = TRUE
        """)
        webhooks = cur.fetchall()

    if not webhooks:
        log.debug("No active webhooks registered — skipping dispatch")
        return 0

    log.info(f"Dispatching {len(anomalies)} anomalies to {len(webhooks)} webhook(s)…")

    dispatched = 0

    for anomaly in anomalies:
        event = _event_type(anomaly["anomaly_type"])

        payload_data = {
            "wallet_address": anomaly["wallet_address"],
            "wallet_label":   anomaly["wallet_label"],
            "anomaly_type":   anomaly["anomaly_type"],
            "severity":       anomaly["severity"],
            "detected_at":    anomaly["detected_at"].isoformat() if anomaly["detected_at"] else None,
            "description":    anomaly["description"],
        }

        envelope = {
            "event":     event,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "data":      payload_data,
        }
        payload_bytes = json.dumps(envelope, default=str).encode()

        for wh in webhooks:
            subscribed = wh.get("event_types") or []
            if event not in subscribed:
                continue

            sig    = sign_payload(payload_bytes, wh["secret_key"])
            status = _deliver(wh["url"], payload_bytes, sig, wh["id"])

            # Update delivery status
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE webhooks
                       SET last_triggered_at = NOW(), last_status = %s
                       WHERE id = %s""",
                    (status if status else None, wh["id"]),
                )
            conn.commit()
            dispatched += 1

    log.info(f"Webhook dispatch complete: {dispatched} deliveries for {len(anomalies)} anomalies")
    return dispatched
