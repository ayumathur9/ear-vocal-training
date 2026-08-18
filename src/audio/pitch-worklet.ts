import { detectPitchYin } from "../core/pitch-detect.ts";

const WINDOW_SIZE = 2048;
const HOP_SIZE = 512;

/**
 * Buffers incoming 128-sample render quanta into a ring, and runs YIN over a
 * WINDOW_SIZE analysis window every HOP_SIZE samples (~90 analyses/sec at
 * 48kHz). Purely mechanical buffering — the actual pitch math lives in
 * core/pitch-detect.ts so it can be unit-tested without a worklet.
 */
class PitchProcessor extends AudioWorkletProcessor {
  private ringBuffer = new Float32Array(WINDOW_SIZE);
  private writeIndex = 0;
  private samplesSinceLastHop = 0;
  private ringFilled = false;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this.ringBuffer[this.writeIndex] = channelData[i];
      this.writeIndex = (this.writeIndex + 1) % WINDOW_SIZE;
      if (this.writeIndex === 0) this.ringFilled = true;
      this.samplesSinceLastHop++;
    }

    if (this.ringFilled && this.samplesSinceLastHop >= HOP_SIZE) {
      this.samplesSinceLastHop = 0;
      this.analyze();
    }

    return true;
  }

  private analyze(): void {
    const linear = new Float32Array(WINDOW_SIZE);
    for (let i = 0; i < WINDOW_SIZE; i++) {
      linear[i] = this.ringBuffer[(this.writeIndex + i) % WINDOW_SIZE];
    }

    let sumSquares = 0;
    for (let i = 0; i < linear.length; i++) sumSquares += linear[i] * linear[i];
    const rms = Math.sqrt(sumSquares / linear.length);

    const result = detectPitchYin(linear, sampleRate);

    this.port.postMessage({
      type: "pitch",
      hz: result?.hz ?? null,
      confidence: result?.confidence ?? 0,
      rms,
    });
  }
}

registerProcessor("pitch-processor", PitchProcessor);
