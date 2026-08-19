export type GameId = "higher-lower" | "pitch-match" | "hold-pitch" | "interval-detective" | "note-memory" | "sing-scale";

export type Pillar = "ear" | "voice";

export type SkillTag =
  | "ear:relative-pitch"
  | "ear:intervals:ascending"
  | "ear:intervals:descending"
  | "ear:intervals:harmonic"
  | "ear:note-memory"
  | "voice:pitch-match"
  | "voice:hold-stability"
  | "voice:scale-singing";

export interface SkillStat {
  attempts: number;
  /** EMA of per-attempt accuracy (0-100) — one formula every game's result feeds, whether it's a binary right/wrong or a continuous accuracy percentage. */
  mastery: number;
  lastPlayedAt: number;
}

export type SkillProfile = Partial<Record<SkillTag, SkillStat>>;

const EMA_ALPHA = 0.25;

export const SKILL_TAG_LABELS: Record<SkillTag, string> = {
  "ear:relative-pitch": "Relative Pitch (Higher/Lower)",
  "ear:intervals:ascending": "Intervals — Ascending",
  "ear:intervals:descending": "Intervals — Descending",
  "ear:intervals:harmonic": "Intervals — Harmonic",
  "ear:note-memory": "Note Memory",
  "voice:pitch-match": "Pitch Matching",
  "voice:hold-stability": "Hold Stability",
  "voice:scale-singing": "Scale Singing",
};

export const SKILL_TAG_PILLAR: Record<SkillTag, Pillar> = {
  "ear:relative-pitch": "ear",
  "ear:intervals:ascending": "ear",
  "ear:intervals:descending": "ear",
  "ear:intervals:harmonic": "ear",
  "ear:note-memory": "ear",
  "voice:pitch-match": "voice",
  "voice:hold-stability": "voice",
  "voice:scale-singing": "voice",
};

const TAG_TO_GAME: Record<SkillTag, GameId> = {
  "ear:relative-pitch": "higher-lower",
  "ear:intervals:ascending": "interval-detective",
  "ear:intervals:descending": "interval-detective",
  "ear:intervals:harmonic": "interval-detective",
  "ear:note-memory": "note-memory",
  "voice:pitch-match": "pitch-match",
  "voice:hold-stability": "hold-pitch",
  "voice:scale-singing": "sing-scale",
};

export const ALL_SKILL_TAGS = Object.keys(SKILL_TAG_LABELS) as SkillTag[];

/** Folds one attempt's accuracy into a tag's running mastery EMA. Pure — returns a new profile. */
export function recordAttempt(profile: SkillProfile, tag: SkillTag, accuracy0to100: number, now: number): SkillProfile {
  const clamped = Math.max(0, Math.min(100, accuracy0to100));
  const existing = profile[tag];
  const mastery = existing ? existing.mastery + EMA_ALPHA * (clamped - existing.mastery) : clamped;
  return {
    ...profile,
    [tag]: {
      attempts: (existing?.attempts ?? 0) + 1,
      mastery,
      lastPlayedAt: now,
    },
  };
}

/**
 * Ranks tags weakest-first. A tag never attempted ranks as mastery 0 (the
 * weakest possible), so a new user's diagnosis pushes toward breadth across
 * all tags before depth on any one; ties break by staleness (never-played
 * first, then longest since last played).
 */
export function weakestTags(profile: SkillProfile, n: number = ALL_SKILL_TAGS.length): SkillTag[] {
  return [...ALL_SKILL_TAGS]
    .sort((a, b) => {
      const statA = profile[a];
      const statB = profile[b];
      const masteryA = statA?.mastery ?? 0;
      const masteryB = statB?.mastery ?? 0;
      if (masteryA !== masteryB) return masteryA - masteryB;
      return (statA?.lastPlayedAt ?? 0) - (statB?.lastPlayedAt ?? 0);
    })
    .slice(0, n);
}

export interface Diagnosis {
  tag: SkillTag;
  pillar: Pillar;
  label: string;
  recommendedGameId: GameId;
}

/** The single weakest tag, translated into a concrete next exercise to play. Null only if there are no tags at all. */
export function diagnose(profile: SkillProfile): Diagnosis | null {
  const [weakest] = weakestTags(profile, 1);
  if (!weakest) return null;
  return {
    tag: weakest,
    pillar: SKILL_TAG_PILLAR[weakest],
    label: SKILL_TAG_LABELS[weakest],
    recommendedGameId: TAG_TO_GAME[weakest],
  };
}
