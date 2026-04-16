import { useQuery } from '@tanstack/react-query'
import { fetchMe, isLoggedIn } from '../api/portal'
import { ApiTerminal } from '../components/ApiTerminal'
import type { MeData } from '../api/portal'

interface TerminalPageProps {
  onGoPortal: () => void
}

export function TerminalPage({ onGoPortal }: TerminalPageProps) {
  const apiKey = localStorage.getItem('effant_api_key')

  const { data: me } = useQuery<MeData>({
    queryKey: ['portal-me'],
    queryFn:  fetchMe,
    enabled:  isLoggedIn(),
    staleTime: 30_000,
    retry: false,
  })

  // Determine if user has terminal access (analyst+ required)
  const hasTerminalAccess = me && ['analyst', 'analyst_pro', 'fund', 'enterprise'].includes(me.api_key?.tier ?? '')

  // Not logged in
  if (!isLoggedIn()) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="rounded-xl p-8 text-center" style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxWidth: 380,
          width: '100%',
        }}>
          <h2 className="font-semibold text-sm mb-2" style={{ color: '#fff' }}>API Terminal</h2>
          <p className="text-xs mb-6" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
            Sign in to run live requests against the EFFANT API.
            Your key is pre-filled automatically.
          </p>
          <button
            onClick={onGoPortal}
            className="w-full py-2.5 rounded-lg mono text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Sign in → API Portal
          </button>
        </div>
      </div>
    )
  }

  // Show paywall if logged in but on starter or no plan (wait for me to load first)
  if (isLoggedIn() && me !== undefined && !hasTerminalAccess) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="rounded-xl p-8 text-center" style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxWidth: 420,
          width: '100%',
        }}>
          <div className="mb-4 flex justify-center">
            <div className="rounded-full p-3" style={{ background: 'var(--surface2)', border: '1px solid var(--border2)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>
          <h2 className="font-semibold text-sm mb-2" style={{ color: '#fff' }}>Terminal requires Analyst</h2>
          <p className="text-xs mb-2" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
            The API Terminal is available on the Analyst plan ($100/mo) and above.
            Run live queries, test endpoints, and inspect responses directly.
          </p>
          <p className="mono text-xs mb-6" style={{ color: 'var(--dim)' }}>
            Current plan: <span style={{ color: 'var(--accent)' }}>{me?.api_key?.tier ?? 'none'}</span>
          </p>
          <button
            onClick={onGoPortal}
            className="w-full py-2.5 rounded-lg mono text-xs font-semibold"
            style={{ background: '#5b6cf8', color: '#fff' }}
          >
            Upgrade plan →
          </button>
        </div>
      </div>
    )
  }

  const tier = me?.api_key?.tier ?? 'starter'

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold mb-1" style={{ color: '#fff' }}>API Terminal</h1>
          {apiKey ? (
            <p className="mono text-xs" style={{ color: 'var(--dim)' }}>
              Live requests · key pre-filled ·{' '}
              <span style={{ color: 'var(--accent)' }}>{tier}</span> tier
            </p>
          ) : (
            <p className="mono text-xs" style={{ color: 'var(--dim)' }}>
              No API key yet —{' '}
              <button
                onClick={onGoPortal}
                className="mono text-xs underline"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                provision one in the portal
              </button>
              {' '}to unlock requests
            </p>
          )}
        </div>
      </div>
      <ApiTerminal apiKey={apiKey} tier={tier} />
    </div>
  )
}
