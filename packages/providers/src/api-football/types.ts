/** Shape we expect from API-Football v3 `/fixtures?id=` responses. */
export interface ApiFootballFixtureResponse {
  fixture: {
    id: number;
    status: { short: string; long: string };
  };
  teams: {
    home: { name: string };
    away: { name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

export interface ApiFootballEnvelope {
  response: ApiFootballFixtureResponse[];
}

/** Internal representation used by mock + tests. */
export interface FixtureSnapshot {
  fixtureId: string;
  statusShort: string;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  finishedAt?: string;
}
