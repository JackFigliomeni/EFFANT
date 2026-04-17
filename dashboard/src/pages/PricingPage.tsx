import { useState, useEffect, useRef } from 'react'
import { createCheckoutSession } from '../api/billing'
import type { BillingTier } from '../api/billing'
import { isLoggedIn } from '../api/portal'
import type { Page } from '../components/Layout'

interface PricingPageProps {
  onBack: () => void
  onLogin: () => void
  onGetStarted: () => void
  onNav: (p: Page) => void
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

  const borderColor = enterprise ? '#ca8a04' : highlight ? '#9daab6' : 'var(--border)'
  const bgColor = highlight ? '#1a1a1a' : enterprise ? '#111100' : '#141414'

  return (
    <div
      className="rounded-lg flex flex-col"
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        boxShadow: highlight ? '0 0 40px #9daab610' : enterprise ? '0 0 30px #ca8a0410' : 'none',
      }}
    >
      {highlight && (
        <div
          className="text-center py-1.5 text-xs font-semibold mono tracking-widest uppercase rounded-t-lg"
          style={{ background: '#9daab6', color: '#0d0d0d' }}
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
              textDecoration: 'none',
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
                background: highlight ? '#fff' : 'transparent',
                border: `1px solid ${highlight ? '#fff' : 'var(--border)'}`,
                color: highlight ? '#0d0d0d' : 'var(--text)',
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => {
                if (!highlight) {
                  e.currentTarget.style.borderColor = '#9daab6'
                  e.currentTarget.style.color = '#fff'
                }
              }}
              onMouseLeave={e => {
                if (!highlight) {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.color = 'var(--text)'
                }
              }}
            >
              {loading ? 'Redirecting…' : `Get started with ${name}`}
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

export function PricingPage({ onBack, onLogin, onGetStarted, onNav }: PricingPageProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const PRODUCTS: { label: string; page: Page }[] = [
    { label: 'Overview',       page: 'overview'  },
    { label: 'Metrics',        page: 'metrics'   },
    { label: 'Wallet Explorer',page: 'explorer'  },
    { label: 'Terminal',       page: 'terminal'  },
    { label: 'API',            page: 'portal'    },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Sticky nav */}
      <nav
        className="sticky top-0 z-20 flex items-center justify-between px-8"
        style={{
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          height: 60,
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="mono font-bold"
            style={{ background: 'none', border: 'none', color: '#9daab6', fontSize: 15, letterSpacing: '0.05em', cursor: 'pointer' }}
          >
            EFFANT
          </button>
          <span style={{ color: 'var(--border2)', userSelect: 'none' }}>|</span>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>Solana Intelligence</span>
        </div>

        <div className="flex items-center gap-6">
          {/* Products dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(v => !v)}
              className="text-xs font-medium flex items-center gap-1"
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              Products <span style={{ fontSize: 10 }}>▼</span>
            </button>
            {dropdownOpen && (
              <div
                className="absolute top-full mt-2 rounded-lg py-1 z-50"
                style={{
                  background: '#141414',
                  border: '1px solid #242424',
                  boxShadow: '0 8px 32px #00000060',
                  minWidth: 160,
                  right: 0,
                }}
              >
                {PRODUCTS.map(p => (
                  <button
                    key={p.page}
                    onClick={() => { setDropdownOpen(false); onNav(p.page) }}
                    className="w-full text-left px-4 py-2 text-xs"
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'block' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = '#1c1c1c' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'none' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs font-semibold mono" style={{ color: '#9daab6' }}>
            Pricing
          </span>

          <button
            onClick={onLogin}
            className="text-xs font-medium"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            Sign in
          </button>

          <button
            onClick={onGetStarted}
            className="rounded px-4 py-2 text-xs font-semibold transition-all"
            style={{ background: '#fff', color: '#0d0d0d', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center pt-24 pb-16 px-6">
        <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: '#9daab6' }}>
          Pricing
        </p>
        <h1 className="font-extrabold mb-4" style={{ color: '#fff', fontSize: 'clamp(36px, 6vw, 64px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
          Simple, transparent pricing.
        </h1>
        <p className="text-sm mx-auto" style={{ color: 'var(--muted)', maxWidth: 480, lineHeight: 1.7 }}>
          No per-query fees. No surprise bills. Cancel any time. All plans include access to the Effant dashboard.
        </p>
      </section>

      {/* Plans grid */}
      <section className="px-6 pb-24 mx-auto" style={{ maxWidth: 1100 }}>
        {/* Row 1: Starter, Analyst (highlighted), Analyst Pro */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
          <PlanCard
            tier="starter"
            name="Starter"
            price="$20"
            period="/month"
            features={STARTER_FEATURES}
            highlight={false}
            onStart={onGetStarted}
          />
          <PlanCard
            tier="analyst"
            name="Analyst"
            price="$100"
            period="/month"
            features={ANALYST_FEATURES}
            highlight
            onStart={onGetStarted}
          />
          <PlanCard
            tier="analyst_pro"
            name="Analyst Pro"
            price="$500"
            period="/month"
            features={ANALYST_PRO_FEATURES}
            highlight={false}
            onStart={onGetStarted}
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
            onStart={onGetStarted}
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
        <p className="mono text-xs mb-3" style={{ color: 'var(--dim)' }}>
          EFFANT · Solana Intelligence Platform · billing@effant.tech
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => onNav('privacy')}
            className="mono text-xs"
            style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
          >
            Privacy Policy
          </button>
          <span style={{ color: 'var(--dim)' }}>·</span>
          <button
            onClick={() => onNav('terms')}
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
