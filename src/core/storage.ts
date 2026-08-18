const STORAGE_KEY = "evt.v1.profile";

export interface GameProgress {
  level: number;
  bestScore: number;
  bestStreak: number;
  played: number;
  correct: number;
}

export interface VocalRange {
  lowHz: number;
  highHz: number;
}

export interface MicCalibration {
  noiseFloorDb: number;
}

export interface Profile {
  version: 1;
  higherLower: GameProgress;
  pitchMatch: GameProgress;
  holdPitch: GameProgress;
  range?: VocalRange;
  mic?: MicCalibration;
}

function defaultProgress(): GameProgress {
  return { level: 1, bestScore: 0, bestStreak: 0, played: 0, correct: 0 };
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    higherLower: defaultProgress(),
    pitchMatch: defaultProgress(),
    holdPitch: defaultProgress(),
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return defaultProfile();
    return { ...defaultProfile(), ...parsed };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
