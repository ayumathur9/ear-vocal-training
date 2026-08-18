import { getAudioContext } from "./engine.ts";
// `?worker&url` makes Vite actually compile these through its worker build
// pipeline (TS -> JS, bundling their own imports into a standalone chunk)
// and returns the resulting URL as a string. Two things that DON'T work:
// - `new URL("./x.ts", import.meta.url)` (what Vite recognizes for
//   `new Worker(...)`, but not for AudioWorklet): in production this
//   silently inlines the raw, untranspiled TypeScript source as a data: URL.
// - plain `?url`: skips compilation entirely — same raw-TS problem, just
//   without even inlining; the import statement inside stays unresolved.
import rawFramesWorkletUrl from "./raw-frames-worklet.ts?worker&url";
import pitchWorkletUrl from "./pitch-worklet.ts?worker&url";

export interface MicFrameInfo {
  sampleRate: number;
  bufferSize: number;
  channelCount: number;
  rms: number;
  rmsDb: number;
  quantumCount: number;
}

export interface MicSession {
  stream: MediaStream;
  context: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  workletNode: AudioWorkletNode;
  stop(): void;
}

export interface PitchFrame {
  hz: number | null;
  confidence: number;
  rms: number;
}

export type MicErrorReason = "denied" | "no-device" | "unsupported" | "unknown";

export class MicError extends Error {
  constructor(
    public readonly reason: MicErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "MicError";
  }
}

function classifyGetUserMediaError(err: unknown): MicError {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      return new MicError("denied", "Microphone permission was denied.");
    }
    if (err.name === "NotFoundError") {
      return new MicError("no-device", "No microphone device was found.");
    }
  }
  return new MicError("unknown", err instanceof Error ? err.message : String(err));
}

/**
 * Opens the mic. Deliberately does NOT request autoGainControl/
 * noiseSuppression/echoCancellation — all three distort the pitch content
 * every later milestone depends on.
 */
async function openMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError("unsupported", "getUserMedia is not supported in this browser.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (err) {
    throw classifyGetUserMediaError(err);
  }
}

function wireSession(
  context: AudioContext,
  stream: MediaStream,
  workletNode: AudioWorkletNode,
): Pick<MicSession, "stream" | "context" | "sourceNode" | "workletNode" | "stop"> {
  const sourceNode = context.createMediaStreamSource(stream);
  // Intentionally not connected to context.destination — routing the mic
  // to the speakers would create an audible feedback loop.
  sourceNode.connect(workletNode);

  function stop(): void {
    sourceNode.disconnect();
    workletNode.disconnect();
    workletNode.port.onmessage = null;
    for (const track of stream.getTracks()) track.stop();
  }

  return { stream, context, sourceNode, workletNode, stop };
}

/**
 * Mic -> AudioWorklet reporting raw frame stats (sample rate, buffer size,
 * RMS). No pitch detection — proves the pipeline itself is sound (M3).
 */
export async function startMicCapture(onFrame: (info: MicFrameInfo) => void): Promise<MicSession> {
  const stream = await openMicStream();
  const context = getAudioContext();
  await context.audioWorklet.addModule(rawFramesWorkletUrl);

  const workletNode = new AudioWorkletNode(context, "raw-frames-processor");
  workletNode.port.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "frame-info") onFrame(event.data as MicFrameInfo);
  };

  return wireSession(context, stream, workletNode);
}

/**
 * Mic -> AudioWorklet running YIN pitch detection (M4). Emits raw detector
 * output: no confidence/RMS gating or octave-jump repair yet (that's M5).
 */
export async function startPitchCapture(onPitch: (frame: PitchFrame) => void): Promise<MicSession> {
  const stream = await openMicStream();
  const context = getAudioContext();
  await context.audioWorklet.addModule(pitchWorkletUrl);

  const workletNode = new AudioWorkletNode(context, "pitch-processor");
  workletNode.port.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "pitch") onPitch(event.data as PitchFrame);
  };

  return wireSession(context, stream, workletNode);
}
