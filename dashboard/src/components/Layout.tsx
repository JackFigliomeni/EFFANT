import type { ReactNode } from 'react'
import { ProfileDropdown } from './ProfileDropdown'

export type Page = 'landing' | 'overview' | 'explorer' | 'portal' | 'terminal' | 'metrics' | 'privacy' | 'terms' | 'pricing'

interface LayoutProps {
  page:      Page
  onNav:     (p: Page) => void
  onSignOut: () => void
  onHome:    () => void
  children:  ReactNode
}

const NAV: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview'       },
  { id: 'explorer', label: 'Wallet Explorer' },
  { id: 'terminal', label: 'Terminal'        },
  { id: 'portal',   label: 'API'             },
]

const tabBase: React.CSSProperties = {
  padding: '10px 18px',
  marginBottom: -1,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  letterSpacing: '0.02em',
  fontFamily: 'inherit',
  fontSize: 12,
  transition: 'color 0.15s',
}

export function Layout({ page, onNav, onSignOut, onHome, children }: LayoutProps) {
  // metrics lives under the overview tab
  const activeTab = page === 'metrics' ? 'overview' : page

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header className="sticky top-0 z-20" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>

        {/* Row 1 — brand + live indicator + profile */}
        <div className="flex items-center justify-between px-8 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onHome}
              className="mono font-bold transition-opacity"
              style={{ color: 'var(--accent)', fontSize: 14, letterSpacing: '0.05em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              title="Back to home"
            >
              EFFANT
            </button>
            <span style={{ color: 'var(--border2)', userSelect: 'none' }}>|</span>
            <span style={{ color: 'var(--dim)', fontSize: 11 }}>
              Deeper dives into Solana metrics
            </span>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--green)' }} />
              <span className="mono" style={{ color: 'var(--dim)', fontSize: 10 }}>LIVE · 30s</span>
            </div>
            <ProfileDropdown onSignOut={onSignOut} />
          </div>
        </div>

        {/* Row 2 — tab bar */}
        <div className="flex px-6" style={{ borderTop: '1px solid var(--border)' }}>
          {NAV.map(n => {
            const active = activeTab === n.id
            return (
              <button
                key={n.id}
                onClick={() => onNav(n.id)}
                className="mono"
                style={{
                  ...tabBase,
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  color: active ? '#e2e8f0' : 'var(--muted)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--muted)' }}
              >
                {n.label}
              </button>
            )
          })}
        </div>
      </header>

      <main className="mx-auto px-8 py-6" style={{ maxWidth: 1400 }}>
        {children}
      </main>
    </div>
  )
}
