import { mountMicCheck } from "./src/ui/mic-check.ts";
import type { Profile } from "./src/core/storage.ts";

const root = document.getElementById("app")!;
const log = document.getElementById("log")!;

(window as any).__calibrationDebug = { profile: null as Profile | null };

mountMicCheck(root, (profile) => {
  (window as any).__calibrationDebug.profile = profile;
  log.textContent = JSON.stringify(profile, null, 2);
});
