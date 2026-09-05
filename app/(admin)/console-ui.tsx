/**
 * **THE CONSOLE'S SHARED RENDER PRIMITIVES.** (9.4.26 admin feedback, ADM-3/7;
 * extended for the evening pass, ADM-12/19/20/21/22.)
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
 *
 * The evening pass added four primitives, each closing a class the owner
 * named on one screen and that was wrong on every screen:
 *
 *   When       every stamp shown to him is Eastern, spelled out (ADM-22); the
 *              ISO string lives on the element as `dateTime` and the hover
 *   Name       every key renders as its display name with its level colour,
 *              the raw key on hover (ADM-12, ADM-21)
 *   GapNote    a gap is "not measured" or "not published", with no
 *              possessive — the site has one user (ADM-19) — and every gap
 *              carries the button that puts it on the fix queue (ADM-20)
 *   QueueButton  that button: a plain POST to the decision route
 */
import { easternize, formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { LEVEL_CLASS, LEVEL_LABEL, displayNameOf, type JurisdictionLevel } from "@/lib/control-plane/display-name.ts";
import { ADD_TO_QUEUE_OPTION, fixConsequence } from "@/lib/control-plane/fix-queue.ts";
import type { Gap, HealthLevel, Held, Measured } from "@/lib/control-plane/owner-surface.ts";
import { HEALTH_SCALE } from "@/lib/control-plane/plain-health.ts";
import type { CellState } from "@/lib/control-plane/readiness/gates.ts";

export const DECISION_ROUTE = "/api/admin/decision";

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

/** The consumer legend's four jurisdiction levels, in the console's colours (ADM-21). */
export function LevelLegend() {
  const levels: JurisdictionLevel[] = ["federal", "state", "local", "school"];
  return (
    <div className="rq-legend level-legend" aria-label="What the level colours mean">
      {levels.map((l) => (
        <span key={l} className={LEVEL_CLASS[l]}>
          <i className="rq-cell lvl-swatch" /> {LEVEL_LABEL[l]}
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
  /** Where this tile sits, for the queue button a gap carries. */
  where?: string;
}) {
  const gapText = props.gapText ?? (props.held && !props.held.held ? props.held.gap.says : null);
  return (
    <div className="rq-tile">
      <div className="rq-figure">{props.figure}</div>
      <div className="rq-caption">
        {gapText ?? props.caption}
        {gapText && props.where && <QueueButton where={props.where} says={gapText} compact />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- gaps */

/**
 * Whose gap it is, in the owner's own frame (ADM-19): the site has one user,
 * so a gap of ours is simply "not measured"; a gap of theirs is "not
 * published" by the source; a gap nobody can settle yet is "cannot tell".
 */
export function gapLabel(gap: Gap): string {
  if (gap.whose === "OURS") return "not measured";
  if (gap.whose === "THEIRS") return "not published";
  return "cannot tell";
}

export const QUEUE_FORM_ID = "fix-queue-add";

/**
 * The ONE form every queue button submits (ADM-20), rendered once per page.
 *
 * A `<form>` may not sit inside a paragraph or a caption — the browser repairs
 * the HTML by closing the paragraph, React sees a different tree than it
 * rendered, hydration fails and the theme attribute is lost with it (measured
 * 2026-09-05 on /admin). So the buttons are plain phrasing content that name
 * this form by id and carry the gap as their value; the route derives the
 * subject and the consequence from that value (`parseFixField`).
 */
export function QueueForm({ returnTo }: { returnTo: string }) {
  return (
    <form id={QUEUE_FORM_ID} method="post" action={DECISION_ROUTE} hidden aria-hidden="true">
      <input type="hidden" name="chosenOption" value={ADD_TO_QUEUE_OPTION} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </form>
  );
}

/**
 * The button that puts a gap on the fix queue (ADM-20): subject
 * `fix:<hash of where + what>`, so the same gap queued twice is one item; the
 * sentence the owner read travels as the consequence he was shown. It submits
 * the page's {@link QueueForm}.
 */
export function QueueButton({ where, says, compact }: { where: string; says: string; returnTo?: string; compact?: boolean }) {
  return (
    <button
      type="submit"
      form={QUEUE_FORM_ID}
      name="fix"
      value={fixConsequence(where, says)}
      className={`queue-add${compact ? " compact" : ""}`}
      title={`Put this on the fix queue: ${where} — ${says}`}
    >
      {ADD_TO_QUEUE_OPTION}
    </button>
  );
}

/**
 * A named gap: the label, the sentence, and — when the page says where it is —
 * the button that queues it. A gap the owner cannot act on is just a sentence
 * he has to keep reading (ADM-20).
 */
export function GapNote({ gap, where, returnTo }: { gap: Gap; where?: string; returnTo?: string }) {
  return (
    <span className="gap">
      <span className="gap-whose">{gapLabel(gap)}</span> {easternize(gap.says)}
      {where && <QueueButton where={where} says={gap.says} returnTo={returnTo} compact />}
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
export function HeldNum({ h, format, where, returnTo }: { h: Held<Measured>; format?: (value: number) => string; where?: string; returnTo?: string }) {
  return h.held ? <Num m={h.value} format={format} /> : <GapNote gap={h.gap} where={where} returnTo={returnTo} />;
}

export const usd = (v: number): string => `$${v.toFixed(4)}`;
export const usdShort = (v: number): string => (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);

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

/**
 * An instrument's sentence, quoted as the owner reads it: every ISO stamp
 * inside it in Eastern time (ADM-22), the words untouched.
 */
export function Said({ text }: { text: string | null | undefined }) {
  return <>{easternize(text ?? "")}</>;
}

/* ---------------------------------------------------------------- times */

/**
 * A stamp the owner reads (ADM-22): "September 5, 10:20 PM ET". The ISO
 * string stays on the element for the machine and the hover.
 */
export function When({ iso, year }: { iso: string | null | undefined; year?: boolean }) {
  if (!iso) return <span className="when">{formatEastern(iso)}</span>;
  return (
    <time className="when" dateTime={iso} title={iso}>
      {formatEastern(iso, { year })}
    </time>
  );
}

/* ---------------------------------------------------------------- names */

/**
 * A key, rendered as its display name in the colour of its level, with the
 * raw key on hover (ADM-12, ADM-21). `candidateNames` is the publisher's
 * slug → filed-name map, when the page has one.
 */
export function Name({
  raw,
  candidateNames,
  short,
  pill,
}: {
  raw: string | null | undefined;
  candidateNames?: Readonly<Record<string, string>>;
  /** Render the shorter form (for a pill). */
  short?: boolean;
  /** Render as a pill rather than inline text. */
  pill?: boolean;
}) {
  const d = displayNameOf(raw, { candidateNames });
  const cls = [pill ? "where" : "name", d.level ? LEVEL_CLASS[d.level] : "", d.recognised ? "" : "name-unrecognised"].filter(Boolean).join(" ");
  return (
    <span className={cls} title={d.raw === d.name ? undefined : d.raw}>
      {d.level && <i className="lvl-dot" aria-hidden="true" />}
      {short ? d.short : d.name}
    </span>
  );
}
