import { useState, useRef } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchWallet, fetchWalletTxs, fetchWalletAnomalies } from '../api/client'
import type { WalletProfile, Transaction, WalletAnomaly, ApiResponse } from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function trunc(s: string | null, a = 8, b = 6) {
  if (!s) return '—'
  if (s.length <= a + b + 3) return s
  return `${s.slice(0, a)}…${s.slice(-b)}`
}

function fmtSol(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(3)}K`
  return n.toFixed(4)
}

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function isValidAddr(a: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim())
}

// ── Small primitives ──────────────────────────────────────────────────────────

const ENTITY_COLOR: Record<string, string> = {
  mev_bot:      '#f43f5e',
  wash_bot:     '#f97316',
  whale:        '#818cf8',
  exchange:     '#22c55e',
  defi_user:    '#38bdf8',
  defi_protocol:'#06b6d4',
  unknown:      '#475569',
  system:       '#334155',
}

const SEV_COLOR: Record<string, string> = {
  critical: '#f43f5e',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#64748b',
}

const TYPE_LABEL: Record<string, string> = {
  sandwich_attack: 'Sandwich Attack',
  wash_trading:    'Wash Trading',
  whale_movement:  'Whale Movement',
  volume_spike:    'Volume Spike',
}

function EntityTag({ type }: { type: string | null }) {
  const t = type ?? 'unknown'
  const c = ENTITY_COLOR[t] ?? ENTITY_COLOR.unknown
  return (
    <span className="mono text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm"
      style={{ color: c, background: `${c}18`, border: `1px solid ${c}40` }}>
      {t.replace('_', ' ')}
    </span>
  )
}

function RiskBar({ score }: { score: number | null }) {
  const pct = score != null ? Math.min(Math.max(score * 100, 0), 100) : null
  const color =
    pct == null  ? 'var(--dim)' :
    pct >= 75    ? '#f43f5e' :
    pct >= 50    ? '#f97316' :
    pct >= 25    ? '#eab308' :
                   '#22c55e'
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
          Risk Score
        </span>
        <span className="mono text-xs font-semibold" style={{ color: pct != null ? color : 'var(--dim)' }}>
          {pct != null ? `${pct.toFixed(0)} / 100` : 'N/A'}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--border2)' }}>
        <div className="h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
    </div>
  )
}

// ── Data cell ─────────────────────────────────────────────────────────────────

function Cell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="px-4 py-3" style={{ borderRight: '1px solid var(--border)' }}>
      <div className="mono text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="mono font-semibold tabular-nums" style={{ fontSize: 16, color: color ?? '#fff' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

// ── Anomaly alert row ─────────────────────────────────────────────────────────

function AnomalyRow({ a }: { a: WalletAnomaly }) {
  const color = SEV_COLOR[a.severity] ?? SEV_COLOR.low
  return (
    <div className="flex items-start gap-3 px-4 py-3"
      style={{ borderBottom: '1px solid var(--border)', background: `${color}08` }}>
      <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="mono text-xs font-semibold uppercase tracking-wide" style={{ color }}>
            {TYPE_LABEL[a.anomaly_type] ?? a.anomaly_type}
          </span>
          <span className="mono text-xs" style={{ color: 'var(--dim)' }}>
            {relTime(a.detected_at)}
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{a.description}</p>
      </div>
      <span className="mono text-xs font-bold uppercase shrink-0" style={{ color }}>
        {a.severity}
      </span>
    </div>
  )
}

// ── Tx table row ──────────────────────────────────────────────────────────────

function TxRow({ tx, address }: { tx: Transaction; address: string }) {
  const isOut   = tx.from_wallet === address
  const counter = isOut ? tx.to_wallet : tx.from_wallet
  const label   = isOut ? tx.to_label  : tx.from_label
  const amtColor = isOut ? '#f43f5e' : '#22c55e'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}
      className="group transition-colors hover:bg-white/[0.02]">
      <td className="py-2 px-3 mono text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {fmtTs(tx.block_time)}
      </td>
      <td className="py-2 px-3">
        <span className="mono text-xs font-bold uppercase"
          style={{ color: amtColor }}>
          {isOut ? '▼ OUT' : '▲ IN'}
        </span>
      </td>
      <td className="py-2 px-3 mono text-xs">
        <span style={{ color: 'var(--text)' }}>{trunc(counter, 8, 4)}</span>
        {label && label !== 'unknown' && (
          <span className="ml-2" style={{ color: 'var(--dim)' }}>{label}</span>
        )}
      </td>
      <td className="py-2 px-3 mono text-xs font-semibold text-right whitespace-nowrap"
        style={{ color: amtColor }}>
        {isOut ? '−' : '+'}{fmtSol(tx.amount_sol)} SOL
      </td>
      <td className="py-2 px-3 mono text-xs text-right whitespace-nowrap"
        style={{ color: 'var(--dim)' }}>
        {(tx.fee * 1e9).toFixed(0)} lam
      </td>
      <td className="py-2 px-3 text-center">
        <span style={{ color: tx.success ? '#22c55e' : '#f43f5e', fontSize: 11 }}>
          {tx.success ? '✓' : '✗'}
        </span>
      </td>
      <td className="py-2 px-3">
        <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer"
          className="mono text-xs transition-colors"
          style={{ color: 'var(--dim)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
          {tx.signature.slice(0, 10)}…↗
        </a>
      </td>
    </tr>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Pulse({ w, h = 2.5 }: { w: number | string; h?: number }) {
  return (
    <div className="rounded animate-pulse"
      style={{ width: w, height: h * 4, background: 'var(--border2)' }} />
  )
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex gap-3"><Pulse w={80} /><Pulse w={120} /></div>
      <div className="grid grid-cols-4" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
        {[1,2,3,4].map(i => (
          <div key={i} className="px-4 py-3" style={{ borderRight: '1px solid var(--border)' }}>
            <Pulse w={60} /><div className="mt-2"><Pulse w={80} h={4} /></div>
          </div>
        ))}
      </div>
      <Pulse w="100%" h={1.5} />
    </div>
  )
}

// ── Wallet detail ─────────────────────────────────────────────────────────────

function WalletDetail({ address }: { address: string }) {
  const { data: profileRes, isLoading, isError } = useQuery<ApiResponse<WalletProfile>>({
    queryKey: ['wallet', address],
    queryFn: () => fetchWallet(address),
  })

  const { data: txRes, isLoading: txLoading } = useQuery<ApiResponse<Transaction[]>>({
    queryKey: ['wallet-txs', address],
    queryFn: () => fetchWalletTxs(address, 20),
    enabled: !!profileRes,
  })

  const { data: anomalyRes } = useQuery<ApiResponse<WalletAnomaly[]>>({
    queryKey: ['wallet-anomalies', address],
    queryFn: () => fetchWalletAnomalies(address),
    enabled: !!profileRes,
  })

  if (isLoading) {
    return (
      <div className="rounded p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <ProfileSkeleton />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded px-5 py-8 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="mono text-sm font-semibold mb-1" style={{ color: 'var(--red)' }}>
          NOT INDEXED
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          <span className="mono">{trunc(address, 12, 8)}</span> has not been seen on-chain recently.
        </p>
      </div>
    )
  }

  const p         = profileRes!.data
  const txs       = txRes?.data ?? []
  const anomalies = (anomalyRes?.data ?? []).sort((a, b) => {
    const o: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return (o[a.severity] ?? 4) - (o[b.severity] ?? 4)
  })

  const hasAlerts = anomalies.length > 0

  return (
    <div className="space-y-3">

      {/* ── Anomaly alerts ── */}
      {hasAlerts && (
        <div className="rounded overflow-hidden"
          style={{ border: '1px solid #f43f5e40', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)', background: '#f43f5e0a' }}>
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: '#f43f5e' }} />
            <span className="mono text-xs font-bold uppercase tracking-widest" style={{ color: '#f43f5e' }}>
              {anomalies.length} Anomaly {anomalies.length === 1 ? 'Flag' : 'Flags'}
            </span>
          </div>
          {anomalies.map(a => <AnomalyRow key={a.id} a={a} />)}
        </div>
      )}

      {/* ── Profile ── */}
      <div className="rounded overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <EntityTag type={p.entity_type} />
              {p.label && p.label !== 'unknown' && (
                <span className="text-sm font-semibold" style={{ color: '#fff' }}>{p.label}</span>
              )}
              {hasAlerts && (
                <span className="mono text-xs px-1.5 py-0.5 rounded"
                  style={{ color: '#f43f5e', background: '#f43f5e18', border: '1px solid #f43f5e40' }}>
                  {anomalies.length} flag{anomalies.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{p.address}</p>
          </div>
          <div className="text-right">
            <p className="mono text-xs" style={{ color: 'var(--dim)' }}>First seen {relTime(p.first_seen)}</p>
            <p className="mono text-xs" style={{ color: 'var(--dim)' }}>Last active {relTime(p.last_seen)}</p>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 last:[&>*]:border-r-0">
          <Cell label="24h Volume"    value={`${fmtSol(p.volume_24h_sol)} SOL`} />
          <Cell label="Total Volume"  value={`${fmtSol(p.total_volume_sol)} SOL`} />
          <Cell label="Transactions"  value={p.tx_count} />
          <Cell label="Anomalies"     value={p.anomaly_count}
            color={p.anomaly_count > 0 ? '#f43f5e' : 'var(--dim)'} />
        </div>

        {/* Risk + cluster */}
        <div className="px-5 py-4 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
          <RiskBar score={p.risk_score} />

          {p.cluster && (
            <div className="rounded px-3 py-2.5"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <span className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                Cluster
              </span>
              <div className="flex flex-wrap items-center gap-3 mt-1.5">
                <span className="mono text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                  #{p.cluster.id}
                </span>
                <span className="text-xs" style={{ color: 'var(--text)' }}>{p.cluster.name}</span>
                <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
                  {p.cluster.wallet_count} wallets
                </span>
                {p.cluster.total_volume != null && (
                  <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
                    {fmtSol(p.cluster.total_volume)} SOL cluster vol
                  </span>
                )}
                {p.cluster.dominant_type && <EntityTag type={p.cluster.dominant_type} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Transaction table ── */}
      <div className="rounded overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>
            Transaction History
          </span>
          <span className="mono text-xs" style={{ color: 'var(--dim)' }}>
            Last {txs.length} txs
          </span>
        </div>

        {txLoading ? (
          <div className="px-4 py-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Pulse w={120} /><Pulse w={40} /><Pulse w={140} /><Pulse w={80} />
              </div>
            ))}
          </div>
        ) : txs.length === 0 ? (
          <p className="py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>
            No transactions found for this address.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  {['Time (UTC)', 'Dir', 'Counterparty', 'Amount', 'Fee', 'OK', 'Sig'].map(h => (
                    <th key={h} className="py-2 px-3 mono text-xs uppercase tracking-widest"
                      style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txs.map(tx => <TxRow key={tx.signature} tx={tx} address={address} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEMO = [
  '6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
]

export function WalletExplorer() {
  const [input, setInput]     = useState('')
  const [address, setAddress] = useState('')
  const [error, setError]     = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = input.trim()
    if (!v) return
    if (!isValidAddr(v)) { setError('Invalid base58 address'); return }
    setError('')
    setAddress(v)
  }

  function loadDemo(addr: string) {
    setInput(addr)
    setAddress(addr)
    setError('')
  }

  return (
    <div className="space-y-4">

      {/* Search */}
      <div className="rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            Wallet Lookup
          </span>
        </div>
        <div className="px-4 py-4">
          <form onSubmit={submit} className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setError('') }}
              placeholder="Enter a Solana wallet address…"
              spellCheck={false}
              autoComplete="off"
              className="mono flex-1 rounded px-3 py-2.5 text-sm outline-none transition-colors"
              style={{
                background: 'var(--surface2)',
                border: `1px solid ${error ? 'var(--red)' : 'var(--border2)'}`,
                color: 'var(--text)',
              }}
              onFocus={e => !error && (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => !error && (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
            <button type="submit"
              className="rounded px-5 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors"
              style={{ background: 'var(--accent)', color: '#fff' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
              Search
            </button>
          </form>
          {error && (
            <p className="mono text-xs mt-1.5" style={{ color: 'var(--red)' }}>{error}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="text-xs" style={{ color: 'var(--dim)' }}>Try:</span>
            {DEMO.map(addr => (
              <button key={addr} onClick={() => loadDemo(addr)}
                className="mono text-xs transition-colors"
                style={{ color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                {trunc(addr, 10, 6)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result or empty state */}
      {address
        ? <WalletDetail address={address} />
        : (
          <div className="rounded py-20 text-center"
            style={{ border: '1px dashed var(--border2)' }}>
            <p className="mono text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--dim)' }}>
              No address selected
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Paste any Solana wallet address above to inspect it
            </p>
          </div>
        )
      }
    </div>
  )
}
