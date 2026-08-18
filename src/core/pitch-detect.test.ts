import { describe, it, expect } from "vitest";
import { detectPitchYin } from "./pitch-detect.ts";
import { cents } from "./notes.ts";

const SAMPLE_RATE = 48000;
const BUFFER_LENGTH = 2048; // matches the real worklet's analysis window (M4 design)

function generateSine(freq: number, n: number, sampleRate: number, amplitude = 0.8): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return buf;
}

/** Band-limited sawtooth via additive synthesis — real harmonic content, no aliasing. */
function generateHarmonicRich(freq: number, n: number, sampleRate: number, amplitude = 0.6): Float32Array {
  const buf = new Float32Array(n);
  const nyquist = sampleRate / 2;
  const maxHarmonic = Math.floor(nyquist / freq) - 1;
  for (let i = 0; i < n; i++) {
    let sample = 0;
    for (let k = 1; k <= maxHarmonic; k++) {
      sample += (((-1) ** (k + 1)) / k) * Math.sin((2 * Math.PI * k * freq * i) / sampleRate);
    }
    buf[i] = amplitude * sample;
  }
  return buf;
}

function generateWhiteNoise(n: number, amplitude = 0.5): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amplitude * (Math.random() * 2 - 1);
  return buf;
}

function addNoise(signal: Float32Array, noiseAmplitude: number): Float32Array {
  const buf = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) buf[i] = signal[i] + noiseAmplitude * (Math.random() * 2 - 1);
  return buf;
}

function absCents(hz: number, targetHz: number): number {
  return Math.abs(cents(hz, targetHz));
}

describe("detectPitchYin — clean sine waves", () => {
  const testFrequencies = [60, 100, 200, 440, 880, 1000];

  for (const freq of testFrequencies) {
    it(`detects a clean ${freq} Hz sine within +/-5 cents`, () => {
      const buf = generateSine(freq, BUFFER_LENGTH, SAMPLE_RATE);
      const result = detectPitchYin(buf, SAMPLE_RATE);
      expect(result).not.toBeNull();
      expect(absCents(result!.hz, freq)).toBeLessThanOrEqual(5);
      expect(result!.confidence).toBeGreaterThan(0.9);
    });
  }
});

describe("detectPitchYin — octave boundaries", () => {
  it("does not confuse a fundamental near the low search boundary with its octave", () => {
    const freq = 62; // just above the 60 Hz floor
    const buf = generateSine(freq, BUFFER_LENGTH, SAMPLE_RATE);
    const result = detectPitchYin(buf, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(absCents(result!.hz, freq)).toBeLessThanOrEqual(10);
  });

  it("does not confuse a fundamental near the high search boundary with its sub-octave", () => {
    const freq = 950; // near the 1000 Hz ceiling
    const buf = generateSine(freq, BUFFER_LENGTH, SAMPLE_RATE);
    const result = detectPitchYin(buf, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(absCents(result!.hz, freq)).toBeLessThanOrEqual(10);
  });
});

describe("detectPitchYin — silence and noise", () => {
  it("does not throw on total silence and reports low confidence", () => {
    const buf = new Float32Array(BUFFER_LENGTH); // all zeros
    const result = detectPitchYin(buf, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(0.1);
  });

  it("does not throw on pure white noise and reports low confidence", () => {
    const buf = generateWhiteNoise(BUFFER_LENGTH, 0.5);
    const result = detectPitchYin(buf, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(0.5);
  });
});

describe("detectPitchYin — harmonic-rich signals (the octave-error trap)", () => {
  const testFrequencies = [110, 220, 440];

  for (const freq of testFrequencies) {
    it(`finds the true fundamental of a ${freq} Hz sawtooth-like tone, not a harmonic or sub-harmonic`, () => {
      const buf = generateHarmonicRich(freq, BUFFER_LENGTH, SAMPLE_RATE);
      const result = detectPitchYin(buf, SAMPLE_RATE);
      expect(result).not.toBeNull();
      // Looser than the clean-sine bound, but must land on the true fundamental,
      // not 2x/0.5x it (which would be 1200 cents off, unmistakably different).
      expect(absCents(result!.hz, freq)).toBeLessThanOrEqual(25);
    });
  }
});

describe("detectPitchYin — noisy sine (realistic mic conditions)", () => {
  it("still finds the fundamental of a 440 Hz sine with light background noise", () => {
    const clean = generateSine(440, BUFFER_LENGTH, SAMPLE_RATE, 0.8);
    const noisy = addNoise(clean, 0.05);
    const result = detectPitchYin(noisy, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(absCents(result!.hz, 440)).toBeLessThanOrEqual(15);
  });
});

describe("detectPitchYin — precondition failures", () => {
  it("returns null when the buffer is too short for the requested range", () => {
    const buf = new Float32Array(32); // far too short to search down to 60 Hz at 48kHz
    const result = detectPitchYin(buf, SAMPLE_RATE);
    expect(result).toBeNull();
  });
});
