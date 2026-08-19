import { describe, it, expect } from "vitest";
import { createGame, startRound, submitGuess } from "./note-memory.ts";

describe("note-memory state machine", () => {
  it("starts a round with the level's sequence length", () => {
    const game = startRound(createGame(1));
    expect(game.round).not.toBeNull();
    expect(game.round!.sequence).toHaveLength(3); // level 1
    expect(game.round!.awaitingAnswer).toBe(true);
  });

  it("marks an exact guess correct and increases score", () => {
    let game = createGame(1);
    game = { ...game, round: { sequence: [60, 62, 64], pool: [60, 62, 64, 65], guess: [], awaitingAnswer: true } };
    const result = submitGuess(game, [60, 62, 64]);
    expect(result.correct).toBe(true);
    expect(result.state.session.score).toBeGreaterThan(0);
  });

  it("marks a wrong guess incorrect and resets streak", () => {
    let game = createGame(1);
    game = { ...game, round: { sequence: [60, 62, 64], pool: [60, 62, 64, 65], guess: [], awaitingAnswer: true } };
    const result = submitGuess(game, [60, 64, 62]);
    expect(result.correct).toBe(false);
    expect(result.state.session.streak).toBe(0);
  });

  it("throws if guessing when no round is awaiting an answer", () => {
    const game = createGame(1);
    expect(() => submitGuess(game, [60])).toThrow();
  });

  it("promotes difficulty after 3 correct rounds in a row", () => {
    let game = createGame(1);
    for (let i = 0; i < 3; i++) {
      game = { ...game, round: { sequence: [60, 62, 64], pool: [60, 62, 64, 65], guess: [], awaitingAnswer: true } };
      game = submitGuess(game, [60, 62, 64]).state;
    }
    expect(game.difficulty.level).toBe(2);
  });
});
