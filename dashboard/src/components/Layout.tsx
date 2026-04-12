import type { ReactNode } from 'react'

type Page = 'landing' | 'overview' | 'explorer' | 'portal'

interface LayoutProps {
  page: Page
  onNav: (p: Page) => void
  children: ReactNode
}

const NAV: { id: Page; label: string; noHighlight?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'explorer', label: 'Wallet Explorer' },
  { id: 'portal',   label: 'API Portal' },
  { id: 'portal',   label: 'Pricing', noHighlight: true },
]

export function Layout({ page, onNav, children }: LayoutProps) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header className="sticky top-0 z-20" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-8 px-8 py-3">

          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="mono font-bold" style={{ color: 'var(--accent)', fontSize: 15, letterSpacing: '-0.01em' }}>
              EFFANT
            </span>
            <span style={{ color: 'var(--border)', userSelect: 'none' }}>|</span>
            <span className="text-xs" style={{ color: 'var(--dim)' }}>Solana Intelligence</span>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-8 flex-1">
            {NAV.map(n => {
              const isActive = !n.noHighlight && page === n.id
              return (
                <button
                  key={n.label}
                  onClick={() => onNav(n.id)}
                  className="px-4 py-2 rounded text-xs font-medium transition-all"
                  style={{
                    background: isActive ? 'rgba(91,108,248,0.12)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--muted)',
                    border: isActive ? '1px solid rgba(91,108,248,0.25)' : '1px solid transparent',
                    letterSpacing: '0.03em',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--muted)' }}
                >
                  {n.label}
                </button>
              )
            })}
          </nav>

          {/* Live indicator */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--green)' }} />
            <span className="mono text-xs" style={{ color: 'var(--dim)' }}>LIVE · 30s</span>
          </div>
        </div>
      </header>

      <main className="mx-auto px-8 py-6" style={{ maxWidth: 1400 }}>
        {children}
      </main>
    </div>
  )
}
