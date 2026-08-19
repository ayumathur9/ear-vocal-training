import { randomMidi } from "./notes.ts";

export type IntervalDirection = "ascending" | "descending" | "harmonic";

export interface IntervalName {
  semitones: number;
  short: string;
  name: string;
}

const INTERVAL_TABLE: IntervalName[] = [
  { semitones: 0, short: "P1", name: "Unison" },
  { semitones: 1, short: "m2", name: "Minor 2nd" },
  { semitones: 2, short: "M2", name: "Major 2nd" },
  { semitones: 3, short: "m3", name: "Minor 3rd" },
  { semitones: 4, short: "M3", name: "Major 3rd" },
  { semitones: 5, short: "P4", name: "Perfect 4th" },
  { semitones: 6, short: "TT", name: "Tritone" },
  { semitones: 7, short: "P5", name: "Perfect 5th" },
  { semitones: 8, short: "m6", name: "Minor 6th" },
  { semitones: 9, short: "M6", name: "Major 6th" },
  { semitones: 10, short: "m7", name: "Minor 7th" },
  { semitones: 11, short: "M7", name: "Major 7th" },
  { semitones: 12, short: "P8", name: "Octave" },
];

/** Looks up an interval's name by its distance in semitones (0-12). */
export function intervalName(semitones: number): IntervalName {
  const clamped = Math.min(Math.max(0, Math.round(Math.abs(semitones))), 12);
  return INTERVAL_TABLE[clamped];
}

export interface IntervalQuestion {
  rootMidi: number;
  targetMidi: number;
  semitones: number;
  direction: IntervalDirection;
}

/**
 * Picks a root note and a semitone distance from `semitoneChoices`, then
 * places the target above (ascending/harmonic) or below (descending) the
 * root, keeping both notes inside [lowMidi, highMidi].
 */
export function randomIntervalQuestion(
  lowMidi: number,
  highMidi: number,
  semitoneChoices: number[],
  direction: IntervalDirection,
  rng: () => number = Math.random,
): IntervalQuestion {
  const semitones = semitoneChoices[Math.floor(rng() * semitoneChoices.length)];
  const goesDown = direction === "descending";
  const rootLow = goesDown ? lowMidi + semitones : lowMidi;
  const rootHigh = goesDown ? highMidi : highMidi - semitones;
  if (rootLow > rootHigh) {
    throw new Error(`Range [${lowMidi}, ${highMidi}] is too narrow for a ${semitones}-semitone interval`);
  }
  const rootMidi = randomMidi(rootLow, rootHigh, rng);
  const targetMidi = goesDown ? rootMidi - semitones : rootMidi + semitones;
  return { rootMidi, targetMidi, semitones, direction };
}
