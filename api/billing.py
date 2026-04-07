"""
EFFANT — Stripe billing + SendGrid email integration.

Endpoints
─────────
  POST /billing/create-checkout-session   Start a Stripe Checkout session
  POST /billing/webhook                   Receive Stripe webhook events
  GET  /billing/subscription              Current subscription status (portal)
  POST /billing/cancel                    Cancel subscription at period end

Stripe events handled
─────────────────────
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.payment_succeeded
  invoice.payment_failed

Setup
─────
  1. Add to .env:
       STRIPE_SECRET_KEY=sk_test_...
       STRIPE_WEBHOOK_SECRET=whsec_...
       STRIPE_STARTER_PRICE_ID=price_...
       STRIPE_PRO_PRICE_ID=price_...
       SENDGRID_API_KEY=SG...
       SENDGRID_FROM_EMAIL=billing@effant.io
       FRONTEND_URL=http://localhost:5173

  2. Create products in Stripe dashboard (test mode):
       Starter      $499/month
       Professional $4,900/month
     Copy the Price IDs into .env.

  3. Register webhook in Stripe dashboard:
       URL: https://your-domain.com/billing/webhook
       Events: customer.subscription.*, invoice.payment_*
     Or for local dev:
       stripe listen --forward-to localhost:8000/billing/webhook
"""

import hashlib
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta

import psycopg2
import psycopg2.extras
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

log = logging.getLogger("effant.billing")

# ── Config ────────────────────────────────────────────────────────────────────

def _cfg(key: str, default: str = "") -> str:
    return os.getenv(key, default)

def _stripe_key()    -> str: return _cfg("STRIPE_SECRET_KEY")
def _webhook_secret()-> str: return _cfg("STRIPE_WEBHOOK_SECRET")
def _sendgrid_key()  -> str: return _cfg("SENDGRID_API_KEY")
def _from_email()    -> str: return _cfg("SENDGRID_FROM_EMAIL", "billing@effant.io")
def _frontend_url()  -> str: return _cfg("FRONTEND_URL", "http://localhost:5173")
def _price_id(tier: str) -> str:
    return _cfg(f"STRIPE_{tier.upper()}_PRICE_ID")

TIER_LIMITS = {"starter": 10_000, "pro": 500_000}

router = APIRouter(prefix="/billing", tags=["billing"])


# ── DB helpers (injected from main.py pool) ───────────────────────────────────

_pool = None

def set_pool(pool):
    global _pool
    _pool = pool

def _query(sql: str, params: tuple = ()) -> list[dict]:
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        _pool.putconn(conn)

def _query_one(sql: str, params: tuple = ()) -> dict | None:
    rows = _query(sql, params)
    return rows[0] if rows else None

def _execute(sql: str, params: tuple = ()) -> None:
    conn = _pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        _pool.putconn(conn)

def _execute_returning(sql: str, params: tuple = ()) -> dict | None:
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        _pool.putconn(conn)


# ── JWT auth dependency (reuse from main.py) ──────────────────────────────────
# We duplicate the minimal version here to keep billing.py self-contained.

import time
from jose import jwt as _jwt, JWTError as _JWTError
from fastapi import Header
from fastapi.security import HTTPBearer as _Bearer, HTTPAuthorizationCredentials as _Creds

_bearer  = _Bearer(auto_error=False)
_JWT_ALG = "HS256"


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "")


async def current_user(creds: _Creds | None = Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = _jwt.decode(creds.credentials, _jwt_secret(), algorithms=[_JWT_ALG])
    except _JWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = _query_one("SELECT id, email FROM users WHERE id = %s", (int(payload["sub"]),))
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ── Email ─────────────────────────────────────────────────────────────────────

def _send_welcome_email(email: str, tier: str, api_key: str) -> None:
    sg_key = _sendgrid_key()
    if not sg_key:
        log.warning("SENDGRID_API_KEY not set — skipping welcome email")
        return

    tier_display = "Starter" if tier == "starter" else "Professional"
    limit        = TIER_LIMITS[tier]
    price        = "$499/month" if tier == "starter" else "$4,900/month"
    frontend     = _frontend_url()
    from_addr    = _from_email()

    html = f"""
    <div style="font-family: monospace; background: #0a0e1a; color: #e2e8f0; padding: 40px; max-width: 560px;">
      <p style="color: #5b6cf8; font-size: 20px; font-weight: bold; margin-bottom: 4px;">EFFANT</p>
      <p style="color: #64748b; font-size: 12px; margin-bottom: 32px;">Solana Intelligence Platform</p>

      <h2 style="color: #fff; font-size: 16px; margin-bottom: 8px;">Welcome to {tier_display}</h2>
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.6; margin-bottom: 24px;">
        Your subscription is active. Here is your API key — store it securely.
        It will not be shown again.
      </p>

      <div style="background: #111827; border: 1px solid #1e2635; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Your API Key</p>
        <p style="color: #eab308; font-size: 13px; word-break: break-all; margin: 0;">{api_key}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="border-bottom: 1px solid #1e2635;">
          <td style="color: #64748b; font-size: 12px; padding: 8px 0;">Tier</td>
          <td style="color: #fff; font-size: 12px; text-align: right;">{tier_display}</td>
        </tr>
        <tr style="border-bottom: 1px solid #1e2635;">
          <td style="color: #64748b; font-size: 12px; padding: 8px 0;">Daily limit</td>
          <td style="color: #fff; font-size: 12px; text-align: right;">{limit:,} calls/day</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 12px; padding: 8px 0;">Billing</td>
          <td style="color: #fff; font-size: 12px; text-align: right;">{price}</td>
        </tr>
      </table>

      <div style="background: #0d1117; border: 1px solid #1e2635; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Quick start</p>
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          curl -H "X-API-Key: {api_key[:20]}..." https://api.effant.io/v1/health
        </p>
      </div>

      <p style="color: #475569; font-size: 11px;">
        Manage your subscription at {frontend} → API Portal<br>
        Questions? Reply to this email.
      </p>
    </div>
    """

    msg = Mail(
        from_email=from_addr,
        to_emails=email,
        subject=f"EFFANT — Your {tier_display} API key",
        html_content=html,
    )
    try:
        sg = SendGridAPIClient(sg_key)
        resp = sg.send(msg)
        log.info(f"Welcome email sent to {email} — status {resp.status_code}")
    except Exception as exc:
        log.error(f"SendGrid error: {exc}")


def _send_payment_failed_email(email: str, tier: str) -> None:
    sg_key = _sendgrid_key()
    if not sg_key:
        return
    frontend  = _frontend_url()
    from_addr = _from_email()
    msg = Mail(
        from_email=from_addr,
        to_emails=email,
        subject="EFFANT — Payment failed",
        html_content=f"""
        <div style="font-family: monospace; background: #0a0e1a; color: #e2e8f0; padding: 40px; max-width: 560px;">
          <p style="color: #5b6cf8; font-size: 20px; font-weight: bold;">EFFANT</p>
          <h2 style="color: #f43f5e;">Payment failed</h2>
          <p style="color: #94a3b8;">
            We couldn't process your {tier.capitalize()} subscription payment.
            Please update your payment method to keep your API key active.
          </p>
          <a href="{frontend}" style="color: #5b6cf8;">Manage billing →</a>
        </div>
        """,
    )
    try:
        SendGridAPIClient(sg_key).send(msg)
    except Exception as exc:
        log.error(f"SendGrid error: {exc}")


# ── Provisioning ──────────────────────────────────────────────────────────────

def _provision_api_key(user_id: int, email: str, tier: str) -> str:
    """Create or upgrade an API key for a user. Returns the raw key."""
    raw_key  = "eff_sk_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    limit    = TIER_LIMITS[tier]
    reset_at = (datetime.now(tz=timezone.utc) + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # Deactivate any existing keys for this user
    _execute(
        "UPDATE api_keys SET active = FALSE WHERE user_id = %s",
        (user_id,),
    )

    # Insert new key
    _execute(
        """INSERT INTO api_keys
           (key_hash, customer_email, tier, calls_today, calls_limit,
            created_at, reset_at, active, user_id)
           VALUES (%s, %s, %s, 0, %s, NOW(), %s, TRUE, %s)""",
        (key_hash, email, tier, limit, reset_at, user_id),
    )
    return raw_key


def _set_tier_from_price(stripe_customer_id: str, price_id: str, status: str) -> None:
    """Map a Stripe price → tier and update subscription row + API key."""
    tier = "pro" if price_id == _price_id("pro") else "starter"

    sub = _query_one(
        "SELECT user_id FROM subscriptions WHERE stripe_customer_id = %s",
        (stripe_customer_id,),
    )
    if not sub:
        log.warning(f"No subscription found for customer {stripe_customer_id}")
        return

    user_id = sub["user_id"]
    user    = _query_one("SELECT email FROM users WHERE id = %s", (user_id,))
    if not user:
        return

    _execute(
        """UPDATE subscriptions
           SET tier = %s, status = %s, updated_at = NOW()
           WHERE stripe_customer_id = %s""",
        (tier, status, stripe_customer_id),
    )

    if status == "active":
        # Upgrade/create API key and send welcome email
        existing = _query_one(
            "SELECT key_hash FROM api_keys WHERE user_id = %s AND active = TRUE",
            (user_id,),
        )
        if existing:
            # Upgrade tier in place
            _execute(
                "UPDATE api_keys SET tier = %s, calls_limit = %s WHERE user_id = %s AND active = TRUE",
                (tier, TIER_LIMITS[tier], user_id),
            )
            raw_key = None  # Key was already sent previously
        else:
            raw_key = _provision_api_key(user_id, user["email"], tier)
            _send_welcome_email(user["email"], tier, raw_key)

        log.info(f"Activated {tier} for user {user_id} ({user['email']})")
    else:
        log.info(f"Subscription status={status} for user {user_id}")


# ── Routes ────────────────────────────────────────────────────────────────────

class CheckoutBody(BaseModel):
    tier: str  # 'starter' or 'pro'


@router.post("/create-checkout-session")
async def create_checkout_session(
    body: CheckoutBody,
    user: dict = Depends(current_user),
):
    tier = body.tier.lower()
    if tier not in ("starter", "pro"):
        raise HTTPException(400, "tier must be 'starter' or 'pro'")

    price_id = _price_id(tier)
    if not price_id:
        raise HTTPException(503, f"Stripe price ID for '{tier}' not configured. Add STRIPE_{tier.upper()}_PRICE_ID to .env")

    sk = _stripe_key()
    if not sk:
        raise HTTPException(503, "Stripe not configured. Add STRIPE_SECRET_KEY to .env")
    stripe.api_key = sk

    # Get or create Stripe customer
    sub = _query_one("SELECT stripe_customer_id FROM subscriptions WHERE user_id = %s", (user["id"],))
    stripe_customer_id = sub["stripe_customer_id"] if sub else None

    if not stripe_customer_id:
        customer = stripe.Customer.create(email=user["email"], metadata={"user_id": str(user["id"])})
        stripe_customer_id = customer.id

        _execute(
            """INSERT INTO subscriptions (user_id, stripe_customer_id, tier, status)
               VALUES (%s, %s, %s, 'incomplete')
               ON CONFLICT (stripe_customer_id) DO NOTHING""",
            (user["id"], stripe_customer_id, tier),
        )

    frontend = _frontend_url()
    session = stripe.checkout.Session.create(
        customer=stripe_customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{frontend}?portal=1&checkout=success",
        cancel_url=f"{frontend}?portal=1&checkout=cancelled",
        metadata={"user_id": str(user["id"]), "tier": tier},
    )

    return {"url": session.url, "session_id": session.id}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload        = await request.body()
    sig            = request.headers.get("stripe-signature", "")
    webhook_secret = _webhook_secret()
    stripe.api_key = _stripe_key()

    if not webhook_secret:
        log.warning("STRIPE_WEBHOOK_SECRET not set — skipping signature verification")
        try:
            event = stripe.Event.construct_from(
                __import__("json").loads(payload), stripe.api_key
            )
        except Exception as exc:
            raise HTTPException(400, f"Invalid payload: {exc}")
    else:
        try:
            event = stripe.Webhook.construct_event(payload, sig, webhook_secret)
        except stripe.SignatureVerificationError as exc:
            raise HTTPException(400, f"Invalid signature: {exc}")

    etype = event["type"]
    data  = event["data"]["object"]
    log.info(f"Stripe event: {etype}")

    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        stripe_customer_id = data["customer"]
        price_id           = data["items"]["data"][0]["price"]["id"]
        status             = data["status"]  # active, past_due, canceled, etc.
        period_end         = datetime.fromtimestamp(data["current_period_end"], tz=timezone.utc)

        _execute(
            """UPDATE subscriptions
               SET stripe_sub_id = %s, stripe_price_id = %s,
                   status = %s, current_period_end = %s, updated_at = NOW()
               WHERE stripe_customer_id = %s""",
            (data["id"], price_id, status, period_end, stripe_customer_id),
        )
        _set_tier_from_price(stripe_customer_id, price_id, status)

    elif etype == "customer.subscription.deleted":
        stripe_customer_id = data["customer"]
        _execute(
            "UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE stripe_customer_id = %s",
            (stripe_customer_id,),
        )
        # Downgrade API key to starter limits (don't delete — be nice)
        sub = _query_one(
            "SELECT user_id FROM subscriptions WHERE stripe_customer_id = %s",
            (stripe_customer_id,),
        )
        if sub:
            _execute(
                "UPDATE api_keys SET tier = 'starter', calls_limit = 10000 WHERE user_id = %s AND active = TRUE",
                (sub["user_id"],),
            )
        log.info(f"Subscription cancelled for customer {stripe_customer_id}")

    elif etype == "invoice.payment_succeeded":
        stripe_customer_id = data["customer"]
        _execute(
            "UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE stripe_customer_id = %s",
            (stripe_customer_id,),
        )

    elif etype == "invoice.payment_failed":
        stripe_customer_id = data["customer"]
        _execute(
            "UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE stripe_customer_id = %s",
            (stripe_customer_id,),
        )
        sub = _query_one(
            "SELECT user_id FROM subscriptions WHERE stripe_customer_id = %s",
            (stripe_customer_id,),
        )
        if sub:
            user = _query_one("SELECT email FROM users WHERE id = %s", (sub["user_id"],))
            if user:
                _send_payment_failed_email(user["email"], sub.get("tier", "starter"))

    return JSONResponse({"received": True})


@router.get("/subscription")
async def get_subscription(user: dict = Depends(current_user)):
    sub = _query_one(
        """SELECT tier, status, stripe_sub_id, current_period_end, created_at
           FROM subscriptions WHERE user_id = %s ORDER BY created_at DESC LIMIT 1""",
        (user["id"],),
    )
    if not sub:
        return {"has_subscription": False}

    return {
        "has_subscription":    True,
        "tier":                sub["tier"],
        "status":              sub["status"],
        "current_period_end":  sub["current_period_end"].isoformat() if sub["current_period_end"] else None,
    }


@router.post("/cancel")
async def cancel_subscription(user: dict = Depends(current_user)):
    sub = _query_one(
        "SELECT stripe_sub_id FROM subscriptions WHERE user_id = %s AND status = 'active'",
        (user["id"],),
    )
    if not sub or not sub["stripe_sub_id"]:
        raise HTTPException(404, "No active subscription found")

    sk = _stripe_key()
    if not sk:
        raise HTTPException(503, "Stripe not configured")
    stripe.api_key = sk

    stripe.Subscription.modify(sub["stripe_sub_id"], cancel_at_period_end=True)
    _execute(
        "UPDATE subscriptions SET status = 'canceling', updated_at = NOW() WHERE user_id = %s",
        (user["id"],),
    )
    return {"cancelled": True, "message": "Subscription will cancel at end of billing period"}
