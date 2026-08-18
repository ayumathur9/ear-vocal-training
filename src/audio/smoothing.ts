import { cents } from "../core/notes.ts";

export interface RawPitchFrame {
  hz: number | null;
  confidence: number;
  rms: number;
}

export type StabilizedFrame = { state: "voiced"; hz: number } | { state: "silent" };

export interface StabilizerOptions {
  /** Frames below this YIN confidence are treated as silence. Default 0.85. */
  confidenceThreshold?: number;
  /** Frames quieter than this (dBFS) are treated as silence. Default -45. */
  rmsThresholdDb?: number;
  /** How many recent voiced frames to median-smooth over. Default 5. */
  historySize?: number;
  /** How close (in cents) a frame must be to 2x/0.5x the running median to be treated as an octave error. Default 60. */
  octaveToleranceCents?: number;
}

// 0.85 is the YIN paper's textbook value, tuned against clean lab signals.
// Real singing — vibrato, breathiness, formant shifts — routinely dips a
// genuinely-voiced frame's confidence below that, so 0.85 here gated out
// real voices almost constantly. 0.7 still rejects true noise/silence
// (see pitch-detect.test.ts's noise cases, which score well under this)
// while actually passing a real sung note.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_RMS_THRESHOLD_DB = -45;
const DEFAULT_HISTORY_SIZE = 5;
const DEFAULT_OCTAVE_TOLERANCE_CENTS = 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turns raw, flickery YIN output into a stream a UI or scorer can trust.
 *
 * Rule: never smooth bad data into looking good. Low confidence or silence
 * produces an explicit `{ state: 'silent' }`, never a guessed frequency —
 * that decision belongs to the caller (show "no pitch detected", pause a
 * hold timer, etc.), not to this module papering over it.
 *
 * Stateful by necessity (median + octave repair need recent history), but
 * has zero DOM/AudioWorklet dependency — a stream of plain frames in, a
 * stream of plain frames out, fully unit-testable.
 */
export class PitchStabilizer {
  private readonly confidenceThreshold: number;
  private readonly rmsThreshold: number; // linear amplitude, converted from dBFS
  private readonly historySize: number;
  private readonly octaveToleranceCents: number;
  private history: number[] = [];

  constructor(options: StabilizerOptions = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const rmsThresholdDb = options.rmsThresholdDb ?? DEFAULT_RMS_THRESHOLD_DB;
    this.rmsThreshold = 10 ** (rmsThresholdDb / 20);
    this.historySize = options.historySize ?? DEFAULT_HISTORY_SIZE;
    this.octaveToleranceCents = options.octaveToleranceCents ?? DEFAULT_OCTAVE_TOLERANCE_CENTS;
  }

  push(frame: RawPitchFrame): StabilizedFrame {
    if (frame.hz === null || frame.confidence < this.confidenceThreshold || frame.rms < this.rmsThreshold) {
      this.history = []; // fresh start for the next voiced segment; no stale octave anchor
      return { state: "silent" };
    }

    const repairedHz = this.history.length > 0 ? this.repairOctave(frame.hz, median(this.history)) : frame.hz;

    this.history.push(repairedHz);
    if (this.history.length > this.historySize) this.history.shift();

    return { state: "voiced", hz: median(this.history) };
  }

  reset(): void {
    this.history = [];
  }

  private repairOctave(hz: number, referenceHz: number): number {
    for (const factor of [2, 0.5]) {
      const candidate = hz * factor;
      if (Math.abs(cents(candidate, referenceHz)) <= this.octaveToleranceCents) {
        return candidate;
      }
    }
    return hz;
  }
}
