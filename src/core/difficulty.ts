import type { IntervalDirection } from "./intervals.ts";

export interface HigherLowerLevelConfig {
  level: number;
  gapSemitones: number;
  gapCents?: number; // used instead of gapSemitones once gaps go sub-semitone
  lowMidi: number;
  highMidi: number;
}

/**
 * Higher-or-Lower difficulty ladder. Pure data: the game reads its current
 * level's config and never hardcodes a gap or range itself.
 */
export const HIGHER_LOWER_LEVELS: HigherLowerLevelConfig[] = [
  { level: 1, gapSemitones: 12, lowMidi: 60, highMidi: 77 }, // octave, C4-F5 (wide enough for real variety)
  { level: 2, gapSemitones: 7, lowMidi: 60, highMidi: 74 }, // fifth
  { level: 3, gapSemitones: 4, lowMidi: 48, highMidi: 72 }, // major third, wider register
  { level: 4, gapSemitones: 2, lowMidi: 48, highMidi: 72 }, // whole tone
  { level: 5, gapSemitones: 1, lowMidi: 36, highMidi: 84 }, // semitone, full range
];

export const MAX_LEVEL = HIGHER_LOWER_LEVELS.length;

export function levelConfig(level: number): HigherLowerLevelConfig {
  const clamped = Math.min(Math.max(1, level), MAX_LEVEL);
  return HIGHER_LOWER_LEVELS[clamped - 1];
}

export interface PitchMatchLevelConfig {
  level: number;
  toleranceCents: number;
  timeLimitMs: number;
}

/**
 * Pitch Match difficulty ladder. Targets are always drawn from the user's
 * full calibrated range (M6) at every level — v1 doesn't restrict the target
 * *pool* size per level, only tolerance and time limit, since those are the
 * primary skill levers and pool-size variety is a refinement, not core.
 */
export const PITCH_MATCH_LEVELS: PitchMatchLevelConfig[] = [
  { level: 1, toleranceCents: 50, timeLimitMs: 8000 },
  { level: 2, toleranceCents: 35, timeLimitMs: 8000 },
  { level: 3, toleranceCents: 25, timeLimitMs: 6000 },
  { level: 4, toleranceCents: 15, timeLimitMs: 5000 },
  { level: 5, toleranceCents: 10, timeLimitMs: 4000 },
];

export const PITCH_MATCH_MAX_LEVEL = PITCH_MATCH_LEVELS.length;

export function pitchMatchLevelConfig(level: number): PitchMatchLevelConfig {
  const clamped = Math.min(Math.max(1, level), PITCH_MATCH_MAX_LEVEL);
  return PITCH_MATCH_LEVELS[clamped - 1];
}

export interface HoldPitchLevelConfig {
  level: number;
  toleranceCents: number;
  durationMs: number;
}

/**
 * Hold the Pitch difficulty ladder. Like Pitch Match, targets are drawn
 * from the user's full calibrated range at every level — only tolerance and
 * required duration tighten with level.
 */
export const HOLD_PITCH_LEVELS: HoldPitchLevelConfig[] = [
  { level: 1, toleranceCents: 50, durationMs: 3000 },
  { level: 2, toleranceCents: 35, durationMs: 5000 },
  { level: 3, toleranceCents: 25, durationMs: 7000 },
  { level: 4, toleranceCents: 20, durationMs: 10000 },
  { level: 5, toleranceCents: 15, durationMs: 12000 },
];

export const HOLD_PITCH_MAX_LEVEL = HOLD_PITCH_LEVELS.length;

export function holdPitchLevelConfig(level: number): HoldPitchLevelConfig {
  const clamped = Math.min(Math.max(1, level), HOLD_PITCH_MAX_LEVEL);
  return HOLD_PITCH_LEVELS[clamped - 1];
}

export interface IntervalDetectiveLevelConfig {
  level: number;
  semitoneChoices: number[];
  directions: IntervalDirection[];
  lowMidi: number;
  highMidi: number;
}

/**
 * Interval Detective difficulty ladder. Early levels use widely-spaced,
 * easily-contrasted intervals in one direction; later levels add descending
 * and harmonic (played-together) modes and close intervals (m2 vs M2) that
 * are hard to tell apart even for trained ears.
 */
export const INTERVAL_DETECTIVE_LEVELS: IntervalDetectiveLevelConfig[] = [
  { level: 1, semitoneChoices: [0, 7, 12], directions: ["ascending"], lowMidi: 60, highMidi: 77 },
  { level: 2, semitoneChoices: [0, 5, 7, 12], directions: ["ascending", "descending"], lowMidi: 60, highMidi: 77 },
  { level: 3, semitoneChoices: [0, 4, 5, 7, 9, 12], directions: ["ascending", "descending", "harmonic"], lowMidi: 55, highMidi: 79 },
  { level: 4, semitoneChoices: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12], directions: ["ascending", "descending", "harmonic"], lowMidi: 48, highMidi: 84 },
  { level: 5, semitoneChoices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], directions: ["ascending", "descending", "harmonic"], lowMidi: 48, highMidi: 84 },
];

export const INTERVAL_DETECTIVE_MAX_LEVEL = INTERVAL_DETECTIVE_LEVELS.length;

export function intervalDetectiveLevelConfig(level: number): IntervalDetectiveLevelConfig {
  const clamped = Math.min(Math.max(1, level), INTERVAL_DETECTIVE_MAX_LEVEL);
  return INTERVAL_DETECTIVE_LEVELS[clamped - 1];
}

export interface NoteMemoryLevelConfig {
  level: number;
  sequenceLength: number;
  lowMidi: number;
  highMidi: number;
}

/** Note Memory difficulty ladder. Sequence length and the note pool both grow with level. */
export const NOTE_MEMORY_LEVELS: NoteMemoryLevelConfig[] = [
  { level: 1, sequenceLength: 3, lowMidi: 60, highMidi: 67 },
  { level: 2, sequenceLength: 4, lowMidi: 60, highMidi: 69 },
  { level: 3, sequenceLength: 5, lowMidi: 57, highMidi: 72 },
  { level: 4, sequenceLength: 6, lowMidi: 55, highMidi: 74 },
  { level: 5, sequenceLength: 7, lowMidi: 53, highMidi: 76 },
];

export const NOTE_MEMORY_MAX_LEVEL = NOTE_MEMORY_LEVELS.length;

export function noteMemoryLevelConfig(level: number): NoteMemoryLevelConfig {
  const clamped = Math.min(Math.max(1, level), NOTE_MEMORY_MAX_LEVEL);
  return NOTE_MEMORY_LEVELS[clamped - 1];
}

export interface SingScaleLevelConfig {
  level: number;
  toleranceCents: number;
  includeDescending: boolean;
}

/** Sing the Scale difficulty ladder. Tolerance narrows and higher levels add the descending pass back down. */
export const SING_SCALE_LEVELS: SingScaleLevelConfig[] = [
  { level: 1, toleranceCents: 50, includeDescending: false },
  { level: 2, toleranceCents: 40, includeDescending: false },
  { level: 3, toleranceCents: 30, includeDescending: true },
  { level: 4, toleranceCents: 20, includeDescending: true },
  { level: 5, toleranceCents: 15, includeDescending: true },
];

export const SING_SCALE_MAX_LEVEL = SING_SCALE_LEVELS.length;

export function singScaleLevelConfig(level: number): SingScaleLevelConfig {
  const clamped = Math.min(Math.max(1, level), SING_SCALE_MAX_LEVEL);
  return SING_SCALE_LEVELS[clamped - 1];
}

// Exported for display only ("2/3 correct to level up") — not a behavior change.
export const PROMOTE_AFTER_STREAK = 3;
const DEMOTE_AFTER_MISSES = 2;

export interface DifficultyState {
  level: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
}

export function initialDifficultyState(): DifficultyState {
  return { level: 1, consecutiveCorrect: 0, consecutiveWrong: 0 };
}

/**
 * Advance the difficulty state machine by one round's result. `maxLevel`
 * lets each game reuse this same promote/demote machine with its own
 * ladder length instead of being tied to Higher-or-Lower's.
 */
export function nextDifficultyState(
  state: DifficultyState,
  correct: boolean,
  maxLevel: number = MAX_LEVEL,
): DifficultyState {
  if (correct) {
    const consecutiveCorrect = state.consecutiveCorrect + 1;
    if (consecutiveCorrect >= PROMOTE_AFTER_STREAK) {
      return {
        level: Math.min(state.level + 1, maxLevel),
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
      };
    }
    return { ...state, consecutiveCorrect, consecutiveWrong: 0 };
  }

  const consecutiveWrong = state.consecutiveWrong + 1;
  if (consecutiveWrong >= DEMOTE_AFTER_MISSES) {
    return {
      level: Math.max(state.level - 1, 1),
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    };
  }
  return { ...state, consecutiveWrong, consecutiveCorrect: 0 };
}
