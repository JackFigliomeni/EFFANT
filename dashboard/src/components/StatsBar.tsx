import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '../api/client'
import type { HealthData } from '../api/client'

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: ok ? 'var(--green)' : 'var(--red)' }} />
  )
}

interface StatBlockProps {
  label: string
  value: string | number
  sub?: string
  highlight?: boolean
  danger?: boolean
}

function StatBlock({ label, value, sub, highlight, danger }: StatBlockProps) {
  const valueColor = danger ? 'var(--red)' : highlight ? '#fff' : '#cbd5e1'
  return (
    <div className="flex flex-col gap-1 px-5 py-4"
      style={{ borderRight: '1px solid var(--border)' }}>
      <span className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span className="mono font-semibold tabular-nums"
        style={{ fontSize: 22, color: valueColor, letterSpacing: '-0.02em' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</span>}
    </div>
  )
}

function StatBlockSkeleton() {
  return (
    <div className="px-5 py-4 space-y-2" style={{ borderRight: '1px solid var(--border)' }}>
      <div className="h-2.5 w-20 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
      <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
    </div>
  )
}

export function StatsBar() {
  const { data, isLoading, isError } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <div className="rounded border px-4 py-3 text-xs"
        style={{ borderColor: 'var(--red)', background: '#1a0a0e', color: 'var(--red)' }}>
        ✗  Cannot reach API at localhost:8000 — is the server running?
      </div>
    )
  }

  const db = data?.database
  const pipe = data?.pipeline
  const redis = data?.redis

  return (
    <div className="rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {/* Status strip */}
      <div className="flex items-center gap-5 px-5 py-2 text-xs"
        style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5">
          <Dot ok={!isLoading && data?.status === 'ok'} />
          {isLoading ? 'Connecting…' : `System ${data?.status ?? '?'}`}
        </span>
        <span className="flex items-center gap-1.5">
          <Dot ok={db?.connected ?? false} />
          PostgreSQL {db?.connected ? 'connected' : 'down'}
        </span>
        <span className="flex items-center gap-1.5">
          <Dot ok={redis?.connected ?? false} />
          Redis {redis?.connected ? redis.used_memory : 'down'}
        </span>
        <span className="flex items-center gap-1.5">
          <Dot ok={(pipe?.consecutive_failures ?? 0) === 0} />
          Pipeline {pipe ? relTime(pipe.last_success) : '…'}
        </span>
        <span className="ml-auto mono" style={{ color: 'var(--dim)' }}>
          {data ? new Date(data.time).toLocaleTimeString('en-US', { hour12: false }) : '—'}
        </span>
      </div>

      {/* Stat blocks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 last:[&>*]:border-r-0">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatBlockSkeleton key={i} />)
        ) : (
          <>
            <StatBlock label="Wallets" value={db?.wallets ?? 0} sub="indexed addresses" highlight />
            <StatBlock label="Transactions" value={db?.transactions ?? 0} sub="on-chain records" />
            <StatBlock label="Anomalies" value={db?.anomalies ?? 0} sub="detected events" danger={(db?.anomalies ?? 0) > 0} />
            <StatBlock label="Clusters" value={db?.clusters ?? 0} sub="entity groups ≥2" />
          </>
        )}
      </div>
    </div>
  )
}
