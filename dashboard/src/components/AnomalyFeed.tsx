import { useQuery } from '@tanstack/react-query'
import { fetchAnomalies } from '../api/client'
import type { Anomaly, ApiResponse } from '../api/client'

const SEV_COLOR: Record<string, string> = {
  critical: '#f43f5e',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#64748b',
}

const TYPE_SHORT: Record<string, string> = {
  sandwich_attack: 'SANDWICH',
  wash_trading:    'WASH',
  whale_movement:  'WHALE',
  volume_spike:    'SPIKE',
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function AnomalyRow({ a }: { a: Anomaly }) {
  const color = SEV_COLOR[a.severity] ?? SEV_COLOR.low
  return (
    <div className="flex items-start gap-3 py-2.5"
      style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Severity indicator */}
      <div className="mt-0.5 h-3 w-0.5 rounded-full shrink-0" style={{ background: color }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="mono text-xs font-semibold" style={{ color }}>
            {TYPE_SHORT[a.anomaly_type] ?? a.anomaly_type}
          </span>
          <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
            {a.wallet_address.slice(0, 8)}…{a.wallet_address.slice(-4)}
          </span>
          {a.wallet_label && a.wallet_label !== 'unknown' && (
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              {a.wallet_label}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          {a.description}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <div className="mono text-xs font-medium uppercase" style={{ color }}>
          {a.severity}
        </div>
        <div className="mono text-xs" style={{ color: 'var(--dim)' }}>
          {relTime(a.detected_at)}
        </div>
      </div>
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="h-3 w-0.5 rounded-full animate-pulse" style={{ background: 'var(--border2)' }} />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-32 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
        <div className="h-2.5 w-full rounded animate-pulse" style={{ background: 'var(--border2)' }} />
      </div>
    </div>
  )
}

export function AnomalyFeed() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery<ApiResponse<Anomaly[]>>({
    queryKey: ['anomalies'],
    queryFn: () => fetchAnomalies(50),
    refetchInterval: 30_000,
  })

  return (
    <div className="flex flex-col rounded overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: 480 }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>
            Anomaly Feed
          </span>
          {data && (
            <span className="mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--border2)', color: 'var(--muted)' }}>
              {data.meta.total ?? data.meta.count}
            </span>
          )}
        </div>
        <span className="mono text-xs" style={{ color: 'var(--dim)' }}>
          {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour12: false }) : '—'}
        </span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto px-4">
        {isLoading && Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
        {isError && (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--red)' }}>
            Failed to load anomalies
          </div>
        )}
        {data?.data.map(a => <AnomalyRow key={a.id} a={a} />)}
      </div>

      {/* Footer */}
      {data && (
        <div className="px-4 py-2 text-xs mono" style={{ borderTop: '1px solid var(--border)', color: 'var(--dim)' }}>
          Showing {data.data.length} · Live detection · 30s refresh
        </div>
      )}
    </div>
  )
}
