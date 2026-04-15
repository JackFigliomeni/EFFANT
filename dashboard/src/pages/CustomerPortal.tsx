import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  signup, login, logout, isLoggedIn,
  fetchMe, fetchCallLog, provisionKey, rotateKey,
  forgotPassword, resetPassword,
  fetchWebhooks, createWebhook, deleteWebhook,
} from '../api/portal'
import type { MeData, Webhook } from '../api/portal'
import { BillingPanel } from '../components/BillingPanel'
import { ApiTerminal } from '../components/ApiTerminal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>{title}</span>
        {sub && <span className="ml-3 text-xs" style={{ color: 'var(--muted)' }}>{sub}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Checkout success banner ───────────────────────────────────────────────────

function CheckoutSuccessBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-lg p-6"
      style={{ background: '#052e16', border: '1px solid #16a34a40' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold mb-1" style={{ color: '#22c55e' }}>
            Payment successful — welcome to EFFANT
          </p>
          <p className="text-sm" style={{ color: '#86efac' }}>
            Your subscription is now active. Your API key is ready below — copy it now, it won't be shown again.
          </p>
        </div>
        <button onClick={onDismiss} className="text-xs shrink-0"
          style={{ color: '#16a34a' }}>dismiss</button>
      </div>
    </div>
  )
}

// ── API Key card ──────────────────────────────────────────────────────────────

function KeyCard({ me, onProvisioned }: { me: MeData; onProvisioned: (key: string) => void }) {
  const qc = useQueryClient()
  const [copied, setCopied]     = useState(false)
  const [newKey, setNewKey]     = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [rotateErr, setRotateErr] = useState('')
  const storedKey = localStorage.getItem('effant_api_key')

  const provision = useMutation({
    mutationFn: provisionKey,
    onSuccess: (data) => {
      setNewKey(data.api_key)
      onProvisioned(data.api_key)
      qc.invalidateQueries({ queryKey: ['portal-me'] })
    },
  })

  const rotate = useMutation({
    mutationFn: rotateKey,
    onSuccess: (data) => {
      setRotateErr('')
      setRevealed(false)
      setNewKey(data.api_key)
      onProvisioned(data.api_key)
      qc.invalidateQueries({ queryKey: ['portal-me'] })
    },
    onError: (e) => setRotateErr((e as Error).message),
  })

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!me.has_key && !newKey) {
    return (
      <Section title="API Key">
        <div className="text-center py-6">
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            You don't have an API key yet.
          </p>
          <button
            onClick={() => provision.mutate()}
            disabled={provision.isPending}
            className="rounded px-6 py-2.5 text-sm font-semibold transition-opacity"
            style={{ background: 'var(--accent)', color: '#fff', opacity: provision.isPending ? 0.6 : 1 }}
          >
            {provision.isPending ? 'Generating…' : 'Generate API Key'}
          </button>
          {provision.isError && (
            <p className="mt-3 text-xs" style={{ color: 'var(--red)' }}>
              {(provision.error as Error).message}
            </p>
          )}
        </div>
      </Section>
    )
  }

  const key = me.api_key
  const activeKey  = newKey ?? (revealed ? (storedKey ?? '__reprovision__') : null)
  const showBanner = !!newKey

  return (
    <Section title="API Key" sub={key ? `${key.tier.toUpperCase()} tier` : undefined}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="mono text-xs" style={{ color: 'var(--muted)' }}>
              {showBanner ? 'Copy this key now' : 'Your API key'}
            </p>
            {!newKey && me.has_key && (
              <button
                onClick={() => setRevealed(r => !r)}
                className="mono text-xs transition-colors"
                style={{ color: revealed ? 'var(--accent)' : 'var(--dim)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.color = revealed ? 'var(--accent)' : 'var(--dim)')}
              >
                {revealed ? 'hide' : 'reveal'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded px-3 py-2.5 mono text-sm overflow-x-auto"
              style={{
                background: 'var(--surface2)',
                border: `1px solid ${activeKey && activeKey !== '__reprovision__' ? '#eab30840' : 'var(--border)'}`,
                color: activeKey && activeKey !== '__reprovision__' ? '#eab308' : 'var(--muted)',
                whiteSpace: 'nowrap',
                letterSpacing: activeKey && activeKey !== '__reprovision__' ? '0.03em' : undefined,
              }}>
              {activeKey === '__reprovision__'
                ? 'Key not cached in this browser — click Re-provision to get a new one'
                : (activeKey ?? '••••••••••••••••••••••••••••••••')}
            </div>
            {activeKey === '__reprovision__' ? (
              <button
                onClick={() => rotate.mutate()}
                disabled={rotate.isPending}
                className="rounded px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: rotate.isPending ? 0.6 : 1,
                  flexShrink: 0,
                }}>
                {rotate.isPending ? 'Generating…' : 'Re-provision'}
              </button>
            ) : activeKey ? (
              <button onClick={() => copy(activeKey)}
                className="rounded px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: copied ? '#22c55e20' : 'var(--border2)',
                  border: `1px solid ${copied ? '#22c55e40' : 'var(--border)'}`,
                  color: copied ? '#22c55e' : 'var(--text)',
                }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            ) : null}
          </div>
          {rotateErr && (
            <p className="mono text-xs mt-1.5" style={{ color: 'var(--red)' }}>
              {rotateErr}
            </p>
          )}
        </div>

        {key && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Tier',        value: key.tier.charAt(0).toUpperCase() + key.tier.slice(1) },
                { label: 'Calls today', value: key.calls_today.toLocaleString() },
                { label: 'Daily limit', value: key.calls_limit.toLocaleString() },
                { label: 'Last used',   value: relTime(key.last_used_at) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded px-3 py-2.5"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                  <p className="mono text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
                  <p className="mono text-sm font-semibold" style={{ color: '#fff' }}>{value}</p>
                </div>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-xs mono mb-1.5">
                <span style={{ color: 'var(--muted)' }}>Usage today</span>
                <span style={{ color: 'var(--text)' }}>
                  {key.calls_today.toLocaleString()} / {key.calls_limit.toLocaleString()}
                  <span style={{ color: 'var(--muted)' }} className="ml-2">
                    ({((key.calls_today / key.calls_limit) * 100).toFixed(1)}%)
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border2)' }}>
                <div className="h-1.5 rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min((key.calls_today / key.calls_limit) * 100, 100)}%`,
                    background: key.calls_today / key.calls_limit > 0.9
                      ? 'var(--red)' : key.calls_today / key.calls_limit > 0.7
                      ? 'var(--yellow)' : 'var(--accent)',
                  }} />
              </div>
              <p className="mono text-xs mt-1" style={{ color: 'var(--dim)' }}>
                Resets {relTime(key.reset_at)} · {(key.calls_limit - key.calls_today).toLocaleString()} remaining
              </p>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

// ── Call log ──────────────────────────────────────────────────────────────────

function CallLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-call-log'],
    queryFn: fetchCallLog,
    refetchInterval: 15_000,
  })

  const calls = data?.calls ?? []

  return (
    <Section title="Recent API Calls" sub="Last 10 · refreshes every 15s">
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <p className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>
          No calls logged yet. Make your first API request.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Endpoint', 'Status', 'Response'].map(h => (
                  <th key={h} className="pb-2 px-2 mono text-xs uppercase tracking-widest"
                    style={{ color: 'var(--muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => {
                const ok = c.status_code >= 200 && c.status_code < 300
                const slow = c.response_ms > 500
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                    className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 px-2 mono text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                      {fmtTs(c.called_at)}
                    </td>
                    <td className="py-2 px-2 mono text-xs" style={{ color: 'var(--text)' }}>
                      {c.method} {c.endpoint}
                    </td>
                    <td className="py-2 px-2 mono text-xs font-semibold"
                      style={{ color: ok ? '#22c55e' : 'var(--red)' }}>
                      {c.status_code}
                    </td>
                    <td className="py-2 px-2 mono text-xs"
                      style={{ color: slow ? 'var(--yellow)' : 'var(--muted)' }}>
                      {c.response_ms}ms
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ── Webhooks panel (Pro only) ─────────────────────────────────────────────────

const EVENT_OPTIONS = [
  { id: 'new_anomaly_critical', label: 'Critical anomaly', desc: 'Fired when a critical-severity anomaly is detected' },
  { id: 'whale_movement',       label: 'Whale movement',   desc: 'Fired on large fund movements (≥100k SOL)' },
  { id: 'new_wallet_label',     label: 'New wallet label', desc: 'Fired when pipeline assigns a new entity label' },
]

function WebhooksPanel() {
  const qc = useQueryClient()
  const [url, setUrl]               = useState('')
  const [events, setEvents]         = useState<string[]>([])
  const [newSecret, setNewSecret]   = useState<string | null>(null)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [formErr, setFormErr]       = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['portal-webhooks'],
    queryFn: fetchWebhooks,
    retry: false,
  })

  const add = useMutation({
    mutationFn: () => createWebhook(url, events),
    onSuccess: (res) => {
      setNewSecret(res.webhook.secret_key ?? null)
      setUrl('')
      setEvents([])
      setFormErr('')
      qc.invalidateQueries({ queryKey: ['portal-webhooks'] })
    },
    onError: (e) => setFormErr((e as Error).message),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-webhooks'] }),
  })

  function toggleEvent(id: string) {
    setEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])
  }

  function copySecret(s: string) {
    navigator.clipboard.writeText(s)
    setCopiedSecret(true)
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  const webhooks: Webhook[] = data?.webhooks ?? []

  return (
    <Section title="Webhooks" sub="Pro tier · real-time event delivery">
      <div className="space-y-6">
        {/* New secret reveal */}
        {newSecret && (
          <div className="rounded p-4" style={{ background: '#052e16', border: '1px solid #16a34a40' }}>
            <p className="mono text-xs mb-2" style={{ color: '#22c55e' }}>
              Copy your signing secret now — it won't be shown again
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded px-3 py-2 mono text-xs overflow-x-auto"
                style={{ background: '#030f06', color: '#86efac', whiteSpace: 'nowrap' }}>
                {newSecret}
              </div>
              <button onClick={() => copySecret(newSecret)}
                className="rounded px-3 py-2 text-xs font-semibold whitespace-nowrap"
                style={{ background: copiedSecret ? '#22c55e20' : 'var(--surface2)',
                         border: '1px solid var(--border)', color: copiedSecret ? '#22c55e' : 'var(--text)' }}>
                {copiedSecret ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="mono text-xs mt-2" style={{ color: 'var(--dim)' }}>
              Verify with: <span style={{ color: 'var(--muted)' }}>X-Effant-Signature: sha256=HMAC-SHA256(secret, body)</span>
            </p>
          </div>
        )}

        {/* Add webhook form */}
        <div className="rounded p-4 space-y-4"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <p className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            Register endpoint
          </p>
          <div>
            <label className="mono text-xs mb-1.5 block" style={{ color: 'var(--dim)' }}>
              Endpoint URL
            </label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://your-server.com/effant-webhook"
              className="w-full rounded px-3 py-2.5 mono text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border2)', color: 'var(--text)' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
          </div>
          <div>
            <label className="mono text-xs mb-2 block" style={{ color: 'var(--dim)' }}>Events to subscribe</label>
            <div className="space-y-2">
              {EVENT_OPTIONS.map(opt => (
                <label key={opt.id} className="flex items-start gap-3 cursor-pointer group">
                  <div
                    className="mt-0.5 w-4 h-4 rounded shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      background: events.includes(opt.id) ? 'var(--accent)' : 'var(--surface)',
                      border: `1px solid ${events.includes(opt.id) ? 'var(--accent)' : 'var(--border2)'}`,
                    }}
                    onClick={() => toggleEvent(opt.id)}
                  >
                    {events.includes(opt.id) && (
                      <span className="text-white" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
                    )}
                  </div>
                  <div onClick={() => toggleEvent(opt.id)}>
                    <p className="text-sm" style={{ color: 'var(--text)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--dim)' }}>{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {formErr && <p className="mono text-xs" style={{ color: 'var(--red)' }}>✗ {formErr}</p>}
          <button
            onClick={() => add.mutate()}
            disabled={add.isPending || !url || events.length === 0}
            className="rounded px-5 py-2 text-sm font-semibold transition-opacity"
            style={{ background: 'var(--accent)', color: '#fff',
                     opacity: add.isPending || !url || events.length === 0 ? 0.5 : 1 }}>
            {add.isPending ? 'Registering…' : 'Register webhook'}
          </button>
        </div>

        {/* Webhook list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-16 rounded animate-pulse" style={{ background: 'var(--border2)' }} />
            ))}
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-center py-4 text-sm" style={{ color: 'var(--dim)' }}>
            No webhooks registered yet.
          </p>
        ) : (
          <div className="space-y-2">
            {webhooks.map(wh => (
              <div key={wh.id} className="rounded p-4 flex items-start justify-between gap-4"
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <p className="mono text-sm truncate" style={{ color: '#fff' }}>{wh.url}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {wh.event_types.map(e => (
                      <span key={e} className="mono text-xs px-1.5 py-0.5 rounded"
                        style={{ background: '#5b6cf818', color: 'var(--accent)', border: '1px solid #5b6cf830' }}>
                        {e}
                      </span>
                    ))}
                  </div>
                  <p className="mono text-xs mt-1.5" style={{ color: 'var(--dim)' }}>
                    Added {relTime(wh.created_at)}
                    {wh.last_triggered_at && (
                      <> · Last fired {relTime(wh.last_triggered_at)}
                        <span style={{ color: wh.last_status && wh.last_status < 300 ? 'var(--green)' : 'var(--red)' }}>
                          {' '}({wh.last_status})
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => remove.mutate(wh.id)}
                  disabled={remove.isPending}
                  className="shrink-0 mono text-xs transition-colors"
                  style={{ color: 'var(--muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                  delete
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mono text-xs" style={{ color: 'var(--dim)' }}>
          Deliveries are signed with HMAC-SHA256. Retry policy: 3× with 2s / 4s / 8s backoff.
        </p>
      </div>
    </Section>
  )
}

// ── Auth form (login / signup / forgot / reset) ───────────────────────────────

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'

interface AuthFormProps {
  onAuth: () => void
  initialMode?: AuthMode
  resetToken?: string
}

function AuthForm({ onAuth, initialMode = 'login', resetToken }: AuthFormProps) {
  const [mode, setMode]         = useState<AuthMode>(resetToken ? 'reset' : initialMode)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [loading, setLoading]   = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        await signup(email, password)
        onAuth()
      } else if (mode === 'login') {
        await login(email, password)
        onAuth()
      } else if (mode === 'forgot') {
        await forgotPassword(email)
        setInfo('Check your inbox — a reset link is on its way.')
      } else if (mode === 'reset') {
        if (password !== confirm) throw new Error('Passwords do not match')
        const data = await resetPassword(resetToken!, password)
        localStorage.setItem('effant_token', data.token)
        onAuth()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const titles: Record<AuthMode, string> = {
    login:  'Sign in',
    signup: 'Create account',
    forgot: 'Reset password',
    reset:  'Set new password',
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="mono font-bold text-xl mb-1" style={{ color: 'var(--accent)' }}>EFFANT</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Solana Intelligence Platform</p>
        </div>

        <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {/* Tabs (only for login/signup) */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
              {(['login', 'signup'] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(''); setInfo('') }}
                  className="flex-1 py-3 text-xs font-semibold uppercase tracking-widest transition-colors"
                  style={{
                    borderBottom: mode === m ? '2px solid var(--accent)' : '2px solid transparent',
                    color: mode === m ? '#fff' : 'var(--muted)',
                    marginBottom: -1,
                  }}>
                  {m}
                </button>
              ))}
            </div>
          )}

          {/* Header for forgot/reset */}
          {(mode === 'forgot' || mode === 'reset') && (
            <div className="px-6 pt-6 pb-2">
              <p className="font-semibold" style={{ color: '#fff' }}>{titles[mode]}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {mode === 'forgot'
                  ? 'Enter your email and we\'ll send a reset link.'
                  : 'Choose a new password for your account.'}
              </p>
            </div>
          )}

          <form onSubmit={submit} className="p-6 space-y-4">
            {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
              <div>
                <label className="mono text-xs uppercase tracking-widest mb-1.5 block"
                  style={{ color: 'var(--muted)' }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required autoComplete="email"
                  className="w-full rounded px-3 py-2.5 text-sm outline-none transition-colors"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
                />
              </div>
            )}

            {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
              <div>
                <label className="mono text-xs uppercase tracking-widest mb-1.5 block"
                  style={{ color: 'var(--muted)' }}>
                  {mode === 'reset' ? 'New password' : 'Password'}
                </label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode !== 'login' ? 8 : 1}
                  className="w-full rounded px-3 py-2.5 text-sm outline-none transition-colors"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
                />
                {(mode === 'signup' || mode === 'reset') && (
                  <p className="mono text-xs mt-1" style={{ color: 'var(--dim)' }}>Minimum 8 characters</p>
                )}
              </div>
            )}

            {mode === 'reset' && (
              <div>
                <label className="mono text-xs uppercase tracking-widest mb-1.5 block"
                  style={{ color: 'var(--muted)' }}>Confirm password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  required autoComplete="new-password"
                  className="w-full rounded px-3 py-2.5 text-sm outline-none transition-colors"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
                />
              </div>
            )}

            {error && <p className="mono text-xs" style={{ color: 'var(--red)' }}>✗ {error}</p>}
            {info  && <p className="mono text-xs" style={{ color: 'var(--green)' }}>✓ {info}</p>}

            <button type="submit" disabled={loading || (mode === 'forgot' && !!info)}
              className="w-full rounded py-2.5 text-sm font-semibold transition-opacity"
              style={{ background: 'var(--accent)', color: '#fff', opacity: loading ? 0.6 : 1 }}>
              {loading ? '…' : titles[mode]}
            </button>
          </form>
        </div>

        {/* Links */}
        <div className="text-center mt-4 space-y-2">
          {mode === 'login' && (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              <button onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                style={{ color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                Forgot password?
              </button>
            </p>
          )}
          {(mode === 'login' || mode === 'signup') && (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              {mode === 'login' ? 'No account? ' : 'Already have one? '}
              <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
                style={{ color: 'var(--accent)' }}>
                {mode === 'login' ? 'Sign up free' : 'Sign in'}
              </button>
            </p>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              <button onClick={() => { setMode('login'); setError(''); setInfo('') }}
                style={{ color: 'var(--muted)' }}>
                ← Back to sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── API Documentation ─────────────────────────────────────────────────────────

interface EndpointDoc {
  method: 'GET' | 'POST'
  path: string
  auth: 'required' | 'public'
  desc: string
  params?: { name: string; type: string; required: boolean; desc: string }[]
  example: string
  response: string
}

const ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/v1/wallet/{address}',
    auth: 'required',
    desc: 'Full profile for a Solana wallet — risk score, entity type, cluster membership, volume stats, and anomaly count.',
    params: [
      { name: 'address', type: 'path', required: true, desc: 'Base58 wallet address' },
    ],
    example: `curl -H "X-API-Key: YOUR_KEY" \\
  https://api.effant.io/v1/wallet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs`,
    response: `{
  "data": {
    "address": "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    "label": "Binance Hot Wallet",
    "entity_type": "exchange",
    "risk_score": 0.12,
    "tx_count": 48291,
    "total_volume_sol": 2847193.4,
    "volume_24h_sol": 91234.8,
    "first_seen": "2024-01-15T08:22:00Z",
    "last_seen": "2024-06-10T14:05:31Z",
    "anomaly_count": 3,
    "cluster": { "id": 12, "name": "CEX Cluster A", "wallet_count": 47 }
  },
  "meta": { "generated_at": "2024-06-10T14:06:00Z" }
}`,
  },
  {
    method: 'GET',
    path: '/v1/wallet/{address}/transactions',
    auth: 'required',
    desc: 'Paginated transaction history for a wallet. Returns from/to addresses with labels, SOL amounts, fees, and program IDs.',
    params: [
      { name: 'address', type: 'path',  required: true,  desc: 'Base58 wallet address' },
      { name: 'limit',   type: 'query', required: false, desc: 'Max rows (1–100, default 20)' },
      { name: 'offset',  type: 'query', required: false, desc: 'Pagination offset (default 0)' },
    ],
    example: `curl -H "X-API-Key: YOUR_KEY" \\
  "https://api.effant.io/v1/wallet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/transactions?limit=5"`,
    response: `{
  "data": [
    {
      "signature": "3Ax7Yn...",
      "block_time": "2024-06-10T13:59:01Z",
      "from_wallet": "7vfCXTUXx5...",
      "from_label": "Binance Hot Wallet",
      "to_wallet": "9Xm3pQ...",
      "to_label": null,
      "amount_sol": 1250.0,
      "fee": 0.000005,
      "success": true,
      "program_id": "11111111111111111111111111111111"
    }
  ],
  "meta": { "count": 5, "total": 48291, "limit": 5, "offset": 0 }
}`,
  },
  {
    method: 'GET',
    path: '/v1/anomalies',
    auth: 'required',
    desc: 'Live anomaly feed across all monitored wallets. Filter by type and severity. Sorted by detection time descending.',
    params: [
      { name: 'limit',        type: 'query', required: false, desc: 'Max rows (1–200, default 50)' },
      { name: 'severity',     type: 'query', required: false, desc: 'low | medium | high | critical' },
      { name: 'anomaly_type', type: 'query', required: false, desc: 'wash_trading | volume_spike | sandwich_attack | whale_movement' },
    ],
    example: `curl -H "X-API-Key: YOUR_KEY" \\
  "https://api.effant.io/v1/anomalies?severity=critical&limit=10"`,
    response: `{
  "data": [
    {
      "id": 4821,
      "wallet_address": "3Kzh9f...",
      "wallet_label": null,
      "anomaly_type": "sandwich_attack",
      "severity": "critical",
      "detected_at": "2024-06-10T13:55:12Z",
      "description": "Wallet executed sandwich attack on 3 consecutive blocks"
    }
  ],
  "meta": { "count": 10, "total": 4821 }
}`,
  },
  {
    method: 'GET',
    path: '/v1/clusters',
    auth: 'required',
    desc: 'Coordinated wallet clusters detected by the pipeline. Returns cluster metadata, total volume, and top constituent wallets.',
    params: [
      { name: 'limit',       type: 'query', required: false, desc: 'Max clusters (1–50, default 20)' },
      { name: 'min_wallets', type: 'query', required: false, desc: 'Minimum wallets per cluster (default 2)' },
    ],
    example: `curl -H "X-API-Key: YOUR_KEY" \\
  "https://api.effant.io/v1/clusters?min_wallets=5&limit=10"`,
    response: `{
  "data": [
    {
      "id": 7,
      "name": "Wash Cluster #7",
      "wallet_count": 23,
      "total_volume": 891234.5,
      "dominant_type": "bot",
      "algorithm": "hdbscan",
      "top_wallets": [
        { "address": "5fGh2k...", "label": null, "entity_type": "bot", "volume": 48201.3 }
      ]
    }
  ],
  "meta": { "count": 10 }
}`,
  },
  {
    method: 'GET',
    path: '/public/metrics',
    auth: 'public',
    desc: 'Aggregated 24-hour market metrics — volume timeline, anomaly breakdown by severity, entity distribution, and key statistics. No API key required.',
    params: [],
    example: `curl https://api.effant.io/public/metrics`,
    response: `{
  "data": {
    "key_stats": {
      "total_vol_24h": 1284930.0,
      "whale_vol_24h": 482100.0,
      "whale_pct": 37.5,
      "total_txs_24h": 29481,
      "active_wallets_24h": 8821,
      "anomaly_count_24h": 143,
      "wash_bot_pct": 8.2,
      "sandwich_pct": 3.1
    },
    "volume_timeline": [{ "hour": "2024-06-10T00:00:00Z", "volume_sol": 52000, "tx_count": 1200, "whale_vol": 18000, "whale_count": 4 }],
    "anomaly_timeline": [{ "hour": "2024-06-10T00:00:00Z", "critical": 2, "high": 7, "medium": 18, "low": 41 }],
    "entity_breakdown": [{ "type": "exchange", "count": 142 }, { "type": "bot", "count": 891 }]
  }
}`,
  },
  {
    method: 'GET',
    path: '/public/clusters/{id}/analysis',
    auth: 'public',
    desc: 'Deep analysis for a single cluster — activity timeline in 5-minute buckets, top programs used, peak activity, and duration metrics.',
    params: [
      { name: 'id', type: 'path', required: true, desc: 'Cluster ID from /v1/clusters' },
    ],
    example: `curl https://api.effant.io/public/clusters/7/analysis`,
    response: `{
  "data": {
    "cluster_id": 7,
    "wallet_count": 23,
    "total_volume": 891234.5,
    "duration_minutes": 180,
    "peak_bucket": { "bucket": "2024-06-10T11:30:00Z", "tx_count": 48, "volume_sol": 12400.0 },
    "timeline": [{ "bucket": "2024-06-10T11:00:00Z", "tx_count": 12, "volume_sol": 3100.0 }],
    "top_programs": [{ "program_id": "JUP6Lk...", "count": 291, "label": "Jupiter v6", "pct": 61.2 }]
  }
}`,
  },
]

function EndpointBadge({ method, auth }: { method: 'GET' | 'POST'; auth: 'required' | 'public' }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="mono text-xs font-bold px-2 py-0.5 rounded"
        style={{
          background: method === 'GET' ? '#0e3a5c' : '#1e3a0e',
          color: method === 'GET' ? '#38bdf8' : '#4ade80',
          border: `1px solid ${method === 'GET' ? '#0284c740' : '#16a34a40'}`,
        }}>
        {method}
      </span>
      <span className="mono text-xs px-2 py-0.5 rounded"
        style={{
          background: auth === 'public' ? '#0f2a1a' : '#1a1a0a',
          color: auth === 'public' ? '#22c55e' : '#eab308',
          border: `1px solid ${auth === 'public' ? '#16a34a30' : '#ca8a0430'}`,
        }}>
        {auth === 'public' ? 'public' : 'key required'}
      </span>
    </div>
  )
}

function EndpointCard({ ep }: { ep: EndpointDoc }) {
  const [open, setOpen]    = useState(false)
  const [copiedEx, setCopiedEx] = useState(false)

  function copyEx() {
    navigator.clipboard.writeText(ep.example)
    setCopiedEx(true)
    setTimeout(() => setCopiedEx(false), 2000)
  }

  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
      {/* Header row */}
      <button
        className="w-full text-left flex items-center gap-3 px-5 py-4 transition-colors"
        style={{ cursor: 'pointer', background: 'transparent' }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <EndpointBadge method={ep.method} auth={ep.auth} />
        <span className="mono text-sm font-semibold flex-1 text-left" style={{ color: '#e2e8f0' }}>
          {ep.path}
        </span>
        <span className="mono text-xs hidden sm:block" style={{ color: 'var(--muted)', maxWidth: 320 }}>
          {ep.desc.length > 72 ? ep.desc.slice(0, 70) + '…' : ep.desc}
        </span>
        <span className="mono text-xs ml-4 shrink-0" style={{ color: 'var(--dim)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-5 py-4 space-y-5">
            <p className="text-sm" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>{ep.desc}</p>

            {ep.params && ep.params.length > 0 && (
              <div>
                <p className="mono text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--dim)' }}>Parameters</p>
                <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                        {['Name', 'In', 'Required', 'Description'].map(h => (
                          <th key={h} className="px-3 py-2 mono uppercase tracking-widest"
                            style={{ color: 'var(--dim)', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ep.params.map(p => (
                        <tr key={p.name} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="px-3 py-2 mono font-semibold" style={{ color: '#38bdf8' }}>{p.name}</td>
                          <td className="px-3 py-2 mono" style={{ color: 'var(--muted)' }}>{p.type}</td>
                          <td className="px-3 py-2 mono" style={{ color: p.required ? 'var(--green)' : 'var(--dim)' }}>
                            {p.required ? 'yes' : 'no'}
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{p.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--dim)' }}>Request</p>
                  <button onClick={copyEx} className="mono text-xs transition-colors"
                    style={{ color: copiedEx ? 'var(--green)' : 'var(--dim)' }}
                    onMouseEnter={e => { if (!copiedEx) e.currentTarget.style.color = 'var(--muted)' }}
                    onMouseLeave={e => { if (!copiedEx) e.currentTarget.style.color = 'var(--dim)' }}>
                    {copiedEx ? 'copied' : 'copy'}
                  </button>
                </div>
                <pre className="rounded px-4 py-3 text-xs overflow-x-auto"
                  style={{ background: '#050810', border: '1px solid var(--border)', color: '#7dd3fc', lineHeight: 1.7 }}>
                  {ep.example}
                </pre>
              </div>
              <div>
                <p className="mono text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--dim)' }}>Response (200)</p>
                <pre className="rounded px-4 py-3 text-xs overflow-x-auto"
                  style={{ background: '#050810', border: '1px solid var(--border)', color: '#86efac', lineHeight: 1.7 }}>
                  {ep.response}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApiDocumentation() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '2rem' }}>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 style={{
              fontSize: 'clamp(28px, 4vw, 48px)',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: '#e2e8f0',
              fontFamily: 'inherit',
            }}>
              REST API
            </h1>
            <h2 style={{
              fontSize: 'clamp(18px, 2.5vw, 28px)',
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              color: 'var(--accent)',
              fontFamily: 'inherit',
              marginTop: 4,
            }}>
              exclusively for Solana.
            </h2>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--muted)', maxWidth: 560 }}>
              Query wallets, transactions, anomalies, and clusters in real time.
              Every endpoint returns clean JSON — no third-party wrappers, no Solana RPC rate limits.
              Data is refreshed continuously by the Effant pipeline as new blocks finalize.
            </p>
          </div>

          {/* Quick stats */}
          <div className="flex gap-3 flex-wrap shrink-0">
            {[
              { label: 'Base URL',     value: 'api.effant.io' },
              { label: 'Format',       value: 'JSON / HTTPS' },
              { label: 'Auth header',  value: 'X-API-Key' },
              { label: 'Rate limit',   value: '1 req / sec'   },
            ].map(s => (
              <div key={s.label} className="rounded px-3 py-2.5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 120 }}>
                <p className="mono text-xs mb-0.5" style={{ color: 'var(--dim)' }}>{s.label}</p>
                <p className="mono text-sm font-semibold" style={{ color: '#fff' }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How to authenticate */}
        <div className="mt-6 rounded p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--dim)' }}>Authentication</p>
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
            Pass your API key in the <span className="mono" style={{ color: '#38bdf8' }}>X-API-Key</span> header on
            every authenticated request. Public endpoints (marked <span className="mono" style={{ color: '#22c55e' }}>public</span>) need no key.
          </p>
          <pre className="rounded px-4 py-3 text-xs overflow-x-auto"
            style={{ background: '#050810', border: '1px solid var(--border)', color: '#7dd3fc', lineHeight: 1.7 }}>
{`# Authenticated request
curl -H "X-API-Key: efk_your_key_here" https://api.effant.io/v1/wallet/ADDRESS

# Public request (no key)
curl https://api.effant.io/public/metrics`}
          </pre>
        </div>

        {/* Response shape */}
        <div className="mt-4 rounded p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--dim)' }}>Response envelope</p>
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
            All endpoints return a consistent envelope with a <span className="mono" style={{ color: '#86efac' }}>data</span> field
            and a <span className="mono" style={{ color: '#86efac' }}>meta</span> field. Errors return a non-2xx status
            with a JSON <span className="mono" style={{ color: '#f87171' }}>detail</span> field.
          </p>
          <pre className="rounded px-4 py-3 text-xs overflow-x-auto"
            style={{ background: '#050810', border: '1px solid var(--border)', color: '#86efac', lineHeight: 1.7 }}>
{`// Success
{ "data": { ... }, "meta": { "count": 1, "generated_at": "2024-06-10T14:00:00Z" } }

// Error
{ "detail": "Invalid API key" }  // HTTP 401`}
          </pre>
        </div>
      </div>

      {/* Endpoint list */}
      <div>
        <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: 'var(--dim)' }}>
          Endpoints — click to expand
        </p>
        <div className="space-y-2">
          {ENDPOINTS.map(ep => (
            <EndpointCard key={ep.path} ep={ep} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Divider ────────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
      <span className="mono text-xs uppercase tracking-widest px-2" style={{ color: 'var(--dim)' }}>{label}</span>
      <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
    </div>
  )
}

// ── Main portal ───────────────────────────────────────────────────────────────

interface CustomerPortalProps {
  initialMode?: AuthMode
  resetToken?: string
  checkoutSuccess?: boolean
  onSignup?: () => void
}

export function CustomerPortal({
  initialMode,
  resetToken,
  checkoutSuccess,
  onSignup,
}: CustomerPortalProps = {}) {
  const [authed, setAuthed]           = useState(isLoggedIn)
  const [apiKey, setApiKey]           = useState<string | null>(
    () => localStorage.getItem('effant_api_key'),
  )
  const [showSuccess, setShowSuccess] = useState(!!checkoutSuccess)
  const qc                            = useQueryClient()

  const { data: me, isLoading } = useQuery<MeData>({
    queryKey: ['portal-me'],
    queryFn: fetchMe,
    enabled: authed,
    retry: false,
    staleTime: 30_000,
  })

  const handleAuth = useCallback(() => {
    setAuthed(true)
    qc.invalidateQueries({ queryKey: ['portal-me'] })
    qc.invalidateQueries({ queryKey: ['portal-call-log'] })
    if (onSignup) onSignup()
  }, [qc, onSignup])

  const handleLogout = useCallback(() => {
    logout()
    localStorage.removeItem('effant_api_key')
    setAuthed(false)
    setApiKey(null)
    qc.clear()
  }, [qc])

  const isPro = me?.api_key?.tier === 'pro'

  if (!authed) {
    return (
      <AuthForm
        onAuth={handleAuth}
        initialMode={initialMode}
        resetToken={resetToken}
      />
    )
  }

  return (
    <div className="space-y-8">

      {/* ── API Documentation (always visible, top of page) ── */}
      <ApiDocumentation />

      <Divider label="Your account" />

      {/* ── Account header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: '#fff' }}>Account</p>
          {me && (
            <p className="mono text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{me.email}</p>
          )}
        </div>
        <button onClick={handleLogout}
          className="mono text-xs transition-colors px-3 py-1.5 rounded"
          style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
          Sign out
        </button>
      </div>

      {showSuccess && (
        <CheckoutSuccessBanner onDismiss={() => setShowSuccess(false)} />
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[200, 300, 150].map(h => (
            <div key={h} className="rounded animate-pulse"
              style={{ height: h, background: 'var(--surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
      ) : me ? (
        <div className="space-y-4">
          <KeyCard me={me} onProvisioned={key => {
            localStorage.setItem('effant_api_key', key)
            setApiKey(key)
          }} />
          <BillingPanel authed={authed} />
          {isPro && <WebhooksPanel />}
          <CallLog />
          <ApiTerminal apiKey={apiKey ?? null} tier={me.api_key?.tier ?? 'starter'} />
        </div>
      ) : (
        <div className="rounded px-5 py-8 text-center text-sm"
          style={{ background: 'var(--surface)', border: '1px solid var(--red)', color: 'var(--red)' }}>
          Session expired. <button onClick={handleLogout} style={{ textDecoration: 'underline' }}>Sign in again</button>
        </div>
      )}
    </div>
  )
}
