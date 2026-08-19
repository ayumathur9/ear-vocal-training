import { describe, it, expect } from "vitest";
import { createGame, startRound, evaluateRound, submitAttempt, PASS_STABILITY_THRESHOLD } from "./sing-scale.ts";

const SAFE_RANGE = { lowMidi: 48, highMidi: 84 };

describe("sing-scale state machine", () => {
  it("starts a round with an 8-note ascending scale at level 1 (no descending pass)", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    expect(game.round).not.toBeNull();
    expect(game.round!.targetsMidi).toHaveLength(8);
    expect(game.round!.toleranceCents).toBe(50);
  });

  it("includes the descending pass at a level configured for it", () => {
    const game = startRound(createGame(3), SAFE_RANGE);
    expect(game.round!.targetsMidi.length).toBe(15);
  });
});

describe("evaluateRound", () => {
  it("averages per-note stability into the overall score", () => {
    const result = evaluateRound([100, 50, 75]);
    expect(result.overallStability).toBeCloseTo(75, 5);
  });

  it("treats no sung notes as 0% and incorrect", () => {
    const result = evaluateRound([]);
    expect(result.overallStability).toBe(0);
    expect(result.correct).toBe(false);
  });

  it("uses PASS_STABILITY_THRESHOLD as the correct/incorrect boundary", () => {
    expect(evaluateRound([PASS_STABILITY_THRESHOLD]).correct).toBe(true);
    expect(evaluateRound([PASS_STABILITY_THRESHOLD - 1]).correct).toBe(false);
  });
});

describe("submitAttempt", () => {
  it("increases score and streak on a correct round", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, evaluateRound(Array(8).fill(90)));
    expect(result.session.score).toBeGreaterThan(0);
    expect(result.session.streak).toBe(1);
  });

  it("resets streak on an incorrect round", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, evaluateRound(Array(8).fill(20)));
    expect(result.session.streak).toBe(0);
  });

  it("promotes difficulty after 3 correct rounds in a row", () => {
    let game = startRound(createGame(1), SAFE_RANGE);
    for (let i = 0; i < 3; i++) {
      game = submitAttempt(game, evaluateRound(Array(8).fill(90)));
    }
    expect(game.difficulty.level).toBe(2);
  });
});
