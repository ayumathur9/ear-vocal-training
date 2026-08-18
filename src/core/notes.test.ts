import { describe, it, expect } from "vitest";
import {
  midiToHz,
  hzToMidi,
  nearestNote,
  midiToName,
  cents,
  midiRange,
  randomNotePair,
  safeMidiRangeFromHz,
} from "./notes.ts";

describe("midiToHz / hzToMidi", () => {
  it("A4 (MIDI 69) is exactly 440 Hz", () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
  });

  it("round-trips every MIDI note 0-127", () => {
    for (let m = 0; m <= 127; m++) {
      const hz = midiToHz(m);
      expect(hzToMidi(hz)).toBeCloseTo(m, 6);
    }
  });

  it("C4 (MIDI 60) is ~261.63 Hz", () => {
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it("one octave up doubles frequency", () => {
    const base = midiToHz(60);
    expect(midiToHz(72)).toBeCloseTo(base * 2, 6);
  });
});

describe("midiToName / nearestNote", () => {
  it("MIDI 69 is A4", () => {
    expect(midiToName(69)).toEqual({ midi: 69, name: "A", octave: 4 });
  });

  it("MIDI 60 is C4", () => {
    expect(midiToName(60)).toEqual({ midi: 60, name: "C", octave: 4 });
  });

  it("MIDI 0 is C-1", () => {
    expect(midiToName(0)).toEqual({ midi: 0, name: "C", octave: -1 });
  });

  it("snaps a slightly-off frequency to the nearest note", () => {
    const note = nearestNote(437); // sung flat of A4
    expect(note.name).toBe("A");
    expect(note.octave).toBe(4);
    expect(note.exactHz).toBeCloseTo(440, 6);
  });
});

describe("cents", () => {
  it("is 0 for an exact match", () => {
    expect(cents(440, 440)).toBeCloseTo(0, 6);
  });

  it("is negative (flat) when below target", () => {
    // matches the BRD worked example: 437 Hz vs 440 Hz target
    expect(cents(437, 440)).toBeCloseTo(-11.84, 1);
  });

  it("is positive (sharp) when above target", () => {
    expect(cents(443, 440)).toBeGreaterThan(0);
  });

  it("is exactly 1200 for one octave up", () => {
    expect(cents(880, 440)).toBeCloseTo(1200, 6);
  });

  it("is exactly -1200 for one octave down", () => {
    expect(cents(220, 440)).toBeCloseTo(-1200, 6);
  });
});

describe("midiRange", () => {
  it("includes both bounds", () => {
    expect(midiRange(60, 64)).toEqual([60, 61, 62, 63, 64]);
  });

  it("works with bounds reversed", () => {
    expect(midiRange(64, 60)).toEqual([60, 61, 62, 63, 64]);
  });
});

describe("safeMidiRangeFromHz", () => {
  it("insets both ends by the given number of semitones", () => {
    const lowMidi = Math.round(hzToMidi(130.81)); // C3
    const highMidi = Math.round(hzToMidi(523.25)); // C5
    const result = safeMidiRangeFromHz(130.81, 523.25, 2);
    expect(result.lowMidi).toBe(lowMidi + 2);
    expect(result.highMidi).toBe(highMidi - 2);
  });

  it("splits the difference instead of inverting when the range is too narrow for the inset", () => {
    // a 2-semitone-wide range with a 2-semitone inset on each side would invert
    const result = safeMidiRangeFromHz(220, 246.94, 2); // A3 to B3
    expect(result.lowMidi).toBeLessThanOrEqual(result.highMidi);
  });
});

describe("randomNotePair", () => {
  it("always returns notes at least minGap apart, order randomized", () => {
    let sawLowFirst = false;
    let sawHighFirst = false;

    for (let i = 0; i < 200; i++) {
      const [a, b] = randomNotePair(60, 72, 7);
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(7);
      expect(a).toBeGreaterThanOrEqual(60);
      expect(b).toBeGreaterThanOrEqual(60);
      expect(a).toBeLessThanOrEqual(72);
      expect(b).toBeLessThanOrEqual(72);
      if (a < b) sawLowFirst = true;
      if (a > b) sawHighFirst = true;
    }

    expect(sawLowFirst).toBe(true);
    expect(sawHighFirst).toBe(true);
  });

  it("throws when the range is narrower than the requested gap", () => {
    expect(() => randomNotePair(60, 64, 12)).toThrow();
  });

  it("is deterministic when given a seeded rng", () => {
    const seq = [0.1, 0.9, 0.4];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const pair1 = randomNotePair(60, 72, 4, rng);
    i = 0;
    const pair2 = randomNotePair(60, 72, 4, rng);
    expect(pair1).toEqual(pair2);
  });
});
