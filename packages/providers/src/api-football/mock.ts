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
import { ApiFootballProvider, parseFixtureReference } from './index';
import type { ApiFootballEnvelope, FixtureSnapshot } from './types';

/**
 * Programmable in-memory API-Football for tests. Stores fixture snapshots
 * keyed by fixture ID; delegates parsing + normalization to the real provider
 * so test coverage actually exercises the production logic.
 */
export class MockApiFootballProvider implements ResolveProvider {
  readonly name = 'api_football';
  private readonly delegate = new ApiFootballProvider();
  private readonly fixtures = new Map<string, FixtureSnapshot>();

  setFixture(snap: FixtureSnapshot): void {
    this.fixtures.set(snap.fixtureId, snap);
  }

  clearAll(): void {
    this.fixtures.clear();
  }

  supports(predicate: SupportedPredicate): boolean {
    return this.delegate.supports(predicate);
  }

  async fetchResult({
    predicate,
  }: {
    predicate: SupportedPredicate;
  }): Promise<RawProviderResponse> {
    if (!this.supports(predicate)) {
      throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot fetch for ${predicate.type}`);
    }
    const ref =
      predicate.type === 'team_wins'
        ? (predicate as TeamWinsPredicate).eventReference
        : (predicate as ScoreOverUnderPredicate).eventReference;
    const fixtureId = parseFixtureReference(ref);
    const snap = this.fixtures.get(fixtureId);
    if (!snap) {
      throw new ProviderError('NOT_FOUND', `mock fixture ${fixtureId} not registered`);
    }
    const envelope: ApiFootballEnvelope = {
      response: [
        {
          fixture: {
            id: Number(snap.fixtureId),
            status: {
              short: snap.statusShort,
              long: snap.statusShort === 'FT' ? 'Match Finished' : snap.statusShort,
            },
          },
          teams: { home: { name: snap.homeName }, away: { name: snap.awayName } },
          goals: { home: snap.homeGoals, away: snap.awayGoals },
        },
      ],
    };
    return envelope as unknown as RawProviderResponse;
  }

  validateResult(raw: RawProviderResponse): ValidationOutcome {
    return this.delegate.validateResult(raw);
  }

  normalizeResult(raw: RawProviderResponse, predicate: SupportedPredicate): ProviderResult {
    return this.delegate.normalizeResult(raw, predicate);
  }
}
