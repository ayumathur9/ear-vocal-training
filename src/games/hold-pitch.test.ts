import { describe, it, expect } from "vitest";
import { createGame, startRound, submitAttempt, PASS_STABILITY_THRESHOLD } from "./hold-pitch.ts";
import { midiToHz } from "../core/notes.ts";

const SAFE_RANGE = { lowMidi: 60, highMidi: 72 };

describe("hold-pitch state machine", () => {
  it("starts a round with a target inside the safe range", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    expect(game.round).not.toBeNull();
    expect(game.round!.targetMidi).toBeGreaterThanOrEqual(60);
    expect(game.round!.targetMidi).toBeLessThanOrEqual(72);
    expect(game.round!.targetHz).toBeCloseTo(midiToHz(game.round!.targetMidi), 6);
  });

  it("level 1's tolerance and duration match the difficulty ladder", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    expect(game.round!.toleranceCents).toBe(50);
    expect(game.round!.durationMs).toBe(3000);
  });
});

describe("submitAttempt", () => {
  it("counts a high-stability attempt as correct and increases score/streak", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, { timeHeldMs: 3000, stabilityPercent: 95, score: 95 });
    expect(result.session.score).toBeGreaterThan(0);
    expect(result.session.streak).toBe(1);
  });

  it("counts a low-stability attempt as incorrect and resets streak", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const result = submitAttempt(game, { timeHeldMs: 3000, stabilityPercent: 20, score: 20 });
    expect(result.session.streak).toBe(0);
  });

  it("uses PASS_STABILITY_THRESHOLD as the correct/incorrect boundary", () => {
    const game = startRound(createGame(1), SAFE_RANGE);
    const atThreshold = submitAttempt(game, {
      timeHeldMs: 3000,
      stabilityPercent: PASS_STABILITY_THRESHOLD,
      score: PASS_STABILITY_THRESHOLD,
    });
    expect(atThreshold.session.streak).toBe(1); // >= threshold counts as correct

    const belowThreshold = submitAttempt(game, {
      timeHeldMs: 3000,
      stabilityPercent: PASS_STABILITY_THRESHOLD - 1,
      score: PASS_STABILITY_THRESHOLD - 1,
    });
    expect(belowThreshold.session.streak).toBe(0);
  });

  it("promotes difficulty after 3 correct attempts in a row", () => {
    let game = startRound(createGame(1), SAFE_RANGE);
    for (let i = 0; i < 3; i++) {
      game = submitAttempt(game, { timeHeldMs: 3000, stabilityPercent: 90, score: 90 });
    }
    expect(game.difficulty.level).toBe(2);
  });

  it("never promotes past the Hold the Pitch ladder's top level", () => {
    let game = startRound(createGame(1), SAFE_RANGE);
    for (let i = 0; i < 50; i++) {
      game = submitAttempt(game, { timeHeldMs: 3000, stabilityPercent: 90, score: 90 });
    }
    expect(game.difficulty.level).toBe(5); // HOLD_PITCH_MAX_LEVEL
  });
});
