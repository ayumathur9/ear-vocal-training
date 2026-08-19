import { randomMidi } from "./notes.ts";

export const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];

/**
 * Builds the MIDI sequence for one ascending pass of a major scale from
 * `rootMidi`, optionally followed by the descending pass back to the root
 * (the top note isn't repeated at the turn).
 */
export function buildScaleTargets(rootMidi: number, includeDescending: boolean): number[] {
  const ascending = MAJOR_SCALE_OFFSETS.map((o) => rootMidi + o);
  if (!includeDescending) return ascending;
  const descending = [...ascending].reverse().slice(1);
  return [...ascending, ...descending];
}

/** Picks a scale root that leaves room for a full octave above it within [lowMidi, highMidi]. */
export function pickScaleRoot(lowMidi: number, highMidi: number, rng: () => number = Math.random): number {
  const highestPossibleRoot = highMidi - 12;
  if (highestPossibleRoot <= lowMidi) return lowMidi;
  return randomMidi(lowMidi, highestPossibleRoot, rng);
}
