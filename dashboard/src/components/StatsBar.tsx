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

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
      style={{ background: ok ? 'var(--green)' : 'var(--red)' }}
    />
  )
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <StatusDot ok={ok} />
      <span style={{ color: ok ? 'var(--muted)' : 'var(--red)' }}>{label}</span>
    </span>
  )
}

interface MetricProps {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
  warn?: boolean
}

function Metric({ label, value, sub, accent, warn }: MetricProps) {
  const valueColor = warn ? 'var(--red)' : accent ? '#fff' : '#e2e8f0'
  return (
    <div
      className="flex flex-col gap-1.5 px-6 py-4"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      <span
        className="mono text-xs uppercase tracking-widest"
        style={{ color: 'var(--dim)', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <span
        className="mono font-bold tabular-nums"
        style={{ fontSize: 26, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1 }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: 'var(--dim)' }}>{sub}</span>
      )}
    </div>
  )
}

function MetricSkeleton() {
  return (
    <div className="px-6 py-4 space-y-2" style={{ borderRight: '1px solid var(--border)' }}>
      <div className="h-2 w-16 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
      <div className="h-7 w-24 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
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
      <div
        className="rounded px-5 py-3 mono text-xs flex items-center gap-3"
        style={{ borderColor: 'var(--red)', background: '#1a0a0e', color: 'var(--red)', border: '1px solid var(--red)' }}
      >
        <StatusDot ok={false} />
        Cannot reach API at {import.meta.env.VITE_API_URL || 'localhost:8000'} — is the server running?
      </div>
    )
  }

  const db   = data?.database
  const pipe = data?.pipeline
  const redis = data?.redis
  const systemOk = !isLoading && data?.status === 'ok'

  return (
    <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* Terminal-style status bar */}
      <div
        className="flex items-center gap-6 px-6 py-2.5 mono text-xs"
        style={{ borderBottom: '1px solid var(--border)', background: '#0a0d14' }}
      >
        <span className="font-semibold tracking-widest" style={{ color: 'var(--accent)', fontSize: 11 }}>
          EFFANT.INTELLIGENCE
        </span>
        <div className="flex items-center gap-5" style={{ color: 'var(--muted)' }}>
          <StatusChip ok={systemOk} label={isLoading ? 'connecting…' : `System ${data?.status ?? '?'}`} />
          <StatusChip ok={db?.connected ?? false} label={`PostgreSQL ${db?.connected ? 'connected' : 'down'}`} />
          <StatusChip ok={redis?.connected ?? false} label={`Redis ${redis?.connected ? redis.used_memory : 'down'}`} />
          <StatusChip
            ok={(pipe?.consecutive_failures ?? 0) === 0}
            label={`Pipeline ${pipe ? relTime(pipe.last_success) : '—'}`}
          />
        </div>
        <span className="ml-auto tabular-nums" style={{ color: 'var(--dim)' }}>
          {data ? new Date(data.time).toLocaleTimeString('en-US', { hour12: false }) : '—'}
        </span>
      </div>

      {/* Metric blocks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 [&>*:last-child]:border-r-0">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricSkeleton key={i} />)
        ) : (
          <>
            <Metric label="Wallets" value={db?.wallets ?? 0} sub="indexed addresses" accent />
            <Metric label="Transactions" value={db?.transactions ?? 0} sub="on-chain records" />
            <Metric label="Anomalies" value={db?.anomalies ?? 0} sub="detected events" warn={(db?.anomalies ?? 0) > 0} />
            <Metric label="Clusters" value={db?.clusters ?? 0} sub="entity groups ≥2" />
          </>
        )}
      </div>
    </div>
  )
}
