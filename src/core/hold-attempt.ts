import { cents } from "./notes.ts";

export interface HoldAttemptOptions {
  targetHz: number;
  toleranceCents: number;
  requiredMs: number;
  /** Gap (silence/dropout) tolerated before the attempt restarts, in ms. Default 400 — see hold-tracker.ts for why this matters against real vibrato/breathiness. */
  maxGapMs?: number;
}

export interface HoldAttemptResult {
  timeHeldMs: number;
  /** Fraction of voiced frames within tolerance of the target, times a drift penalty. 0-100. */
  stabilityPercent: number;
  score: number;
}

export type HoldAttemptFrameResult =
  | { status: "not-started" }
  | { status: "recording"; elapsedMs: number }
  | { status: "complete"; result: HoldAttemptResult };

const DEFAULT_MAX_GAP_MS = 400;

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Scores a continuous "hold this target pitch" attempt (Hold the Pitch).
 * Unlike HoldTracker (which detects "is *any* pitch being held steady?"),
 * this tracks accuracy against a known target throughout the whole
 * attempt: time-in-tune AND pitch drift (wobble), matching the plan's
 * stability formula. A brief gap (breath, momentary low confidence) is
 * tolerated without discarding progress; a real pause restarts the attempt.
 */
export class HoldAttemptTracker {
  private readonly targetHz: number;
  private readonly toleranceCents: number;
  private readonly requiredMs: number;
  private readonly maxGapMs: number;

  private startedAt: number | null = null;
  private lastFrameAt: number | null = null;
  private centsLog: number[] = [];
  private inToleranceCount = 0;

  constructor(options: HoldAttemptOptions) {
    this.targetHz = options.targetHz;
    this.toleranceCents = options.toleranceCents;
    this.requiredMs = options.requiredMs;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  }

  pushVoiced(hz: number, nowMs: number): HoldAttemptFrameResult {
    if (this.startedAt === null) {
      this.startedAt = nowMs;
      this.centsLog = [];
      this.inToleranceCount = 0;
    }
    this.lastFrameAt = nowMs;

    const centsOff = cents(hz, this.targetHz);
    this.centsLog.push(centsOff);
    if (Math.abs(centsOff) <= this.toleranceCents) this.inToleranceCount++;

    const elapsedMs = nowMs - this.startedAt;
    if (elapsedMs >= this.requiredMs) {
      return { status: "complete", result: this.finalize() };
    }
    return { status: "recording", elapsedMs };
  }

  pushSilent(nowMs: number): HoldAttemptFrameResult {
    if (this.startedAt === null) return { status: "not-started" };
    if (nowMs - this.lastFrameAt! > this.maxGapMs) {
      this.reset();
      return { status: "not-started" };
    }
    return { status: "recording", elapsedMs: nowMs - this.startedAt };
  }

  /** Ends the attempt early (e.g. an overall round timeout) and scores whatever was captured. Null if nothing was ever recorded. */
  forceFinalize(): HoldAttemptResult | null {
    if (this.startedAt === null || this.centsLog.length === 0) return null;
    return this.finalize();
  }

  private finalize(): HoldAttemptResult {
    const timeHeldMs = this.lastFrameAt! - this.startedAt!;
    const timeInTune = this.inToleranceCount / this.centsLog.length;
    const drift = standardDeviation(this.centsLog);
    const stabilityPercent = Math.max(0, 100 * timeInTune * Math.max(0, 1 - drift / 100));
    const result = { timeHeldMs, stabilityPercent, score: Math.round(stabilityPercent) };
    this.reset();
    return result;
  }

  reset(): void {
    this.startedAt = null;
    this.lastFrameAt = null;
    this.centsLog = [];
    this.inToleranceCount = 0;
  }
}
