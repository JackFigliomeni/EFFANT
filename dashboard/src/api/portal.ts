// Portal API — uses JWT Bearer auth, not X-API-Key

async function portalFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('effant_token')
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiKeyInfo {
  key_hash: string
  tier: 'starter' | 'pro'
  calls_today: number
  calls_limit: number
  active: boolean
  created_at: string
  last_used_at: string | null
  reset_at: string
}

export interface MeData {
  email: string
  has_key: boolean
  api_key: ApiKeyInfo | null
}

export interface CallLogEntry {
  endpoint: string
  method: string
  status_code: number
  response_ms: number
  called_at: string
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signup(email: string, password: string) {
  const data = await portalFetch<{ token: string; email: string }>('/portal/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  localStorage.setItem('effant_token', data.token)
  return data
}

export async function login(email: string, password: string) {
  const data = await portalFetch<{ token: string; email: string }>('/portal/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  localStorage.setItem('effant_token', data.token)
  return data
}

export function logout() {
  localStorage.removeItem('effant_token')
}

export function isLoggedIn() {
  return !!localStorage.getItem('effant_token')
}

// ── Portal data ───────────────────────────────────────────────────────────────

export const fetchMe = () =>
  portalFetch<MeData>('/portal/me')

export const fetchCallLog = () =>
  portalFetch<{ calls: CallLogEntry[] }>('/portal/call-log')

export const provisionKey = () =>
  portalFetch<{ api_key: string; tier: string; calls_limit: number }>('/portal/provision-key', {
    method: 'POST',
  })

// ── Forgot / reset password ───────────────────────────────────────────────────

export const forgotPassword = (email: string) =>
  portalFetch<{ message: string }>('/portal/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })

export const resetPassword = (token: string, password: string) =>
  portalFetch<{ token: string; email: string }>('/portal/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })

// ── Webhooks (Pro only) ───────────────────────────────────────────────────────

export interface Webhook {
  id: number
  url: string
  event_types: string[]
  active: boolean
  created_at: string | null
  last_triggered_at: string | null
  last_status: number | null
  secret_key?: string
}

export const fetchWebhooks = () =>
  portalFetch<{ webhooks: Webhook[] }>('/portal/webhooks')

export const createWebhook = (url: string, event_types: string[]) =>
  portalFetch<{ webhook: Webhook }>('/portal/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, event_types }),
  })

export const deleteWebhook = (id: number) =>
  portalFetch<void>(`/portal/webhooks/${id}`, { method: 'DELETE' })
