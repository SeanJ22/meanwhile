/**
 * **THE CONSOLE'S CHARTS — server-rendered, from audited numbers only.**
 * (ADM-11, ADM-13, ADM-17: the 9.4.26 evening admin feedback.)
 *
 * The owner's words: *"Can graphs be incorporated? Bar charts, pie charts, I
 * don't care … it's draining to read text over text over text."* These are
 * the four shapes the console needs, and nothing more: bars, a stacked bar, a
 * funnel, a ring, and a strip of small bars over days.
 *
 * Every value drawn here arrived as a `Measured` or a count the page has
 * already audited (`auditRenderedNumbers`); a chart never computes a number
 * of its own beyond a width. Colour is luminance-first (Lumen Edge, ADM-21):
 * a bar is a lit surface, and a jurisdiction LEVEL is the only thing that
 * carries hue, through the `lvl-*` classes. No client JavaScript: plain
 * elements and inline SVG, themed by the same tokens as everything else.
 */

export interface BarRow {
  readonly label: string;
  readonly value: number;
  /** What the bar is out of. The widest bar is the largest `max` when given, else the largest value. */
  readonly max?: number;
  /** Rendered beside the bar: "$27.50", "1,291", "63%". */
  readonly shown: string;
  /** A second line under the label. */
  readonly hint?: string;
  /** `lvl-state` etc. for a level-coloured bar. */
  readonly className?: string;
}

function pct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** Horizontal bars, label left, value right. */
export function BarChart({ rows, caption }: { rows: readonly BarRow[]; caption?: string }) {
  const max = Math.max(...rows.map((r) => r.max ?? r.value), 0);
  return (
    <figure className="chart bars">
      {caption && <figcaption>{caption}</figcaption>}
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={r.className}>
            <span className="bar-label">
              {r.label}
              {r.hint && <small>{r.hint}</small>}
            </span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${pct(r.value, max)}%` }} />
            </span>
            <span className="bar-value">{r.shown}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export interface StackPart {
  readonly label: string;
  readonly value: number;
  readonly className?: string;
}

/** One bar split into parts, with a legend. `total` is stated, never summed silently. */
export function StackedBar({ parts, total, caption }: { parts: readonly StackPart[]; total: number; caption?: string }) {
  return (
    <figure className="chart stacked">
      {caption && <figcaption>{caption}</figcaption>}
      <div className="stack-track" role="img" aria-label={parts.map((p) => `${p.label} ${p.value} of ${total}`).join(", ")}>
        {parts.map((p) => (
          <span key={p.label} className={`stack-part ${p.className ?? ""}`} style={{ width: `${pct(p.value, total)}%` }} title={`${p.label}: ${p.value} of ${total}`} />
        ))}
      </div>
      <ul className="stack-legend">
        {parts.map((p) => (
          <li key={p.label} className={p.className}>
            <i className="swatch" aria-hidden="true" /> {p.label} <strong>{p.value}</strong> of {total}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A funnel: bars centred and shrinking with the count. */
export function Funnel({ stages, caption }: { stages: readonly { readonly label: string; readonly count: number; readonly hint?: string }[]; caption?: string }) {
  const max = Math.max(...stages.map((s) => s.count), 0);
  return (
    <figure className="chart funnel">
      {caption && <figcaption>{caption}</figcaption>}
      <ol>
        {stages.map((s) => (
          <li key={s.label}>
            <span className="funnel-label">{s.label}</span>
            <span className="funnel-track" aria-hidden="true">
              <span className="funnel-fill" style={{ width: `${max === 0 ? 0 : Math.max(pct(s.count, max), s.count > 0 ? 3 : 0)}%` }} />
            </span>
            <span className="funnel-value" title={s.hint}>
              {s.count}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** A ring showing one share of a whole: value of total. */
export function Ring({ value, total, label, shown }: { value: number; total: number; label: string; shown: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <figure className="chart ring">
      <svg viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`${label}: ${shown}`}>
        <circle className="ring-track" cx="32" cy="32" r={r} />
        <circle
          className="ring-fill"
          cx="32"
          cy="32"
          r={r}
          strokeDasharray={`${(c * share).toFixed(2)} ${(c * (1 - share)).toFixed(2)}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" textAnchor="middle" className="ring-text">
          {shown}
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Small vertical bars over consecutive days. */
export function DayBars({ days, caption }: { days: readonly { readonly label: string; readonly value: number }[]; caption?: string }) {
  const max = Math.max(...days.map((d) => d.value), 0);
  const w = 12;
  const gapPx = 4;
  const h = 48;
  const width = days.length * (w + gapPx);
  return (
    <figure className="chart daybars">
      {caption && <figcaption>{caption}</figcaption>}
      <svg viewBox={`0 0 ${Math.max(width, 1)} ${h + 14}`} width={Math.max(width, 1)} height={h + 14} role="img" aria-label={days.map((d) => `${d.label} ${d.value}`).join(", ")}>
        {days.map((d, i) => {
          const bh = max === 0 ? 0 : Math.max(1, Math.round((d.value / max) * h));
          return (
            <g key={d.label}>
              <rect className="daybar" x={i * (w + gapPx)} y={h - bh} width={w} height={bh}>
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              {(i === 0 || i === days.length - 1) && (
                <text x={i * (w + gapPx) + w / 2} y={h + 11} textAnchor="middle" className="daybar-text">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
