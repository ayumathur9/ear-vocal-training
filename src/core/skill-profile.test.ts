import { describe, it, expect } from "vitest";
import { recordAttempt, weakestTags, diagnose, ALL_SKILL_TAGS, type SkillProfile } from "./skill-profile.ts";

describe("recordAttempt", () => {
  it("seeds mastery at the first attempt's accuracy", () => {
    const profile = recordAttempt({}, "ear:relative-pitch", 80, 1000);
    expect(profile["ear:relative-pitch"]!.mastery).toBe(80);
    expect(profile["ear:relative-pitch"]!.attempts).toBe(1);
  });

  it("moves mastery toward new attempts via an EMA, not an average that weights all history equally", () => {
    let profile: SkillProfile = recordAttempt({}, "ear:relative-pitch", 0, 1000);
    profile = recordAttempt(profile, "ear:relative-pitch", 100, 2000);
    const mastery = profile["ear:relative-pitch"]!.mastery;
    expect(mastery).toBeGreaterThan(0);
    expect(mastery).toBeLessThan(100);
    expect(profile["ear:relative-pitch"]!.attempts).toBe(2);
  });

  it("clamps out-of-range accuracy into 0-100", () => {
    const profile = recordAttempt({}, "ear:relative-pitch", 500, 1000);
    expect(profile["ear:relative-pitch"]!.mastery).toBe(100);
  });

  it("does not mutate the input profile", () => {
    const original: SkillProfile = {};
    recordAttempt(original, "ear:relative-pitch", 80, 1000);
    expect(original).toEqual({});
  });
});

describe("weakestTags", () => {
  it("ranks a never-tried tag as weaker than one with low mastery", () => {
    const profile = recordAttempt({}, "ear:relative-pitch", 10, 1000);
    const [weakest] = weakestTags(profile, 1);
    expect(weakest).not.toBe("ear:relative-pitch");
  });

  it("ranks lower mastery before higher mastery", () => {
    let profile: SkillProfile = {};
    profile = recordAttempt(profile, "ear:relative-pitch", 90, 1000);
    profile = recordAttempt(profile, "voice:pitch-match", 20, 1000);
    for (const tag of ALL_SKILL_TAGS) {
      if (tag !== "ear:relative-pitch" && tag !== "voice:pitch-match") {
        profile = recordAttempt(profile, tag, 95, 1000);
      }
    }
    const ranked = weakestTags(profile);
    expect(ranked[0]).toBe("voice:pitch-match");
  });

  it("breaks ties between untried tags by original tag order (stable, deterministic)", () => {
    const ranked = weakestTags({});
    expect(ranked).toEqual(ALL_SKILL_TAGS);
  });

  it("respects the n limit", () => {
    expect(weakestTags({}, 2)).toHaveLength(2);
  });
});

describe("diagnose", () => {
  it("recommends the game mapped to the single weakest tag", () => {
    let profile: SkillProfile = {};
    for (const tag of ALL_SKILL_TAGS) {
      profile = recordAttempt(profile, tag, tag === "ear:intervals:descending" ? 5 : 90, 1000);
    }
    const diagnosis = diagnose(profile);
    expect(diagnosis?.tag).toBe("ear:intervals:descending");
    expect(diagnosis?.recommendedGameId).toBe("interval-detective");
    expect(diagnosis?.pillar).toBe("ear");
  });

  it("recommends something even with a completely empty profile", () => {
    expect(diagnose({})).not.toBeNull();
  });
});
