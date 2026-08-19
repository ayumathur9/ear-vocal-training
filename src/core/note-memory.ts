import { midiRange } from "./notes.ts";

export interface NoteMemorySequence {
  notesMidi: number[];
  poolMidi: number[];
}

/** Generates a random sequence of `length` notes drawn (with repeats) from the pool in [lowMidi, highMidi]. */
export function generateSequence(
  lowMidi: number,
  highMidi: number,
  length: number,
  rng: () => number = Math.random,
): NoteMemorySequence {
  const poolMidi = midiRange(lowMidi, highMidi);
  const notesMidi = Array.from({ length }, () => poolMidi[Math.floor(rng() * poolMidi.length)]);
  return { notesMidi, poolMidi };
}

export interface NoteMemoryGrade {
  correct: boolean;
  firstWrongIndex: number | null;
}

/** Grades a guessed sequence against the played one. A short/long guess counts wrong at the first missing/extra index. */
export function gradeAttempt(sequence: number[], guess: number[]): NoteMemoryGrade {
  const len = Math.max(sequence.length, guess.length);
  for (let i = 0; i < len; i++) {
    if (guess[i] !== sequence[i]) return { correct: false, firstWrongIndex: i };
  }
  return { correct: true, firstWrongIndex: null };
}
