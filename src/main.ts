import "./styles.css";
import { renderMenu, type GameId } from "./ui/menu.ts";
import { mountHigherLower } from "./games/higher-lower.ts";
import { mountPitchMatch } from "./games/pitch-match.ts";
import { mountHoldPitch } from "./games/hold-pitch.ts";
import { mountMicCheck } from "./ui/mic-check.ts";
import { loadProfile, type VocalRange } from "./core/storage.ts";

const root = document.getElementById("app");
if (!root) throw new Error("#app root element missing");

function showMenu(): void {
  renderMenu(root!, onSelectGame);
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
}

showMenu();
