import { describe, it, expect } from "vitest";
import {
  initialDifficultyState,
  nextDifficultyState,
  levelConfig,
  MAX_LEVEL,
  pitchMatchLevelConfig,
  PITCH_MATCH_MAX_LEVEL,
  holdPitchLevelConfig,
  HOLD_PITCH_MAX_LEVEL,
} from "./difficulty.ts";

describe("nextDifficultyState", () => {
  it("promotes after 3 consecutive correct", () => {
    let s = initialDifficultyState();
    s = nextDifficultyState(s, true);
    s = nextDifficultyState(s, true);
    expect(s.level).toBe(1);
    s = nextDifficultyState(s, true);
    expect(s.level).toBe(2);
    expect(s.consecutiveCorrect).toBe(0);
  });

  it("demotes after 2 consecutive wrong", () => {
    let s = { level: 3, consecutiveCorrect: 0, consecutiveWrong: 0 };
    s = nextDifficultyState(s, false);
    expect(s.level).toBe(3);
    s = nextDifficultyState(s, false);
    expect(s.level).toBe(2);
  });

  it("never drops below level 1", () => {
    let s = initialDifficultyState();
    for (let i = 0; i < 10; i++) s = nextDifficultyState(s, false);
    expect(s.level).toBe(1);
  });

  it("never exceeds MAX_LEVEL", () => {
    let s = initialDifficultyState();
    for (let i = 0; i < 100; i++) s = nextDifficultyState(s, true);
    expect(s.level).toBe(MAX_LEVEL);
  });

  it("a correct answer resets the wrong-streak counter", () => {
    let s = nextDifficultyState(initialDifficultyState(), false);
    expect(s.consecutiveWrong).toBe(1);
    s = nextDifficultyState(s, true);
    expect(s.consecutiveWrong).toBe(0);
  });
});

describe("levelConfig", () => {
  it("clamps below level 1 up to level 1", () => {
    expect(levelConfig(0).level).toBe(1);
    expect(levelConfig(-5).level).toBe(1);
  });

  it("clamps above MAX_LEVEL down to MAX_LEVEL", () => {
    expect(levelConfig(999).level).toBe(MAX_LEVEL);
  });

  it("gap narrows as level increases", () => {
    const gaps = Array.from({ length: MAX_LEVEL }, (_, i) => levelConfig(i + 1).gapSemitones);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    }
  });
});

describe("nextDifficultyState — custom maxLevel (Pitch Match reuses the same machine)", () => {
  it("caps promotion at the given maxLevel, independent of Higher-or-Lower's MAX_LEVEL", () => {
    let s = initialDifficultyState();
    for (let i = 0; i < 100; i++) s = nextDifficultyState(s, true, PITCH_MATCH_MAX_LEVEL);
    expect(s.level).toBe(PITCH_MATCH_MAX_LEVEL);
  });
});

describe("pitchMatchLevelConfig", () => {
  it("clamps below level 1 up to level 1", () => {
    expect(pitchMatchLevelConfig(0).level).toBe(1);
  });

  it("clamps above PITCH_MATCH_MAX_LEVEL down to it", () => {
    expect(pitchMatchLevelConfig(999).level).toBe(PITCH_MATCH_MAX_LEVEL);
  });

  it("tolerance narrows and time limit shortens as level increases", () => {
    const configs = Array.from({ length: PITCH_MATCH_MAX_LEVEL }, (_, i) => pitchMatchLevelConfig(i + 1));
    for (let i = 1; i < configs.length; i++) {
      expect(configs[i].toleranceCents).toBeLessThan(configs[i - 1].toleranceCents);
      expect(configs[i].timeLimitMs).toBeLessThanOrEqual(configs[i - 1].timeLimitMs);
    }
  });
});

describe("holdPitchLevelConfig", () => {
  it("clamps below level 1 up to level 1", () => {
    expect(holdPitchLevelConfig(0).level).toBe(1);
  });

  it("clamps above HOLD_PITCH_MAX_LEVEL down to it", () => {
    expect(holdPitchLevelConfig(999).level).toBe(HOLD_PITCH_MAX_LEVEL);
  });

  it("tolerance narrows and required duration lengthens as level increases", () => {
    const configs = Array.from({ length: HOLD_PITCH_MAX_LEVEL }, (_, i) => holdPitchLevelConfig(i + 1));
    for (let i = 1; i < configs.length; i++) {
      expect(configs[i].toleranceCents).toBeLessThan(configs[i - 1].toleranceCents);
      expect(configs[i].durationMs).toBeGreaterThan(configs[i - 1].durationMs);
    }
  });
});
