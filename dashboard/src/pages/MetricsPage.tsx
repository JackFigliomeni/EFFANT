import { useMemo, useRef, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import { fetchMetrics } from '../api/client'
import type { MetricsData, VolumePoint, AnomalyPoint } from '../api/client'
import type { ApiResponse } from '../api/client'

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
  up:       '#22c55e',
  down:     '#f43f5e',
  wick:     0.45,          // opacity for wicks
  critical: '#f43f5e',
  high:     '#f97316',
  medium:   '#ca8a04',
  low:      '#334155',
  grid:     '#1a2030',
  tick:     '#3a4555',
  tooltip:  { bg: '#0b0f17', border: '#1a2030' },
}

// ── Formatters ────────────────────────────────────────────────────────────────

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

// ── Custom SVG Candlestick Chart ──────────────────────────────────────────────

interface Candle {
  label: string
  open:  number
  close: number
  high:  number
  low:   number
  meta?: Record<string, string | number>
}

interface TooltipRow { label: string; value: string; color: string }

function CandlestickChart({
  data,
  height = 220,
  yFmt = fmtSol,
  tooltipRows,
}: {
  data: Candle[]
  height?: number
  yFmt?: (n: number) => string
  tooltipRows?: (c: Candle) => TooltipRow[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth]       = useState(600)
  const [hovered, setHovered]   = useState<number | null>(null)
  const [tipPos, setTipPos]     = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const PAD = { top: 14, right: 16, bottom: 28, left: 54 }
  const W = Math.max(10, width - PAD.left - PAD.right)
  const H = height - PAD.top - PAD.bottom

  const { scaleY, ticks, candleW } = useMemo(() => {
    if (!data.length) return { scaleY: (_: number) => 0, ticks: [], candleW: 8 }
    const vals = data.flatMap(d => [d.high, d.low])
    const rawMin = Math.min(...vals)
    const rawMax = Math.max(...vals)
    const pad    = (rawMax - rawMin) * 0.08 || 1
    const mn     = Math.max(0, rawMin - pad)
    const mx     = rawMax + pad
    const range  = mx - mn || 1
    const sy     = (v: number) => H - ((v - mn) / range) * H
    const step   = range / 4
    const tk     = Array.from({ length: 5 }, (_, i) => mn + step * i)
    const cw     = Math.max(3, Math.floor((W / data.length) * 0.55))
    return { scaleY: sy, ticks: tk, candleW: cw }
  }, [data, W, H])

  const scaleX = (i: number) => (i + 0.5) * (W / Math.max(data.length, 1))

  function handleMouseMove(e: React.MouseEvent<SVGGElement>) {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const rx   = e.clientX - rect.left - PAD.left
    const idx  = Math.floor((rx / W) * data.length)
    if (idx >= 0 && idx < data.length) {
      setHovered(idx)
      setTipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    } else {
      setHovered(null)
    }
  }

  const hc = hovered !== null ? data[hovered] : null

  return (
    <div ref={containerRef} style={{ height, position: 'relative', userSelect: 'none' }}>
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>

          {/* Grid + Y axis */}
          {ticks.map((v, i) => {
            const y = scaleY(v)
            return (
              <g key={i}>
                <line x1={0} x2={W} y1={y} y2={y} stroke={C.grid} strokeDasharray="2 5" />
                <text
                  x={-7} y={y + 3.5}
                  textAnchor="end"
                  fill={C.tick}
                  fontSize={10}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {yFmt(v)}
                </text>
              </g>
            )
          })}

          {/* Candles */}
          {data.map((d, i) => {
            const isUp  = d.close >= d.open
            const color = isUp ? C.up : C.down
            const cx    = scaleX(i)
            const openY = scaleY(d.open)
            const clsY  = scaleY(d.close)
            const hiY   = scaleY(d.high)
            const loY   = scaleY(d.low)
            const bTop  = Math.min(openY, clsY)
            const bH    = Math.max(1.5, Math.abs(openY - clsY))
            const isHov = hovered === i

            return (
              <g key={i} opacity={hovered !== null && !isHov ? 0.45 : 1}>
                {/* Upper wick */}
                <line
                  x1={cx} x2={cx} y1={hiY} y2={bTop}
                  stroke={color} strokeWidth={1.2} opacity={C.wick}
                />
                {/* Lower wick */}
                <line
                  x1={cx} x2={cx} y1={bTop + bH} y2={loY}
                  stroke={color} strokeWidth={1.2} opacity={C.wick}
                />
                {/* Body */}
                <rect
                  x={cx - candleW / 2} y={bTop}
                  width={candleW} height={bH}
                  fill={color} opacity={0.88}
                />
              </g>
            )
          })}

          {/* Crosshair on hover */}
          {hovered !== null && (
            <line
              x1={scaleX(hovered)} x2={scaleX(hovered)}
              y1={0} y2={H}
              stroke="rgba(255,255,255,0.12)" strokeWidth={1}
              strokeDasharray="3 4"
              pointerEvents="none"
            />
          )}

          {/* X axis labels */}
          {data.map((d, i) => {
            if (i % 4 !== 0) return null
            return (
              <text
                key={i}
                x={scaleX(i)} y={H + 18}
                textAnchor="middle"
                fill={C.tick} fontSize={10}
                fontFamily="JetBrains Mono, monospace"
              >
                {d.label}
              </text>
            )
          })}

          {/* Invisible hit area */}
          <rect
            x={0} y={0} width={W} height={H}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
          />
        </g>
      </svg>

      {/* Tooltip */}
      {hc && tooltipRows && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(tipPos.x + 12, width - 180),
            top: Math.max(tipPos.y - 60, 4),
            background: C.tooltip.bg,
            border: `1px solid ${C.tooltip.border}`,
            borderRadius: 6,
            padding: '8px 12px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <p className="mono" style={{ color: '#fff', fontSize: 11, marginBottom: 5 }}>{hc.label}</p>
          {tooltipRows(hc).map(r => (
            <div key={r.label} className="flex items-center gap-3 mono" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--dim)', minWidth: 48 }}>{r.label}</span>
              <span style={{ color: r.color }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

function ChartCard({ title, sub, children, legend }: {
  title: string; sub?: string; children: React.ReactNode; legend?: React.ReactNode
}) {
  return (
    <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>{title}</span>
          {sub && <span className="mono" style={{ color: 'var(--dim)', fontSize: 10 }}>{sub}</span>}
          {legend}
        </div>
        <span className="mono" style={{ color: 'var(--dim)', fontSize: 9 }}>24h · live</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Candlestick legend ────────────────────────────────────────────────────────

function CandleLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4">
      {items.map(it => (
        <div key={it.label} className="flex items-center gap-1.5 mono" style={{ fontSize: 10, color: 'var(--dim)' }}>
          <span className="rounded-sm inline-block" style={{ width: 8, height: 8, background: it.color, opacity: 0.9 }} />
          {it.label}
        </div>
      ))}
    </div>
  )
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

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

interface MetricsPageProps { onGoOverview: () => void }

export function MetricsPage({ onGoOverview }: MetricsPageProps) {
  const { data: raw, isLoading, isError } = useQuery<ApiResponse<MetricsData>>({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const metrics = raw?.data

  // ── Volume candlestick data ────────────────────────────────────────────────
  // Body:  open = prev hour total vol, close = this hour total vol
  // High:  close + whale_vol  (whale activity spikes the wick up)
  // Low:   max(0, close - whale_vol)  (wick dips below body)
  // Green = volume up vs prior hour, Red = volume down

  const volumeCandles: Candle[] = useMemo(() => {
    const pts: VolumePoint[] = metrics?.volume_timeline ?? []
    return pts.map((p, i) => {
      const prev  = pts[i - 1]
      const open  = prev ? prev.volume_sol : p.volume_sol * 0.97
      const close = p.volume_sol
      const high  = close + p.whale_vol * 0.5
      const low   = Math.max(0, close - p.whale_vol * 0.3)
      return {
        label: fmtHour(p.hour),
        open, close,
        high: Math.max(high, open, close),
        low:  Math.min(low,  open, close),
        meta: {
          'total':  fmtSol(close) + ' SOL',
          'whale':  fmtSol(p.whale_vol) + ' SOL',
          'txs':    p.tx_count.toLocaleString(),
        },
      }
    })
  }, [metrics?.volume_timeline])

  // ── Anomaly candlestick data ───────────────────────────────────────────────
  // Body:  open = prev hour total, close = this hour total
  // High:  close + critical  (critical anomalies spike wick up)
  // Low:   max(0, close - low_count)  (low severity pulls wick down)
  // Red = more anomalies, Green = fewer

  const anomalyCandles: Candle[] = useMemo(() => {
    const pts: AnomalyPoint[] = metrics?.anomaly_timeline ?? []
    return pts.map((p, i) => {
      const prev     = pts[i - 1]
      const total    = p.critical + p.high + p.medium + p.low
      const prevTot  = prev
        ? prev.critical + prev.high + prev.medium + prev.low
        : total * 0.97
      const high = total + p.critical
      const low  = Math.max(0, total - p.low)
      return {
        label: fmtHour(p.hour),
        open:  prevTot,
        close: total,
        high:  Math.max(high, prevTot, total),
        low:   Math.min(low,  prevTot, total),
        meta: {
          'critical': p.critical,
          'high':     p.high,
          'medium':   p.medium,
          'low':      p.low,
          'total':    total,
        },
      }
    })
  }, [metrics?.anomaly_timeline])

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
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,150,168,0.06)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none';                    e.currentTarget.style.color = 'var(--muted)' }}
          >
            Overview
          </button>
          <div style={{ ...sidebarBtnBase, background: 'rgba(139,150,168,0.09)', color: '#e2e8f0', cursor: 'default' }}>
            Metrics
          </div>
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-5">

        <div>
          <h1 className="font-semibold mb-0.5" style={{ color: '#fff', fontSize: 15 }}>Network Metrics</h1>
          <p className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
            Solana on-chain intelligence · refreshes every 60s
          </p>
        </div>

        {/* Stats */}
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
            <StatCard label="Total Volume 24h"  value={`${fmtSol(ks.total_vol_24h)} SOL`}  sub="all transactions"             highlight />
            <StatCard label="Whale Volume"       value={`${fmtSol(ks.whale_vol_24h)} SOL`}  sub={`${ks.whale_pct}% of total`}  warn={ks.whale_pct > 50} />
            <StatCard label="Transactions 24h"   value={fmtNum(ks.total_txs_24h)}            sub="successful only" />
            <StatCard label="Active Wallets"      value={fmtNum(ks.active_wallets_24h)}      sub="unique senders / receivers" />
            <StatCard label="Anomalies Detected" value={ks.anomaly_count_24h.toLocaleString()} sub="last 24 hours"             warn={ks.anomaly_count_24h > 50} />
            <StatCard label="Wash Bot Activity"  value={`${ks.wash_bot_pct}%`}               sub="of total anomalies"           warn={ks.wash_bot_pct > 30} />
            <StatCard label="Sandwich Attacks"   value={`${ks.sandwich_pct}%`}               sub="of total anomalies"           warn={ks.sandwich_pct > 20} />
            <StatCard label="Avg Tx Size"         value={ks.total_txs_24h > 0 ? `${fmtSol(ks.total_vol_24h / ks.total_txs_24h)} SOL` : '—'} sub="mean transaction" />
          </div>
        ) : null}

        {/* Volume candlestick */}
        <ChartCard
          title="Transaction Volume"
          sub="SOL · open/close vs prior hour · wick = whale range"
          legend={
            <CandleLegend items={[
              { color: C.up,   label: 'Vol up'    },
              { color: C.down, label: 'Vol down'  },
            ]} />
          }
        >
          <CandlestickChart
            data={volumeCandles}
            height={220}
            yFmt={fmtSol}
            tooltipRows={c => [
              { label: 'open',  value: fmtSol(c.open)  + ' SOL', color: '#94a3b8' },
              { label: 'close', value: fmtSol(c.close) + ' SOL', color: c.close >= c.open ? C.up : C.down },
              { label: 'high',  value: fmtSol(c.high)  + ' SOL', color: 'var(--dim)' },
              { label: 'low',   value: fmtSol(c.low)   + ' SOL', color: 'var(--dim)' },
              ...(c.meta ? [{ label: 'whale', value: String(c.meta.whale), color: '#eab308' }] : []),
            ]}
          />
        </ChartCard>

        {/* Anomaly candlestick */}
        <ChartCard
          title="Anomaly Detections"
          sub="count · open/close vs prior hour · wick = severity spread"
          legend={
            <CandleLegend items={[
              { color: C.up,       label: 'Less'     },
              { color: C.down,     label: 'More'     },
              { color: C.critical, label: 'Critical' },
            ]} />
          }
        >
          <CandlestickChart
            data={anomalyCandles}
            height={180}
            yFmt={n => n.toFixed(0)}
            tooltipRows={c => [
              { label: 'total',    value: String(c.close),                   color: c.close >= c.open ? C.down : C.up },
              { label: 'critical', value: String(c.meta?.critical ?? 0),     color: C.critical },
              { label: 'high',     value: String(c.meta?.high     ?? 0),     color: '#f97316'  },
              { label: 'medium',   value: String(c.meta?.medium   ?? 0),     color: '#ca8a04'  },
              { label: 'low',      value: String(c.meta?.low      ?? 0),     color: 'var(--dim)' },
            ]}
          />
        </ChartCard>

        {/* Bottom row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Entity distribution */}
          <ChartCard title="Entity Distribution" sub="labeled wallet types">
            {entityData.length === 0 ? (
              <p className="mono text-xs py-8 text-center" style={{ color: 'var(--dim)' }}>No entity data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={entityData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1a2030" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#3a4555', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={fmtNum}
                  />
                  <YAxis
                    type="category" dataKey="type" width={90}
                    tick={{ fill: '#3a4555', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0b0f17', border: '1px solid #1a2030', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    itemStyle={{ color: '#94a3b8' }}
                    labelStyle={{ color: '#fff' }}
                    cursor={{ fill: 'rgba(139,150,168,0.05)' }}
                    formatter={(v: unknown) => [fmtNum(Number(v)), 'Wallets']}
                  />
                  <Bar dataKey="count" fill="var(--accent)" radius={[0, 3, 3, 0]} name="Wallets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* EFFANT Edge */}
          <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>EFFANT Edge</span>
              <span className="ml-3 mono" style={{ color: 'var(--dim)', fontSize: 10 }}>signals not on Glassnode</span>
            </div>
            <div className="p-5 space-y-0">
              {[
                { label: 'Coordinated wallet clusters', desc: 'Wallets grouped via Louvain graph detection', value: 'Live', color: C.up },
                { label: 'Wash trading detection',      desc: 'Circular volume between linked wallets (48h)', value: ks ? `${ks.wash_bot_pct}% of anomalies`   : '—', color: ks && ks.wash_bot_pct  > 30 ? C.critical : 'var(--muted)' },
                { label: 'Sandwich attack rate',        desc: 'MEV front/back-run on DEX transactions',        value: ks ? `${ks.sandwich_pct}% of anomalies`   : '—', color: ks && ks.sandwich_pct  > 20 ? '#f97316'   : 'var(--muted)' },
                { label: 'Whale concentration index',   desc: '% of 24h volume from wallets ≥500 SOL',         value: ks ? `${ks.whale_pct}% of volume`         : '—', color: ks && ks.whale_pct     > 50 ? '#eab308'   : 'var(--muted)' },
                { label: 'Entity labeling pipeline',    desc: 'All wallets classified: whale/bot/defi/etc.',    value: 'Live · 5min',                                   color: C.up },
              ].map(item => (
                <div key={item.label} className="flex items-start justify-between gap-4 py-3"
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
