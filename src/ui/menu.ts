import { loadProfile, type GameProgress } from "../core/storage.ts";
import {
  MAX_LEVEL,
  PITCH_MATCH_MAX_LEVEL,
  HOLD_PITCH_MAX_LEVEL,
  INTERVAL_DETECTIVE_MAX_LEVEL,
  NOTE_MEMORY_MAX_LEVEL,
  SING_SCALE_MAX_LEVEL,
} from "../core/difficulty.ts";
import type { GameId } from "../core/skill-profile.ts";

export type { GameId };

export interface MenuEntry {
  id: GameId;
  index: string;
  title: string;
  description: string;
  icon: string;
  maxLevel: number;
  enabled: boolean;
}

const ENTRIES: MenuEntry[] = [
  {
    id: "higher-lower",
    index: "01",
    title: "Higher or Lower",
    description: "Train your ability to recognize relative pitch.",
    icon: "🎵",
    maxLevel: MAX_LEVEL,
    enabled: true,
  },
  {
    id: "pitch-match",
    index: "02",
    title: "Pitch Match",
    description: "Listen to a note and match it with your voice.",
    icon: "🎤",
    maxLevel: PITCH_MATCH_MAX_LEVEL,
    enabled: true,
  },
  {
    id: "hold-pitch",
    index: "03",
    title: "Hold the Pitch",
    description: "Keep your voice locked onto the target.",
    icon: "📈",
    maxLevel: HOLD_PITCH_MAX_LEVEL,
    enabled: true,
  },
  {
    id: "interval-detective",
    index: "04",
    title: "Interval Detective",
    description: "Name the interval between two notes.",
    icon: "🔍",
    maxLevel: INTERVAL_DETECTIVE_MAX_LEVEL,
    enabled: true,
  },
  {
    id: "note-memory",
    index: "05",
    title: "Note Memory",
    description: "Hear a sequence of notes, then tap it back.",
    icon: "🧠",
    maxLevel: NOTE_MEMORY_MAX_LEVEL,
    enabled: true,
  },
  {
    id: "sing-scale",
    index: "06",
    title: "Sing the Scale",
    description: "Sing a full scale, evaluated note by note.",
    icon: "🎼",
    maxLevel: SING_SCALE_MAX_LEVEL,
    enabled: true,
  },
];

export function renderMenu(root: HTMLElement, onSelect: (id: GameId) => void, onShowProfile: () => void): void {
  root.innerHTML = "";
  const profile = loadProfile();

  const header = document.createElement("div");
  header.className = "app-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Ear & Vocal Training";
  const sub = document.createElement("div");
  sub.className = "subhead";
  sub.textContent = "Train your ear. Find your voice.";
  header.append(h1, sub);
  root.appendChild(header);

  const profileLink = document.createElement("button");
  profileLink.className = "back-link";
  profileLink.textContent = "📊 Your Skill Profile";
  profileLink.addEventListener("click", onShowProfile);
  root.appendChild(profileLink);

  const list = document.createElement("div");
  list.className = "menu-list";

  const progressByGame: Record<GameId, GameProgress> = {
    "higher-lower": profile.higherLower,
    "pitch-match": profile.pitchMatch,
    "hold-pitch": profile.holdPitch,
    "interval-detective": profile.intervalDetective,
    "note-memory": profile.noteMemory,
    "sing-scale": profile.singScale,
  };

  ENTRIES.forEach((entry, i) => {
    const progress = progressByGame[entry.id];

    const button = document.createElement("button");
    button.className = "game-card";
    button.disabled = !entry.enabled;
    button.style.animationDelay = `${i * 60}ms`;

    const badge = document.createElement("span");
    badge.className = "game-card-badge";
    badge.textContent = entry.enabled ? "" : "Coming soon";
    button.appendChild(badge);

    const icon = document.createElement("div");
    icon.className = "game-card-icon";
    icon.textContent = entry.icon;

    const body = document.createElement("div");
    body.className = "game-card-body";

    const index = document.createElement("div");
    index.className = "game-card-index";
    index.textContent = `${entry.index} — ${entry.title.toUpperCase()}`;

    const desc = document.createElement("div");
    desc.className = "game-card-desc";
    desc.textContent = entry.description;

    const stats = document.createElement("div");
    stats.className = "game-card-stats";
    stats.innerHTML =
      `<span>Level <strong>${progress.level}/${entry.maxLevel}</strong></span>` +
      `<span>Best <strong>${progress.bestScore}</strong></span>` +
      `<span>Streak <strong>${progress.bestStreak}</strong></span>`;

    body.append(index, desc, stats);

    const cta = document.createElement("span");
    cta.className = "game-card-cta btn-primary";
    cta.textContent = entry.enabled ? "PLAY" : "SOON";

    button.append(icon, body, cta);
    button.addEventListener("click", () => onSelect(entry.id));
    list.appendChild(button);
  });

  root.appendChild(list);
}
