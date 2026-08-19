import { midiToHz, midiToName, nearestNote, cents, safeMidiRangeFromHz, randomMidi } from "../core/notes.ts";
import {
  pitchMatchLevelConfig,
  initialDifficultyState,
  nextDifficultyState,
  PITCH_MATCH_MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, pitchAccuracy, isWithinTolerance, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile, type VocalRange } from "../core/storage.ts";
import { recordAttempt } from "../core/skill-profile.ts";
import { playNote } from "../audio/engine.ts";
import { startPitchCapture, MicError, type MicSession } from "../audio/mic.ts";
import { PitchStabilizer } from "../audio/smoothing.ts";
import { HoldTracker } from "../core/hold-tracker.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";
import { buildResultsScreen } from "../ui/results.ts";

/** Visual span of the tuner scale, in cents each side of the target. */
const TUNER_SCALE_CENTS = 100;

// 20 cents was the original spec, but that's a spread budget tighter than
// typical natural vibrato even within a short 400ms window — see the fix in
// hold-tracker.ts for the full story (moderate vibrato measured ~80 cents
// peak-to-peak even in a 400ms slice). Matching HoldTracker's own default
// (90) rather than a tighter game-specific value, since a short 400ms
// window is already a weak filter against "still sliding" pitch regardless
// of tolerance.
const LOCK_TOLERANCE_CENTS = 90;
const LOCK_REQUIRED_MS = 400;
const TARGET_NOTE_DURATION_MS = 1200;
// Must be roughly on the target note (within a semitone) before the lock-in
// window starts accepting frames at all — keeps the initial glide/scoop up
// to a note from ever entering the "detected pitch" calculation.
const ACQUIRE_TOLERANCE_CENTS = 100;

export interface PitchMatchRound {
  targetMidi: number;
  targetHz: number;
  toleranceCents: number;
  timeLimitMs: number;
}

export interface PitchMatchGameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: PitchMatchRound | null;
}

export function createGame(startingLevel = 1): PitchMatchGameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(
  state: PitchMatchGameState,
  safeRange: { lowMidi: number; highMidi: number },
  rng: () => number = Math.random,
): PitchMatchGameState {
  const cfg = pitchMatchLevelConfig(state.difficulty.level);
  const targetMidi = randomMidi(safeRange.lowMidi, safeRange.highMidi, rng);
  return {
    ...state,
    round: {
      targetMidi,
      targetHz: midiToHz(targetMidi),
      toleranceCents: cfg.toleranceCents,
      timeLimitMs: cfg.timeLimitMs,
    },
  };
}

export interface AttemptEvaluation {
  correct: boolean;
  centsOff: number;
  accuracy: number;
}

/** Pure evaluation of one sung attempt against the current round's target. Null detectedHz = timed out. */
export function evaluateAttempt(round: PitchMatchRound, detectedHz: number | null): AttemptEvaluation {
  if (detectedHz === null) {
    return { correct: false, centsOff: Infinity, accuracy: 0 };
  }
  const centsOff = cents(detectedHz, round.targetHz);
  return {
    correct: isWithinTolerance(centsOff, round.toleranceCents),
    centsOff,
    accuracy: pitchAccuracy(centsOff),
  };
}

export function submitAttempt(state: PitchMatchGameState, evaluation: AttemptEvaluation): PitchMatchGameState {
  const session = applyRoundResult(state.session, evaluation.correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, evaluation.correct, PITCH_MATCH_MAX_LEVEL);
  return { session, difficulty, round: state.round };
}

type UiState =
  | { kind: "start" }
  | { kind: "requesting-mic" }
  | { kind: "mic-error"; message: string }
  | { kind: "playing-target" }
  | { kind: "listening" }
  | { kind: "result"; evaluation: AttemptEvaluation; detectedHz: number | null };

interface ListeningRefs {
  needle: HTMLElement;
  zone: HTMLElement;
  status: HTMLElement;
  noteReadout: HTMLElement;
  hzReadout: HTMLElement;
  centsReadout: HTMLElement;
  countdown: HTMLElement;
}

/** Wires the pure state machine up to audio playback, mic capture, storage, and the DOM. */
export function mountPitchMatch(root: HTMLElement, range: VocalRange, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.pitchMatch.level);
  const safeRange = safeMidiRangeFromHz(range.lowHz, range.highHz);

  let ui: UiState = { kind: "start" };
  let session: MicSession | null = null;
  let stabilizer: PitchStabilizer | null = null;
  let holdTracker: HoldTracker | null = null;
  let listenTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let listeningRefs: ListeningRefs | null = null;
  let listeningDeadline = 0;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(evaluation: AttemptEvaluation): void {
    const p = loadProfile();
    p.pitchMatch.level = game.difficulty.level;
    p.pitchMatch.played += 1;
    if (evaluation.correct) p.pitchMatch.correct += 1;
    p.pitchMatch.bestScore = Math.max(p.pitchMatch.bestScore, game.session.score);
    p.pitchMatch.bestStreak = Math.max(p.pitchMatch.bestStreak, game.session.bestStreak);
    p.skillProfile = recordAttempt(p.skillProfile, "voice:pitch-match", evaluation.accuracy, Date.now());
    saveProfile(p);
  }

  function setUi(next: UiState): void {
    ui = next;
    render();
  }

  function render(): void {
    root.innerHTML = "";

    const back = document.createElement("button");
    back.textContent = "← Menu";
    back.className = "back-link";
    back.addEventListener("click", () => {
      cleanup();
      onExit();
    });
    root.appendChild(back);

    root.appendChild(
      buildHud({
        gameName: "Pitch Match",
        level: game.difficulty.level,
        round: game.session.round,
        score: game.session.score,
        streak: game.session.streak,
        streakJustIncreased,
      }),
    );

    if (leveledUpTo !== null) {
      const banner = document.createElement("div");
      banner.className = "level-up-banner";
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — tolerance just got tighter.`;
      root.appendChild(banner);
    }

    root.appendChild(buildLevelProgress(game.difficulty.level, PITCH_MATCH_MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK));

    switch (ui.kind) {
      case "start": {
        const panel = document.createElement("div");
        panel.className = "panel";
        panel.appendChild(makeMessage("Headphones recommended — otherwise the mic may pick up the target note from your speakers."));
        const btn = document.createElement("button");
        btn.className = "btn-primary btn-block";
        btn.textContent = "START";
        btn.addEventListener("click", () => void beginRound());
        panel.appendChild(btn);
        root.appendChild(panel);
        break;
      }
      case "requesting-mic": {
        root.appendChild(panelWith(makeMessage("Requesting microphone…")));
        break;
      }
      case "mic-error": {
        const panel = document.createElement("div");
        panel.className = "panel";
        panel.appendChild(makeMessage(ui.message));
        const retry = document.createElement("button");
        retry.className = "btn-primary btn-block";
        retry.textContent = "RETRY";
        retry.addEventListener("click", () => void beginRound());
        panel.appendChild(retry);
        root.appendChild(panel);
        break;
      }
      case "playing-target": {
        const note = midiToName(game.round!.targetMidi);
        root.appendChild(panelWith(makeMessage(`Playing target note: ${note.name}${note.octave} (${game.round!.targetHz.toFixed(1)} Hz)…`)));
        break;
      }
      case "listening": {
        root.appendChild(buildTuner());
        break;
      }
      case "result": {
        root.appendChild(buildResultPanel(ui.evaluation, ui.detectedHz));
        break;
      }
    }
  }

  function panelWith(...children: HTMLElement[]): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.append(...children);
    return panel;
  }

  function makeMessage(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  /** Built once per round; updated per-frame via listeningRefs so the needle can animate smoothly. */
  function buildTuner(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "panel tuner";

    const targetLabel = document.createElement("div");
    targetLabel.className = "tuner-target-label";
    targetLabel.textContent = "TARGET";
    const note = midiToName(game.round!.targetMidi);
    const targetValue = document.createElement("div");
    targetValue.className = "tuner-target-value";
    targetValue.textContent = `${note.name}${note.octave} · ${game.round!.targetHz.toFixed(1)} Hz`;
    panel.append(targetLabel, targetValue);

    const scaleLabels = document.createElement("div");
    scaleLabels.className = "tuner-scale-labels";
    scaleLabels.innerHTML = "<span>FLAT</span><span>TARGET</span><span>SHARP</span>";
    panel.appendChild(scaleLabels);

    const scale = document.createElement("div");
    scale.className = "tuner-scale";
    const track = document.createElement("div");
    track.className = "tuner-track";
    const zonePct = (game.round!.toleranceCents / TUNER_SCALE_CENTS) * 50;
    const zone = document.createElement("div");
    zone.className = "tuner-zone";
    zone.style.left = `${50 - zonePct}%`;
    zone.style.width = `${zonePct * 2}%`;
    const tick = document.createElement("div");
    tick.className = "tuner-center-tick";
    const needle = document.createElement("div");
    needle.className = "tuner-needle";
    track.append(zone, tick, needle);
    scale.appendChild(track);
    panel.appendChild(scale);

    const status = document.createElement("div");
    status.className = "tuner-status";
    status.textContent = "Sing the target note…";
    panel.appendChild(status);

    const readout = document.createElement("div");
    readout.className = "tuner-readout";
    const noteReadout = document.createElement("span");
    const hzReadout = document.createElement("span");
    const centsReadout = document.createElement("span");
    readout.append(noteReadout, hzReadout, centsReadout);
    panel.appendChild(readout);

    const countdown = document.createElement("div");
    countdown.className = "tuner-countdown";
    panel.appendChild(countdown);

    listeningRefs = { needle, zone, status, noteReadout, hzReadout, centsReadout, countdown };
    updateTunerCountdown();
    updateTunerLive(null);
    return panel;
  }

  function updateTunerCountdown(): void {
    if (!listeningRefs) return;
    const remainingMs = Math.max(0, listeningDeadline - performance.now());
    listeningRefs.countdown.textContent = `${Math.ceil(remainingMs / 1000)}s left`;
  }

  function updateTunerLive(liveHz: number | null): void {
    if (!listeningRefs || !game.round) return;
    const target = game.round.targetHz;

    if (liveHz === null) {
      listeningRefs.needle.style.left = "50%";
      listeningRefs.needle.classList.remove("is-locked");
      listeningRefs.zone.classList.remove("is-locked");
      listeningRefs.status.classList.remove("is-locked");
      listeningRefs.status.textContent = "Listening…";
      listeningRefs.noteReadout.innerHTML = "";
      listeningRefs.hzReadout.innerHTML = "";
      listeningRefs.centsReadout.innerHTML = "";
      return;
    }

    const centsOff = cents(liveHz, target);
    const clamped = Math.max(-TUNER_SCALE_CENTS, Math.min(TUNER_SCALE_CENTS, centsOff));
    const leftPct = 50 + (clamped / TUNER_SCALE_CENTS) * 50;
    const locked = Math.abs(centsOff) <= game.round.toleranceCents;

    listeningRefs.needle.style.left = `${leftPct}%`;
    listeningRefs.needle.classList.toggle("is-locked", locked);
    listeningRefs.zone.classList.toggle("is-locked", locked);
    listeningRefs.status.classList.toggle("is-locked", locked);
    listeningRefs.status.textContent = locked ? "LOCKED IN" : centsOff < 0 ? "Flat — sing a little higher" : "Sharp — sing a little lower";

    const detected = nearestNote(liveHz);
    listeningRefs.noteReadout.innerHTML = `<strong>${detected.name}${detected.octave}</strong>`;
    listeningRefs.hzReadout.innerHTML = `<strong>${liveHz.toFixed(1)}</strong> Hz`;
    listeningRefs.centsReadout.innerHTML = `<strong>${centsOff > 0 ? "+" : ""}${centsOff.toFixed(0)}</strong>¢`;
  }

  function buildResultPanel(evaluation: AttemptEvaluation, detectedHz: number | null): HTMLElement {
    return buildResultsScreen({
      headingLabel: "ROUND COMPLETE",
      bigNumber: `${Math.round(evaluation.accuracy)}`,
      verdict: evaluation.correct ? "Correct!" : "Not quite.",
      sublabel: "Pitch accuracy",
      correct: evaluation.correct,
      streak: game.session.streak,
      breakdown: [
        { label: "Target", value: `${game.round!.targetHz.toFixed(1)} Hz` },
        { label: "Detected", value: detectedHz ? `${detectedHz.toFixed(1)} Hz` : "—" },
        { label: "Cents off", value: detectedHz ? `${evaluation.centsOff > 0 ? "+" : ""}${evaluation.centsOff.toFixed(0)}¢` : "—" },
      ],
      onNext: () => void beginRound(),
      onExit: () => {
        cleanup();
        onExit();
      },
    });
  }

  async function beginRound(): Promise<void> {
    game = startRound(game, safeRange);
    streakJustIncreased = false;
    leveledUpTo = null;

    if (!session) {
      setUi({ kind: "requesting-mic" });
      try {
        session = await startPitchCapture(handleFrame);
      } catch (err) {
        const message =
          err instanceof MicError
            ? `Couldn't access the microphone (${err.reason}): ${err.message}`
            : `Unexpected error: ${String(err)}`;
        setUi({ kind: "mic-error", message });
        return;
      }
    }

    setUi({ kind: "playing-target" });
    // Play the target, then fully stop before opening the scoring window —
    // otherwise the mic would hear the reference tone and "score" that.
    await playNote(game.round!.targetHz, { durationMs: TARGET_NOTE_DURATION_MS });

    stabilizer = new PitchStabilizer(profile.mic ? { rmsThresholdDb: profile.mic.noiseFloorDb } : {});
    holdTracker = new HoldTracker({ toleranceCents: LOCK_TOLERANCE_CENTS, requiredMs: LOCK_REQUIRED_MS });

    listeningDeadline = performance.now() + game.round!.timeLimitMs;
    listeningRefs = null;
    setUi({ kind: "listening" });

    listenTimeoutHandle = setTimeout(() => {
      if (ui.kind === "listening") finishAttempt(null);
    }, game.round!.timeLimitMs);
  }

  function handleFrame(frame: { hz: number | null; confidence: number; rms: number }): void {
    if (ui.kind !== "listening" || !stabilizer || !holdTracker) return;

    const stabilized = stabilizer.push(frame);
    updateTunerCountdown();

    if (stabilized.state === "silent") {
      holdTracker.silentTick(performance.now());
      updateTunerLive(null);
      return;
    }

    updateTunerLive(stabilized.hz);

    // Don't feed the lock-in tracker until the singer is at least roughly on
    // the target note. Without this gate, the natural glide/scoop up to a
    // note (present in any real voice, absent from a clean synthetic tone)
    // gets folded into the "detected" pitch as soon as it happens to settle
    // within the lock window's spread budget — capturing a blend of the
    // approach and the target rather than the target itself.
    if (Math.abs(cents(stabilized.hz, game.round!.targetHz)) > ACQUIRE_TOLERANCE_CENTS) {
      return;
    }

    const result = holdTracker.push(stabilized.hz, performance.now());
    if (result.status === "captured") {
      finishAttempt(result.hz);
    }
  }

  function finishAttempt(detectedHz: number | null): void {
    if (listenTimeoutHandle) {
      clearTimeout(listenTimeoutHandle);
      listenTimeoutHandle = null;
    }
    const levelBefore = game.difficulty.level;
    const evaluation = evaluateAttempt(game.round!, detectedHz);
    game = submitAttempt(game, evaluation);
    persist(evaluation);
    streakJustIncreased = evaluation.correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    setUi({ kind: "result", evaluation, detectedHz });
  }

  function cleanup(): void {
    if (listenTimeoutHandle) clearTimeout(listenTimeoutHandle);
    session?.stop();
    session = null;
    stabilizer = null;
    holdTracker = null;
  }

  render();
}
