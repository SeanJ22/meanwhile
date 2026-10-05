/**
 * **THE FOUR LAYERS EVERY STATE ON THIS CONSOLE IS RENDERED IN.**
 * (Admin C, §9A.2, from the 9.6.26 owner feedback.)
 *
 * The owner's test for every surface, verbatim:
 *
 * > **What am I looking at? Does this need me? What happened? What happens next?**
 *
 * So a state is never one dense paragraph with a machine code in it. It is:
 *
 * ```
 *   1  what this is      one line naming the thing, not the enum
 *   2  what happened     one plain sentence, past tense, with the time
 *   3  does this need me Yes with the action, or No
 *   4  what happens next one plain sentence, future tense, with the time
 *   —  technical detail  the instrument's own words, the codes, the ids, the
 *                        SHA, the raw receipt — one disclosure away, never
 *                        hidden and never leading
 * ```
 *
 * These primitives are shared by every admin surface so the shape is the same
 * everywhere; a section that wants a different shape is a section that has not
 * decided what it is telling him.
 *
 * Nothing here reads a store, the clock or the environment.
 */
import { hasTechnicalText, plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import type { ReactNode } from "react";

import { plainCode, plainMeaning, plainText } from "@/lib/control-plane/plain-words.ts";

/** Whether a card needs the owner, and what to do if it does. */
export interface NeedsYou {
  readonly needed: boolean;
  /** When needed: what he should do, in his words. */
  readonly action?: string;
}

export const NEEDS_NOTHING: NeedsYou = { needed: false };

/**
 * The four layers, in order, with the technical evidence behind a disclosure.
 *
 * `what` is the noun — what this card is about. `happened` and `next` are
 * sentences. `detail` is anything: the instrument's own sentence, a table, a
 * list of ids. It is only rendered when there is something in it.
 */
export function StatusBlock(props: {
  readonly what: ReactNode;
  readonly happened: ReactNode;
  readonly next?: ReactNode;
  readonly needsYou: NeedsYou;
  readonly detail?: ReactNode;
  readonly detailLabel?: string;
  readonly children?: ReactNode;
}) {
  const diagnostics = [props.what, props.happened, props.next].filter((value): value is string => typeof value === "string" && hasTechnicalText(value));
  const face = (value: ReactNode) => typeof value === "string" ? plainWords(value) : value;
  return (
    <div className="status-block">
      <p className="status-what">{face(props.what)}</p>
      <p className="status-happened">{face(props.happened)}</p>
      {props.next && <p className="status-next">{face(props.next)}</p>}
      <NeedsYouLine needs={props.needsYou} />
      {props.children}
      {(props.detail || diagnostics.length > 0) && (
        <details className="status-detail">
          <summary>{props.detailLabel ?? "Technical details"}</summary>
          {props.detail}
          {diagnostics.map(value => <p key={value}>{value}</p>)}
        </details>
      )}
    </div>
  );
}

/**
 * `Needs you: No` or `Needs you: Yes — <action>`.
 *
 * The owner named this line on the role cards as something he likes and wants
 * everywhere (POS-14, and §9A.3 "Every card must also state Needs you").
 */
export function NeedsYouLine({ needs }: { needs: NeedsYou }) {
  if (!needs.needed) {
    return (
      <p className="needs-you needs-no">
        <strong>Needs you:</strong> No
      </p>
    );
  }
  return (
    <p className="needs-you needs-yes">
      <strong>Needs you:</strong> Yes — {needs.action ?? "a decision from you"}
    </p>
  );
}

/**
 * A machine constant rendered as words, with the raw code on hover and its
 * owner sentence beside it when the dictionary has one.
 *
 * This is the ONE place a code becomes text (ADM-25). A component that writes
 * `code.replace(/_/g, " ")` for itself is a second implementation of the same
 * rule and will drift from it.
 */
export function Code({ raw, withMeaning }: { raw: string | null | undefined; withMeaning?: boolean }) {
  const words = plainCode(raw);
  if (words === "") return null;
  const means = withMeaning ? plainMeaning(raw) : null;
  return (
    <>
      <span className="plain-code">
        {words}
      </span>
      {means && <span className="plain-means"> {means}</span>}
    </>
  );
}

/**
 * An instrument's own sentence with every machine constant inside it turned
 * into words. For quoted text the page cannot restructure.
 */
export function Plain({ text }: { text: string | null | undefined }) {
  return <>{plainText(text)}</>;
}

/**
 * A headline number with its plain definition underneath — the owner asked for
 * exactly this on the three summary cards (ADM-28: *"what does that even
 * mean?"*), and the definition is the load-bearing half.
 */
export function DefinedTile(props: {
  readonly figure: string;
  readonly label: string;
  readonly means: string;
  readonly needsYou: NeedsYou;
  readonly children?: ReactNode;
}) {
  return (
    <div className="rq-tile defined-tile">
      <div className="rq-figure">{props.figure}</div>
      <div className="rq-caption">
        <span className="tile-label">{props.label}</span>
        <span className="tile-means">{props.means}</span>
        <span className={`tile-needs ${props.needsYou.needed ? "needs-yes" : "needs-no"}`}>
          {props.needsYou.needed ? `Needs you: Yes — ${props.needsYou.action ?? "a decision from you"}` : "Needs you: No"}
        </span>
        {props.children}
      </div>
    </div>
  );
}

/**
 * A horizontal bar. The owner asked for more visual comprehension rather than
 * more text (§9A.15), and this is the primitive the rest reuse: a share of a
 * whole, in a restrained semantic colour, with the numbers still legible.
 */
export function Bar(props: {
  readonly value: number;
  readonly of: number;
  readonly tone?: "ok" | "warn" | "bad" | "info" | "none";
  readonly label?: string;
  readonly title?: string;
}) {
  const of = props.of > 0 ? props.of : 1;
  const pct = Math.max(0, Math.min(100, (props.value / of) * 100));
  return (
    <span className={`sbar sbar-${props.tone ?? "info"}`} title={props.title ?? `${props.value} of ${props.of}`}>
      <span className="sbar-track">
        <span className="sbar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
      </span>
      {props.label && <span className="sbar-label">{props.label}</span>}
    </span>
  );
}

/**
 * A stacked bar: several tones in one track. For "how much is done, waiting and
 * blocked" in one glance.
 */
export function StackBar({ parts, total }: { parts: readonly { tone: string; value: number; label: string }[]; total: number }) {
  const of = total > 0 ? total : 1;
  return (
    <span className="sbar sbar-stack" title={parts.map((p) => `${p.label}: ${p.value}`).join(" · ")}>
      <span className="sbar-track">
        {parts.map((p) => (
          <span key={p.label} className={`sbar-seg seg-${p.tone}`} style={{ width: `${((p.value / of) * 100).toFixed(1)}%` }} />
        ))}
      </span>
    </span>
  );
}
