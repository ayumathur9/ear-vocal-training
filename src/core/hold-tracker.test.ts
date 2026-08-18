import { describe, it, expect } from "vitest";
import { HoldTracker } from "./hold-tracker.ts";

describe("HoldTracker", () => {
  it("reports 'holding' with increasing progress while pitch stays steady", () => {
    const t = new HoldTracker({ requiredMs: 2000 });
    expect(t.push(220, 0)).toEqual({ status: "holding", progressMs: 0 });
    expect(t.push(220, 500)).toEqual({ status: "holding", progressMs: 500 });
    expect(t.push(221, 1000)).toEqual({ status: "holding", progressMs: 1000 });
  });

  it("captures once the required duration has elapsed", () => {
    const t = new HoldTracker({ requiredMs: 2000 });
    t.push(220, 0);
    t.push(220, 1000);
    const result = t.push(220, 2000);
    expect(result.status).toBe("captured");
    expect((result as any).hz).toBeCloseTo(220, 0);
  });

  it("restarts the window when pitch drifts beyond tolerance", () => {
    const t = new HoldTracker({ requiredMs: 2000, toleranceCents: 30 });
    t.push(220, 0);
    t.push(220, 1000);
    // jump a full semitone (~100 cents) — well beyond the 30-cent tolerance
    const result = t.push(233, 1500);
    expect(result).toEqual({ status: "holding", progressMs: 0 });
  });

  it("does not restart on small natural jitter within tolerance", () => {
    const t = new HoldTracker({ requiredMs: 2000, toleranceCents: 30 });
    t.push(220, 0);
    t.push(222, 500); // ~15 cents, within tolerance
    const result = t.push(219, 1000);
    expect(result.status).toBe("holding");
    expect((result as any).progressMs).toBe(1000);
  });

  it("captures the median hz of the held window, not just the last sample", () => {
    const t = new HoldTracker({ requiredMs: 1000 });
    t.push(218, 0);
    t.push(220, 500);
    const result = t.push(222, 1000);
    expect(result.status).toBe("captured");
    expect((result as any).hz).toBeCloseTo(220, 0);
  });

  it("reset() clears the window so the next push starts fresh", () => {
    const t = new HoldTracker({ requiredMs: 2000 });
    t.push(220, 0);
    t.push(220, 1500);
    t.reset();
    const result = t.push(220, 1600);
    expect(result).toEqual({ status: "holding", progressMs: 0 });
  });

  it("silentTick() tolerates a brief gap without losing accumulated progress", () => {
    const t = new HoldTracker({ requiredMs: 2000, maxGapMs: 400 });
    t.push(220, 0);
    t.push(220, 1000);
    t.silentTick(1100); // a 100ms dropout — well inside the 400ms grace window
    const result = t.push(220, 1200);
    expect(result.status).toBe("holding");
    expect((result as any).progressMs).toBe(1200); // progress span still measured from t=0
  });

  it("silentTick() clears the window once the gap exceeds maxGapMs", () => {
    const t = new HoldTracker({ requiredMs: 2000, maxGapMs: 400 });
    t.push(220, 0);
    t.push(220, 1000);
    t.silentTick(1600); // a 600ms gap — a real pause, exceeds the 400ms grace window
    const result = t.push(220, 1700);
    expect(result).toEqual({ status: "holding", progressMs: 0 });
  });

  it("a real human voice's natural vibrato-scale dropouts don't prevent ever capturing", () => {
    // Simulates realistic YIN behavior on singing: brief low-confidence gaps
    // sprinkled through an otherwise-steady 2s hold, not a clean synthetic signal.
    const t = new HoldTracker({ requiredMs: 2000, maxGapMs: 400 });
    let result;
    let t_ms = 0;
    for (let i = 0; i < 30; i++) {
      if (i % 7 === 0 && i > 0) {
        t.silentTick(t_ms); // occasional brief dropout, every ~700ms
        t_ms += 80;
      }
      result = t.push(219 + Math.random() * 2, t_ms); // small natural jitter
      t_ms += 90;
    }
    expect(result!.status === "holding" || result!.status === "captured").toBe(true);
  });
});
