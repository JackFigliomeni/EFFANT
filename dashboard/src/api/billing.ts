const BASE = import.meta.env.VITE_API_URL ?? ''
const token = () => localStorage.getItem('effant_token') ?? ''

async function billingFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export interface Subscription {
  has_subscription: boolean
  tier?: string
  status?: string
  current_period_end?: string | null
}

export const fetchSubscription = () =>
  billingFetch<Subscription>('/billing/subscription')

export type BillingTier = 'starter' | 'analyst' | 'analyst_pro' | 'fund'

export const createCheckoutSession = (tier: BillingTier) =>
  billingFetch<{ url: string; session_id: string }>('/billing/create-checkout-session', {
    method: 'POST',
    body: JSON.stringify({ tier }),
  })

export const cancelSubscription = () =>
  billingFetch<{ cancelled: boolean; message: string }>('/billing/cancel', {
    method: 'POST',
  })
