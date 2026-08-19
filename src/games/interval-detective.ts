import { midiToHz } from "../core/notes.ts";
import { randomIntervalQuestion, intervalName, type IntervalDirection } from "../core/intervals.ts";
import {
  intervalDetectiveLevelConfig,
  initialDifficultyState,
  nextDifficultyState,
  INTERVAL_DETECTIVE_MAX_LEVEL,
  PROMOTE_AFTER_STREAK,
  type DifficultyState,
} from "../core/difficulty.ts";
import { initialSessionState, applyRoundResult, type SessionState } from "../core/scoring.ts";
import { loadProfile, saveProfile } from "../core/storage.ts";
import { recordAttempt } from "../core/skill-profile.ts";
import { playNotePair, playChord } from "../audio/engine.ts";
import { buildHud, buildLevelProgress } from "../ui/hud.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface IntervalRoundState {
  rootMidi: number;
  targetMidi: number;
  semitones: number;
  direction: IntervalDirection;
  choices: number[];
  awaitingAnswer: boolean;
}

export interface IntervalGameState {
  session: SessionState;
  difficulty: DifficultyState;
  round: IntervalRoundState | null;
}

/** Pure state machine, no DOM/audio side effects — kept testable in isolation. */
export function createGame(startingLevel = 1): IntervalGameState {
  return {
    session: initialSessionState(),
    difficulty: { ...initialDifficultyState(), level: startingLevel },
    round: null,
  };
}

export function startRound(state: IntervalGameState, rng: () => number = Math.random): IntervalGameState {
  const cfg = intervalDetectiveLevelConfig(state.difficulty.level);
  const direction = cfg.directions[Math.floor(rng() * cfg.directions.length)];
  const q = randomIntervalQuestion(cfg.lowMidi, cfg.highMidi, cfg.semitoneChoices, direction, rng);
  return {
    ...state,
    round: { ...q, choices: cfg.semitoneChoices, awaitingAnswer: true },
  };
}

export interface AnswerResult {
  correct: boolean;
  state: IntervalGameState;
}

export function submitAnswer(state: IntervalGameState, answerSemitones: number): AnswerResult {
  if (!state.round || !state.round.awaitingAnswer) {
    throw new Error("No round is currently awaiting an answer");
  }
  const correct = answerSemitones === state.round.semitones;
  const session = applyRoundResult(state.session, correct, state.difficulty.level);
  const difficulty = nextDifficultyState(state.difficulty, correct, INTERVAL_DETECTIVE_MAX_LEVEL);

  return {
    correct,
    state: { session, difficulty, round: { ...state.round, awaitingAnswer: false } },
  };
}

/** Wires the pure state machine up to audio playback, storage, and the DOM. */
export function mountIntervalDetective(root: HTMLElement, onExit: () => void): void {
  const profile = loadProfile();
  let game = createGame(profile.intervalDetective.level);
  let busy = false;
  let lastAnswer: (AnswerResult & { chosenSemitones: number }) | null = null;
  let lastGain = 0;
  let streakJustIncreased = false;
  let leveledUpTo: number | null = null;

  function persist(correct: boolean, direction: IntervalDirection): void {
    const p = loadProfile();
    p.intervalDetective.level = game.difficulty.level;
    p.intervalDetective.played += 1;
    if (correct) p.intervalDetective.correct += 1;
    p.intervalDetective.bestScore = Math.max(p.intervalDetective.bestScore, game.session.score);
    p.intervalDetective.bestStreak = Math.max(p.intervalDetective.bestStreak, game.session.bestStreak);
    p.skillProfile = recordAttempt(p.skillProfile, `ear:intervals:${direction}`, correct ? 100 : 0, Date.now());
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
        gameName: "Interval Detective",
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
      banner.textContent = `LEVEL UP! Now on Level ${leveledUpTo} — new intervals unlocked.`;
      root.appendChild(banner);
    }

    root.appendChild(
      buildLevelProgress(game.difficulty.level, INTERVAL_DETECTIVE_MAX_LEVEL, game.difficulty.consecutiveCorrect, PROMOTE_AFTER_STREAK),
    );

    const panel = document.createElement("div");
    panel.className = "panel";

    if (!game.round) {
      panel.appendChild(makeMessage("Two notes will play. What interval is between them?"));
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-block";
      btn.textContent = "PLAY INTERVAL";
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
        explain.textContent = `It was a ${intervalName(game.round.semitones).name} (${intervalName(game.round.semitones).short}).`;
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

    const modeLabel = document.createElement("div");
    modeLabel.className = "panel-message";
    modeLabel.textContent =
      game.round.direction === "harmonic" ? "Played together — what interval?" : `Played ${game.round.direction} — what interval?`;
    panel.appendChild(modeLabel);

    if (busy) {
      panel.appendChild(makeMessage("Listening…"));
    } else {
      const choiceGrid = document.createElement("div");
      choiceGrid.className = "choice-row";
      choiceGrid.style.flexWrap = "wrap";
      for (const semitones of game.round.choices) {
        const info = intervalName(semitones);
        choiceGrid.appendChild(buildChoiceButton(info.short, info.name, () => handleAnswer(semitones)));
      }
      panel.appendChild(choiceGrid);

      const replay = document.createElement("button");
      replay.className = "btn-block";
      replay.style.marginTop = "0.75rem";
      replay.textContent = "▸ Replay interval";
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

    const { rootMidi, targetMidi, direction } = game.round!;
    const rootHz = midiToHz(rootMidi);
    const targetHz = midiToHz(targetMidi);

    if (direction === "harmonic") {
      await playChord([rootHz, targetHz], { durationMs: 1200 });
    } else if (direction === "ascending") {
      await playNotePair(rootHz, targetHz);
    } else {
      await playNotePair(rootHz, targetHz); // root always plays first; target's placement below it already encodes "descending"
    }

    await delay(50);
    busy = false;
    render();
  }

  function handleAnswer(answerSemitones: number): void {
    if (busy || !game.round?.awaitingAnswer) return;
    const levelBefore = game.difficulty.level;
    const scoreBefore = game.session.score;
    const direction = game.round.direction;
    const result = submitAnswer(game, answerSemitones);
    game = result.state;
    persist(result.correct, direction);
    lastAnswer = { ...result, chosenSemitones: answerSemitones };
    lastGain = game.session.score - scoreBefore;
    streakJustIncreased = result.correct;
    leveledUpTo = game.difficulty.level > levelBefore ? game.difficulty.level : null;
    render();
  }

  render();
}
