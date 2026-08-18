import { midiToHz, randomNotePair } from "../core/notes.ts";
import {
  levelConfig,
  initialDifficultyState,
  nextDifficultyState,
  MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile } from "../core/storage.ts";
import { playNote } from "../audio/engine.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RoundState {
  midiA: number;
  midiB: number;
  awaitingAnswer: boolean;
}

export interface GameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: RoundState | null;
}

/** Pure state machine, no DOM/audio side effects — kept testable in isolation. */
export function createGame(startingLevel = 1): GameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(state: GameState, rng: () => number = Math.random): GameState {
  const cfg = levelConfig(state.difficulty.level);
  const [midiA, midiB] = randomNotePair(cfg.lowMidi, cfg.highMidi, cfg.gapSemitones, rng);
  return { ...state, round: { midiA, midiB, awaitingAnswer: true } };
}

export type Answer = "first" | "second";

export interface AnswerResult {
  correct: boolean;
  state: GameState;
}

export function submitAnswer(state: GameState, answer: Answer): AnswerResult {
  if (!state.round || !state.round.awaitingAnswer) {
    throw new Error("No round is currently awaiting an answer");
  }
  const { midiA, midiB } = state.round;
  const higherIsFirst = midiA > midiB;
  const correct = (answer === "first" && higherIsFirst) || (answer === "second" && !higherIsFirst);

  const session = applyRoundResult(state.session, correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, correct);

  return {
    correct,
    state: { session, difficulty, round: { ...state.round, awaitingAnswer: false } },
  };
}

/** Wires the pure state machine up to audio playback, storage, and the DOM. */
export function mountHigherLower(root: HTMLElement, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.higherLower.level);
  let busy = false;
  let playingIndex: 0 | 1 | null = null;
  let lastAnswer: AnswerResult | null = null;
  let lastGain = 0;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(correct: boolean): void {
    const p = loadProfile();
    p.higherLower.level = game.difficulty.level;
    p.higherLower.played += 1;
    if (correct) p.higherLower.correct += 1;
    p.higherLower.bestScore = Math.max(p.higherLower.bestScore, game.session.score);
    p.higherLower.bestStreak = Math.max(p.higherLower.bestStreak, game.session.bestStreak);
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
        gameName: "Higher or Lower",
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
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — the gap between notes just got smaller.`;
      root.appendChild(banner);
    }

    root.appendChild(buildLevelProgress(game.difficulty.level, MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK));

    const panel = document.createElement("div");
    panel.className = "panel";

    if (!game.round) {
      panel.appendChild(makeMessage("Two notes will play, back to back. Which one was higher?"));
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-block";
      btn.textContent = "PLAY NOTES";
      btn.disabled = busy;
      btn.addEventListener("click", () => void handlePlay());
      panel.appendChild(btn);
      root.appendChild(panel);
      return;
    }

    if (lastAnswer) {
      const flash = document.createElement("div");
      flash.className = `feedback-flash ${lastAnswer.correct ? "is-correct" : "is-incorrect"}`;
      const title = document.createElement("div");
      title.className = "feedback-title";
      title.textContent = lastAnswer.correct ? "Correct!" : "Not quite.";
      flash.appendChild(title);
      if (lastAnswer.correct) {
        const xp = document.createElement("div");
        xp.className = "feedback-xp";
        xp.textContent = `+${lastGain} XP`;
        flash.appendChild(xp);
      } else {
        const explain = document.createElement("div");
        explain.className = "panel-message";
        explain.style.marginTop = "0.5rem";
        const higherWasFirst = game.round.midiA > game.round.midiB;
        explain.textContent = `The ${higherWasFirst ? "first" : "second"} note was higher.`;
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

    const noteRow = document.createElement("div");
    noteRow.className = "note-row";
    noteRow.append(buildNoteCard("NOTE 1", playingIndex === 0), buildNoteCard("NOTE 2", playingIndex === 1));
    panel.appendChild(noteRow);

    if (!game.round.awaitingAnswer) {
      const replay = document.createElement("button");
      replay.className = "btn-block";
      replay.textContent = busy ? "Playing…" : "▸ Replay";
      replay.disabled = busy;
      replay.addEventListener("click", () => void handlePlay());
      panel.appendChild(replay);
    } else if (busy) {
      panel.appendChild(makeMessage("Listening…"));
    } else {
      const choiceRow = document.createElement("div");
      choiceRow.className = "choice-row";
      choiceRow.appendChild(buildChoiceButton("A", "HIGHER = FIRST", () => handleAnswer("first")));
      choiceRow.appendChild(buildChoiceButton("B", "HIGHER = SECOND", () => handleAnswer("second")));
      panel.appendChild(choiceRow);

      const replay = document.createElement("button");
      replay.className = "btn-block";
      replay.style.marginTop = "0.75rem";
      replay.textContent = "▸ Replay notes";
      replay.addEventListener("click", () => void handlePlay());
      panel.appendChild(replay);
    }

    root.appendChild(panel);
  }

  function makeMessage(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function buildNoteCard(label: string, isPlaying: boolean): HTMLElement {
    const card = document.createElement("div");
    card.className = "note-card" + (isPlaying ? " is-playing" : "");
    const cardLabel = document.createElement("div");
    cardLabel.className = "note-card-label";
    cardLabel.textContent = label;
    const icon = document.createElement("div");
    icon.className = "note-card-icon";
    icon.textContent = "🎵";
    card.append(cardLabel, icon);
    if (isPlaying) {
      const eq = document.createElement("div");
      eq.className = "eq-bars";
      eq.innerHTML = "<span></span><span></span><span></span><span></span>";
      card.appendChild(eq);
    }
    return card;
  }

  function buildChoiceButton(letter: string, label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    const l = document.createElement("span");
    l.className = "choice-btn-letter";
    l.textContent = letter;
    const t = document.createElement("span");
    t.className = "choice-btn-label";
    t.textContent = label;
    btn.append(l, t);
    btn.addEventListener("click", onClick);
    return btn;
  }

  async function handlePlay(): Promise<void> {
    if (busy) return;
    busy = true;
    lastAnswer = null;
    streakJustIncreased = false;
    leveledUpTo = null;
    if (!game.round || !game.round.awaitingAnswer) {
      game = startRound(game);
    }
    render();

    const { midiA, midiB } = game.round!;
    playingIndex = 0;
    render();
    await playNote(midiToHz(midiA));
    await delay(200);
    playingIndex = 1;
    render();
    await playNote(midiToHz(midiB));

    playingIndex = null;
    busy = false;
    render();
  }

  function handleAnswer(answer: Answer): void {
    if (busy || !game.round?.awaitingAnswer) return;
    const levelBefore = game.difficulty.level;
    const scoreBefore = game.session.score;
    const result = submitAnswer(game, answer);
    game = result.state;
    persist(result.correct);
    lastAnswer = result;
    lastGain = game.session.score - scoreBefore;
    streakJustIncreased = result.correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    render();
  }

  render();
}
