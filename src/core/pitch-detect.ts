export interface PitchDetectionResult {
  /** Estimated fundamental frequency in Hz, refined by parabolic interpolation. */
  hz: number;
  /** 1 - d'(tau) at the chosen lag. Higher = more periodic/confident. Not gated here (M5's job). */
  confidence: number;
}

export interface YinOptions {
  /** Lowest fundamental to search for, in Hz. Default 60 (covers a low bass note). */
  minHz?: number;
  /** Highest fundamental to search for, in Hz. Default 1000 (covers vocal range). */
  maxHz?: number;
  /** Absolute threshold for the cumulative mean normalized difference. Default 0.15 (YIN paper's value). */
  threshold?: number;
}

const DEFAULT_MIN_HZ = 60;
const DEFAULT_MAX_HZ = 1000;
const DEFAULT_THRESHOLD = 0.15;

/**
 * YIN fundamental frequency estimator (de Cheveigne & Kawahara, 2002).
 *
 * Deliberately does NOT decide "no pitch" — silence and noise still return a
 * result, just with a low `confidence`. Gating on confidence/RMS and
 * rejecting octave jumps is `smoothing.ts`'s job, one level up, so the two
 * failure modes (bad math vs. bad real-world input) stay independently
 * testable.
 *
 * Returns null only when `buffer` is too short to search the requested
 * frequency range at all — a precondition failure, not a "no pitch" signal.
 */
export function detectPitchYin(
  buffer: Float32Array | number[],
  sampleRate: number,
  options: YinOptions = {},
): PitchDetectionResult | null {
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const x = buffer instanceof Float32Array ? buffer : Float32Array.from(buffer);
  const n = x.length;

  const tauMin = Math.max(1, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2));

  if (tauMax <= tauMin + 1) {
    return null; // buffer too short to search this range at all
  }

  // 1. Difference function d(tau) = sum_i (x[i] - x[i+tau])^2
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      const diff = x[i] - x[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // 2. Cumulative mean normalized difference: d'(tau) = d(tau) * tau / sum_{j=1}^{tau} d(j)
  const dPrime = new Float64Array(tauMax + 1);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum === 0 ? 1 : (d[tau] * tau) / runningSum;
  }

  // 3. Absolute threshold: first local minimum below `threshold` in [tauMin, tauMax].
  let chosenTau = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dPrime[tau] < threshold) {
      // walk forward to the bottom of this dip
      let t = tau;
      while (t + 1 <= tauMax && dPrime[t + 1] < dPrime[t]) t++;
      chosenTau = t;
      break;
    }
  }

  // 4. No dip crossed the threshold — fall back to the global minimum (low confidence).
  if (chosenTau === -1) {
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dPrime[tau] < minVal) {
        minVal = dPrime[tau];
        chosenTau = tau;
      }
    }
  }

  // 5. Parabolic interpolation around chosenTau for sub-sample precision.
  let betterTau = chosenTau;
  const t0 = chosenTau > 0 ? dPrime[chosenTau - 1] : dPrime[chosenTau];
  const t1 = dPrime[chosenTau];
  const t2 = chosenTau < tauMax ? dPrime[chosenTau + 1] : dPrime[chosenTau];
  const denom = t0 - 2 * t1 + t2;
  if (denom !== 0 && chosenTau > 0 && chosenTau < tauMax) {
    const shift = (t0 - t2) / (2 * denom);
    if (Math.abs(shift) < 1) betterTau = chosenTau + shift;
  }

  const hz = sampleRate / betterTau;
  const confidence = Math.max(0, 1 - dPrime[chosenTau]);

  return { hz, confidence };
}
