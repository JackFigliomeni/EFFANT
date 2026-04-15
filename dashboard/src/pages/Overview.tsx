import { StatsBar } from '../components/StatsBar'
import { AnomalyFeed } from '../components/AnomalyFeed'
import { ClusterPanel } from '../components/ClusterPanel'

const sidebarBtnBase: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '7px 12px',
  borderRadius: 5,
  fontSize: 12,
  fontFamily: 'inherit',
  transition: 'background 0.12s, color 0.12s',
}

interface OverviewProps {
  onGoMetrics: () => void
}

export function Overview({ onGoMetrics }: OverviewProps) {
  return (
    <div className="flex gap-6">

      {/* Sidebar */}
      <aside style={{ width: 152, flexShrink: 0 }}>
        <p
          className="mono uppercase tracking-widest px-3 mb-2"
          style={{ color: 'var(--dim)', fontSize: 9, paddingTop: 4 }}
        >
          Views
        </p>
        <nav className="flex flex-col gap-0.5">
          <div
            style={{
              ...sidebarBtnBase,
              background: 'rgba(139,150,168,0.09)',
              color: '#e2e8f0',
              cursor: 'default',
            }}
          >
            Overview
          </div>
          <button
            onClick={onGoMetrics}
            style={{ ...sidebarBtnBase, color: 'var(--muted)' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(139,150,168,0.06)'
              e.currentTarget.style.color = 'var(--text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.color = 'var(--muted)'
            }}
          >
            Metrics
          </button>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-4">
        <StatsBar />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AnomalyFeed />
          <ClusterPanel />
        </div>
      </div>

    </div>
  )
}
