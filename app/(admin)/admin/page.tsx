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
 *   the scope        everywhere, a state, or a selected geography; a scope in a
 *                    state not tracked with figures answers in sentences that
 *                    say whether its registration is promoted
 * ```
 *
 * The page audits itself before it shows anything: every figure carries a
 * denominator and a stated meaning, and every stated count equals the rows
 * drawn. A failed audit replaces the numbers with the reason.
 */
import { readDecisionCards, readDecisions } from "@/lib/control-plane/admin-data.ts";
import Link from "next/link";
import type { OwnerSnapshot } from "@/lib/control-plane/owner-surface.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import { rankedWorkBlockers } from "@/lib/control-plane/admin-view/work-view.ts";
import { CHECKLIST_PROFILE } from "@/lib/control-plane/readiness/checklist-score.ts";
import { servedWitness } from "@/lib/control-plane/served-reader.ts";
import type { ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
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
import { censusUniverseWords } from "@/lib/control-plane/admin-view/census-universe.ts";
import { routineAssignmentId } from "@/lib/control-plane/assignment-routine.ts";

import { BodyList } from "../_mw/body-list.tsx";
import { AuditFooter, EmptyScope, NotAsked } from "../_mw/blocks.tsx";
import { censusEntryOf } from "../_mw/data/census-universe.ts";
import { divisionsOf, loadContainer, loadZcta } from "../_mw/data/geography.ts";
import { loadWatchedBodies } from "../_mw/data/load-bodies.ts";
import { isTrackedState, stateName } from "../_mw/load-shell.ts";
import { NextSteps, type StepCard } from "../_mw/next-steps.tsx";
import { openPage, type SearchParams } from "../_mw/page-base.ts";
import { parseScope, withScope, type MwScope } from "../_mw/scope.ts";
import { MwShell } from "../_mw/shell.tsx";
import { Dash, FigList, Pill, Refusal, Section, mw as s, type FigLine } from "../_mw/ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const ACTION_ROUTE = "/api/admin/action";
const LIVE_ROUTE = "/api/admin/live";
const PRIORITY_ORDER: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const FIRST_BODIES_SHOWN = 12;

type HuntOverviewFields = Pick<OwnerSnapshot, "publishedAt" | "assignments" | "billingAttribution" | "checklists" | "servedReaderReadback">;

/** Only the existing publisher's saved facts; no body/state inference or full snapshot read. */
async function readHuntOverview(repos: ControlPlaneRepositories): Promise<{ value: HuntOverviewFields | null; gap: string | null }> {
  try {
    const row = await repos.ownerSnapshots.readNarrowed("current", {
      publishedAt: true, assignments: true, billingAttribution: true, checklists: true, servedReaderReadback: true,
    });
    return row ? { value: row.value as HuntOverviewFields, gap: null } : { value: null, gap: "No hunt overview has been published yet." };
  } catch {
    return { value: null, gap: "The saved hunt overview could not be read. Its counts and costs are unknown." };
  }
}

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

function SavedHuntOverview({ decision, scope, now, read }: {
  decision: ExpansionScopeDecision; scope: MwScope; now: string;
  read: { value: HuntOverviewFields | null; gap: string | null };
}) {
  const fields = read.value;
  const view = fields?.assignments?.kind === "BUILT" ? fields.assignments.view : null;
  const index = view?.allRowsIndex ?? null;
  const members = index?.filter(row => row.assignmentKeys.includes(decision.key)) ?? null;
  const counts = view?.instructionCounts?.[decision.key] ?? null;
  const stateCount = (state: string) => counts?.[state as keyof typeof counts] ?? members?.filter(row => row.state === state).length ?? null;
  const total = counts ? Object.values(counts).reduce((n, value) => n + value, 0) : members?.length ?? null;
  const active = stateCount("WORKING"), waiting = stateCount("WAITING");
  const blocked = counts ? (counts.BLOCKED ?? 0) + (counts.FAILED ?? 0) + (counts.UNKNOWN ?? 0)
    : members?.filter(row => ["BLOCKED", "FAILED", "UNKNOWN"].includes(row.state)).length ?? null;
  const blockers = rankedWorkBlockers(members ?? [], now).slice(0, 5);
  const cost = decision.budgetStartedAt ? fields?.billingAttribution?.hunts?.find(row =>
    row.key === decision.key && row.startedAt === decision.budgetStartedAt) ?? null : null;
  const census = fields?.checklists?.find(row => row.scopeId === decision.key && row.instructionReceipt === decision.receiptId) ?? null;
  const instantiated = new Set(census?.instances.flatMap(row => row.definitionIds) ?? []);
  const missingDefinitions = census ? CHECKLIST_PROFILE.definitions.length - instantiated.size : null;
  const attempts = view?.bodyAttempts?.filter(row => row.assignmentKeys.includes(decision.key)) ?? null;
  const visible = attempts?.flatMap(attempt => {
    if (attempt.status === "HELD" || !attempt.versionId) return [];
    const witness = servedWitness(fields?.servedReaderReadback ?? null, attempt.workItemId, attempt.workerResultId, now);
    return witness?.versionId === attempt.versionId && witness.readerKey === attempt.bodyId ? [{ attempt, witness }] : [];
  }).sort((a, b) => b.attempt.at.localeCompare(a.attempt.at)).slice(0, 3) ?? null;
  const workHref = withScope("/admin/work", scope, { instruction: decision.key });
  const moneyHref = withScope("/admin/money", scope);
  const doneHref = withScope("/readiness/done", scope);
  const figure = (n: number | null) => n === null ? "Not measured" : n.toLocaleString("en-US");
  const dollars = (n: number | null) => n === null ? "not measured" : `$${n.toFixed(2)}`;
  const categoryWords: Record<string,string> = {NEEDS_OWNER_DECISION:"Needs your decision",AUTOMATIC_REPAIR:"Automatic repair",WAITING_ON_PUBLISHER:"Waiting on the publisher",NEEDS_CODE_CHANGE:"Needs a code change",OWNER_UNCLEAR:"Next owner unclear"};
  const ownerWords: Record<string,string> = {OWNER:"you",SOURCE:"publisher",ENGINEERING:"engineering",AUTOMATION:"the system",NOBODY:"not assigned"};
  return <>
    <Section title={`Your saved hunt · ${decision.geography.label}`}
      lede={`Started ${formatEastern(decision.budgetStartedAt ?? decision.decidedAt, { year: true })}. Last overview ${fields ? formatEastern(fields.publishedAt, { year: true }) : "not read"}. This is tracked progress toward your saved instruction; the checklist and public results require separate proof.`} />
    <details className={s.note} style={{ marginBottom: 16 }}><summary>How this overview is connected</summary><p>Instruction key {decision.key}; original receipt {decision.receiptId}. Cost uses the saved budget start; checklist uses the exact receipt. Work and public attempts use the recorded assignment key because the compact index does not separately carry a receipt for a future new hunt at the same key.</p></details>
    {read.gap && <p className={s.goldNote}>{read.gap}</p>}
    <div className={s.gridAuto220} style={{ marginBottom: 20 }}>
      <div className={s.insetTile}><span className={s.titleStrong14}>Work linked to this instruction key</span><p className={s.fig}>{figure(total)}</p><p className={s.note}>{figure(active)} working · {figure(waiting)} waiting · {figure(blocked)} blocked, failed or unknown. These are tracked assignments, not complete coverage or proof of a unique receipt.</p></div>
      <div className={s.insetTile}><span className={s.titleStrong14}>Money since this hunt started</span><p className={s.fig}>{cost ? dollars(cost.anthropicKnownUsd) : "Not measured"}</p><p className={s.note}>Known Anthropic spend of the {dollars(decision.budgetUsd)} saved allowance. {cost ? `${dollars(cost.reservedUsd)} reserved · ${dollars(cost.availableUsd)} available · ${dollars(cost.otherKnownUsd)} other known · ${dollars(cost.knownCombinedUsd)} combined known · ${cost.unpriced} unpriced request${cost.unpriced === 1 ? "" : "s"}.` : "No exact started-hunt billing attribution is published; zero is not implied."}</p></div>
      <div className={s.insetTile}><span className={s.titleStrong14}>Full checklist</span><p className={s.fig}>{census ? `${census.instances.length} represented items` : "Not measured"}</p><p className={s.note}>{census ? `${missingDefinitions} of ${CHECKLIST_PROFILE.definitions.length} original definitions are not represented in this census; ${census.inventory.unresolvedObjects} source inventories unresolved. Representation earns no passing credit. ${census.gaps.length > 0 ? census.gaps[0] : "No gap summary is recorded; this does not establish completeness."}` : "No census matches this exact instruction and receipt. Missing requirements are unknown, not passed."}</p></div>
    </div>
    <div className={s.row10} style={{ marginBottom: 20 }}><Link className={s.btnLink} href={workHref}>Open all linked work</Link><Link className={s.btnLink} href={moneyHref}>See money</Link><Link className={s.btnLink} href={doneHref}>See checklist and delivery</Link></div>
    <div className={s.card} style={{ marginBottom: 24 }}><h3 className={s.h3}>Next blockers on this instruction</h3>
      {members === null ? <p className={s.note}>The full assignment index is not published; ranked blockers cannot be measured.</p>
        : blockers.length === 0 ? <p className={s.note}>No blocker is classified among the linked tracked assignments. This does not establish complete source coverage.</p>
          : <div className={s.stack8}>{blockers.map(({row,ageDays,category,rankingWhy}) => <div key={row.id} className={s.insetRow}>
            <Link className={s.btnLink} href={withScope("/admin/work", scope, { instruction: decision.key, open: row.id })}>{row.label}</Link>
            <span className={s.note}>{categoryWords[category]} · {ageDays === null ? "waiting age unknown" : `${ageDays} days waiting`} · next owner: {row.owner in ownerWords ? ownerWords[row.owner] : "Owner is not recorded"} · last attempt: {row.lastAttemptAt ? formatEastern(row.lastAttemptAt) : "not recorded"}</span>
            <span className={s.text14}>{row.blocker ?? "Overdue"}. Next: {row.nextAction}</span>
            <span className={s.note}>Why it is high on the list: {rankingWhy.replace(" Downstream work unlocked is not measured.", "")}{row.readyAfterThisSettlesCount === null || row.readyAfterThisSettlesCount === undefined ? " · Work this would unlock is not measured." : ` · ${row.readyAfterThisSettlesCount} directly dependent item${row.readyAfterThisSettlesCount === 1 ? "" : "s"} would be ready once this settles.`}</span>
          </div>)}</div>}
    </div>
    <div className={s.card} style={{ marginBottom: 30 }}><h3 className={s.h3}>Latest confirmed public results</h3>
      {visible === null ? <p className={s.note}>The publisher-attempt projection is unavailable; public results cannot be attributed here.</p>
        : visible.length === 0 ? <p className={s.note}>No linked publisher attempt has a current matching public readback. This does not mean no source work happened.</p>
          : <div className={s.stack8}>{visible.map(({attempt,witness}) => <div key={`${attempt.workItemId}:${attempt.workerResultId}`} className={s.insetRow}>
            <a className={s.btnLink} href={witness.url}>Open published result</a><span className={s.note}>{attempt.status === "PARTIALLY_PUBLISHED" ? "Partial publication · " : ""}{attempt.acceptedCount === null ? "accepted count unrecorded" : `${attempt.acceptedCount} accepted`} · reader confirmed {formatEastern(witness.checkedAt)}</span><details className={s.note}><summary>Result reference</summary>{attempt.bodyId} · version {witness.versionId}</details>
          </div>)}</div>}
      <p className={s.note}>This overview does not classify accepted results as new, updated or reused; those labels require their own publication receipts.</p>
    </div>
  </>;
}

export default async function FleetNowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The body read is the longest one a first open waits for (all of it database work), so it starts before the policy row is read.
  const nowIso = new Date().toISOString();
  const asked = parseScope(sp.scope);
  const bodiesEarly = asked.kind === "all" || isTrackedState(asked.state) ? loadWatchedBodies(nowIso) : null;
  const base = await openPage("/admin", sp, nowIso);
  const shellProps = {
    area: "fleet" as const,
    tab: "now" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: base.standard,
  };

  if (!base.shell.tracked && base.shell.decision === null) {
    const name = base.scope.kind === "all" ? "Everywhere" : stateName(base.scope.state);
    return (
      <MwShell {...shellProps}>
        <EmptyScope
          name={name}
          scope={base.scope}
          standing={base.shell.standing}
          census={base.scope.kind === "all" ? undefined : censusUniverseWords(name, censusEntryOf(base.scope.state))}
        />
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
  const selectedHunt = base.scope.kind === "geo" ? base.shell.decision : null;
  const container = base.scope.kind === "geo" ? base.scope.type === "zcta" ? loadZcta(base.scope.geoid) : loadContainer(base.scope.type, base.scope.geoid) : null;
  const [snapshotOut, decisionsOut, pulse, bodiesRead, containerRead, huntOverview] = await Promise.all([
    // The one field of the snapshot this page draws, narrowed by the store: 88 KB of the 449 KB row (2026-09-25).
    readDecisionCards(repos),
    readDecisions(repos),
    readPulse(repos, base.nowIso),
    bodiesEarly ?? loadWatchedBodies(base.nowIso),
    container,
    selectedHunt ? readHuntOverview(repos) : Promise.resolve({ value: null, gap: null }),
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
  /*
   * The body list is sent only the views it draws: the first few, or every one
   * when the list was asked for whole or a link names a body past the first
   * few. Each view sent travels in the page as data (689 KB for all 120 on
   * 2026-09-25, twelve of them drawn), so the rest come when "show all" asks.
   */
  const askedBody = typeof sp.body === "string" ? sp.body : null;
  const askedAll = sp.bodies === "all";
  const every = askedAll || (askedBody !== null && bodies.findIndex((b) => b.id === askedBody) >= FIRST_BODIES_SHOWN);
  const bodyList = { sent: every ? bodies : bodies.slice(0, FIRST_BODIES_SHOWN), every, asked: askedBody, askedAll };
  const workHref: Record<string, string> = {};
  for (const b of bodyList.sent) for (const id of b.contractIds) workHref[id] = withScope(`/admin/work?open=${encodeURIComponent(routineAssignmentId(id))}`, base.scope);

  return (
    <MwShell {...shellProps} extraStrip={[{ label: "BODIES READ", value: bodiesRead.kind === "HELD" ? formatEastern(bodiesRead.asOf) : "not read", warn: bodiesRead.kind !== "HELD" }]}>
      {selectedHunt && <SavedHuntOverview decision={selectedHunt} scope={base.scope} now={base.nowIso} read={huntOverview} />}
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
          // Keyed by what was sent, so the island starts over (showing every body) when "show all" brings the rest.
          <BodyList
            key={bodyList.every ? "every" : "first"}
            bodies={bodyList.sent}
            total={bodies.length}
            stateNames={stateNames}
            workHref={workHref}
            firstShown={FIRST_BODIES_SHOWN}
            initiallyOpen={bodyList.asked}
            initiallyAll={bodyList.askedAll}
            showAllHref={withScope("/admin", base.scope, { bodies: "all", body: bodyList.asked })}
          />
        ))}

      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}
