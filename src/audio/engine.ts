let sharedContext: AudioContext | null = null;

/**
 * Lazily creates (or resumes) the shared AudioContext. Must be called from
 * inside a user-gesture handler (click/keypress) the first time, or browser
 * autoplay policy leaves it suspended and nothing will play.
 */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  if (sharedContext.state === "suspended") {
    void sharedContext.resume();
  }
  return sharedContext;
}

export interface PlayNoteOptions {
  durationMs?: number;
  attackMs?: number;
  releaseMs?: number;
  gain?: number;
}

/**
 * Plays a single sine tone at `hz` and resolves once it has finished
 * (including release tail), so callers can sequence notes without
 * overlapping them.
 */
export function playNote(hz: number, options: PlayNoteOptions = {}): Promise<void> {
  const { durationMs = 800, attackMs = 15, releaseMs = 60, gain = 0.25 } = options;
  const ctx = getAudioContext();

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = hz;

  const gainNode = ctx.createGain();
  const now = ctx.currentTime;
  const attackEnd = now + attackMs / 1000;
  const releaseStart = now + durationMs / 1000;
  const releaseEnd = releaseStart + releaseMs / 1000;

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(gain, attackEnd);
  gainNode.gain.setValueAtTime(gain, releaseStart);
  gainNode.gain.linearRampToValueAtTime(0, releaseEnd);

  osc.connect(gainNode).connect(ctx.destination);
  osc.start(now);
  osc.stop(releaseEnd);

  return new Promise((resolve) => {
    osc.onended = () => resolve();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Plays two notes in sequence with a gap between them. */
export async function playNotePair(hzA: number, hzB: number, gapMs = 200, noteMs = 800): Promise<void> {
  await playNote(hzA, { durationMs: noteMs });
  await delay(gapMs);
  await playNote(hzB, { durationMs: noteMs });
}

/**
 * Plays several tones together (a "harmonic" interval or chord), each with
 * its own oscillator/gain sharing one ADSR envelope, resolving once they've
 * all finished. Gain defaults lower than `playNote`'s since amplitudes sum.
 */
export function playChord(hzs: number[], options: PlayNoteOptions = {}): Promise<void> {
  const { durationMs = 800, attackMs = 15, releaseMs = 60, gain = 0.18 } = options;
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const attackEnd = now + attackMs / 1000;
  const releaseStart = now + durationMs / 1000;
  const releaseEnd = releaseStart + releaseMs / 1000;

  const endings = hzs.map(
    (hz) =>
      new Promise<void>((resolve) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = hz;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gain, attackEnd);
        gainNode.gain.setValueAtTime(gain, releaseStart);
        gainNode.gain.linearRampToValueAtTime(0, releaseEnd);

        osc.connect(gainNode).connect(ctx.destination);
        osc.start(now);
        osc.stop(releaseEnd);
        osc.onended = () => resolve();
      }),
  );

  return Promise.all(endings).then(() => undefined);
}
