"use client";

/**
 * One instruction and what happened to it. The lifecycle facts are kept apart;
 * a fact nothing has reported shows as "—".
 */
import type { ReactElement } from "react";

import { useV6 } from "./context.tsx";
import { LIFECYCLE_WORDS, mst, type UiReceipt } from "./model.ts";
import { STATUS_TONE } from "./receipts.ts";
import { ActionButton, cx, ReceiptChip, Technical } from "./ui.tsx";
import s from "./v6.module.css";

export function ReceiptCard(props: { readonly receipt: UiReceipt; readonly compact?: boolean }) {
  const v = useV6();
  const r = props.receipt;
  const checkWhy = r.status === "unknown" ? v.canCheck(r) : null;
  const follow: ReactElement[] = [];
  if (r.status === "unknown") {
    follow.push(
      <button key="check" type="button" className={s.btn} aria-disabled={checkWhy ? "true" : undefined} title={checkWhy ? checkWhy : undefined}
        onClick={() => { if (!checkWhy) v.check(r); }}>Check what happened</button>,
    );
  }
  if ((r.status === "failed" || r.status === "refused") && r.kind !== "decide") follow.push(<ActionButton key="again" action={{ kind: r.kind, target: r.target }} label="Try again" />);
  if (r.kind === "decide" && r.status === "refused") follow.push(<ActionButton key="other" action={{ kind: "decide", target: r.target }} label="Choose another option" />);
  if (r.kind === "contain" && r.status === "done") follow.push(<ActionButton key="undo" action={{ kind: "uncontain", target: r.target }} label="Undo" />);
  const readBack = r.readBackAt; // a console path, not a time
  return (
    <article className={s.row} aria-label={`${r.label}: ${r.statusWords}`}>
      <div className={s.spread}>
        <strong style={{ fontSize: 13 }}>{r.label}{r.targetName ? ` · ${r.targetName}` : ""}</strong>
        <ReceiptChip receipt={r} />
      </div>
      <span className={s.meta}>{r.level === "global" ? "Whole system" : "Local"} · {r.scopeName} · sent {mst(r.sentAt)}{r.simulated ? " · sample receipt" : ""}</span>
      <p className={cx(s.p, s.small)} role={r.status === "unknown" || r.status === "failed" ? "alert" : undefined}>{r.says}{r.words ? ` Your words: “${r.words}”` : ""}</p>
      {!!r.items.length && (
        <ul className={s.stack} style={{ gap: 4, margin: 0, paddingLeft: 0, listStyle: "none" }} aria-label="Result for each item">
          {r.items.map((it, i) => (
            <li key={i} className={s.small}>
              <span className={cx(STATUS_TONE[it.status] === "good" ? s.textGood : STATUS_TONE[it.status] === "warn" ? s.textWarn : s.textInfo)}>{({ done: "Done", partial: "Partly done", refused: "Refused", failed: "Failed", unknown: "Result unknown", queued: "Queued", read: "Read", running: "Running" })[it.status]}</span>
              {" · "}{it.name}{it.note ? <span className={s.dim}> — {it.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {!props.compact && (
        <>
          <div className={s.inline} style={{ gap: 6 }}>
            {r.steps.map((st, i) => <span key={i} className={cx(s.meta, s.mono)}>{st.label} {mst(st.at, false)}</span>)}
          </div>
          <div className={s.stepper} aria-label="What has actually happened">
            {LIFECYCLE_WORDS.map(([k, label]) => (
              <span key={k} className={cx(s.stepChip, r.lifecycle[k] && s.stepChipOn)} title={r.lifecycle[k] ? `${label}: ${mst(r.lifecycle[k])}` : `${label}: —`}>
                {label}{r.lifecycle[k] ? "" : " —"}
              </span>
            ))}
          </div>
        </>
      )}
      {!!follow.length && <div className={s.inline}>{follow}</div>}
      {checkWhy && <p className={s.why}>{checkWhy}</p>}
      {!props.compact && (
        <Technical lines={[`action key ${r.key}`, `kind ${r.kind} · target ${r.target}`, ...(r.gatewayReceiptId ? [`gateway receipt ${r.gatewayReceiptId}`] : []), ...(readBack ? [`read back ${readBack}`] : []), ...(r.replayed ? ["repeat submission"] : [])]} />
      )}
    </article>
  );
}
