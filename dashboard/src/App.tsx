import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import type { Page } from './components/Layout'
import { Overview } from './pages/Overview'
import { WalletExplorer } from './pages/WalletExplorer'
import { CustomerPortal } from './pages/CustomerPortal'
import { TerminalPage } from './pages/TerminalPage'
import { MetricsPage } from './pages/MetricsPage'
import { Landing } from './pages/Landing'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'

function parseUrlParams() {
  const p = new URLSearchParams(window.location.search)
  return {
    resetToken:      p.get('reset') ?? undefined,
    checkoutSuccess: p.get('checkout') === 'success',
    goPortal:        p.get('portal') === '1',
  }
}

function clearUrlParams() {
  window.history.replaceState({}, '', window.location.pathname)
}

export default function App() {
  const [{ resetToken, checkoutSuccess, goPortal }] = useState(parseUrlParams)
  const [page, setPage] = useState<Page>(() => {
    if (resetToken || checkoutSuccess || goPortal) return 'portal'
    return 'landing'
  })

  useEffect(() => {
    if (resetToken || checkoutSuccess || goPortal) clearUrlParams()
  }, [])

  function handleGetStarted(_tier: 'starter' | 'pro') {
    setPage('portal')
  }

  if (page === 'privacy') {
    return <PrivacyPolicy onBack={() => setPage('landing')} />
  }

  if (page === 'terms') {
    return <TermsOfService onBack={() => setPage('landing')} />
  }

  if (page === 'landing') {
    return (
      <Landing
        onGetStarted={handleGetStarted}
        onLogin={() => setPage('portal')}
        onPrivacy={() => setPage('privacy')}
        onTerms={() => setPage('terms')}
      />
    )
  }

  return (
    <Layout page={page} onNav={p => { setPage(p); window.scrollTo({ top: 0 }) }} onSignOut={() => setPage('landing')}>
      {page === 'overview'  && <Overview  onGoMetrics={() => { setPage('metrics'); window.scrollTo({ top: 0 }) }} />}
      {page === 'metrics'   && <MetricsPage onGoOverview={() => { setPage('overview'); window.scrollTo({ top: 0 }) }} />}
      {page === 'explorer'  && <WalletExplorer />}
      {page === 'terminal'  && <TerminalPage onGoPortal={() => setPage('portal')} />}
      {page === 'portal'    && (
        <CustomerPortal
          initialMode={resetToken ? 'reset' : 'login'}
          resetToken={resetToken}
          checkoutSuccess={checkoutSuccess}
          onSignup={() => {}}
        />
      )}
    </Layout>
  )
}
