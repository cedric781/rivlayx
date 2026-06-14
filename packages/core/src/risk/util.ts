/** Shared pure helpers for the risk detectors. No I/O. */

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Log-scaled normalisation to [0,1] with `target` ≈ full credit. */
export function norm(x: number, target: number): number {
  if (target <= 0) return 0;
  return clamp01(Math.log1p(Math.max(0, x)) / Math.log1p(target));
}

export function round0to100(signal01: number): number {
  return clamp(Math.round(100 * signal01), 0, 100);
}
