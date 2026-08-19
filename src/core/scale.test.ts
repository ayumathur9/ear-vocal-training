import { describe, it, expect } from "vitest";
import { buildScaleTargets, pickScaleRoot } from "./scale.ts";

describe("buildScaleTargets", () => {
  it("builds 8 ascending notes spanning exactly one octave", () => {
    const targets = buildScaleTargets(60, false);
    expect(targets).toHaveLength(8);
    expect(targets[0]).toBe(60);
    expect(targets[targets.length - 1]).toBe(72);
  });

  it("appends the descending pass without repeating the top note", () => {
    const targets = buildScaleTargets(60, true);
    expect(targets).toHaveLength(15);
    expect(targets[7]).toBe(72); // top of the ascent
    expect(targets[8]).toBe(71); // descent starts one step below, not repeating 72
    expect(targets[targets.length - 1]).toBe(60); // ends back on the root
  });
});

describe("pickScaleRoot", () => {
  it("leaves room for a full octave above the root", () => {
    for (let i = 0; i < 20; i++) {
      const root = pickScaleRoot(48, 84, Math.random);
      expect(root + 12).toBeLessThanOrEqual(84);
      expect(root).toBeGreaterThanOrEqual(48);
    }
  });

  it("falls back to lowMidi when the range is too narrow for an octave", () => {
    expect(pickScaleRoot(60, 65)).toBe(60);
  });
});
