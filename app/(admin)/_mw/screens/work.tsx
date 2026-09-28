import "server-only";

/**
 * **WORK — the composer and the one list of assignments.** (Admin redesign,
 * 2026-09-23; Fleet · Work and Readiness · Work and instructions render this
 * same screen — one queue, one set of references, no second copy.)
 *
 * ```
 *   Ask for something new   the composer (client): geography, words, priority,
 *                           budget → `expansion.scope.set`
 *   Assignments             your instructions (selected geographies, with the
 *                           runner's acknowledgement), then the standing work
 *                           the system owes (published assignment view) and the
 *                           routine meeting reads — each opens in place
 * ```
 *
 * An opened assignment is read live by id: an instruction from the policy row
 * and the runner's reading, a routine read from the body store, anything else
 * from the control plane's records for that id alone.
 */
import Link from "next/link";
import { EvidenceCaptureControl } from "../evidence-capture-control.tsx";
import type { ReactNode } from "react";
import { PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";

import { readFleetSafety, readHeartbeat, readLatestDigest, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { readAssignmentSourcesById } from "@/lib/control-plane/assignment-read.ts";
import { routineContractIdOf } from "@/lib/control-plane/assignment-routine.ts";
import { askGapCountWords, askGapRenderedNumbers, buildAssignments, type AssignmentListRow, type AssignmentState, type AssignmentView, type BodyPublicationAttempt } from "@/lib/control-plane/assignment-view.ts";
import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import {
  instructionKey,
  instructionView,
  routineCard,
  routineDetail,
  rankedWorkBlockers,
  standingCard,
  standingDetail,
  STATE_PILL,
  type AssignmentDetailView,
  type CardView,
  type InstructionView,
} from "@/lib/control-plane/admin-view/work-view.ts";
import type { GeographyType } from "@/lib/census-geography/contract.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { currentScoutsForHunt, huntActivity } from "@/lib/control-plane/admin-view/hunt-activity.ts";
import { exactInstructionMembership } from "@/lib/control-plane/admin-view/instruction-membership.ts";
import { huntOverview } from "@/lib/control-plane/admin-view/hunt-overview.ts";
import { isExpansionCycleReading } from "@/lib/control-plane/expansion/reading.ts";
import { isAssignmentCycleReading } from "@/lib/control-plane/expansion/assignment-budget.ts";
import { dispatchWorkReadingOf } from "@/lib/control-plane/expansion/view.ts";
import { resolveRollingCeiling } from "@/lib/control-plane/fleet-safety.ts";
import { fleetSpendCeilingOverrideUsd } from "@/lib/control-plane/gateway/admin-config.ts";
import { censusUniverseWords } from "@/lib/control-plane/admin-view/census-universe.ts";
import { standingLabel } from "@/lib/control-plane/admin-view/registration-standing.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { PILOT_ZIPS } from "@/lib/health/owner-corpus-compile.ts";
import { readResearchIntents } from "@/lib/control-plane/research-view.ts";
import { runnerStanding } from "@/lib/control-plane/runner-standing.ts";
import { WORK_QUESTION_WORDS } from "@/lib/control-plane/work-question.ts";
import { pulseLanesOf, queueLanesOf } from "@/lib/control-plane/scheduler/lane-reading.ts";
import { ORIGINAL_LIFETIME_HUNT } from "@/lib/control-plane/scheduler/hunt-continuation.ts";
import { plainText } from "@/lib/control-plane/plain-words.ts";
import { assignmentEvidenceTrail, type AssignmentEvidenceTrail } from "@/lib/control-plane/admin-view/assignment-evidence-trail.ts";
import type { BillingAttribution } from "@/lib/control-plane/provider-billing-attribution.ts";
import type { ArtifactRecord } from "@/lib/control-plane/repository/types.ts";
import { ADMIN_EVIDENCE_MAX_BYTES, adminMirrorableContentType } from "@/lib/control-plane/evidence/admin-bridge.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../blocks.tsx";
import { Composer, type GeoOption } from "../composer.tsx";
import { censusEntryOf } from "../data/census-universe.ts";
import { listContainers } from "../data/geography.ts";
import { loadWatchedBodies, loadWatchedBody } from "../data/load-bodies.ts";
import { paidLaneOf } from "../data/research-lane.ts";
import { TRACKED_STATE_CODES, stateName, statesByStanding } from "../load-shell.ts";
import { DeliveryTrailCard } from "../delivery-trail.tsx";
import { loadLivePipeline } from "../data/live-pipeline.ts";
import { loadHuntSourceProgress, type HuntSourceProgressRead } from "../data/hunt-source-progress.ts";
import { buildDeliveryTrail } from "@/lib/control-plane/delivery-trail.ts";
import { readActivationGate } from "@/lib/control-plane/promotion/activation-gate.ts";
import { LaneStrip } from "../lane-strip.tsx";
import { RunnerCard } from "../runner-card.tsx";
import { WorkOverview } from "../work-overview.tsx";
import { openPage, param, type SearchParams } from "../page-base.ts";
import { scopeParam, withScope, type MwArea } from "../scope.ts";
import { MwShell } from "../shell.tsx";
import { Cells, DeadEnd, KV, Pill, Refusal, Section, mw as s } from "../ui.tsx";

const ACTION_ROUTE = "/api/admin/action";
const PREVIEW_ROUTE = "/api/admin/geography-preview";
const TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];
const SHORT_TO_TYPE: Readonly<Record<string, GeographyType>> = {
  county: "county",
  cd: "congressional_district",
  cbsa: "cbsa",
  sldu: "state_leg_upper",
  sldl: "state_leg_lower",
};
const GROUP_ORDER: readonly AssignmentState[] = ["BLOCKED", "FAILED", "WORKING", "WAITING", "UNKNOWN", "SUCCEEDED", "RETIRED"];
const FIRST_PER_GROUP = 4;

type Opened =
  | { readonly kind: "NONE" }
  | { readonly kind: "INSTRUCTION"; readonly view: InstructionView }
  | { readonly kind: "DETAIL"; readonly id: string; readonly detail: AssignmentDetailView;
      readonly trail: AssignmentEvidenceTrail | null; readonly artifacts: readonly ArtifactRecord[]; readonly says: string }
  | { readonly kind: "MISSING"; readonly id: string; readonly says: string };

/** Download controls may show only captures already joined to this opened
 * assignment's exact completed Attempt in its source-to-result trail. */
function assignmentSavedArtifacts(trail: AssignmentEvidenceTrail, records: readonly ArtifactRecord[]): readonly ArtifactRecord[] {
  const keys = new Set(trail.events.filter(event => event.id.startsWith("saved:")).map(event => {
    const refs = new Map(event.references);
    return `${refs.get("Work item")}:${refs.get("Original attempt")}:${refs.get("Saved document")}`;
  }));
  return records.filter(record => keys.has(`${record.workItemId}:${record.attemptId}:${record.artifactId}`));
}

export async function WorkScreen(props: { readonly area: MwArea; readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const path = props.area === "fleet" ? "/admin/work" : "/readiness/work";
  // The body read is the longest one a first open waits for (all of it database work), so it starts before the policy row is read.
  const nowIso = new Date().toISOString();
  const bodiesEarly = loadWatchedBodies(nowIso);
  const base = await openPage(path, sp, nowIso);
  const shellProps = {
    area: props.area,
    tab: "work" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: base.standard,
  };
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  /* ------------------------------------------------------------ what the composer offers */
  const composerState = (param(sp, "st") ?? (base.scope.kind === "all" ? TRACKED_STATE_CODES[0] ?? US_STATES[0].code : base.scope.state)).toLowerCase();
  const geoParam = param(sp, "geo");
  const initialGeo = (() => {
    if (!geoParam) {
      if (base.scope.kind === "geo") return { type: base.scope.type as string, geoid: base.scope.geoid };
      return null;
    }
    const [short, geoid] = geoParam.split(":");
    const type = SHORT_TO_TYPE[short ?? ""];
    return type && geoid ? { type: type as string, geoid } : null;
  })();
  const openId = param(sp, "open");
  const show = param(sp, "show");
  const instructionFilter = param(sp, "instruction");
  const workQuery = (param(sp, "q") ?? "").trim().slice(0, 100);
  const requestedIndexPage = Number(param(sp, "page") ?? "1");
  const requestedTrailPage = Number(param(sp, "trailPage") ?? "1");
  const requestedEvidencePage = Number(param(sp, "evidencePage") ?? "1");
  const evidencePage = Number.isSafeInteger(requestedEvidencePage) && requestedEvidencePage > 0 ? requestedEvidencePage : 1;
  /*
   * An opened assignment is read beside the page's other reads, not after
   * them: it needs nothing they return. A piece of standing work is read by its
   * id, and the published activation reading is joined to it once both are in
   * (measured 2026-09-25: the drilldown behind prop-423 is 76 point reads, and
   * waiting for the rest of the page first put it on top of the body read). A
   * routine read is its own body read whole, trail included. An instruction's
   * id starts "scope:" and reads nothing more.
   */
  const openedContract = openId === null ? null : routineContractIdOf(openId);
  const standingId = openId !== null && !openId.startsWith("scope:") && openedContract === null ? openId : null;
  const sourceInstruction = base.selected.find(decision => instructionKey(decision) === openId && decision.sourceWorkVersion === 1);

  const [containers, snapshotOut, researchOut, heartbeatOut, bodiesRead, intentsOut, digestOut, standingRead, routineRead, livePipeline, sharedSources] = await Promise.all([
    listContainers(composerState.toUpperCase(), TYPES),
    readSnapshot(base.repos),
    readFleetSafety(base.repos),
    readHeartbeat(base.repos),
    bodiesEarly,
    readResearchIntents(base.repos),
    // The runner card shows the newest digest alone: one row, not the twenty-row history (4.4 MB on 2026-09-25).
    props.area === "fleet" ? readLatestDigest(base.repos) : Promise.resolve(null),
    standingId === null ? Promise.resolve(null) : readAssignmentSourcesById(base.repos, standingId, { nowIso: base.nowIso, activation: null, pilotZips: PILOT_ZIPS }),
    // An opened routine read draws its body's delivery trail, which the list's body read leaves out: that one body is read whole, now.
    openedContract === null ? Promise.resolve(null) : loadWatchedBody(base.nowIso, openedContract),
    loadLivePipeline(),
    sourceInstruction ? loadHuntSourceProgress(sourceInstruction.receiptId) : Promise.resolve(null),
  ]);

  const geographies: Record<string, GeoOption[]> = {};
  if (containers.kind === "HELD") {
    for (const type of TYPES) {
      geographies[type] = (containers.value[type] ?? []).map((g) => ({ type: g.type, geoid: g.geoid, version: g.version, label: g.label, stateAbbr: g.stateAbbr }));
    }
  }
  const ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(base.adminConfig));
  const research = researchOut.kind === "HELD" ? researchOut.value : null;
  const lane = paidLaneOf(research);
  const expansionRaw: unknown = research ? (research as { expansion?: unknown }).expansion : null;
  const reading = isExpansionCycleReading(expansionRaw) ? expansionRaw : null;
  /* MW-001/MW-021: each instruction as the runner read it from the work itself, with its own budget. */
  const assignmentsRaw: unknown = research ? (research as { assignments?: unknown }).assignments : null;
  const sends = isAssignmentCycleReading(assignmentsRaw) ? assignmentsRaw : null;
  const pause = heartbeatOut.kind === "HELD" ? (heartbeatOut.value as { pause?: { since?: string | null } | null }).pause ?? null : null;

  const published = snapshotOut.kind === "HELD" ? snapshotOut.value.assignments ?? null : null;
  const view: AssignmentView | null = published && published.kind === "BUILT" ? published.view : null;
  const scopeState = base.scope.kind === "all" ? null : base.scope.state;
  const allRows: readonly AssignmentListRow[] = view?.rows ?? [];
  const filteredDecision = instructionFilter === null ? null : base.selected.find(decision => decision.key === instructionFilter) ?? null;
  const filteredExact = filteredDecision === null ? null : exactInstructionMembership(view,filteredDecision.key,filteredDecision.receiptId);
  // An instruction may reach shared country/state work. Its exact marks take
  // precedence over the sidebar's state; no inferred county/ZIP/name join.
  const rows = instructionFilter !== null ? filteredExact?.rows ?? [] : scopeState === null ? allRows : allRows.filter(row => row.stateCode === scopeState);
  const fullIndex = view?.allRowsIndex ?? null;
  const scopedIndex = instructionFilter !== null ? filteredExact?.index ?? null : fullIndex?.filter(row => scopeState === null || row.stateCode === scopeState) ?? null;
  const searchedIndex = scopedIndex?.filter(row => !workQuery || `${row.id} ${row.label} ${row.subjectName ?? ""} ${row.state} ${row.blocker ?? ""} ${row.nextAction} ${(row.historyTerms ?? []).join(" ")}`.toLowerCase().includes(workQuery.toLowerCase())) ?? null;
  const indexPageSize = 50;
  const indexPages = Math.max(1, Math.ceil((searchedIndex?.length ?? 0) / indexPageSize));
  const indexPage = Number.isSafeInteger(requestedIndexPage) ? Math.max(1, Math.min(requestedIndexPage, indexPages)) : 1;
  const shownIndex = searchedIndex?.slice((indexPage - 1) * indexPageSize, indexPage * indexPageSize) ?? [];
  const priorities = rankedWorkBlockers(scopedIndex ?? [], base.nowIso).slice(0, 5);
  const geographicCounts = instructionFilter !== null ? filteredExact?.counts ?? null : scopeState === null ? null : view?.geographicCounts?.[scopeState] ?? null;
  const countsUnavailable = instructionFilter !== null ? filteredExact?.counts === null || filteredExact === null : view?.geographicCounts === undefined;
  const scopedTotal = instructionFilter === null && scopeState === null ? view?.summary.total ?? null : countsUnavailable ? null : Object.values(geographicCounts ?? {}).reduce((n, count) => n + count, 0);
  const publishedTrail = snapshotOut.kind === "HELD" ? snapshotOut.value.deliveryTrail ?? null : null;
  const deliveryTrail = livePipeline.ok && publishedTrail ? buildDeliveryTrail(livePipeline.states, {
    activation: view?.activation ?? readActivationGate(""),
    servedReader: snapshotOut.kind === "HELD" ? snapshotOut.value.servedReaderReadback ?? null : null,
    now: base.nowIso, costSummary: publishedTrail.costs, costPerVerifiedRecord: publishedTrail.costs.costPerVerifiedRecord,
  }) : publishedTrail;
  // The opened routine read's body is drawn from its own fresh read, so its card and its detail say the same thing.
  const bodies: readonly BodyView[] =
    bodiesRead.kind === "HELD" ? bodiesRead.views.map((v) => (routineRead?.kind === "HELD" && v.id === routineRead.view.id ? routineRead.view : v)) : [];
  const inScopeBodies = scopeState === null ? bodies : bodies.filter((b) => b.stateCode === scopeState);

  /* ------------------------------------------------------------ your instructions */
  const instructions = base.selected.map((decision) => {
    const exact=exactInstructionMembership(view,decision.key,decision.receiptId);
    const sharedPriorReceipt=view?.allRowsIndex?.some(row=>row.assignmentRefs?.some(mark=>mark.key===decision.key&&mark.ref!==decision.receiptId))??false;
    return instructionView({
      decision,
      reading,
      rows: exact.index===null || exact.counts===null ? null : exact.rows,
      totalAssignments: exact.counts===null ? null : Object.values(exact.counts).reduce((count,n)=>count+n,0),
      paidLaneClosedBecause: lane.open ? null : lane.closedBecause,
      runnerPaused: pause ? { since: pause.since ?? null } : null,
      activeCycleStartedAt: research?.cycleFinishedAt === null ? research.cycleStartedAt : null,
      nextCycleDueAt: heartbeatOut.kind === "HELD" ? heartbeatOut.value.nextCycleDueAt : null,
      currentScouts: research === null || exact.index===null || exact.counts===null || sharedPriorReceipt
        ? null : currentScoutsForHunt(research.running, decision.key),
      assignment: sends?.assignments.find((a) => a.key === decision.key && a.ref === decision.receiptId) ?? null,
      assignmentAt: sends?.at ?? null,
      dispatchWork: dispatchWorkReadingOf(research ? (research as { dispatchWork?: unknown }).dispatchWork : null),
    });
  });

  /* ------------------------------------------------------------ the opened assignment */
  let opened: Opened = { kind: "NONE" };
  if (openId !== null) {
    const instruction = instructions.find((i) => i.card.id === openId);
    const contractId = routineContractIdOf(openId);
    if (instruction) opened = { kind: "INSTRUCTION", view: instruction };
    else if (openId.startsWith("scope:")) opened = { kind: "MISSING", id: openId, says: "This geography is not on your list any more, or its change has not been read yet." };
    else if (contractId !== null && routineRead !== null) {
      opened =
        routineRead.kind === "HELD"
          ? { kind: "DETAIL", id: openId, detail: routineDetail(routineRead.view), trail: null, artifacts: [], says: `read from the production data plane at ${formatEastern(routineRead.asOf)}` }
          : { kind: "MISSING", id: openId, says: routineRead.detail };
    } else if (standingRead !== null) {
      const read = standingRead;
      if (read.kind === "HELD") {
        // The drilldown was read beside the snapshot, so the activation reading it is projected with is joined here.
        const attributed = view && view.summary.costs.attributed.held ? view.summary.costs.attributed.value.value : null;
        const sources = { ...read.value, activation: view?.activation ?? null, servedReader: snapshotOut.kind === "HELD" ? snapshotOut.value.servedReaderReadback ?? null : null };
        const row = buildAssignments(sources, { costDenominatorUsd: attributed }).find((r) => r.id === openId) ?? null;
          if (row) {
            const trail = assignmentEvidenceTrail(sources, openId, row.waiting.nextAction);
            opened = { kind: "DETAIL", id: openId, detail: standingDetail(row, { scouts: read.value.scoutResults }),
              trail, artifacts: assignmentSavedArtifacts(trail, read.value.artifacts),
              says: `read live from the control plane at ${formatEastern(base.nowIso)}` };
          } else opened = { kind: "MISSING", id: openId, says: `The records for ${openId} were read and no assignment with that id is among them.` };
      } else opened = { kind: "MISSING", id: openId, says: read.detail };
    }
  }

  /* ------------------------------------------------------------ the list */
  const groups = GROUP_ORDER.map((state) => {
    const listed = rows.filter((r) => r.state === state);
    const total = scopeState === null && instructionFilter === null ? view?.summary.byState.find((x) => x.state === state)?.count.value ?? listed.length : geographicCounts?.[state] ?? listed.length;
    return { state, listed, total };
  }).filter((g) => g.total > 0 || g.listed.length > 0);
  const unfinishedWork = groups.filter(group => !["SUCCEEDED", "RETIRED"].includes(group.state))
    .reduce((count, group) => count + group.total, 0);
  const routineGroups = (["STUCK", "NEEDS ATTENTION", "WORKING", "NOT READ YET"] as const).map((st) => ({ st, bodies: inScopeBodies.filter((b) => b.status === st) })).filter((g) => g.bodies.length > 0);
  /* Every card the lists below draw, so an opened row they do not draw is still drawn once. */
  const drawnIds = new Set<string>([
    ...(view === null ? [] : groups.filter((g) => show === null || show === g.state).flatMap((g) => (show === g.state ? g.listed : g.listed.slice(0, FIRST_PER_GROUP)).map((r) => r.id))),
    ...routineGroups.flatMap((g) => g.bodies.slice(0, show === `routine-${g.st}` ? g.bodies.length : FIRST_PER_GROUP).flatMap((b) => b.contractIds.map((cid) => `routine:${cid}`))),
  ]);

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [{ label: "your instructions", stated: base.selected.length, rendered: instructions.length }];
  if (view) {
    if (scopedTotal !== null) numbers.push({ label: "assignments listed", value: rows.length, denominator: scopedTotal, contract: "published rows carrying this exact instruction when filtered, otherwise rows attributed to the selected state or all held assignments" });
    numbers.push(...askGapRenderedNumbers(view));
    for (const g of groups) claims.push({ label: `listed ${g.state}`, stated: g.listed.length, rendered: g.listed.length });
  }
  const na = auditRenderedNumbers(numbers);
  const ca = checkStatedEqualsRendered(claims);

  const here = (extra: Record<string, string | null>) => withScope(path, base.scope, { st: param(sp, "st"), geo: geoParam, show, instruction: instructionFilter, q: workQuery || null, page: String(indexPage), ...extra });
  const overview = filteredDecision ? huntOverview({ decision: filteredDecision, assignments: view,
    billing: snapshotOut.kind === "HELD" ? snapshotOut.value.billingAttribution ?? null : null,
    reader: snapshotOut.kind === "HELD" ? snapshotOut.value.servedReaderReadback ?? null : null, now: base.nowIso }) : null;
  const overviewScope = filteredDecision ? { kind: "geo" as const, type: filteredDecision.geography.type,
    geoid: filteredDecision.geography.geoid, state: filteredDecision.geography.stateAbbr.toLowerCase() } : base.scope;
  /* Every state and territory can be chosen — the Census lookup behind the geographies covers them all — tracked ones first, then registered ones, each named for where it stands. */
  const stateHref: Record<string, string> = {};
  for (const { code } of US_STATES) stateHref[code] = withScope(path, base.scope, { st: code });
  const composerStates = statesByStanding(base.registration).map((st) => ({ code: st.code, name: standingLabel(st.name, st.standing) }));
  const selected: Record<string, { priority: number; budgetUsd: number; budgetStartedAt: string | null; originalLifetime: boolean }> = {};
  for (const d of base.selected) selected[`${d.geography.type}|${d.geography.geoid}`] = { priority: d.priority, budgetUsd: d.budgetUsd,
    budgetStartedAt: d.budgetStartedAt ?? null,
    originalLifetime: d.key === ORIGINAL_LIFETIME_HUNT.key && d.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
      d.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt && d.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd };

  const card = (c: CardView, detail: ReactNode | null) => {
    const isOpen = detail !== null;
    return (
      <div key={c.id} className={`${s.card} ${s.cardList}`} id={`a-${encodeURIComponent(c.id)}`}>
        <div className={s.row}>
          <Pill tone={c.tone}>{c.pill}</Pill>
          <h3 className={`${s.h3} ${s.grow}`}>{c.title}</h3>
          <span className={s.mono} title={c.id}>
            {c.id.length > 48 ? `${c.id.slice(0, 46)}…` : c.id}
          </span>
          <Link href={`${here({ open: isOpen ? null : c.id })}#a-${encodeURIComponent(c.id)}`} className={s.btnLink} scroll={false}>
            {isOpen ? "Close" : "Open"}
          </Link>
        </div>
        <p className={s.body}>{c.summary}</p>
        {detail}
      </div>
    );
  };

  return (
    <MwShell {...shellProps} extraStrip={[{ label: "LIST PUBLISHED", value: snapshotOut.kind === "HELD" ? formatEastern(snapshotOut.value.publishedAt) : "not read", warn: snapshotOut.kind !== "HELD" }]}>
      {base.scope.kind !== "all" && !base.shell.tracked ? (
        <EmptyScope
          name={stateName(base.scope.state)}
          scope={base.scope}
          standing={base.shell.standing}
          census={censusUniverseWords(stateName(base.scope.state), censusEntryOf(base.scope.state))}
        />
      ) : null}
      <Section title="Work and delivery" lede="Choose a saved instruction to see what readers received, what is missing, what is happening and where your action can help." />
      <nav aria-label="Saved hunt overview" className={s.row10}>
        {base.selected.map(decision => <Link key={decision.receiptId} className={s.btnLink}
          aria-current={filteredDecision?.receiptId === decision.receiptId ? "page" : undefined}
          href={withScope(path, { kind: "geo", type: decision.geography.type, geoid: decision.geography.geoid,
            state: decision.geography.stateAbbr.toLowerCase() }, { instruction: decision.key, open: instructionKey(decision) })}>
          {decision.geography.label}
        </Link>)}
        {instructionFilter && <Link href={withScope(path, base.scope)} className={s.btnLink}>Show standing work and history</Link>}
      </nav>
      {overview && <WorkOverview overview={overview}
        publishedAt={snapshotOut.kind === "HELD" ? snapshotOut.value.publishedAt : null}
        nextCycleAt={heartbeatOut.kind === "HELD" ? heartbeatOut.value.nextCycleDueAt : null}
        detailsHref={`${here({ open: instructionKey(overview.decision) })}#a-${encodeURIComponent(instructionKey(overview.decision))}`}
        checklistHref={withScope("/readiness/done", overviewScope)} moneyHref={withScope("/admin/money", overviewScope)}
        workHref={id => `${here({ open: id })}#a-${encodeURIComponent(id)}`} />}
      {!overview && <p className={s.note}>{instructionFilter ? "The selected instruction could not be matched to its saved receipt. No hunt totals are inferred." : "The standing work below follows the page’s scope. Select a saved instruction above for its exact hunt totals."}</p>}
      <details className={s.card} open={geoParam !== null}>
        <summary className={s.titleStrong16}>Add or change an instruction</summary>
        <Composer
        states={composerStates}
        stateCode={composerState}
        geographies={geographies}
        geographiesGap={containers.kind === "UNREAD" ? containers.detail : null}
        initial={initialGeo}
        ceilingUsd={ceiling.rollingCeilingUsd}
        paidLaneClosedBecause={lane.open ? null : lane.closedBecause}
        selected={selected}
        actionRoute={ACTION_ROUTE}
        previewRoute={PREVIEW_ROUTE}
        stateHref={stateHref}
        workHref={withScope(path, base.scope)}
      />
      </details>

      <Section
        id="assignments"
        title="Assignments"
        lede="One queue and one set of references across both areas. This list can order and bound work; it never creates a second copy of it. Open one to follow it from why it exists to whether a reader can see what it produced."
      />
      <Section title="Where attention helps" lede="Ranked from the selected work by urgency, reader impact, linked instructions and waiting age. Direct dependencies and items that could become ready after this work settles are shown where the graph was readable; they do not predict completed publication." />
      {scopedIndex === null ? <p className={s.goldNote}>The full receipt-linked work index has not been published for this instruction. This short list cannot be treated as all remaining work.</p> : priorities.length === 0
        ? <p className={s.note}>No blocked, failed, waiting or uncertain work with a recorded blocker or overdue state appears in this scope.</p>
        : <div className={s.stack10}>{priorities.map(priority => { const row = priority.row; return <div key={row.id} className={s.insetRow}>
          <div className={`${s.stack2} ${s.grow}`}>
            <span className={s.text14}><strong className={s.strong}>{priority.rank}. {row.label}</strong> · {row.state.toLowerCase()} · {priority.category === "NEEDS_OWNER_DECISION" ? "Needs your decision" : priority.category === "NEEDS_CODE_CHANGE" ? "Needs a code repair" : priority.category === "WAITING_ON_PUBLISHER" ? "Waiting on the publisher" : priority.category === "OWNER_UNCLEAR" ? "Next owner unclear" : "Assigned to automatic repair"}</span>
             <span className={s.note}>{row.blocker === null ? "This row has no recorded blocker reason." : plainText(row.blocker)} {plainText(row.nextAction)}</span>
             {(row.blocker && plainText(row.blocker) !== row.blocker || plainText(row.nextAction) !== row.nextAction) && <details className={s.note}><summary>Recorded reason and action</summary>{row.blocker ?? "No reason recorded"} · {row.nextAction}</details>}
            <span className={s.note}>Why this ranks here: {priority.rankingWhy}</span>
            <span className={s.monoSmall}>{row.waitingSince ? `Waiting since ${formatEastern(row.waitingSince)}` : "Waiting start not recorded"}{row.lastActivityAt ? ` · last activity ${formatEastern(row.lastActivityAt)}` : " · last activity not recorded"}{row.lastAttemptAt ? ` · last attempt started ${formatEastern(row.lastAttemptAt)}` : " · last attempt not recorded"}</span>
            <span className={s.note}>Direct dependent work items: {row.directDependentCount === undefined || row.directDependentCount === null ? "graph unread" : row.directDependentCount}. Could become ready if this work settles: {row.readyAfterThisSettlesCount === undefined || row.readyAfterThisSettlesCount === null ? "graph unread" : row.readyAfterThisSettlesCount}.</span>
          </div>
          <Link href={`${here({ open: row.id })}#a-${encodeURIComponent(row.id)}`} className={s.btnLink}>Open details</Link>
        </div>; })}</div>}
      <Section title="Find any work item" lede="This index covers tracked work in the selected scope, including items omitted from the short cards below. Search retained names, meetings, failures and next steps attached to that work, then open its full record." />
      <p className={s.note}>Published people and meetings have a separate full-history search; those records are not automatically attributed to this hunt.</p>
      <Link className={s.btnLink} href={withScope("/admin/records",base.scope,{
        q:workQuery||null,instruction:instructionFilter,workq:workQuery||null,workopen:openId,
      })}>Search published people and meetings</Link>
      {scopedIndex === null ? <p className={s.goldNote}>An exact receipt-linked searchable index is not on this snapshot yet. Older work remains available after clearing the instruction filter; this hunt&apos;s count is unknown.</p> : <div className={`${s.card} ${s.cardList} ${s.gap20}`}>
        <form action={path} method="get" role="search" className={s.row10}>
          {scopeParam(base.scope) && <input type="hidden" name="scope" value={scopeParam(base.scope)!} />}
          {instructionFilter && <input type="hidden" name="instruction" value={instructionFilter} />}
          <label htmlFor="work-search" className={s.titleStrong14}>Search all work</label>
          <input id="work-search" type="search" name="q" defaultValue={workQuery} maxLength={100} className={s.input} placeholder="Name, meeting, failure or next step" />
          <button type="submit" className={s.btnLink}>Search</button>
        </form>
        <p className={s.note}>{searchedIndex!.length.toLocaleString("en-US")} of {scopedIndex!.length.toLocaleString("en-US")} indexed work items match; showing {shownIndex.length} on page {indexPage} of {indexPages}. Each item is one job, not a missing fact.</p>
        <div className={s.stack8}>{shownIndex.map(row => <div key={row.id} className={s.insetRow}>
          <Pill tone={STATE_PILL[row.state].tone}>{STATE_PILL[row.state].pill}</Pill>
          <span className={`${s.text14} ${s.grow}`}>{row.label}{row.subjectName && row.subjectName !== row.label ? ` · ${row.subjectName}` : ""}{row.lastAttemptAt ? ` · last attempt ${formatEastern(row.lastAttemptAt)}` : ""}</span>
          <Link href={`${here({ open: row.id })}#a-${encodeURIComponent(row.id)}`} className={s.btnLink}>Open</Link>
        </div>)}</div>
        {shownIndex.length === 0 && <p className={s.note}>No work matches this search in the selected scope.</p>}
        <div className={s.row10}>
          {indexPage > 1 && <Link href={here({ page: String(indexPage - 1), open: null })} className={s.btnLink}>Previous 50</Link>}
          {indexPage < indexPages && <Link href={here({ page: String(indexPage + 1), open: null })} className={s.btnLink}>Next 50</Link>}
        </div>
      </div>}
      {!na.ok || !ca.ok ? (
        <Refusal title="This list refused to draw its own numbers.">{!na.ok ? na.detail : ca.detail}</Refusal>
      ) : (
        <div className={s.stack14}>
          <h3 className={s.titleStrong16} style={{ margin: "4px 0 0" }}>
            Your instructions — {instructions.length}
          </h3>
          {base.malformedScopes > 0 && (
            <p className={s.goldNote}>
              {base.malformedScopes} entr{base.malformedScopes === 1 ? "y" : "ies"} on your policy row could not be read as a geography, so the runner holds all paid work until
              it is fixed.
            </p>
          )}
          {instructions.length === 0 ? (
            <p className={s.note}>You have not sent any. The runner works through the standing work below in its own order until you do.</p>
          ) : (
            instructions.map((i) =>
              card(
                i.card,
                opened.kind === "INSTRUCTION" && opened.view.card.id === i.card.id ? (
                  <InstructionDetail view={i} sharedSources={sharedSources}
                    activity={view && exactInstructionMembership(view,i.decision.key,i.decision.receiptId).index!==null &&
                      !view.allRowsIndex?.some(row=>row.assignmentRefs?.some(mark=>mark.key===i.decision.key&&mark.ref!==i.decision.receiptId))
                      ? huntActivity(exactInstructionMembership(view,i.decision.key,i.decision.receiptId).rows,i.decision.key) : null}
                    bodyAttempts={exactInstructionMembership(view,i.decision.key,i.decision.receiptId).bodyAttempts}
                    unattributedBodyAttemptCount={view?.bodyAttempts?.filter(attempt => !Array.isArray(attempt.assignmentRefs) || attempt.assignmentRefs.length === 0).length ?? null}
                    huntCost={snapshotOut.kind === "HELD" ? snapshotOut.value.billingAttribution?.hunts?.find(hunt => hunt.key === i.decision.key && hunt.receiptId === i.decision.receiptId && hunt.startedAt === i.decision.budgetStartedAt) ?? null : null}
                    legacyHuntCost={snapshotOut.kind === "HELD" && i.decision.key === ORIGINAL_LIFETIME_HUNT.key && i.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId && i.decision.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt
                      ? snapshotOut.value.billingAttribution?.hunts?.find(hunt => hunt.key === i.decision.key && hunt.startedAt === i.decision.budgetStartedAt && !hunt.receiptId) ?? null : null}
                    workHref={`${here({ instruction: i.decision.key, open: null, show: null })}#assignments`} openHref={(id) => `${here({ open: id })}#a-${encodeURIComponent(id)}`} />
                ) : null,
              ),
            )
          )}
          {/* A piece of work opened from an instruction (or from Money) that the list below does not draw is drawn here, whole. */}
          {opened.kind === "DETAIL" && !drawnIds.has(opened.id) && card({ id: opened.id, kind: "STANDING", pill: "OPENED", tone: "slate", title: opened.id, summary: "Opened by its id; it is not among the rows drawn below." }, <DetailSections detail={opened.detail} trail={opened.trail} trailPage={requestedTrailPage} trailHref={page=>`${here({open:opened.id,trailPage:String(page),evidencePage:String(evidencePage)})}#a-${encodeURIComponent(opened.id)}`} says={opened.says} artifacts={opened.artifacts} evidencePage={evidencePage} evidenceHref={page=>`${here({open:opened.id,trailPage:String(requestedTrailPage),evidencePage:String(page)})}#a-${encodeURIComponent(opened.id)}`} />)}

          <h3 className={s.titleStrong16} style={{ margin: "18px 0 0" }}>
            Work{instructionFilter !== null ? " reached by this instruction" : scopeState === null ? " across all places" : ` attributed to ${stateName(scopeState)}`}{scopedTotal !== null ? ` — ${unfinishedWork.toLocaleString("en-US")} waiting or stuck` : ""}
          </h3>
          {published === null ? (
            <p className={s.note}>The assignment list is not on the published snapshot, so no standing work is listed — not an empty list.</p>
          ) : published.kind === "NOT_BUILT" ? (
            <p className={s.note}>The publisher could not build the assignment list at {formatEastern(published.at)}: {published.says}</p>
          ) : (
            <>
              <p className={s.note}>
                {scopedTotal === null ? "The full work total is unavailable for this scope." : `${scopedTotal.toLocaleString("en-US")} tracked work rows in this scope, including completed and retired rows. ${unfinishedWork.toLocaleString("en-US")} are waiting, working, failed or blocked.`} These are work rows, not distinct missing reader facts.
              </p>
              {instructionFilter !== null ? <p className={s.note}>{countsUnavailable ? "The published snapshot has no receipt-specific instruction attribution yet; no count is inferred from geography or an older Send." : "These are exact receipt references recorded on the work, including shared work. Totals include rows omitted from this bounded list. They describe work reached, not proof of complete geographic coverage."} <Link className={s.btnLink} href={here({ instruction: null, show: null })}>Show all standing work and history in this scope</Link></p> : scopeState !== null && <p className={s.note}>{view?.geographicCounts === undefined ? "The published snapshot has no state attribution yet; its global total is not presented as this state's work." : "This list uses each assignment's recorded state. Shared or unplaced work remains visible under All scopes."}{base.scope.kind === "geo" ? " Select an instruction to see its exact work; these are state totals, not inferred totals for this selected geography." : ""}</p>}
              <p className={s.note}>
                {view!.selection.rule} {scopedTotal !== null && scopedTotal > rows.length ? `${(scopedTotal - rows.length).toLocaleString("en-US")} rows in this scope are not carried on the published list; each group says how many it holds.` : ""}
              </p>
              <p className={s.note}>{scopeState !== null || instructionFilter !== null ? "Across all scopes: " : ""}{askGapCountWords(view!)}</p>
              <div className={s.rowCenter} style={{ gap: 8 }}>
                {groups.map((g) => (
                  <Link key={g.state} href={`${here({ show: show === g.state ? null : g.state, open: null })}#assignments`} className={`${s.chip} ${show === g.state ? s.chipOn : ""}`}>
                    {STATE_PILL[g.state].pill.toLowerCase()} · {g.total.toLocaleString("en-US")}
                  </Link>
                ))}
              </div>
              {groups
                .filter((g) => show === null || show === g.state)
                .map((g) => {
                  const cards = show === g.state ? g.listed : g.listed.slice(0, FIRST_PER_GROUP);
                  return (
                    <div key={g.state} className={s.stack14}>
                      <p className={s.note}>
                        {STATE_PILL[g.state].pill.toLowerCase()}: {g.total.toLocaleString("en-US")} in all, {g.listed.length} carried on the published list
                        {cards.length < g.listed.length ? `, ${cards.length} shown — ` : "."}
                        {cards.length < g.listed.length && (
                          <Link href={`${here({ show: g.state, open: null })}#assignments`} className={s.btnLink}>
                            show all {g.listed.length}
                          </Link>
                        )}
                      </p>
                      {cards.map((r) => card(standingCard(r), opened.kind === "DETAIL" && opened.id === r.id ? <DetailSections detail={opened.detail} trail={opened.trail} trailPage={requestedTrailPage} trailHref={page=>`${here({open:opened.id,trailPage:String(page),evidencePage:String(evidencePage)})}#a-${encodeURIComponent(opened.id)}`} says={opened.says} artifacts={opened.artifacts} evidencePage={evidencePage} evidenceHref={page=>`${here({open:opened.id,trailPage:String(requestedTrailPage),evidencePage:String(page)})}#a-${encodeURIComponent(opened.id)}`} /> : null))}
                    </div>
                  );
                })}
            </>
          )}

          <h3 className={s.titleStrong16} style={{ margin: "18px 0 0" }}>
            Routine meeting reads{instructionFilter !== null ? " in the sidebar scope (separate from this instruction)" : ""}{bodiesRead.kind === "HELD" ? ` — ${inScopeBodies.reduce((n, b) => n + b.contractIds.length, 0)}` : ""}
          </h3>
          {bodiesRead.kind === "UNREAD" ? (
            <p className={s.note}>{bodiesRead.detail}</p>
          ) : (
            routineGroups.map((g) => (
              <div key={g.st} className={s.stack14}>
                {g.bodies.slice(0, show === `routine-${g.st}` ? g.bodies.length : FIRST_PER_GROUP).flatMap((b) =>
                  b.contractIds.map((cid) => {
                    const id = `routine:${cid}`;
                    return card(routineCard(b, cid), opened.kind === "DETAIL" && opened.id === id ? <DetailSections detail={opened.detail} trail={opened.trail} trailPage={requestedTrailPage} trailHref={page=>`${here({open:opened.id,trailPage:String(page),evidencePage:String(evidencePage)})}#a-${encodeURIComponent(opened.id)}`} says={opened.says} artifacts={opened.artifacts} evidencePage={evidencePage} evidenceHref={page=>`${here({open:opened.id,trailPage:String(requestedTrailPage),evidencePage:String(page)})}#a-${encodeURIComponent(opened.id)}`} /> : null);
                  }),
                )}
                {g.bodies.length > FIRST_PER_GROUP && show !== `routine-${g.st}` && (
                  <Link href={`${here({ show: `routine-${g.st}`, open: null })}#assignments`} className={s.btnLink}>
                    Show all {g.bodies.length} {g.st.toLowerCase()} bodies
                  </Link>
                )}
              </div>
            ))
          )}
          {opened.kind === "MISSING" && (
            <Refusal title={`${opened.id} could not be opened.`}>{opened.says}</Refusal>
          )}
        </div>
      )}
      {/* The lane gauges, drawn from the research state read above and refreshed from the pulse while the page is visible (MW-071). */}
      {props.area === "fleet" && <LaneStrip initial={pulseLanesOf(research)} />}
      {/* The runner is not drawn in the design; it follows the design's own sections so Work leads with the instruction, as the design does. */}
      {props.area === "fleet" && (
        <RunnerCard
          standing={runnerStanding(heartbeatOut.kind === "HELD" ? heartbeatOut.value : null, intentsOut.kind === "HELD" ? intentsOut.value : [], base.nowIso, research?.fleetSafety ?? null)}
          heartbeat={heartbeatOut.kind === "HELD" ? heartbeatOut.value : null}
          safety={research?.fleetSafety ?? null}
          digest={digestOut && digestOut.kind === "HELD" ? digestOut.value : null}
          digestNote={digestOut && digestOut.kind !== "HELD" ? digestOut.detail : null}
          returnTo={base.here}
          lanes={queueLanesOf(research)}
        />
      )}
      {props.area === "fleet" && (
        <DeliveryTrailCard
          trail={deliveryTrail}
          note={`${instructionFilter !== null ? "This pipeline shows all work, separately from the instruction filter above. " : ""}${livePipeline.ok ? `Collection and validation read live at ${formatEastern(livePipeline.at)}. Public readbacks and cost summaries retain their recorded sync times.` : livePipeline.reason}`}
        />
      )}
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}

function InstructionDetail({ view, openHref, workHref, sharedSources, activity, huntCost, legacyHuntCost, bodyAttempts, unattributedBodyAttemptCount }: { view: InstructionView; openHref: (id: string) => string; workHref: string; sharedSources: HuntSourceProgressRead | null; activity: ReturnType<typeof huntActivity> | null; huntCost: NonNullable<BillingAttribution["hunts"]>[number] | null; legacyHuntCost: NonNullable<BillingAttribution["hunts"]>[number] | null; bodyAttempts: readonly BodyPublicationAttempt[] | null; unattributedBodyAttemptCount: number | null }) {
  const d = view.decision;
  const r = view.reach;
  const legacyKnownAnthropic = legacyHuntCost?.anthropicKnownUsd ?? legacyHuntCost?.anthropicUsd ?? null;
  const legacyKnownOther = legacyHuntCost?.otherKnownUsd ?? legacyHuntCost?.otherUsd ?? null;
  const links = (ids: readonly string[], more: number) => (
    <div className={s.stack2}>
      {ids.map((id) => (
        <Link key={id} href={openHref(id)} className={s.btnLink} scroll={false}>
          {id}
        </Link>
      ))}
      {more > 0 && <span className={s.note}>and {more.toLocaleString("en-US")} more, not listed here</span>}
    </div>
  );
  return (
    <div className={s.divider}>
      <h4 className={s.h4}>Your words</h4>
      {d.note ? <p className={s.record}>“{d.note}”</p> : <p className={s.note} style={{ marginBottom: 22 }}>You sent this without words of your own.</p>}
      <h4 className={s.h4}>Cost since this hunt started</h4>
      {huntCost ? <p className={s.note}>
        Token allowance: {huntCost.budgetConsumedKnownUsd === undefined ? "consumption not measured" : `$${huntCost.budgetConsumedKnownUsd.toFixed(2)} known charges including shared requests`}; {huntCost.reservedUsd === null ? "reservations unread" : `$${huntCost.reservedUsd.toFixed(2)} reserved`}; {huntCost.budgetConsumedKnownUsd === undefined || huntCost.availableUsd === null ? "available allowance cannot be confirmed" : `$${huntCost.availableUsd.toFixed(2)} available`} of ${huntCost.budgetUsd.toFixed(2)}. {huntCost.budgetUnpriced === undefined ? "Unpriced token requests not measured" : `${huntCost.budgetUnpriced} unpriced token request${huntCost.budgetUnpriced === 1 ? "" : "s"}`}. For combined reporting, ${huntCost.anthropicKnownUsd.toFixed(2)} Anthropic and ${huntCost.otherKnownUsd.toFixed(2)} other known costs are allocated here once; ${huntCost.knownCombinedUsd.toFixed(2)} combined known. {huntCost.anthropicUsd === null || huntCost.otherUsd === null ? "At least one service total is incomplete; the combined known figure is a subtotal." : ""} {huntCost.unpriced > 0 ? `${huntCost.unpriced} provider requests still need pricing.` : ""} <Link href="/admin/money" className={s.btnLink}>See cost detail</Link>
      </p> : legacyHuntCost ? <p className={s.note}>An earlier billing snapshot linked by hunt key and start, without this saved receipt, records {legacyKnownAnthropic === null ? "an unknown amount" : `$${legacyKnownAnthropic.toFixed(2)}`} in known Anthropic charges. Other-service total is {legacyHuntCost.otherUsd === null ? "incomplete" : legacyKnownOther === null ? "not measured" : `$${legacyKnownOther.toFixed(2)}`}. These are historical amounts, not exact receipt attribution or confirmed available allowance. {legacyHuntCost.unpriced} requests still need pricing. <Link href="/admin/money" className={s.btnLink}>See cost detail</Link></p> : <p className={s.note}>No matching started-hunt cost reading is available. This does not mean zero spent.</p>}
      <h4 className={s.h4}>Body publication attempts</h4>
      {bodyAttempts === null ? <p className={s.goldNote}>The body attempt projection was not published, so this instruction&apos;s publisher attempts cannot be counted.</p>
        : bodyAttempts.length === 0 ? <p className={s.note}>No publisher attempt is recorded on the work linked to this instruction yet. Earlier source searches may still exist.</p>
          : <div className={s.stack8} style={{ marginBottom: 24 }}>{bodyAttempts.map(attempt => <div key={`${attempt.workItemId}:${attempt.workerResultId}`} className={s.insetRow}>
            <Link href={openHref(attempt.workItemId)} className={s.btnLink}>{attempt.bodyId}</Link>
            <Pill tone={attempt.status === "PUBLISHED" ? "teal" : attempt.status === "PARTIALLY_PUBLISHED" ? "cyan" : "stone"}>{attempt.status.replaceAll("_", " ")}</Pill>
            <span className={s.note}>{attempt.code} · {formatEastern(attempt.at)} · {attempt.acceptedCount === null ? "accepted member count not recorded" : `${attempt.acceptedCount} accepted member${attempt.acceptedCount === 1 ? "" : "s"}`}{attempt.versionId ? ` · reader version ${attempt.versionId}` : ""}</span>
          </div>)}</div>}
      {unattributedBodyAttemptCount !== null && unattributedBodyAttemptCount > 0 && <p className={s.note}>{unattributedBodyAttemptCount} publisher attempt{unattributedBodyAttemptCount === 1 ? "" : "s"} across all work lack an exact instruction reference and are not included in this instruction&apos;s count.</p>}
      {sharedSources !== null && <>
        <h4 className={s.h4}>Shared source work for this instruction</h4>
        {sharedSources.ok && <p className={s.note}>Activity read {formatEastern(sharedSources.at)}{sharedSources.stale ? " · stale; retaining the last readable activity" : ""}.</p>}
        {!sharedSources.ok ? <p className={s.note}>{sharedSources.reason}</p> : sharedSources.rows.length === 0
          ? <p className={s.note}>No source-worker receipt is recorded for this Send yet. This is not a coverage or completion claim.</p>
          : <div className={s.stack8} style={{ marginBottom: 24 }}>{sharedSources.rows.map(row => <div key={row.taskId} className={s.inset}>
              <div className={s.row10}><span className={s.name14}>{row.taskId}</span><Pill tone={row.stage === "PUBLISHED" || row.stage === "REUSED" ? "teal" : row.stage === "FAILED" || row.stage === "HELD" ? "stone" : "cyan"}>{row.stage.replaceAll("_", " ")}</Pill></div>
              <p className={s.note}>{row.detail}</p>
              <p className={s.note}>Deterministic source worker · {formatEastern(row.at)} · shared scope {row.scope}</p>
              {row.candidateId && <p className={s.monoId}>{row.stage === "PUBLISHED" || row.stage === "REUSED" ? "Reader version" : "Held candidate"}: {row.candidateId}</p>}
              {row.readerPaths.map(path => <a key={path} className={s.btnLink} href={`${PUBLIC_SITE_ORIGIN}${path}`} target="_blank" rel="noreferrer">Open public result {path}</a>)}
            </div>)}</div>}
      </>}
      <h4 className={s.h4}>The runner&rsquo;s acknowledgement</h4>
      <div className={s.stack2} style={{ marginBottom: 24 }}>
        {view.ack.map((f) => (
          <div key={f.pill} className={s.activityRow}>
            <Pill tone={f.tone}>{f.pill}</Pill>
            <span className={`${s.text14} ${s.grow}`}>{f.text}</span>
            <span className={s.monoSmall}>{f.at ? formatEastern(f.at) : "—"}</span>
          </div>
        ))}
      </div>
      <h4 className={s.h4}>Hunt progress</h4>
      <div className={s.inset} style={{ marginBottom: 24 }}>
        <div className={s.row10}>
          <span className={s.name14}>Known work completed</span>
          <Pill tone={view.progress.percent === 100 ? "teal" : "cyan"}>{view.progress.percent === null ? "NOT MEASURED" : `${view.progress.percent}%`}</Pill>
        </div>
        <progress className={s.huntProgress} value={view.progress.complete ?? undefined} max={Math.max(1, view.progress.known)} aria-label="Known hunt work completed" />
        <p className={s.note}>{view.progress.says}</p>
        {view.progress.notCreated !== null && view.progress.notCreated > 0 && <p className={s.goldNote}>{view.progress.notCreated} required work items have not yet been created. They remain in this progress denominator.</p>}
        {sharedSources !== null && sharedSources.ok && <p className={s.note}>
          Recorded shared sources: {sharedSources.rows.filter(row => row.stage === "PUBLISHED").length} published, {sharedSources.rows.filter(row => row.stage === "REUSED").length} reused, {sharedSources.rows.filter(row => row.stage === "QUEUED" || row.stage === "COLLECTING_AND_VERIFYING").length} active or queued, {sharedSources.rows.filter(row => row.stage === "HELD" || row.stage === "FAILED").length} held or failed.
        </p>}
        <p className={s.note}>This percentage measures recorded work, not proof that every applicable source or public result has been found. Full hunt completion still requires coverage and reader-delivery evidence.</p>
      </div>
      <h4 className={s.h4}>Collection to readers</h4>
      {activity === null ? <p className={s.goldNote}>Receipt-linked stage activity cannot be established from this snapshot; earlier work remains available in the full history.</p> : <>
        <p className={s.note}>Recorded activity on {activity.listed} listed work items linked to this Send. A work item can reach more than one stage. The published list may be bounded; the completion count above covers the full linked work.</p>
        <div className={`${s.gridAuto220} ${s.gap20}`} style={{ marginBottom: 18 }}>
          {([ ["Found", activity.stages.found], ["Parsed", activity.stages.parsed], ["Verified", activity.stages.verified], ["Promoted", activity.stages.promoted], ["Shown on live site", activity.stages.live] ] as const).map(([label, count]) =>
            <div key={label} className={`${s.insetTile} ${s.stack6}`}><span className={s.titleStrong14}>{label}</span><span className={s.fig}>{count}</span></div>)}
        </div>
        <p className={s.note}>Found includes recorded leads and routes, not verified claims. Verified requires an accepted pipeline verification or a verified publication outcome. Promoted means the publication record says it reached the canonical version. Shown on live site requires a separate public reader readback. These are recorded work items, not a claim that all information is complete.</p>
        {activity.roles.length > 0 && <p className={s.text14}><span className={s.strong}>Workers recorded on this work: </span>{activity.roles.map(([role, count]) => `${role} (${count} listed item${count === 1 ? "" : "s"})`).join(" · ")}. These are historical workers; current Scouts are reported above.</p>}
        {activity.recent.length > 0 && <div className={s.stack8} style={{ marginBottom: 24 }}>
          <span className={s.label}>Recent recorded work</span>
          {activity.recent.map(row => <div key={row.id} className={s.insetRow}>
            <Link href={openHref(row.id)} className={s.btnLink} scroll={false}>{row.title}</Link>
            <span className={s.text14}>{row.stateSays}</span>
            <span className={s.monoSmall}>{formatEastern(row.lastActivityAt)}</span>
          </div>)}
        </div>}
      </>}
      <h4 className={s.h4}>What it addresses</h4>
      <div className={s.stack8} style={{ marginBottom: 24 }}>
        <div className={s.insetRow}>
          <span className={s.monoId}>{instructionKey(d)}</span>
          <span className={`${s.text14} ${s.grow}`}>
            {d.geography.label}
            {view.reading?.resolution.kind === "RESOLVED" ? ` — ${view.reading.resolution.zctaCount} codes` : ""}
          </span>
          <Pill tone="slate">PRIORITY {d.priority}</Pill>
        </div>
        {(d.questions ?? []).map((q) => (
          <div key={q} className={s.insetRow}>
            <span className={s.monoId}>{q}</span>
            <span className={`${s.text14} ${s.grow}`}>{WORK_QUESTION_WORDS[q]}</span>
            <Pill tone="teal">YOUR QUESTION</Pill>
          </div>
        ))}
        <p className={s.note}>
          {(d.questions ?? []).length > 0
            ? "Your questions are kept on the instruction and on every piece of work it reaches. Scouts receive them in their task brief and investigate them against current evidence and inherited holdings; validation and publication requirements still apply."
            : "You asked no question of it — or sent it before questions were kept. The geography is what it is for."}
        </p>
      </div>
      <h4 className={s.h4}>What it reached</h4>
      <Link href={workHref} className={s.btnLink}>Show this instruction&rsquo;s work</Link>
      <div style={{ marginBottom: 24 }}>
        {r === null ? (
          <p className={s.note}>{view.reachWhyNot}</p>
        ) : (
          <>
            <p className={s.note} style={{ marginBottom: 12 }}>
              {r.says}
            </p>
            <div className={s.gridAuto240} style={{ gap: 12 }}>
              <div className={s.inset}>
                <div className={s.row10} style={{ marginBottom: 8 }}>
                  <span className={s.name14}>Created by it</span>
                  <Pill tone="cyan">{r.created.toLocaleString("en-US")}</Pill>
                </div>
                {r.created === 0 ? <p className={s.note}>Nothing yet.</p> : links(r.createdIds, r.createdMore)}
              </div>
              <div className={s.inset}>
                <div className={s.row10} style={{ marginBottom: 8 }}>
                  <span className={s.name14}>Put first by it</span>
                  <Pill tone="slate">{r.reordered.toLocaleString("en-US")}</Pill>
                </div>
                {r.reordered === 0 ? <p className={s.note}>Nothing recorded yet.</p> : links(r.reorderedIds, r.reorderedMore)}
              </div>
            </div>
          </>
        )}
      </div>
      {view.lanes.length > 0 && (
        <>
          <h4 className={s.h4}>Work lanes, running at once</h4>
          <div className={s.gridAuto240} style={{ gap: 12, marginBottom: 24 }}>
            {view.lanes.map((l) => (
              <div key={l.name} className={s.inset}>
                <div className={s.row10} style={{ marginBottom: 8 }}>
                  <span className={s.name14}>{l.name}</span>
                  <Pill tone={l.tone}>{l.pill}</Pill>
                </div>
                <KV tight rows={l.rows} />
                <p className={s.note} style={{ marginTop: 10 }}>
                  {l.note}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
      <h4 className={s.h4}>What it has spent</h4>
      {view.budget ? (
        <div className={s.inset} style={{ marginBottom: 12 }}>
          <KV tight rows={view.budget.rows} />
          <p className={s.note} style={{ marginTop: 10 }}>
            {view.budget.says}
          </p>
        </div>
      ) : (
        <p className={s.note} style={{ marginBottom: 12 }}>
          This instruction&rsquo;s own budget is not read yet: the runner has not recorded what it spent, held and has left.
        </p>
      )}
      <p className={s.note} style={{ marginBottom: 24 }}>
        {view.spend}.
      </p>
      <h4 className={s.h4}>Where it got to</h4>
      <p className={s.note} style={{ marginBottom: 6 }}>
        Joined by place, not read from the work: standing work about governments in this geography. It covers work recorded before instructions were kept on the work,
        and it is not the same as what this instruction reached.
      </p>
      {view.inScope ? (
        <p className={s.note}>
          {view.inScope.inScope} listed {view.inScope.inScope === 1 ? "assignment is" : "assignments are"} about governments here
          {view.inScope.byState.length > 0 ? `: ${view.inScope.byState.map((b) => `${b.count} ${STATE_PILL[b.state].pill.toLowerCase()}`).join(", ")}` : ""}.
          {view.inScope.floor ? " The runner's list of subjects was cut, so these counts are a floor." : ""}
        </p>
      ) : (
        <p className={s.note}>{view.inScopeWhyNot}</p>
      )}
    </div>
  );
}

function DetailSections({ detail, trail, trailPage, trailHref, says, artifacts, evidencePage, evidenceHref }: {
  detail: AssignmentDetailView; trail: AssignmentEvidenceTrail | null; trailPage: number;
  trailHref: (page:number)=>string; says: string; artifacts: readonly ArtifactRecord[];
  evidencePage: number; evidenceHref: (page:number)=>string;
}) {
  const pageSize=20;
  const pages=Math.max(1,Math.ceil((trail?.events.length??0)/pageSize));
  const page=Number.isSafeInteger(trailPage)?Math.max(1,Math.min(trailPage,pages)):1;
  const shown=trail?.events.slice((page-1)*pageSize,page*pageSize)??[];
  const evidencePages = Math.max(1, Math.ceil(artifacts.length / 50));
  const shownEvidencePage = Math.min(evidencePage, evidencePages);
  return (
    <div className={s.divider}>
      <h4 className={s.h4}>Your words</h4>
      <p className={s.note} style={{ fontSize: 14, marginBottom: 22 }}>
        {detail.wordsNote}
      </p>
      <h4 className={s.h4}>What it addresses</h4>
      <div className={s.stack8} style={{ marginBottom: 10 }}>
        {detail.addresses.map((a) => (
          <div key={`${a.id}-${a.text}`} className={s.insetRow}>
            <span className={s.monoId}>{a.id}</span>
            <span className={`${s.text14} ${s.grow}`}>{a.text}</span>
            <Pill tone={a.tone}>{a.pill}</Pill>
          </div>
        ))}
      </div>
      <p className={s.note} style={{ marginBottom: 24 }}>
        {detail.addressesNote}
      </p>
      {trail && <section className={s.stack10} aria-label="Source to public result trail" style={{ marginBottom:24 }}>
        <h4 className={s.h4}>From source to public result</h4>
        <p className={s.note}>{trail.events.length} recorded steps on this linked work, newest first; showing {shown.length} on page {page} of {pages}. A saved document is not an accepted fact, and a publication is not a confirmed public result.</p>
        {trail.gaps.map(gap=><p key={gap} className={s.goldNote}>{gap}</p>)}
        {shown.length===0 && <p className={s.note}>No linked execution step was returned by this read. This is not evidence that the source is complete.</p>}
        {shown.map(event=><div key={event.id} className={s.insetRow}>
          <div className={`${s.stack2} ${s.grow}`}>
            <span className={s.name14}>{event.title}</span>
            <span className={s.note}>{event.stage.toLowerCase()} · {event.at?formatEastern(event.at):"time not recorded"}</span>
            <span className={s.text14}>{event.says}</span>
            {event.nextAction && <span className={s.note}>Current work plan: {plainText(event.nextAction)}</span>}
            <div className={s.row10}>{event.sourceUrl && <a className={s.btnLink} href={event.sourceUrl} target="_blank" rel="noreferrer">Open source page</a>}{event.publicUrl && <a className={s.btnLink} href={event.publicUrl} target="_blank" rel="noreferrer">Open published result</a>}</div>
            {event.references.length>0 && <details className={s.note}><summary>Exact records and receipts</summary><div className={s.stack2}>{event.references.map(([name,value],index)=><span key={`${name}:${value}:${index}`}>{name}: {value}</span>)}</div></details>}
          </div>
        </div>)}
        <div className={s.row10}>{page>1 && <Link className={s.btnLink} href={trailHref(page-1)}>Newer 20</Link>}{page<pages && <Link className={s.btnLink} href={trailHref(page+1)}>Older 20</Link>}</div>
      </section>}
      <h4 className={s.h4}>Work lanes, running at once</h4>
      <div className={s.gridAuto240} style={{ gap: 12, marginBottom: 24 }}>
        {detail.lanes.map((l) => (
          <div key={l.name} className={s.inset}>
            <div className={s.row10} style={{ marginBottom: 8 }}>
              <span className={s.name14}>{l.name}</span>
              <Pill tone={l.tone}>{l.pill}</Pill>
            </div>
            {l.rows.length > 0 && <KV tight rows={l.rows} />}
            {l.note && (
              <p className={s.note} style={{ marginTop: 10 }}>
                {l.note}
              </p>
            )}
          </div>
        ))}
      </div>
      <h4 className={s.h4}>Which AI it used, and why anything went higher</h4>
      <div className={s.stack8} style={{ marginBottom: 10 }}>
        {detail.models.length === 0 ? (
          <p className={s.note}>{detail.modelsNote}</p>
        ) : (
          detail.models.map((m, i) => (
            <div key={`${i}-${m.step}-${m.pill}`} className={s.insetBox}>
              <div className={s.row}>
                <Pill tone={m.tone}>{m.pill}</Pill>
                <span className={`${s.text14} ${s.grow}`}>{m.step}</span>
                <span className={s.monoSmall}>{m.model}</span>
                <span className={s.figSm} style={{ fontSize: 13, minWidth: 56, textAlign: "right" }}>
                  {m.cost}
                </span>
              </div>
              <p className={s.note} style={{ marginTop: 8 }}>
                {m.why}
              </p>
            </div>
          ))
        )}
      </div>
      {detail.models.length > 0 && (
        <p className={s.note} style={{ marginBottom: 24 }}>
          {detail.modelsNote}
        </p>
      )}
      <h4 className={s.h4}>Where it got to</h4>
      <div style={{ marginBottom: 24 }}>
        <Cells five cells={detail.outcomes.map((o) => ({ key: o.key, value: o.value, label: o.label, unknown: o.unknown, tone: o.tone }))} />
      </div>
      <h4 className={s.h4}>What reached the public site</h4>
      {detail.promoted.length === 0 ? (
        <p className={s.note} style={{ marginBottom: 12 }}>
          {detail.promotedNote}
        </p>
      ) : (
        <div className={s.stack8}>
          {detail.promoted.map((p) => (
            <div key={p.title} className={s.inset}>
              <div className={s.row} style={{ marginBottom: 12 }}>
                <Pill tone={p.tone}>{p.pill}</Pill>
                <span className={`${s.name14} ${s.grow}`}>{p.title}</span>
              </div>
              <KV rows={p.trail} />
            </div>
          ))}
        </div>
      )}
      {detail.unsettled.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 className={s.h4} style={{ marginBottom: 6 }}>
            Not settled — this is why it is not finished
          </h4>
          <p className={s.note} style={{ marginBottom: 12 }}>
            Being visited is not the same as finished, and it is never shown as finished.
          </p>
          <div className={s.stack10}>
            {detail.unsettled.map((u) => (
              <DeadEnd key={`${u.pill}-${u.title}`} flush d={{ pill: u.pill, title: u.title, ruledOut: u.ruledOut, wouldSettle: u.wouldSettle, whoMoves: u.whoMoves, gaps: u.gaps }} />
            ))}
          </div>
        </div>
      )}
      <p className={`${s.note} ${s.noteTop}`}>
        <strong className={s.strong}>Cost:</strong> {detail.costLine}
      </p>
      {artifacts.length > 0 && <section>
        <h4 className={s.h4}>Saved source documents</h4>
        <p className={s.note}>These are recorded captures. A download opens only after the runner has made and verified a private copy; an unavailable copy remains unavailable.</p>
        <p className={s.note}>Showing page {shownEvidencePage} of {evidencePages}; {artifacts.length.toLocaleString("en-US")} recorded captures.</p>
        <div className={s.stack8}>{artifacts.slice((shownEvidencePage - 1) * 50, shownEvidencePage * 50).map(a => <div key={`${a.workItemId}:${a.attemptId}:${a.artifactId}`} className={s.insetRow}>
          <span className={s.monoSmall}>{a.artifactId} · {a.contentHash} · {a.byteLength.toLocaleString("en-US")} bytes</span>
          {a.tier === "RAW" && !a.partial && a.byteLength <= ADMIN_EVIDENCE_MAX_BYTES && adminMirrorableContentType(a.contentType)
            ? <EvidenceCaptureControl workItemId={a.workItemId} attemptId={a.attemptId} artifactId={a.artifactId} />
            : <span className={s.note}>{a.partial ? "Partial capture; original download unavailable" : a.tier !== "RAW" ? "Restricted or derived capture; original download unavailable" : a.byteLength > ADMIN_EVIDENCE_MAX_BYTES ? "Held original exceeds the 32 MiB private copy limit; available only in the runner vault" : "This content type has no verified safe private copy yet"}</span>}
        </div>)}</div>
        {evidenceHref && <div className={s.row10}>
          {shownEvidencePage > 1 && <Link href={evidenceHref(shownEvidencePage - 1)} className={s.btnLink}>Previous 50 captures</Link>}
          {shownEvidencePage < evidencePages && <Link href={evidenceHref(shownEvidencePage + 1)} className={s.btnLink}>Next 50 captures</Link>}
        </div>}
      </section>}
      <p className={s.monoSmall} style={{ marginTop: 10 }}>
        {says}
      </p>
    </div>
  );
}
