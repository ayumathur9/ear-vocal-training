import { describe, it, expect } from "vitest";
import { createGame, startRound, submitAnswer } from "./interval-detective.ts";

describe("interval-detective state machine", () => {
  it("starts a round with a target the round's semitone distance from the root", () => {
    const game = startRound(createGame(1));
    expect(game.round).not.toBeNull();
    const { rootMidi, targetMidi, semitones, direction } = game.round!;
    if (direction === "descending") {
      expect(targetMidi).toBe(rootMidi - semitones);
    } else {
      expect(targetMidi).toBe(rootMidi + semitones);
    }
    expect(game.round!.awaitingAnswer).toBe(true);
  });

  it("marks the correct semitone answer correct and increases score", () => {
    let game = createGame(1);
    game = { ...game, round: { rootMidi: 60, targetMidi: 67, semitones: 7, direction: "ascending", choices: [0, 7, 12], awaitingAnswer: true } };
    const result = submitAnswer(game, 7);
    expect(result.correct).toBe(true);
    expect(result.state.session.score).toBeGreaterThan(0);
  });

  it("marks a wrong semitone answer incorrect and resets streak", () => {
    let game = createGame(1);
    game = { ...game, round: { rootMidi: 60, targetMidi: 67, semitones: 7, direction: "ascending", choices: [0, 7, 12], awaitingAnswer: true } };
    const result = submitAnswer(game, 12);
    expect(result.correct).toBe(false);
    expect(result.state.session.streak).toBe(0);
  });

  it("throws if answering when no round is awaiting an answer", () => {
    const game = createGame(1);
    expect(() => submitAnswer(game, 7)).toThrow();
  });

  it("promotes difficulty after 3 correct rounds in a row", () => {
    let game = createGame(1);
    for (let i = 0; i < 3; i++) {
      game = { ...game, round: { rootMidi: 60, targetMidi: 67, semitones: 7, direction: "ascending", choices: [0, 7, 12], awaitingAnswer: true } };
      game = submitAnswer(game, 7).state;
    }
    expect(game.difficulty.level).toBe(2);
  });
});
