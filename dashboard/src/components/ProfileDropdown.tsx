import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMe, logout, isLoggedIn } from '../api/portal'
import { fetchSubscription, cancelSubscription } from '../api/billing'

const INSTALL_STEPS = [
  {
    label: '1 · Get your API key',
    code: `# Copy your key from the API Portal tab\n# It looks like: eff_sk_xxxxxxxxxxxx`,
  },
  {
    label: '2 · Test authentication',
    code: `curl -H "X-API-Key: YOUR_KEY" \\\n  "https://api.effant.tech/v1/health"`,
  },
  {
    label: '3 · Fetch anomalies',
    code: `curl -H "X-API-Key: YOUR_KEY" \\\n  "https://api.effant.tech/v1/anomalies?severity=critical&limit=20"`,
  },
  {
    label: '4 · Profile a wallet',
    code: `curl -H "X-API-Key: YOUR_KEY" \\\n  "https://api.effant.tech/v1/wallet/6AvA8pyr..."`,
  },
  {
    label: '5 · Get entity clusters',
    code: `curl -H "X-API-Key: YOUR_KEY" \\\n  "https://api.effant.tech/v1/clusters?min_wallets=2&limit=10"`,
  },
  {
    label: '6 · Wallet transactions',
    code: `curl -H "X-API-Key: YOUR_KEY" \\\n  "https://api.effant.tech/v1/wallet/6AvA8pyr.../transactions"`,
  },
]

export function ProfileDropdown({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen]               = useState(false)
  const [showGuide, setShowGuide]     = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [copied, setCopied]           = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const qc  = useQueryClient()

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn:  fetchMe,
    enabled:  isLoggedIn(),
    staleTime: 60_000,
  })

  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn:  fetchSubscription,
    enabled:  isLoggedIn(),
    staleTime: 60_000,
  })

  const cancelMut = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] })
      setCancelConfirm(false)
    },
  })

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  if (!isLoggedIn()) return null

  const email   = me?.email ?? ''
  const initial = email[0]?.toUpperCase() ?? '?'
  const hasSub  = sub?.has_subscription && ['active', 'canceling'].includes(sub?.status ?? '')
  const isCanceling = sub?.status === 'canceling'

  function copyCode(code: string) {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <>
      {/* ── Avatar button ───────────────────────────────────────── */}
      <div className="relative shrink-0" ref={ref}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 rounded-full px-2 py-1 transition-all"
          style={{
            background:  open ? 'rgba(91,108,248,0.15)' : 'rgba(91,108,248,0.08)',
            border:      '1px solid rgba(91,108,248,0.25)',
          }}
        >
          <span
            className="h-6 w-6 rounded-full flex items-center justify-center mono text-xs font-bold shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {initial}
          </span>
          <span className="mono text-xs truncate" style={{ color: 'var(--muted)', maxWidth: 120 }}>
            {email}
          </span>
          <span className="mono text-xs" style={{ color: 'var(--dim)' }}>▾</span>
        </button>

        {/* ── Dropdown ──────────────────────────────────────────── */}
        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-64 rounded-lg overflow-hidden z-50"
            style={{ background: '#0c1020', border: '1px solid var(--border)', boxShadow: '0 12px 40px #00000080' }}
          >
            {/* User info */}
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="h-7 w-7 rounded-full flex items-center justify-center mono text-xs font-bold shrink-0"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {initial}
                </span>
                <p className="mono text-xs font-semibold truncate" style={{ color: '#fff' }}>{email}</p>
              </div>
              {sub?.tier && (
                <p className="mono text-xs mt-1 capitalize" style={{ color: isCanceling ? 'var(--red)' : 'var(--accent)' }}>
                  {sub.tier} · {isCanceling ? 'cancels at period end' : sub.status}
                </p>
              )}
            </div>

            {/* Settings section */}
            <div className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="px-2 pb-1 mono text-xs uppercase tracking-widest" style={{ color: 'var(--dim)' }}>
                Settings
              </p>
              <button
                onClick={() => { setShowGuide(true); setOpen(false) }}
                className="w-full text-left px-2 py-2 rounded text-xs flex items-center gap-2 transition-all"
                style={{ color: 'var(--text)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(91,108,248,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span>📖</span> Installation Guide
              </button>

              {!isCanceling && (
                <button
                  onClick={() => { setCancelConfirm(true); setOpen(false) }}
                  className="w-full text-left px-2 py-2 rounded text-xs flex items-center gap-2 transition-all"
                  style={{ color: '#f87171' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(244,63,94,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>✕</span> Cancel Subscription
                </button>
              )}
            </div>

            {/* Sign out */}
            <div className="px-2 py-2">
              <button
                onClick={() => { logout(); setOpen(false); onSignOut() }}
                className="w-full text-left px-2 py-2 rounded text-xs flex items-center gap-2 transition-all"
                style={{ color: 'var(--muted)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(91,108,248,0.08)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)' }}
              >
                <span>→</span> Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Cancel confirm modal ────────────────────────────────── */}
      {cancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setCancelConfirm(false)}
        >
          <div
            className="rounded-lg p-6 w-96"
            style={{ background: '#0c1020', border: '1px solid var(--border)', boxShadow: '0 16px 48px #00000080' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-sm mb-2" style={{ color: '#fff' }}>Cancel subscription?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
              Your plan stays active until the end of the current billing period.
              After that, it won't renew and your API key will be deactivated.
            </p>
            {cancelMut.isError && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {(cancelMut.error as Error).message}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCancelConfirm(false)}
                className="px-4 py-2 rounded text-xs transition-all"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                Keep plan
              </button>
              <button
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                className="px-4 py-2 rounded text-xs font-semibold"
                style={{ background: '#f43f5e', color: '#fff', opacity: cancelMut.isPending ? 0.6 : 1 }}
              >
                {cancelMut.isPending ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Installation guide modal ────────────────────────────── */}
      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setShowGuide(false)}
        >
          <div
            className="rounded-lg overflow-hidden w-full max-w-2xl flex flex-col"
            style={{ background: '#0c1020', border: '1px solid var(--border)', maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="font-semibold text-sm" style={{ color: '#fff' }}>Installation Guide</h3>
                <p className="mono text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
                  REST API · no SDKs required · single header auth
                </p>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="mono text-xs px-2 py-1 rounded transition-all"
                style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
              >
                ✕
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto p-6 space-y-5">
              <div
                className="rounded p-3 mono text-xs"
                style={{ background: '#5b6cf810', border: '1px solid #5b6cf825', color: 'var(--accent)' }}
              >
                All requests require: <code style={{ color: '#fff' }}>X-API-Key: YOUR_KEY</code>
                &nbsp;&nbsp;— get yours from the API Portal tab.
              </div>

              {INSTALL_STEPS.map(({ label, code }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="mono text-xs uppercase tracking-widest" style={{ color: 'var(--dim)' }}>{label}</p>
                    <button
                      onClick={() => copyCode(code)}
                      className="mono text-xs px-2 py-0.5 rounded transition-all"
                      style={{
                        color:   copied === code ? 'var(--green)' : 'var(--dim)',
                        border:  '1px solid var(--border)',
                        background: 'transparent',
                      }}
                    >
                      {copied === code ? '✓ copied' : 'copy'}
                    </button>
                  </div>
                  <pre
                    className="p-4 rounded-lg mono text-xs leading-relaxed overflow-x-auto"
                    style={{ background: '#060a10', color: '#94a3b8', border: '1px solid var(--border)' }}
                  >{code}</pre>
                </div>
              ))}

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <p className="mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--dim)' }}>
                  Response format (all endpoints)
                </p>
                <pre
                  className="p-4 rounded-lg mono text-xs leading-relaxed"
                  style={{ background: '#060a10', color: '#94a3b8', border: '1px solid var(--border)' }}
                >{`{
  "data": [ ... ],
  "meta": {
    "count": 20,
    "generated_at": "2025-04-07T14:22:01Z"
  }
}`}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
