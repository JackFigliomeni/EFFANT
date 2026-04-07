-- EFFANT — Complete schema migration
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- Run at container startup before API/worker launches

-- ── Core Solana data ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clusters (
    id            SERIAL PRIMARY KEY,
    name          TEXT,
    wallet_count  INTEGER       NOT NULL DEFAULT 0,
    total_volume  NUMERIC(24,9) NOT NULL DEFAULT 0,
    dominant_type TEXT,
    algorithm     TEXT,
    created_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
    address          TEXT PRIMARY KEY,
    first_seen       TIMESTAMPTZ,
    last_seen        TIMESTAMPTZ,
    tx_count         BIGINT        NOT NULL DEFAULT 0,
    total_volume_sol NUMERIC(24,9) NOT NULL DEFAULT 0,
    label            TEXT,
    entity_type      TEXT,
    risk_score       NUMERIC(5,2),
    cluster_id       INTEGER REFERENCES clusters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    signature   TEXT PRIMARY KEY,
    block_time  TIMESTAMPTZ,
    fee         NUMERIC(20,9) NOT NULL DEFAULT 0,
    success     BOOLEAN       NOT NULL DEFAULT TRUE,
    from_wallet TEXT REFERENCES wallets(address),
    to_wallet   TEXT REFERENCES wallets(address),
    amount_sol  NUMERIC(24,9) NOT NULL DEFAULT 0,
    program_id  TEXT
);

CREATE TABLE IF NOT EXISTS anomalies (
    id             BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL REFERENCES wallets(address),
    anomaly_type   TEXT NOT NULL,
    severity       TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description    TEXT
);

-- ── Auth & billing ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id             SERIAL PRIMARY KEY,
    key_hash       CHAR(64) UNIQUE NOT NULL,
    customer_email VARCHAR(255),
    tier           VARCHAR(20) NOT NULL DEFAULT 'starter',
    calls_today    INTEGER     NOT NULL DEFAULT 0,
    calls_limit    INTEGER     NOT NULL DEFAULT 10000,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    last_used_at   TIMESTAMPTZ,
    reset_at       TIMESTAMPTZ,
    active         BOOLEAN     NOT NULL DEFAULT TRUE,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_call_log (
    id          BIGSERIAL PRIMARY KEY,
    key_hash    CHAR(64),
    endpoint    TEXT,
    method      VARCHAR(10),
    status_code INTEGER,
    response_ms INTEGER,
    called_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(100) UNIQUE,
    stripe_sub_id      VARCHAR(100),
    stripe_price_id    VARCHAR(100),
    tier               VARCHAR(20)  DEFAULT 'starter',
    status             VARCHAR(50)  DEFAULT 'incomplete',
    current_period_end TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
    url               TEXT NOT NULL,
    event_types       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    secret_key        CHAR(64) NOT NULL,
    active            BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    last_triggered_at TIMESTAMPTZ,
    last_status       INTEGER
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_transactions_block_time   ON transactions(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_from_wallet  ON transactions(from_wallet);
CREATE INDEX IF NOT EXISTS idx_transactions_to_wallet    ON transactions(to_wallet);
CREATE INDEX IF NOT EXISTS idx_transactions_amount       ON transactions(amount_sol DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_wallet          ON anomalies(wallet_address);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected_at     ON anomalies(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity        ON anomalies(severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_risk_score        ON wallets(risk_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wallets_cluster           ON wallets(cluster_id);
CREATE INDEX IF NOT EXISTS idx_api_call_log_key          ON api_call_log(key_hash, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id          ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id     ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id          ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_event_types      ON webhooks USING GIN(event_types);
