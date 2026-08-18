/**
 * M3 diagnostic processor: no pitch detection yet (that's M4). Just proves
 * the mic -> AudioContext -> AudioWorklet pipeline delivers real frames,
 * at what rate/size, and can distinguish silence from signal via RMS.
 */

const REPORT_EVERY_N_QUANTA = 40; // ~9-10 reports/sec at a 128-sample quantum, 48kHz

class RawFramesProcessor extends AudioWorkletProcessor {
  private quantumCount = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];
    this.quantumCount++;

    let sumSquares = 0;
    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sumSquares / channelData.length);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    if (this.quantumCount % REPORT_EVERY_N_QUANTA === 0) {
      this.port.postMessage({
        type: "frame-info",
        sampleRate,
        bufferSize: channelData.length,
        channelCount: input.length,
        rms,
        rmsDb,
        quantumCount: this.quantumCount,
      });
    }

    return true;
  }
}

registerProcessor("raw-frames-processor", RawFramesProcessor);
