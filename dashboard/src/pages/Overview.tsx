import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fetchHealth, fetchMetrics, fetchPublicAnomalies, fetchPublicClusters } from '../api/client'
import type { HealthData, MetricsData, ApiResponse, Anomaly, Cluster } from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtSol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toFixed(0)
}

function fmtHour(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ── Simulated live transactions ───────────────────────────────────────────────

const TOKENS   = ['SOL', 'USDC', 'BONK', 'JUP', 'RAY', 'MSOL', 'WIF'] as const
const TX_TYPES = ['SWAP', 'TRANSFER', 'BUY', 'SELL'] as const

const TYPE_COLOR: Record<string, string> = {
  SWAP:     '#C08457',
  TRANSFER: '#64748b',
  BUY:      '#22c55e',
  SELL:     '#f43f5e',
}

function randB58(len: number): string {
  const c = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join('')
}

interface LiveTx {
  id:    string
  time:  string
  sig:   string
  type:  string
  from:  string
  to:    string
  token: string
  value: string
  usd:   string
}

function genTx(): LiveTx {
  const type  = TX_TYPES[Math.floor(Math.random() * TX_TYPES.length)]
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)]
  const raw   =
    token === 'SOL'  ? Math.random() * 500 + 0.5 :
    token === 'USDC' ? Math.random() * 50000 + 100 :
                       Math.random() * 1000000 + 10000
  const usdRaw =
    token === 'SOL'  ? raw * 162.35 :
    token === 'USDC' ? raw :
    token === 'JUP'  ? raw * 0.75 :
    token === 'RAY'  ? raw * 2.4 :
    token === 'MSOL' ? raw * 180 :
                       raw * 0.000018
  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
    n >= 1_000     ? `${(n / 1_000).toFixed(0)}K` :
    token === 'SOL' ? n.toFixed(2) : n.toFixed(0)
  return {
    id:    Math.random().toString(36).slice(2),
    time:  new Date().toLocaleTimeString('en-US', { hour12: false }),
    sig:   randB58(4) + '...' + randB58(3) + 'k',
    type,
    from:  randB58(4) + '...' + randB58(3),
    to:    randB58(4) + '...' + randB58(3),
    token,
    value: fmt(raw),
    usd:   usdRaw >= 1000 ? `$${(usdRaw / 1000).toFixed(1)}K` : `$${usdRaw.toFixed(0)}`,
  }
}

// ── Static mock: Top tokens by volume ─────────────────────────────────────────

const TOP_TOKENS = [
  { token: 'SOL',  volume: '$842.1M', change: '+4.27%' },
  { token: 'USDC', volume: '$612.3M', change: '+1.67%' },
  { token: 'BONK', volume: '$211.5M', change: '+6.21%' },
  { token: 'JUP',  volume: '$168.2M', change: '+3.11%' },
  { token: 'RAY',  volume: '$37.6M',  change: '+2.45%' },
]

// ── Components ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, change, warn,
}: {
  label: string; value: string; sub?: string; change?: string; warn?: boolean
}) {
  return (
    <div style={{
      background: '#141d2b', border: '1px solid #1f2937',
      borderRadius: 8, padding: '16px 18px',
    }}>
      <p style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5,
        color: '#374151', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
      }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 26,
        fontWeight: 700, color: warn ? '#f43f5e' : '#e2e8f0',
        letterSpacing: '-0.03em', lineHeight: 1,
      }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151', marginTop: 6 }}>
          {sub}
        </p>
      )}
      {change && (
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#22c55e', marginTop: 4 }}>
          {change}
        </p>
      )}
    </div>
  )
}

function NetworkHealth({ health }: { health: HealthData | undefined }) {
  const pipe   = health?.pipeline
  const slot   = pipe?.current_slot
  const sysOk  = health?.status === 'ok'

  const items = [
    { label: 'RPC Latency',   value: '128ms',                              color: '#22c55e' },
    { label: 'Slot Height',   value: slot ? slot.toLocaleString() : '—', color: '#e2e8f0' },
    { label: 'TPS (Current)', value: '2,853',                               color: '#e2e8f0' },
    { label: 'Invalid Tx %',  value: '0.02%',                               color: '#22c55e' },
  ]

  return (
    <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Network Health
        </span>
      </div>
      <div style={{ padding: '4px 16px 12px', flex: 1 }}>
        {items.map((item, i) => (
          <div
            key={item.label}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0',
              borderBottom: i < items.length - 1 ? '1px solid #1a2537' : 'none',
            }}
          >
            <span style={{ fontSize: 12, color: '#4b6278' }}>{item.label}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: item.color }}>
              {item.value}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1a2537' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sysOk ? '#22c55e' : '#f43f5e' }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: sysOk ? '#22c55e80' : '#f43f5e80' }}>
              {sysOk ? 'System ok' : 'System degraded'}
            </span>
          </div>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#1f2937' }}>
            {sysOk ? 'All Systems Operational' : 'Check pipeline'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#f43f5e',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

const ANOM_LABEL: Record<string, string> = {
  wash_trading:     'Wash Trading',
  volume_spike:     'Volume Spike',
  sandwich_attack:  'Sandwich Attack',
  whale_movement:   'Whale Movement',
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      style={{ background: 'none', border: '1px solid #1f2937', borderRadius: 4, padding: '2px 8px',
        fontSize: 10, color: copied ? '#22c55e' : '#4B5563', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
        flexShrink: 0 }}
      onMouseEnter={e => { if (!copied) e.currentTarget.style.borderColor = '#C08457' }}
      onMouseLeave={e => { if (!copied) e.currentTarget.style.borderColor = '#1f2937' }}
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  )
}

export function Overview() {
  const [txs,              setTxs]              = useState<LiveTx[]>(() => Array.from({ length: 24 }, genTx))
  const [paused,           setPaused]           = useState(false)
  const [selAnomaly,       setSelAnomaly]       = useState<Anomaly | null>(null)
  const [selCluster,       setSelCluster]       = useState<Cluster | null>(null)

  const { data: health } = useQuery<HealthData>({
    queryKey:        ['health'],
    queryFn:         fetchHealth,
    refetchInterval: 30_000,
    staleTime:       20_000,
  })

  const { data: metricsRaw } = useQuery<ApiResponse<MetricsData>>({
    queryKey:        ['metrics'],
    queryFn:         fetchMetrics,
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const { data: anomaliesRaw } = useQuery<ApiResponse<Anomaly[]>>({
    queryKey:        ['public-anomalies'],
    queryFn:         () => fetchPublicAnomalies(30),
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const { data: clustersRaw } = useQuery<ApiResponse<Cluster[]>>({
    queryKey:        ['public-clusters'],
    queryFn:         () => fetchPublicClusters(20),
    refetchInterval: 120_000,
    staleTime:       60_000,
  })

  const anomalies = anomaliesRaw?.data ?? []
  const clusters  = clustersRaw?.data  ?? []

  const metrics = metricsRaw?.data
  const ks      = metrics?.key_stats
  const db      = health?.database

  // Live tx feed simulation
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      setTxs(prev => {
        const count  = Math.floor(Math.random() * 3) + 1
        const newTxs = Array.from({ length: count }, genTx)
        return [...newTxs, ...prev].slice(0, 60)
      })
    }, 1400)
    return () => clearInterval(id)
  }, [paused])

  // Volume area chart data
  const volumeData = (metrics?.volume_timeline ?? []).map(p => ({
    time:   fmtHour(p.hour),
    volume: Math.round(p.volume_sol),
    whale:  Math.round(p.whale_vol),
  }))

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Market Overview</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#374151' }}>
            Real-time intelligence across Solana.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: '#141d2b', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Solana</span>
            <span style={{ fontSize: 9, color: '#4B5563' }}>▼</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: '#141d2b', border: '1px solid #1f2937' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} className="animate-pulse" />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e' }}>Live</span>
          </div>
        </div>
      </div>

      {/* ── 4 Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard
          label="Transactions (24H)"
          value={ks ? fmtNum(ks.total_txs_24h) : (db ? fmtNum(db.transactions) : '—')}
          sub="on-chain records"
          change="+12.45%"
        />
        <StatCard
          label="Volume (24H)"
          value={ks ? `${fmtSol(ks.total_vol_24h)} SOL` : '—'}
          sub="total transacted"
          change="+5.21%"
        />
        <StatCard
          label="Active Wallets (24H)"
          value={ks ? fmtNum(ks.active_wallets_24h) : (db ? fmtNum(db.wallets) : '—')}
          sub="unique senders / receivers"
          change="+9.14%"
        />
        <StatCard
          label="Anomalies Detected"
          value={ks ? fmtNum(ks.anomaly_count_24h) : (db ? fmtNum(db.anomalies) : '—')}
          sub="last 24 hours"
          warn={(ks?.anomaly_count_24h ?? 0) > 1000}
        />
      </div>

      {/* ── Volume chart + Top Tokens ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>

        {/* Volume Over Time */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Volume Over Time
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151' }}>SOL · 24h · live</span>
          </div>
          <div style={{ padding: '12px 8px 8px', height: 190 }}>
            {volumeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#C08457" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#C08457" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 6" stroke="#1a2537" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#374151', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false} tickLine={false} interval={3}
                  />
                  <YAxis
                    tick={{ fill: '#374151', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={fmtSol} width={44}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                    itemStyle={{ color: '#C08457' }}
                    formatter={(v: unknown) => [fmtSol(Number(v)) + ' SOL', 'Volume']}
                  />
                  <Area type="monotone" dataKey="volume" stroke="#C08457" strokeWidth={1.5} fill="url(#volGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151' }}>Loading…</div>
              </div>
            )}
          </div>
        </div>

        {/* Top Tokens By Volume */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Top Tokens By Volume (24H)
            </span>
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 64px', padding: '8px 16px 4px', gap: 8 }}>
              {['TOKEN', 'VOLUME', 'CHANGE'].map(h => (
                <span key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {h}
                </span>
              ))}
            </div>
            {TOP_TOKENS.map(t => (
              <div key={t.token} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 64px', padding: '10px 16px', gap: 8, borderTop: '1px solid #1a2537' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{t.token}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#64748b' }}>{t.volume}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e', textAlign: 'right' }}>{t.change}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live Transactions + Network Health ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14 }}>

        {/* Live Transactions */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Live Transactions
              </span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: paused ? '#374151' : '#22c55e' }} className={paused ? '' : 'animate-pulse'} />
            </div>
            <button
              onClick={() => setPaused(p => !p)}
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                background: 'transparent', border: '1px solid #1f2937', borderRadius: 4,
                color: '#4B5563', cursor: 'pointer', padding: '3px 8px',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4B5563')}
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1f2937', background: '#0d1117' }}>
                  {['TIME', 'SIGNATURE', 'TYPE', 'FROM', 'TO', 'TOKEN', 'VALUE'].map(h => (
                    <th
                      key={h}
                      style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txs.slice(0, 12).map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid #0d1020' }}>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#374151', whiteSpace: 'nowrap' }}>{tx.time}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#4B5563', whiteSpace: 'nowrap' }}>{tx.sig}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: TYPE_COLOR[tx.type] ?? '#64748b' }}>
                        {tx.type}
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#4B5563', whiteSpace: 'nowrap' }}>{tx.from}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#4B5563', whiteSpace: 'nowrap' }}>{tx.to}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{tx.token}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#e2e8f0', whiteSpace: 'nowrap', textAlign: 'right' }}>{tx.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Network Health */}
        <NetworkHealth health={health} />
      </div>

      {/* ── Anomaly Feed + Entity Clusters ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* ── Anomaly Feed ── */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Anomaly Feed</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151' }}>
              {anomalies.length > 0 ? `${anomalies.length} detected` : 'loading…'}
            </span>
          </div>

          {/* rows */}
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {anomalies.length === 0 ? (
              <div style={{ padding: '20px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151', textAlign: 'center' }}>
                Loading anomalies…
              </div>
            ) : anomalies.map(a => {
              const sel = selAnomaly?.id === a.id
              return (
                <div
                  key={a.id}
                  onClick={() => setSelAnomaly(sel ? null : a)}
                  style={{
                    padding: '9px 16px', borderBottom: '1px solid #0d1117', cursor: 'pointer',
                    background: sel ? 'rgba(192,132,87,0.08)' : 'transparent',
                    borderLeft: `2px solid ${sel ? '#C08457' : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700,
                      color: SEV_COLOR[a.severity] ?? '#64748b',
                      background: `${SEV_COLOR[a.severity] ?? '#64748b'}18`,
                      border: `1px solid ${SEV_COLOR[a.severity] ?? '#64748b'}40`,
                      borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>{a.severity}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {ANOM_LABEL[a.anomaly_type] ?? a.anomaly_type}
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151', marginLeft: 'auto' }}>
                      {new Date(a.detected_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#4B5563' }}>
                    {a.wallet_address.slice(0, 8)}…{a.wallet_address.slice(-6)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* detail panel */}
          {selAnomaly && (
            <div style={{ borderTop: '1px solid #C08457', background: '#0d1117', padding: '14px 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>
                  {ANOM_LABEL[selAnomaly.anomaly_type] ?? selAnomaly.anomaly_type}
                </span>
                <button onClick={() => setSelAnomaly(null)} style={{ background: 'none', border: 'none', color: '#4B5563', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Wallet Address</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C08457', wordBreak: 'break-all' }}>{selAnomaly.wallet_address}</span>
                    <CopyBtn text={selAnomaly.wallet_address} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Severity</div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: SEV_COLOR[selAnomaly.severity] ?? '#64748b' }}>
                      {selAnomaly.severity.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Detected</div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9CA3AF' }}>
                      {new Date(selAnomaly.detected_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                {selAnomaly.description && (
                  <div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Description</div>
                    <p style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.6 }}>{selAnomaly.description}</p>
                  </div>
                )}
                {selAnomaly.wallet_label && (
                  <div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Label</div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#e2e8f0' }}>{selAnomaly.wallet_label}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Entity Clusters ── */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Entity Clusters</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151' }}>
              {clusters.length > 0 ? `${clusters.length} clusters` : 'loading…'}
            </span>
          </div>

          {/* header row */}
          {clusters.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 80px 60px', padding: '6px 16px', gap: 8, background: '#0d1117' }}>
              {['CLUSTER', 'WALLETS', 'VOLUME', 'TYPE'].map(h => (
                <span key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
              ))}
            </div>
          )}

          {/* rows */}
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {clusters.length === 0 ? (
              <div style={{ padding: '20px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151', textAlign: 'center' }}>
                Loading clusters…
              </div>
            ) : clusters.map(c => {
              const sel = selCluster?.id === c.id
              return (
                <div
                  key={c.id}
                  onClick={() => setSelCluster(sel ? null : c)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 64px 80px 60px', gap: 8,
                    padding: '9px 16px', borderBottom: '1px solid #0d1117', cursor: 'pointer', alignItems: 'center',
                    background: sel ? 'rgba(192,132,87,0.08)' : 'transparent',
                    borderLeft: `2px solid ${sel ? '#C08457' : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C08457' }}>{c.wallet_count}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b' }}>{fmtSol(c.total_volume)} SOL</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#4B5563', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.dominant_type ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* detail panel */}
          {selCluster && (
            <div style={{ borderTop: '1px solid #C08457', background: '#0d1117', padding: '14px 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{selCluster.name}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151', marginLeft: 10 }}>
                    {selCluster.wallet_count} wallets · {fmtSol(selCluster.total_volume)} SOL
                  </span>
                </div>
                <button onClick={() => setSelCluster(null)} style={{ background: 'none', border: 'none', color: '#4B5563', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                Top Wallets
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
                {selCluster.top_wallets.length === 0 ? (
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151' }}>No wallet data available</span>
                ) : selCluster.top_wallets.map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #1a2537' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151', minWidth: 16 }}>{i + 1}</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C08457', flex: 1, wordBreak: 'break-all' }}>{w.address}</span>
                    <CopyBtn text={w.address} />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#64748b', minWidth: 60, textAlign: 'right' }}>
                      {fmtSol(w.volume)} SOL
                    </span>
                  </div>
                ))}
              </div>
              {selCluster.dominant_type && (
                <div style={{ marginTop: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#4B5563' }}>
                  Type: <span style={{ color: '#9CA3AF' }}>{selCluster.dominant_type}</span>
                  {selCluster.algorithm && <span style={{ marginLeft: 12 }}>Algorithm: <span style={{ color: '#9CA3AF' }}>{selCluster.algorithm}</span></span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
