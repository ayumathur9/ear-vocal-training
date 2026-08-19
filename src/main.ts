import "./styles.css";
import { renderMenu, type GameId } from "./ui/menu.ts";
import { mountHigherLower } from "./games/higher-lower.ts";
import { mountPitchMatch } from "./games/pitch-match.ts";
import { mountHoldPitch } from "./games/hold-pitch.ts";
import { mountIntervalDetective } from "./games/interval-detective.ts";
import { mountNoteMemory } from "./games/note-memory.ts";
import { mountSingScale } from "./games/sing-scale.ts";
import { mountMicCheck } from "./ui/mic-check.ts";
import { mountSkillProfile } from "./ui/skill-profile.ts";
import { loadProfile, type VocalRange } from "./core/storage.ts";

const root = document.getElementById("app");
if (!root) throw new Error("#app root element missing");

function showMenu(): void {
  renderMenu(root!, onSelectGame, showSkillProfile);
}

function showSkillProfile(): void {
  mountSkillProfile(root!, onSelectGame, showMenu);
}

/** Calibration (M6) is a prerequisite for any mic-based game — run it first if the profile doesn't have a range yet. */
function withCalibratedRange(mount: (range: VocalRange) => void): void {
  const profile = loadProfile();
  if (profile.range) {
    mount(profile.range);
  } else {
    mountMicCheck(root!, (calibrated) => mount(calibrated.range!));
  }
}

function onSelectGame(id: GameId): void {
  if (id === "higher-lower") {
    mountHigherLower(root!, showMenu);
    return;
  }
  if (id === "pitch-match") {
    withCalibratedRange((range) => mountPitchMatch(root!, range, showMenu));
    return;
  }
  if (id === "hold-pitch") {
    withCalibratedRange((range) => mountHoldPitch(root!, range, showMenu));
    return;
  }
  if (id === "interval-detective") {
    mountIntervalDetective(root!, showMenu);
    return;
  }
  if (id === "note-memory") {
    mountNoteMemory(root!, showMenu);
    return;
  }
  if (id === "sing-scale") {
    withCalibratedRange((range) => mountSingScale(root!, range, showMenu));
    return;
  }
}

showMenu();
