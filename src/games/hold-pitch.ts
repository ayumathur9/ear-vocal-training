import { midiToHz, cents, safeMidiRangeFromHz, randomMidi } from "../core/notes.ts";
import {
  holdPitchLevelConfig,
  initialDifficultyState,
  nextDifficultyState,
  HOLD_PITCH_MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile, type VocalRange } from "../core/storage.ts";
import { playNote } from "../audio/engine.ts";
import { startPitchCapture, MicError, type MicSession } from "../audio/mic.ts";
import { PitchStabilizer } from "../audio/smoothing.ts";
import { HoldAttemptTracker, type HoldAttemptResult } from "../core/hold-attempt.ts";
import { PitchTraceMeter } from "../ui/pitch-trace.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";
import { buildResultsScreen } from "../ui/results.ts";

const TARGET_NOTE_DURATION_MS = 1200;
const OVERALL_TIMEOUT_MULTIPLIER = 3; // give up on an attempt that never gets going after 3x the required duration
/** A "correct" attempt (for scoring/difficulty purposes) needs at least this much stability. */
export const PASS_STABILITY_THRESHOLD = 70;
// Must be roughly on the target note (within a semitone) before the hold
// timer starts at all — otherwise the natural glide/scoop up to a note
// (present in any real voice) gets counted as "held" time and drags the
// stability score down for a perfectly good hold.
const ACQUIRE_TOLERANCE_CENTS = 100;

export interface HoldPitchRound {
  targetMidi: number;
  targetHz: number;
  toleranceCents: number;
  durationMs: number;
}

export interface HoldPitchGameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: HoldPitchRound | null;
}

export function createGame(startingLevel = 1): HoldPitchGameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(
  state: HoldPitchGameState,
  safeRange: { lowMidi: number; highMidi: number },
  rng: () => number = Math.random,
): HoldPitchGameState {
  const cfg = holdPitchLevelConfig(state.difficulty.level);
  const targetMidi = randomMidi(safeRange.lowMidi, safeRange.highMidi, rng);
  return {
    ...state,
    round: {
      targetMidi,
      targetHz: midiToHz(targetMidi),
      toleranceCents: cfg.toleranceCents,
      durationMs: cfg.durationMs,
    },
  };
}

export function submitAttempt(state: HoldPitchGameState, result: HoldAttemptResult): HoldPitchGameState {
  const correct = result.stabilityPercent >= PASS_STABILITY_THRESHOLD;
  const session = applyRoundResult(state.session, correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, correct, HOLD_PITCH_MAX_LEVEL);
  return { session, difficulty, round: state.round };
}

type UiState =
  | { kind: "start" }
  | { kind: "requesting-mic" }
  | { kind: "mic-error"; message: string }
  | { kind: "playing-target" }
  | { kind: "holding" }
  | { kind: "result"; result: HoldAttemptResult; correct: boolean };

interface HoldingDisplay {
  elapsedMs: number;
  liveHz: number | null;
  acquired: boolean;
}

interface HoldingRefs {
  statusMsg: HTMLElement;
  progressFill: HTMLElement;
  livePitchMsg: HTMLElement;
  trace: PitchTraceMeter;
}

/** Wires the pure state machine up to audio playback, mic capture, storage, and the DOM. */
export function mountHoldPitch(root: HTMLElement, range: VocalRange, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.holdPitch.level);
  const safeRange = safeMidiRangeFromHz(range.lowHz, range.highHz);

  let ui: UiState = { kind: "start" };
  let session: MicSession | null = null;
  let stabilizer: PitchStabilizer | null = null;
  let attemptTracker: HoldAttemptTracker | null = null;
  let overallTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let holdingDisplay: HoldingDisplay = { elapsedMs: 0, liveHz: null, acquired: false };
  let holdingRefs: HoldingRefs | null = null;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(correct: boolean): void {
    const p = loadProfile();
    p.holdPitch.level = game.difficulty.level;
    p.holdPitch.played += 1;
    if (correct) p.holdPitch.correct += 1;
    p.holdPitch.bestScore = Math.max(p.holdPitch.bestScore, game.session.score);
    p.holdPitch.bestStreak = Math.max(p.holdPitch.bestStreak, game.session.bestStreak);
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
        gameName: "Hold the Pitch",
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
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — hold longer, steadier.`;
      root.appendChild(banner);
    }

    root.appendChild(buildLevelProgress(game.difficulty.level, HOLD_PITCH_MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK));

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
        root.appendChild(panelWith(makeMessage(`Playing target note (${game.round!.targetHz.toFixed(1)} Hz)…`)));
        break;
      }
      case "holding": {
        // Built once per round, then updated in place per audio frame via
        // holdingRefs — rebuilding this DOM (and recreating the trace
        // canvas) on every ~10ms frame would be wasteful and would wipe
        // the trace history constantly.
        const panel = document.createElement("div");
        panel.className = "panel";
        const statusMsg = document.createElement("div");
        statusMsg.className = "hold-status";
        panel.appendChild(statusMsg);

        const progressTrack = document.createElement("div");
        progressTrack.className = "vu-track vu-hold-track";
        const progressFill = document.createElement("div");
        progressFill.className = "vu-fill vu-hold-fill";
        progressTrack.appendChild(progressFill);
        panel.appendChild(progressTrack);

        // PitchTraceMeter appends its own canvas to `panel` immediately on
        // construction, so it lands here, after the status/progress bar.
        const trace = new PitchTraceMeter(panel, { toleranceCents: game.round!.toleranceCents });

        const livePitchMsg = document.createElement("div");
        livePitchMsg.className = "hold-live-pitch";
        panel.appendChild(livePitchMsg);

        root.appendChild(panel);
        holdingRefs = { statusMsg, progressFill, livePitchMsg, trace };
        updateHoldingUi();
        break;
      }
      case "result": {
        const { result, correct } = ui;
        root.appendChild(
          buildResultsScreen({
            headingLabel: "HOLD COMPLETE",
            bigNumber: `${result.stabilityPercent.toFixed(0)}`,
            verdict: correct ? "Correct!" : "Not quite.",
            sublabel: "Stability",
            correct,
            streak: game.session.streak,
            breakdown: [
              { label: "Time held", value: `${(result.timeHeldMs / 1000).toFixed(1)}s` },
              { label: "Score", value: `${result.score}/100` },
              { label: "Target", value: `${game.round!.targetHz.toFixed(1)} Hz` },
            ],
            onNext: () => void beginRound(),
            onExit: () => {
              cleanup();
              onExit();
            },
          }),
        );
        break;
      }
    }
  }

  function makeMessage(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function panelWith(...children: HTMLElement[]): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.append(...children);
    return panel;
  }

  /** Updates the "holding" view's DOM in place from `holdingDisplay`, without a full re-render. */
  function updateHoldingUi(): void {
    if (!holdingRefs) return;
    const requiredMs = game.round!.durationMs;
    const { elapsedMs, liveHz, acquired } = holdingDisplay;

    holdingRefs.statusMsg.classList.toggle("is-acquired", acquired);
    holdingRefs.statusMsg.textContent = acquired
      ? `Hold the note! ${(elapsedMs / 1000).toFixed(1)}s / ${(requiredMs / 1000).toFixed(1)}s`
      : "Get to the note, then hold it steady…";
    holdingRefs.progressFill.style.width = `${Math.min(100, (elapsedMs / requiredMs) * 100)}%`;
    holdingRefs.livePitchMsg.textContent = `Live pitch: ${liveHz ? liveHz.toFixed(1) + " Hz" : "—"}`;
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
    attemptTracker = new HoldAttemptTracker({
      targetHz: game.round!.targetHz,
      toleranceCents: game.round!.toleranceCents,
      requiredMs: game.round!.durationMs,
    });

    holdingDisplay = { elapsedMs: 0, liveHz: null, acquired: false };
    holdingRefs = null;
    setUi({ kind: "holding" });

    overallTimeoutHandle = setTimeout(() => {
      if (ui.kind === "holding") {
        const partial = attemptTracker?.forceFinalize() ?? { timeHeldMs: 0, stabilityPercent: 0, score: 0 };
        finishAttempt(partial);
      }
    }, game.round!.durationMs * OVERALL_TIMEOUT_MULTIPLIER);
  }

  function handleFrame(frame: { hz: number | null; confidence: number; rms: number }): void {
    if (ui.kind !== "holding" || !stabilizer || !attemptTracker) return;

    const stabilized = stabilizer.push(frame);
    const now = performance.now();
    const liveHz = stabilized.state === "voiced" ? stabilized.hz : null;
    const centsOff = liveHz !== null ? cents(liveHz, game.round!.targetHz) : null;
    holdingRefs?.trace.push(centsOff, now);
    holdingDisplay.liveHz = liveHz;

    if (!holdingDisplay.acquired) {
      // Not yet on the target — don't touch the tracker at all, so the
      // approach/glide never enters the stability measurement.
      if (stabilized.state === "voiced" && centsOff !== null && Math.abs(centsOff) <= ACQUIRE_TOLERANCE_CENTS) {
        const tick = attemptTracker.pushVoiced(stabilized.hz, now);
        if (tick.status === "complete") {
          finishAttempt(tick.result);
          return;
        }
        holdingDisplay.acquired = true;
        holdingDisplay.elapsedMs = tick.status === "recording" ? tick.elapsedMs : holdingDisplay.elapsedMs;
        updateHoldingUi();
        return;
      }
      updateHoldingUi();
      return;
    }

    if (stabilized.state === "silent") {
      const tick = attemptTracker.pushSilent(now);
      holdingDisplay.elapsedMs = tick.status === "recording" ? tick.elapsedMs : holdingDisplay.elapsedMs;
      updateHoldingUi();
      return;
    }

    const tick = attemptTracker.pushVoiced(stabilized.hz, now);
    if (tick.status === "complete") {
      finishAttempt(tick.result);
      return;
    }
    holdingDisplay.elapsedMs = tick.status === "recording" ? tick.elapsedMs : holdingDisplay.elapsedMs;
    updateHoldingUi();
  }

  function finishAttempt(result: HoldAttemptResult): void {
    if (overallTimeoutHandle) {
      clearTimeout(overallTimeoutHandle);
      overallTimeoutHandle = null;
    }
    const levelBefore = game.difficulty.level;
    const correct = result.stabilityPercent >= PASS_STABILITY_THRESHOLD;
    game = submitAttempt(game, result);
    persist(correct);
    streakJustIncreased = correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    setUi({ kind: "result", result, correct });
  }

  function cleanup(): void {
    if (overallTimeoutHandle) clearTimeout(overallTimeoutHandle);
    session?.stop();
    session = null;
    stabilizer = null;
    attemptTracker = null;
  }

  render();
}
