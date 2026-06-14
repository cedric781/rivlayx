import type { SybilInput, SybilResult } from './types';
import { clamp01 } from './util';

/**
 * Behavioural sybil detection — pure. NO device fingerprinting, IP tracking or
 * KYC. Confidence blends creation-burst, username-pattern, stake-similarity and
 * template-similarity. Behavioural-only sybil is inherently noisy, so this
 * raises a review alert (it does not heavily drive the composite). A lone
 * account (groupSize < 2) is never a sybil cluster.
 */
export function computeSybilConfidence(input: SybilInput): SybilResult {
  if (input.groupSize < 2) return { confidence: 0, signalsHit: [] };

  const signalsHit: string[] = [];
  if (input.creationBurstRatio >= 0.5) signalsHit.push('creation_burst');
  if (input.usernamePatternScore >= 0.5) signalsHit.push('username_pattern');
  if (input.stakeSimilarity >= 0.5) signalsHit.push('stake_similarity');
  if (input.templateSimilarity >= 0.5) signalsHit.push('template_similarity');

  const confidence = clamp01(
    0.3 * clamp01(input.creationBurstRatio) +
      0.25 * clamp01(input.usernamePatternScore) +
      0.25 * clamp01(input.stakeSimilarity) +
      0.2 * clamp01(input.templateSimilarity),
  );

  return { confidence, signalsHit };
}
