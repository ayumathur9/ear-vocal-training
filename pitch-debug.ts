import { startPitchCapture, MicError, type MicSession, type PitchFrame } from "./src/audio/mic.ts";
import { PitchStabilizer, type StabilizedFrame } from "./src/audio/smoothing.ts";

const startBtn = document.getElementById("start") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLPreElement;

let session: MicSession | null = null;
let lastFrames: (PitchFrame & { stabilized: StabilizedFrame })[] = [];
const stabilizer = new PitchStabilizer();

function print(line: string): void {
  log.textContent += line + "\n";
  log.scrollTop = log.scrollHeight;
}

(window as any).__pitchDebug = { getLastFrames: () => lastFrames };

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  print("Requesting microphone…");
  try {
    session = await startPitchCapture((frame) => {
      const stabilized = stabilizer.push(frame);
      lastFrames.push({ ...frame, stabilized });
      if (lastFrames.length > 200) lastFrames.shift();
      const stabilizedLabel =
        stabilized.state === "voiced" ? `voiced hz=${stabilized.hz.toFixed(2)}` : "silent";
      print(
        `raw: hz=${frame.hz?.toFixed(2) ?? "null"} confidence=${frame.confidence.toFixed(3)} rms=${frame.rms.toFixed(4)}` +
          `  |  stabilized: ${stabilizedLabel}`,
      );
    });
    print("Pitch capture started.");
    stopBtn.disabled = false;
  } catch (err) {
    if (err instanceof MicError) {
      print(`MicError [${err.reason}]: ${err.message}`);
    } else {
      print(`Unexpected error: ${String(err)}`);
    }
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", () => {
  session?.stop();
  session = null;
  stabilizer.reset();
  stopBtn.disabled = true;
  startBtn.disabled = false;
  print("Pitch capture stopped.");
});
