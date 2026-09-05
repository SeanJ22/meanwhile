/**
 * **THE CONSOLE'S SHARED RENDER PRIMITIVES.** (9.4.26 admin feedback, ADM-3/7.)
 *
 * Pilot Health and State Readiness are one control centre, and the owner
 * expected them to look like one: the readiness panel's tiles, legend and
 * swatches were the design reference. Those pieces used to be module-private
 * to the readiness panel; they live here now so both views render them from
 * one implementation (RULING 103 — never two copies), and so the number and
 * gap helpers the pages had each written for themselves are one each.
 *
 * Nothing here reads a store or the environment. Every component takes the
 * already-audited values the page hands it.
 */
import type { Gap, HealthLevel, Held, Measured } from "@/lib/control-plane/owner-surface.ts";
import { HEALTH_SCALE } from "@/lib/control-plane/plain-health.ts";
import type { CellState } from "@/lib/control-plane/readiness/gates.ts";

/* ------------------------------------------------------------- readiness */

export const STATE_CLASS: Record<CellState, string> = {
  CURRENT: "rq-current",
  PARTIAL_OR_STALE: "rq-partial",
  NOT_WALKED: "rq-notwalked",
  ARGUED_ABSENT: "rq-argued",
  BLOCKED: "rq-blocked",
  GATED_ON_OPERATOR: "rq-gated",
};
export const STATE_HUMAN: Record<CellState, string> = {
  CURRENT: "current",
  PARTIAL_OR_STALE: "partial or stale",
  NOT_WALKED: "not walked",
  ARGUED_ABSENT: "argued absent",
  BLOCKED: "blocked",
  GATED_ON_OPERATOR: "gated on you",
};

/** The six cell states, each with its swatch, in the order the grid ranks them. */
export function ReadinessLegend() {
  const items: CellState[] = [
    "CURRENT",
    "PARTIAL_OR_STALE",
    "NOT_WALKED",
    "ARGUED_ABSENT",
    "BLOCKED",
    "GATED_ON_OPERATOR",
  ];
  return (
    <div className="rq-legend" aria-label="What the cell colours mean">
      {items.map((s) => (
        <span key={s}>
          <i className={`rq-cell ${STATE_CLASS[s]}`} /> {STATE_HUMAN[s]}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- pilot health */

/** Map a health band to the admin colour class. */
export const HEALTH_CLASS: Record<HealthLevel, string> = {
  GREEN: "state-green",
  AMBER: "state-amber",
  RED: "state-red",
  UNKNOWN: "state-unknown",
};

/** A grade, always beside the same word for it. */
export function Band({ level, children }: { level: HealthLevel; children?: React.ReactNode }) {
  return (
    <span className={`band band-${level} ${HEALTH_CLASS[level]}`}>
      <i className={`rq-cell hl-${level}`} aria-hidden="true" /> {children ?? level}
    </span>
  );
}

/** The scale, shown wherever a grade appears (ADM-3: "is it green, amber, or red?"). */
export function HealthScale() {
  return (
    <div className="rq-legend scale" aria-label="What the grades mean">
      {HEALTH_SCALE.map((s) => (
        <span key={s.level}>
          <i className={`rq-cell hl-${s.level}`} /> <strong>{s.level}</strong> — {s.means}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- numbers */

/** "3 / 7" for a held Measured, or an em-dash-free placeholder for a gap. */
export function heldFigure(h: Held<Measured>): string {
  return h.held ? `${h.value.value} / ${h.value.denominator}` : "—";
}

/** A figure over a caption. A gap replaces the caption with its own sentence. */
export function Tile(props: {
  figure: string;
  caption: string;
  held?: Held<Measured>;
  gapText?: string | null;
}) {
  const gapText = props.gapText ?? (props.held && !props.held.held ? props.held.gap.says : null);
  return (
    <div className="rq-tile">
      <div className="rq-figure">{props.figure}</div>
      <div className="rq-caption">{gapText ?? props.caption}</div>
    </div>
  );
}

function whoseLabel(gap: Gap): string {
  if (gap.whose === "OURS") return "our gap";
  if (gap.whose === "THEIRS") return "their gap";
  return "cannot tell";
}

/** A named gap: whose, then the sentence. */
export function GapNote({ gap }: { gap: Gap }) {
  return (
    <span className="gap">
      <span className="gap-whose">{whoseLabel(gap)}</span> {gap.says}
    </span>
  );
}

/** A measured number, always with its denominator visible and its contract on hover. */
export function Num({ m, format }: { m: Measured; format?: (value: number) => string }) {
  const show = format ?? ((v: number) => String(v));
  return (
    <span title={`${m.contract} — denominator from ${m.denominatorSource}`}>
      <strong>{show(m.value)}</strong>
      <span className="denom"> of {show(m.denominator)}</span>
    </span>
  );
}

/** A held number or its gap. */
export function HeldNum({ h, format }: { h: Held<Measured>; format?: (value: number) => string }) {
  return h.held ? <Num m={h.value} format={format} /> : <GapNote gap={h.gap} />;
}

export const usd = (v: number): string => `$${v.toFixed(4)}`;

/** Age in plain words from an ISO stamp and the render clock. */
export function agoText(iso: string | null, nowIso: string): string {
  if (!iso) return "at no recorded time";
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "at an unreadable time";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
