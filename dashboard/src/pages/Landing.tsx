import { useState } from 'react'
import { createCheckoutSession } from '../api/billing'
import type { BillingTier } from '../api/billing'
import { isLoggedIn } from '../api/portal'

interface LandingProps {
  onGetStarted: (tier: string) => void
  onLogin: () => void
  onPrivacy: () => void
  onTerms: () => void
}

const STARTER_FEATURES = [
  'Live overview dashboard',
  'Metrics tab with candlestick charts',
  'Anomaly feed with click-through detail',
  'Entity cluster explorer',
  'Wallet Explorer',
  'No REST API',
]

const ANALYST_FEATURES = [
  'Everything in Starter',
  'API Terminal access',
  'REST API — 500 requests/month',
  'Wallet profiling & risk scores',
  'Real-time webhook alerts',
  'Email support',
]

const ANALYST_PRO_FEATURES = [
  'Everything in Analyst',
  'REST API — 10,000 requests/month',
  'Priority support',
  'Sub-second cache TTL',
]

const FUND_FEATURES = [
  'Everything in Analyst Pro',
  'REST API — 100,000 requests/month',
  'SLA guarantee',
  'Dedicated onboarding',
  'Custom anomaly thresholds',
]

const ENTERPRISE_FEATURES = [
  'Custom API request limits',
  'Dedicated infrastructure',
  'Custom data pipelines',
  'White-label options',
  'Bespoke integrations',
  'Direct engineering support',
]

function PlanCard({
  tier,
  name,
  price,
  period,
  features,
  highlight,
  enterprise,
  onStart,
}: {
  tier: string
  name: string
  price: string
  period: string
  features: string[]
  highlight: boolean
  enterprise?: boolean
  onStart: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleClick() {
    if (enterprise) return
    if (isLoggedIn()) {
      setLoading(true)
      setErr('')
      try {
        const { url } = await createCheckoutSession(tier as BillingTier)
        window.location.href = url
      } catch (e) {
        setErr((e as Error).message)
        setLoading(false)
      }
    } else {
      onStart()
    }
  }

  const borderColor = enterprise ? '#ca8a04' : highlight ? '#5b6cf8' : 'var(--border)'

  return (
    <div
      className="rounded-lg flex flex-col"
      style={{
        background: highlight ? '#0f1629' : enterprise ? '#0f0e00' : 'var(--surface)',
        border: `1px solid ${borderColor}`,
        boxShadow: highlight ? '0 0 40px #5b6cf820' : enterprise ? '0 0 30px #ca8a0410' : 'none',
      }}
    >
      {highlight && (
        <div
          className="text-center py-1.5 text-xs font-semibold mono tracking-widest uppercase rounded-t-lg"
          style={{ background: '#5b6cf8', color: '#fff' }}
        >
          Most Popular
        </div>
      )}
      {enterprise && (
        <div
          className="text-center py-1.5 text-xs font-semibold mono tracking-widest uppercase rounded-t-lg"
          style={{ background: '#ca8a04', color: '#fff' }}
        >
          Enterprise
        </div>
      )}
      <div className="p-8 flex flex-col flex-1">
        <div className="mb-6">
          <p className="mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
            {name}
          </p>
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-4xl font-bold" style={{ color: '#fff' }}>{price}</span>
            {period && <span className="text-sm" style={{ color: 'var(--muted)' }}>{period}</span>}
          </div>
          {enterprise && (
            <p className="mono text-xs mt-1" style={{ color: '#ca8a04' }}>billing@effant.tech</p>
          )}
        </div>

        <ul className="space-y-3 mb-8 flex-1">
          {features.map(f => (
            <li key={f} className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5" style={{ color: enterprise ? '#ca8a04' : 'var(--green)' }}>✓</span>
              <span className="text-sm" style={{ color: 'var(--text)' }}>{f}</span>
            </li>
          ))}
        </ul>

        {enterprise ? (
          <a
            href="mailto:billing@effant.tech"
            className="w-full rounded py-3 text-sm font-semibold text-center block transition-all"
            style={{
              background: 'transparent',
              border: '1px solid #ca8a04',
              color: '#ca8a04',
            }}
          >
            Contact for pricing
          </a>
        ) : (
          <>
            <button
              onClick={handleClick}
              disabled={loading}
              className="w-full rounded py-3 text-sm font-semibold transition-all"
              style={{
                background: highlight ? '#5b6cf8' : 'transparent',
                border: `1px solid ${highlight ? '#5b6cf8' : 'var(--border)'}`,
                color: highlight ? '#fff' : 'var(--text)',
                opacity: loading ? 0.6 : 1,
              }}
              onMouseEnter={e => {
                if (!highlight) e.currentTarget.style.borderColor = '#5b6cf8'
              }}
              onMouseLeave={e => {
                if (!highlight) e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              {loading ? 'Redirecting…' : `Get Started with ${name}`}
            </button>
            {err && (
              <p className="mt-2 text-xs text-center" style={{ color: 'var(--red)' }}>{err}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function Landing({ onGetStarted, onLogin, onPrivacy, onTerms }: LandingProps) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-10"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <span className="mono font-bold" style={{ color: '#5b6cf8', fontSize: 15, letterSpacing: '-0.01em' }}>
            EFFANT
          </span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span className="text-xs" style={{ color: 'var(--dim)' }}>Solana Intelligence</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onLogin}
            className="text-xs font-medium px-4 py-2 rounded transition-all"
            style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--border2)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            Sign in
          </button>
          <button
            onClick={() => onGetStarted('starter')}
            className="rounded px-4 py-2 text-xs font-semibold transition-opacity"
            style={{ background: '#5b6cf8', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section
        className="px-6 pt-28 pb-24"
        style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center', width: '100%' }}
      >
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs mono mb-8"
          style={{ background: '#5b6cf810', border: '1px solid #5b6cf835', color: '#5b6cf8' }}
        >
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: '#5b6cf8' }} />
          Live Solana intelligence · updating every 30s
        </div>
        <h1
          className="font-bold mb-5 leading-tight"
          style={{ color: '#fff', fontSize: 52, textAlign: 'center' }}
        >
          Solana on-chain intelligence<br />
          <span style={{ color: '#5b6cf8' }}>for builders who ship.</span>
        </h1>
        <p
          className="text-base mb-10"
          style={{ color: 'var(--muted)', maxWidth: 520, lineHeight: 1.7, margin: '0 auto 40px auto', textAlign: 'center' }}
        >
          Wallet profiling, anomaly detection, entity clustering, and whale alerts —
          all via a single REST API. From raw transactions to signal in milliseconds.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => onGetStarted('starter')}
            className="rounded px-8 py-3 font-semibold text-sm transition-opacity"
            style={{ background: '#5b6cf8', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Start free trial →
          </button>
          <button
            onClick={onLogin}
            className="rounded px-8 py-3 font-semibold text-sm transition-all"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--border2)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            Sign in
          </button>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mx-6 mb-20 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Wallets tracked',      value: '2.4M+',  sub: 'indexed addresses'  },
            { label: 'Transactions indexed', value: '180M+',  sub: 'on-chain records'    },
            { label: 'Anomalies detected',   value: '12K+',   sub: 'flagged events'      },
            { label: 'API uptime',           value: '99.9%',  sub: 'last 90 days'        },
          ].map(({ label, value, sub }, i) => (
            <div
              key={label}
              className="flex flex-col items-center text-center gap-1 px-8 py-6"
              style={{
                background: 'var(--surface)',
                borderRight: i < 3 ? '1px solid var(--border)' : 'none',
              }}
            >
              <p className="mono text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--dim)' }}>{label}</p>
              <p className="mono font-bold tabular-nums" style={{ color: '#fff', fontSize: 28, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Code preview */}
      <section className="px-6 mb-20 mx-auto" style={{ maxWidth: 900 }}>
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold mb-3" style={{ color: '#fff' }}>
            One header. Instant signal.
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Integrate in under 5 minutes. No SDKs required.
          </p>
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {/* Terminal chrome */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: '#0d1117', borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-1.5">
              {['#f43f5e', '#eab308', '#22c55e'].map(c => (
                <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <span className="mono text-xs" style={{ color: 'var(--dim)' }}>bash</span>
            <div style={{ width: 48 }} />
          </div>
          <pre
            className="p-7 mono text-sm leading-loose overflow-x-auto"
            style={{ background: '#060a10', color: '#94a3b8' }}
          >{[
            '# Detect anomalies on any wallet',
            'curl -H "X-API-Key: eff_sk_..." \\',
            '  "https://api.effant.tech/v1/anomalies?severity=critical"',
            '',
            '# Response',
            '{',
            '  "data": [',
            '    {',
            '      "wallet_address": "6AvA8pyr...",',
            '      "anomaly_type":   "sandwich_attack",',
            '      "severity":       "critical",',
            '      "detected_at":    "2025-04-07T14:22:01Z"',
            '    }',
            '  ],',
            '  "meta": { "count": 1 }',
            '}',
          ].join('\n')}</pre>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 mb-24 mx-auto" style={{ maxWidth: 1060 }}>
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-3" style={{ color: '#fff' }}>Simple, transparent pricing</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No per-query fees. No surprise bills. Cancel any time.
          </p>
        </div>

        {/* Row 1: Starter, Analyst (highlighted), Analyst Pro */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
          <PlanCard
            tier="starter"
            name="Starter"
            price="$20"
            period="/month"
            features={STARTER_FEATURES}
            highlight={false}
            onStart={() => onGetStarted('starter')}
          />
          <PlanCard
            tier="analyst"
            name="Analyst"
            price="$100"
            period="/month"
            features={ANALYST_FEATURES}
            highlight
            onStart={() => onGetStarted('analyst')}
          />
          <PlanCard
            tier="analyst_pro"
            name="Analyst Pro"
            price="$500"
            period="/month"
            features={ANALYST_PRO_FEATURES}
            highlight={false}
            onStart={() => onGetStarted('analyst_pro')}
          />
        </div>

        {/* Row 2: Fund, Enterprise */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <PlanCard
            tier="fund"
            name="Fund"
            price="$1,200"
            period="/month"
            features={FUND_FEATURES}
            highlight={false}
            onStart={() => onGetStarted('fund')}
          />
          <PlanCard
            tier="enterprise"
            name="Enterprise"
            price="Custom"
            period=""
            features={ENTERPRISE_FEATURES}
            highlight={false}
            enterprise
            onStart={() => {}}
          />
        </div>

      </section>

      {/* Footer */}
      <footer
        className="border-t px-8 py-8 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="mono text-xs" style={{ color: 'var(--dim)' }}>
          EFFANT · Solana Intelligence Platform · billing@effant.tech
        </p>
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={onPrivacy}
            className="mono text-xs"
            style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
          >
            Privacy Policy
          </button>
          <span style={{ color: 'var(--dim)' }}>·</span>
          <button
            onClick={onTerms}
            className="mono text-xs"
            style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
          >
            Terms of Service
          </button>
        </div>
      </footer>
    </div>
  )
}
