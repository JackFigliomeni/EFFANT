import { StatsBar } from '../components/StatsBar'
import { AnomalyFeed } from '../components/AnomalyFeed'
import { ClusterPanel } from '../components/ClusterPanel'

export function Overview() {
  return (
    <div className="space-y-4">
      <StatsBar />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AnomalyFeed />
        <ClusterPanel />
      </div>
    </div>
  )
}
