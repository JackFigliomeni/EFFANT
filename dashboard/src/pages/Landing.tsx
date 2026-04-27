import { useState, useEffect, useRef } from 'react'
import { createCheckoutSession } from '../api/billing'
import type { BillingTier } from '../api/billing'
import { isLoggedIn } from '../api/portal'
import type { Page } from '../components/Layout'

interface LandingProps {
  onGetStarted: (tier: string) => void
  onLogin:      () => void
  onPrivacy:    () => void
  onTerms:      () => void
  onNav:        (page: Page) => void
  onPricing:    () => void
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG_DARK   = '#111827'
const BG_LIGHT  = '#F8F5F2'
const SURF_DARK = '#1a2234'
const BD_DARK   = '#1f2937'
const BD_LIGHT  = '#E7D3C1'
const ACCENT    = '#C08457'
const ACCENT2   = '#A06840'
const TEXT_D    = '#F8F5F2'
const TEXT_L    = '#111827'
const MUTED_D   = '#9CA3AF'
const MUTED_L   = '#6B7280'

const WRAP: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', padding: '0 48px', width: '100%' }
const DOT_GRID: React.CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(248,245,242,0.06) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
}

const STARTER_FEATURES = [
  'Live overview dashboard',
  'Metrics + candlestick charts',
  'Anomaly & cluster explorer',
  'Wallet Explorer',
  'No REST API',
]
const ANALYST_FEATURES = [
  'Everything in Starter',
  'API Terminal access',
  'REST API — 500 req/month',
  'Real-time webhook alerts',
  'Email support',
]
const ANALYST_PRO_FEATURES = [
  'Everything in Analyst',
  'REST API — 10,000 req/month',
  'Priority support',
  'Sub-second cache TTL',
]

// ─── Glow Bars (hero visual) ──────────────────────────────────────────────────
function GlowBars() {
  const heights = [0.3, 0.55, 0.78, 0.6, 0.92, 0.72, 0.48, 0.84, 0.58, 0.38, 0.68, 0.94, 0.52, 0.66, 0.82, 0.44, 0.74, 0.36]
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: '62%', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center', gap: 7, pointerEvents: 'none', overflow: 'hidden',
    }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          width: 48,
          height: `${h * 100}%`,
          background: `linear-gradient(to top, ${ACCENT}CC 0%, ${ACCENT}55 55%, ${ACCENT}11 85%, transparent 100%)`,
          borderRadius: '5px 5px 0 0',
        }} />
      ))}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%',
        background: `linear-gradient(to top, ${BG_DARK}, transparent)`,
        pointerEvents: 'none',
      }} />
    </div>
  )
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────
function PlanCard({ tier, name, price, period, features, highlight, onStart }: {
  tier: string; name: string; price: string; period: string
  features: string[]; highlight: boolean; onStart: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleClick() {
    if (isLoggedIn()) {
      setLoading(true); setErr('')
      try {
        const { url } = await createCheckoutSession(tier as BillingTier)
        window.location.href = url
      } catch (e) { setErr((e as Error).message); setLoading(false) }
    } else { onStart() }
  }

  return (
    <div style={{
      background: '#FFFFFF',
      border: `1.5px solid ${highlight ? ACCENT : BD_LIGHT}`,
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      boxShadow: highlight ? `0 0 32px ${ACCENT}18` : 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {highlight && (
        <div style={{
          background: ACCENT, color: '#fff', textAlign: 'center', padding: '5px 0',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
        }}>
          Most Popular
        </div>
      )}
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: MUTED_L, letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>{name}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: TEXT_L, letterSpacing: '-0.02em' }}>{price}</span>
            {period && <span style={{ fontSize: 14, color: MUTED_L }}>{period}</span>}
          </div>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
          {features.map(f => (
            <li key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0',
              fontSize: 13, color: TEXT_L, borderBottom: `1px solid ${BD_LIGHT}` }}>
              <span style={{ color: ACCENT, flexShrink: 0, marginTop: 1 }}>✓</span>
              {f}
            </li>
          ))}
        </ul>
        <button onClick={handleClick} disabled={loading} style={{
          width: '100%', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          background: highlight ? ACCENT : 'transparent',
          border: `1.5px solid ${highlight ? ACCENT : BD_LIGHT}`,
          color: highlight ? '#fff' : TEXT_L, opacity: loading ? 0.6 : 1,
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { if (!highlight) { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT } }}
        onMouseLeave={e => { if (!highlight) { e.currentTarget.style.borderColor = BD_LIGHT; e.currentTarget.style.color = TEXT_L } }}>
          {loading ? 'Redirecting…' : 'Get started'}
        </button>
        {err && <p style={{ marginTop: 8, fontSize: 11, color: '#f43f5e', textAlign: 'center' }}>{err}</p>}
      </div>
    </div>
  )
}

// ─── Landing ──────────────────────────────────────────────────────────────────
export function Landing({ onGetStarted, onLogin, onPrivacy, onTerms, onNav, onPricing }: LandingProps) {
  const [productsOpen, setProductsOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setProductsOpen(false); setResourcesOpen(false); setCompanyOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function closeAll() { setProductsOpen(false); setResourcesOpen(false); setCompanyOpen(false) }

  const DROP_STYLE: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0,
    background: '#1a2234', border: `1px solid ${BD_DARK}`,
    borderRadius: 10, padding: '6px 0', minWidth: 200, zIndex: 100,
    boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
  }

  const NAV_BTN: React.CSSProperties = {
    background: 'none', border: 'none', color: MUTED_D, cursor: 'pointer',
    fontSize: 14, fontWeight: 500, fontFamily: 'inherit', padding: '8px 12px',
    borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5,
  }

  const PRODUCTS: { label: string; page: Page; desc: string }[] = [
    { label: 'Overview',        page: 'overview', desc: 'Real-time market dashboard'   },
    { label: 'Metrics',         page: 'metrics',  desc: 'Deep-dive on-chain analytics' },
    { label: 'Wallet Explorer', page: 'explorer', desc: 'Profile any Solana address'   },
    { label: 'Terminal',        page: 'terminal', desc: 'Live transaction feed'         },
    { label: 'API',             page: 'portal',   desc: 'REST API access & docs'       },
  ]

  return (
    <div style={{ background: BG_DARK, color: TEXT_D, minHeight: '100vh', width: '100%' }}>

      {/* ══ NAV ══════════════════════════════════════════════════════════════ */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50, width: '100%',
        background: `${BG_DARK}F0`, borderBottom: `1px solid ${BD_DARK}`,
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ ...WRAP, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>

          {/* Brand */}
          <button onClick={() => {}} style={{ background: 'none', border: 'none', cursor: 'default', padding: 0,
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontWeight: 800, color: TEXT_D, fontSize: 16, letterSpacing: '0.04em' }}>EFFANT</span>
          </button>

          {/* Nav links */}
          <div ref={navRef} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div style={{ position: 'relative' }}>
              <button style={NAV_BTN} onClick={() => { closeAll(); setProductsOpen(v => !v) }}
                onMouseEnter={e => (e.currentTarget.style.color = TEXT_D)}
                onMouseLeave={e => (e.currentTarget.style.color = MUTED_D)}>
                Products <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
              </button>
              {productsOpen && (
                <div style={DROP_STYLE}>
                  {PRODUCTS.map(p => (
                    <button key={p.page} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      onClick={() => { closeAll(); onNav(p.page) }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#232e44')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: TEXT_D, marginBottom: 2 }}>{p.label}</div>
                      <div style={{ fontSize: 11, color: MUTED_D }}>{p.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button style={NAV_BTN} onClick={onPricing}
              onMouseEnter={e => (e.currentTarget.style.color = TEXT_D)}
              onMouseLeave={e => (e.currentTarget.style.color = MUTED_D)}>
              Pricing
            </button>

            <div style={{ position: 'relative' }}>
              <button style={NAV_BTN} onClick={() => { closeAll(); setResourcesOpen(v => !v) }}
                onMouseEnter={e => (e.currentTarget.style.color = TEXT_D)}
                onMouseLeave={e => (e.currentTarget.style.color = MUTED_D)}>
                Resources <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
              </button>
              {resourcesOpen && (
                <div style={DROP_STYLE}>
                  {[
                    { label: 'API Docs',      fn: () => onNav('portal') },
                    { label: 'API Reference', fn: () => onNav('portal') },
                  ].map(r => (
                    <button key={r.label} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: TEXT_D }}
                      onClick={() => { closeAll(); r.fn() }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#232e44')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <button style={NAV_BTN} onClick={() => { closeAll(); setCompanyOpen(v => !v) }}
                onMouseEnter={e => (e.currentTarget.style.color = TEXT_D)}
                onMouseLeave={e => (e.currentTarget.style.color = MUTED_D)}>
                Company <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
              </button>
              {companyOpen && (
                <div style={DROP_STYLE}>
                  {['About', 'Contact'].map(c => (
                    <button key={c} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: TEXT_D }}
                      onClick={() => closeAll()}
                      onMouseEnter={e => (e.currentTarget.style.background = '#232e44')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={onLogin} style={{ ...NAV_BTN, padding: '8px 16px' }}
              onMouseEnter={e => (e.currentTarget.style.color = TEXT_D)}
              onMouseLeave={e => (e.currentTarget.style.color = MUTED_D)}>
              Log in
            </button>
            <button onClick={() => onGetStarted('analyst')} style={{
              padding: '9px 18px', background: ACCENT, color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = ACCENT2)}
            onMouseLeave={e => (e.currentTarget.style.background = ACCENT)}>
              Get Started →
            </button>
          </div>
        </div>
      </nav>

      {/* ══ HERO ═════════════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', position: 'relative', overflow: 'hidden', ...DOT_GRID,
        minHeight: 580, display: 'flex', alignItems: 'center' }}>
        <div style={{ ...WRAP, textAlign: 'center', position: 'relative', zIndex: 2, paddingTop: 80, paddingBottom: 120 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: `${ACCENT}15`, border: `1px solid ${ACCENT}40`,
            borderRadius: 999, padding: '6px 16px', marginBottom: 32,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'block', boxShadow: '0 0 6px #22c55e' }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e', fontWeight: 500 }}>
              LIVE · Real-time data from Solana Mainnet
            </span>
          </div>

          <h1 style={{
            fontSize: 'clamp(40px, 5.5vw, 72px)', fontWeight: 800, lineHeight: 1.08,
            letterSpacing: '-0.03em', color: TEXT_D, marginBottom: 24, maxWidth: 820, margin: '0 auto 24px',
          }}>
            See Everything Moving<br />on Solana.
          </h1>

          <p style={{ fontSize: 18, color: MUTED_D, lineHeight: 1.7, marginBottom: 40, maxWidth: 520, margin: '0 auto 40px' }}>
            Institutional-grade on-chain intelligence. Track wallets, decode transactions, and uncover market-moving signals — in real time.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onGetStarted('analyst')} style={{
              padding: '14px 28px', background: ACCENT, color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = ACCENT2)}
            onMouseLeave={e => (e.currentTarget.style.background = ACCENT)}>
              Launch Terminal →
            </button>
            <button onClick={onLogin} style={{
              padding: '14px 28px', background: 'transparent', color: TEXT_D,
              border: `1px solid ${BD_DARK}`, borderRadius: 8, fontSize: 15, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = BD_DARK; e.currentTarget.style.color = TEXT_D }}>
              View Live Demo
            </button>
          </div>

          <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 40, flexWrap: 'wrap' }}>
            {['⚡ Real-time feeds', '◈ Institutional API', '✓ 99.9% Uptime'].map(b => (
              <span key={b} style={{ fontSize: 13, color: MUTED_D }}>{b}</span>
            ))}
          </div>
        </div>
        <GlowBars />
      </section>

      {/* ══ TRUST STRIP ══════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', borderTop: `1px solid ${BD_DARK}`, borderBottom: `1px solid ${BD_DARK}`, ...DOT_GRID }}>
        <div style={{ ...WRAP, padding: '36px 48px' }}>
          <p style={{ textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
            color: '#374151', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 24 }}>
            Trusted by leading teams
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 52, flexWrap: 'wrap' }}>
            {['CMS', 'Wintermute', 'Jump Trading', 'Delphi Digital', 'Brevan Howard'].map(name => (
              <span key={name} style={{ fontSize: 14, fontWeight: 700, color: '#2d3748', letterSpacing: '-0.01em' }}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FEATURES ═════════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', background: BG_LIGHT, padding: '96px 0' }}>
        <div style={{ ...WRAP }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: ACCENT,
              textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 16 }}>Products</p>
            <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 800, color: TEXT_L,
              letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              Everything you need to stay ahead
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              {
                icon: '◈',
                title: 'Wallet Intelligence',
                desc: 'Track smart money and whale activity across Solana in real time. Profile any address instantly.',
                cta: 'Open Explorer →', page: 'explorer' as Page,
              },
              {
                icon: '⚡',
                title: 'Live Transaction Feed',
                desc: 'Get granular insight into every swap, transfer, and on-chain event as it happens.',
                cta: 'Open Terminal →', page: 'terminal' as Page,
              },
              {
                icon: '▦',
                title: 'Market Analytics',
                desc: 'Real-time charts, volume breakdowns, and anomaly detection built for serious decision-makers.',
                cta: 'View Metrics →', page: 'metrics' as Page,
              },
            ].map(card => (
              <div key={card.title} style={{
                background: '#FFFFFF', border: `1.5px solid ${BD_LIGHT}`, borderRadius: 12, padding: 32,
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = ACCENT
                e.currentTarget.style.boxShadow = `0 0 0 3px ${ACCENT}15`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = BD_LIGHT
                e.currentTarget.style.boxShadow = 'none'
              }}>
                <div style={{ width: 44, height: 44, background: `${ACCENT}15`,
                  border: `1px solid ${ACCENT}30`, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                  fontSize: 18, color: ACCENT }}>
                  {card.icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: TEXT_L, marginBottom: 10 }}>{card.title}</h3>
                <p style={{ fontSize: 14, color: MUTED_L, lineHeight: 1.75, marginBottom: 20 }}>{card.desc}</p>
                <button onClick={() => onNav(card.page)} style={{
                  background: 'none', border: 'none', color: ACCENT, cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, padding: 0, fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = ACCENT2)}
                onMouseLeave={e => (e.currentTarget.style.color = ACCENT)}>
                  {card.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ STATS / SCALE ════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', background: BG_DARK, padding: '96px 0', ...DOT_GRID }}>
        <div style={{ ...WRAP, textAlign: 'center' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: ACCENT,
            textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 16 }}>Scale</p>
          <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 58px)', fontWeight: 800, color: TEXT_D,
            letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16, maxWidth: 800, margin: '0 auto 16px' }}>
            Effant processes 2.4M+ transactions daily — with zero latency compromise.
          </h2>
          <p style={{ fontSize: 16, color: MUTED_D, marginBottom: 64, maxWidth: 480, margin: '16px auto 64px' }}>
            The only Solana intelligence platform built from the ground up for institutional speed.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: BD_DARK, border: `1px solid ${BD_DARK}`, borderRadius: 12, overflow: 'hidden' }}>
            {[
              { value: '2.4M+',   label: 'Transactions / day'    },
              { value: '<100ms',  label: 'Data latency'           },
              { value: '99.9%',   label: 'Uptime SLA'             },
              { value: '50K+',    label: 'Wallets tracked live'   },
            ].map(s => (
              <div key={s.label} style={{ background: SURF_DARK, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: TEXT_D,
                  letterSpacing: '-0.03em', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>{s.value}</div>
                <div style={{ fontSize: 13, color: MUTED_D }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ API PROMO ════════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', background: BG_LIGHT, padding: '96px 0' }}>
        <div style={{ ...WRAP }}>
          <div style={{
            background: BG_DARK, border: `1px solid ${BD_DARK}`, borderRadius: 16,
            padding: '56px 60px', display: 'flex', alignItems: 'center', gap: 64,
            ...DOT_GRID,
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: ACCENT,
                textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>Built for Builders</p>
              <h2 style={{ fontSize: 'clamp(22px, 3vw, 36px)', fontWeight: 800, color: TEXT_D,
                letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 16 }}>
                Power your product with the <span style={{ color: ACCENT }}>Effant API</span>
              </h2>
              <p style={{ fontSize: 15, color: MUTED_D, lineHeight: 1.75, marginBottom: 28 }}>
                Institutional-grade data infrastructure for trading bots, dashboards, and analytics platforms. One API key. Full Solana access.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={() => onNav('portal')} style={{
                  padding: '11px 20px', background: 'transparent', color: TEXT_D,
                  border: `1px solid ${BD_DARK}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BD_DARK; e.currentTarget.style.color = TEXT_D }}>
                  Explore API Docs
                </button>
                <button onClick={() => onGetStarted('analyst')} style={{
                  padding: '11px 20px', background: ACCENT, color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = ACCENT2)}
                onMouseLeave={e => (e.currentTarget.style.background = ACCENT)}>
                  Get API Key
                </button>
              </div>
            </div>

            {/* Code block */}
            <div style={{ flexShrink: 0, width: 340 }}>
              <div style={{ background: '#0d1117', border: `1px solid ${BD_DARK}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#161d2b', borderBottom: `1px solid ${BD_DARK}`, padding: '10px 14px', display: 'flex', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f43f5e', display: 'block' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#eab308', display: 'block' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'block' }} />
                </div>
                <pre style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9CA3AF',
                  margin: 0, padding: '18px 16px', lineHeight: 1.8, overflowX: 'auto' }}>
                  <span style={{ color: '#C08457' }}>GET</span>{' '}<span style={{ color: '#F8F5F2' }}>/v1/transactions/live</span>{'\n\n'}
                  <span style={{ color: '#374151' }}>{`{`}</span>{'\n'}
                  <span style={{ color: '#4B5563' }}>{'  '}</span><span style={{ color: '#7dd3fc' }}>"network"</span><span style={{ color: '#374151' }}>: </span><span style={{ color: '#86efac' }}>"solana"</span>,{'\n'}
                  <span style={{ color: '#4B5563' }}>{'  '}</span><span style={{ color: '#7dd3fc' }}>"limit"</span><span style={{ color: '#374151' }}>: </span><span style={{ color: '#fdba74' }}>100</span>{'\n'}
                  <span style={{ color: '#374151' }}>{`}`}</span>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ PRICING ══════════════════════════════════════════════════════════ */}
      <section style={{ width: '100%', background: BG_DARK, padding: '96px 0', ...DOT_GRID }}>
        <div style={{ ...WRAP }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: ACCENT,
              textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 16 }}>Pricing</p>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: TEXT_D,
              letterSpacing: '-0.03em', marginBottom: 14 }}>
              Start for $20. Scale to enterprise.
            </h2>
            <p style={{ fontSize: 15, color: MUTED_D }}>No per-query fees. No surprise bills. Cancel any time.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 20 }}>
            <PlanCard tier="starter"     name="Starter"     price="$20"  period="/month" features={STARTER_FEATURES}     highlight={false} onStart={() => onGetStarted('starter')}     />
            <PlanCard tier="analyst"     name="Analyst"     price="$100" period="/month" features={ANALYST_FEATURES}     highlight         onStart={() => onGetStarted('analyst')}     />
            <PlanCard tier="analyst_pro" name="Analyst Pro" price="$500" period="/month" features={ANALYST_PRO_FEATURES} highlight={false} onStart={() => onGetStarted('analyst_pro')} />
          </div>

          {/* Fund + Enterprise row */}
          <div style={{ background: SURF_DARK, border: `1px solid ${BD_DARK}`, borderRadius: 12,
            padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
              <div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: MUTED_D, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Fund</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: TEXT_D, marginLeft: 12 }}>$1,200</span>
                <span style={{ fontSize: 13, color: MUTED_D, marginLeft: 4 }}>/month</span>
              </div>
              <span style={{ color: BD_DARK }}>·</span>
              <div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Enterprise</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: TEXT_D, marginLeft: 12 }}>Custom</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <a href="mailto:billing@effant.tech" style={{ padding: '9px 16px', border: `1px solid ${ACCENT}`,
                color: ACCENT, borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Contact for Enterprise
              </a>
              <button onClick={onPricing} style={{ padding: '9px 16px', background: 'transparent', border: `1px solid ${BD_DARK}`,
                color: TEXT_D, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = ACCENT)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = BD_DARK)}>
                View all plans →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══ FOOTER ═══════════════════════════════════════════════════════════ */}
      <footer style={{ width: '100%', borderTop: `1px solid ${BD_DARK}`, background: BG_DARK, padding: '48px 0' }}>
        <div style={{ ...WRAP, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: TEXT_D, fontSize: 14, letterSpacing: '0.04em' }}>EFFANT</span>
              <span style={{ color: BD_DARK }}>·</span>
              <span style={{ fontSize: 12, color: '#374151' }}>Solana Intelligence Platform</span>
            </div>
            <p style={{ fontSize: 12, color: '#374151' }}>billing@effant.tech</p>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {[{ l: 'Privacy Policy', fn: onPrivacy }, { l: 'Terms of Service', fn: onTerms }].map(item => (
              <button key={item.l} onClick={item.fn} style={{ background: 'none', border: 'none', color: '#374151',
                cursor: 'pointer', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = ACCENT)}
              onMouseLeave={e => (e.currentTarget.style.color = '#374151')}>
                {item.l}
              </button>
            ))}
          </div>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#374151' }}>
            © 2025 Effant. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
