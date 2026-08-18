import { describe, it, expect } from "vitest";
import { initialSessionState, applyRoundResult, pitchAccuracy, isWithinTolerance } from "./scoring.ts";

describe("applyRoundResult", () => {
  it("increments round and resets streak on a miss", () => {
    const s = applyRoundResult({ score: 50, streak: 4, bestStreak: 4, round: 5 }, false, 1);
    expect(s).toEqual({ score: 50, streak: 0, bestStreak: 4, round: 6 });
  });

  it("increments streak and score on a hit", () => {
    const s = applyRoundResult(initialSessionState(), true, 1);
    expect(s.streak).toBe(1);
    expect(s.round).toBe(1);
    expect(s.score).toBeGreaterThan(0);
  });

  it("tracks bestStreak independently of current streak", () => {
    let s = initialSessionState();
    s = applyRoundResult(s, true, 1);
    s = applyRoundResult(s, true, 1);
    s = applyRoundResult(s, false, 1);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
  });

  it("caps the streak multiplier", () => {
    let s = initialSessionState();
    for (let i = 0; i < 30; i++) s = applyRoundResult(s, true, 1);
    // multiplier caps at 5x; score growth per round should plateau, not keep climbing.
    const before = s.score;
    s = applyRoundResult(s, true, 1);
    const after = s.score;
    const lastGain = after - before;
    expect(lastGain).toBe((10 + 1) * 5);
  });

  it("does not mutate the input state", () => {
    const original = initialSessionState();
    const copy = { ...original };
    applyRoundResult(original, true, 1);
    expect(original).toEqual(copy);
  });
});

describe("pitchAccuracy", () => {
  it("matches the BRD worked example: 437 Hz vs 440 Hz target -> ~94%", () => {
    const centsOff = 1200 * Math.log2(437 / 440);
    expect(pitchAccuracy(centsOff)).toBeCloseTo(94, 0);
  });

  it("is 100% for a perfect match", () => {
    expect(pitchAccuracy(0)).toBe(100);
  });

  it("is 0% at 200 cents or beyond", () => {
    expect(pitchAccuracy(200)).toBe(0);
    expect(pitchAccuracy(500)).toBe(0);
  });

  it("treats sharp and flat symmetrically", () => {
    expect(pitchAccuracy(30)).toBeCloseTo(pitchAccuracy(-30), 6);
  });
});

describe("isWithinTolerance", () => {
  it("passes exactly at the boundary", () => {
    expect(isWithinTolerance(50, 50)).toBe(true);
    expect(isWithinTolerance(-50, 50)).toBe(true);
  });

  it("fails just outside the boundary", () => {
    expect(isWithinTolerance(50.1, 50)).toBe(false);
  });
});
