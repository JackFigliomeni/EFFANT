import { useState } from 'react'
import { createCheckoutSession } from '../api/billing'
import { isLoggedIn } from '../api/portal'

interface LandingProps {
  onGetStarted: (tier: 'starter' | 'pro') => void
  onLogin: () => void
  onPrivacy: () => void
  onTerms: () => void
}

const STARTER_FEATURES = [
  '10,000 API calls / day',
  'Wallet profiling & risk scores',
  'Anomaly feed (critical + high)',
  'Entity cluster data',
  '60s cache TTL',
  'Email support',
]

const PRO_FEATURES = [
  '500,000 API calls / day',
  'Everything in Starter',
  'Real-time webhook alerts',
  'Whale movement notifications',
  'Custom anomaly thresholds',
  'Sub-second cache TTL',
  'Priority support + SLA',
]

function PlanCard({
  tier,
  price,
  period,
  tagline,
  features,
  highlight,
  onStart,
}: {
  tier: 'starter' | 'pro'
  price: string
  period: string
  tagline: string
  features: string[]
  highlight: boolean
  onStart: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleClick() {
    if (isLoggedIn()) {
      setLoading(true)
      setErr('')
      try {
        const { url } = await createCheckoutSession(tier)
        window.location.href = url
      } catch (e) {
        setErr((e as Error).message)
        setLoading(false)
      }
    } else {
      onStart()
    }
  }

  return (
    <div
      className="rounded-lg flex flex-col"
      style={{
        background: highlight ? '#0f1629' : 'var(--surface)',
        border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: highlight ? '0 0 40px #5b6cf820' : 'none',
      }}
    >
      {highlight && (
        <div
          className="text-center py-1.5 text-xs font-semibold mono tracking-widest uppercase rounded-t-lg"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Most Popular
        </div>
      )}
      <div className="p-8 flex flex-col flex-1">
        <div className="mb-6">
          <p className="mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
            {tier}
          </p>
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-4xl font-bold" style={{ color: '#fff' }}>{price}</span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>{period}</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{tagline}</p>
        </div>

        <ul className="space-y-3 mb-8 flex-1">
          {features.map(f => (
            <li key={f} className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5" style={{ color: 'var(--green)' }}>✓</span>
              <span className="text-sm" style={{ color: 'var(--text)' }}>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={handleClick}
          disabled={loading}
          className="w-full rounded py-3 text-sm font-semibold transition-all"
          style={{
            background: highlight ? 'var(--accent)' : 'transparent',
            border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
            color: highlight ? '#fff' : 'var(--text)',
            opacity: loading ? 0.6 : 1,
          }}
          onMouseEnter={e => {
            if (!highlight) e.currentTarget.style.borderColor = 'var(--accent)'
          }}
          onMouseLeave={e => {
            if (!highlight) e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          {loading ? 'Redirecting…' : `Get Started with ${tier.charAt(0).toUpperCase() + tier.slice(1)}`}
        </button>
        {err && (
          <p className="mt-2 text-xs text-center" style={{ color: 'var(--red)' }}>{err}</p>
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
          <span className="mono font-bold" style={{ color: 'var(--accent)', fontSize: 15, letterSpacing: '-0.01em' }}>
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
            style={{ background: 'var(--accent)', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 pt-28 pb-24 mx-auto" style={{ maxWidth: 760 }}>
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs mono mb-8"
          style={{ background: '#5b6cf810', border: '1px solid #5b6cf835', color: 'var(--accent)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
          Live Solana intelligence · updating every 30s
        </div>
        <h1 className="font-bold mb-5 leading-tight" style={{ color: '#fff', fontSize: 52 }}>
          Solana on-chain intelligence<br />
          <span style={{ color: 'var(--accent)' }}>for builders who ship.</span>
        </h1>
        <p className="text-base mb-10 mx-auto" style={{ color: 'var(--muted)', maxWidth: 520, lineHeight: 1.7 }}>
          Wallet profiling, anomaly detection, entity clustering, and whale alerts —
          all via a single REST API. From raw transactions to signal in milliseconds.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => onGetStarted('starter')}
            className="rounded px-8 py-3 font-semibold text-sm transition-opacity"
            style={{ background: 'var(--accent)', color: '#fff' }}
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
              className="flex flex-col gap-1 px-8 py-6"
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
      <section id="pricing" className="px-6 mb-24 mx-auto" style={{ maxWidth: 860 }}>
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-3" style={{ color: '#fff' }}>Simple, transparent pricing</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No per-query fees. No surprise bills. Cancel any time.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <PlanCard
            tier="starter"
            price="$499"
            period="/month"
            tagline="For teams building on Solana."
            features={STARTER_FEATURES}
            highlight={false}
            onStart={() => onGetStarted('starter')}
          />
          <PlanCard
            tier="pro"
            price="$4,900"
            period="/month"
            tagline="For institutions and high-volume apps."
            features={PRO_FEATURES}
            highlight
            onStart={() => onGetStarted('pro')}
          />
        </div>

        <div className="flex items-center justify-center gap-2 mt-8">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#eab308' }} />
          <p className="text-xs mono" style={{ color: 'var(--dim)' }}>
            Test mode active · card 4242 4242 4242 4242 · any expiry · any CVC
          </p>
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
