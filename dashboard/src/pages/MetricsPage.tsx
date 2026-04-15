import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { fetchMetrics } from '../api/client'
import type { MetricsData, VolumePoint, AnomalyPoint } from '../api/client'
import type { ApiResponse } from '../api/client'

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
  vol:      '#475569',
  whale:    '#eab308',
  critical: '#f43f5e',
  high:     '#f97316',
  medium:   '#ca8a04',
  low:      '#334155',
  grid:     '#1a2030',
  tick:     '#3a4555',
  tooltip:  { bg: '#0b0f17', border: '#1a2030' },
}

// ── Shared chart props ────────────────────────────────────────────────────────

const axisProps = {
  tick: { fill: C.tick, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
  axisLine: false as const,
  tickLine: false as const,
}

const tooltipStyle = {
  contentStyle: {
    background: C.tooltip.bg,
    border: `1px solid ${C.tooltip.border}`,
    borderRadius: 6,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
  },
  itemStyle: { color: '#94a3b8' },
  labelStyle: { color: '#fff', marginBottom: 4 },
  cursor: { fill: 'rgba(139,150,168,0.05)' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHour(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtSol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toFixed(0)
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, highlight, warn,
}: {
  label: string; value: string; sub?: string; highlight?: boolean; warn?: boolean
}) {
  const valueColor = warn ? C.critical : highlight ? '#fff' : '#dde3ec'
  return (
    <div className="rounded p-4" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <p className="mono uppercase tracking-widest mb-2" style={{ color: 'var(--dim)', fontSize: 9 }}>{label}</p>
      <p className="mono font-bold tabular-nums" style={{ fontSize: 22, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p className="mono mt-1.5" style={{ color: 'var(--dim)', fontSize: 10 }}>{sub}</p>}
    </div>
  )
}

// ── Chart section wrapper ─────────────────────────────────────────────────────

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>{title}</span>
          {sub && <span className="ml-3 mono text-xs" style={{ color: 'var(--dim)', fontSize: 10 }}>{sub}</span>}
        </div>
        <span className="mono" style={{ color: 'var(--dim)', fontSize: 9 }}>24h · live</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Sidebar nav (mirrors Overview) ───────────────────────────────────────────

const sidebarBtnBase: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '7px 12px',
  borderRadius: 5,
  fontSize: 12,
  fontFamily: 'inherit',
  transition: 'background 0.12s, color 0.12s',
}

// ── Main component ────────────────────────────────────────────────────────────

interface MetricsPageProps {
  onGoOverview: () => void
}

export function MetricsPage({ onGoOverview }: MetricsPageProps) {
  const { data: raw, isLoading, isError } = useQuery<ApiResponse<MetricsData>>({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const metrics = raw?.data

  // Derive chart data
  const volumeData = useMemo(() =>
    (metrics?.volume_timeline ?? []).map((p: VolumePoint) => ({
      hour: fmtHour(p.hour),
      regular: Math.max(0, p.volume_sol - p.whale_vol),
      whale: p.whale_vol,
      txs: p.tx_count,
    })),
    [metrics?.volume_timeline]
  )

  const anomalyData = useMemo(() =>
    (metrics?.anomaly_timeline ?? []).map((p: AnomalyPoint) => ({
      hour: fmtHour(p.hour),
      critical: p.critical,
      high: p.high,
      medium: p.medium,
      low: p.low,
    })),
    [metrics?.anomaly_timeline]
  )

  const entityData = useMemo(() =>
    (metrics?.entity_breakdown ?? []).map(e => ({
      type: e.type.replace(/_/g, ' '),
      count: e.count,
    })),
    [metrics?.entity_breakdown]
  )

  const ks = metrics?.key_stats

  return (
    <div className="flex gap-6">

      {/* Sidebar */}
      <aside style={{ width: 152, flexShrink: 0 }}>
        <p className="mono uppercase tracking-widest px-3 mb-2" style={{ color: 'var(--dim)', fontSize: 9, paddingTop: 4 }}>
          Views
        </p>
        <nav className="flex flex-col gap-0.5">
          <button
            onClick={onGoOverview}
            style={{ ...sidebarBtnBase, color: 'var(--muted)' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(139,150,168,0.06)'
              e.currentTarget.style.color = 'var(--text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.color = 'var(--muted)'
            }}
          >
            Overview
          </button>
          <div style={{ ...sidebarBtnBase, background: 'rgba(139,150,168,0.09)', color: '#e2e8f0', cursor: 'default' }}>
            Metrics
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* Page header */}
        <div>
          <h1 className="font-semibold mb-0.5" style={{ color: '#fff', fontSize: 15 }}>Network Metrics</h1>
          <p className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
            Solana on-chain intelligence · refreshes every 60s
          </p>
        </div>

        {/* Key stats row */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded p-4 h-20 animate-pulse" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded px-5 py-4 mono text-xs" style={{ background: '#1a0a0e', border: '1px solid var(--red)', color: 'var(--red)' }}>
            Failed to load metrics — is the API reachable?
          </div>
        ) : ks ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Volume 24h"    value={`${fmtSol(ks.total_vol_24h)} SOL`}    sub="all transactions"             highlight />
            <StatCard label="Whale Volume"         value={`${fmtSol(ks.whale_vol_24h)} SOL`}    sub={`${ks.whale_pct}% of total`}  warn={ks.whale_pct > 50} />
            <StatCard label="Transactions 24h"     value={fmtNum(ks.total_txs_24h)}              sub="successful only" />
            <StatCard label="Active Wallets"        value={fmtNum(ks.active_wallets_24h)}        sub="unique senders/receivers" />
            <StatCard label="Anomalies Detected"   value={ks.anomaly_count_24h.toLocaleString()} sub="last 24 hours"               warn={ks.anomaly_count_24h > 50} />
            <StatCard label="Wash Bot Activity"    value={`${ks.wash_bot_pct}%`}                 sub="of total anomalies"           warn={ks.wash_bot_pct > 30} />
            <StatCard label="Sandwich Attacks"     value={`${ks.sandwich_pct}%`}                 sub="of total anomalies"           warn={ks.sandwich_pct > 20} />
            <StatCard label="Avg Tx Size"           value={ks.total_txs_24h > 0 ? `${fmtSol(ks.total_vol_24h / ks.total_txs_24h)} SOL` : '—'} sub="mean transaction" />
          </div>
        ) : null}

        {/* Volume chart */}
        <ChartCard title="Transaction Volume" sub="SOL · yellow = whale (≥500 SOL)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={volumeData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="2 4" stroke={C.grid} vertical={false} />
              <XAxis dataKey="hour" {...axisProps} interval={3} />
              <YAxis {...axisProps} tickFormatter={fmtSol} width={46} />
              <Tooltip
                {...tooltipStyle}
                formatter={(v: unknown, name: unknown) => [`${fmtSol(Number(v))} SOL`, name === 'whale' ? 'Whale' : 'Volume']}
              />
              <Bar dataKey="regular" stackId="v" fill={C.vol}   name="Volume"  radius={[0, 0, 0, 0]} />
              <Bar dataKey="whale"   stackId="v" fill={C.whale} name="Whale"   radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Anomaly chart */}
        <ChartCard title="Anomaly Detections" sub="stacked by severity">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={anomalyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="2 4" stroke={C.grid} vertical={false} />
              <XAxis dataKey="hour" {...axisProps} interval={3} />
              <YAxis {...axisProps} allowDecimals={false} width={30} />
              <Tooltip {...tooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', paddingTop: 8 }}
                formatter={(v: string) => <span style={{ color: 'var(--muted)' }}>{v}</span>}
              />
              <Bar dataKey="critical" stackId="a" fill={C.critical} name="Critical" radius={[0, 0, 0, 0]} />
              <Bar dataKey="high"     stackId="a" fill={C.high}     name="High"     />
              <Bar dataKey="medium"   stackId="a" fill={C.medium}   name="Medium"   />
              <Bar dataKey="low"      stackId="a" fill={C.low}      name="Low"      radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Bottom row: entity breakdown + EFFANT edge */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Entity distribution */}
          <ChartCard title="Entity Distribution" sub="labeled wallet types">
            {entityData.length === 0 ? (
              <p className="mono text-xs py-8 text-center" style={{ color: 'var(--dim)' }}>
                No entity data available yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={entityData}
                  layout="vertical"
                  margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke={C.grid} horizontal={false} />
                  <XAxis type="number" {...axisProps} tickFormatter={fmtNum} />
                  <YAxis
                    type="category"
                    dataKey="type"
                    width={90}
                    tick={{ fill: C.tick, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip {...tooltipStyle} formatter={(v: unknown) => [fmtNum(Number(v)), 'Wallets']} />
                  <Bar dataKey="count" fill="var(--accent)" radius={[0, 3, 3, 0]} name="Wallets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* EFFANT edge metrics */}
          <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>EFFANT Edge</span>
              <span className="ml-3 mono text-xs" style={{ color: 'var(--dim)', fontSize: 10 }}>
                signals not on Glassnode
              </span>
            </div>
            <div className="p-5 space-y-3">
              {[
                {
                  label: 'Coordinated wallet clusters',
                  desc:  'Wallets classified into behavior clusters via Louvain graph detection',
                  value: 'Live',
                  color: 'var(--green)',
                },
                {
                  label: 'Wash trading detection',
                  desc:  'Identifies circular volume between linked wallets within 48h windows',
                  value: ks ? `${ks.wash_bot_pct}% of anomalies` : '—',
                  color: ks && ks.wash_bot_pct > 30 ? C.critical : 'var(--muted)',
                },
                {
                  label: 'Sandwich attack rate',
                  desc:  'MEV-style front/back-run detection on DEX transactions',
                  value: ks ? `${ks.sandwich_pct}% of anomalies` : '—',
                  color: ks && ks.sandwich_pct > 20 ? C.high : 'var(--muted)',
                },
                {
                  label: 'Whale concentration index',
                  desc:  'Percentage of 24h volume attributable to wallets transacting ≥500 SOL',
                  value: ks ? `${ks.whale_pct}%` : '—',
                  color: ks && ks.whale_pct > 50 ? C.whale : 'var(--muted)',
                },
                {
                  label: 'Entity labeling pipeline',
                  desc:  'All wallets automatically classified: whale, defi, bot, exchange, etc.',
                  value: 'Live · 5min',
                  color: 'var(--green)',
                },
              ].map(item => (
                <div key={item.label} className="flex items-start justify-between gap-4 py-2"
                  style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium mb-0.5" style={{ color: '#dde3ec' }}>{item.label}</p>
                    <p className="mono" style={{ color: 'var(--dim)', fontSize: 10, lineHeight: 1.5 }}>{item.desc}</p>
                  </div>
                  <span className="mono shrink-0 text-xs font-semibold" style={{ color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
