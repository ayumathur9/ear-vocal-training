import { describe, it, expect } from "vitest";
import { generateSequence, gradeAttempt } from "./note-memory.ts";

describe("generateSequence", () => {
  it("produces exactly `length` notes, all inside the pool", () => {
    const { notesMidi, poolMidi } = generateSequence(60, 67, 5);
    expect(notesMidi).toHaveLength(5);
    for (const n of notesMidi) expect(poolMidi).toContain(n);
  });
});

describe("gradeAttempt", () => {
  it("marks an exact match correct", () => {
    expect(gradeAttempt([60, 62, 64], [60, 62, 64])).toEqual({ correct: true, firstWrongIndex: null });
  });

  it("finds the first wrong index", () => {
    expect(gradeAttempt([60, 62, 64], [60, 63, 64])).toEqual({ correct: false, firstWrongIndex: 1 });
  });

  it("marks a too-short guess wrong at the first missing index", () => {
    expect(gradeAttempt([60, 62, 64], [60, 62])).toEqual({ correct: false, firstWrongIndex: 2 });
  });

  it("marks a too-long guess wrong at the first extra index", () => {
    expect(gradeAttempt([60, 62], [60, 62, 64])).toEqual({ correct: false, firstWrongIndex: 2 });
  });
});
