import { useQuery } from '@tanstack/react-query'
import { fetchClusterAnalysis } from '../api/client'
import { fetchSubscription } from '../api/billing'
import { isLoggedIn } from '../api/portal'
import type { Cluster } from '../api/client'

// ── CoinGecko price fetch (browser-side, zero egress cost) ───────────────────

interface PricePoint { t: number; price: number }

async function fetchSolPrice(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const from = Math.floor(new Date(fromIso).getTime() / 1000) - 3600
  const to   = Math.ceil(new Date(toIso).getTime()  / 1000) + 3600
  const url  = `https://api.coingecko.com/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${from}&to=${to}`
  const res  = await fetch(url)
  if (!res.ok) return []
  const json = await res.json()
  return (json.prices ?? []).map(([t, price]: [number, number]) => ({ t, price }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVol(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(1)
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function impactLabel(absPct: number) {
  if (absPct < 0.05) return { text: 'minimal',     color: '#64748b' }
  if (absPct < 0.25) return { text: 'notable',     color: '#f97316' }
  if (absPct < 0.75) return { text: 'significant', color: '#f43f5e' }
  return                    { text: 'major',        color: '#dc2626' }
}

const TYPE_COLOR: Record<string, string> = {
  mev_bot:      '#f43f5e',
  wash_bot:     '#f97316',
  whale:        '#818cf8',
  exchange:     '#22c55e',
  defi_user:    '#38bdf8',
  defi_protocol:'#06b6d4',
  unknown:      '#475569',
}

// ── SVG Timeline chart ────────────────────────────────────────────────────────

function TimelineChart({
  timeline,
  prices,
}: {
  timeline: { bucket: string; tx_count: number; volume_sol: number }[]
  prices: PricePoint[]
}) {
  if (!timeline.length) return (
    <div className="flex items-center justify-center mono text-xs"
      style={{ height: 180, color: 'var(--dim)' }}>
      No timeline data
    </div>
  )

  const W = 560
  const H = 160
  const PAD = { top: 12, right: 48, bottom: 28, left: 48 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top  - PAD.bottom

  const maxVol = Math.max(...timeline.map(b => b.volume_sol), 0.001)
  const barW   = Math.max(2, chartW / timeline.length - 1)

  // Price overlay — interpolate CoinGecko points onto bucket timestamps
  const bucketMs = timeline.map(b => new Date(b.bucket).getTime())
  const minT = bucketMs[0]
  const maxT = bucketMs[bucketMs.length - 1]

  const pricesInRange = prices.filter(p => p.t >= minT - 3_600_000 && p.t <= maxT + 3_600_000)
  const minPrice = pricesInRange.length ? Math.min(...pricesInRange.map(p => p.price)) : 0
  const maxPrice = pricesInRange.length ? Math.max(...pricesInRange.map(p => p.price)) : 1
  const priceRange = maxPrice - minPrice || 1

  function priceY(price: number) {
    return PAD.top + chartH - ((price - minPrice) / priceRange) * chartH
  }

  // Build SVG path for price line
  const linePts = pricesInRange.map(p => {
    const x = PAD.left + ((p.t - minT) / Math.max(maxT - minT, 1)) * chartW
    const y = priceY(p.price)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const linePath = linePts.length > 1 ? `M${linePts.join('L')}` : ''

  // X-axis labels — show first, middle, last
  const labelIdxs = timeline.length <= 3
    ? timeline.map((_, i) => i)
    : [0, Math.floor(timeline.length / 2), timeline.length - 1]

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {/* Y-axis labels (left = volume) */}
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end"
          style={{ fontSize: 9, fill: '#5b6cf8', fontFamily: 'monospace' }}>
          {fmtVol(maxVol)}
        </text>
        <text x={PAD.left - 4} y={PAD.top + chartH} textAnchor="end"
          style={{ fontSize: 9, fill: '#5b6cf8', fontFamily: 'monospace' }}>
          0
        </text>

        {/* Y-axis labels (right = price) */}
        {pricesInRange.length > 0 && (
          <>
            <text x={W - PAD.right + 4} y={PAD.top + 4} textAnchor="start"
              style={{ fontSize: 9, fill: '#fbbf24', fontFamily: 'monospace' }}>
              ${maxPrice.toFixed(0)}
            </text>
            <text x={W - PAD.right + 4} y={PAD.top + chartH} textAnchor="start"
              style={{ fontSize: 9, fill: '#fbbf24', fontFamily: 'monospace' }}>
              ${minPrice.toFixed(0)}
            </text>
          </>
        )}

        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1.0].map(frac => (
          <line key={frac}
            x1={PAD.left} y1={PAD.top + chartH * (1 - frac)}
            x2={W - PAD.right} y2={PAD.top + chartH * (1 - frac)}
            stroke="#1e2a3a" strokeWidth={1} />
        ))}

        {/* Volume bars */}
        {timeline.map((b, i) => {
          const barH = Math.max(1, (b.volume_sol / maxVol) * chartH)
          const x = PAD.left + (i / timeline.length) * chartW
          const y = PAD.top + chartH - barH
          return (
            <rect key={b.bucket} x={x} y={y} width={barW} height={barH}
              fill="#5b6cf8" opacity={0.65} rx={1} />
          )
        })}

        {/* SOL price line overlay */}
        {linePath && (
          <path d={linePath} fill="none" stroke="#fbbf24" strokeWidth={1.5} opacity={0.9} />
        )}

        {/* X-axis labels */}
        {labelIdxs.map(i => {
          const b = timeline[i]
          const x = PAD.left + ((i + 0.5) / timeline.length) * chartW
          return (
            <text key={i} x={x} y={H - 4} textAnchor="middle"
              style={{ fontSize: 9, fill: '#475569', fontFamily: 'monospace' }}>
              {fmtTime(b.bucket)}
            </text>
          )
        })}

        {/* Axis lines */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH}
          stroke="#1e2a3a" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + chartH} x2={W - PAD.right} y2={PAD.top + chartH}
          stroke="#1e2a3a" strokeWidth={1} />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mono text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>
        <div className="flex items-center gap-1.5">
          <div style={{ width: 10, height: 10, background: '#5b6cf8', opacity: 0.65, borderRadius: 2 }} />
          Volume (SOL)
        </div>
        {pricesInRange.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div style={{ width: 14, height: 2, background: '#fbbf24', borderRadius: 1 }} />
            SOL Price (USD)
          </div>
        )}
      </div>
    </div>
  )
}

// ── Paywall overlay ───────────────────────────────────────────────────────────

function PaywallOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(6px)',
      background: 'rgba(6,10,16,0.65)',
      zIndex: 10,
      borderRadius: 8,
    }}>
      <div className="rounded-xl p-6 text-center" style={{
        background: '#0c1020',
        border: '1px solid rgba(91,108,248,0.3)',
        boxShadow: '0 16px 48px #00000090',
        maxWidth: 300,
      }}>
        <h3 className="font-semibold text-sm mb-2" style={{ color: '#fff' }}>Pro Feature</h3>
        <p className="mono text-xs mb-5" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
          Market Impact Analysis is available on the <strong style={{ color: 'var(--accent)' }}>Pro plan</strong>.
          Upgrade to unlock transaction timelines, SOL price overlays, and coordinated-activity insights.
        </p>
        <a
          href="#"
          onClick={e => { e.preventDefault(); window.location.hash = 'portal' }}
          className="block w-full py-2.5 rounded-lg text-xs font-semibold mono transition-all"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Upgrade to Pro — $4,900 / mo
        </a>
        <p className="mono text-xs mt-3" style={{ color: 'var(--dim)' }}>
          500K API calls/mo · webhooks · full cluster intelligence
        </p>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ClusterAnalysisModal({
  cluster,
  onClose,
}: {
  cluster: Cluster
  onClose: () => void
}) {
  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn:  fetchSubscription,
    enabled:  isLoggedIn(),
    staleTime: 60_000,
  })

  const isPro = ['analyst', 'analyst_pro', 'fund', 'enterprise', 'pro'].includes(sub?.tier ?? '') && sub?.has_subscription === true

  const { data: analysisResp, isLoading: loadingAnalysis } = useQuery({
    queryKey: ['cluster-analysis', cluster.id],
    queryFn:  () => fetchClusterAnalysis(cluster.id),
    staleTime: 300_000,
  })

  const analysis = analysisResp?.data ?? null

  // Fetch CoinGecko price — only when we have a time window
  const { data: prices = [] } = useQuery<PricePoint[]>({
    queryKey: ['sol-price', analysis?.first_tx, analysis?.last_tx],
    queryFn:  () => fetchSolPrice(analysis!.first_tx!, analysis!.last_tx!),
    enabled:  isPro && !!analysis?.first_tx && !!analysis?.last_tx,
    staleTime: 600_000,
    retry: false,
  })

  // Price change over the cluster's activity window
  let priceChangePct: number | null = null
  let priceAtStart: number | null   = null
  let priceAtEnd:   number | null   = null
  if (prices.length >= 2 && analysis?.first_tx && analysis?.last_tx) {
    const startMs = new Date(analysis.first_tx).getTime()
    const endMs   = new Date(analysis.last_tx).getTime()
    const closest = (target: number) =>
      prices.reduce((prev, cur) =>
        Math.abs(cur.t - target) < Math.abs(prev.t - target) ? cur : prev
      )
    priceAtStart    = closest(startMs).price
    priceAtEnd      = closest(endMs).price
    priceChangePct  = ((priceAtEnd - priceAtStart) / priceAtStart) * 100
  }

  const typeColor = TYPE_COLOR[cluster.dominant_type ?? 'unknown'] ?? TYPE_COLOR.unknown

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl overflow-hidden flex flex-col w-full"
        style={{
          background: '#060a10',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 80px #00000090',
          maxWidth: 680,
          maxHeight: '92vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="mono text-xs font-semibold uppercase" style={{ color: typeColor }}>
                {(cluster.dominant_type ?? 'unknown').replace('_', ' ')}
              </span>
              <span className="mono text-xs" style={{ color: 'var(--dim)' }}>#{cluster.id}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-sm font-bold" style={{ color: '#fff' }}>
                {fmtVol(cluster.total_volume)} SOL
              </span>
              <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
                {cluster.wallet_count}w
              </span>
              {analysis?.duration_minutes != null && (
                <span className="mono text-xs" style={{ color: 'var(--dim)' }}>
                  {analysis.duration_minutes < 60
                    ? `${analysis.duration_minutes}m window`
                    : `${(analysis.duration_minutes / 60).toFixed(1)}h window`}
                </span>
              )}
              {analysis?.first_tx && (
                <span className="mono text-xs" style={{ color: 'var(--dim)' }}>
                  {fmtDate(analysis.first_tx)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="mono text-xs px-2.5 py-1 rounded shrink-0 ml-4"
            style={{ border: '1px solid var(--border)', color: 'var(--dim)' }}
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ position: 'relative' }}>

          {/* Pro paywall sits over the whole body */}
          {!isPro && <PaywallOverlay />}

          {/* ── Stats row ── */}
          {analysis && (
            <div className="grid grid-cols-4 gap-3">
              {[
                {
                  label: 'Peak Bucket',
                  value: analysis.peak_bucket ? fmtTime(analysis.peak_bucket.bucket) : '—',
                  sub: analysis.peak_bucket ? `${fmtVol(analysis.peak_bucket.volume_sol)} SOL` : '',
                },
                {
                  label: 'Duration',
                  value: analysis.duration_minutes != null
                    ? analysis.duration_minutes < 60
                      ? `${analysis.duration_minutes}m`
                      : `${(analysis.duration_minutes / 60).toFixed(1)}h`
                    : '< 5m',
                  sub: `${analysis.timeline.length} buckets`,
                },
                {
                  label: 'SOL Price Δ',
                  value: priceChangePct != null
                    ? `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%`
                    : '—',
                  sub: priceAtStart != null && priceAtEnd != null
                    ? `$${priceAtStart.toFixed(0)} → $${priceAtEnd.toFixed(0)}`
                    : 'loading…',
                  color: priceChangePct != null
                    ? priceChangePct >= 0 ? '#22c55e' : '#f43f5e'
                    : undefined,
                },
                {
                  label: 'Impact Level',
                  value: priceChangePct != null
                    ? impactLabel(Math.abs(priceChangePct)).text
                    : '—',
                  color: priceChangePct != null
                    ? impactLabel(Math.abs(priceChangePct)).color
                    : undefined,
                  sub: priceChangePct != null ? 'vs SOL move' : '',
                },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="rounded-lg p-3"
                  style={{ background: '#0c1020', border: '1px solid var(--border)' }}>
                  <p className="mono text-xs uppercase tracking-widest mb-1"
                    style={{ color: 'var(--dim)', fontSize: 9 }}>{label}</p>
                  <p className="mono text-sm font-bold" style={{ color: color ?? '#fff' }}>{value}</p>
                  {sub && (
                    <p className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{sub}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Timeline chart ── */}
          <div>
            <p className="mono text-xs uppercase tracking-widest mb-3"
              style={{ color: 'var(--dim)', fontSize: 10 }}>
              Transaction Activity + SOL Price
            </p>
            {loadingAnalysis ? (
              <div className="rounded animate-pulse"
                style={{ height: 180, background: 'var(--border2)' }} />
            ) : analysis?.timeline.length ? (
              <TimelineChart timeline={analysis.timeline} prices={prices} />
            ) : (
              <div className="flex items-center justify-center mono text-xs rounded"
                style={{ height: 100, background: '#0c1020', color: 'var(--dim)', border: '1px solid var(--border)' }}>
                No transaction data in current window
              </div>
            )}
          </div>

          {/* ── Top protocols ── */}
          {analysis?.top_programs && analysis.top_programs.length > 0 && (
            <div>
              <p className="mono text-xs uppercase tracking-widest mb-3"
                style={{ color: 'var(--dim)', fontSize: 10 }}>Top Protocols</p>
              <div className="space-y-2">
                {analysis.top_programs.map(p => (
                  <div key={p.program_id} className="flex items-center gap-3">
                    <span className="mono text-xs shrink-0" style={{ color: '#fff', minWidth: 110 }}>
                      {p.label}
                    </span>
                    <div className="flex-1 rounded-full overflow-hidden"
                      style={{ height: 4, background: 'var(--border2)' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${p.pct}%`, background: 'var(--accent)', opacity: 0.8 }} />
                    </div>
                    <span className="mono text-xs shrink-0" style={{ color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}>
                      {p.count.toLocaleString()} · {p.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Market context narrative ── */}
          {analysis && (
            <div className="rounded-lg p-4"
              style={{ background: '#0c1020', border: '1px solid var(--border)' }}>
              <p className="mono text-xs uppercase tracking-widest mb-2"
                style={{ color: 'var(--dim)', fontSize: 10 }}>Market Context</p>
              <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
                {analysis.wallet_count} coordinated wallets moved{' '}
                <strong style={{ color: '#fff' }}>{fmtVol(analysis.total_volume)} SOL</strong>
                {analysis.top_programs[0] && (
                  <> primarily through{' '}
                    <strong style={{ color: 'var(--accent)' }}>{analysis.top_programs[0].label}</strong>
                  </>
                )}
                {analysis.duration_minutes != null && (
                  <> over a{' '}
                    <strong style={{ color: '#fff' }}>
                      {analysis.duration_minutes < 60
                        ? `${analysis.duration_minutes}-minute`
                        : `${(analysis.duration_minutes / 60).toFixed(1)}-hour`}
                    </strong> window
                  </>
                )}.
                {priceChangePct != null && (
                  <> SOL price {priceChangePct >= 0 ? 'rose' : 'fell'}{' '}
                    <strong style={{ color: priceChangePct >= 0 ? '#22c55e' : '#f43f5e' }}>
                      {Math.abs(priceChangePct).toFixed(2)}%
                    </strong>{' '}
                    ({impactLabel(Math.abs(priceChangePct)).text} impact) during this activity window.
                  </>
                )}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
