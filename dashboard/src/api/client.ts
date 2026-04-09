const BASE = import.meta.env.VITE_API_URL ?? ''
const KEY = import.meta.env.VITE_API_KEY ?? ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-API-Key': KEY },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface Meta {
  count: number
  generated_at: string
  total?: number
  limit?: number
  offset?: number
  [key: string]: unknown
}

export interface ApiResponse<T> {
  data: T
  meta: Meta
}

// /v1/health
export interface HealthData {
  status: 'ok' | 'degraded'
  time: string
  version: string
  database: {
    connected: boolean
    wallets: number
    transactions: number
    anomalies: number
    clusters: number
  }
  redis: {
    connected: boolean
    used_memory: string
    keys: number
  }
  pipeline: {
    last_success: string | null
    last_run: string | null
    run_count: number
    total_txs_ingested: number
    current_slot: number
    consecutive_failures: number
    status: string
  }
}

// /v1/anomalies
export interface Anomaly {
  id: number
  wallet_address: string
  wallet_label: string | null
  anomaly_type: 'wash_trading' | 'volume_spike' | 'sandwich_attack' | 'whale_movement'
  severity: 'low' | 'medium' | 'high' | 'critical'
  detected_at: string
  description: string
}

// /v1/clusters
export interface Cluster {
  id: number
  name: string
  wallet_count: number
  total_volume: number
  dominant_type: string | null
  algorithm: string | null
  created_at: string | null
  top_wallets: { address: string; label: string | null; entity_type: string | null; volume: number }[]
}

// /v1/wallet/{address}
export interface WalletProfile {
  address: string
  label: string | null
  entity_type: string | null
  risk_score: number | null
  tx_count: number
  total_volume_sol: number
  volume_24h_sol: number
  first_seen: string | null
  last_seen: string | null
  anomaly_count: number
  cluster: {
    id: number
    name: string | null
    wallet_count: number | null
    total_volume: number | null
    dominant_type: string | null
  } | null
}

// /v1/wallet/{address}/transactions
export interface Transaction {
  signature: string
  block_time: string | null
  from_wallet: string | null
  from_label: string | null
  from_entity_type: string | null
  to_wallet: string | null
  to_label: string | null
  to_entity_type: string | null
  amount_sol: number
  fee: number
  success: boolean
  program_id: string | null
}

// /v1/anomalies (wallet-scoped)
export interface WalletAnomaly {
  id: number
  wallet_address: string
  wallet_label: string | null
  anomaly_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  detected_at: string
  description: string
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

export const fetchHealth   = () => get<HealthData>('/v1/health')
export const fetchAnomalies = (limit = 50) =>
  get<ApiResponse<Anomaly[]>>(`/v1/anomalies?limit=${limit}`)
export const fetchClusters  = (limit = 20) =>
  get<ApiResponse<Cluster[]>>(`/v1/clusters?min_wallets=2&limit=${limit}`)

export const fetchWallet = (address: string) =>
  get<ApiResponse<WalletProfile>>(`/v1/wallet/${address}`)

export const fetchWalletTxs = (address: string, limit = 20) =>
  get<ApiResponse<Transaction[]>>(`/v1/wallet/${address}/transactions?limit=${limit}`)

export const fetchWalletAnomalies = (address: string) =>
  get<ApiResponse<WalletAnomaly[]>>(`/v1/anomalies?limit=50`)
    .then(r => ({
      ...r,
      data: r.data.filter(a => a.wallet_address === address),
    }))
