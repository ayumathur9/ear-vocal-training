import { describe, it, expect } from "vitest";
import { createGame, startRound, submitAnswer } from "./higher-lower.ts";

describe("higher-lower state machine", () => {
  it("starts a round with two distinct notes at least the level's gap apart", () => {
    const game = startRound(createGame(1));
    expect(game.round).not.toBeNull();
    const { midiA, midiB } = game.round!;
    expect(Math.abs(midiA - midiB)).toBeGreaterThanOrEqual(12); // level 1 gap
    expect(game.round!.awaitingAnswer).toBe(true);
  });

  it("scores 'first' correct when the first note is genuinely higher", () => {
    let game = createGame(1);
    game = { ...game, round: { midiA: 72, midiB: 60, awaitingAnswer: true } };
    const result = submitAnswer(game, "first");
    expect(result.correct).toBe(true);
    expect(result.state.session.score).toBeGreaterThan(0);
  });

  it("scores 'second' correct when the second note is genuinely higher", () => {
    let game = createGame(1);
    game = { ...game, round: { midiA: 60, midiB: 72, awaitingAnswer: true } };
    const result = submitAnswer(game, "second");
    expect(result.correct).toBe(true);
  });

  it("marks a wrong guess incorrect and resets streak", () => {
    let game = createGame(1);
    game = { ...game, round: { midiA: 72, midiB: 60, awaitingAnswer: true } };
    const result = submitAnswer(game, "second");
    expect(result.correct).toBe(false);
    expect(result.state.session.streak).toBe(0);
  });

  it("throws if answering when no round is awaiting an answer", () => {
    const game = createGame(1);
    expect(() => submitAnswer(game, "first")).toThrow();
  });

  it("promotes difficulty after 3 correct rounds in a row", () => {
    let game = createGame(1);
    for (let i = 0; i < 3; i++) {
      game = { ...game, round: { midiA: 72, midiB: 60, awaitingAnswer: true } };
      game = submitAnswer(game, "first").state;
    }
    expect(game.difficulty.level).toBe(2);
  });
});
