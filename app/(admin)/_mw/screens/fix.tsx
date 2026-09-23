import "server-only";

/**
 * **FIX LIST — what you cannot do today, as what you would be able to do.**
 * (Admin redesign, 2026-09-23; Fleet · Fix list and Readiness · Fix list
 * render this same screen.)
 *
 * The MW items with their verified status, what to check first and where each
 * stands; the marks that order them; and the fix queue — the one durable path
 * from a gap to engineering work — with everything already on it.
 */
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { readDecisions } from "@/lib/control-plane/admin-data.ts";
import { FIX_ITEMS, fixQueueText } from "@/lib/control-plane/admin-view/fix-list.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { FIX_QUEUE_SUBJECT, GO_FIX_OPTION, fixConsequence, fixQueueView, fixSubjectId, type FixQueueItem } from "@/lib/control-plane/fix-queue.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim } from "@/lib/control-plane/owner-surface.ts";

import { AuditFooter, NotAsked } from "../blocks.tsx";
import { FixList, GoFix, type QueueState } from "../fix-controls.tsx";
import { openPage, type SearchParams } from "../page-base.ts";
import type { MwArea } from "../scope.ts";
import { MwShell } from "../shell.tsx";
import { Refusal, Section, mw as s } from "../ui.tsx";

const STATE_WORDS: Readonly<Record<FixQueueItem["state"], string>> = {
  QUEUED: "On the fix queue",
  SENT: "Sent — waiting for the next sync",
  OPENED: "Opened as work",
  REFUSED: "Refused by the gates",
};

export async function FixScreen(props: { readonly area: MwArea; readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const path = props.area === "fleet" ? "/admin/fix" : "/readiness/fix";
  const base = await openPage(path, sp);
  const shellProps = {
    area: props.area,
    tab: "fix" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: null,
  };
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }
  const [decisionsOut, pulse] = await Promise.all([readDecisions(base.repos), readPulse(base.repos, base.nowIso)]);
  const view = decisionsOut.kind === "HELD" ? fixQueueView(collapseDecisionLog(decisionsOut.value)) : null;

  const fixField: Record<string, string> = {};
  const queue: Record<string, QueueState> = {};
  const mwSubjects = new Set<string>();
  for (const item of FIX_ITEMS) {
    const t = fixQueueText(item);
    fixField[item.id] = fixConsequence(t.where, t.says);
    const subject = fixSubjectId(t.where, t.says);
    mwSubjects.add(subject);
    const q = view?.items.find((i) => i.subjectId === subject) ?? null;
    if (q) {
      queue[item.id] = {
        queued: true,
        words: `${STATE_WORDS[q.state]} · added ${formatEastern(q.queuedAt)}${q.openedWork.length > 0 ? ` · ${q.openedWork.map((w) => w.id).join(", ")}` : ""}`,
      };
    }
  }
  const others = view ? view.items.filter((i) => !mwSubjects.has(i.subjectId)) : [];

  const claims: CountClaim[] = [{ label: "fix list items", stated: FIX_ITEMS.length, rendered: FIX_ITEMS.length }];
  if (view) claims.push({ label: "other queued gaps", stated: others.length, rendered: others.length });
  const numberAudit = auditRenderedNumbers([]);
  const countAudit = checkStatedEqualsRendered(claims);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <MwShell {...shellProps}>
        <Refusal title="This page refused to draw its own numbers.">
          {!countAudit.ok && <p>{countAudit.detail}</p>}
        </Refusal>
      </MwShell>
    );
  }

  return (
    <MwShell {...shellProps}>
      <p className={s.lede}>
        Each line is something you cannot do today, written as what you would be able to do. Mark each one to order the list; put one on the fix queue to make it
        engineering work. Every line names what to check in the real code first — a field missing from one report is not proof the information exists nowhere.
        {base.scope.kind !== "all" ? " These are about the system as a whole, so the list is the same in every scope." : ""}
      </p>
      <FixList items={FIX_ITEMS} queue={queue} fixField={fixField} returnTo={base.here} />

      <Section
        title="The fix queue"
        lede="Everything put on the queue from any page, as the decision log holds it. Go fix these sends what is waiting; the next decision sync opens one work row for each, and each row is listed here once it exists."
      />
      {view === null ? (
        <Refusal title="The fix queue was not read.">The decision log could not be read just now, so nothing on the queue is shown. It is not empty.</Refusal>
      ) : (
        <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
          <div className={s.stack12}>
            <span className={s.note}>
              {view.counts.queued} waiting · {view.counts.sent} sent · {view.counts.opened} opened as work · {view.counts.refused} refused
              {view.lastGo ? ` · last sent ${formatEastern(view.lastGo.decidedAt)}` : " · never sent"}
            </span>
            {others.length === 0 ? (
              <span className={s.note}>Nothing else is on the queue.</span>
            ) : (
              others.map((i) => (
                <div key={i.subjectId} className={s.insetRow}>
                  <div className={s.stack2}>
                    <span className={s.text14}>
                      <span className={s.strong}>{i.where}</span> — {i.says}
                    </span>
                    <span className={s.monoSmall}>
                      {STATE_WORDS[i.state]} · added {formatEastern(i.queuedAt)}
                      {i.openedWork.length > 0 ? ` · ${i.openedWork.map((w) => `${w.id} — ${w.title}`).join("; ")}` : ""}
                      {i.refusedReason ? ` · ${i.refusedReason}` : ""}
                    </span>
                  </div>
                </div>
              ))
            )}
            <GoFix queued={view.counts.queued} subjectId={FIX_QUEUE_SUBJECT} option={GO_FIX_OPTION} renderedRevision={pulse.revision} returnTo={base.here} />
          </div>
        </div>
      )}
      <AuditFooter numbers={[]} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}
