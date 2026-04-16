"""
EFFANT — Entity clustering module.
Uses two heuristics to link wallets into entity clusters:

  1. Common-input heuristic: wallets that send to the same destination
     in the same block are likely coordinated (same entity or bot swarm).
     Hub destinations (>HUB_MAX_SENDERS unique senders) are excluded to
     prevent popular program accounts from merging unrelated wallets.

  2. Deposit pattern: wallets that repeatedly send to the same destination
     (>= DEPOSIT_MIN_REPEAT times) share a structural relationship.

Graph: weighted undirected — edge weight = number of shared co-input
groups + repeat-send count.
Community detection: Louvain (NetworkX 3.x built-in).
Singletons (clusters of 1) are discarded — not stored in the clusters table.

Usage:
    python pipeline/clusterer.py [--dry-run] [--resolution 1.0] [--min-cluster 2]
"""

import os
import sys
import logging
import argparse
import psycopg2
import psycopg2.extras
import networkx as nx
from collections import defaultdict, Counter
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("ERROR: Set DATABASE_URL in .env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("effant.clusterer")

# ── Tunable parameters ────────────────────────────────────────────────────────

# Destinations with more unique senders than this are "hubs" (tip pools,
# system programs, popular AMMs) and must not drive co-input clustering.
HUB_MAX_SENDERS = 20

# Minimum times from_wallet→to_wallet must repeat to count as a deposit edge.
DEPOSIT_MIN_REPEAT = 3

# Minimum cluster size to store in the clusters table.
DEFAULT_MIN_CLUSTER = 2

# Louvain resolution — higher → more, smaller clusters.
DEFAULT_RESOLUTION = 1.0


# ── Data loading ──────────────────────────────────────────────────────────────

# Only cluster on recent transactions to bound memory usage.
# Full-history clustering would require too much RAM for the graph.
CLUSTER_WINDOW_HOURS = 168   # 7 days — anchored to MAX(block_time) below


def _anchor_ts(conn) -> str:
    """Return ISO timestamp of the most recent successful transaction, or NOW()."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(block_time) AS latest FROM transactions "
            "WHERE success = TRUE AND amount_sol > 0"
        )
        row = cur.fetchone()
    latest = row[0] if row and row[0] else None
    if latest:
        log.info(f"Clustering anchored to latest block_time: {latest.isoformat()}")
        return f"'{latest.isoformat()}'"
    return "NOW()"


def load_hub_addresses(conn) -> set[str]:
    """Destinations receiving from more than HUB_MAX_SENDERS unique wallets."""
    anchor = _anchor_ts(conn)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT to_wallet
            FROM transactions
            WHERE success = true
              AND block_time > {anchor}::timestamptz - INTERVAL '{CLUSTER_WINDOW_HOURS} hours'
              AND block_time <= {anchor}::timestamptz
            GROUP BY to_wallet
            HAVING COUNT(DISTINCT from_wallet) > %s
        """, (HUB_MAX_SENDERS,))
        hubs = {row[0] for row in cur.fetchall()}
    log.info(f"Identified {len(hubs)} hub addresses (excluded from co-input)")
    return hubs


def load_co_input_edges(conn, hubs: set[str]) -> dict[tuple[str, str], float]:
    """
    Co-input heuristic: wallets that send to the same non-hub destination
    in the same block share a co-input group. Each shared group adds weight 1
    to the edge between every pair in that group.
    Pairs are enumerated in Python to avoid a large SQL self-join.
    """
    anchor = _anchor_ts(conn)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT block_time, to_wallet, ARRAY_AGG(DISTINCT from_wallet) AS senders
            FROM transactions
            WHERE success = true
              AND to_wallet != from_wallet
              AND block_time > {anchor}::timestamptz - INTERVAL '{CLUSTER_WINDOW_HOURS} hours'
              AND block_time <= {anchor}::timestamptz
            GROUP BY block_time, to_wallet
            HAVING COUNT(DISTINCT from_wallet) >= 2
            ORDER BY block_time, to_wallet
        """)
        rows = cur.fetchall()

    edge_weights: dict[tuple[str, str], float] = defaultdict(float)
    groups_used = 0

    for _block_time, to_wallet, senders in rows:
        if to_wallet in hubs:
            continue
        groups_used += 1
        # Add pairwise edges for every wallet pair in this co-input group
        # Cap group size to avoid O(n²) explosion on large groups
        senders = senders[:50]
        for i in range(len(senders)):
            for j in range(i + 1, len(senders)):
                a, b = (senders[i], senders[j]) if senders[i] < senders[j] else (senders[j], senders[i])
                edge_weights[(a, b)] += 1.0

    log.info(
        f"Co-input: {groups_used} non-hub groups → "
        f"{len(edge_weights)} unique wallet pairs"
    )
    return edge_weights


def load_deposit_edges(conn) -> dict[tuple[str, str], float]:
    """
    Deposit pattern: wallets that repeatedly send to the same destination.
    Edge weight = number of repeat sends (capped at 50 to limit hub dominance).
    """
    anchor = _anchor_ts(conn)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT from_wallet, to_wallet, COUNT(*) AS repeat_count
            FROM transactions
            WHERE success = true
              AND block_time > {anchor}::timestamptz - INTERVAL '{CLUSTER_WINDOW_HOURS} hours'
              AND block_time <= {anchor}::timestamptz
              AND from_wallet != to_wallet
            GROUP BY from_wallet, to_wallet
            HAVING COUNT(*) >= %s
        """, (DEPOSIT_MIN_REPEAT,))
        rows = cur.fetchall()

    edge_weights: dict[tuple[str, str], float] = defaultdict(float)
    for from_w, to_w, count in rows:
        a, b = (from_w, to_w) if from_w < to_w else (to_w, from_w)
        edge_weights[(a, b)] += min(float(count), 50.0)

    log.info(f"Deposit pattern: {len(edge_weights)} repeated-send pairs")
    return edge_weights


def load_wallet_metadata(conn) -> dict[str, dict]:
    """Pull label, entity_type, total_volume_sol for every wallet."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT address, label, entity_type,
                   COALESCE(total_volume_sol, 0) AS volume
            FROM wallets
        """)
        return {row["address"]: dict(row) for row in cur.fetchall()}


# ── Graph construction ────────────────────────────────────────────────────────

def build_graph(
    co_input_edges: dict[tuple[str, str], float],
    deposit_edges:  dict[tuple[str, str], float],
) -> nx.Graph:
    G = nx.Graph()

    # Merge both edge sets — same pair may appear in both
    all_pairs: set[tuple[str, str]] = set(co_input_edges) | set(deposit_edges)
    for pair in all_pairs:
        w = co_input_edges.get(pair, 0.0) + deposit_edges.get(pair, 0.0)
        G.add_edge(pair[0], pair[1], weight=w)

    log.info(
        f"Graph: {G.number_of_nodes()} nodes, "
        f"{G.number_of_edges()} edges, "
        f"{nx.number_connected_components(G)} connected components"
    )
    return G


# ── Community detection ───────────────────────────────────────────────────────

def detect_communities(
    G: nx.Graph,
    resolution: float,
    min_cluster: int,
) -> list[frozenset[str]]:
    """
    Run Louvain community detection on the full graph.
    Returns only communities with >= min_cluster members.
    """
    if G.number_of_nodes() == 0:
        return []

    communities = nx.community.louvain_communities(
        G,
        weight="weight",
        resolution=resolution,
        seed=42,
    )

    # Filter singletons
    kept = [c for c in communities if len(c) >= min_cluster]

    total_nodes = sum(len(c) for c in kept)
    log.info(
        f"Louvain: {len(communities)} raw communities → "
        f"{len(kept)} with size >= {min_cluster} "
        f"({total_nodes} wallets)"
    )
    return kept


# ── Cluster summarization ─────────────────────────────────────────────────────

def summarize_cluster(
    members: frozenset[str],
    wallet_meta: dict[str, dict],
    cluster_id: int,
) -> dict:
    """Compute aggregate stats and a human-readable name for a cluster."""
    total_volume = 0.0
    type_counts: Counter = Counter()

    for addr in members:
        meta = wallet_meta.get(addr, {})
        total_volume += float(meta.get("volume", 0) or 0)
        etype = meta.get("entity_type") or "unknown"
        type_counts[etype] += 1

    dominant_type = type_counts.most_common(1)[0][0] if type_counts else "unknown"

    # Name: dominant_type + cluster id + size hint
    name = f"{dominant_type}_cluster_{cluster_id}"

    return {
        "id":            cluster_id,
        "name":          name,
        "wallet_count":  len(members),
        "total_volume":  round(total_volume, 9),
        "dominant_type": dominant_type,
        "algorithm":     "louvain",
    }


# ── Database writes ───────────────────────────────────────────────────────────

def clear_existing_clusters(conn):
    with conn.cursor() as cur:
        cur.execute("UPDATE wallets SET cluster_id = NULL")
        cur.execute("DELETE FROM clusters")
    conn.commit()
    log.info("Cleared existing cluster assignments")


def write_clusters(
    conn,
    communities: list[frozenset[str]],
    wallet_meta: dict[str, dict],
    dry_run: bool,
) -> list[dict]:
    summaries = []

    for i, members in enumerate(communities, start=1):
        summaries.append(summarize_cluster(members, wallet_meta, i))

    if dry_run:
        log.info(f"[DRY RUN] Would write {len(summaries)} clusters")
        return summaries

    # Insert cluster rows and get back their IDs
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(
            cur,
            """
            INSERT INTO clusters (id, name, wallet_count, total_volume, dominant_type, algorithm)
            VALUES (%(id)s, %(name)s, %(wallet_count)s, %(total_volume)s, %(dominant_type)s, %(algorithm)s)
            ON CONFLICT (id) DO UPDATE SET
                name          = EXCLUDED.name,
                wallet_count  = EXCLUDED.wallet_count,
                total_volume  = EXCLUDED.total_volume,
                dominant_type = EXCLUDED.dominant_type,
                algorithm     = EXCLUDED.algorithm
            """,
            summaries,
            page_size=200,
        )

    # Update wallet cluster_id assignments
    wallet_updates = []
    for i, members in enumerate(communities, start=1):
        for addr in members:
            wallet_updates.append({"cluster_id": i, "address": addr})

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(
            cur,
            "UPDATE wallets SET cluster_id = %(cluster_id)s WHERE address = %(address)s",
            wallet_updates,
            page_size=500,
        )

    conn.commit()
    log.info(
        f"Wrote {len(summaries)} clusters, "
        f"assigned {len(wallet_updates)} wallet → cluster_id mappings"
    )
    return summaries


# ── Reporting ─────────────────────────────────────────────────────────────────

def print_report(summaries: list[dict], communities: list[frozenset[str]], wallet_meta: dict):
    if not summaries:
        log.info("No clusters found.")
        return

    summaries_sorted = sorted(summaries, key=lambda x: -x["wallet_count"])

    log.info("=" * 68)
    log.info(f"{'ID':>4}  {'Name':<30}  {'Wallets':>7}  {'Volume SOL':>12}  {'Type'}")
    log.info("-" * 68)
    for s in summaries_sorted[:30]:  # show top 30
        log.info(
            f"{s['id']:>4}  {s['name']:<30}  {s['wallet_count']:>7}  "
            f"{s['total_volume']:>12.4f}  {s['dominant_type']}"
        )
    if len(summaries) > 30:
        log.info(f"  ... and {len(summaries) - 30} more clusters")

    # Top clusters with non-unknown dominant type
    notable = [s for s in summaries_sorted if s["dominant_type"] != "unknown"]
    if notable:
        log.info("")
        log.info("Notable clusters (non-unknown dominant type):")
        for s in notable[:10]:
            cid = s["id"] - 1  # 0-indexed into communities list
            members = list(communities[s["id"] - 1])[:5]
            sample = ", ".join(m[:12] + ".." for m in members)
            log.info(
                f"  Cluster {s['id']:>3}: {s['wallet_count']:>3} wallets, "
                f"{s['dominant_type']:<14}  vol={s['total_volume']:.4f} SOL  "
                f"sample=[{sample}]"
            )

    total_clustered = sum(s["wallet_count"] for s in summaries)
    total_wallets   = len(wallet_meta)
    log.info("=" * 68)
    log.info(
        f"Total: {len(summaries)} clusters | "
        f"{total_clustered} wallets clustered | "
        f"{total_wallets - total_clustered} unclustered | "
        f"{total_clustered / total_wallets * 100:.1f}% coverage"
    )


# ── Callable entry point (for import by scheduler) ────────────────────────────

def run(conn, resolution: float = DEFAULT_RESOLUTION, min_cluster: int = DEFAULT_MIN_CLUSTER) -> int:
    """Run clustering against an open DB connection. Returns cluster count."""
    hubs        = load_hub_addresses(conn)
    co_edges    = load_co_input_edges(conn, hubs)
    dep_edges   = load_deposit_edges(conn)
    wallet_meta = load_wallet_metadata(conn)
    G           = build_graph(co_edges, dep_edges)
    communities = detect_communities(G, resolution, min_cluster)
    clear_existing_clusters(conn)
    summaries   = write_clusters(conn, communities, wallet_meta, dry_run=False)
    log.info(f"Cluster run complete: {len(summaries)} clusters written")
    return len(summaries)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EFFANT entity clusterer")
    parser.add_argument("--dry-run",    action="store_true",  help="Build graph and detect clusters without writing to DB")
    parser.add_argument("--resolution", type=float, default=DEFAULT_RESOLUTION,
                        help=f"Louvain resolution (default {DEFAULT_RESOLUTION})")
    parser.add_argument("--min-cluster", type=int, default=DEFAULT_MIN_CLUSTER,
                        help=f"Minimum wallets per cluster (default {DEFAULT_MIN_CLUSTER})")
    args = parser.parse_args()

    if args.dry_run:
        log.info("DRY RUN — no DB writes")

    conn = psycopg2.connect(DATABASE_URL)
    log.info("Connected to database")

    # ── Load ──
    hubs         = load_hub_addresses(conn)
    co_edges     = load_co_input_edges(conn, hubs)
    dep_edges    = load_deposit_edges(conn)
    wallet_meta  = load_wallet_metadata(conn)

    # ── Build graph ──
    G = build_graph(co_edges, dep_edges)

    # ── Detect communities ──
    communities = detect_communities(G, args.resolution, args.min_cluster)

    # ── Write results ──
    if not args.dry_run:
        clear_existing_clusters(conn)

    summaries = write_clusters(conn, communities, wallet_meta, args.dry_run)

    # ── Report ──
    print_report(summaries, communities, wallet_meta)

    conn.close()


if __name__ == "__main__":
    main()
