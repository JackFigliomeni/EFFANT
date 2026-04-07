-- EFFANT Solana data schema
-- Run: psql -U jackfigliomeni -d effant -f pipeline/schema.sql

CREATE TABLE IF NOT EXISTS wallets (
    address         TEXT PRIMARY KEY,
    first_seen      TIMESTAMPTZ,
    last_seen       TIMESTAMPTZ,
    tx_count        BIGINT      NOT NULL DEFAULT 0,
    total_volume_sol NUMERIC(24, 9) NOT NULL DEFAULT 0,
    label           TEXT,
    entity_type     TEXT,          -- e.g. 'dex', 'cex', 'bot', 'user'
    risk_score      NUMERIC(5, 2), -- 0.00–100.00
    cluster_id      INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
    signature   TEXT PRIMARY KEY,
    block_time  TIMESTAMPTZ,
    fee         NUMERIC(20, 9) NOT NULL DEFAULT 0,
    success     BOOLEAN        NOT NULL DEFAULT TRUE,
    from_wallet TEXT           REFERENCES wallets(address),
    to_wallet   TEXT           REFERENCES wallets(address),
    amount_sol  NUMERIC(24, 9) NOT NULL DEFAULT 0,
    program_id  TEXT
);

CREATE TABLE IF NOT EXISTS anomalies (
    id             BIGSERIAL PRIMARY KEY,
    wallet_address TEXT        NOT NULL REFERENCES wallets(address),
    anomaly_type   TEXT        NOT NULL, -- e.g. 'high_volume', 'rapid_fire', 'new_whale'
    severity       TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description    TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_transactions_block_time  ON transactions(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_from_wallet ON transactions(from_wallet);
CREATE INDEX IF NOT EXISTS idx_transactions_to_wallet   ON transactions(to_wallet);
CREATE INDEX IF NOT EXISTS idx_transactions_amount      ON transactions(amount_sol DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_wallet         ON anomalies(wallet_address);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected_at    ON anomalies(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_risk_score       ON wallets(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_cluster          ON wallets(cluster_id);
