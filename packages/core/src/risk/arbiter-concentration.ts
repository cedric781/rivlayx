import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { ArbiterConcentrationInput } from './types';
import { clamp01 } from './util';

/**
 * Arbiter-concentration — pure. A collusion-specific signal: does a creator (or
 * acceptor, or whole cluster) funnel adjudication to one captive arbiter?
 * Platform-selected rulings are excluded upstream (vetted, not suspicious).
 *
 *   signal = 0.35·creatorShare + 0.25·acceptorShare + 0.40·clusterShare
 *
 * Gated by a minimum number of user-selected ruled bets — one ruled bet is
 * trivially "100% one arbiter" and must not flag.
 *
 * Feeds two places (per spec): the ring `arbiterOverlap` term and its own
 * weighted term in the risk composite.
 */
export function computeArbiterConcentrationSignal(
  input: ArbiterConcentrationInput,
  config: RiskConfig = RISK_DEFAULTS,
): number {
  const a = config.arbiterConcentration;
  if (input.ruledBetsConsidered < a.minRuledBets) return 0;

  return clamp01(
    a.creatorShareWeight * clamp01(input.creatorArbiterShare) +
      a.acceptorShareWeight * clamp01(input.acceptorArbiterShare) +
      a.clusterShareWeight * clamp01(input.clusterArbiterShare),
  );
}
