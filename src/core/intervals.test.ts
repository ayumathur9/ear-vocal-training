import { describe, it, expect } from "vitest";
import { intervalName, randomIntervalQuestion } from "./intervals.ts";

describe("intervalName", () => {
  it("names every semitone distance 0-12", () => {
    expect(intervalName(0).short).toBe("P1");
    expect(intervalName(7).short).toBe("P5");
    expect(intervalName(12).short).toBe("P8");
  });

  it("treats negative distances the same as positive (interval size, not direction)", () => {
    expect(intervalName(-7)).toEqual(intervalName(7));
  });

  it("clamps beyond an octave down to the octave entry", () => {
    expect(intervalName(20).short).toBe("P8");
  });
});

describe("randomIntervalQuestion", () => {
  it("places the target above the root when ascending", () => {
    const q = randomIntervalQuestion(60, 72, [4], "ascending");
    expect(q.targetMidi).toBe(q.rootMidi + 4);
    expect(q.semitones).toBe(4);
  });

  it("places the target below the root when descending", () => {
    const q = randomIntervalQuestion(60, 72, [4], "descending");
    expect(q.targetMidi).toBe(q.rootMidi - 4);
  });

  it("keeps both notes inside the given range for many draws", () => {
    for (let i = 0; i < 50; i++) {
      const q = randomIntervalQuestion(60, 72, [0, 4, 7, 12], "ascending", Math.random);
      expect(q.rootMidi).toBeGreaterThanOrEqual(60);
      expect(q.targetMidi).toBeLessThanOrEqual(72);
    }
  });

  it("throws when the range is too narrow for the requested interval", () => {
    expect(() => randomIntervalQuestion(60, 61, [12], "ascending")).toThrow();
  });
});
