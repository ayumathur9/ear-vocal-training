const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 160;
const MAX_CENTS_AXIS = 200; // Y-axis spans ±200 cents (two semitones)

/**
 * Scrolling pitch-vs-target trace for Hold the Pitch — the BRD's "real-time
 * pitch visualization" output for this game specifically. This is what
 * makes holding a note *feel* different from a snapshot match: you watch
 * your own wobble against a tolerance band over time, not just a number
 * after the fact.
 */
export class PitchTraceMeter {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly toleranceCents: number;
  private readonly windowMs: number;
  private points: { t: number; centsOff: number | null }[] = [];

  constructor(container: HTMLElement, opts: { toleranceCents: number; windowMs?: number }) {
    this.toleranceCents = opts.toleranceCents;
    this.windowMs = opts.windowMs ?? 6000;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "pitch-trace";
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.draw();
  }

  /** centsOff = null means silent/no pitch this frame (drawn as a gap in the line). */
  push(centsOff: number | null, nowMs: number): void {
    this.points.push({ t: nowMs, centsOff });
    const cutoff = nowMs - this.windowMs;
    while (this.points.length > 0 && this.points[0].t < cutoff) this.points.shift();
    this.canvas.classList.toggle("is-locked", centsOff !== null && Math.abs(centsOff) <= this.toleranceCents);
    this.draw();
  }

  destroy(): void {
    this.canvas.remove();
  }

  private centsToY(centsOff: number): number {
    const clamped = Math.max(-MAX_CENTS_AXIS, Math.min(MAX_CENTS_AXIS, centsOff));
    return CANVAS_HEIGHT / 2 - (clamped / MAX_CENTS_AXIS) * (CANVAS_HEIGHT / 2);
  }

  private draw(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#1a1d22";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Tolerance band around the target.
    const bandTop = this.centsToY(this.toleranceCents);
    const bandBottom = this.centsToY(-this.toleranceCents);
    ctx.fillStyle = "rgba(61, 220, 132, 0.15)";
    ctx.fillRect(0, bandTop, CANVAS_WIDTH, bandBottom - bandTop);

    // Target line (0 cents).
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();

    if (this.points.length < 2) return;
    const now = this.points[this.points.length - 1].t;
    const xForT = (t: number) => CANVAS_WIDTH - ((now - t) / this.windowMs) * CANVAS_WIDTH;

    ctx.strokeStyle = "#6a86ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let penDown = false;
    for (const p of this.points) {
      if (p.centsOff === null) {
        penDown = false;
        continue;
      }
      const x = xForT(p.t);
      const y = this.centsToY(p.centsOff);
      if (!penDown) {
        ctx.moveTo(x, y);
        penDown = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    const last = this.points[this.points.length - 1];
    if (last.centsOff !== null) {
      const x = xForT(last.t);
      const y = this.centsToY(last.centsOff);
      ctx.fillStyle = Math.abs(last.centsOff) <= this.toleranceCents ? "#3ddc84" : "#ff5d5d";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
