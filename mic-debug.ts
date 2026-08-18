import { startMicCapture, MicError, type MicSession } from "./src/audio/mic.ts";

const startBtn = document.getElementById("start") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLPreElement;

let session: MicSession | null = null;
let lastFrames: unknown[] = [];

function print(line: string): void {
  log.textContent += line + "\n";
  log.scrollTop = log.scrollHeight;
}

// Exposed for automated (Playwright) verification.
(window as any).__micDebug = { getLastFrames: () => lastFrames };

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  print("Requesting microphone…");
  try {
    session = await startMicCapture((info) => {
      lastFrames.push(info);
      if (lastFrames.length > 20) lastFrames.shift();
      print(
        `sampleRate=${info.sampleRate} bufferSize=${info.bufferSize} channels=${info.channelCount} ` +
          `rms=${info.rms.toFixed(4)} rmsDb=${info.rmsDb.toFixed(1)} quantum=${info.quantumCount}`,
      );
    });
    print("Mic capture started.");
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
  stopBtn.disabled = true;
  startBtn.disabled = false;
  print("Mic capture stopped.");
});
