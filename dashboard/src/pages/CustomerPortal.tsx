import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  signup, login, logout, isLoggedIn,
  fetchMe, fetchCallLog, provisionKey,
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
  const storedKey = localStorage.getItem('effant_api_key')

  const provision = useMutation({
    mutationFn: provisionKey,
    onSuccess: (data) => {
      setNewKey(data.api_key)
      onProvisioned(data.api_key)
      qc.invalidateQueries({ queryKey: ['portal-me'] })
    },
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
                ? 'Key not cached locally — revoke and re-provision to get a new one'
                : (activeKey ?? '••••••••••••••••••••••••••••••••')}
            </div>
            {activeKey && activeKey !== '__reprovision__' && (
              <button onClick={() => copy(activeKey)}
                className="rounded px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: copied ? '#22c55e20' : 'var(--border2)',
                  border: `1px solid ${copied ? '#22c55e40' : 'var(--border)'}`,
                  color: copied ? '#22c55e' : 'var(--text)',
                }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: '#fff' }}>Customer Portal</h1>
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
        <>
          <KeyCard me={me} onProvisioned={key => {
            localStorage.setItem('effant_api_key', key)
            setApiKey(key)
          }} />
          <BillingPanel authed={authed} />
          {isPro && <WebhooksPanel />}
          <CallLog />
          <ApiTerminal apiKey={apiKey ?? null} tier={me.api_key?.tier ?? 'starter'} />
        </>
      ) : (
        <div className="rounded px-5 py-8 text-center text-sm"
          style={{ background: 'var(--surface)', border: '1px solid var(--red)', color: 'var(--red)' }}>
          Session expired. <button onClick={handleLogout} style={{ textDecoration: 'underline' }}>Sign in again</button>
        </div>
      )}
    </div>
  )
}
