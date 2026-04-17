import { useState, useEffect, useRef } from 'react'
import { createCheckoutSession } from '../api/billing'
import type { BillingTier } from '../api/billing'
import { isLoggedIn } from '../api/portal'
import type { Page } from '../components/Layout'

interface LandingProps {
  onGetStarted: (tier: string) => void
  onLogin: () => void
  onPrivacy: () => void
  onTerms: () => void
  onNav: (page: Page) => void
  onPricing: () => void
}

// ─── Plan data ───────────────────────────────────────────────────────────────

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

// ─── PlanCard ─────────────────────────────────────────────────────────────────

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

  const borderColor = enterprise ? '#ca8a04' : highlight ? '#9daab6' : '#242424'
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
      <div className="p-6 flex flex-col flex-1">
        <div className="mb-5">
          <p className="mono text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
            {name}
          </p>
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-3xl font-bold" style={{ color: '#fff' }}>{price}</span>
            {period && <span className="text-sm" style={{ color: 'var(--muted)' }}>{period}</span>}
          </div>
          {enterprise && (
            <p className="mono text-xs mt-1" style={{ color: '#ca8a04' }}>billing@effant.tech</p>
          )}
        </div>

        <ul className="space-y-2 mb-6 flex-1">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 text-xs" style={{ color: enterprise ? '#ca8a04' : 'var(--green)' }}>✓</span>
              <span className="text-xs" style={{ color: 'var(--text)' }}>{f}</span>
            </li>
          ))}
        </ul>

        {enterprise ? (
          <a
            href="mailto:billing@effant.tech"
            className="w-full rounded py-2.5 text-xs font-semibold text-center block transition-all"
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
              className="w-full rounded py-2.5 text-xs font-semibold transition-all"
              style={{
                background: highlight ? '#fff' : 'transparent',
                border: `1px solid ${highlight ? '#fff' : '#242424'}`,
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
                  e.currentTarget.style.borderColor = '#242424'
                  e.currentTarget.style.color = 'var(--text)'
                }
              }}
            >
              {loading ? 'Redirecting…' : `Get started`}
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

// ─── Terminal window ──────────────────────────────────────────────────────────

function TerminalWindow() {
  return (
    <div
      className="rounded-xl overflow-hidden w-full"
      style={{ border: '1px solid #242424', background: '#0a0a0a', maxWidth: 520 }}
    >
      {/* macOS title bar */}
      <div
        className="flex items-center px-4 py-3 gap-2"
        style={{ background: '#111111', borderBottom: '1px solid #1c1c1c' }}
      >
        <span className="h-3 w-3 rounded-full" style={{ background: '#f43f5e' }} />
        <span className="h-3 w-3 rounded-full" style={{ background: '#eab308' }} />
        <span className="h-3 w-3 rounded-full" style={{ background: '#22c55e' }} />
        <span className="mono text-xs ml-3" style={{ color: '#3c3c3c' }}>bash — effant api</span>
      </div>
      <pre
        className="p-6 mono text-xs leading-relaxed overflow-x-auto"
        style={{ color: '#9daab6', margin: 0 }}
      >{`$ curl -H "X-API-Key: eff_sk_live_..." \\
  "https://api.effant.tech/v1/anomalies\\
?severity=critical&limit=1"

`}<span style={{ color: '#686868' }}># Response</span>{`
{
  `}<span style={{ color: '#9daab6' }}>"data"</span>{`: [
    {
      `}<span style={{ color: '#9daab6' }}>"wallet_address"</span>{`: `}<span style={{ color: '#22c55e' }}>"6AvA8pyr..."</span>{`,
      `}<span style={{ color: '#9daab6' }}>"anomaly_type"</span>{`:   `}<span style={{ color: '#22c55e' }}>"sandwich_attack"</span>{`,
      `}<span style={{ color: '#9daab6' }}>"severity"</span>{`:       `}<span style={{ color: '#f43f5e' }}>"critical"</span>{`,
      `}<span style={{ color: '#9daab6' }}>"confidence"</span>{`:     `}<span style={{ color: '#eab308' }}>0.97</span>{`,
      `}<span style={{ color: '#9daab6' }}>"detected_at"</span>{`:    `}<span style={{ color: '#22c55e' }}>"2025-04-07T14:22:01Z"</span>{`
    }
  ],
  `}<span style={{ color: '#9daab6' }}>"meta"</span>{`: { `}<span style={{ color: '#9daab6' }}>"count"</span>{`: `}<span style={{ color: '#eab308' }}>1</span>{` }
}`}</pre>
    </div>
  )
}

// ─── Landing ──────────────────────────────────────────────────────────────────

export function Landing({ onGetStarted, onLogin, onPrivacy, onTerms, onNav, onPricing }: LandingProps) {
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
    { label: 'Overview',        page: 'overview'  },
    { label: 'Metrics',         page: 'metrics'   },
    { label: 'Wallet Explorer', page: 'explorer'  },
    { label: 'Terminal',        page: 'terminal'  },
    { label: 'API',             page: 'portal'    },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#0d0d0d', color: 'var(--text)' }}>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-20 flex items-center justify-between px-8"
        style={{
          background: '#0d0d0d',
          borderBottom: '1px solid #1c1c1c',
          height: 60,
        }}
      >
        <div className="flex items-center gap-3">
          <span className="mono font-bold" style={{ color: '#9daab6', fontSize: 15, letterSpacing: '0.05em' }}>
            EFFANT
          </span>
          <span style={{ color: '#242424', userSelect: 'none' }}>|</span>
          <span style={{ color: '#3c3c3c', fontSize: 11 }}>Solana Intelligence</span>
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

          <button
            onClick={onPricing}
            className="text-xs font-medium"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            Pricing
          </button>

          <button
            onClick={onLogin}
            className="text-xs font-medium"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            Sign in
          </button>

          <button
            onClick={() => onGetStarted('starter')}
            className="rounded px-4 py-2 text-xs font-semibold transition-all"
            style={{ background: '#fff', color: '#0d0d0d', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Get started
          </button>
        </div>
      </nav>

      {/* ── Section 1: Hero ── */}
      <section
        className="px-6 flex items-center"
        style={{ minHeight: '100vh', paddingTop: 60 }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: 1200 }}>
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-20">
            {/* Left */}
            <div className="flex-1" style={{ maxWidth: 580 }}>
              <p className="mono text-xs uppercase tracking-widest mb-5" style={{ color: '#9daab6', letterSpacing: '0.15em' }}>
                REST API · Solana Intelligence
              </p>
              <h1
                className="font-extrabold leading-none mb-6"
                style={{
                  fontSize: 'clamp(52px, 7vw, 80px)',
                  letterSpacing: '-0.03em',
                  color: '#fff',
                }}
              >
                Solana on-chain<br />intelligence,{' '}
                <span style={{ color: '#9daab6' }}>delivered as an API.</span>
              </h1>
              <p
                className="text-base mb-8"
                style={{ color: '#686868', lineHeight: 1.7, maxWidth: 480 }}
              >
                Wallet profiling, anomaly detection, entity clustering, and whale tracking — all via a single REST API. From raw transactions to actionable signal in milliseconds.
              </p>
              <div className="flex items-center gap-3 flex-wrap mb-8">
                <button
                  onClick={() => onGetStarted('starter')}
                  className="rounded px-6 py-3 font-semibold text-sm transition-all"
                  style={{ background: '#fff', color: '#0d0d0d', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Get started →
                </button>
                <button
                  onClick={onPricing}
                  className="rounded px-6 py-3 font-semibold text-sm transition-all"
                  style={{ background: 'transparent', border: '1px solid #313131', color: '#9daab6', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#9daab6')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#313131')}
                >
                  View pricing
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--green)', flexShrink: 0 }} />
                <span className="mono text-xs" style={{ color: '#3c3c3c' }}>LIVE · updating every 30s</span>
              </div>
            </div>

            {/* Right: terminal */}
            <div className="flex-1 flex justify-center lg:justify-end w-full">
              <TerminalWindow />
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Live stats strip ── */}
      <section style={{ borderTop: '1px solid #1c1c1c', borderBottom: '1px solid #1c1c1c' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Anomalies Detected',   value: '367,867+', sub: 'flagged events'         },
            { label: 'Wallets Indexed',       value: '158,578+', sub: 'profiled addresses'     },
            { label: 'Transactions',          value: '1.5M+',    sub: 'on-chain records'       },
            { label: 'Wash Trades Flagged',   value: '295,000+', sub: 'detected patterns'      },
          ].map(({ label, value, sub }, i) => (
            <div
              key={label}
              className="flex flex-col items-center text-center gap-1 px-8 py-10"
              style={{
                background: '#0d0d0d',
                borderRight: i < 3 ? '1px solid #1c1c1c' : 'none',
              }}
            >
              <p className="mono text-xs uppercase tracking-widest mb-1" style={{ color: '#9daab6' }}>{label}</p>
              <p
                className="mono font-bold tabular-nums"
                style={{ color: '#fff', fontSize: 32, letterSpacing: '-0.04em', lineHeight: 1 }}
              >
                {value}
              </p>
              <p className="text-xs mt-2" style={{ color: '#3c3c3c' }}>{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: What EFFANT detects ── */}
      <section className="px-6 mx-auto py-32" style={{ maxWidth: 1200 }}>
        <div className="text-center mb-16">
          <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: '#9daab6', letterSpacing: '0.15em' }}>
            Intelligence · What We Detect
          </p>
          <h2
            className="font-extrabold"
            style={{ color: '#fff', fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}
          >
            Every anomaly. Every whale.<br />Every coordinated move.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Anomaly Detection */}
          <div
            className="rounded-xl p-8"
            style={{ background: '#111111', border: '1px solid #242424' }}
          >
            <span
              className="inline-block mono text-xs uppercase tracking-widest px-2.5 py-1 rounded mb-5"
              style={{ background: '#9daab620', color: '#9daab6', border: '1px solid #9daab630' }}
            >
              Anomaly Detection
            </span>
            <h3 className="font-bold mb-3 text-lg" style={{ color: '#fff', lineHeight: 1.2 }}>
              Catch wash trading before it moves markets
            </h3>
            <p className="text-sm mb-6" style={{ color: '#686868', lineHeight: 1.7 }}>
              Real-time detection of sandwich attacks, wash trading, and coordinated manipulation. Every flagged event includes confidence scores and wallet attribution.
            </p>
            {/* Mini anomaly list visual */}
            <div className="rounded-lg p-4" style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}>
              {[
                { type: 'sandwich_attack', sev: 'CRITICAL', color: '#f43f5e' },
                { type: 'wash_trade',      sev: 'HIGH',     color: '#f97316' },
                { type: 'coordinated_buy', sev: 'MEDIUM',   color: '#eab308' },
              ].map(item => (
                <div key={item.type} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: '#1c1c1c' }}>
                  <span className="mono text-xs" style={{ color: '#9daab6' }}>{item.type}</span>
                  <span className="mono text-xs font-bold" style={{ color: item.color }}>{item.sev}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Wallet Profiling */}
          <div
            className="rounded-xl p-8"
            style={{ background: '#111111', border: '1px solid #242424' }}
          >
            <span
              className="inline-block mono text-xs uppercase tracking-widest px-2.5 py-1 rounded mb-5"
              style={{ background: '#9daab620', color: '#9daab6', border: '1px solid #9daab630' }}
            >
              Wallet Profiling
            </span>
            <h3 className="font-bold mb-3 text-lg" style={{ color: '#fff', lineHeight: 1.2 }}>
              Know who's moving capital before you do
            </h3>
            <p className="text-sm mb-6" style={{ color: '#686868', lineHeight: 1.7 }}>
              Every wallet gets a risk score, behavioral profile, and transaction history summary. Identify whales, bots, and smart money in real time.
            </p>
            {/* Mini wallet card visual */}
            <div className="rounded-lg p-4" style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="mono text-xs" style={{ color: '#686868' }}>6AvA8pyr...mK9</span>
                <span className="mono text-xs font-bold px-2 py-0.5 rounded" style={{ background: '#f43f5e20', color: '#f43f5e' }}>HIGH RISK</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#686868' }}>Risk score</span>
                  <span className="mono font-bold" style={{ color: '#f43f5e' }}>87 / 100</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#686868' }}>Anomalies</span>
                  <span className="mono font-bold" style={{ color: '#fff' }}>12</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#686868' }}>Label</span>
                  <span className="mono font-bold" style={{ color: '#eab308' }}>bot</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Entity Clustering */}
          <div
            className="rounded-xl p-8"
            style={{ background: '#111111', border: '1px solid #242424' }}
          >
            <span
              className="inline-block mono text-xs uppercase tracking-widest px-2.5 py-1 rounded mb-5"
              style={{ background: '#9daab620', color: '#9daab6', border: '1px solid #9daab630' }}
            >
              Entity Clustering
            </span>
            <h3 className="font-bold mb-3 text-lg" style={{ color: '#fff', lineHeight: 1.2 }}>
              See the hidden networks behind wallets
            </h3>
            <p className="text-sm mb-6" style={{ color: '#686868', lineHeight: 1.7 }}>
              Group wallets by behavioral patterns to surface coordinated actors. Cluster analysis reveals connections invisible in raw transaction data.
            </p>
            {/* Mini cluster diagram using CSS boxes */}
            <div className="rounded-lg p-4 relative" style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', height: 100 }}>
              {/* Center node */}
              <div
                className="absolute rounded-full flex items-center justify-center mono text-xs font-bold"
                style={{ width: 36, height: 36, background: '#9daab620', border: '1px solid #9daab6', color: '#9daab6', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
              >
                C1
              </div>
              {/* Satellite nodes */}
              {[
                { top: '10%',  left: '15%' },
                { top: '10%',  left: '75%' },
                { top: '65%',  left: '10%' },
                { top: '65%',  left: '78%' },
              ].map((pos, i) => (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{ width: 16, height: 16, background: '#1c1c1c', border: '1px solid #313131', ...pos }}
                />
              ))}
              {/* Lines (pure CSS, simplified) */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: '65%', height: 1, background: 'linear-gradient(90deg, #9daab630, #9daab610)', position: 'absolute' }} />
                <div style={{ width: 1, height: '65%', background: 'linear-gradient(180deg, #9daab630, #9daab610)', position: 'absolute' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 4: API showcase ── */}
      <section className="px-6 py-32 mx-auto" style={{ maxWidth: 1200, borderTop: '1px solid #1c1c1c' }}>
        <div className="flex flex-col lg:flex-row items-start gap-16">
          {/* Left */}
          <div className="flex-1" style={{ maxWidth: 440 }}>
            <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: '#9daab6', letterSpacing: '0.15em' }}>
              API · Integration
            </p>
            <h2
              className="font-extrabold mb-5"
              style={{ color: '#fff', fontSize: 'clamp(26px, 3.5vw, 40px)', letterSpacing: '-0.03em', lineHeight: 1.15 }}
            >
              One header.<br />Everything you need.
            </h2>
            <p className="text-sm mb-8" style={{ color: '#686868', lineHeight: 1.7 }}>
              No SDKs. No complex setup. A single API key unlocks wallet profiling, anomaly detection, entity clustering, and real-time alerts. Integrate in under 5 minutes.
            </p>
            <ul className="space-y-3">
              {[
                'Single REST endpoint, JSON responses',
                'Anomaly detection with severity scores',
                'Wallet risk profiles on demand',
                'Entity cluster lookups',
                'Webhook delivery for live events',
                '99.9% uptime SLA on Fund+ plans',
              ].map(item => (
                <li key={item} className="flex items-center gap-3 text-sm">
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
                  <span style={{ color: '#e0e0e0' }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #242424', background: '#0a0a0a' }}>
              <div
                className="flex items-center px-4 py-3 gap-2"
                style={{ background: '#111111', borderBottom: '1px solid #1c1c1c' }}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: '#f43f5e' }} />
                <span className="h-3 w-3 rounded-full" style={{ background: '#eab308' }} />
                <span className="h-3 w-3 rounded-full" style={{ background: '#22c55e' }} />
                <span className="mono text-xs ml-3" style={{ color: '#3c3c3c' }}>REST API · curl</span>
              </div>
              <pre
                className="p-6 mono text-xs leading-relaxed overflow-x-auto"
                style={{ color: '#9daab6', margin: 0 }}
              >{`curl https://api.effant.tech/v1/wallets/6AvA8pyr \\
  -H "X-API-Key: eff_sk_live_..."

{
  "wallet_address": "6AvA8pyr...mK9",
  "risk_score":     87,
  "label":          "bot",
  "anomalies": [
    {
      "type":       "sandwich_attack",
      "severity":   "critical",
      "count":      4,
      "last_seen":  "2025-04-07T14:22:01Z"
    }
  ],
  "clusters": ["cluster_id_0042"],
  "meta": {
    "tx_count":    1247,
    "first_seen":  "2024-11-01T00:00:00Z"
  }
}`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 5: How it works ── */}
      <section className="px-6 py-32 mx-auto" style={{ maxWidth: 1200, borderTop: '1px solid #1c1c1c' }}>
        <div className="text-center mb-16">
          <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: '#9daab6', letterSpacing: '0.15em' }}>
            Pipeline · How It Works
          </p>
          <h2
            className="font-extrabold"
            style={{ color: '#fff', fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}
          >
            From block to signal in seconds.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-0 relative">
          {/* Connecting line (desktop) */}
          <div
            className="hidden md:block absolute"
            style={{
              top: 28,
              left: '12.5%',
              right: '12.5%',
              height: 1,
              background: 'linear-gradient(90deg, #9daab640, #9daab620)',
            }}
          />

          {[
            {
              n: '01',
              title: 'Solana RPC',
              desc: 'Raw block data ingested directly from Solana validator nodes in real time.',
            },
            {
              n: '02',
              title: 'Ingest',
              desc: 'Parse and store 1.5M+ transactions. Normalize instruction data for analysis.',
            },
            {
              n: '03',
              title: 'Analyze',
              desc: 'Detect anomalies, label wallets, cluster entities. ML models run on every block.',
            },
            {
              n: '04',
              title: 'API',
              desc: 'Clean JSON delivered to your application. Webhooks available for live events.',
            },
          ].map(step => (
            <div key={step.n} className="flex flex-col items-center text-center px-6 relative">
              <div
                className="mono font-bold text-sm mb-4 h-14 w-14 rounded-full flex items-center justify-center z-10"
                style={{ background: '#141414', border: '1px solid #9daab6', color: '#9daab6' }}
              >
                {step.n}
              </div>
              <h3 className="font-semibold mb-2" style={{ color: '#fff', fontSize: 15 }}>{step.title}</h3>
              <p className="text-xs" style={{ color: '#686868', lineHeight: 1.7 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 6: Pricing preview ── */}
      <section className="px-6 py-32 mx-auto" style={{ maxWidth: 1200, borderTop: '1px solid #1c1c1c' }}>
        <div className="text-center mb-12">
          <p className="mono text-xs uppercase tracking-widest mb-4" style={{ color: '#9daab6', letterSpacing: '0.15em' }}>
            Pricing
          </p>
          <h2
            className="font-extrabold mb-4"
            style={{ color: '#fff', fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}
          >
            Start for $20. Scale to enterprise.
          </h2>
          <p className="text-sm" style={{ color: '#686868' }}>
            No per-query fees. No surprise bills. Cancel any time.
          </p>
        </div>

        {/* 3 cards */}
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

        {/* Fund + Enterprise compact row */}
        <div
          className="rounded-xl px-8 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
          style={{ background: '#111111', border: '1px solid #242424' }}
        >
          <div className="flex items-center gap-8">
            <div>
              <span className="mono text-xs uppercase tracking-widest" style={{ color: '#9daab6' }}>Fund</span>
              <span className="ml-3 font-bold text-lg" style={{ color: '#fff' }}>$1,200</span>
              <span className="text-sm ml-1" style={{ color: '#686868' }}>/month</span>
            </div>
            <span style={{ color: '#242424' }}>·</span>
            <div>
              <span className="mono text-xs uppercase tracking-widest" style={{ color: '#ca8a04' }}>Enterprise</span>
              <span className="ml-3 font-bold text-lg" style={{ color: '#fff' }}>Custom</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="mailto:billing@effant.tech"
              className="rounded px-4 py-2 text-xs font-semibold transition-all"
              style={{ background: 'transparent', border: '1px solid #ca8a04', color: '#ca8a04', textDecoration: 'none' }}
            >
              Contact for Enterprise
            </a>
            <button
              onClick={onPricing}
              className="rounded px-4 py-2 text-xs font-semibold transition-all"
              style={{ background: 'transparent', border: '1px solid #313131', color: '#9daab6', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#9daab6')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#313131')}
            >
              View all plans →
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="px-8 py-12"
        style={{ borderTop: '1px solid #1c1c1c' }}
      >
        <div className="mx-auto flex flex-col md:flex-row items-center md:items-start justify-between gap-6" style={{ maxWidth: 1200 }}>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="mono font-bold" style={{ color: '#9daab6', fontSize: 14, letterSpacing: '0.05em' }}>EFFANT</span>
              <span style={{ color: '#242424' }}>|</span>
              <span className="text-xs" style={{ color: '#3c3c3c' }}>Solana Intelligence Platform</span>
            </div>
            <p className="text-xs" style={{ color: '#3c3c3c' }}>billing@effant.tech</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onPrivacy}
              className="mono text-xs"
              style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#9daab6')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
            >
              Privacy Policy
            </button>
            <span style={{ color: 'var(--dim)' }}>·</span>
            <button
              onClick={onTerms}
              className="mono text-xs"
              style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#9daab6')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
            >
              Terms of Service
            </button>
          </div>
          <p className="mono text-xs" style={{ color: '#3c3c3c' }}>
            © 2025 Effant. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
