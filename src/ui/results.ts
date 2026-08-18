export interface ResultsBreakdownItem {
  label: string;
  value: string;
}

export interface ResultsOptions {
  headingLabel: string;
  bigNumber: string;
  verdict: string;
  sublabel: string;
  correct: boolean;
  streak: number;
  breakdown: ResultsBreakdownItem[];
  onNext: () => void;
  onExit: () => void;
  nextLabel?: string;
}

/**
 * Shared compact results screen: one dominant number, a short verdict, the
 * streak, then a small breakdown grid — used identically by all three games
 * so "how did I do?" always reads the same way regardless of which game
 * produced the result.
 */
export function buildResultsScreen(opts: ResultsOptions): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "panel results-screen";

  const heading = document.createElement("div");
  heading.className = "results-heading";
  heading.textContent = opts.headingLabel;
  wrap.appendChild(heading);

  const bigNumber = document.createElement("div");
  bigNumber.className = "results-number";
  bigNumber.textContent = opts.bigNumber;
  wrap.appendChild(bigNumber);

  const verdict = document.createElement("div");
  verdict.className = "results-verdict";
  verdict.style.color = opts.correct ? "var(--success)" : "var(--danger)";
  verdict.textContent = opts.verdict;
  wrap.appendChild(verdict);

  const sublabel = document.createElement("div");
  sublabel.className = "results-sublabel";
  sublabel.textContent = opts.sublabel;
  wrap.appendChild(sublabel);

  if (opts.streak > 0) {
    const streak = document.createElement("div");
    streak.className = "results-streak";
    streak.textContent = `🔥 ${opts.streak} streak`;
    wrap.appendChild(streak);
  }

  if (opts.breakdown.length > 0) {
    const grid = document.createElement("div");
    grid.className = "results-breakdown";
    for (const item of opts.breakdown) {
      const cell = document.createElement("div");
      cell.className = "results-breakdown-item";
      const value = document.createElement("div");
      value.className = "results-breakdown-value";
      value.textContent = item.value;
      const label = document.createElement("div");
      label.className = "results-breakdown-label";
      label.textContent = item.label;
      cell.append(value, label);
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
  }

  const actions = document.createElement("div");
  actions.className = "results-actions";

  const next = document.createElement("button");
  next.className = "btn-primary btn-block";
  next.textContent = opts.nextLabel ?? "NEXT ROUND →";
  next.addEventListener("click", opts.onNext);
  actions.appendChild(next);

  const exit = document.createElement("button");
  exit.className = "btn-secondary";
  exit.textContent = "EXIT GAME";
  exit.addEventListener("click", opts.onExit);
  actions.appendChild(exit);

  wrap.appendChild(actions);
  return wrap;
}
