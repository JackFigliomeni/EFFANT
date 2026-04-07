import type { ReactNode } from 'react'

type Page = 'landing' | 'overview' | 'explorer' | 'portal'

interface LayoutProps {
  page: Page
  onNav: (p: Page) => void
  children: ReactNode
}

const NAV: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'explorer', label: 'Wallet Explorer' },
  { id: 'portal',   label: 'API Portal' },
  { id: 'landing',  label: 'Pricing' },
]

export function Layout({ page, onNav, children }: LayoutProps) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        className="sticky top-0 z-20">
        <div className="flex items-center justify-between px-6 py-2.5"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <span className="mono font-semibold tracking-tight" style={{ color: 'var(--accent)', fontSize: 15 }}>
              EFFANT
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Solana Intelligence Platform
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--green)' }} />
            LIVE · 30s
          </div>
        </div>
        <div className="flex items-end px-6">
          {NAV.map(n => (
            <button key={n.id} onClick={() => onNav(n.id)}
              className="px-4 py-2.5 text-xs font-medium tracking-wide transition-colors"
              style={{
                borderBottom: page === n.id ? '2px solid var(--accent)' : '2px solid transparent',
                color: page === n.id ? '#fff' : 'var(--muted)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
              {n.label}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>
        {children}
      </main>
    </div>
  )
}
