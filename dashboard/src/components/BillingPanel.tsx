import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSubscription, createCheckoutSession, cancelSubscription } from '../api/billing'
import type { Subscription } from '../api/billing'

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLOR: Record<string, string> = {
  active:     '#22c55e',
  canceling:  '#eab308',
  past_due:   '#f97316',
  canceled:   '#f43f5e',
  incomplete: '#64748b',
}

const PLANS = [
  {
    tier:     'starter' as const,
    name:     'Starter',
    price:    '$499',
    period:   '/month',
    limit:    '10,000 calls/day',
    features: ['All 6 API endpoints', 'Anomaly detection feed', 'Entity clustering', 'Wallet profiling', '30s cache TTL on anomalies'],
  },
  {
    tier:     'pro' as const,
    name:     'Professional',
    price:    '$4,900',
    period:   '/month',
    limit:    '500,000 calls/day',
    features: ['Everything in Starter', '50× higher rate limit', 'Priority support', 'SLA guarantee', 'Dedicated onboarding'],
    highlight: true,
  },
]

function PlanCard({
  plan, currentTier, status, onCheckout, loading,
}: {
  plan: typeof PLANS[0]
  currentTier?: string
  status?: string
  onCheckout: (tier: 'starter' | 'pro') => void
  loading: boolean
}) {
  const isCurrent = currentTier === plan.tier && status && status !== 'canceled'
  const isActive  = isCurrent && status === 'active'

  return (
    <div className="rounded overflow-hidden flex flex-col"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${plan.highlight ? '#5b6cf840' : 'var(--border)'}`,
      }}>
      {plan.highlight && (
        <div className="px-4 py-1.5 text-center"
          style={{ background: 'var(--accent)', fontSize: 11 }}>
          <span className="mono font-bold uppercase tracking-widest text-white">Most Popular</span>
        </div>
      )}

      <div className="p-5 flex-1 space-y-4">
        <div>
          <p className="mono text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>
            {plan.name}
          </p>
          <div className="flex items-baseline gap-1">
            <span className="mono font-bold" style={{ fontSize: 28, color: '#fff' }}>{plan.price}</span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>{plan.period}</span>
          </div>
          <p className="mono text-xs mt-1" style={{ color: 'var(--accent)' }}>{plan.limit}</p>
        </div>

        <ul className="space-y-2">
          {plan.features.map(f => (
            <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span style={{ color: '#22c55e' }}>✓</span> {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="px-5 pb-5">
        {isActive ? (
          <div className="rounded px-3 py-2.5 text-center"
            style={{ background: '#22c55e15', border: '1px solid #22c55e30' }}>
            <span className="mono text-xs font-semibold" style={{ color: '#22c55e' }}>
              ✓ Current plan
            </span>
          </div>
        ) : (
          <button
            onClick={() => onCheckout(plan.tier)}
            disabled={loading}
            className="w-full rounded py-2.5 text-sm font-semibold transition-all"
            style={{
              background: plan.highlight ? 'var(--accent)' : 'var(--surface2)',
              border: `1px solid ${plan.highlight ? 'transparent' : 'var(--border2)'}`,
              color: '#fff',
              opacity: loading ? 0.6 : 1,
            }}>
            {loading ? 'Redirecting…' : isCurrent ? 'Renew' : `Subscribe — ${plan.price}/mo`}
          </button>
        )}
      </div>
    </div>
  )
}

export function BillingPanel({ authed }: { authed: boolean }) {
  const qc = useQueryClient()
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [msg, setMsg] = useState('')

  const { data: sub, isLoading } = useQuery<Subscription>({
    queryKey: ['billing-sub'],
    queryFn: fetchSubscription,
    enabled: authed,
    staleTime: 30_000,
  })

  const cancelMut = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (data) => {
      setMsg(data.message)
      setCancelConfirm(false)
      qc.invalidateQueries({ queryKey: ['billing-sub'] })
    },
    onError: (err) => setMsg((err as Error).message),
  })

  async function handleCheckout(tier: 'starter' | 'pro') {
    setCheckoutLoading(tier)
    try {
      const { url } = await createCheckoutSession(tier)
      window.location.href = url
    } catch (err) {
      setMsg((err as Error).message)
      setCheckoutLoading(null)
    }
  }

  if (!authed) return null

  return (
    <div className="rounded overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#fff' }}>
          Subscription
        </span>
        <span className="ml-3 text-xs" style={{ color: 'var(--muted)' }}>
          Stripe test mode
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Current subscription status */}
        {!isLoading && sub?.has_subscription && (
          <div className="rounded px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full"
                style={{ background: STATUS_COLOR[sub.status ?? 'incomplete'] ?? '#64748b' }} />
              <div>
                <span className="mono text-sm font-semibold" style={{ color: '#fff' }}>
                  {sub.tier?.charAt(0).toUpperCase()}{sub.tier?.slice(1)} plan
                </span>
                <span className="mono text-xs ml-2" style={{ color: STATUS_COLOR[sub.status ?? 'incomplete'] }}>
                  {sub.status}
                </span>
              </div>
            </div>
            {sub.current_period_end && (
              <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
                {sub.status === 'canceling' ? 'Cancels' : 'Renews'} {relTime(sub.current_period_end)}
              </span>
            )}
            {sub.status === 'active' && !cancelConfirm && (
              <button onClick={() => setCancelConfirm(true)}
                className="mono text-xs transition-colors"
                style={{ color: 'var(--dim)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                Cancel plan
              </button>
            )}
            {cancelConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Are you sure?</span>
                <button onClick={() => cancelMut.mutate()}
                  disabled={cancelMut.isPending}
                  className="mono text-xs font-semibold" style={{ color: 'var(--red)' }}>
                  {cancelMut.isPending ? 'Cancelling…' : 'Yes, cancel'}
                </button>
                <button onClick={() => setCancelConfirm(false)}
                  className="mono text-xs" style={{ color: 'var(--muted)' }}>
                  Keep plan
                </button>
              </div>
            )}
          </div>
        )}

        {msg && (
          <p className="mono text-xs" style={{ color: 'var(--yellow)' }}>{msg}</p>
        )}

        {/* Test mode notice */}
        <div className="rounded px-3 py-2.5 text-xs"
          style={{ background: '#eab30810', border: '1px solid #eab30830', color: '#eab308' }}>
          <span className="mono font-semibold">TEST MODE</span>
          <span className="ml-2" style={{ color: 'var(--muted)' }}>
            Use card <span className="mono">4242 4242 4242 4242</span>, any expiry, any CVC.
          </span>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLANS.map(plan => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              currentTier={sub?.tier}
              status={sub?.status}
              onCheckout={handleCheckout}
              loading={checkoutLoading === plan.tier}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
