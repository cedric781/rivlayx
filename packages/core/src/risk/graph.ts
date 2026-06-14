import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { riskEdges } from '@rivlayx/db';
import { RISK_DEFAULTS, type RiskConfig } from './config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}

/** Per-user, graph-derived inputs (read-only, computed from matched bets). */
export interface RiskGraphNode {
  clusterId: string | null;
  clusterSize: number;
  clusterVolumeUsdc: number;
  /** Settled/matched volume per distinct counterparty (for HHI). */
  counterpartyVolumesUsdc: number[];
  totalVolumeUsdc: number;
  inClusterVolumeUsdc: number;
  /** All members of the user's cluster incl. self (for arbiter-overlap queries). */
  clusterMembers: string[];
}

export interface RiskGraph {
  nodes: Map<string, RiskGraphNode>;
  clusters: Map<string, string[]>;
}

interface RawEdge {
  a: string;
  b: string;
  sharedBets: number;
  volume: number;
  lastBetAt: string | null;
  sharedArbiterBets: number;
}

/** Union-find for connected components over strong edges. */
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(x, root);
    return root;
  }
  union(x: string, y: string): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent.set(rx, ry);
  }
}

async function loadRawEdges(db: RiskDb): Promise<RawEdge[]> {
  const edgeRes = await db.execute(sql`
    SELECT least(creator_user_id, acceptor_user_id) AS a,
           greatest(creator_user_id, acceptor_user_id) AS b,
           count(*) AS shared_bets,
           sum(stake_per_side_usdc) AS volume,
           max(created_at) AS last_bet_at
    FROM "app"."bets"
    WHERE acceptor_user_id IS NOT NULL AND creator_user_id <> acceptor_user_id
    GROUP BY 1, 2`);

  // Arbiter-within-pair (direct self-adjudication) counted separately to avoid
  // join fan-out inflating bet counts/volume above.
  const arbRes = await db.execute(sql`
    SELECT least(b.creator_user_id, b.acceptor_user_id) AS a,
           greatest(b.creator_user_id, b.acceptor_user_id) AS b,
           count(DISTINCT b.id) AS shared_arbiter_bets
    FROM "app"."bets" b
    JOIN "app"."bet_arbiters" ba
      ON ba.bet_id = b.id AND ba.decision IS NOT NULL
     AND ba.arbiter_user_id IN (b.creator_user_id, b.acceptor_user_id)
    WHERE b.acceptor_user_id IS NOT NULL AND b.creator_user_id <> b.acceptor_user_id
    GROUP BY 1, 2`);

  const arbMap = new Map<string, number>();
  for (const r of rowsOf(arbRes)) {
    arbMap.set(`${r['a']}|${r['b']}`, Number(r['shared_arbiter_bets'] ?? 0));
  }

  return rowsOf(edgeRes).map((r) => ({
    a: String(r['a']),
    b: String(r['b']),
    sharedBets: Number(r['shared_bets'] ?? 0),
    volume: Number(r['volume'] ?? 0),
    lastBetAt: r['last_bet_at'] ? String(r['last_bet_at']) : null,
    sharedArbiterBets: arbMap.get(`${r['a']}|${r['b']}`) ?? 0,
  }));
}

function buildGraph(edges: RawEdge[], config: RiskConfig): {
  graph: RiskGraph;
  edgeClusters: Map<string, string | null>;
} {
  const uf = new UnionFind();
  // Strong edges (repeated interaction) define cluster membership.
  for (const e of edges) {
    if (e.sharedBets >= config.graph.strongEdgeMinBets) uf.union(e.a, e.b);
  }

  // Group members by root.
  const rootMembers = new Map<string, Set<string>>();
  const touch = (u: string) => {
    const root = uf.find(u);
    if (!rootMembers.has(root)) rootMembers.set(root, new Set());
    rootMembers.get(root)!.add(u);
  };
  for (const e of edges) {
    touch(e.a);
    touch(e.b);
  }

  // Assign a stable cluster id only to genuine clusters (size ≥ 2).
  const rootClusterId = new Map<string, string | null>();
  const clusters = new Map<string, string[]>();
  for (const [root, members] of rootMembers) {
    if (members.size >= 2) {
      const id = randomUUID();
      rootClusterId.set(root, id);
      clusters.set(id, [...members]);
    } else {
      rootClusterId.set(root, null);
    }
  }
  const clusterOf = (u: string): string | null => rootClusterId.get(uf.find(u)) ?? null;

  // Per-user aggregates.
  const nodes = new Map<string, RiskGraphNode>();
  const ensure = (u: string): RiskGraphNode => {
    let n = nodes.get(u);
    if (!n) {
      const cid = clusterOf(u);
      n = {
        clusterId: cid,
        clusterSize: cid ? clusters.get(cid)!.length : 1,
        clusterVolumeUsdc: 0,
        counterpartyVolumesUsdc: [],
        totalVolumeUsdc: 0,
        inClusterVolumeUsdc: 0,
        clusterMembers: cid ? clusters.get(cid)! : [u],
      };
      nodes.set(u, n);
    }
    return n;
  };

  const edgeClusters = new Map<string, string | null>();
  for (const e of edges) {
    const ca = clusterOf(e.a);
    const cb = clusterOf(e.b);
    const sameCluster = ca !== null && ca === cb;
    edgeClusters.set(`${e.a}|${e.b}`, sameCluster ? ca : null);

    for (const [u, other] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      const n = ensure(u);
      n.counterpartyVolumesUsdc.push(e.volume);
      n.totalVolumeUsdc += e.volume;
      const uCluster = clusterOf(u);
      const otherCluster = clusterOf(other);
      if (uCluster !== null && uCluster === otherCluster) {
        n.inClusterVolumeUsdc += e.volume;
      }
    }
  }

  // Cluster volume = Σ internal edge volume, assigned to each member.
  const clusterVol = new Map<string, number>();
  for (const e of edges) {
    const cid = edgeClusters.get(`${e.a}|${e.b}`);
    if (cid) clusterVol.set(cid, (clusterVol.get(cid) ?? 0) + e.volume);
  }
  for (const n of nodes.values()) {
    if (n.clusterId) n.clusterVolumeUsdc = clusterVol.get(n.clusterId) ?? 0;
  }

  return { graph: { nodes, clusters }, edgeClusters };
}

/**
 * Rebuild the counterparty graph from matched bets and persist `risk_edges`
 * (replace-all cache). Read-only against `bets`/`bet_arbiters`; writes only the
 * `risk_edges` cache. Returns the in-memory graph for immediate scoring.
 */
export async function rebuildRiskGraph(
  db: RiskDb,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<RiskGraph> {
  const edges = await loadRawEdges(db);
  const { graph, edgeClusters } = buildGraph(edges, config);

  await db.delete(riskEdges);
  if (edges.length > 0) {
    await db.insert(riskEdges).values(
      edges.map((e) => ({
        userA: e.a,
        userB: e.b,
        sharedBets: e.sharedBets,
        sharedVolumeUsdc: String(e.volume),
        sharedArbiterBets: e.sharedArbiterBets,
        lastBetAt: e.lastBetAt ? new Date(e.lastBetAt) : null,
        clusterId: edgeClusters.get(`${e.a}|${e.b}`) ?? null,
      })),
    );
  }
  return graph;
}

/** Load the persisted graph (no rebuild) — used by incremental ticks. */
export async function loadRiskGraph(
  db: RiskDb,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<RiskGraph> {
  const rows = await db
    .select({
      a: riskEdges.userA,
      b: riskEdges.userB,
      sharedBets: riskEdges.sharedBets,
      volume: riskEdges.sharedVolumeUsdc,
      lastBetAt: riskEdges.lastBetAt,
      sharedArbiterBets: riskEdges.sharedArbiterBets,
    })
    .from(riskEdges);

  const edges: RawEdge[] = rows.map(
    (r: {
      a: string;
      b: string;
      sharedBets: number;
      volume: string;
      lastBetAt: Date | null;
      sharedArbiterBets: number;
    }) => ({
      a: r.a,
      b: r.b,
      sharedBets: Number(r.sharedBets),
      volume: Number(r.volume),
      lastBetAt: r.lastBetAt ? r.lastBetAt.toISOString() : null,
      sharedArbiterBets: Number(r.sharedArbiterBets),
    }),
  );
  return buildGraph(edges, config).graph;
}
