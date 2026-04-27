import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ProfileDropdown } from './ProfileDropdown'
import { fetchHealth } from '../api/client'
import type { HealthData } from '../api/client'

export type Page = 'landing' | 'overview' | 'explorer' | 'portal' | 'terminal' | 'metrics' | 'privacy' | 'terms' | 'pricing'

interface LayoutProps {
  page:      Page
  onNav:     (p: Page) => void
  onSignOut: () => void
  onHome:    () => void
  children:  ReactNode
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IcoOverview = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
const IcoMetrics  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
const IcoWallet   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
const IcoTerminal = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
const IcoApi      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
const IcoBell     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
const IcoList     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
const IcoBook     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
const IcoSettings = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview',  icon: <IcoOverview /> },
  { id: 'metrics',  label: 'Metrics',   icon: <IcoMetrics />  },
  { id: 'explorer', label: 'Wallets',   icon: <IcoWallet />   },
  { id: 'terminal', label: 'Terminal',  icon: <IcoTerminal /> },
  { id: 'portal',   label: 'API',       icon: <IcoApi />      },
]

const COMING_SOON = [
  { label: 'Alerts',     icon: <IcoBell />     },
  { label: 'Watchlists', icon: <IcoList />     },
  { label: 'Docs',       icon: <IcoBook />     },
  { label: 'Settings',   icon: <IcoSettings /> },
]

export function Layout({ page, onNav, onSignOut, onHome, children }: LayoutProps) {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false }),
  )

  useEffect(() => {
    const id = setInterval(
      () => setTime(new Date().toLocaleTimeString('en-US', { hour12: false })),
      1000,
    )
    return () => clearInterval(id)
  }, [])

  const { data: health } = useQuery<HealthData>({
    queryKey:       ['health'],
    queryFn:        fetchHealth,
    refetchInterval: 30_000,
    staleTime:       20_000,
  })

  const systemOk = health?.status === 'ok'
  const pipe     = health?.pipeline

  const S = {
    // sidebar
    sidebar: {
      width: 212, flexShrink: 0 as const,
      background: '#111827',
      borderRight: '1px solid #1f2937',
      display: 'flex' as const, flexDirection: 'column' as const,
      height: '100vh',
    } as React.CSSProperties,

    navBtn: (active: boolean): React.CSSProperties => ({
      width: '100%', textAlign: 'left',
      background:  active ? 'rgba(192,132,87,0.1)' : 'transparent',
      border:      'none',
      borderLeft:  active ? '2px solid #C08457' : '2px solid transparent',
      borderRadius: '0 6px 6px 0',
      padding: '8px 10px 8px 12px',
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 9,
      color:  active ? '#D4956A' : '#4B5563',
      fontSize: 13,
      fontFamily: 'inherit',
      marginBottom: 1,
      transition: 'color 0.1s, background 0.1s',
    }),
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0d1117', color: '#e2e8f0', overflow: 'hidden' }}>

      {/* ── Left Sidebar ── */}
      <aside style={S.sidebar}>

        {/* Logo */}
        <div style={{ padding: '18px 14px 14px', borderBottom: '1px solid #1f2937' }}>
          <button
            onClick={onHome}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', letterSpacing: '0.06em' }}>EFFANT</span>
            </div>
            <p style={{ fontSize: 9.5, color: '#374151', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.45 }}>
              Real-time intelligence<br />across Solana
            </p>
          </button>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '8px 6px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => {
            const active = page === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNav(item.id)}
                style={S.navBtn(active)}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.color      = '#94a3b8'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.color      = '#4B5563'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            )
          })}

          {/* Divider */}
          <div style={{ height: 1, background: '#1a2537', margin: '10px 4px' }} />

          {/* Coming soon */}
          {COMING_SOON.map(item => (
            <div
              key={item.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px 8px 14px', borderRadius: 6,
                color: '#1f2937', fontSize: 13, marginBottom: 1,
              }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: 7.5, letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>SOON</span>
            </div>
          ))}
        </nav>

        {/* System status + profile */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid #1f2937' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              background: systemOk ? '#22c55e' : '#f43f5e',
            }} />
            <span style={{ fontSize: 10, color: systemOk ? '#22c55e60' : '#f43f5e80', fontFamily: 'JetBrains Mono, monospace' }}>
              {systemOk ? 'All Systems Operational' : 'System Degraded'}
            </span>
          </div>
          <ProfileDropdown onSignOut={onSignOut} />
        </div>
      </aside>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100vh', overflow: 'hidden' }}>

        {/* Top status bar */}
        <header style={{
          borderBottom: '1px solid #1f2937',
          padding: '0 20px',
          height: 38,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#0d1117', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
            <span style={{ color: '#C08457', fontWeight: 700, letterSpacing: '0.1em' }}>EFFANT.INTELLIGENCE</span>
            {health && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#2a3d52' }}>
                <span style={{ color: systemOk ? '#22c55e50' : '#f43f5e70' }}>
                  ● System {health.status}
                </span>
                <span style={{ color: health.database.connected ? '#2a3d52' : '#f43f5e70' }}>
                  ● PostgreSQL {health.database.connected ? 'connected' : 'down'}
                </span>
                <span style={{ color: health.redis.connected ? '#2a3d52' : '#f43f5e70' }}>
                  ● Redis {health.redis.connected ? health.redis.used_memory : 'down'}
                </span>
                <span style={{ color: (pipe?.consecutive_failures ?? 0) === 0 ? '#2a3d52' : '#f43f5e70' }}>
                  ● Pipeline {relTime(pipe?.last_success ?? null)}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#2a3d52' }}>{time}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} className="animate-pulse" />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#22c55e', letterSpacing: '0.1em' }}>LIVE</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
