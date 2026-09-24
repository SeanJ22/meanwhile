/**
 * **FLEET · NOW.** (Admin redesign, 2026-09-23 — the design package's first
 * screen, replacing the long Pilot health page.)
 *
 * Three cards (what is working, what isn't, where to put effort), the
 * decisions only the owner can make, and every body we watch — each card's
 * figures derived from the lists drawn beneath it, so no card can claim what
 * its list does not show.
 *
 * ```
 *   the bodies       every public body with a registered meeting source, read
 *                    narrowly from the production data plane (body-store.ts)
 *   the decisions    the published decision cards, minus those already decided
 *                    on the owner's decision log
 *   the scope        everywhere, a state, or a selected geography; a scope with
 *                    nothing registered answers in sentences
 * ```
 *
 * The page audits itself before it shows anything: every figure carries a
 * denominator and a stated meaning, and every stated count equals the rows
 * drawn. A failed audit replaces the numbers with the reason.
 */
import { readDecisions, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { nowFigures, type BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { SYNC_CADENCE, receiptHeadline, splitDecided } from "@/lib/control-plane/decision-receipt.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  decisionCardKind,
  type CountClaim,
  type OwnerDecisionCard,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { routineAssignmentId } from "@/lib/control-plane/assignment-routine.ts";

import { BodyList } from "../_mw/body-list.tsx";
import { AuditFooter, EmptyScope, NotAsked } from "../_mw/blocks.tsx";
import { divisionsOf, loadContainer } from "../_mw/data/geography.ts";
import { loadWatchedBodies } from "../_mw/data/load-bodies.ts";
import { stateName } from "../_mw/load-shell.ts";
import { NextSteps, type StepCard } from "../_mw/next-steps.tsx";
import { openPage, type SearchParams } from "../_mw/page-base.ts";
import { withScope } from "../_mw/scope.ts";
import { MwShell } from "../_mw/shell.tsx";
import { Dash, FigList, Pill, Refusal, Section, mw as s, type FigLine } from "../_mw/ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const ACTION_ROUTE = "/api/admin/action";
const LIVE_ROUTE = "/api/admin/live";
const PRIORITY_ORDER: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function stepsFrom(waiting: readonly OwnerDecisionCard[]): StepCard[] {
  const kindOrder = { DECISION: 0, ACKNOWLEDGE: 1, BLOCKED_WHILE: 2 } as const;
  return [...waiting]
    .sort(
      (a, b) =>
        kindOrder[decisionCardKind(a)] - kindOrder[decisionCardKind(b)] ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
        a.rowId.localeCompare(b.rowId),
    )
    .map((c, i) => {
      const kind = decisionCardKind(c);
      return {
        rowId: c.rowId,
        rank: i + 1,
        title: c.title,
        whatIsNeeded: c.whatIsNeeded,
        why: c.whyNoMachineCanDecide,
        options: kind === "BLOCKED_WHILE" ? [] : c.options,
        priority: c.priority,
        ageDays: c.ageDays,
        kind,
        blocker: c.blocker ?? null,
        ownWords: kind === "DECISION",
      };
    });
}

export default async function FleetNowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const base = await openPage("/admin", sp);
  const shellProps = {
    area: "fleet" as const,
    tab: "now" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: null,
  };

  if (!base.shell.registered) {
    const name = base.scope.kind === "all" ? "Everywhere" : stateName(base.scope.state);
    return (
      <MwShell {...shellProps}>
        <EmptyScope name={name} scope={base.scope} />
      </MwShell>
    );
  }
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  const repos = base.repos;
  const container = base.scope.kind === "geo" ? loadContainer(base.scope.type, base.scope.geoid) : null;
  const [snapshotOut, decisionsOut, pulse, bodiesRead, containerRead] = await Promise.all([
    readSnapshot(repos),
    readDecisions(repos),
    readPulse(repos, base.nowIso),
    loadWatchedBodies(base.nowIso),
    container,
  ]);

  /* ------------------------------------------------------------ the scope's bodies */
  let bodies: readonly BodyView[] = [];
  let scopeNote: string | null = null;
  if (bodiesRead.kind === "HELD") {
    if (base.scope.kind === "all") bodies = bodiesRead.views.filter((b) => b.stateCode !== null);
    else if (base.scope.kind === "state") {
      const st = base.scope.state;
      bodies = bodiesRead.views.filter((b) => b.stateCode === st);
    } else if (containerRead && containerRead.kind === "HELD") {
      const divisions = divisionsOf(containerRead.value.zctas);
      bodies = bodiesRead.views.filter((b) => b.ocdId !== null && divisions.has(b.ocdId));
      const outside = containerRead.value.zctas.filter((z) => !z.indexed).length;
      if (outside > 0) {
        scopeNote = `${outside} of this geography's ${containerRead.value.zctas.length} ZCTAs are outside the ZIP index this repository has geometry for, so bodies reaching only those codes are not listed — the list is a floor.`;
      }
    } else {
      scopeNote = containerRead?.kind === "UNREAD" ? containerRead.detail : "This geography could not be resolved, so no body is placed in it.";
    }
  }
  const figures = nowFigures(bodies);

  /* ------------------------------------------------------------ decisions */
  const snapshot = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const decisionLog = decisionsOut.kind === "HELD" ? decisionsOut.value : null;
  const split = snapshot && decisionLog ? splitDecided(snapshot.decisionCards, collapseDecisionLog(decisionLog)) : null;
  const waiting = split ? split.waiting : [];
  // What he decided, newest first, with the three-leg receipt the gateway's answer promises ("the card will say when that has happened").
  const decided = split ? split.decided : [];
  const DECIDED_SHOWN = 8;
  const steps = stepsFrom(waiting);
  const decisionCount = steps.filter((c) => c.kind === "DECISION").length;
  const optionalCount = steps.filter((c) => c.kind === "ACKNOWLEDGE").length;
  const wallCount = steps.filter((c) => c.kind === "BLOCKED_WHILE").length;

  /* ------------------------------------------------------------ the page's audit */
  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [];
  const bodiesHeld = bodiesRead.kind === "HELD";
  if (bodiesHeld) {
    numbers.push({ label: "bodies that got in", value: figures.gotIn, denominator: Math.max(figures.bodies, figures.gotIn), contract: "watched bodies whose own last read got in, of every watched body in scope" });
    // The card draws could-not-get-in and not-read-in-seven-days as one figure, so the audit declares that figure.
    numbers.push({ label: "bodies we could not get into or have not read", value: figures.couldNot + figures.notRead, denominator: Math.max(figures.bodies, figures.couldNot + figures.notRead), contract: "watched bodies whose own last read could not get in, or with no read in seven days, of every watched body in scope" });
    numbers.push({ label: "records held", value: figures.records, denominator: figures.records, contract: "meetings in the versions held for the bodies in scope, now" });
    numbers.push({ label: "records a reader can open", value: figures.readerVisible, denominator: figures.records, contract: "meetings in versions the typed Reader read back, of all meetings held" });
    numbers.push({ label: "past meetings with no agenda", value: figures.noAgendaLink, denominator: figures.records, contract: "past meetings carrying neither an agenda link nor an attached agenda, of all meetings held" });
    if (figures.day) {
      const total = figures.day.added + figures.day.changed + figures.day.removed;
      numbers.push({ label: "changes in 24 hours", value: total, denominator: total, contract: "records added, revised or removed in versions promoted in the last 24 hours" });
    }
    claims.push({ label: "bodies", stated: bodies.length, rendered: bodies.length });
  }
  numbers.push({ label: "decisions only you can make", value: decisionCount, denominator: steps.length, contract: "decision cards waiting on the owner, of every card waiting" });
  numbers.push({ label: "optional items", value: optionalCount, denominator: steps.length, contract: "acknowledgement cards waiting, of every card waiting" });
  claims.push({ label: "suggested next steps", stated: steps.length, rendered: steps.length });
  const numberAudit = auditRenderedNumbers(numbers);
  const countAudit = checkStatedEqualsRendered(claims);

  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <MwShell {...shellProps}>
        <Refusal title="This page refused to draw its own numbers.">
          {!numberAudit.ok && <p>{numberAudit.detail}</p>}
          {!countAudit.ok && <p>{countAudit.detail}</p>}
          <p>A number without a denominator, or a headline that disagrees with the rows beneath it, is worse than a blank page: you would act on it.</p>
        </Refusal>
      </MwShell>
    );
  }

  /* ------------------------------------------------------------ the three cards */
  const floor = figures.floor;
  const unreadable = figures.couldNot + figures.notRead;
  const dayTotal = figures.day ? figures.day.added + figures.day.changed + figures.day.removed : null;
  const working: FigLine[] = bodiesHeld
    ? [
        {
          key: "got-in",
          fig: String(figures.gotIn),
          tone: "gold",
          text: `of ${figures.bodies} ${figures.bodies === 1 ? "body" : "bodies"} got in when they last looked — each at its own last read`,
        },
        {
          key: "changes",
          fig: dayTotal === null ? null : dayTotal.toLocaleString("en-US"),
          unknown: "NOT READ IN 24H",
          floor: floor && dayTotal !== null,
          tone: "text",
          text:
            figures.day === null
              ? "changes: no body in scope was read in the last 24 hours"
              : `changes caught in the last 24 hours${unreadable > 0 ? `, not counting ${unreadable} ${unreadable === 1 ? "body" : "bodies"} we could not read` : ""}`,
        },
        {
          key: "held",
          fig: figures.records.toLocaleString("en-US"),
          floor: figures.recordsFloor,
          tone: "accent",
          text: `records held as of now; ${figures.readerVisible.toLocaleString("en-US")} of them in versions a reader was confirmed able to open${
            figures.recordsFloor ? ". A body read through two sources counts the larger, since both may list the same sitting" : ""
          }`,
        },
      ]
    : [];
  /*
   * The breakdown of the 24-hour figure, and what its size says. Revisions many
   * times the records held can only be the same records re-issued on repeated
   * reads, so the page says so — from the two figures, not from a belief.
   */
  let revisionsNote = "";
  if (figures.day) {
    const d = figures.day;
    revisionsNote = ` The 24 hours: ${d.added.toLocaleString("en-US")} added, ${d.changed.toLocaleString("en-US")} revised, ${d.removed.toLocaleString("en-US")} removed.`;
    const perRecord = figures.records > 0 ? d.changed / figures.records : 0;
    if (perRecord >= 2) {
      revisionsNote += ` ${d.changed.toLocaleString("en-US")} revisions against ${figures.records.toLocaleString("en-US")} records held is about ${Math.round(perRecord)} per record in a day, so most are the same records re-issued on repeated reads, not new facts.`;
    }
  }
  const isnt: FigLine[] = bodiesHeld
    ? [
        {
          key: "could-not",
          fig: String(unreadable),
          tone: unreadable > 0 ? "amber" : "muted",
          text: unreadable > 0 ? "bodies we could not get into or have not read in seven days, so we do not know what we are missing" : "bodies we could not get into",
        },
        {
          key: "disagrees",
          fig: null,
          unknown: "NOT CHECKED",
          text: "records that disagree with something else we hold — nothing checks this for meetings yet, so it is unknown, not zero",
        },
        {
          key: "gaps",
          fig: figures.noAgendaLink.toLocaleString("en-US"),
          floor,
          tone: figures.noAgendaLink > 0 ? "gold" : "muted",
          text: `past meetings we hold with no agenda attached${figures.held > 0 ? `, and ${figures.held} ${figures.held === 1 ? "record" : "records"} held back by a check` : ""}${floor ? ", before counting the bodies we could not read" : ""}`,
        },
      ]
    : [];

  const stateNames: Record<string, string> = Object.fromEntries(US_STATES.map((st) => [st.code, st.name]));
  const workHref: Record<string, string> = {};
  for (const b of bodies) for (const id of b.contractIds) workHref[id] = withScope(`/admin/work?open=${encodeURIComponent(routineAssignmentId(id))}`, base.scope);

  return (
    <MwShell {...shellProps} extraStrip={[{ label: "BODIES READ", value: bodiesRead.kind === "HELD" ? formatEastern(bodiesRead.asOf) : "not read", warn: bodiesRead.kind !== "HELD" }]}>
      {bodiesRead.kind === "UNREAD" ? (
        <Refusal title="The bodies could not be read just now.">{bodiesRead.detail}</Refusal>
      ) : (
        <div className={s.gridAuto320} style={{ marginBottom: 32 }}>
          <div className={s.card}>
            <h2 className={s.h2Card}>What is working</h2>
            <FigList lines={working} />
            <p className={s.footnote}>
              Three different windows: the first line is each body&rsquo;s own last read, the second is the last 24 hours, the third is how things stand right now.
              They are not one number and are never added together.{revisionsNote}
            </p>
          </div>
          <div className={s.card}>
            <h2 className={s.h2Card}>What isn&rsquo;t</h2>
            <FigList lines={isnt} />
            <p className={s.footnote}>
              Could not get into is not the same as nothing wrong. Where a body could not be read, the figures above are floors — the real number can only be higher.
            </p>
          </div>
          <div className={s.card}>
            <h2 className={s.h2Card}>Where to put effort</h2>
            <FigList
              lines={[
                { key: "decisions", fig: String(decisionCount), tone: "gold", text: "decisions only you can make, each one listed below" },
                { key: "minutes", fig: null, unknown: "NOT ESTIMATED", text: "minutes of your time — no card records how long it takes" },
                { key: "optional", fig: String(optionalCount), tone: "muted", text: "optional items, counted apart so they never inflate the number needing you" },
              ]}
            />
            <p className={s.footnote}>
              Every figure here is counted from the list below, so this card cannot claim a decision the list does not offer.
              {wallCount > 0 ? ` ${wallCount} more ${wallCount === 1 ? "card waits" : "cards wait"} on a check the machine reruns, not on you; they close on their own.` : ""}
              {base.scope.kind !== "all" ? " Decisions are not tied to a place, so this list is the same in every scope." : ""}
            </p>
          </div>
        </div>
      )}

      <Section
        title="Suggested next steps"
        lede="Ranked by kind, then priority, then how long each has waited — nothing records what each one unblocks or how long it takes you, so neither is used. Anything the system can settle itself never appears here."
      />
      {snapshotOut.kind !== "HELD" ? (
        <p className={s.note} style={{ marginBottom: 36 }}>
          {snapshotOut.detail} The decisions waiting on you are unknown until it is read — not zero.
        </p>
      ) : decisionsOut.kind !== "HELD" ? (
        <p className={s.note} style={{ marginBottom: 36 }}>
          {decisionsOut.detail} Without the decision log, a card you already answered would be offered again, so none is shown.
        </p>
      ) : steps.length === 0 ? (
        <p className={s.note} style={{ marginBottom: 36 }}>
          Nothing is waiting on you: every published card has a recorded decision.
        </p>
      ) : (
        <NextSteps cards={steps} renderedRevision={pulse.revision} actionRoute={ACTION_ROUTE} liveRoute={LIVE_ROUTE} returnTo={base.here} firstShown={6} />
      )}

      {decided.length > 0 && (
        <>
          <Section
            title="What you decided"
            lede={`Newest first${decided.length > DECIDED_SHOWN ? `, the latest ${DECIDED_SHOWN} of ${decided.length}` : ""}. Each one is recorded at once; ${SYNC_CADENCE}, and each line below says how far it has got.`}
          />
          <div className={s.stack10} style={{ marginBottom: 36 }}>
            {decided.slice(0, DECIDED_SHOWN).map((entry) => (
              <details key={entry.decision.intentId} className={`${s.card} ${s.cardSlim}`}>
                <summary className={s.row10} style={{ cursor: "pointer" }}>
                  <Pill tone={receiptHeadline(entry.steps).includes("refused") ? "amber" : receiptHeadline(entry.steps).includes("work opened") ? "teal" : "cyan"}>
                    {receiptHeadline(entry.steps).toUpperCase()}
                  </Pill>
                  <span className={`${s.text14} ${s.grow}`}>{entry.card ? entry.card.title : entry.decision.subjectId}</span>
                  <span className={s.note}>{formatEastern(entry.decision.decidedAt)}</span>
                </summary>
                <div className={s.stack6} style={{ marginTop: 10 }}>
                  {entry.steps.map((step) => (
                    <p key={step.key} className={s.text14}>
                      <span className={s.strong}>{step.label}: </span>
                      {step.says}
                    </p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      <Section
        title="Every body we watch"
        lede={
          bodiesRead.kind === "HELD" ? (
            <>
              {bodies.length} {bodies.length === 1 ? "body" : "bodies"}
              {base.scope.kind === "all" ? "" : ` in ${base.shell.label}`}. Each shows where it stands on the six things we are always trying to find out, as of its own
              last read. Open one to see everything happening to it.{scopeNote ? ` ${scopeNote}` : ""}
            </>
          ) : (
            "The bodies could not be read, so none is listed — that is not an empty list."
          )
        }
      />
      {bodiesRead.kind === "HELD" &&
        (bodies.length === 0 ? (
          <div className={s.dashedCard}>
            <div className={s.row}>
              <Dash large>NONE REGISTERED HERE</Dash>
              <span className={s.note}>No body with a registered meeting source sits in this scope. That is a fact about what is registered, not about what governs here.</span>
            </div>
          </div>
        ) : (
          <BodyList bodies={bodies} stateNames={stateNames} workHref={workHref} firstShown={12} initiallyOpen={typeof sp.body === "string" ? sp.body : null} />
        ))}

      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}
