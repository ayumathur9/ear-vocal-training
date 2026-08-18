import { describe, it, expect, beforeEach } from "vitest";
import { PitchStabilizer } from "./smoothing.ts";

function voiced(hz: number, confidence = 1, rms = 0.3) {
  return { hz, confidence, rms };
}

describe("PitchStabilizer — gating", () => {
  let stabilizer: PitchStabilizer;
  beforeEach(() => {
    stabilizer = new PitchStabilizer();
  });

  it("reports silent when hz is null", () => {
    expect(stabilizer.push({ hz: null, confidence: 0, rms: 0 })).toEqual({ state: "silent" });
  });

  it("reports silent below the confidence threshold, even with a plausible hz", () => {
    expect(stabilizer.push(voiced(220, 0.5))).toEqual({ state: "silent" });
  });

  it("reports silent below the RMS (silence) threshold, even with high confidence", () => {
    expect(stabilizer.push(voiced(220, 1, 0.0001))).toEqual({ state: "silent" });
  });

  it("never returns a guessed frequency for a gated-out frame", () => {
    stabilizer.push(voiced(220));
    stabilizer.push(voiced(220));
    const result = stabilizer.push(voiced(220, 0.1)); // confidence collapses mid-stream
    expect(result.state).toBe("silent");
  });
});

describe("PitchStabilizer — median smoothing", () => {
  it("smooths a stable pitch across small jitter", () => {
    const s = new PitchStabilizer();
    const jitter = [219, 221, 220, 218, 222];
    let last;
    for (const hz of jitter) last = s.push(voiced(hz));
    expect(last!.state).toBe("voiced");
    expect((last as any).hz).toBeGreaterThan(218);
    expect((last as any).hz).toBeLessThan(222);
  });
});

describe("PitchStabilizer — octave-jump repair", () => {
  it("folds a half-pitch outlier back up to the established octave", () => {
    const s = new PitchStabilizer();
    for (let i = 0; i < 5; i++) s.push(voiced(220)); // establish a stable A3 reference
    const result = s.push(voiced(110)); // YIN reports the sub-octave once
    expect(result.state).toBe("voiced");
    expect((result as any).hz).toBeGreaterThan(200); // repaired back near 220, not left at 110
  });

  it("folds a double-pitch outlier back down to the established octave", () => {
    const s = new PitchStabilizer();
    for (let i = 0; i < 5; i++) s.push(voiced(220));
    const result = s.push(voiced(440));
    expect(result.state).toBe("voiced");
    expect((result as any).hz).toBeLessThan(260); // repaired back near 220, not left at 440
  });

  it("does not force-correct a genuine, non-octave pitch change", () => {
    const s = new PitchStabilizer();
    for (let i = 0; i < 5; i++) s.push(voiced(220));
    // A3 (220) -> B3 (~247) is a real whole-step change, not an octave error.
    let last;
    for (let i = 0; i < 5; i++) last = s.push(voiced(247));
    expect((last as any).hz).toBeGreaterThan(230);
    expect((last as any).hz).toBeLessThan(250);
  });

  it("does not carry a stale octave reference across a silent gap", () => {
    const s = new PitchStabilizer();
    for (let i = 0; i < 5; i++) s.push(voiced(220));
    s.push({ hz: null, confidence: 0, rms: 0 }); // silence resets history
    // A fresh, unrelated pitch should be accepted as-is, not "repaired" against the old 220 anchor.
    const result = s.push(voiced(110));
    expect(result.state).toBe("voiced");
    expect((result as any).hz).toBeCloseTo(110, 0);
  });
});

describe("PitchStabilizer — reset()", () => {
  it("clears history so the next frame starts fresh", () => {
    const s = new PitchStabilizer();
    for (let i = 0; i < 5; i++) s.push(voiced(220));
    s.reset();
    const result = s.push(voiced(110));
    expect((result as any).hz).toBeCloseTo(110, 0);
  });
});
