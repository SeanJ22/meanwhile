/**
 * Every state renders in four layers: what this is, what happened, does this need me, what happens next,
 * with the technical detail one disclosure away.
 */
import type { ReactNode } from "react";

import { plainCode, plainMeaning, plainText } from "@/lib/control-plane/plain-words.ts";

export interface NeedsYou {
  readonly needed: boolean;
  readonly action?: string;
}

export const NEEDS_NOTHING: NeedsYou = { needed: false };

/** `detail` is rendered only when there is something in it. */
export function StatusBlock(props: {
  readonly what: ReactNode;
  readonly happened: ReactNode;
  readonly next?: ReactNode;
  readonly needsYou: NeedsYou;
  readonly detail?: ReactNode;
  readonly detailLabel?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="status-block">
      <p className="status-what">{props.what}</p>
      <p className="status-happened">{props.happened}</p>
      {props.next && <p className="status-next">{props.next}</p>}
      <NeedsYouLine needs={props.needsYou} />
      {props.children}
      {props.detail && (
        <details className="status-detail">
          <summary>{props.detailLabel ?? "Technical details"}</summary>
          {props.detail}
        </details>
      )}
    </div>
  );
}

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

/** The one place a machine constant becomes text: words on the face, the raw code on hover. */
export function Code({ raw, withMeaning }: { raw: string | null | undefined; withMeaning?: boolean }) {
  const words = plainCode(raw);
  if (words === "") return null;
  const means = withMeaning ? plainMeaning(raw) : null;
  return (
    <>
      <span className="plain-code" title={raw ?? undefined}>
        {words}
      </span>
      {means && <span className="plain-means"> {means}</span>}
    </>
  );
}

export function Plain({ text }: { text: string | null | undefined }) {
  return <>{plainText(text)}</>;
}

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
