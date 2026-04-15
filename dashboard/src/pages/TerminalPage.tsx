import { useQuery } from '@tanstack/react-query'
import { fetchMe, isLoggedIn } from '../api/portal'
import { ApiTerminal } from '../components/ApiTerminal'
import type { MeData } from '../api/portal'

interface TerminalPageProps {
  onGoPortal: () => void
}

export function TerminalPage({ onGoPortal }: TerminalPageProps) {
  const apiKey = localStorage.getItem('effant_api_key')

  const { data: me, isLoading } = useQuery<MeData>({
    queryKey: ['portal-me'],
    queryFn:  fetchMe,
    enabled:  isLoggedIn(),
    staleTime: 30_000,
    retry: false,
  })

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
          <p className="mono text-2xl mb-3">⌨</p>
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

  // Logged in but no key yet
  if (!isLoading && !apiKey) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="rounded-xl p-8 text-center" style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxWidth: 380,
          width: '100%',
        }}>
          <p className="mono text-2xl mb-3">🔑</p>
          <h2 className="font-semibold text-sm mb-2" style={{ color: '#fff' }}>No API Key Found</h2>
          <p className="text-xs mb-6" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
            Provision an API key in the portal first — the terminal
            will pick it up automatically.
          </p>
          <button
            onClick={onGoPortal}
            className="w-full py-2.5 rounded-lg mono text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Go to API Portal
          </button>
        </div>
      </div>
    )
  }

  const tier = me?.api_key?.tier ?? 'starter'

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="mb-5">
        <h1 className="text-sm font-semibold mb-1" style={{ color: '#fff' }}>API Terminal</h1>
        <p className="mono text-xs" style={{ color: 'var(--dim)' }}>
          Live requests · key pre-filled ·{' '}
          <span style={{ color: 'var(--accent)' }}>{tier}</span> tier
        </p>
      </div>
      <ApiTerminal apiKey={apiKey} tier={tier} />
    </div>
  )
}
