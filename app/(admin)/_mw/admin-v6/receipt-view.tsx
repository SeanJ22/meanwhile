"use client";

/**
 * One instruction and what happened to it. The lifecycle facts are kept apart;
 * a fact nothing has reported shows as "—".
 */
import type { ReactElement } from "react";

import { useV6 } from "./context.tsx";
import { mst, type UiReceipt } from "./model.ts";
import { acceptedLine, doneWithChange, oneSentence, ORDER_STEPS, orderStepsReached, STATUS_TONE, TAKE_BACK } from "./receipts.ts";
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
  if (r.notPickedUp) {
    const back = TAKE_BACK[r.kind];
    if (back) follow.push(<ActionButton key="back" action={{ kind: back, target: r.target }} label="Take it back" />);
    follow.push(<ActionButton key="retry" action={{ kind: r.kind, target: r.target }} label="Try again" />);
    follow.push(<button key="workers" type="button" className={s.btn} onClick={() => v.go("workers")}>See Workers</button>);
  }
  const readBack = r.readBackAt; // a console path, not a time
  return (
    <article className={s.row} aria-label={`${r.label}: ${r.statusWords}`}>
      <div className={s.spread}>
        <strong style={{ fontSize: 13 }}>{r.label}{r.targetName ? ` · ${r.targetName}` : ""}</strong>
        <ReceiptChip receipt={r} />
      </div>
      <span className={s.meta}>{r.level === "global" ? "Whole system" : "Local"} · {r.scopeName} · sent {mst(r.sentAt)}{r.simulated ? " · sample receipt" : ""}</span>
      <p className={cx(s.p, s.small)} role={r.status === "unknown" || r.status === "failed" || r.notPickedUp ? "alert" : undefined}>{oneSentence(r.says)}</p>
      {(oneSentence(r.says) !== r.says.trim() || r.words) && (
        <details className={s.small}>
          <summary style={{ cursor: "pointer" }}>Show details</summary>
          <p className={cx(s.p, s.small)}>{r.says}{r.words ? ` Your words: “${r.words}”` : ""}</p>
        </details>
      )}
      {doneWithChange(r) && <p className={cx(s.p, s.small)}>{doneWithChange(r)}</p>}
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
          {acceptedLine(r, mst) && <p className={cx(s.p, s.small)}>{acceptedLine(r, mst)}</p>}
          <div className={s.stepper} aria-label="Where this order is">
            {ORDER_STEPS.map((label, n) => (
              <span key={label} className={cx(s.stepChip, n < orderStepsReached(r) && s.stepChipOn)}>{label}</span>
            ))}
          </div>
          <div className={s.small} role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={r.progress?.of ?? 1}
            aria-valuenow={r.progress?.done ?? 0}>
            {r.progress && r.progress.of ? (
              <>
                <div style={{ height: 6, borderRadius: 3, background: "var(--panel-border)" }}>
                  <div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, Math.round(((r.progress.done ?? 0) / r.progress.of) * 100))}%`, background: "var(--pill-teal-text)" }} />
                </div>
                <span className={s.meta}>{r.progress.done ?? 0} of {r.progress.of}</span>
              </>
            ) : <span className={s.meta}>Progress —</span>}
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
