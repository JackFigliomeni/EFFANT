import { useState, useRef, useEffect } from 'react'

const BASE = import.meta.env.VITE_API_URL ?? ''

// ── JSON syntax highlighter ───────────────────────────────────────────────────

const RE_AMP  = /&/g
const RE_LT   = /</g
const RE_GT   = />/g
const RE_KEY  = /(&quot;[^&]*&quot;)(\s*:)/g
const RE_STR  = /:(\s*)(&quot;[^&]*&quot;)/g
const RE_BOOL = /\b(true|false)\b/g
const RE_NULL = /\bnull\b/g
const RE_NUM  = /:\s*(-?\d+\.?\d*)/g

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

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `Available commands:

  GET /v1/health
  GET /v1/anomalies [severity=critical|high|medium|low] [limit=20]
  GET /v1/clusters  [min_wallets=10] [limit=10]
  GET /v1/wallet/<address>
  GET /v1/wallet/<address>/transactions [limit=10]
  GET /v1/flows     [min_sol=1000] [limit=10]   (Pro only)

  help   — show this message
  clear  — clear the terminal

Params are space-separated key=value pairs after the path:
  GET /v1/anomalies severity=high limit=50
  GET /v1/wallet/6AvA8pyr22Ta8iEjJnpYmLhLJuNSpxCa8MdxPqfyzaix`

// ── Types ─────────────────────────────────────────────────────────────────────

type LineType = 'prompt' | 'output' | 'error' | 'info' | 'status'

interface Line {
  type: LineType
  text: string
  html?: string
}

function statusColor(text: string): string {
  if (text.includes('running')) return '#f97316'
  if (/● 2\d\d/.test(text))    return '#22c55e'
  return '#f43f5e'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ApiTerminal({
  apiKey,
  tier,
}: {
  apiKey: string | null
  tier: 'starter' | 'pro'
}) {
  const initLines: Line[] = [
    { type: 'info', text: 'EFFANT API Terminal  —  type `help` to see available commands' },
    ...(apiKey
      ? []
      : [{ type: 'error' as LineType, text: 'No API key found. Go to API Portal, provision a key, then come back.' }]),
  ]

  const [lines, setLines]     = useState<Line[]>(initLines)
  const [input, setInput]     = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const inputRef              = useRef<HTMLInputElement>(null)
  const bottomRef             = useRef<HTMLDivElement>(null)

  // Auto-scroll on new output
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  // ── Command parsing ──────────────────────────────────────────────────────

  function parseGet(raw: string): { path: string; params: Record<string, string> } | null {
    const parts = raw.trim().split(/\s+/)
    if (parts[0].toUpperCase() !== 'GET') return null
    const rawPath = parts[1] ?? ''
    const [pathname, qs] = rawPath.split('?')
    const params: Record<string, string> = {}
    if (qs) new URLSearchParams(qs).forEach((v, k) => { params[k] = v })
    for (let i = 2; i < parts.length; i++) {
      const eq = parts[i].indexOf('=')
      if (eq > 0) params[parts[i].slice(0, eq)] = parts[i].slice(eq + 1)
    }
    return { path: pathname, params }
  }

  // ── Execute ──────────────────────────────────────────────────────────────

  async function execute(raw: string) {
    const cmd = raw.trim()
    if (!cmd) return

    setHistory(prev => [cmd, ...prev.slice(0, 99)])
    setHistIdx(-1)

    const push = (...l: Line[]) => setLines(prev => [...prev, ...l])

    push({ type: 'prompt', text: cmd })

    if (cmd === 'clear') {
      setLines([{ type: 'info', text: 'EFFANT API Terminal  —  type `help` to see available commands' }])
      return
    }

    if (cmd === 'help') {
      push({ type: 'info', text: HELP_TEXT })
      return
    }

    const lower = cmd.toLowerCase()
    if (!lower.startsWith('get ')) {
      push({ type: 'error', text: `Unknown command: "${cmd.split(' ')[0]}". Type \`help\` for commands.` })
      return
    }

    if (!apiKey) {
      push({ type: 'error', text: 'No API key — provision one in the API Portal first.' })
      return
    }

    const parsed = parseGet(cmd)
    if (!parsed) {
      push({ type: 'error', text: 'Could not parse request. Example: GET /v1/health' })
      return
    }

    if (parsed.path.startsWith('/v1/flows') && tier !== 'pro') {
      push({ type: 'error', text: '/v1/flows requires a Pro subscription.' })
      return
    }

    const qs  = new URLSearchParams(parsed.params).toString()
    const url = `${BASE}${parsed.path}${qs ? '?' + qs : ''}`
    const t0  = performance.now()

    // Optimistic "running" line that gets replaced
    setLines(prev => [...prev, { type: 'status', text: '● running…' }])

    try {
      const res  = await fetch(url, { headers: { 'X-API-Key': apiKey } })
      const ms   = Math.round(performance.now() - t0)
      const json = await res.json()
      const str  = JSON.stringify(json, null, 2)

      setLines(prev => [
        ...prev.slice(0, -1), // remove "running" line
        { type: 'status', text: `● ${res.status} ${res.ok ? 'OK' : 'ERR'}  ·  ${ms}ms  ·  ${url}` },
        { type: 'output', text: str, html: highlight(str) },
      ])
    } catch (err) {
      const ms = Math.round(performance.now() - t0)
      setLines(prev => [
        ...prev.slice(0, -1),
        { type: 'error', text: `Network error (${ms}ms): ${String(err)}` },
      ])
    }
  }

  // ── Key handling ─────────────────────────────────────────────────────────

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const cmd = input
      setInput('')
      execute(cmd)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(next)
      setInput(history[next] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(histIdx - 1, -1)
      setHistIdx(next)
      setInput(next < 0 ? '' : history[next])
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([{ type: 'info', text: 'EFFANT API Terminal  —  type `help` to see available commands' }])
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="rounded overflow-hidden"
      style={{ background: '#060a10', border: '1px solid var(--border)', cursor: 'text' }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ background: '#0d1117', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
          <div className="w-3 h-3 rounded-full" style={{ background: '#ffbd2e' }} />
          <div className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
        </div>
        <span className="mono text-xs ml-2" style={{ color: 'var(--dim)', fontSize: 11 }}>
          effant-api  ·  {tier}
          {apiKey ? `  ·  key: ${apiKey.slice(0, 10)}…` : '  ·  no key'}
        </span>
        <button
          onClick={e => {
            e.stopPropagation()
            setLines([{ type: 'info', text: 'EFFANT API Terminal  —  type `help` to see available commands' }])
          }}
          className="mono ml-auto text-xs transition-colors"
          style={{ color: 'var(--dim)', fontSize: 11 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
        >
          clear
        </button>
      </div>

      {/* Output */}
      <div
        className="px-4 pt-3 pb-1 overflow-y-auto mono"
        style={{ minHeight: 300, maxHeight: 540, fontSize: 12, lineHeight: '1.75' }}
      >
        {lines.map((line, i) => {
          if (line.type === 'prompt') {
            return (
              <div key={i}>
                <span style={{ color: '#4ade80', userSelect: 'none' }}>effant</span>
                <span style={{ color: 'var(--dim)', userSelect: 'none' }}>:~$ </span>
                <span style={{ color: '#c4b5fd' }}>{line.text}</span>
              </div>
            )
          }
          if (line.type === 'status') {
            return (
              <div key={i} style={{ color: statusColor(line.text), marginBottom: 4 }}>
                {line.text}
              </div>
            )
          }
          if (line.type === 'error') {
            return (
              <div key={i} style={{ color: '#f43f5e', marginBottom: 2 }}>{line.text}</div>
            )
          }
          if (line.type === 'output' && line.html) {
            return (
              <pre
                key={i}
                style={{ color: '#94a3b8', margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}
                dangerouslySetInnerHTML={{ __html: line.html }}
              />
            )
          }
          // info
          return (
            <pre
              key={i}
              style={{ color: 'var(--dim)', margin: '0 0 8px', whiteSpace: 'pre-wrap', fontSize: 11 }}
            >
              {line.text}
            </pre>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div
        className="flex items-center px-4 py-3 mono"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <span style={{ color: '#4ade80', fontSize: 12, userSelect: 'none', marginRight: 2 }}>effant</span>
        <span style={{ color: 'var(--dim)', fontSize: 12, userSelect: 'none', marginRight: 8 }}>:~$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          placeholder="GET /v1/health"
          autoFocus
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#c4b5fd',
            fontSize: 12,
            fontFamily: 'inherit',
            caretColor: '#c4b5fd',
          }}
        />
      </div>
    </div>
  )
}
