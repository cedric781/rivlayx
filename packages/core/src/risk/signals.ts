import { sql } from 'drizzle-orm';
import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { RiskGraph } from './graph';
import { computeRingSignal } from './ring';
import { computeArbiterConcentrationSignal } from './arbiter-concentration';
import { computeConcentrationSignal } from './concentration';
import { computeWashSignal } from './wash';
import { computeAbuseSignal } from './abuse';
import { computeVelocitySignal } from './velocity';
import { computeFundingOverlapSignal } from './funding';
import { clamp01 } from './util';
import type { RiskScoreInput } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

const MS_PER_DAY = 86_400_000;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}
function firstRow(res: unknown): Record<string, unknown> | undefined {
  return rowsOf(res)[0];
}
function maxShare(rows: Array<Record<string, unknown>>, key: string): number {
  let total = 0;
  let max = 0;
  for (const r of rows) {
    const c = Number(r[key] ?? 0);
    total += c;
    if (c > max) max = c;
  }
  return total > 0 ? max / total : 0;
}

/** Everything `computeRiskScore` needs plus evidence/cluster metadata. */
export interface RiskGather {
  input: RiskScoreInput;
  ringClusterId: string | null;
  /** Worst reciprocal counterparty for wash, if any. */
  washCounterpartyId: string | null;
  evidence: Record<string, unknown>;
}

/**
 * Gather all risk signals for one user — read-only. Combines graph-derived
 * inputs (ring, concentration) with targeted aggregate queries (arbiter
 * concentration, wash, dispute abuse, velocity, funding overlap), then runs the
 * pure detectors. Writes nothing here; scoring + persistence happen downstream.
 */
export async function gatherRiskSignals(
  db: RiskDb,
  userId: string,
  graph: RiskGraph,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<RiskGather> {
  const node = graph.nodes.get(userId);
  const clusterMembers = (node?.clusterMembers ?? []).filter((m) => m !== userId);
  const clusterId = node?.clusterId ?? null;

  // ── account basics ──
  const baseRow = firstRow(
    await db.execute(sql`
      SELECT u.status AS status, u.created_at AS created_at,
        (SELECT count(*) FROM "app"."bets" b
          WHERE b.acceptor_user_id IS NOT NULL
            AND (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})) AS matched
      FROM "auth"."users" u WHERE u.id = ${userId}`),
  );
  const ageDays = baseRow?.['created_at']
    ? Math.max(0, Math.floor((Date.now() - new Date(String(baseRow['created_at'])).getTime()) / MS_PER_DAY))
    : 0;
  const matchedBets = Number(baseRow?.['matched'] ?? 0);

  // ── ring (graph-derived + arbiter overlap query) ──
  const cohesion = node && node.totalVolumeUsdc > 0 ? node.inClusterVolumeUsdc / node.totalVolumeUsdc : 0;
  const cpVolumes = [...(node?.counterpartyVolumesUsdc ?? [])].sort((a, b) => b - a);
  const totalCpVol = cpVolumes.reduce((s, v) => s + v, 0);
  const topVol = cpVolumes.slice(0, config.graph.topCounterparties).reduce((s, v) => s + v, 0);
  const repeatedCounterpartyRatio = totalCpVol > 0 ? topVol / totalCpVol : 0;

  let arbiterOverlap = 0;
  if (clusterMembers.length > 0) {
    const ov = firstRow(
      await db.execute(sql`
        SELECT count(*) FILTER (WHERE ba.arbiter_user_id IN (${sql.join(
          clusterMembers.map((m) => sql`${m}`),
          sql`, `,
        )})) AS in_cluster,
          count(*) AS total
        FROM "app"."bet_arbiters" ba
        JOIN "app"."bets" b ON b.id = ba.bet_id
        WHERE ba.decision IS NOT NULL
          AND (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})`),
    );
    const total = Number(ov?.['total'] ?? 0);
    arbiterOverlap = total > 0 ? Number(ov?.['in_cluster'] ?? 0) / total : 0;
  }

  const ringSignal = computeRingSignal(
    {
      cohesion,
      repeatedCounterpartyRatio,
      arbiterOverlap,
      clusterSize: node?.clusterSize ?? 1,
      clusterVolumeUsdc: node?.clusterVolumeUsdc ?? 0,
    },
    config,
  );

  // ── arbiter concentration (user-selected rulings only) ──
  const creatorRows = rowsOf(
    await db.execute(sql`
      SELECT ba.arbiter_user_id AS arb, count(DISTINCT b.id) AS c
      FROM "app"."bets" b
      JOIN "app"."bet_arbiters" ba ON ba.bet_id = b.id AND ba.decision IS NOT NULL AND ba.selected_by <> 'platform'
      WHERE b.creator_user_id = ${userId}
      GROUP BY 1`),
  );
  const acceptorRows = rowsOf(
    await db.execute(sql`
      SELECT ba.arbiter_user_id AS arb, count(DISTINCT b.id) AS c
      FROM "app"."bets" b
      JOIN "app"."bet_arbiters" ba ON ba.bet_id = b.id AND ba.decision IS NOT NULL AND ba.selected_by <> 'platform'
      WHERE b.acceptor_user_id = ${userId}
      GROUP BY 1`),
  );
  const ruledBetsConsidered =
    creatorRows.reduce((s, r) => s + Number(r['c'] ?? 0), 0) +
    acceptorRows.reduce((s, r) => s + Number(r['c'] ?? 0), 0);

  let clusterArbiterShare = 0;
  if (clusterMembers.length > 0) {
    const memberList = sql.join(
      [userId, ...clusterMembers].map((m) => sql`${m}`),
      sql`, `,
    );
    const clusterRows = rowsOf(
      await db.execute(sql`
        SELECT ba.arbiter_user_id AS arb, count(DISTINCT b.id) AS c
        FROM "app"."bets" b
        JOIN "app"."bet_arbiters" ba ON ba.bet_id = b.id AND ba.decision IS NOT NULL AND ba.selected_by <> 'platform'
        WHERE b.creator_user_id IN (${memberList}) OR b.acceptor_user_id IN (${memberList})
        GROUP BY 1`),
    );
    clusterArbiterShare = maxShare(clusterRows, 'c');
  }

  const arbiterConcentrationSignal = computeArbiterConcentrationSignal(
    {
      creatorArbiterShare: maxShare(creatorRows, 'c'),
      acceptorArbiterShare: maxShare(acceptorRows, 'c'),
      clusterArbiterShare,
      ruledBetsConsidered,
    },
    config,
  );

  // ── counterparty concentration ──
  const concentrationSignal = computeConcentrationSignal(
    { counterpartyVolumesUsdc: node?.counterpartyVolumesUsdc ?? [] },
    config,
  );

  // ── wash trading (worst reciprocal pair) ──
  const washRows = rowsOf(
    await db.execute(sql`
      WITH pb AS (
        SELECT b.id AS id, b.stake_per_side_usdc AS stake,
          CASE WHEN b.creator_user_id = ${userId} THEN b.acceptor_user_id ELSE b.creator_user_id END AS other,
          (b.creator_user_id = ${userId}) AS is_creator
        FROM "app"."bets" b
        WHERE b.acceptor_user_id IS NOT NULL
          AND (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})
      )
      SELECT pb.other AS other,
        count(*) FILTER (WHERE pb.is_creator) AS dir1,
        count(*) FILTER (WHERE NOT pb.is_creator) AS dir2,
        COALESCE(sum(pb.stake), 0) AS recip_volume,
        COALESCE(sum(s.net_winner_usdc), 0) AS gross,
        COALESCE(sum(CASE WHEN s.winner_user_id = ${userId} THEN s.net_winner_usdc
                          WHEN s.winner_user_id = pb.other THEN -s.net_winner_usdc ELSE 0 END), 0) AS net_signed
      FROM pb
      LEFT JOIN "app"."settlements" s ON s.bet_id = pb.id AND s.kind = 'winner_payout'
      GROUP BY pb.other`),
  );
  let washSignal = 0;
  let washCounterpartyId: string | null = null;
  for (const r of washRows) {
    const dir1 = Number(r['dir1'] ?? 0);
    const dir2 = Number(r['dir2'] ?? 0);
    const gross = Number(r['gross'] ?? 0);
    const netSigned = Number(r['net_signed'] ?? 0);
    const recipVolume = Number(r['recip_volume'] ?? 0);
    const netExposureRatio = gross > 0 ? clamp01(Math.abs(netSigned) / gross) : 1;
    const s = computeWashSignal(
      { roundTrips: Math.min(dir1, dir2), netExposureRatio, reciprocalVolumeUsdc: recipVolume },
      config,
    );
    if (s > washSignal) {
      washSignal = s;
      washCounterpartyId = r['other'] ? String(r['other']) : null;
    }
  }

  // ── dispute abuse ──
  const disp = firstRow(
    await db.execute(sql`
      SELECT count(*) AS opened, count(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM "app"."disputes" WHERE opener_user_id = ${userId}`),
  );
  const disputesOpened = Number(disp?.['opened'] ?? 0);
  const rejectedDisputes = Number(disp?.['rejected'] ?? 0);
  let patternConcentration = 0;
  if (disputesOpened > 1) {
    const targetRows = rowsOf(
      await db.execute(sql`
        SELECT count(*) AS c
        FROM "app"."disputes" d JOIN "app"."bets" b ON b.id = d.bet_id
        WHERE d.opener_user_id = ${userId}
        GROUP BY (CASE WHEN b.creator_user_id = ${userId} THEN b.acceptor_user_id ELSE b.creator_user_id END)`),
    );
    patternConcentration = maxShare(targetRows, 'c');
  }
  const abuseSignal = computeAbuseSignal(
    { disputesOpened, rejectedDisputes, matchedBets, patternConcentration },
    config,
  );

  // ── velocity (recent window vs scaled trailing baseline) ──
  const recentDays = config.graph.recentWindowDays;
  const baselineDays = config.graph.baselineWindowDays;
  const vel = firstRow(
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE b.created_at >= now() - (${recentDays} || ' days')::interval) AS recent_n,
        count(*) FILTER (WHERE b.created_at < now() - (${recentDays} || ' days')::interval
                           AND b.created_at >= now() - (${baselineDays} || ' days')::interval) AS base_n,
        COALESCE(sum(b.stake_per_side_usdc) FILTER (WHERE b.created_at >= now() - (${recentDays} || ' days')::interval), 0) AS recent_vol,
        COALESCE(sum(b.stake_per_side_usdc) FILTER (WHERE b.created_at < now() - (${recentDays} || ' days')::interval
                           AND b.created_at >= now() - (${baselineDays} || ' days')::interval), 0) AS base_vol,
        COALESCE(avg(b.stake_per_side_usdc) FILTER (WHERE b.created_at >= now() - (${recentDays} || ' days')::interval), 0) AS recent_avg,
        COALESCE(avg(b.stake_per_side_usdc) FILTER (WHERE b.created_at < now() - (${recentDays} || ' days')::interval
                           AND b.created_at >= now() - (${baselineDays} || ' days')::interval), 0) AS base_avg
      FROM "app"."bets" b
      WHERE b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId}`),
  );
  // Scale the longer baseline window down to a recent-window-equivalent rate.
  const baselineSpan = Math.max(1, baselineDays - recentDays);
  const scale = recentDays / baselineSpan;
  const baseN = Number(vel?.['base_n'] ?? 0);
  const baseVol = Number(vel?.['base_vol'] ?? 0);
  const velocitySignal = computeVelocitySignal(
    {
      recentBets: Number(vel?.['recent_n'] ?? 0),
      baselineBets: baseN * scale,
      recentVolumeUsdc: Number(vel?.['recent_vol'] ?? 0),
      baselineVolumeUsdc: baseVol * scale,
      recentAvgStakeUsdc: Number(vel?.['recent_avg'] ?? 0),
      baselineAvgStakeUsdc: Number(vel?.['base_avg'] ?? 0),
      hasBaseline: baseN >= config.velocity.minBaselineBets,
    },
    config,
  );

  // ── funding overlap (supporting only) ──
  const allow = config.funding.allowlistedSourceWallets;
  const allowFilter =
    allow.length > 0
      ? sql`AND d1.source_wallet NOT IN (${sql.join(
          allow.map((w) => sql`${w}`),
          sql`, `,
        )}) AND d2.source_wallet NOT IN (${sql.join(
          allow.map((w) => sql`${w}`),
          sql`, `,
        )})`
      : sql``;
  const fund = firstRow(
    await db.execute(sql`
      SELECT count(DISTINCT d2.user_id) AS shared
      FROM "financial"."deposits" d1
      JOIN "financial"."deposits" d2
        ON d2.source_wallet = d1.source_wallet AND d2.user_id <> d1.user_id
      WHERE d1.user_id = ${userId} ${allowFilter}`),
  );
  const fundingSignal = computeFundingOverlapSignal(
    { sharedSourceUsers: Number(fund?.['shared'] ?? 0) },
    config,
  );

  const input: RiskScoreInput = {
    ringSignal,
    arbiterConcentrationSignal,
    concentrationSignal,
    washSignal,
    abuseSignal,
    velocitySignal,
    fundingSignal,
    matchedBets,
    ageDays,
  };

  return {
    input,
    ringClusterId: clusterId,
    washCounterpartyId,
    evidence: {
      cohesion,
      repeatedCounterpartyRatio,
      arbiterOverlap,
      clusterSize: node?.clusterSize ?? 1,
      ruledBetsConsidered,
      disputesOpened,
      rejectedDisputes,
      sharedSourceUsers: Number(fund?.['shared'] ?? 0),
      matchedBets,
      ageDays,
    },
  };
}
