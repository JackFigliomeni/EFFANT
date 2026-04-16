import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSubscription, createCheckoutSession, cancelSubscription } from '../api/billing'
import type { Subscription, BillingTier } from '../api/billing'

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
    tier:     'starter' as BillingTier,
    name:     'Starter',
    price:    '$20',
    period:   '/month',
    limit:    'No REST API',
    features: ['Live dashboard', 'Metrics charts', 'Anomaly detail', 'Wallet Explorer'],
  },
  {
    tier:     'analyst' as BillingTier,
    name:     'Analyst',
    price:    '$100',
    period:   '/month',
    limit:    '500 req / month',
    features: ['Everything in Starter', 'Terminal access', 'REST API — 500 req/mo', 'Webhooks'],
    highlight: true,
  },
  {
    tier:     'analyst_pro' as BillingTier,
    name:     'Analyst Pro',
    price:    '$500',
    period:   '/month',
    limit:    '10,000 req / month',
    features: ['Everything in Analyst', 'REST API — 10k req/mo', 'Priority support'],
  },
  {
    tier:     'fund' as BillingTier,
    name:     'Fund',
    price:    '$1,200',
    period:   '/month',
    limit:    '100,000 req / month',
    features: ['Everything in Analyst Pro', 'REST API — 100k req/mo', 'SLA guarantee', 'Dedicated onboarding'],
  },
]

function PlanCard({
  plan, currentTier, status, onCheckout, loading,
}: {
  plan: typeof PLANS[0]
  currentTier?: string
  status?: string
  onCheckout: (tier: BillingTier) => void
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
          {/* Monthly limit label — "req/month" terminology */}
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

  const { data: sub, isLoading } = useQuery<Subscription>({
    queryKey: ['billing-sub'],
    queryFn: fetchSubscription,
    enabled: authed,
    staleTime: 30_000,
  })

  const cancelMut = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      setCancelConfirm(false)
      qc.invalidateQueries({ queryKey: ['billing-sub'] })
    },
  })

  async function handleCheckout(tier: BillingTier) {
    setCheckoutLoading(tier)
    try {
      const { url } = await createCheckoutSession(tier)
      window.location.href = url
    } catch {
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
                  {sub.tier?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} plan
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

        {/* Plan cards — only shown when user has no active subscription */}
        {!sub?.has_subscription || !['active', 'canceling'].includes(sub?.status ?? '') ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  )
}
