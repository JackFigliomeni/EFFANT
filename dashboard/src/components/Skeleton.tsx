// Kept for compatibility — individual components now define their own skeletons inline
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className}`} style={{ background: 'var(--border2)' }} />
}
