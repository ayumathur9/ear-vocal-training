export const MAX_STREAK_MULTIPLIER = 5;
export const BASE_POINTS_PER_ROUND = 10;

export interface SessionState {
  score: number;
  streak: number;
  bestStreak: number;
  round: number;
}

export function initialSessionState(): SessionState {
  return { score: 0, streak: 0, bestStreak: 0, round: 0 };
}

/** Apply the result of one round to a session, returning a new state (does not mutate). */
export function applyRoundResult(state: SessionState, correct: boolean, level: number): SessionState {
  const round = state.round + 1;

  if (!correct) {
    return { ...state, streak: 0, round };
  }

  const streak = state.streak + 1;
  const multiplier = Math.min(1 + Math.floor(streak / 3), MAX_STREAK_MULTIPLIER);
  const points = (BASE_POINTS_PER_ROUND + level) * multiplier;

  return {
    score: state.score + points,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    round,
  };
}

/**
 * Pitch accuracy percentage from a signed/unsigned cents deviation.
 * 0 cents -> 100%, 200 cents (two semitones) or more -> 0%.
 * This span is fixed by the reference example (437 Hz vs 440 Hz target -> 94%);
 * how many cents counts as a *pass* is a separate, configurable difficulty concern.
 */
export function pitchAccuracy(centsOff: number): number {
  const abs = Math.abs(centsOff);
  return Math.max(0, 100 * (1 - abs / 200));
}

export function isWithinTolerance(centsOff: number, toleranceCents: number): boolean {
  return Math.abs(centsOff) <= toleranceCents;
}
