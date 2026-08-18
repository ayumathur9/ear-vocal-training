import { startPitchCapture, MicError, type MicSession, type PitchFrame } from "../audio/mic.ts";
import { PitchStabilizer } from "../audio/smoothing.ts";
import { HoldTracker } from "../core/hold-tracker.ts";
import { loadProfile, saveProfile, type Profile } from "../core/storage.ts";

const NOISE_FLOOR_SAMPLE_MS = 1500;
const NOISE_FLOOR_MARGIN_DB = 6;
const MIN_NOISE_FLOOR_DB = -60;
// Normal speaking/singing volume into a laptop mic often sits well below
// -20dB; a ceiling that high would reject legitimate singing as "silence"
// if the noise-floor measurement window picked up any ambient sound at all.
const MAX_NOISE_FLOOR_DB = -35;
const HOLD_REQUIRED_MS = 2000;

type Step =
  | { kind: "idle" }
  | { kind: "requesting-mic" }
  | { kind: "noise-floor"; startedAt: number; samples: number[] }
  | { kind: "lowest-note"; noiseFloorDb: number }
  | { kind: "highest-note"; noiseFloorDb: number; lowHz: number }
  | { kind: "done"; profile: Profile }
  | { kind: "error"; message: string };

function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

const METER_MIN_DB = -60;
const METER_MAX_DB = 0;

function dbToPercent(db: number): number {
  const clamped = Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, Number.isFinite(db) ? db : METER_MIN_DB));
  return ((clamped - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
}

interface MeterRefs {
  fill: HTMLElement;
  threshold: HTMLElement | null;
  label: HTMLElement;
  holdFill: HTMLElement | null;
  holdLabel: HTMLElement | null;
}

/** Builds a live level meter (and, if a hold is in play, a hold-progress bar). Not just cosmetic — this is how you can SEE whether the mic is delivering any real signal at all, independent of any pitch/threshold logic. */
function buildMeter(container: HTMLElement, opts: { thresholdDb: number | null; showHold: boolean }): MeterRefs {
  const wrap = document.createElement("div");
  wrap.className = "vu-wrap";

  const track = document.createElement("div");
  track.className = "vu-track";
  const fill = document.createElement("div");
  fill.className = "vu-fill";
  track.appendChild(fill);

  let threshold: HTMLElement | null = null;
  if (opts.thresholdDb !== null) {
    threshold = document.createElement("div");
    threshold.className = "vu-threshold";
    threshold.style.left = `${dbToPercent(opts.thresholdDb)}%`;
    track.appendChild(threshold);
  }
  wrap.appendChild(track);

  const label = document.createElement("div");
  label.className = "vu-label";
  label.textContent = "Listening for audio…";
  wrap.appendChild(label);

  let holdFill: HTMLElement | null = null;
  let holdLabel: HTMLElement | null = null;
  if (opts.showHold) {
    const holdTrack = document.createElement("div");
    holdTrack.className = "vu-track vu-hold-track";
    holdFill = document.createElement("div");
    holdFill.className = "vu-fill vu-hold-fill";
    holdTrack.appendChild(holdFill);
    wrap.appendChild(holdTrack);

    holdLabel = document.createElement("div");
    holdLabel.className = "vu-label";
    holdLabel.textContent = "Hold progress: 0%";
    wrap.appendChild(holdLabel);
  }

  container.appendChild(wrap);
  return { fill, threshold, label, holdFill, holdLabel };
}

/**
 * One-time ~30s flow: measures the room's noise floor, then asks the user to
 * sing their lowest and highest comfortable notes. Writes the result into
 * the persisted profile so Pitch Match / Hold the Pitch (M7/M8) can generate
 * targets within a range that's actually singable for this person, using a
 * gate tuned to their actual room noise rather than a fixed guess.
 */
export function mountMicCheck(root: HTMLElement, onDone: (profile: Profile) => void): void {
  let step: Step = { kind: "idle" };
  let session: MicSession | null = null;
  let stabilizer: PitchStabilizer | null = null;
  let holdTracker: HoldTracker | null = null;
  let meter: MeterRefs | null = null;

  function render(): void {
    root.innerHTML = "";
    const heading = document.createElement("h2");
    heading.textContent = "Vocal range calibration";
    root.appendChild(heading);

    const body = document.createElement("div");
    body.className = "calibration-body";

    switch (step.kind) {
      case "idle": {
        const p = document.createElement("p");
        p.textContent = "This takes about 30 seconds and lets us pick notes that actually fit your voice.";
        const btn = document.createElement("button");
        btn.textContent = "Start calibration";
        btn.addEventListener("click", () => void start());
        body.append(p, btn);
        break;
      }
      case "requesting-mic": {
        body.append(makeMessage("Requesting microphone…"));
        break;
      }
      case "noise-floor": {
        body.append(makeMessage("Stay quiet for a moment while we check the room noise…"));
        meter = buildMeter(body, { thresholdDb: null, showHold: false });
        break;
      }
      case "lowest-note": {
        body.append(makeMessage("Sing your lowest comfortable note and hold it steady."));
        meter = buildMeter(body, { thresholdDb: step.noiseFloorDb, showHold: true });
        break;
      }
      case "highest-note": {
        body.append(makeMessage("Now sing your highest comfortable note and hold it steady."));
        meter = buildMeter(body, { thresholdDb: step.noiseFloorDb, showHold: true });
        break;
      }
      case "done": {
        const range = step.profile.range!;
        body.append(makeMessage(`Calibrated! Range: ${range.lowHz.toFixed(1)} Hz – ${range.highHz.toFixed(1)} Hz.`));
        break;
      }
      case "error": {
        const p = document.createElement("p");
        p.className = "feedback";
        p.textContent = step.message;
        const retry = document.createElement("button");
        retry.textContent = "Retry";
        retry.addEventListener("click", () => void start());
        body.append(p, retry);
        break;
      }
    }

    root.appendChild(body);
  }

  function makeMessage(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function setStep(next: Step): void {
    step = next;
    render();
  }

  async function start(): Promise<void> {
    setStep({ kind: "requesting-mic" });
    try {
      session = await startPitchCapture(handleFrame);
    } catch (err) {
      cleanup();
      const message =
        err instanceof MicError
          ? `Couldn't access the microphone (${err.reason}): ${err.message}`
          : `Unexpected error: ${String(err)}`;
      setStep({ kind: "error", message });
      return;
    }
    setStep({ kind: "noise-floor", startedAt: performance.now(), samples: [] });
  }

  function updateMeter(frame: PitchFrame, extra?: string): void {
    if (!meter) return;
    const db = rmsToDb(frame.rms);
    meter.fill.style.width = `${dbToPercent(db)}%`;
    const dbText = Number.isFinite(db) ? db.toFixed(1) : "-inf";
    const hzText = frame.hz !== null ? `${frame.hz.toFixed(1)} Hz` : "no pitch";
    meter.label.textContent = `Level: ${dbText} dB · ${hzText} · confidence ${frame.confidence.toFixed(2)}${extra ? " · " + extra : ""}`;
  }

  function updateHold(progressMs: number, requiredMs: number): void {
    if (!meter?.holdFill || !meter.holdLabel) return;
    const pct = Math.max(0, Math.min(100, (progressMs / requiredMs) * 100));
    meter.holdFill.style.width = `${pct}%`;
    meter.holdLabel.textContent = `Hold progress: ${pct.toFixed(0)}%`;
  }

  function handleFrame(frame: PitchFrame): void {
    if (step.kind === "noise-floor") {
      updateMeter(frame, "measuring room noise");
      step.samples.push(frame.rms);
      if (performance.now() - step.startedAt >= NOISE_FLOOR_SAMPLE_MS) {
        const observedPeakDb = Math.max(...step.samples.map(rmsToDb).filter(Number.isFinite));
        const noiseFloorDb = Math.min(
          MAX_NOISE_FLOOR_DB,
          Math.max(MIN_NOISE_FLOOR_DB, (Number.isFinite(observedPeakDb) ? observedPeakDb : MIN_NOISE_FLOOR_DB) + NOISE_FLOOR_MARGIN_DB),
        );
        stabilizer = new PitchStabilizer({ rmsThresholdDb: noiseFloorDb });
        holdTracker = new HoldTracker({ requiredMs: HOLD_REQUIRED_MS });
        setStep({ kind: "lowest-note", noiseFloorDb });
      }
      return;
    }

    if (step.kind === "lowest-note" || step.kind === "highest-note") {
      const stabilized = stabilizer!.push(frame);
      if (stabilized.state === "silent") {
        updateMeter(frame, "silent (below threshold or low confidence)");
        holdTracker!.silentTick(performance.now());
        return;
      }
      updateMeter(frame, "voiced");
      const result = holdTracker!.push(stabilized.hz, performance.now());
      updateHold(result.status === "holding" ? result.progressMs : HOLD_REQUIRED_MS, HOLD_REQUIRED_MS);
      if (result.status === "captured") {
        if (step.kind === "lowest-note") {
          holdTracker!.reset();
          setStep({ kind: "highest-note", noiseFloorDb: step.noiseFloorDb, lowHz: result.hz });
        } else {
          finish(step.lowHz, result.hz, step.noiseFloorDb);
        }
      }
    }
  }

  function finish(lowHz: number, highHz: number, noiseFloorDb: number): void {
    const profile = loadProfile();
    profile.range = { lowHz: Math.min(lowHz, highHz), highHz: Math.max(lowHz, highHz) };
    profile.mic = { noiseFloorDb };
    saveProfile(profile);
    cleanup();
    setStep({ kind: "done", profile });
    onDone(profile);
  }

  function cleanup(): void {
    session?.stop();
    session = null;
    stabilizer = null;
    holdTracker = null;
  }

  render();
}
