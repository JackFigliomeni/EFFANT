import { useState, useMemo } from 'react'

const BASE = import.meta.env.VITE_API_URL ?? ''

// ── Endpoint definitions ──────────────────────────────────────────────────────

type ParamDef = {
  name: string
  label: string
  type: 'text' | 'number' | 'select'
  default: string
  placeholder?: string
  options?: string[]
}

type Endpoint = {
  id: string
  path: string
  desc: string
  ttl: string
  tier: 'starter' | 'pro'
  params: ParamDef[]
  buildUrl: (vals: Record<string, string>) => string
}

const ENDPOINTS: Endpoint[] = [
  {
    id: 'health',
    path: '/v1/health',
    desc: 'System status — DB, Redis, pipeline health and entity counts',
    ttl: '10s',
    tier: 'starter',
    params: [],
    buildUrl: () => '/v1/health',
  },
  {
    id: 'anomalies',
    path: '/v1/anomalies',
    desc: 'Anomaly feed — filter by severity or type, sorted critical-first',
    ttl: '30s',
    tier: 'starter',
    params: [
      { name: 'severity', label: 'Severity', type: 'select',
        options: ['', 'critical', 'high', 'medium', 'low'], default: 'critical' },
      { name: 'limit', label: 'Limit', type: 'number', default: '20' },
    ],
    buildUrl: (v) => {
      const p = new URLSearchParams()
      if (v.severity) p.set('severity', v.severity)
      p.set('limit', v.limit || '20')
      return `/v1/anomalies?${p}`
    },
  },
  {
    id: 'clusters',
    path: '/v1/clusters',
    desc: 'Entity clusters detected via Louvain community detection',
    ttl: '5min',
    tier: 'starter',
    params: [
      { name: 'min_wallets', label: 'Min wallets', type: 'number', default: '10' },
      { name: 'limit',       label: 'Limit',       type: 'number', default: '10' },
    ],
    buildUrl: (v) =>
      `/v1/clusters?min_wallets=${v.min_wallets || '10'}&limit=${v.limit || '10'}`,
  },
  {
    id: 'wallet',
    path: '/v1/wallet/{address}',
    desc: 'Full wallet profile — label, risk score, cluster membership, anomaly count',
    ttl: '60s',
    tier: 'starter',
    params: [
      { name: 'address', label: 'Wallet address', type: 'text',
        default: '6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix',
        placeholder: 'Base58 Solana address' },
    ],
    buildUrl: (v) =>
      `/v1/wallet/${v.address || '6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix'}`,
  },
  {
    id: 'wallet-txs',
    path: '/v1/wallet/{address}/transactions',
    desc: 'Enriched transaction history — from/to labels resolved on every record',
    ttl: '60s',
    tier: 'starter',
    params: [
      { name: 'address', label: 'Wallet address', type: 'text',
        default: '6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix' },
      { name: 'limit', label: 'Limit', type: 'number', default: '10' },
    ],
    buildUrl: (v) =>
      `/v1/wallet/${v.address || '6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix'}/transactions?limit=${v.limit || '10'}`,
  },
  {
    id: 'flows',
    path: '/v1/flows',
    desc: 'Large fund movements above a SOL threshold — Pro tier only',
    ttl: '30s',
    tier: 'pro',
    params: [
      { name: 'min_sol', label: 'Min SOL', type: 'number', default: '1000' },
      { name: 'limit',   label: 'Limit',   type: 'number', default: '10'   },
    ],
    buildUrl: (v) =>
      `/v1/flows?min_sol=${v.min_sol || '1000'}&limit=${v.limit || '10'}`,
  },
]

// ── JSON syntax highlighter ───────────────────────────────────────────────────
// Regexes hoisted to module level (js-hoist-regexp) — created once, not per call.

const RE_AMP   = /&/g
const RE_LT    = /</g
const RE_GT    = />/g
const RE_KEY   = /(&quot;[^&]*&quot;)(\s*:)/g
const RE_STR   = /:(\s*)(&quot;[^&]*&quot;)/g
const RE_BOOL  = /\b(true|false)\b/g
const RE_NULL  = /\bnull\b/g
const RE_NUM   = /:\s*(-?\d+\.?\d*)/g

function highlight(json: string): string {
  return json
    .replace(RE_AMP,  '&amp;')
    .replace(RE_LT,   '&lt;')
    .replace(RE_GT,   '&gt;')
    .replace(RE_KEY,  '<span style="color:#818cf8">$1</span>$2')
    .replace(RE_STR,  (_, colon, str) => `:${colon}<span style="color:#34d399">${str}</span>`)
    .replace(RE_BOOL, '<span style="color:#f472b6">$1</span>')
    .replace(RE_NULL, '<span style="color:#64748b">null</span>')
    .replace(RE_NUM,  (m, n) => m.replace(n, `<span style="color:#fb923c">${n}</span>`))
}

// ── Static styles hoisted outside component (rendering-hoist-jsx) ─────────────

const inputStyle: React.CSSProperties = {
  background: '#060a10',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '6px 10px',
  outline: 'none',
  width: '100%',
}

// Injected once at module level — avoids a <style> tag inside the component tree.
if (typeof document !== 'undefined' && !document.getElementById('api-terminal-styles')) {
  const s = document.createElement('style')
  s.id = 'api-terminal-styles'
  s.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
  document.head.appendChild(s)
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApiTerminal({
  apiKey,
  tier,
}: {
  apiKey: string | null
  tier: 'starter' | 'pro'
}) {
  const [selectedId, setSelectedId] = useState('anomalies')
  const [paramVals, setParamVals]   = useState<Record<string, Record<string, string>>>({})
  const [response, setResponse]     = useState<string | null>(null)
  const [status, setStatus]         = useState<number | null>(null)
  const [elapsed, setElapsed]       = useState<number | null>(null)
  const [loading, setLoading]       = useState(false)
  const [copiedResp, setCopiedResp] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)

  const ep     = ENDPOINTS.find(e => e.id === selectedId)!
  const locked = ep.tier === 'pro' && tier !== 'pro'

  // Param values for selected endpoint, falling back to defaults
  const vals = paramVals[selectedId] ?? Object.fromEntries(
    ep.params.map(p => [p.name, p.default]),
  )

  // Memoize syntax highlighting — potentially large JSON string (rerender-memo)
  const highlightedResponse = useMemo(
    () => (response !== null ? highlight(response) : null),
    [response],
  )

  function setVal(name: string, value: string) {
    setParamVals(prev => ({
      ...prev,
      [selectedId]: { ...vals, [name]: value },
    }))
  }

  function buildCurl(): string {
    const url = `${BASE || 'https://api.effant.tech'}${ep.buildUrl(vals)}`
    const key  = apiKey ? apiKey.slice(0, 16) + '…' : 'YOUR_KEY'
    return `curl -H "X-API-Key: ${key}" \\\n  "${url}"`
  }

  async function run() {
    if (!apiKey || locked) return
    setLoading(true)
    setResponse(null)
    setStatus(null)
    setElapsed(null)

    const url = `${BASE}${ep.buildUrl(vals)}`
    const t0  = performance.now()

    try {
      const res  = await fetch(url, { headers: { 'X-API-Key': apiKey } })
      const ms   = Math.round(performance.now() - t0)
      const json = await res.json()
      setStatus(res.status)
      setElapsed(ms)
      setResponse(JSON.stringify(json, null, 2))
    } catch (err) {
      setStatus(0)
      setElapsed(Math.round(performance.now() - t0))
      setResponse(`// Network error: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function copyResponse() {
    if (!response) return
    navigator.clipboard.writeText(response)
    setCopiedResp(true)
    setTimeout(() => setCopiedResp(false), 2000)
  }

  function copyCurl() {
    navigator.clipboard.writeText(buildCurl().replace('…', ''))
    setCopiedCurl(true)
    setTimeout(() => setCopiedCurl(false), 2000)
  }

  function selectEndpoint(id: string) {
    setSelectedId(id)
    setResponse(null)
    setStatus(null)
    setElapsed(null)
  }

  const statusColor =
    status === null ? 'var(--dim)' :
    status === 0    ? '#f43f5e'    :
    status < 300    ? '#22c55e'    :
    status < 400    ? '#f97316'    : '#f43f5e'

  return (
    <div className="rounded overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>
          API Terminal
        </span>
        <div className="flex items-center gap-3">
          {elapsed !== null && (
            <span className="mono text-xs" style={{ color: 'var(--dim)' }}>{elapsed}ms</span>
          )}
          {status !== null && (
            <span className="mono text-xs font-semibold" style={{ color: statusColor }}>
              {status === 0 ? 'ERR' : status}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">

        {/* ── Endpoint selector ── */}
        <div>
          <p className="mono text-xs uppercase tracking-widest mb-2"
            style={{ color: 'var(--dim)', fontSize: 10 }}>Endpoint</p>
          <div className="flex flex-col gap-1">
            {ENDPOINTS.map(e => {
              const isLocked = e.tier === 'pro' && tier !== 'pro'
              const active   = e.id === selectedId
              return (
                <button
                  key={e.id}
                  onClick={() => selectEndpoint(e.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded text-left transition-all"
                  style={{
                    background: active ? 'rgba(91,108,248,0.12)' : 'transparent',
                    border:     `1px solid ${active ? 'rgba(91,108,248,0.35)' : 'var(--border)'}`,
                  }}
                >
                  <span className="mono text-xs font-bold shrink-0"
                    style={{ color: active ? 'var(--accent)' : 'var(--dim)', fontSize: 10 }}>
                    GET
                  </span>
                  <span className="mono text-xs flex-1 truncate"
                    style={{ color: active ? '#fff' : 'var(--muted)' }}>
                    {e.path}
                  </span>
                  <span className="mono shrink-0" style={{ fontSize: 9, color: 'var(--dim)' }}>
                    {e.ttl}
                  </span>
                  {isLocked ? (
                    <span className="mono text-xs shrink-0" style={{ color: '#f97316' }} title="Pro only">
                      🔒
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Parameters ── */}
        {ep.params.length > 0 ? (
          <div>
            <p className="mono text-xs uppercase tracking-widest mb-2"
              style={{ color: 'var(--dim)', fontSize: 10 }}>Parameters</p>
            <div className="grid gap-2" style={{
              gridTemplateColumns: ep.params.length >= 2 ? '1fr 1fr' : '1fr',
            }}>
              {ep.params.map(p => (
                <div key={p.name}>
                  <label className="mono text-xs block mb-1"
                    style={{ color: 'var(--dim)', fontSize: 10 }}>
                    {p.label}
                  </label>
                  {p.type === 'select' ? (
                    <select
                      value={vals[p.name] ?? p.default}
                      onChange={e => setVal(p.name, e.target.value)}
                      className="mono"
                      style={inputStyle}
                    >
                      {p.options!.map(o => (
                        <option key={o} value={o}>{o || 'any'}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={vals[p.name] ?? p.default}
                      onChange={e => setVal(p.name, e.target.value)}
                      placeholder={p.placeholder}
                      className="mono"
                      style={inputStyle}
                      spellCheck={false}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── curl preview ── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="mono text-xs uppercase tracking-widest"
              style={{ color: 'var(--dim)', fontSize: 10 }}>curl</p>
            <button
              onClick={copyCurl}
              className="mono text-xs transition-all"
              style={{ color: copiedCurl ? '#22c55e' : 'var(--dim)' }}>
              {copiedCurl ? '✓ copied' : 'copy'}
            </button>
          </div>
          <pre
            className="rounded px-3 py-2.5 overflow-x-auto mono text-xs leading-relaxed"
            style={{ background: '#020608', border: '1px solid var(--border)', color: '#64748b' }}>
            {buildCurl()}
          </pre>
        </div>

        {/* ── Run button / locked state / no-key state ── */}
        {locked ? (
          <div className="rounded-lg px-4 py-3 flex items-center gap-3"
            style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <span>🔒</span>
            <div>
              <p className="mono text-xs font-semibold" style={{ color: '#f97316' }}>Pro endpoint</p>
              <p className="mono text-xs" style={{ color: 'var(--dim)', marginTop: 2 }}>
                Upgrade to Pro to access <span style={{ color: '#fff' }}>{ep.path}</span>
              </p>
            </div>
          </div>
        ) : apiKey === null ? (
          <div className="rounded px-4 py-3 mono text-xs"
            style={{ background: '#0c1020', border: '1px solid rgba(91,108,248,0.2)', color: 'var(--dim)' }}>
            <span style={{ color: 'var(--accent)' }}>↑</span>{' '}
            Go to <strong style={{ color: '#fff' }}>API Portal</strong> and provision a key — it will be pre-filled here automatically.
          </div>
        ) : (
          <button
            onClick={run}
            disabled={loading}
            className="w-full py-2.5 rounded-lg mono text-xs font-semibold transition-all flex items-center justify-center gap-2"
            style={{
              background: loading ? 'rgba(91,108,248,0.3)' : 'var(--accent)',
              color:  '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}>
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>◌</span>
                Running…
              </>
            ) : (
              <>▶ Run Request</>
            )}
          </button>
        )}

        {/* ── Response panel ── */}
        {highlightedResponse !== null ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <p className="mono text-xs uppercase tracking-widest"
                  style={{ color: 'var(--dim)', fontSize: 10 }}>Response</p>
                {elapsed !== null && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{elapsed}ms</span>
                )}
                <span className="mono text-xs font-semibold" style={{ color: statusColor }}>
                  {status === 0 ? 'ERR' : status}
                </span>
              </div>
              <button
                onClick={copyResponse}
                className="mono text-xs transition-all"
                style={{ color: copiedResp ? '#22c55e' : 'var(--dim)' }}>
                {copiedResp ? '✓ copied' : 'copy'}
              </button>
            </div>
            <pre
              className="rounded px-4 py-3 overflow-auto mono text-xs leading-relaxed"
              style={{
                background: '#020608',
                border: `1px solid ${status !== null && status >= 400 ? 'rgba(244,63,94,0.3)' : 'var(--border)'}`,
                maxHeight: 420,
                color: '#94a3b8',
              }}
              dangerouslySetInnerHTML={{ __html: highlightedResponse }}
            />
          </div>
        ) : null}

        {/* Endpoint description */}
        <p className="mono text-xs" style={{ color: 'var(--dim)', fontSize: 10 }}>
          {ep.desc} · cached {ep.ttl}
        </p>

      </div>
    </div>
  )
}
