import { midiToHz, midiToName, cents, safeMidiRangeFromHz } from "../core/notes.ts";
import { buildScaleTargets, pickScaleRoot } from "../core/scale.ts";
import {
  singScaleLevelConfig,
  initialDifficultyState,
  nextDifficultyState,
  SING_SCALE_MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile, type VocalRange } from "../core/storage.ts";
import { recordAttempt } from "../core/skill-profile.ts";
import { playNote } from "../audio/engine.ts";
import { startPitchCapture, MicError, type MicSession } from "../audio/mic.ts";
import { PitchStabilizer } from "../audio/smoothing.ts";
import { HoldAttemptTracker } from "../core/hold-attempt.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";
import { buildResultsScreen } from "../ui/results.ts";

const TARGET_NOTE_DURATION_MS = 700;
const PER_NOTE_REQUIRED_MS = 600;
const PER_NOTE_TIMEOUT_MS = 4000;
/** Same lesson as pitch-match.ts / hold-pitch.ts: don't score the glide up to a new note. */
const ACQUIRE_TOLERANCE_CENTS = 100;
/** A "correct" round (for scoring/difficulty) needs at least this average stability across all degrees. */
export const PASS_STABILITY_THRESHOLD = 70;

export interface SingScaleRound {
  targetsMidi: number[];
  toleranceCents: number;
}

export interface SingScaleGameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: SingScaleRound | null;
}

export function createGame(startingLevel = 1): SingScaleGameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(
  state: SingScaleGameState,
  safeRange: { lowMidi: number; highMidi: number },
  rng: () => number = Math.random,
): SingScaleGameState {
  const cfg = singScaleLevelConfig(state.difficulty.level);
  const root = pickScaleRoot(safeRange.lowMidi, safeRange.highMidi, rng);
  const targetsMidi = buildScaleTargets(root, cfg.includeDescending);
  return { ...state, round: { targetsMidi, toleranceCents: cfg.toleranceCents } };
}

export interface SingScaleAttemptResult {
  perNoteStability: number[];
  overallStability: number;
  correct: boolean;
}

export function evaluateRound(perNoteStability: number[]): SingScaleAttemptResult {
  const overallStability =
    perNoteStability.length === 0 ? 0 : perNoteStability.reduce((a, b) => a + b, 0) / perNoteStability.length;
  return { perNoteStability, overallStability, correct: overallStability >= PASS_STABILITY_THRESHOLD };
}

export function submitAttempt(state: SingScaleGameState, result: SingScaleAttemptResult): SingScaleGameState {
  const session = applyRoundResult(state.session, result.correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, result.correct, SING_SCALE_MAX_LEVEL);
  return { session, difficulty, round: state.round };
}

type UiState =
  | { kind: "start" }
  | { kind: "requesting-mic" }
  | { kind: "mic-error"; message: string }
  | { kind: "playing-target"; degreeIndex: number }
  | { kind: "singing"; degreeIndex: number }
  | { kind: "result"; result: SingScaleAttemptResult };

interface SingingRefs {
  statusMsg: HTMLElement;
  progressFill: HTMLElement;
  livePitchMsg: HTMLElement;
}

/** Wires the pure state machine up to audio playback, mic capture, storage, and the DOM. */
export function mountSingScale(root: HTMLElement, range: VocalRange, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.singScale.level);
  const safeRange = safeMidiRangeFromHz(range.lowHz, range.highHz);

  let ui: UiState = { kind: "start" };
  let session: MicSession | null = null;
  let stabilizer: PitchStabilizer | null = null;
  let attemptTracker: HoldAttemptTracker | null = null;
  let perNoteTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let degreeAcquired = false;
  let liveHz: number | null = null;
  let perNoteStability: number[] = [];
  let singingRefs: SingingRefs | null = null;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(result: SingScaleAttemptResult): void {
    const p = loadProfile();
    p.singScale.level = game.difficulty.level;
    p.singScale.played += 1;
    if (result.correct) p.singScale.correct += 1;
    p.singScale.bestScore = Math.max(p.singScale.bestScore, game.session.score);
    p.singScale.bestStreak = Math.max(p.singScale.bestStreak, game.session.bestStreak);
    p.skillProfile = recordAttempt(p.skillProfile, "voice:scale-singing", result.overallStability, Date.now());
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
        gameName: "Sing the Scale",
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
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — tighter tolerance.`;
      root.appendChild(banner);
    }

    root.appendChild(buildLevelProgress(game.difficulty.level, SING_SCALE_MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK));

    switch (ui.kind) {
      case "start": {
        const panel = document.createElement("div");
        panel.className = "panel";
        panel.appendChild(makeMessage("Sing each note of the scale back as it plays. Headphones recommended."));
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
        const midi = game.round!.targetsMidi[ui.degreeIndex];
        const note = midiToName(midi);
        root.appendChild(
          panelWith(
            makeMessage(`Note ${ui.degreeIndex + 1} of ${game.round!.targetsMidi.length}: ${note.name}${note.octave}…`),
          ),
        );
        break;
      }
      case "singing": {
        root.appendChild(buildSingingPanel(ui.degreeIndex));
        break;
      }
      case "result": {
        root.appendChild(buildResultPanel(ui.result));
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

  /** Built once per degree, then updated in place via singingRefs on each audio frame. */
  function buildSingingPanel(degreeIndex: number): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "panel";

    const note = midiToName(game.round!.targetsMidi[degreeIndex]);
    const heading = document.createElement("div");
    heading.className = "panel-message";
    heading.textContent = `Note ${degreeIndex + 1} of ${game.round!.targetsMidi.length}: ${note.name}${note.octave}`;
    panel.appendChild(heading);

    const statusMsg = document.createElement("div");
    statusMsg.className = "hold-status";
    panel.appendChild(statusMsg);

    const progressTrack = document.createElement("div");
    progressTrack.className = "vu-track vu-hold-track";
    const progressFill = document.createElement("div");
    progressFill.className = "vu-fill vu-hold-fill";
    progressTrack.appendChild(progressFill);
    panel.appendChild(progressTrack);

    const livePitchMsg = document.createElement("div");
    livePitchMsg.className = "hold-live-pitch";
    panel.appendChild(livePitchMsg);

    singingRefs = { statusMsg, progressFill, livePitchMsg };
    updateSingingUi(0);
    return panel;
  }

  function updateSingingUi(elapsedMs: number): void {
    if (!singingRefs) return;
    singingRefs.statusMsg.classList.toggle("is-acquired", degreeAcquired);
    singingRefs.statusMsg.textContent = degreeAcquired
      ? `Hold it! ${(elapsedMs / 1000).toFixed(1)}s / ${(PER_NOTE_REQUIRED_MS / 1000).toFixed(1)}s`
      : "Get to the note…";
    singingRefs.progressFill.style.width = `${Math.min(100, (elapsedMs / PER_NOTE_REQUIRED_MS) * 100)}%`;
    singingRefs.livePitchMsg.textContent = `Live pitch: ${liveHz ? liveHz.toFixed(1) + " Hz" : "—"}`;
  }

  function buildResultPanel(result: SingScaleAttemptResult): HTMLElement {
    return buildResultsScreen({
      headingLabel: "SCALE COMPLETE",
      bigNumber: `${Math.round(result.overallStability)}`,
      verdict: result.correct ? "Correct!" : "Not quite.",
      sublabel: "Average stability",
      correct: result.correct,
      streak: game.session.streak,
      breakdown: [
        { label: "Notes sung", value: `${result.perNoteStability.length}` },
        { label: "Best note", value: `${Math.round(Math.max(...result.perNoteStability))}%` },
        { label: "Weakest note", value: `${Math.round(Math.min(...result.perNoteStability))}%` },
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
    perNoteStability = [];

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

    await playDegree(0);
  }

  async function playDegree(degreeIndex: number): Promise<void> {
    setUi({ kind: "playing-target", degreeIndex });
    // Play the reference tone, then fully stop before opening the scoring
    // window — otherwise the mic would hear the reference and "score" that.
    await playNote(midiToHz(game.round!.targetsMidi[degreeIndex]), { durationMs: TARGET_NOTE_DURATION_MS });
    openScoringWindow(degreeIndex);
  }

  function openScoringWindow(degreeIndex: number): void {
    stabilizer = new PitchStabilizer(profile.mic ? { rmsThresholdDb: profile.mic.noiseFloorDb } : {});
    attemptTracker = new HoldAttemptTracker({
      targetHz: midiToHz(game.round!.targetsMidi[degreeIndex]),
      toleranceCents: game.round!.toleranceCents,
      requiredMs: PER_NOTE_REQUIRED_MS,
    });
    degreeAcquired = false;
    liveHz = null;
    singingRefs = null;
    setUi({ kind: "singing", degreeIndex });

    perNoteTimeoutHandle = setTimeout(() => {
      if (ui.kind === "singing") {
        const partial = attemptTracker?.forceFinalize();
        void advanceDegree(degreeIndex, partial?.stabilityPercent ?? 0);
      }
    }, PER_NOTE_TIMEOUT_MS);
  }

  function handleFrame(frame: { hz: number | null; confidence: number; rms: number }): void {
    if (ui.kind !== "singing" || !stabilizer || !attemptTracker) return;
    const degreeIndex = ui.degreeIndex;

    const stabilized = stabilizer.push(frame);
    const now = performance.now();
    liveHz = stabilized.state === "voiced" ? stabilized.hz : null;
    const targetHz = midiToHz(game.round!.targetsMidi[degreeIndex]);
    const centsOff = liveHz !== null ? cents(liveHz, targetHz) : null;

    if (!degreeAcquired) {
      if (stabilized.state === "voiced" && centsOff !== null && Math.abs(centsOff) <= ACQUIRE_TOLERANCE_CENTS) {
        const tick = attemptTracker.pushVoiced(stabilized.hz, now);
        if (tick.status === "complete") {
          void advanceDegree(degreeIndex, tick.result.stabilityPercent);
          return;
        }
        degreeAcquired = true;
        updateSingingUi(tick.status === "recording" ? tick.elapsedMs : 0);
        return;
      }
      updateSingingUi(0);
      return;
    }

    if (stabilized.state === "silent") {
      const tick = attemptTracker.pushSilent(now);
      updateSingingUi(tick.status === "recording" ? tick.elapsedMs : 0);
      return;
    }

    const tick = attemptTracker.pushVoiced(stabilized.hz, now);
    if (tick.status === "complete") {
      void advanceDegree(degreeIndex, tick.result.stabilityPercent);
      return;
    }
    updateSingingUi(tick.status === "recording" ? tick.elapsedMs : 0);
  }

  async function advanceDegree(degreeIndex: number, stabilityPercent: number): Promise<void> {
    if (perNoteTimeoutHandle) {
      clearTimeout(perNoteTimeoutHandle);
      perNoteTimeoutHandle = null;
    }
    perNoteStability = [...perNoteStability, stabilityPercent];
    stabilizer = null;
    attemptTracker = null;

    const nextIndex = degreeIndex + 1;
    if (nextIndex >= game.round!.targetsMidi.length) {
      finishRound();
      return;
    }
    await playDegree(nextIndex);
  }

  function finishRound(): void {
    const levelBefore = game.difficulty.level;
    const result = evaluateRound(perNoteStability);
    game = submitAttempt(game, result);
    persist(result);
    streakJustIncreased = result.correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    setUi({ kind: "result", result });
  }

  function cleanup(): void {
    if (perNoteTimeoutHandle) clearTimeout(perNoteTimeoutHandle);
    session?.stop();
    session = null;
    stabilizer = null;
    attemptTracker = null;
  }

  render();
}
