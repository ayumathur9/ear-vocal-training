import { cents } from "./notes.ts";

export interface HoldTrackerOptions {
  /**
   * How wide the whole window's peak-to-peak spread (in cents) may get
   * before the hold restarts. Default 90.
   *
   * This is a *spread* budget across the whole held window, not a distance
   * from a single reference point — natural vibrato continuously sweeps a
   * pitch up and down, so comparing each new frame only to the window's
   * running median causes false restarts: the median itself drifts toward
   * whatever extreme the vibrato most recently swept through, so the return
   * swing looks like a big jump away from it even though the note's actual
   * envelope never left a bounded range. Tracking total spread instead
   * tolerates real vibrato (typically well under a semitone of wobble)
   * while still catching a genuine move to a different note.
   */
  toleranceCents?: number;
  /** How long a steady pitch must be held before it's captured, in ms. Default 2000. */
  requiredMs?: number;
  /**
   * How long a gap (silence, a breath, a momentary low-confidence dip) is
   * tolerated without wiping accumulated progress, in ms. Default 400.
   * Real singing is not acoustically clean like a synthesized test tone —
   * without this, a single low-confidence YIN frame (common with vibrato or
   * a consonant) would restart the whole hold and the UI would never
   * progress past "hold it steady" for an actual human voice.
   */
  maxGapMs?: number;
}

export type HoldResult =
  | { status: "holding"; progressMs: number }
  | { status: "captured"; hz: number };

const DEFAULT_TOLERANCE_CENTS = 90;
const DEFAULT_REQUIRED_MS = 2000;
const DEFAULT_MAX_GAP_MS = 400;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Tracks whether a voiced pitch stream has held steady long enough to count
 * as a deliberate, sustained note (used by calibration and, later, Hold the
 * Pitch). Pure: takes (hz, timestampMs) in, has no notion of audio/DOM, and
 * doesn't itself decide what silence means — the caller resets it on a
 * silent/gated frame from PitchStabilizer.
 */
export class HoldTracker {
  private readonly toleranceCents: number;
  private readonly requiredMs: number;
  private readonly maxGapMs: number;
  private samples: { hz: number; t: number }[] = [];

  constructor(options: HoldTrackerOptions = {}) {
    this.toleranceCents = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
    this.requiredMs = options.requiredMs ?? DEFAULT_REQUIRED_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  }

  push(hz: number, nowMs: number): HoldResult {
    if (this.samples.length === 0) {
      this.samples = [{ hz, t: nowMs }];
      return { status: "holding", progressMs: 0 };
    }

    const hzs = this.samples.map((s) => s.hz);
    const minHz = Math.min(...hzs, hz);
    const maxHz = Math.max(...hzs, hz);
    if (cents(maxHz, minHz) > this.toleranceCents) {
      this.samples = [{ hz, t: nowMs }]; // total spread including this frame is too wide — restart here
      return { status: "holding", progressMs: 0 };
    }

    this.samples.push({ hz, t: nowMs });
    const elapsed = nowMs - this.samples[0].t;
    if (elapsed >= this.requiredMs) {
      const capturedHz = median(this.samples.map((s) => s.hz));
      this.samples = [];
      return { status: "captured", hz: capturedHz };
    }
    return { status: "holding", progressMs: elapsed };
  }

  /**
   * Call this on a gated-out (silent/low-confidence) frame instead of
   * push(). Unlike reset(), a brief gap (< maxGapMs) is tolerated and
   * accumulated progress survives it; only a genuinely sustained gap — a
   * real pause or breath — clears the window.
   */
  silentTick(nowMs: number): void {
    this.expireIfGapTooLong(nowMs);
  }

  private expireIfGapTooLong(nowMs: number): void {
    if (this.samples.length === 0) return;
    const lastSampleTime = this.samples[this.samples.length - 1].t;
    if (nowMs - lastSampleTime > this.maxGapMs) {
      this.samples = [];
    }
  }

  reset(): void {
    this.samples = [];
  }
}
