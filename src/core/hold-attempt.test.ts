import { describe, it, expect } from "vitest";
import { HoldAttemptTracker } from "./hold-attempt.ts";

describe("HoldAttemptTracker — basic accumulation", () => {
  it("reports 'recording' with increasing elapsed time while voiced", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000 });
    expect(t.pushVoiced(220, 0)).toEqual({ status: "recording", elapsedMs: 0 });
    expect(t.pushVoiced(220, 500)).toEqual({ status: "recording", elapsedMs: 500 });
  });

  it("completes once requiredMs of voiced time has elapsed", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 1000 });
    t.pushVoiced(220, 0);
    const result = t.pushVoiced(220, 1000);
    expect(result.status).toBe("complete");
  });
});

describe("HoldAttemptTracker — stability scoring", () => {
  it("scores a perfectly on-target, zero-drift hold near 100", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 1000 });
    for (let ms = 0; ms < 1000; ms += 100) t.pushVoiced(220, ms);
    const result = t.pushVoiced(220, 1000) as any;
    expect(result.status).toBe("complete");
    expect(result.result.stabilityPercent).toBeGreaterThan(95);
  });

  it("scores a consistently off-target hold near 0, even though voicing was continuous", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 20, requiredMs: 1000 });
    // consistently a full semitone (100 cents) sharp of target — outside tolerance every frame
    const sharpHz = 220 * 2 ** (100 / 1200);
    for (let ms = 0; ms < 1000; ms += 100) t.pushVoiced(sharpHz, ms);
    const result = t.pushVoiced(sharpHz, 1000) as any;
    expect(result.status).toBe("complete");
    expect(result.result.stabilityPercent).toBeLessThan(10);
  });

  it("penalizes drift (wobble) even when nominally centered on target", () => {
    const stable = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 80, requiredMs: 1000 });
    const wobbly = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 80, requiredMs: 1000 });
    let stableResult: any, wobblyResult: any;
    for (let ms = 0; ms <= 1000; ms += 50) {
      stableResult = stable.pushVoiced(220, ms);
      wobblyResult = wobbly.pushVoiced(ms % 100 === 0 ? 220 * 2 ** (60 / 1200) : 220 * 2 ** (-60 / 1200), ms);
    }
    expect(stableResult.result.stabilityPercent).toBeGreaterThan(wobblyResult.result.stabilityPercent);
  });
});

describe("HoldAttemptTracker — gap tolerance (the vibrato/breath lesson, applied from the start)", () => {
  it("tolerates a brief gap without discarding prior progress", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000, maxGapMs: 400 });
    t.pushVoiced(220, 0);
    t.pushVoiced(220, 500);
    t.pushSilent(700); // 200ms gap, within the 400ms grace window
    const result = t.pushVoiced(220, 900);
    expect(result.status).toBe("recording");
    expect((result as any).elapsedMs).toBe(900); // still measured from t=0
  });

  it("restarts the attempt after a gap exceeding maxGapMs", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000, maxGapMs: 400 });
    t.pushVoiced(220, 0);
    t.pushVoiced(220, 500);
    t.pushSilent(1200); // 700ms gap — a real pause
    const result = t.pushVoiced(220, 1300);
    expect(result).toEqual({ status: "recording", elapsedMs: 0 });
  });

  it("scores a realistic vibrato-laden hold well, not near zero", () => {
    // Simulates the exact failure class found in M6: natural vibrato sweeping
    // the pitch, not a clean synthetic tone. Should score highly, not fail.
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000 });
    let result: any;
    for (let ms = 0; ms <= 2000; ms += 20) {
      const vibratoCents = 40 * Math.sin((2 * Math.PI * 5.5 * ms) / 1000);
      const hz = 220 * 2 ** (vibratoCents / 1200);
      result = t.pushVoiced(hz, ms);
    }
    expect(result.status).toBe("complete");
    expect(result.result.stabilityPercent).toBeGreaterThan(50);
  });
});

describe("HoldAttemptTracker — forceFinalize", () => {
  it("returns null if nothing was ever recorded", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000 });
    expect(t.forceFinalize()).toBeNull();
  });

  it("scores whatever partial data exists when forced early", () => {
    const t = new HoldAttemptTracker({ targetHz: 220, toleranceCents: 50, requiredMs: 2000 });
    t.pushVoiced(220, 0);
    t.pushVoiced(220, 300);
    const result = t.forceFinalize();
    expect(result).not.toBeNull();
    expect(result!.timeHeldMs).toBe(300);
  });
});
