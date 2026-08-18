import { describe, it, expect } from "vitest";
import { createGame, startRound, evaluateAttempt, submitAttempt, type PitchMatchRound } from "./pitch-match.ts";
import { midiToHz } from "../core/notes.ts";

const SAFE_RANGE = { lowMidi: 60, highMidi: 72 };

describe("pitch-match state machine", () => {
  it("starts a round with a target inside the safe range", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    expect(game.round).not.toBeNull();
    expect(game.round!.targetMidi).toBeGreaterThanOrEqual(60);
    expect(game.round!.targetMidi).toBeLessThanOrEqual(72);
    expect(game.round!.targetHz).toBeCloseTo(midiToHz(game.round!.targetMidi), 6);
  });

  it("level 1's tolerance is 50 cents", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    expect(game.round!.toleranceCents).toBe(50);
  });
});

describe("evaluateAttempt", () => {
  const round: PitchMatchRound = { targetMidi: 69, targetHz: 440, toleranceCents: 50, timeLimitMs: 8000 };

  it("matches the BRD worked example: 437 Hz sung against a 440 Hz target -> ~94% and correct", () => {
    const evaluation = evaluateAttempt(round, 437);
    expect(evaluation.accuracy).toBeCloseTo(94, 0);
    expect(evaluation.correct).toBe(true);
  });

  it("is incorrect when outside the level's tolerance", () => {
    const evaluation = evaluateAttempt(round, 400); // way flat
    expect(evaluation.correct).toBe(false);
  });

  it("treats a timeout (null detected pitch) as incorrect with 0% accuracy", () => {
    const evaluation = evaluateAttempt(round, null);
    expect(evaluation.correct).toBe(false);
    expect(evaluation.accuracy).toBe(0);
  });

  it("is correct just inside the tolerance boundary", () => {
    // 49 cents flat of 440 Hz — just inside the 50-cent tolerance, no floating-point edge risk
    const nearBoundaryHz = 440 * 2 ** (-49 / 1200);
    const evaluation = evaluateAttempt(round, nearBoundaryHz);
    expect(evaluation.correct).toBe(true);
  });

  it("is incorrect just outside the tolerance boundary", () => {
    const justOutsideHz = 440 * 2 ** (-51 / 1200);
    const evaluation = evaluateAttempt(round, justOutsideHz);
    expect(evaluation.correct).toBe(false);
  });
});

describe("submitAttempt", () => {
  it("increases score and streak on a correct attempt", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, { correct: true, centsOff: 5, accuracy: 98 });
    expect(result.session.score).toBeGreaterThan(0);
    expect(result.session.streak).toBe(1);
  });

  it("resets streak on an incorrect attempt", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, { correct: false, centsOff: 300, accuracy: 0 });
    expect(result.session.streak).toBe(0);
  });

  it("promotes difficulty after 3 correct attempts in a row", () => {
    let game = startRound(createGame(1), SAFE_RANGE);
    for (let i = 0; i < 3; i++) {
      game = submitAttempt(game, { correct: true, centsOff: 5, accuracy: 98 });
    }
    expect(game.difficulty.level).toBe(2);
  });

  it("never promotes past the Pitch Match ladder's top level", () => {
    let game = startRound(createGame(1), SAFE_RANGE);
    for (let i = 0; i < 50; i++) {
      game = submitAttempt(game, { correct: true, centsOff: 5, accuracy: 98 });
    }
    expect(game.difficulty.level).toBe(5); // PITCH_MATCH_MAX_LEVEL
  });
});
