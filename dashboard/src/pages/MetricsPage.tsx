import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { fetchMetrics } from '../api/client'
import type { MetricsData, ApiResponse } from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`
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

// ── Static mock data (pie charts + programs) ──────────────────────────────────

const VOL_BY_TOKEN = [
  { name: 'SOL',    value: 34.1, color: '#C08457' },
  { name: 'USDC',   value: 24.8, color: '#38bdf8' },
  { name: 'BONK',   value:  6.6, color: '#f97316' },
  { name: 'JUP',    value: 11.1, color: '#22c55e' },
  { name: 'Others', value: 23.4, color: '#374151'  },
]

const TX_BY_TYPE = [
  { name: 'SWAP',     value: 52.1, color: '#C08457' },
  { name: 'TRANSFER', value: 25.7, color: '#38bdf8' },
  { name: 'BUY',      value: 11.4, color: '#22c55e' },
  { name: 'SELL',     value:  8.2, color: '#f43f5e' },
  { name: 'Other',    value:  2.6, color: '#374151'  },
]

const TOP_PROGRAMS = [
  { program: 'Jupiter',       txns: '6,453', pct: 25.2 },
  { program: 'Raydium AMM',   txns: '2,853', pct: 11.1 },
  { program: 'Orca Whirlpool',txns: '2,318', pct:  9.0 },
  { program: 'Serum DEX',     txns: '1,984', pct:  7.7 },
  { program: 'Orca',          txns: '1,588', pct:  6.2 },
  { program: 'Metaplex',      txns: '1,451', pct:  5.7 },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function BigStatCard({
  label, value, sub, change, changeColor,
}: {
  label: string; value: string; sub?: string; change?: string; changeColor?: string
}) {
  return (
    <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, padding: '18px 20px' }}>
      <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        {label}
      </p>
      <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151', marginTop: 5 }}>{sub}</p>
      )}
      {change && (
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: changeColor ?? '#22c55e', marginTop: 4 }}>{change}</p>
      )}
    </div>
  )
}

function ChartShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
        {sub && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#374151' }}>{sub}</span>}
      </div>
      <div style={{ padding: '12px 8px 8px', height: 200 }}>
        {children}
      </div>
    </div>
  )
}

function MiniPieChart({ data, title }: { data: typeof VOL_BY_TOKEN; title: string }) {
  return (
    <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 120, height: 120, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={54} strokeWidth={0} paddingAngle={2}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.map(d => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#64748b' }}>{d.name}</span>
              </div>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                {d.value}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MetricsPage() {
  const { data: raw, isLoading, isError } = useQuery<ApiResponse<MetricsData>>({
    queryKey:        ['metrics'],
    queryFn:         fetchMetrics,
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const metrics = raw?.data
  const ks      = metrics?.key_stats

  // Transactions over time from volume_timeline (tx_count)
  const txTimeline = useMemo(() =>
    (metrics?.volume_timeline ?? []).map(p => ({
      time:  fmtHour(p.hour),
      txns:  p.tx_count,
      whale: p.whale_count,
    })),
    [metrics],
  )

  // Volume over time
  const volTimeline = useMemo(() =>
    (metrics?.volume_timeline ?? []).map(p => ({
      time:   fmtHour(p.hour),
      volume: Math.round(p.volume_sol),
    })),
    [metrics],
  )

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Metrics</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#374151' }}>
            Explore key on-chain metrics and trends.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {['Solana', '24H'].map(label => (
            <div
              key={label}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: '#141d2b', border: '1px solid #1f2937' }}
            >
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 9, color: '#4B5563' }}>▼</span>
            </div>
          ))}
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '5px 10px', borderRadius: 6, background: '#141d2b', border: '1px solid #1f2937', cursor: 'pointer', color: '#4B5563', display: 'flex', alignItems: 'center' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.46"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── 4 Stat cards ── */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, height: 100 }} className="animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div style={{ background: '#1a0a0e', border: '1px solid #f43f5e40', borderRadius: 8, padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#f43f5e' }}>
          Failed to load metrics — check API connection
        </div>
      ) : ks ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <BigStatCard
            label="Total Transactions"
            value={fmtNum(ks.total_txs_24h)}
            sub="last 24 hours"
            change="+12.45%"
          />
          <BigStatCard
            label="Total Volume"
            value={`${fmtSol(ks.total_vol_24h)} SOL`}
            sub={`whale: ${fmtSol(ks.whale_vol_24h)} SOL`}
            change="+6.21%"
          />
          <BigStatCard
            label="Active Wallets"
            value={fmtNum(ks.active_wallets_24h)}
            sub="unique senders / receivers"
            change="+9.14%"
          />
          <BigStatCard
            label="Anomalies Detected"
            value={fmtNum(ks.anomaly_count_24h)}
            sub={`wash bot ${ks.wash_bot_pct}% · sandwich ${ks.sandwich_pct}%`}
            change={`${ks.wash_bot_pct > 20 ? '⚠' : ''} ${ks.wash_bot_pct}% wash rate`}
            changeColor={ks.wash_bot_pct > 20 ? '#f97316' : '#22c55e'}
          />
        </div>
      ) : null}

      {/* ── Charts row 1: Transactions + Volume ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        <ChartShell title="Transactions Over Time" sub="count · 24h · live">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={txTimeline} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="2 6" stroke="#1a2537" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: '#374151', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false} tickLine={false} interval={3}
              />
              <YAxis
                tick={{ fill: '#374151', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false} tickLine={false}
                tickFormatter={fmtNum} width={44}
              />
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#22c55e' }}
                formatter={(v: unknown) => [fmtNum(Number(v)), 'Transactions']}
              />
              <Line type="monotone" dataKey="txns" stroke="#22c55e" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Volume Over Time" sub="SOL · 24h · live">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={volTimeline} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="metricsVolGrad" x1="0" y1="0" x2="0" y2="1">
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
              <Area type="monotone" dataKey="volume" stroke="#C08457" strokeWidth={1.5} fill="url(#metricsVolGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>

      {/* ── Charts row 2: Pie charts + Top Programs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

        <MiniPieChart data={VOL_BY_TOKEN} title="Volume By Token" />
        <MiniPieChart data={TX_BY_TYPE}   title="Transactions By Type" />

        {/* Top Programs By Activity */}
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Top Programs
            </span>
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 40px', padding: '7px 16px 4px', gap: 8 }}>
              {['PROGRAM', 'TXNS', '%'].map(h => (
                <span key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {TOP_PROGRAMS.map((p, i) => (
              <div key={p.program} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 40px', padding: '8px 16px', gap: 8, borderTop: '1px solid #1a2537', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>{p.program}</div>
                  <div style={{ height: 2, borderRadius: 2, background: '#1a2537', position: 'relative' }}>
                    <div style={{ height: 2, borderRadius: 2, background: '#C08457', width: `${p.pct * 3}%`, opacity: 1 - i * 0.1 }} />
                  </div>
                </div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', textAlign: 'right' }}>{p.txns}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#4B5563', textAlign: 'right' }}>{p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── EFFANT Edge ── */}
      {ks && (
        <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>EFFANT Edge</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} className="animate-pulse" />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#22c55e' }}>Live</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
            {[
              { label: 'Coordinated wallet clusters', value: 'Live',                              color: '#22c55e' },
              { label: 'Wash trading detection',      value: `${ks.wash_bot_pct}% of anomalies`, color: ks.wash_bot_pct > 20 ? '#f97316' : '#64748b' },
              { label: 'Sandwich attack rate',        value: `${ks.sandwich_pct}% of anomalies`, color: ks.sandwich_pct > 30 ? '#f43f5e' : '#64748b' },
              { label: 'Whale concentration index',   value: `${ks.whale_pct}% of volume`,       color: ks.whale_pct > 50  ? '#eab308' : '#64748b' },
            ].map((item, i) => (
              <div
                key={item.label}
                style={{ padding: '14px 16px', borderLeft: i > 0 ? '1px solid #1a2537' : 'none' }}
              >
                <p style={{ fontSize: 11, color: '#4B5563', marginBottom: 6, lineHeight: 1.4 }}>{item.label}</p>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
