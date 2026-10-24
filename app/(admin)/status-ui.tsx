/**
 * Every state renders in four layers: what this is, what happened, does this need me, what happens next,
 * with the technical detail one disclosure away.
 */
import { hasTechnicalText, plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import type { ReactNode } from "react";

import { plainCode, plainMeaning } from "@/lib/control-plane/plain-words.ts";

export interface NeedsYou {
  readonly needed: boolean;
  readonly action?: string;
}

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
      <span className="plain-code">
        {words}
      </span>
      {means && <span className="plain-means"> {means}</span>}
    </>
  );
}
