# Ear & Vocal Training — Phase 1 Implementation Plan

**Goal:** three technically reliable, measurable games in the browser.
**Priority:** correct audio + correct scoring. Not visuals, not accounts, not AI.

---

## 1. Decisions locked

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript, strict mode | Type safety pays off most in the audio/pitch math — exactly the code that must not be subtly wrong. |
| Build/dev server | Vite | Fast dev server with HMR, zero-config TS + ES modules, trivial production build. Node 24 LTS installed via winget. |
| Tests | Vitest | Same config/toolchain as Vite; runs the framework-agnostic `core/` modules directly, no DOM needed for most of them. |
| Note playback | Web Audio API `OscillatorNode` + `GainNode` ADSR envelope | Sample-accurate, no audio assets to ship. |
| Pitch detection | **Hand-rolled YIN inside an `AudioWorklet`** | Off the main thread → stable ~90 analyses/sec with no UI jank. Full control of the confidence/gate thresholds Phase 1 success depends on. |
| Persistence | `localStorage`, one versioned key | No accounts (a Phase 1 non-goal), but difficulty must survive reload. |
| Browsers | Chrome / Edge / Firefox desktop, current versions | `AudioWorklet` + `getUserMedia` are the hard requirements. |
| Framework migration | `core/` and `audio/` are 100% DOM-free | Phase 2 can wrap them in React (or anything else) without touching the audio/scoring logic. |
| Difficulty tolerance | **Config-driven, not hardcoded** | Pitch engine only ever emits cents. How forgiving a level is lives in a per-game difficulty table (`core/difficulty.ts`), so tuning never touches the pitch math. |

---

## 2. Architecture

Strict one-way dependency. **Nothing in `audio/` or `core/` ever imports the DOM.**

```
index.html
src/
  main.ts                   app bootstrap, game router
  styles.css
  audio/
    engine.ts               ✅ AudioContext singleton, note playback (ADSR)
    mic.ts                  ✅ getUserMedia -> AudioWorkletNode wiring (raw + pitch)
    raw-frames-worklet.ts   ✅ AudioWorkletProcessor, diagnostic RMS/frame stats
    pitch-worklet.ts        ✅ AudioWorkletProcessor, buffers into core/pitch-detect.ts
    smoothing.ts            ✅ PitchStabilizer: confidence/RMS gate, median, octave repair
  core/
    notes.ts                ✅ Hz <-> MIDI <-> name, cents, random note/pair, safe-range inset
    pitch-detect.ts          ✅ pure YIN implementation (unit-tested, no DOM/worklet dep)
    scoring.ts               ✅ session score/streak, pitch accuracy %
    difficulty.ts            ✅ per-game level ladders (data, not logic)
    hold-tracker.ts          ✅ pure "held any steady pitch for N ms?" detector (calibration)
    hold-attempt.ts          ✅ pure "held THIS target pitch, how well?" scorer (Hold the Pitch)
    storage.ts               ✅ versioned localStorage profile
    events.ts                ✅ tiny pub/sub so games stay UI-free
  games/
    higher-lower.ts          ✅ pure state machine + DOM mount
    pitch-match.ts           ✅ pure state machine + DOM/mic mount
    hold-pitch.ts            ✅ pure state machine + DOM/mic mount
  ui/
    menu.ts                  ✅ game select screen
    mic-check.ts             ✅ calibration flow + live VU meter/hold-progress bar
    pitch-trace.ts           ✅ scrolling canvas: live cents-off vs. target + tolerance band (Hold the Pitch)
```

✅ = implemented and tested. Text-only live readouts (hz/dB/confidence/progress bars) shipped instead of the originally-planned canvas needle/trace meters — functionally equivalent for Phase 1's "reliable and measurable" priority; a polished canvas visualization is a Phase 2 candidate, not a gap in what's reliable today.

---

## 3. Milestones

| # | Milestone | Deliverable | Acceptance | Status |
|---|---|---|---|---|
| **M0** | Project skeleton | Vite + TS + Vitest, folder architecture, app shell, no mic | `npm run dev` serves the shell; `npm test` runs (0 tests) | ✅ Done |
| **M1** | Music core | `core/notes.ts`: Hz↔MIDI↔name, cents, random note/pair generation | Unit tests: 128-note round trip, known cents cases (437→−11.84¢), random-pair gap/order invariants | ✅ Done — 18 tests |
| **M2** | Playback + Game 1 | `audio/engine.ts` (note playback) + `games/higher-lower.ts` + shared score/streak/round/difficulty/storage | Higher-or-Lower fully playable: generate → play A → play B → choose → evaluate → score → streak → difficulty → next round. **No mic dependency.** | ✅ Done — 29 tests, verified live in browser (Playwright smoke test, 0 console errors) |
| **M3** | Audio infrastructure | `audio/mic.ts` + `audio/raw-frames-worklet.ts`: mic → AudioContext → AudioWorklet → raw frames | Verified in a real browser via Chromium's fake-audio-device: `sampleRate=48000`, `bufferSize=128` (render quantum), silence → `rms=0` cleanly, real 440 Hz tone → `rms≈0.35` (matches expected sine RMS). Permission-denied/no-device paths classified via `MicError`. **No game integration yet** — verified via a standalone `mic-debug.html` harness, not the menu. | ✅ Done |
| **M4** | YIN | `core/pitch-detect.ts` (pure, unit-tested) + `audio/pitch-worklet.ts` (buffering/wiring only) | 62 unit tests: clean sines 60–1000 Hz within ±5¢, octave boundaries, silence/white-noise (low confidence, no crash), harmonic-rich (sawtooth-like) within ±25¢, noisy sine within ±15¢. **Real-browser confirmation:** a genuine 440 Hz WAV through the full mic→worklet→YIN path (Chromium fake-audio-capture) detected 440.02 Hz, confidence ~1.0, all frames within ±3¢. Highest-risk milestone, cleared. | ✅ Done |
| **M5** | Pitch stabilization | `audio/smoothing.ts`: `PitchStabilizer` — confidence + RMS gate → octave-jump repair → median-of-5 | 10 unit tests: gating never leaks a guessed frequency, octave-jump repair folds 2x/0.5x outliers back without disturbing genuine (non-octave) pitch changes, silence resets history so no stale octave anchor persists. **Real-signal catch:** on a real silence→440Hz→silence WAV through the full pipeline, a transitional garbage frame (`hz=718, confidence=0.09`) was correctly gated to `silent` instead of leaking through as a wrong pitch; the other 131 voiced frames all locked to 440.02 Hz. | ✅ Done |
| **M6** | Calibration | `ui/mic-check.ts` (flow + live VU meter/hold-progress bar) + `core/hold-tracker.ts` (pure "held steady for N ms?" detector, 9 unit tests) → `core/storage.ts` `profile.range` / `profile.mic` | **Verified end-to-end**, fixed a real bug found only by testing against a *realistic* (vibrato + harmonics + breathiness) synthetic voice rather than a clean sine — see §4.4 — and **confirmed working with an actual human voice**, not just synthetic signals. The live meter (level bar + threshold marker + hz/confidence + hold-progress bar) stays in the UI going forward, not just for this debugging pass — it's the fastest way to tell "no signal" from "gate too strict" from "hold logic bug" at a glance. | ✅ Done | |
| **M7** | Pitch Match | `games/pitch-match.ts` (pure state machine + DOM/mic mount, 11 unit tests) + calibration-gated menu wiring in `main.ts` | **By construction:** the scoring window (mic session, stabilizer, hold-tracker) is only created after `await playNote(...)` resolves — which only happens once the oscillator's `onended` fires, i.e. after the full release ramp — so there is no code path where mic capture starts while the target is still audible. **End-to-end browser verification**, first against synthetic sines (100% accuracy, 0% on a wrong note) then against the same realistic vibrato-laden voice that broke M6 (see §4.4) — the lock-in tolerance needed the same fix, now scores a real-shaped voice at 96% accuracy correctly. Calibration gate routes to `mic-check` when no range is saved; profile persists level/score/streak/played/correct; zero console errors throughout. | ✅ Done | |
| **M8** | Hold the Pitch | `core/hold-attempt.ts` (pure `HoldAttemptTracker`, 10 unit tests) + `games/hold-pitch.ts` (state machine + DOM/mic mount, 7 unit tests) + calibration-gated menu wiring | The gap-tolerance lesson from M6/M7 (§4.4) was applied **from the start** here, not discovered the hard way again. **End-to-end browser verification**: a realistic vibrato-laden 220 Hz hold scored "Correct!" (3.0s held, 75% stability) with a live progress bar and live-hz readout throughout; a consistently wrong pitch (330 Hz vs. a 220 Hz target) correctly scored 0% stability and "Not quite."; calibration gate and profile persistence both confirmed. Zero console errors. | ✅ Done |

### 4.5 Second lesson: the glide-to-target transient was polluting real scores

After M8 shipped, real play surfaced scores that felt inaccurate across Pitch Match and Hold the Pitch. Root cause: both games started measuring the moment ANY voicing began — including the natural pitch glide/scoop a real voice makes on the way up to a note (absent from every clean-sine test used so far, present in every real attempt). That glide was getting folded into Pitch Match's "detected pitch" and Hold the Pitch's stability average, silently dragging both down for genuinely good singing.

Fix: an **acquisition gate** in both games — `ACQUIRE_TOLERANCE_CENTS = 100` (roughly a semitone). Neither game's tracker (`HoldTracker` for the lock-in, `HoldAttemptTracker` for the stability window) receives a single frame until the live pitch first comes within that tolerance of the target; only then does the actual measurement window start. Verified against a synthesized glide-then-hold voice (150→220 Hz over 0.6s, then a vibrato-laden hold at 220 Hz): Pitch Match now detects 219.3 Hz / 97% accuracy (vs. a contaminated blend before the fix); Hold the Pitch scores 75% stability, matching the no-glide baseline exactly.

**Takeaway for any future scoring window:** never start measuring from "voicing began" — start from "voicing is roughly on the intended target," or the natural attack transient of a real voice will always read as inaccuracy.

### 4.6 Third round of feedback: Pitch Match and Hold the Pitch felt like the same game

Even after the accuracy fix, feedback was that the two games "feel very similar." That's a legitimate UX gap, not a scoring bug: both games' UI was "sing, wait, see a percentage," with no visible difference in the actual sustained-control mechanic that's supposed to set Hold the Pitch apart. The BRD explicitly calls for **real-time pitch visualization** as a distinguishing output for Hold the Pitch specifically — a feature the original build shipped as a generic progress bar instead (noted, but not acted on, in §2's architecture table).

Added `ui/pitch-trace.ts`: a scrolling canvas trace plotting live cents-off-target against a shaded tolerance band, updated every audio frame. Verified: a vibrato-laden hold visibly wobbles along the tolerance band in real time, functionally unchanged (still 75% stability, same as before the visual was added) but now experientially distinct — you watch your own control over time instead of waiting for a number. Implementation note: the trace canvas and the "holding" view's live text are built once per round and mutated via cached DOM refs on each frame, not rebuilt through a full re-render — rebuilding ~90 times/sec would have destroyed and recreated the canvas (and its history) every frame.

**All three Phase 1 games are complete and playable: M0 → M8.** Higher-or-Lower needs no microphone; Pitch Match and Hold the Pitch share the full mic → YIN → stabilization → calibration pipeline, gated behind a one-time vocal range calibration screen with a live VU meter.

---

## 4. The audio core (M3–M5 — the hard part, now built and verified)

### 4.1 YIN detector — `audio/pitch-worklet.ts` (M4)

Runs in the audio thread. Ring-buffers 128-frame render quanta into a 2048-sample analysis window, hops every 512 samples.

1. **Difference function** `d(τ) = Σ (x[i] − x[i+τ])²` for τ spanning 60–1000 Hz (the vocal range).
2. **Cumulative mean normalized difference** `d'(τ) = d(τ) / ((1/τ) Σ d(j))`.
3. **Absolute threshold:** first τ where `d'(τ) < 0.15`, else the global minimum.
4. **Parabolic interpolation** around that τ for sub-sample precision — this is what gets us inside ±5 cents.
5. Emit `{ hz, confidence: 1 − d'(τ), rms }` via `port.postMessage`.

**Why not `AnalyserNode` + FFT:** a 2048-point FFT has ~23 Hz bins. At C3 (131 Hz) that's ±300 cents of quantization error — unusable for scoring. Time-domain YIN gives sub-Hz resolution.

### 4.2 Smoothing & gating — `audio/smoothing.ts` (M5)

Raw YIN output is unusable for a UI or a score; it flickers and octave-jumps. The rule: **don't smooth bad data into looking good — say `NO PITCH` instead.**

- **Silence gate:** `rms < −45 dBFS` (calibrated per user, M6) → `NO PITCH`, not a guessed frequency.
- **Confidence gate:** `confidence < 0.85` → `NO PITCH`. Filters unvoiced consonants and room noise.
- **Median-of-5** on accepted frames, then **octave-jump repair**: a frame within ±60 cents of exactly 2× or 0.5× the running median gets folded back to the median's octave.

### 4.3 Latency budget

| Stage | Cost |
|---|---|
| Mic capture + OS buffer | ~10–20 ms |
| YIN window fill (2048 @ 48 kHz) | ~43 ms |
| YIN compute per hop | ~1–3 ms |
| Median-of-5 (5 × 512-sample hops) | ~53 ms |
| Canvas paint | ~16 ms |
| **Total perceived** | **~120–135 ms** |

Under the ~150 ms threshold where a pitch meter stops feeling live. If it feels laggy, drop the median to 3 frames first.

### 4.4 Lesson learned: clean-signal testing hid a real-voice bug

Every M3–M5 test up to this point used synthesized pure sine tones, and everything passed. M6's "hold your lowest note" screen still got stuck indefinitely on real use. The gap: a pure sine has zero pitch wobble; a real sung note has vibrato (a few Hz of periodic pitch modulation) even when the singer thinks they're holding it "steady."

The bug was in `core/hold-tracker.ts` (the "has the pitch held steady for N ms?" detector used by both calibration and Pitch Match's lock-in): it compared each new frame to the **median of all samples so far**. Under vibrato, that median itself drifts toward whichever extreme the pitch most recently swept through — so the return swing looks like a large jump *away from* that drifted reference, even though the note's actual envelope never left a bounded range. The window kept getting wiped roughly every 90ms, forever, with the confidence and RMS gates both reading perfectly clean throughout (confirmed by instrumenting real frame data — this was never a gating problem).

Fix: track the window's total peak-to-peak spread in cents instead of distance-from-a-moving-point. A held note's vibrato stays within a bounded envelope; a genuine move to a different note doesn't. Verified against a synthesized voice with realistic vibrato (±40¢, 5.5Hz), harmonics, and breathiness — calibration now completes in ~2s per note, and Pitch Match's shorter 400ms lock-in needed the same fix (tolerance raised from a synthetic-clean 20¢ to 90¢, since the same distortion applies over any window, short or long).

**Takeaway for future milestones (M8):** any new hold/steadiness detection logic should be tested against a synthesized-with-vibrato signal, not just a clean sine, before being considered done.

---

## 5. Scoring (`core/scoring.ts` — implemented, M2)

### Pitch accuracy (games 2 & 3)

Matches the BRD worked example (440 Hz target, 437 Hz sung → 94%):

```
c        = |cents(detected, target)|          // 437 vs 440 -> 11.84 cents
accuracy = max(0, 100 * (1 - c / 200))        // -> 94.1%  ✓
```

This 200-cent normalization span is fixed — it's what the BRD example implies. What counts as a **pass**, however, is a separate, per-level concern read from `core/difficulty.ts`, never hardcoded into the scoring function. `pitchAccuracy()` always returns a percentage; `isWithinTolerance(cents, toleranceCents)` is what a game calls with that level's configured tolerance.

| Cents off | Accuracy | Verdict |
|---|---|---|
| ≤ 10 | ≥ 95% | Perfect |
| ≤ 25 | ≥ 87% | Great |
| ≤ 50 | ≥ 75% | Good |
| > 50 | < 75% | Off — shows flat/sharp direction |

### Stability (game 3, M8)

```
inTolerance = frames within ±tolerance cents of target
timeInTune  = inTolerance / totalVoicedFrames
drift       = stdDev(cents[])                     // wobble
stability   = 100 * timeInTune * max(0, 1 - drift/100)
```

Two components on purpose: `timeInTune` alone rewards wide oscillation around the target; `drift` penalizes wobble independently. A note dropped mid-hold (silence) breaks the streak and caps the attempt.

### Session score (implemented)

`applyRoundResult()`: `+ (10 + level) points` per correct answer, multiplied by a streak multiplier (1× at streak 0–2, up to a cap of 5× at streak ≥12). A miss resets the streak to 0 but never the level directly — level changes only via `nextDifficultyState`.

---

## 6. Adaptive difficulty (`core/difficulty.ts` — implemented for Game 1, M2)

Shared rule across all three games: **3 consecutive correct → level up. 2 consecutive wrong → level down. Never below level 1, never above the ladder's top.**

### Game 1 — Higher or Lower (`HIGHER_LOWER_LEVELS`, implemented)

| Level | Gap | Register |
|---|---|---|
| 1 | 12 st (octave) | C4–C5 |
| 2 | 7 st (fifth) | C4–C5 |
| 3 | 4 st (major third) | C3–C5 |
| 4 | 2 st (whole tone) | C3–C5 |
| 5 | 1 st (semitone) | C2–C6 |

Both notes play sequentially (800 ms each, 200 ms gap); replay is unlimited. Order (which note plays first) is randomized independently of which is higher.

### Game 2 — Pitch Match (implemented, M7)

| Level | Tolerance | Time limit |
|---|---|---|
| 1 | ±50¢ | 8 s |
| 2 | ±35¢ | 8 s |
| 3 | ±25¢ | 6 s |
| 4 | ±15¢ | 5 s |
| 5 | ±10¢ | 4 s |

Targets are drawn from the user's full calibrated range at every level (the "5 notes / 8 notes" pool-size-per-level idea from the original design was simplified away — see §3's M7 note). An attempt locks in once pitch is stable (<90¢ spread, tuned up from a synthetic-clean 20¢ — see §4.4) for 400 ms, so the initial slide up to the note isn't scored.

### Game 3 — Hold the Pitch (implemented, M8)

| Level | Duration | Tolerance |
|---|---|---|
| 1 | 3 s | ±50¢ |
| 2 | 5 s | ±35¢ |
| 3 | 7 s | ±25¢ |
| 4 | 10 s | ±20¢ |
| 5 | 12 s | ±15¢ |

Timer starts only once voicing is detected, so a breath before singing isn't penalized. Pass/fail (for scoring and difficulty promotion) is stability ≥ 70% (`PASS_STABILITY_THRESHOLD` in `games/hold-pitch.ts`) — a judgment call, not from the BRD, flagged here for visibility.

---

## 7. Vocal range calibration (M6, prerequisite for M7/M8)

Auto-generated targets are worthless if a bass gets handed a C6. A one-time ~30s flow on first run, re-runnable from the menu:

1. Mic permission + input level check → sets the noise floor / RMS gate.
2. "Sing your lowest comfortable note" → hold 2s → record Hz.
3. "Sing your highest comfortable note" → hold 2s → record Hz.
4. Store `{lowHz, highHz}` (inset 2 semitones each end) in the profile.

---

## 8. Persistence (`core/storage.ts` — implemented, versioned)

```ts
localStorage['evt.v1.profile'] = {
  version: 1,
  higherLower: { level, bestScore, bestStreak, played, correct },
  // pitchMatch, holdPitch, range, mic added in M6/M7/M8
}
```

Version-guarded load: any parse failure or version mismatch falls back to `defaultProfile()` rather than crashing.

---

## 9. Verification strategy

- **Detector ground truth (M4):** feed `OscillatorNode` output straight into the worklet (no mic) across 60–1000 Hz in semitone steps; assert every reading within ±5 cents. Repeat with added white noise and with a sawtooth (harmonic-rich — the classic octave-error trap).
- **Note math (M1, done):** all 128 MIDI notes round-trip; BRD's 437-vs-440 case reproduced to the cent.
- **Scoring (M2, done):** BRD example returns 94% exactly; boundary cases at 10/25/50 cents.
- **Difficulty ladder (M2, done):** simulated correct/wrong sequences promote/demote exactly on schedule and clamp at the ends.
- **Human check per milestone:** real singing into a real mic — synthetic tests can't catch a badly tuned confidence gate.
- **Browser smoke test:** each playable milestone gets a headless-browser pass (Playwright) driving the actual UI, not just unit tests — done for M2, will repeat for M7/M8.

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Octave errors** (YIN reporting 2× or ½ true pitch) | Scores a correct note as wrong — kills trust | Parabolic interpolation + explicit octave-jump repair (M5); sawtooth test signals in M4's suite |
| App hears its own reference tone | False "perfect" score with no singing | Target playback fully stops before the scoring window opens (M7); headphones recommended |
| `AudioContext` starts suspended (autoplay policy) | Nothing plays; app looks broken | Context created/resumed only inside a user-gesture handler (already how `engine.ts` works) |
| Detection latency feels laggy | Pitch meter feels disconnected from the voice | Latency budget in §4.3; drop median window 5→3 if needed |
| Vibrato read as instability | Penalizes trained singers on Game 3 | Stability uses stdDev over the whole hold, not instantaneous error; generous tolerance at low levels |
| Cheap mic / AGC distortion | Erratic Hz and RMS | Calibration step (M6); do **not** request `autoGainControl`/`noiseSuppression` in `getUserMedia` constraints — both distort pitch |
| Sample rate varies by device (44.1 vs 48 kHz) | Hard-coded τ ranges break | Read `sampleRate` from the worklet's global scope; never hard-code it |

---

## 11. Explicitly out of scope (Phase 1)

Accounts, social, payments, AI coaching, full-song training, chord/harmony training, advanced UI/animation, mobile app, backend of any kind.

---

## 12. Phase 1 exit criteria — met

A new user, with no prior musical knowledge, can in one sitting:

1. ✅ Open the app, grant mic access, calibrate their range in under a minute.
2. ✅ Play all three games and get feedback a musician would agree with.
3. ✅ See score and streak update live; see difficulty visibly adapt.
4. ✅ Reload and find level and best scores intact.
5. ✅ Trust the numbers — 118 unit tests passing (including the ±5¢ synthetic YIN suite, §9), plus every audio milestone additionally confirmed end-to-end in a real browser against both clean and realistically vibrato-laden synthetic voices.

**Not yet verified: an actual human singing into a real microphone in a real browser session, start to finish across all three games.** Every claim above is machine-verified (unit tests + headless-browser tests with synthetic/fake audio devices); calibration alone has had one round of real-human confirmation (per the M6 fix). A full human playtest of Higher-or-Lower, Pitch Match, and Hold the Pitch is the natural next step before calling Phase 1 fully done.

---

## Appendix — running it

```powershell
cd "d:\SamItSolutions\Ear-Vocal Traning"
npm install       # first time only
npm run dev       # http://localhost:5173
npm test          # vitest, runs core/* and games/* unit tests
```
