const A4_MIDI = 69;
const A4_HZ = 440;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export interface NamedNote {
  midi: number;
  name: string;
  octave: number;
}

/** MIDI note number (can be fractional) -> frequency in Hz. */
export function midiToHz(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

/** Frequency in Hz -> MIDI note number (fractional; round for the nearest note). */
export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

/** Frequency in Hz -> the nearest named note plus its exact frequency. */
export function nearestNote(hz: number): NamedNote & { exactHz: number } {
  const midi = Math.round(hzToMidi(hz));
  return { ...midiToName(midi), exactHz: midiToHz(midi) };
}

export function midiToName(midi: number): NamedNote {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { midi: rounded, name, octave };
}

/**
 * Signed pitch distance in cents from `hz` to `targetHz`.
 * Negative = flat (below target), positive = sharp (above target).
 */
export function cents(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz);
}

/**
 * Converts a calibrated vocal range (in Hz) into a safe MIDI range for
 * target generation, insetting each end so games never ask for the exact
 * extreme the user could barely reach during calibration.
 */
export function safeMidiRangeFromHz(
  lowHz: number,
  highHz: number,
  insetSemitones = 2,
): { lowMidi: number; highMidi: number } {
  let lowMidi = Math.round(hzToMidi(lowHz)) + insetSemitones;
  let highMidi = Math.round(hzToMidi(highHz)) - insetSemitones;
  if (lowMidi > highMidi) {
    // range was narrower than 2x the inset — split the difference instead of inverting it
    const mid = (lowMidi + highMidi) / 2;
    lowMidi = Math.floor(mid);
    highMidi = Math.ceil(mid);
  }
  return { lowMidi, highMidi };
}

/** Generate the MIDI numbers for every note between two MIDI bounds, inclusive. */
export function midiRange(lowMidi: number, highMidi: number): number[] {
  const lo = Math.ceil(Math.min(lowMidi, highMidi));
  const hi = Math.floor(Math.max(lowMidi, highMidi));
  const range: number[] = [];
  for (let m = lo; m <= hi; m++) range.push(m);
  return range;
}

/** Pick a random MIDI note within [lowMidi, highMidi], inclusive. */
export function randomMidi(lowMidi: number, highMidi: number, rng: () => number = Math.random): number {
  const lo = Math.round(Math.min(lowMidi, highMidi));
  const hi = Math.round(Math.max(lowMidi, highMidi));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Pick two distinct random MIDI notes at least `minGapSemitones` apart within
 * [lowMidi, highMidi]. Returns them in random order (so the "higher" one
 * isn't always second).
 */
export function randomNotePair(
  lowMidi: number,
  highMidi: number,
  minGapSemitones: number,
  rng: () => number = Math.random,
): [number, number] {
  const lo = Math.round(Math.min(lowMidi, highMidi));
  const hi = Math.round(Math.max(lowMidi, highMidi));
  if (hi - lo < minGapSemitones) {
    throw new Error(
      `Range [${lo}, ${hi}] is too narrow for a minimum gap of ${minGapSemitones} semitones`,
    );
  }

  const first = randomMidi(lo, hi - minGapSemitones, rng);
  const second = first + minGapSemitones + Math.floor(rng() * (hi - first - minGapSemitones + 1));

  return rng() < 0.5 ? [first, second] : [second, first];
}
