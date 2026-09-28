import Link from "next/link";
import type { huntOverview } from "@/lib/control-plane/admin-view/hunt-overview.ts";
import { plainText } from "@/lib/control-plane/plain-words.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { ORIGINAL_LIFETIME_HUNT } from "@/lib/control-plane/scheduler/hunt-continuation.ts";
import { mw as s } from "./ui.tsx";

type Overview = ReturnType<typeof huntOverview>;
const note = `${s.note} ${s.cText}`;
const amount = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "not measured";

export function WorkOverview(props: { overview: Overview; publishedAt: string | null; nextCycleAt: string | null;
  detailsHref: string; checklistHref: string; moneyHref: string; workHref: (id: string) => string }) {
  const o = props.overview;
  const counts = o.counts;
  const known = o.money;
  const firstBlocker = o.priorities[0];
  const firstDecision = o.ownerDecisions[0];
  const prepared = o.decision.key === ORIGINAL_LIFETIME_HUNT.key && o.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId;
  return <section aria-label="Selected hunt overview" className={s.stack14} style={{ overflowWrap: "anywhere" }}>
    <h2 className={s.h3}>{o.decision.geography.label}</h2>
    <p className={note}>Saved instruction from {formatEastern(o.decision.budgetStartedAt ?? o.decision.decidedAt)}.
      {props.publishedAt ? ` Work last updated ${formatEastern(props.publishedAt)}.` : " Work update time is unavailable."}
      {" "}Shared work is included only when it records this instruction.</p>
    <div className={s.gridAuto300}>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Received by readers</h3>
        <p className={s.text14}>{!o.deliveryReadComplete ? "The complete publication and public-check trail could not be read."
          : o.delivered.length === 0 ? "No current check confirms a public result in this instruction’s recorded publication trail."
            : `${o.delivered.length} current public check${o.delivered.length === 1 ? " confirms" : "s confirm"} exact record versions in this instruction’s trail.`}</p>
        <div className={s.stack8}>{o.delivered.slice(0, 6).map(row => <div key={`${row.versionId}:${row.readerKey}`}>
          <a href={row.url} target="_blank" rel="noreferrer" className={s.btnLink}>{plainText(row.label)}</a>
          <p className={note}>{row.change === "NEW" ? "New record" : row.change === "UPDATED" ? "Updated record" : row.change === "REUSED" ? "Reused verified record" : "New/reused comparison not recorded"} · checked {formatEastern(row.checkedAt)}</p>
        </div>)}</div>
        {o.delivered.length > 6 && <details><summary className={note}>Show {o.delivered.length - 6} more confirmed {o.delivered.length === 7 ? "check" : "checks"}</summary>
          <div className={s.stack8}>{o.delivered.slice(6).map(row => <div key={`${row.versionId}:${row.readerKey}`}>
            <a href={row.url} target="_blank" rel="noreferrer" className={s.btnLink}>{plainText(row.label)}</a>
            <p className={note}>{row.change === "NEW" ? "New record" : row.change === "UPDATED" ? "Updated record" : row.change === "REUSED" ? "Reused verified record" : "New/reused comparison not recorded"} · checked {formatEastern(row.checkedAt)}</p>
          </div>)}</div>
        </details>}
        <Link href={props.detailsHref} className={s.btnLink}>Follow delivery and evidence</Link>
      </div>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Still missing</h3>
        <p className={s.text14}>{o.unfinished === null ? "The full work counts cannot be reconciled for this instruction."
          : `${o.unfinished} of ${o.knownWork} tracked work items are waiting, working, failed, blocked or uncertain.`}</p>
        <p className={note}>Work items are jobs. The full checklist separately shows missing reader facts, unbuilt capabilities and unresolved coverage.</p>
        <Link href={props.checklistHref} className={s.btnLink}>See every requirement and gap</Link>
      </div>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Work now</h3>
        <p className={s.text14}>{counts ? `${counts.WORKING} recorded running; ${counts.WAITING} waiting; ${counts.UNKNOWN} with uncertain status.` : "This instruction’s running and waiting counts are unavailable."}</p>
        <p className={note}>{props.nextCycleAt ? `Runner’s next saved cycle time: ${formatEastern(props.nextCycleAt)}. This is a schedule, not a completion promise.` : "The next runner cycle time is not recorded."}</p>
        <Link href={props.detailsHref} className={s.btnLink}>See runner acknowledgement</Link>
      </div>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Stuck work</h3>
        {firstBlocker ? <><p className={s.text14}>{plainText(firstBlocker.row.subjectName || firstBlocker.row.label)}</p>
          <p className={note}>{plainText(firstBlocker.row.blocker ?? "The reason has not been recorded.")} {plainText(firstBlocker.row.nextAction)}</p>
          <Link href={props.workHref(firstBlocker.row.id)} className={s.btnLink}>See the cause and repair history</Link></>
          : <p className={note}>{counts ? "No ranked blocker or overdue item is recorded in this instruction’s work index." : "The blocker list could not be established for this instruction."}</p>}
      </div>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Your next action</h3>
        {firstDecision ? <><p className={s.text14}>{plainText(firstDecision.row.nextAction)}</p>
          <p className={note}>{o.ownerDecisions.length} item{o.ownerDecisions.length === 1 ? " needs" : "s need"} your decision. Open the top item for its effect and available control.</p>
          <Link href={props.workHref(firstDecision.row.id)} className={s.btnLink}>Open the decision</Link></>
          : <p className={note}>{counts ? "No item in the current index is assigned to you for a decision. Automatic work, publisher waits and code repairs are listed separately below." : "We cannot tell whether an owner decision is needed until the work index is readable."}</p>}
      </div>
      <div className={s.inset}>
        <h3 className={s.titleStrong16}>Cost</h3>
        {known ? <><p className={s.text14}>Anthropic allowance: {amount(known.budgetConsumedKnownUsd)} known charges; {amount(known.reservedUsd)} reserved; {amount(known.availableUsd)} available of {amount(known.budgetUsd)}.</p>
          <p className={note}>Allocated once for combined reporting: {amount(known.anthropicKnownUsd)} Anthropic + {amount(known.otherKnownUsd)} other services = {amount(known.knownCombinedUsd)} known total.
            {known.anthropicUsd === null || known.otherUsd === null ? " This is an incomplete subtotal." : ""}
            {known.unpriced > 0 ? ` ${known.unpriced} cost records have no dollar amount; this does not establish that each was a paid request.` : ""}</p>
          <p className={note}>Cost observed {o.moneyAt ? formatEastern(o.moneyAt) : "at an unknown time"}.</p></>
          : <p className={note}>No exact cost snapshot is available for this saved instruction. An earlier hunt’s charges are not shown as this hunt’s totals.</p>}
        <Link href={props.moneyHref} className={s.btnLink}>See services, models and attempts</Link>
      </div>
    </div>
    {prepared && <p className={note}>Prior preparation: the Sierra Vista calendar was captured September 26, before this hunt. Recovered documents and retained records are not newly discovered information.</p>}
    <details className={note}><summary>Instruction reference</summary>{o.decision.receiptId}</details>
  </section>;
}
