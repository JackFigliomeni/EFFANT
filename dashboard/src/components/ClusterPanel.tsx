import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '../api/client'
import type { Cluster, ApiResponse } from '../api/client'

const TYPE_COLOR: Record<string, string> = {
  mev_bot:      '#f43f5e',
  wash_bot:     '#f97316',
  whale:        '#818cf8',
  exchange:     '#22c55e',
  defi_user:    '#38bdf8',
  defi_protocol:'#06b6d4',
  unknown:      '#475569',
}

function fmtVol(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(1)
}

function ClusterRow({ c, maxVol }: { c: Cluster; maxVol: number }) {
  const color = TYPE_COLOR[c.dominant_type ?? 'unknown'] ?? TYPE_COLOR.unknown
  const pct   = maxVol > 0 ? Math.min((c.total_volume / maxVol) * 100, 100) : 0

  return (
    <div className="py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="mono text-xs font-semibold" style={{ color }}>
            {(c.dominant_type ?? 'unknown').replace('_', ' ').toUpperCase()}
          </span>
          <span className="mono text-xs" style={{ color: 'var(--dim)' }}>#{c.id}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
            {c.wallet_count}w
          </span>
          <span className="mono text-xs font-semibold" style={{ color: '#fff' }}>
            {fmtVol(c.total_volume)} SOL
          </span>
        </div>
      </div>

      {/* Volume bar */}
      <div className="h-0.5 w-full rounded-full" style={{ background: 'var(--border2)' }}>
        <div className="h-0.5 rounded-full transition-all"
          style={{ width: `${pct}%`, background: color, opacity: 0.6 }} />
      </div>

      {/* Top wallets */}
      {c.top_wallets.length > 0 && (
        <div className="mt-1.5 flex gap-2">
          {c.top_wallets.slice(0, 3).map(w => (
            <span key={w.address} className="mono text-xs" style={{ color: 'var(--dim)' }}
              title={w.address}>
              {w.address.slice(0, 6)}…
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="py-2.5 space-y-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <div className="h-2.5 w-24 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
        <div className="h-2.5 w-16 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
      </div>
      <div className="h-0.5 w-full rounded animate-pulse" style={{ background: 'var(--border2)' }} />
    </div>
  )
}

export function ClusterPanel() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery<ApiResponse<Cluster[]>>({
    queryKey: ['clusters'],
    queryFn: () => fetchClusters(20),
    refetchInterval: 30_000,
  })

  const maxVol = data ? Math.max(...data.data.map(c => c.total_volume), 1) : 1

  return (
    <div className="flex flex-col rounded overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: 480 }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>
            Entity Clusters
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
            Failed to load cluster data
          </div>
        )}
        {data?.data.map(c => <ClusterRow key={c.id} c={c} maxVol={maxVol} />)}
      </div>

      {/* Footer */}
      {data && (
        <div className="px-4 py-2 text-xs mono" style={{ borderTop: '1px solid var(--border)', color: 'var(--dim)' }}>
          Showing {data.data.length} of {data.meta.total ?? data.meta.count} · Louvain algorithm
        </div>
      )}
    </div>
  )
}
