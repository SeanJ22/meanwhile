/**
 * **THE DESIGN'S PRIMITIVES, WITH ITS HONESTY RULES BUILT IN.** (Admin
 * redesign, 2026-09-23.)
 *
 * Each piece here is one shape from the prototype, and each carries the rule
 * the design attached to it so no screen can break it by accident:
 *
 * ```
 *   Fig / Cells     a slot holding no measurement is the dashed pill, never
 *                   a figure and never a zero (START-HERE, "unknown is never
 *                   zero"); a floor says "at least"
 *   DeadEnd         what it ruled out, what would settle it and who moves
 *                   next — all three, or the box says which are missing
 *                   rather than rendering as finished (MW-016)
 *   Pill            the six design tones; the colour names the kind of fact,
 *                   never decoration
 * ```
 *
 * Server-safe: no hooks, no client state.
 */
import type { ReactNode } from "react";

import { s } from "./legacy-styles";

export type Tone = "teal" | "gold" | "amber" | "cyan" | "slate" | "stone";

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`${s.pill} ${s[tone]}`} title={title}>
      {children}
    </span>
  );
}

/** The dashed pill: a quantity nobody can measure yet. Its words say why, never a number. */
export function Dash({ children, large, title }: { children: ReactNode; large?: boolean; title?: string }) {
  return (
    <span className={`${s.dash} ${large ? s.dashLarge : ""}`} title={title}>
      {children}
    </span>
  );
}

export type FigTone = "text" | "muted" | "gold" | "amber" | "teal" | "accent" | "link";

const FIG_TONE: Readonly<Record<FigTone, string>> = {
  text: s.cText,
  muted: s.cMuted,
  gold: s.cGold,
  amber: s.cAmber,
  teal: s.cTeal,
  accent: s.cAccent,
  link: s.cLink,
};

/**
 * A figure slot. `value` null renders the dashed pill with `unknown` as its
 * words; a `floor` prefixes "at least" because the real number can only be
 * higher (START-HERE: a total over something unreadable is a floor).
 */
export function Fig({
  value,
  tone = "text",
  floor,
  unknown = "UNKNOWN",
  size = "fig",
}: {
  value: ReactNode | null;
  tone?: FigTone;
  floor?: boolean;
  unknown?: string;
  size?: "fig" | "figCell" | "figBig" | "fig24" | "figAmount" | "figSm";
}) {
  if (value === null || value === undefined) return <Dash>{unknown}</Dash>;
  return (
    <span className={`${s[size]} ${FIG_TONE[tone]}`}>
      {floor ? "at least " : ""}
      {value}
    </span>
  );
}

export interface FigLine {
  readonly key: string;
  readonly fig: ReactNode | null;
  readonly tone?: FigTone;
  readonly floor?: boolean;
  readonly unknown?: string;
  readonly text: ReactNode;
}

/** Rows that align share one grid with a max-content figure track (IMPLEMENTATION, UI rule 3). */
export function FigList({ lines, tight, small }: { lines: readonly FigLine[]; tight?: boolean; small?: boolean }) {
  return (
    <div className={tight ? s.figGridTight : s.figGrid}>
      {lines.map((l) => (
        <div key={l.key} className={s.contents}>
          <Fig value={l.fig} tone={l.tone} floor={l.floor} unknown={l.unknown} />
          <span className={small ? s.figTextSmall : s.figText}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export interface CellValue {
  readonly key: string;
  readonly value: number | string | null;
  readonly tone?: FigTone;
  readonly label: string;
  /** The words the dashed pill carries when the value is null. */
  readonly unknown?: string;
}

/** The six standing questions on a body's face, or any fixed row of cells. */
export function Cells({ cells, five }: { cells: readonly CellValue[]; five?: boolean }) {
  return (
    <div className={five ? s.cells5 : s.cells}>
      {cells.map((c) => (
        <div key={c.key} className={five ? s.cellWide : s.cell}>
          <div>
            <Fig value={c.value} tone={c.tone} size="figCell" unknown={c.unknown} />
          </div>
          <div className={s.cellLabel}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export function KV({ rows, tight }: { rows: readonly (readonly [ReactNode, ReactNode])[]; tight?: boolean }) {
  return (
    <div className={tight ? s.kvTight : s.kv}>
      {rows.map(([k, v], i) => (
        <div key={i} className={s.contents}>
          <span className={s.kvKey}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** The small mono key/value block at the foot of a reading card. */
export function MetaKV({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <div className={s.kvMeta}>
      {rows.map(([k, v], i) => (
        <div key={i} className={s.contents}>
          <span className={s.kvMetaKey}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export interface DeadEndFields {
  readonly pill: string;
  readonly tone?: Tone;
  readonly title: string;
  readonly ruledOut: string | null;
  readonly wouldSettle: string | null;
  readonly whoMoves: string | null;
  /** Why a missing field is missing, when the records say; else the generic words below. */
  readonly gaps?: { readonly ruledOut?: string; readonly wouldSettle?: string; readonly whoMoves?: string };
}

const NOT_RECORDED = "Not recorded — the system does not write this field yet (MW-016).";

/** A missing field's words: its own gap when the records named one, else the generic words. */
function missing(gap: string | undefined): string {
  return gap === undefined ? NOT_RECORDED : `Not known — ${gap} (MW-016).`;
}

/**
 * A dead end with its three fields. A missing field is said to be missing,
 * and the pill says the dead end is unexplained; it never renders as a
 * finished answer.
 */
export function DeadEnd({ d, flush }: { d: DeadEndFields; flush?: boolean }) {
  const complete = d.ruledOut !== null && d.wouldSettle !== null && d.whoMoves !== null;
  return (
    <div className={flush ? s.deadEndFlush : s.deadEnd}>
      <div className={s.row} style={{ marginBottom: 12 }}>
        <Pill tone={d.tone ?? "amber"}>{complete ? d.pill : `${d.pill} · UNEXPLAINED`}</Pill>
        <strong className={s.titleStrong}>{d.title}</strong>
      </div>
      <KV
        tight={flush}
        rows={[
          ["What it ruled out", d.ruledOut ?? missing(d.gaps?.ruledOut)],
          ["What would settle it", d.wouldSettle ?? missing(d.gaps?.wouldSettle)],
          ["Who moves next", d.whoMoves ?? missing(d.gaps?.whoMoves)],
        ]}
      />
    </div>
  );
}

/** A page section heading with its lede, as the design sets them. */
export function Section({ title, lede, id }: { title: ReactNode; lede?: ReactNode; id?: string }) {
  return (
    <>
      <h2 className={s.h2Page} id={id}>
        {title}
      </h2>
      {lede && <p className={s.lede}>{lede}</p>}
    </>
  );
}

/** A refusal in place of numbers: the page could not honestly draw them. */
export function Refusal({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.refusal} role="status">
      <div className={s.row} style={{ marginBottom: 10 }}>
        <Dash large>CANNOT TELL</Dash>
        <h2 className={s.h2Inline}>{title}</h2>
      </div>
      {children && <div className={s.body} style={{ marginTop: 0 }}>{children}</div>}
    </div>
  );
}

export { s as mw };
