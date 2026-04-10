import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { Overview } from './pages/Overview'
import { WalletExplorer } from './pages/WalletExplorer'
import { CustomerPortal } from './pages/CustomerPortal'
import { Landing } from './pages/Landing'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'

type Page = 'landing' | 'overview' | 'explorer' | 'portal' | 'privacy' | 'terms'

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

  // Strip query params from URL after reading them
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

  if (page === 'portal') {
    return (
      <Layout page={page} onNav={p => setPage(p as Page)}>
        <CustomerPortal
          initialMode={resetToken ? 'reset' : 'login'}
          resetToken={resetToken}
          checkoutSuccess={checkoutSuccess}
          onSignup={() => {/* already handled inside portal */}}
        />
      </Layout>
    )
  }

  return (
    <Layout page={page} onNav={p => setPage(p as Page)}>
      {page === 'overview' && <Overview />}
      {page === 'explorer' && <WalletExplorer />}
    </Layout>
  )
}
