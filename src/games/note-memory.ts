import { midiToHz, midiToName } from "../core/notes.ts";
import { generateSequence, gradeAttempt } from "../core/note-memory.ts";
import {
  noteMemoryLevelConfig,
  initialDifficultyState,
  nextDifficultyState,
  NOTE_MEMORY_MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile } from "../core/storage.ts";
import { recordAttempt } from "../core/skill-profile.ts";
import { playNote } from "../audio/engine.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NoteMemoryRoundState {
  sequence: number[];
  pool: number[];
  guess: number[];
  awaitingAnswer: boolean;
}

export interface NoteMemoryGameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: NoteMemoryRoundState | null;
}

export function createGame(startingLevel = 1): NoteMemoryGameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(state: NoteMemoryGameState, rng: () => number = Math.random): NoteMemoryGameState {
  const cfg = noteMemoryLevelConfig(state.difficulty.level);
  const { notesMidi, poolMidi } = generateSequence(cfg.lowMidi, cfg.highMidi, cfg.sequenceLength, rng);
  return {
    ...state,
    round: { sequence: notesMidi, pool: poolMidi, guess: [], awaitingAnswer: true },
  };
}

export interface GuessResult {
  correct: boolean;
  firstWrongIndex: number | null;
  state: NoteMemoryGameState;
}

export function submitGuess(state: NoteMemoryGameState, guess: number[]): GuessResult {
  if (!state.round || !state.round.awaitingAnswer) {
    throw new Error("No round is currently awaiting a guess");
  }
  const grade = gradeAttempt(state.round.sequence, guess);
  const session = applyRoundResult(state.session, grade.correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, grade.correct, NOTE_MEMORY_MAX_LEVEL);

  return {
    correct: grade.correct,
    firstWrongIndex: grade.firstWrongIndex,
    state: { session, difficulty, round: { ...state.round, guess, awaitingAnswer: false } },
  };
}

/** Wires the pure state machine up to audio playback, storage, and the DOM. */
export function mountNoteMemory(root: HTMLElement, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.noteMemory.level);
  let busy = false;
  let currentGuess: number[] = [];
  let lastResult: GuessResult | null = null;
  let lastGain = 0;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(correct: boolean): void {
    const p = loadProfile();
    p.noteMemory.level = game.difficulty.level;
    p.noteMemory.played += 1;
    if (correct) p.noteMemory.correct += 1;
    p.noteMemory.bestScore = Math.max(p.noteMemory.bestScore, game.session.score);
    p.noteMemory.bestStreak = Math.max(p.noteMemory.bestStreak, game.session.bestStreak);
    p.skillProfile = recordAttempt(p.skillProfile, "ear:note-memory", correct ? 100 : 0, Date.now());
    saveProfile(p);
  }

  function render(): void {
    root.innerHTML = "";

    const back = document.createElement("button");
    back.textContent = "← Menu";
    back.className = "back-link";
    back.addEventListener("click", onExit);
    root.appendChild(back);

    root.appendChild(
      buildHud({
        gameName: "Note Memory",
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
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — longer sequences, more notes.`;
      root.appendChild(banner);
    }

    root.appendChild(buildLevelProgress(game.difficulty.level, NOTE_MEMORY_MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK));

    const panel = document.createElement("div");
    panel.className = "panel";

    if (!game.round) {
      panel.appendChild(makeMessage("Listen to the sequence, then tap the notes back in order."));
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-block";
      btn.textContent = "PLAY SEQUENCE";
      btn.disabled = busy;
      btn.addEventListener("click", () => void handlePlay());
      panel.appendChild(btn);
      root.appendChild(panel);
      return;
    }

    if (lastResult) {
      const flash = document.createElement("div");
      flash.className = `feedback-flash ${lastResult.correct ? "is-correct" : "is-incorrect"}`;
      const title = document.createElement("div");
      title.className = "feedback-title";
      title.textContent = lastResult.correct ? "Correct!" : "Not quite.";
      flash.appendChild(title);
      if (lastResult.correct) {
        const xp = document.createElement("div");
        xp.className = "feedback-xp";
        xp.textContent = `+${lastGain} XP`;
        flash.appendChild(xp);
      } else {
        const explain = document.createElement("div");
        explain.className = "panel-message";
        explain.style.marginTop = "0.5rem";
        explain.textContent = `The sequence was: ${game.round.sequence.map((m) => noteLabel(m)).join(" – ")}`;
        flash.appendChild(explain);
      }
      panel.appendChild(flash);

      const next = document.createElement("button");
      next.className = "btn-primary btn-block";
      next.textContent = "NEXT ROUND →";
      next.addEventListener("click", () => void handlePlay());
      panel.appendChild(next);
      root.appendChild(panel);
      return;
    }

    if (busy) {
      panel.appendChild(makeMessage("Listening…"));
      root.appendChild(panel);
      return;
    }

    panel.appendChild(
      makeMessage(`Tap the ${game.round.sequence.length} notes you heard, in order (${currentGuess.length}/${game.round.sequence.length}).`),
    );

    const noteGrid = document.createElement("div");
    noteGrid.className = "choice-row";
    noteGrid.style.flexWrap = "wrap";
    for (const midi of game.round.pool) {
      noteGrid.appendChild(buildChoiceButton(noteLabel(midi), () => handleTap(midi)));
    }
    panel.appendChild(noteGrid);

    const guessRow = document.createElement("div");
    guessRow.className = "panel-message";
    guessRow.style.marginTop = "0.5rem";
    guessRow.textContent = currentGuess.length > 0 ? `Your guess: ${currentGuess.map((m) => noteLabel(m)).join(" – ")}` : "Your guess: —";
    panel.appendChild(guessRow);

    const controls = document.createElement("div");
    controls.className = "choice-row";
    controls.style.marginTop = "0.5rem";

    const undo = document.createElement("button");
    undo.className = "btn-block";
    undo.textContent = "⟲ Undo";
    undo.disabled = currentGuess.length === 0;
    undo.addEventListener("click", () => {
      currentGuess = currentGuess.slice(0, -1);
      render();
    });
    controls.appendChild(undo);

    const replay = document.createElement("button");
    replay.className = "btn-block";
    replay.textContent = "▸ Replay sequence";
    replay.addEventListener("click", () => void handlePlay());
    controls.appendChild(replay);
    panel.appendChild(controls);

    if (currentGuess.length === game.round.sequence.length) {
      const submit = document.createElement("button");
      submit.className = "btn-primary btn-block";
      submit.style.marginTop = "0.75rem";
      submit.textContent = "SUBMIT";
      submit.addEventListener("click", handleSubmit);
      panel.appendChild(submit);
    }

    root.appendChild(panel);
  }

  function noteLabel(midi: number): string {
    const n = midiToName(midi);
    return `${n.name}${n.octave}`;
  }

  function makeMessage(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function buildChoiceButton(label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    const t = document.createElement("span");
    t.className = "choice-btn-label";
    t.textContent = label;
    btn.append(t);
    btn.addEventListener("click", onClick);
    return btn;
  }

  async function handlePlay(): Promise<void> {
    if (busy) return;
    busy = true;
    lastResult = null;
    currentGuess = [];
    streakJustIncreased = false;
    leveledUpTo = null;
    if (!game.round || !game.round.awaitingAnswer) {
      game = startRound(game);
    }
    render();

    for (const midi of game.round!.sequence) {
      await playNote(midiToHz(midi), { durationMs: 500 });
      await delay(150);
    }

    busy = false;
    render();
  }

  function handleTap(midi: number): void {
    if (busy || !game.round?.awaitingAnswer || currentGuess.length >= game.round.sequence.length) return;
    currentGuess = [...currentGuess, midi];
    render();
  }

  function handleSubmit(): void {
    if (busy || !game.round?.awaitingAnswer) return;
    const levelBefore = game.difficulty.level;
    const scoreBefore = game.session.score;
    const result = submitGuess(game, currentGuess);
    game = result.state;
    persist(result.correct);
    lastResult = result;
    lastGain = game.session.score - scoreBefore;
    streakJustIncreased = result.correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    render();
  }

  render();
}
