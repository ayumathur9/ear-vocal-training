export interface HudOptions {
  gameName: string;
  level: number;
  round: number;
  score: number;
  streak: number;
  /** Play the streak "pop" animation — pass true only on the render right after a streak increase. */
  streakJustIncreased?: boolean;
}

/**
 * Shared HUD strip used by all three games: name, level, round, score,
 * streak. Purely presentational — reads whatever the game's session/
 * difficulty state already computed, never recomputes it.
 */
export function buildHud(opts: HudOptions): HTMLElement {
  const hud = document.createElement("div");
  hud.className = "hud";

  const left = document.createElement("div");
  const name = document.createElement("div");
  name.className = "hud-name";
  name.textContent = opts.gameName.toUpperCase();
  const levelRow = document.createElement("div");
  levelRow.className = "hud-level";
  levelRow.textContent = `Level ${opts.level}`;
  const round = document.createElement("div");
  round.className = "hud-round";
  round.textContent = `ROUND ${String(opts.round).padStart(2, "0")}`;
  left.append(name, levelRow, round);

  const right = document.createElement("div");
  right.className = "hud-right";
  const score = document.createElement("div");
  score.className = "hud-score";
  score.textContent = `${opts.score}`;
  const streak = document.createElement("div");
  streak.className = "hud-streak" + (opts.streakJustIncreased ? " pulse" : "");
  streak.textContent = opts.streak > 0 ? `🔥 ${opts.streak}` : "—";
  right.append(score, streak);

  hud.append(left, right);
  return hud;
}

/**
 * "LEVEL 03 / ████████░░░ / 2 / 3 correct to level up" — reads straight
 * from DifficultyState, which already tracks consecutiveCorrect; no new
 * state, just surfacing what the difficulty engine already computes.
 */
export function buildLevelProgress(level: number, maxLevel: number, consecutiveCorrect: number, promoteAfter: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "level-progress";

  const labelRow = document.createElement("div");
  labelRow.className = "level-progress-label";
  const levelLabel = document.createElement("span");
  levelLabel.textContent = `LEVEL ${String(level).padStart(2, "0")}`;
  const detail = document.createElement("span");
  detail.textContent = level >= maxLevel ? "MAX LEVEL" : `${consecutiveCorrect} / ${promoteAfter} correct to level up`;
  labelRow.append(levelLabel, detail);

  const track = document.createElement("div");
  track.className = "level-progress-track";
  const fill = document.createElement("div");
  fill.className = "level-progress-fill";
  const pct = level >= maxLevel ? 100 : (consecutiveCorrect / promoteAfter) * 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  wrap.append(labelRow, track);
  return wrap;
}
