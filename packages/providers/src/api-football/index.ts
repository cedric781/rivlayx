import { ProviderError } from '../errors';
import type {
  ProviderResult,
  RawProviderResponse,
  ResolveProvider,
  SupportedPredicate,
  TeamWinsPredicate,
  ScoreOverUnderPredicate,
  ValidationOutcome,
} from '../types';
import type { ApiFootballEnvelope, FixtureSnapshot } from './types';

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const CANCELLED_STATUSES = new Set(['CANC', 'ABD', 'AWD', 'WO']);
const PENDING_STATUSES = new Set([
  'TBD',
  'NS',
  '1H',
  'HT',
  '2H',
  'ET',
  'BT',
  'P',
  'SUSP',
  'INT',
  'LIVE',
  'PST',
]);

const PROVIDER_NAME = 'api_football';

export interface ApiFootballConfig {
  /** API key — required for the real provider; mock leaves it unset. */
  apiKey?: string;
  /** Override the base URL for tests; defaults to v3.football.api-sports.io. */
  baseUrl?: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Parse our internal `apifootball:fixture:{id}` reference into the numeric ID.
 */
export function parseFixtureReference(reference: string): string {
  const parts = reference.split(':');
  if (parts.length !== 3 || parts[0] !== 'apifootball' || parts[1] !== 'fixture' || !parts[2]) {
    throw new ProviderError(
      'INVALID_REFERENCE',
      `expected "apifootball:fixture:<id>", got "${reference}"`,
    );
  }
  return parts[2];
}

export function snapshotFromEnvelope(env: ApiFootballEnvelope): FixtureSnapshot {
  const fixture = env.response?.[0];
  if (!fixture) {
    throw new ProviderError('NOT_FOUND', 'API-Football returned no fixtures');
  }
  return {
    fixtureId: String(fixture.fixture.id),
    statusShort: fixture.fixture.status.short,
    homeName: fixture.teams.home.name,
    awayName: fixture.teams.away.name,
    homeGoals: fixture.goals.home ?? 0,
    awayGoals: fixture.goals.away ?? 0,
  };
}

/** Real implementation. Uses native fetch. */
export class ApiFootballProvider implements ResolveProvider {
  readonly name = PROVIDER_NAME;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ApiFootballConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://v3.football.api-sports.io';
    this.fetchImpl =
      config.fetchImpl ??
      (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch));
  }

  supports(predicate: SupportedPredicate): boolean {
    return predicate.type === 'team_wins' || predicate.type === 'score_over_under';
  }

  async fetchResult({
    predicate,
  }: {
    predicate: SupportedPredicate;
  }): Promise<RawProviderResponse> {
    if (!this.supports(predicate)) {
      throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot fetch for ${predicate.type}`);
    }
    if (!this.config.apiKey) {
      throw new ProviderError('NETWORK_ERROR', 'API-Football api key not configured');
    }
    if (!this.fetchImpl) {
      throw new ProviderError('NO_HTTP_CLIENT', 'global fetch is unavailable');
    }
    const ref =
      predicate.type === 'team_wins'
        ? (predicate as TeamWinsPredicate).eventReference
        : (predicate as ScoreOverUnderPredicate).eventReference;
    const fixtureId = parseFixtureReference(ref);
    const url = `${this.baseUrl}/fixtures?id=${encodeURIComponent(fixtureId)}`;

    const res = await this.fetchImpl(url, {
      headers: {
        'x-rapidapi-key': this.config.apiKey,
        'x-rapidapi-host': new URL(this.baseUrl).host,
      },
    });
    if (!res.ok) {
      throw new ProviderError(
        'NETWORK_ERROR',
        `API-Football fixtures returned ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json().catch(() => null)) as ApiFootballEnvelope | null;
    if (!json) {
      throw new ProviderError('MALFORMED_RESPONSE', 'API-Football response was not JSON');
    }
    return json as unknown as RawProviderResponse;
  }

  validateResult(raw: RawProviderResponse): ValidationOutcome {
    try {
      const snap = snapshotFromEnvelope(raw as unknown as ApiFootballEnvelope);
      if (FINISHED_STATUSES.has(snap.statusShort)) return { ok: true };
      if (CANCELLED_STATUSES.has(snap.statusShort)) {
        return { ok: false, reason: 'cancelled', message: `fixture status ${snap.statusShort}` };
      }
      if (PENDING_STATUSES.has(snap.statusShort)) {
        return { ok: false, reason: 'pending', message: `fixture status ${snap.statusShort}` };
      }
      return { ok: false, reason: 'incomplete', message: `unknown status ${snap.statusShort}` };
    } catch (err) {
      return {
        ok: false,
        reason: 'malformed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  normalizeResult(raw: RawProviderResponse, predicate: SupportedPredicate): ProviderResult {
    const snap = snapshotFromEnvelope(raw as unknown as ApiFootballEnvelope);
    const baseRaw = raw;
    if (CANCELLED_STATUSES.has(snap.statusShort)) {
      return {
        provider: PROVIDER_NAME,
        status: 'cancelled',
        winningSide: null,
        resolvedAt: null,
        rawPayload: baseRaw,
        message: `fixture status ${snap.statusShort}`,
      };
    }
    if (!FINISHED_STATUSES.has(snap.statusShort)) {
      return {
        provider: PROVIDER_NAME,
        status: 'pending',
        winningSide: null,
        resolvedAt: null,
        rawPayload: baseRaw,
        message: `fixture status ${snap.statusShort}`,
      };
    }

    if (predicate.type === 'team_wins') {
      const winningSide =
        snap.homeGoals > snap.awayGoals
          ? 'home'
          : snap.homeGoals < snap.awayGoals
            ? 'away'
            : 'draw';
      return {
        provider: PROVIDER_NAME,
        status: 'final',
        winningSide,
        resolvedAt: snap.finishedAt ?? new Date().toISOString(),
        rawPayload: baseRaw,
      };
    }
    if (predicate.type === 'score_over_under') {
      const total = snap.homeGoals + snap.awayGoals;
      const winningSide = total > predicate.threshold ? 'over' : 'under';
      return {
        provider: PROVIDER_NAME,
        status: 'final',
        winningSide,
        resolvedAt: snap.finishedAt ?? new Date().toISOString(),
        rawPayload: baseRaw,
      };
    }
    throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot normalize ${predicate.type}`);
  }
}
