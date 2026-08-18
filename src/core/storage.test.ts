import { describe, it, expect, beforeEach } from "vitest";
import { loadProfile, saveProfile, defaultProfile } from "./storage.ts";

// Node's test environment may not ship a real Storage implementation;
// a minimal in-memory stand-in is enough to exercise our wrapper logic.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

describe("profile storage", () => {
  it("returns a default profile when nothing is stored", () => {
    expect(loadProfile()).toEqual(defaultProfile());
  });

  it("round-trips a saved profile", () => {
    const profile = defaultProfile();
    profile.higherLower.level = 3;
    profile.higherLower.bestScore = 250;
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });

  it("falls back to default on corrupted JSON", () => {
    localStorage.setItem("evt.v1.profile", "{not json");
    expect(loadProfile()).toEqual(defaultProfile());
  });

  it("falls back to default on an unknown version", () => {
    localStorage.setItem("evt.v1.profile", JSON.stringify({ version: 99 }));
    expect(loadProfile()).toEqual(defaultProfile());
  });
});
