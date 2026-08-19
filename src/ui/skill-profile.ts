import { loadProfile } from "../core/storage.ts";
import { ALL_SKILL_TAGS, SKILL_TAG_LABELS, SKILL_TAG_PILLAR, diagnose, type GameId } from "../core/skill-profile.ts";

/** Diagnosis + per-tag mastery view — the "Analyze / Identify Weakness" half of the core loop, made visible. */
export function mountSkillProfile(root: HTMLElement, onSelectGame: (id: GameId) => void, onExit: () => void): void {
  root.innerHTML = "";
  const profile = loadProfile();

  const back = document.createElement("button");
  back.textContent = "← Menu";
  back.className = "back-link";
  back.addEventListener("click", onExit);
  root.appendChild(back);

  const header = document.createElement("div");
  header.className = "app-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Your Skill Profile";
  const sub = document.createElement("div");
  sub.className = "subhead";
  sub.textContent = "What you're strong at, and what to practice next.";
  header.append(h1, sub);
  root.appendChild(header);

  const diagnosis = diagnose(profile.skillProfile);
  if (diagnosis) {
    const card = document.createElement("div");
    card.className = "panel";
    const label = document.createElement("p");
    label.textContent = `Recommended for you: ${diagnosis.label}`;
    const btn = document.createElement("button");
    btn.className = "btn-primary btn-block";
    btn.textContent = "PRACTICE THIS →";
    btn.addEventListener("click", () => onSelectGame(diagnosis.recommendedGameId));
    card.append(label, btn);
    root.appendChild(card);
  }

  const list = document.createElement("div");
  list.className = "menu-list";
  for (const tag of ALL_SKILL_TAGS) {
    const stat = profile.skillProfile[tag];
    const row = document.createElement("div");
    row.className = "panel";

    const title = document.createElement("div");
    title.className = "panel-message";
    title.textContent = `[${SKILL_TAG_PILLAR[tag].toUpperCase()}] ${SKILL_TAG_LABELS[tag]}`;
    row.appendChild(title);

    const track = document.createElement("div");
    track.className = "level-progress-track";
    const fill = document.createElement("div");
    fill.className = "level-progress-fill";
    fill.style.width = `${stat ? Math.round(stat.mastery) : 0}%`;
    track.appendChild(fill);
    row.appendChild(track);

    const value = document.createElement("div");
    value.className = "hud-level";
    value.textContent = stat ? `${Math.round(stat.mastery)}% mastery — ${stat.attempts} attempt${stat.attempts === 1 ? "" : "s"}` : "Not yet tried";
    row.appendChild(value);

    list.appendChild(row);
  }
  root.appendChild(list);
}
