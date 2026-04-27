import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMe, isLoggedIn } from '../api/portal'
import type { MeData } from '../api/portal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOKENS   = ['SOL', 'USDC', 'BONK', 'JUP', 'RAY', 'MSOL', 'WIF', 'PYTH'] as const
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
  id:        string
  time:      string
  sig:       string
  sigFull:   string
  type:      string
  from:      string
  fromFull:  string
  to:        string
  toFull:    string
  token:     string
  value:     string
  usd:       string
  slot:      number
  blockTime: string
  fee:       string
  success:   boolean
}

function genTx(): LiveTx {
  const type  = TX_TYPES[Math.floor(Math.random() * TX_TYPES.length)]
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)]
  const raw   =
    token === 'SOL'  ? Math.random() * 500 + 0.5 :
    token === 'USDC' ? Math.random() * 50000 + 100 :
    token === 'PYTH' ? Math.random() * 5000 + 10 :
                       Math.random() * 1_000_000 + 10_000
  const usdRaw =
    token === 'SOL'  ? raw * 162.35 :
    token === 'USDC' ? raw :
    token === 'JUP'  ? raw * 0.75 :
    token === 'RAY'  ? raw * 2.4 :
    token === 'PYTH' ? raw * 0.38 :
    token === 'MSOL' ? raw * 180 :
                       raw * 0.000018

  const fmtVal = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
    n >= 1_000     ? `${(n / 1_000).toFixed(0)}K` :
    token === 'SOL' ? n.toFixed(2) : n.toFixed(0)

  const fromAddr = randB58(44)
  const toAddr   = randB58(44)
  const sigFull  = randB58(87) + 'A'

  return {
    id:        Math.random().toString(36).slice(2),
    time:      new Date().toLocaleTimeString('en-US', { hour12: false }),
    sig:       sigFull.slice(0, 4) + '...' + sigFull.slice(-3),
    sigFull,
    type,
    from:      fromAddr.slice(0, 4) + '...' + fromAddr.slice(-3),
    fromFull:  fromAddr,
    to:        toAddr.slice(0, 4) + '...' + toAddr.slice(-3),
    toFull:    toAddr,
    token,
    value:     fmtVal(raw),
    usd:       usdRaw >= 1_000 ? `$${(usdRaw / 1_000).toFixed(1)}K` : `$${usdRaw.toFixed(0)}`,
    slot:      Math.floor(Math.random() * 1000) + 245_987_000,
    blockTime: new Date().toISOString(),
    fee:       '0.000005 SOL',
    success:   Math.random() > 0.03,
  }
}

// ── Paywall ───────────────────────────────────────────────────────────────────

function LoginWall({ onGoPortal }: { onGoPortal: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 12, padding: 32, textAlign: 'center', maxWidth: 380, width: '100%' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(192,132,87,0.15)', border: '1px solid rgba(192,132,87,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C08457" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>API Terminal</h2>
        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 20 }}>
          Sign in to run live requests against the EFFANT API. Your key is pre-filled automatically.
        </p>
        <button
          onClick={onGoPortal}
          style={{ width: '100%', padding: '10px 0', borderRadius: 8, background: '#C08457', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600 }}
        >
          Sign in → API Portal
        </button>
      </div>
    </div>
  )
}

function UpgradeWall({ onGoPortal, tier }: { onGoPortal: () => void; tier: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#141d2b', border: '1px solid #1f2937', borderRadius: 12, padding: 32, textAlign: 'center', maxWidth: 420, width: '100%' }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(192,132,87,0.1)', border: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>Terminal requires Analyst</h2>
        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 8 }}>
          The API Terminal is available on the Analyst plan ($100/mo) and above. Run live queries, test endpoints, and inspect responses directly.
        </p>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#4B5563', marginBottom: 20 }}>
          Current plan: <span style={{ color: '#C08457' }}>{tier}</span>
        </p>
        <button
          onClick={onGoPortal}
          style={{ width: '100%', padding: '10px 0', borderRadius: 8, background: '#C08457', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600 }}
        >
          Upgrade plan →
        </button>
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ tx }: { tx: LiveTx }) {
  const [tab, setTab] = useState<'JSON' | 'RAW'>('JSON')
  const [copied, setCopied] = useState(false)

  const jsonStr = JSON.stringify({
    signature:  tx.sigFull,
    slot:       tx.slot,
    block_time: tx.blockTime,
    success:    tx.success,
    fee:        tx.fee,
    type:       tx.type,
    token:      tx.token,
    from:       tx.fromFull,
    to:         tx.toFull,
    value:      tx.value,
    usd_value:  tx.usd,
  }, null, 2)

  function copy() {
    navigator.clipboard.writeText(jsonStr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ background: '#0d1117', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
      {/* Tabs + copy */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid #1f2937', height: 38 }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['JSON', 'RAW'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                padding: '0 12px', height: 38,
                background: 'transparent', border: 'none',
                borderBottom: tab === t ? '2px solid #C08457' : '2px solid transparent',
                color: tab === t ? '#e2e8f0' : '#4B5563',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#374151' }}>
            Signature: {tx.sigFull.slice(0, 12)}…{tx.sigFull.slice(-8)}
          </span>
          <button
            onClick={copy}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, background: 'transparent', border: '1px solid #1f2937', borderRadius: 4, color: copied ? '#22c55e' : '#4B5563', cursor: 'pointer', padding: '2px 8px' }}
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 0 }}>
        {/* Left: key/value fields */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '12px 16px', gap: 16 }}>
          {[
            { label: 'Signature',   value: tx.sigFull.slice(0, 16) + '…' },
            { label: 'Slot',        value: tx.slot.toLocaleString()        },
            { label: 'Block Time',  value: new Date(tx.blockTime).toLocaleTimeString('en-US', { hour12: false }) + ' UTC' },
            { label: 'Status',      value: tx.success ? '● Success' : '✗ Failed', color: tx.success ? '#22c55e' : '#f43f5e' },
            { label: 'Fee',         value: tx.fee     },
            { label: 'Token',       value: tx.token   },
          ].map(f => (
            <div key={f.label}>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{f.label}</p>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: (f as { color?: string }).color ?? '#94a3b8' }}>{f.value}</p>
            </div>
          ))}
        </div>
        {/* Right: raw JSON */}
        <div style={{ borderLeft: '1px solid #1f2937', padding: '8px 12px', overflowY: 'auto', maxHeight: 130 }}>
          <pre style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: '#4B5563', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
            {tab === 'JSON' ? jsonStr : JSON.stringify(JSON.parse(jsonStr))}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── Main terminal feed ────────────────────────────────────────────────────────

function TerminalFeed({ tier }: { tier: string }) {
  const [txs,     setTxs]     = useState<LiveTx[]>(() => Array.from({ length: 40 }, genTx))
  const [paused,  setPaused]  = useState(false)
  const [search,  setSearch]  = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All Types')
  const [tokenFilter, setTokenFilter] = useState('All Tokens')
  const [selected, setSelected] = useState<LiveTx | null>(null)

  // Live feed
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      setTxs(prev => {
        const count  = Math.floor(Math.random() * 4) + 1
        const newTxs = Array.from({ length: count }, genTx)
        return [...newTxs, ...prev].slice(0, 200)
      })
    }, 1200)
    return () => clearInterval(id)
  }, [paused])

  // Filtered
  const filtered = useMemo(() => {
    return txs.filter(tx => {
      if (typeFilter  !== 'All Types'  && tx.type  !== typeFilter)  return false
      if (tokenFilter !== 'All Tokens' && tx.token !== tokenFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!tx.sig.toLowerCase().includes(q) && !tx.from.toLowerCase().includes(q) && !tx.to.toLowerCase().includes(q) && !tx.token.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [txs, typeFilter, tokenFilter, search])

  const dropdownStyle: React.CSSProperties = {
    fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
    background: '#141d2b', border: '1px solid #1f2937', borderRadius: 6,
    color: '#64748b', cursor: 'pointer', padding: '6px 10px',
    outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Terminal</h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#374151' }}>
          Real-time transaction feed and explorer ·{' '}
          <span style={{ color: '#C08457' }}>{tier}</span> tier
        </p>
      </div>

      {/* Filter toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 12px', flexShrink: 0 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <svg
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search wallets, tokens, signatures, programs…"
            style={{
              width: '100%', background: '#141d2b', border: '1px solid #1f2937',
              borderRadius: 6, padding: '6px 10px 6px 30px',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              color: '#94a3b8', outline: 'none',
            }}
          />
        </div>

        <select value={typeFilter}  onChange={e => setTypeFilter(e.target.value)}  style={dropdownStyle}>
          <option>All Types</option>
          {TX_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={tokenFilter} onChange={e => setTokenFilter(e.target.value)} style={dropdownStyle}>
          <option>All Tokens</option>
          {TOKENS.map(t => <option key={t}>{t}</option>)}
        </select>

        <button
          onClick={() => setPaused(p => !p)}
          style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            background: paused ? '#C0845720' : 'transparent',
            border: `1px solid ${paused ? '#C0845740' : '#1f2937'}`,
            borderRadius: 6, color: paused ? '#D4956A' : '#4B5563',
            cursor: 'pointer', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid #1f2937', borderBottom: selected ? '1px solid #1f2937' : 'none', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ background: '#111827', borderBottom: '1px solid #1f2937' }}>
              {[
                { h: 'TIME',      w: 80  },
                { h: 'SIGNATURE', w: 100 },
                { h: 'TYPE',      w: 80  },
                { h: 'FROM',      w: 100 },
                { h: 'TO',        w: 100 },
                { h: 'TOKEN',     w: 70  },
                { h: 'VALUE',     w: 80  },
                { h: 'USD VALUE', w: 80  },
              ].map(col => (
                <th
                  key={col.h}
                  style={{
                    padding: '7px 10px',
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                    color: '#374151', textAlign: 'left',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    fontWeight: 500, whiteSpace: 'nowrap',
                    width: col.w,
                  }}
                >
                  {col.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 80).map(tx => {
              const sel = selected?.id === tx.id
              return (
                <tr
                  key={tx.id}
                  onClick={() => setSelected(s => s?.id === tx.id ? null : tx)}
                  style={{
                    borderBottom: '1px solid #0d1020',
                    background:   sel ? 'rgba(124,111,224,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                >
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
                  <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'right' }}>{tx.usd}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel (appears when row selected) */}
      {selected && <DetailPanel tx={selected} />}
    </div>
  )
}

// ── Page export ───────────────────────────────────────────────────────────────

interface TerminalPageProps {
  onGoPortal: () => void
}

export function TerminalPage({ onGoPortal }: TerminalPageProps) {
  const { data: me } = useQuery<MeData>({
    queryKey:  ['portal-me'],
    queryFn:   fetchMe,
    enabled:   isLoggedIn(),
    staleTime: 30_000,
    retry:     false,
  })

  const hasAccess = me && ['analyst', 'analyst_pro', 'fund', 'enterprise', 'pro'].includes(me.api_key?.tier ?? '')

  if (!isLoggedIn()) return <LoginWall onGoPortal={onGoPortal} />
  if (isLoggedIn() && me !== undefined && !hasAccess) {
    return <UpgradeWall onGoPortal={onGoPortal} tier={me?.api_key?.tier ?? 'none'} />
  }

  // Still loading me (spinner would flash, just render feed now)
  const tier = me?.api_key?.tier ?? 'analyst'
  return <TerminalFeed tier={tier} />
}
