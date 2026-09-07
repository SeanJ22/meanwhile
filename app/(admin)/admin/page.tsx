/**
 * **THE OWNER COMMAND CENTRE.** (Admin Pass C, ADM-C1, 2026-09-06 — rebuilt on
 * the 9.6.26 owner feedback, ADM-24 through ADM-39.)
 *
 * Reachable only on `ADMIN_ORIGIN`, only with a valid session — both enforced
 * upstream in `middleware.ts`, which returns 404 for this path on the public
 * host and redirects an unauthenticated request to the login page before this
 * component is ever invoked.
 *
 * ## The test every line on this page has to pass
 *
 * The owner's own, from the 9.6.26 dictation:
 *
 * > *"Think of someone: I'm not an engineer and I'm not a coder at all. When I
 * > come into this what I want to see is: what is it that I'm looking at? What
 * > needs to be taken action on? Give me very simple plain-English definitions
 * > or explanations of what is going on."*
 *
 * So every section leads with four things — what this is, what happened, does
 * this need you, what happens next — and the machine's own words are one
 * disclosure down. Nothing was deleted to achieve that; it was demoted.
 *
 * ## What moved out of this file
 *
 * The page used to be 1,236 lines with every section's JSX inline. The sections
 * are now components under `./sections/`, each owning one panel and each taking
 * already-audited values. This file keeps the three things that must stay in
 * one place: the reads, the self-audit, and the composition.
 *
 * ## Everything here comes from the durable control plane
 *
 * No filesystem read, no Drive mirror, no process table, no agent output.
 * `next.config.ts` documents at length what a `process.cwd()` read does in a
 * Netlify standalone bundle when nobody traced it: returns nothing, the catch
 * returns null, and the surface renders its own gap wording — which is
 * indistinguishable from honest missing data. So the data plane is Postgres and
 * this page reads it.
 *
 * ## The page checks itself before it shows anything
 *
 * Two audits run against what is about to be rendered, not against the code
 * that produced it: every number carries a denominator and an interpretation
 * contract, and every stated N equals the number of rows actually rendered. A
 * failure replaces the numbers with a refusal.
 *
 * ## And it keeps itself current (ADM-34)
 *
 * `LiveRefresh` polls a cheap pulse endpoint and asks the router for a fresh
 * render only when the pulse says something moved. The owner asked *"do I have
 * to manually refresh the site?"*; the header answers it.
 */

import { Suspense } from "react";

import { cookies } from "next/headers";

import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import {
  openControlPlane,
  readCacheObservation,
  readDecisions,
  readDigests,
  readFleetSafety,
  readHeartbeat,
  readSnapshot,
  type ReadOutcome,
} from "@/lib/control-plane/admin-data.ts";
import { costSectionNumbers, spendWindowRows } from "@/lib/control-plane/cost-panel.ts";
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { groupWaiting, ownerTypeOf, waitingSummary } from "@/lib/control-plane/decision-queue.ts";
import { splitDecided } from "@/lib/control-plane/decision-receipt.ts";
import { fixQueueView } from "@/lib/control-plane/fix-queue.ts";
import { dispatchHistory } from "@/lib/control-plane/fleet-view.ts";
import type { CommandCentreInput } from "@/lib/control-plane/command-centre.ts";
import { groupIncidents } from "@/lib/control-plane/incident-groups.ts";
import { pulseRevision } from "@/lib/control-plane/live-pulse.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  countClaimsFor,
  decisionCardKind,
  pilotHealthView,
  renderCacheObservation,
  type CountClaim,
  type Held,
  type Measured,
  type OwnerDecisionCard,
  type OwnerSnapshot,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";
import { plainContract, plainOverall } from "@/lib/control-plane/plain-health.ts";
import { count, plainCode, plainText } from "@/lib/control-plane/plain-words.ts";
import { readResearchIntents } from "@/lib/control-plane/research-view.ts";
import { runnerNeeds } from "@/lib/control-plane/runner-plain.ts";
import { runnerStanding } from "@/lib/control-plane/runner-standing.ts";
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";

import { ConsoleNav } from "../console-nav.tsx";
import { GapNote, LevelLegend, QueueForm, Said, When, agoText } from "../console-ui.tsx";
import { LiveRefresh } from "../live-refresh.tsx";
import { RevealTarget } from "../reveal.tsx";
import { NeedsYouLine } from "../status-ui.tsx";
import { DeployFleet } from "./deploy-fleet.tsx";
import { DecisionQueue, type PriorityGroupView, type WaitingCardView } from "./decisions.tsx";
import { CostSection } from "./sections/cost.tsx";
import { DecidedSection, FixQueueSection } from "./sections/decided.tsx";
import { HealthSection, type HealthCardView } from "./sections/health.tsx";
import { ObligationsSection } from "./sections/obligations.tsx";
import { CommandCentre } from "./sections/command-centre.tsx";
import { FleetLoading, FleetSection } from "./sections/fleet.tsx";
import { RunnerSection } from "./sections/runner.tsx";

/**
 * Never statically rendered, never cached.
 *
 * A cached admin page is a stale admin page, and a stale health reading is the
 * thing this whole surface exists to replace. It is also the one page whose
 * output depends on a cookie, so caching it would be a correctness bug before
 * it was a freshness one.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTENT_ROUTE = "/api/admin/research";
const ACTION_ROUTE = "/api/admin/action";
const HERE = "/admin";

function outcomeNote<T>(outcome: ReadOutcome<T>): string | null {
  if (outcome.kind === "HELD") return null;
  return outcome.detail;
}

/** Flatten a published card into what the decision island renders. */
function waitingView(card: OwnerDecisionCard): WaitingCardView {
  const kind = decisionCardKind(card);
  const meta = [
    card.priority,
    card.openedOn ? `opened ${card.openedOn}` : "opened on a date the ledger could not recover",
    card.ageDays === null ? "age unknown" : `${card.ageDays} day${card.ageDays === 1 ? "" : "s"} waiting`,
    card.blockedDescendants === null ? null : `${card.blockedDescendants} waiting behind it`,
  ].filter((s): s is string => s !== null);
  return {
    rowId: card.rowId,
    title: card.title,
    whatIsNeeded: card.whatIsNeeded,
    whyNoMachineCanDecide: card.whyNoMachineCanDecide,
    options: card.options,
    meta: meta.join(" · "),
    priority: card.priority,
    type: ownerTypeOf(card),
    blocker: kind === "BLOCKED_WHILE" ? (card.blocker ?? card.whatIsNeeded) : null,
    checkedThisRun: card.checkedThisRun ?? null,
    ownWords: kind === "DECISION",
  };
}

/* ------------------------------------------------------------------ *
 * THE PAGE
 * ------------------------------------------------------------------ */

export default async function AdminPage() {
  // Read the session only to stamp decisions; middleware already proved it.
  const jar = await cookies();
  const hasSession = jar.has("__Host-wtp-admin");

  // The one console header, shared with State readiness (unified console, 2026-09-04).
  const nav = <ConsoleNav view="pilot-health" currentState={null} states={US_STATES} />;

  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <main className="admin console-page">
        {nav}
        <h1>Pilot health</h1>
        <p className="refusal">
          <strong>We could not ask.</strong> {opened.detail}
        </p>
        <p className="note">
          Nothing below is missing — nothing below has been checked. Those are different facts and this page will not print one as the other.
        </p>
      </main>
    );
  }

  /*
   * ADM-38: the fleet read is not in this round. Measured 2026-09-06 against
   * the live control plane, `readFleetInputs` is 1,225 ms and 6.62 MB — five
   * times everything else here put together — and it used to hold pilot health,
   * the runner, the obligations and the decision queue behind it. It streams in
   * its own component now (`sections/fleet.tsx`), which audits its own numbers.
   */
  const [snapshotOut, heartbeatOut, digestsOut, decisionsOut, cacheOut, intentsOut, fleetSafetyOut] = await Promise.all([
    readSnapshot(opened.repos),
    readHeartbeat(opened.repos),
    readDigests(opened.repos),
    readDecisions(opened.repos),
    readCacheObservation(opened.repos),
    readResearchIntents(opened.repos),
    readFleetSafety(opened.repos),
  ]);

  const snapshot: OwnerSnapshot | null = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const nowIso = new Date().toISOString();
  const intentLog = intentsOut.kind === "HELD" ? intentsOut.value : [];
  const decisions = decisionsOut.kind === "HELD" ? decisionsOut.value : [];
  const candidateNames = snapshot?.candidateNames;

  // The compact, act-on-it projection of pilot health (pure; changes presentation,
  // never the health truth). GREEN/AMBER/RED/UNKNOWN + one reason + three cards.
  const health = pilotHealthView(snapshot, nowIso);
  const plain = health.cards.map((card) => {
    const reading = snapshot?.contracts.find((c) => c.contract === card.contract);
    return reading ? plainContract(card, reading) : null;
  });
  const deployments = dispatchHistory(intentLog);
  const fleetSafety = fleetSafetyOut.kind === "HELD" ? fleetSafetyOut.value.fleetSafety ?? null : null;
  const heartbeat = heartbeatOut.kind === "HELD" ? heartbeatOut.value : null;
  const standing = runnerStanding(heartbeat, intentLog, nowIso, fleetSafety);
  /*
   * The three enforced spend windows, built ONCE from the fleet-safety snapshot
   * and rendered by both the runner card and the Cost section (RULING 103). An
   * unread safety snapshot yields no rows, and the Cost section says the
   * ceilings were not read rather than drawing three zeroes.
   */
  const spendWindows = fleetSafety
    ? spendWindowRows({
        cycleUsd: fleetSafety.cycle.modelUsd,
        operationalNightUsd: fleetSafety.operationalNight.modelUsd,
        rolling24HourUsd: fleetSafety.rolling24Hours.modelUsd,
        ceilings: {
          cycleModelUsd: fleetSafety.bounds.cycleModelUsd,
          operationalNightModelUsd: fleetSafety.bounds.operationalNightModelUsd,
          rolling24HourModelUsd: fleetSafety.bounds.rolling24HourModelUsd,
        },
      })
    : [];

  const cards = snapshot ? snapshot.decisionCards : [];
  const collapsedDecisions = collapseDecisionLog(decisions);

  /*
   * ADM-16: a card with a recorded decision is DECIDED and leaves "waiting on
   * you" at once; what the sync has done since is the receipt on the decided
   * card. ADM-20: queued gaps are their own list.
   */
  const { waiting, decided } = splitDecided(cards, collapsedDecisions);
  const queue = fixQueueView(collapsedDecisions);

  /* ---------------------------------------------------------------- *
   * THE PAGE'S AUDIT OF ITSELF.
   *
   * Built from the values about to be rendered. `numbers` collects every
   * numeric the page emits; `claims` collects every "N of something"
   * headline against the rows that actually exist.
   * ---------------------------------------------------------------- */
  const numbers: RenderedNumber[] = [];
  const push = (label: string, m: Held<Measured>) => {
    if (m.held) {
      numbers.push({ label, value: m.value.value, denominator: m.value.denominator, contract: m.value.contract });
    }
  };
  if (fleetSafety) {
    numbers.push(
      { label: "Fleet requests", value: fleetSafety.cycle.requests, denominator: fleetSafety.bounds.maxProviderRequestsPerCycle, contract: "Public/provider requests admitted this cycle against the hard ceiling." },
      { label: "Fleet payload bytes", value: fleetSafety.cycle.payloadBytes, denominator: fleetSafety.bounds.maxPayloadBytesPerCycle, contract: "Application payload bytes sent and consumed this cycle against the hard ceiling." },
      { label: "Fleet dispatches", value: fleetSafety.cycle.dispatches, denominator: fleetSafety.bounds.maxDispatchesPerCycle, contract: "Fleet work dispatches admitted this cycle against the hard ceiling." },
      { label: "Fleet wall time", value: fleetSafety.cycle.elapsedMs, denominator: fleetSafety.bounds.maxWallMsPerCycle, contract: "Elapsed Fleet cycle wall time against the hard ceiling." },
    );
    if (fleetSafety.cycle.modelUsd !== null) numbers.push({ label: "Fleet cycle spend", value: fleetSafety.cycle.modelUsd, denominator: fleetSafety.bounds.cycleModelUsd, contract: "Measured model spend admitted in this cycle against its hard ceiling." });
    if (fleetSafety.operationalNight.modelUsd !== null) numbers.push({ label: "Fleet operational-night spend", value: fleetSafety.operationalNight.modelUsd, denominator: fleetSafety.bounds.operationalNightModelUsd, contract: "Measured model spend in the Phoenix operational night against its hard ceiling." });
    if (fleetSafety.rolling24Hours.modelUsd !== null) numbers.push({ label: "Fleet rolling spend", value: fleetSafety.rolling24Hours.modelUsd, denominator: fleetSafety.bounds.rolling24HourModelUsd, contract: "Measured model spend in the rolling 24-hour window against the absolute ceiling." });
  }
  if (snapshot) {
    for (const row of snapshot.obligationsByState) {
      numbers.push({ label: `obligations ${row.state}`, value: row.count.value, denominator: row.count.denominator, contract: row.count.contract });
    }
    for (const row of snapshot.obligationsByProvider) {
      numbers.push({ label: `provider ${row.provider}`, value: row.count.value, denominator: row.count.denominator, contract: row.count.contract });
    }
    push("freshness debt rows", snapshot.freshnessDebtRows);
    push("deterministic share", snapshot.deterministicShare);
    push("cost per verified record", snapshot.costPerVerifiedRecord);
    push("intake items found", snapshot.intakeItemsFound);
    push("intake items processed", snapshot.intakeItemsProcessed);
    push("intake unidentifiable", snapshot.intakeUnidentifiable);
    for (const c of snapshot.costByRole) push(`cost by role ${c.key}`, c.usd);
    for (const c of snapshot.costByModel) push(`cost by model ${c.key}`, c.usd);
    for (const c of snapshot.cacheHitRateByCaller) push(`cache hit rate ${c.callerKey}`, c.hitRate);
    for (const d of snapshot.spendByDay ?? []) {
      numbers.push({
        label: `spend on ${d.day}`,
        value: d.usd,
        denominator: Math.max(snapshot.costSummary?.measuredUsd ?? d.usd, d.usd),
        contract: "measured dollars recorded on this Eastern day, of all measured dollars in the ledger",
      });
    }
  }
  /*
   * The Cost section draws figures of its own — the three windows, the UTC
   * month, the capacity reading. A section that drew numbers outside this list
   * would sit outside the guarantee the whole page rests on, so it declares
   * them and they are audited with the rest.
   */
  numbers.push(...costSectionNumbers({ monthly: snapshot?.monthlySpend ?? null, windows: spendWindows, capacity: snapshot?.costCapacity ?? null }));
  const numberAudit = auditRenderedNumbers(numbers);

  const claims: CountClaim[] = snapshot ? [...countClaimsFor(snapshot)] : [];
  claims.push({ label: "decision cards by kind", stated: cards.length, rendered: waiting.length + decided.filter((d) => d.card !== null).length });
  claims.push({ label: "decided", stated: decided.length, rendered: decided.length });
  claims.push({ label: "fix queue", stated: queue.items.length, rendered: queue.items.length });
  claims.push({ label: "deployments", stated: deployments.length, rendered: deployments.length });
  if (digestsOut.kind === "HELD") {
    claims.push({ label: "digest history", stated: digestsOut.value.length, rendered: digestsOut.value.length });
  }
  const countAudit = checkStatedEqualsRendered(claims);

  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <main className="admin console-page">
        {nav}
        <h1>Pilot health</h1>
        <p className="refusal">
          <strong>This page refused to render its own numbers.</strong>
        </p>
        {!numberAudit.ok && <p className="note">{numberAudit.detail}</p>}
        {!countAudit.ok && <p className="note">{countAudit.detail}</p>}
        <p className="note">
          A number without a denominator, or a headline that disagrees with the rows beneath it, is worse than a blank page: you would act on it.
        </p>
      </main>
    );
  }

  const cacheLine = renderCacheObservation(cacheOut.kind === "HELD" ? cacheOut.value : null);
  const revision = pulseRevision({
    beatAt: heartbeat?.beatAt ?? null,
    snapshotRevision: snapshot ? (snapshot.publishedAt ? Date.parse(snapshot.publishedAt) : null) : null,
    decisionCount: decisions.length,
    researchRevision: fleetSafety ? Date.parse(fleetSafety.cycle.startedAt) : null,
    receiptCount: null,
  });

  const healthCards: readonly HealthCardView[] = health.cards.map((card, i) => {
    const reading = snapshot?.contracts.find((c) => c.contract === card.contract);
    return {
      plain: plain[i] ?? { contract: card.contract, level: card.level, what: "", status: card.headline, why: card.reason, next: "" },
      score: card.denominator.held ? `${card.denominator.value.value} of ${card.denominator.value.denominator}` : null,
      proofAge: card.proofAge,
      instrument: card.reason,
      provenance: reading
        ? `Proof class ${plainCode(reading.proofClass)}; run ${reading.runSha ? reading.runSha.slice(0, 8) : "unrecorded"}${reading.runAt ? ` at ${reading.runAt}` : ""}.`
        : null,
    };
  });

  const priorityGroups: readonly PriorityGroupView[] = groupWaiting(waiting).map((g) => ({
    priority: g.priority,
    count: g.count,
    types: g.types.map((t) => ({ type: t.type, cards: t.cards.map(waitingView) })),
  }));

  /*
   * ADM-C1: the eight questions, answered at the top. Every fact here is either
   * one this page already read, or a NAMED GAP that says which surface would
   * carry it — never a blank and never a zero (§15).
   */
  const stuckIncidents = groupIncidents(snapshot?.incidents ?? []).find((g) => g.key === "NEEDS_YOU")?.incidents.length ?? 0;
  const centre: CommandCentreInput = {
    runner: { state: plainCode(standing.state), level: standing.level, needsYou: runnerNeeds(standing, fleetSafety).needed, action: runnerNeeds(standing, fleetSafety).action },
    code: heartbeat?.codeIdentity
      ? { rawMain: heartbeat.codeIdentity.rawMainSha, executable: heartbeat.codeIdentity.effectiveExecutableSha, verdict: heartbeat.codeIdentity.verdict }
      : null,
    // Read by the shipping surface, not by this page. A gap until it is wired.
    production: null,
    staging: null,
    steward: null,
    /*
     * NOT a reading: promotion to readers is OFF by law until a governed
     * activation session turns it on, and no such session has run (PR #293
     * built the readiness machinery and deliberately left promotion off).
     */
    promotionOn: false,
    openRecordClasses: 0,
    decisionsWaiting: waiting.length,
    stuckIncidents,
    latestReceipt: null,
    receiptGap: "The console's own receipt log has not been read on this page yet.",
  };

  return (
    <main className="admin console-page">
      {nav}
      <div className="console-strip">
        <LiveRefresh renderedAt={nowIso} revision={revision} />
      </div>
      <QueueForm returnTo={HERE} />

      {/* 0 — THE EIGHT QUESTIONS, ANSWERED AT THE TOP (ADM-C1) */}
      <CommandCentre input={centre} />

      {/* 1 — PILOT HEALTH */}
      <HealthSection
        overall={health.overall}
        overallSays={plainOverall(health.overall, plain.filter((p) => p !== null))}
        cards={healthCards}
        publishedAt={snapshot?.publishedAt ?? null}
        publisher={snapshot?.publisher ?? null}
        publishedFromSha={snapshot?.publishedFromSha ?? null}
        snapshotNote={outcomeNote(snapshotOut)}
        intentRoute={INTENT_ROUTE}
        returnTo={HERE}
      />

      {/* 2 — THE FLEET */}
      <h2 id="fleet">The fleet — what the workers are doing</h2>
      <p className="note">
        Five groups, each named for what it does. Counts are read live from the control plane.{" "}
        <a href="/admin/research">The research detail page</a> has every attempt and every number behind these.
      </p>
      <LevelLegend />
      <DeployFleet returnTo={HERE} maxChars={INTENT_NOTE_MAX_CHARS} actionRoute={ACTION_ROUTE} />
      <Suspense fallback={<FleetLoading />}>
        <FleetSection candidateNames={candidateNames} />
      </Suspense>

      <h3>Where you have sent the fleet — {count(deployments.length)}</h3>
      {outcomeNote(intentsOut) && <p className="note">{outcomeNote(intentsOut)}</p>}
      {deployments.length === 0 ? (
        <p className="note">None sent yet. Deploy fleet above records the first.</p>
      ) : (
        <ul className="deployments">
          {deployments.map((d) => (
            <li key={d.intentId}>
              <strong>{d.target}</strong> — sent {agoText(d.requestedAt, nowIso)} by {d.by}.{" "}
              {d.status === "HONORED" ? (
                <span>
                  <span className="state-green">Started</span> {agoText(d.honoredAt, nowIso)}
                  {d.honoredBy ? ` by ${d.honoredBy}` : ""}: <Said text={d.detail} />
                </span>
              ) : (
                <span className="state-amber">
                  Waiting for the runner to look
                  {standing.state === "PAUSED" || standing.state === "SILENT" || standing.state === "NEVER_BEAT"
                    ? ` — the runner is ${standing.headline.toLowerCase()}, so this waits until it runs`
                    : " (it looks once a minute while running)"}
                  .
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 3 — THE RUNNER */}
      <RunnerSection
        standing={standing}
        heartbeat={heartbeat}
        safety={fleetSafety}
        didThisCycle={null}
        heartbeatNote={outcomeNote(heartbeatOut)}
        safetyNote={outcomeNote(fleetSafetyOut)}
        returnTo={HERE}
        intentRoute={INTENT_ROUTE}
        noteMaxChars={INTENT_NOTE_MAX_CHARS}
      />

      {/*
        4 and 5 — WHAT THE SYSTEM OWES, WHY SOME OF IT IS HELD UP, AND THE
        DECISIONS WAITING ON HIM. ONE DESTINATION, because the command centre
        counts them as one thing: "What is blocked?" says `77 decisions and 27
        stuck sources`, and its Open must land somewhere both are visible
        (9.6.26 owner feedback, ACLOSE-6). `RevealTarget` is the anchor that
        card points at; it scrolls here, takes focus, and opens the disclosures
        inside — the stuck-source groups are closed `<details>` and the decision
        queue opens collapsed by design (ADM-31), so arriving is not the same as
        being able to read it.
      */}
      {/* `decisions` and `incidents` are the names other surfaces already use
          for the two halves of this region, so both land here. `receipts` is
          deliberately NOT one of them: that content is the Decided section
          below, and an alias that sent it here would be a wrong answer rather
          than a missing one. */}
      <RevealTarget id="blocked" also={["decisions", "incidents"]}>
        {snapshot && (
          <ObligationsSection
            freshnessDebtRows={snapshot.freshnessDebtRows}
            incidents={snapshot.incidents}
            obligationsByState={snapshot.obligationsByState}
            obligationsByProvider={snapshot.obligationsByProvider}
            candidateNames={candidateNames}
          />
        )}

        {outcomeNote(decisionsOut) && <p className="note">{outcomeNote(decisionsOut)}</p>}
        <DecisionQueue
          groups={priorityGroups}
          total={waiting.length}
          summary={waitingSummary(groupWaiting(waiting))}
          actionRoute={ACTION_ROUTE}
          returnTo={HERE}
          stateVersion={revision}
        />
      </RevealTarget>
      <DecidedSection decided={decided} />
      <FixQueueSection items={queue.items} counts={queue.counts} lastGo={queue.lastGo} returnTo={HERE} />

      {/* 6 — COST */}
      {snapshot && (
        <CostSection
          costSummary={snapshot.costSummary}
          costByRole={snapshot.costByRole}
          costByModel={snapshot.costByModel}
          cacheHitRateByCaller={snapshot.cacheHitRateByCaller}
          deterministicShare={snapshot.deterministicShare}
          costPerVerifiedRecord={snapshot.costPerVerifiedRecord}
          spendByDay={snapshot.spendByDay ?? []}
          spendWindows={spendWindows}
          capacity={snapshot.costCapacity ?? null}
          monthly={snapshot.monthlySpend ?? null}
          subscriptionJobs={null}
          cacheLine={cacheLine}
          cacheNote={outcomeNote(cacheOut)}
          returnTo={HERE}
        />
      )}

      {/* 7 — READER SUITE BY ZIP */}
      <h2 id="reader-suite">Can a reader get a right answer, ZIP by ZIP?</h2>
      <p className="note">
        The reader check asks the live site the questions a resident would ask about a pilot ZIP and scores each answer. This table would show that score
        per ZIP, which is how a ZIP earns the right to be called ready.
      </p>
      {snapshot &&
        (snapshot.zipRows.held ? (
          <ul className="zip-rows">
            {snapshot.zipRows.value.map((row) => (
              <li key={row.zip}>
                <strong>{row.zip}</strong> — {count(row.green)} right, {count(row.red)} wrong, {count(row.notEvaluable)} not scoreable
                {row.failureClasses.length > 0 ? `; ${row.failureClasses.join(", ")}` : ""}.
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">
            <GapNote gap={snapshot.zipRows.gap} where="Reader check · by ZIP" returnTo={HERE} />
          </p>
        ))}

      {/* 8 — OWNER INTAKE */}
      <h2 id="intake">Your feedback folders</h2>
      {snapshot && (
        <>
          <p className="plain">
            {snapshot.intakeFolder.held ? (
              <>
                Your <strong>{snapshot.intakeFolder.value}</strong> folder was picked up
                {snapshot.intakeItemsFound.held && snapshot.intakeItemsProcessed.held ? (
                  <>
                    {" "}
                    — all {count(snapshot.intakeItemsProcessed.value.value)} of {count(snapshot.intakeItemsFound.value.denominator)} files were processed
                    {snapshot.intakeUnidentifiable.held && snapshot.intakeUnidentifiable.value.value > 0
                      ? `, and ${count(snapshot.intakeUnidentifiable.value.value)} could not be identified`
                      : ""}
                    .
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              <GapNote gap={snapshot.intakeFolder.gap} where="Owner intake · folder" returnTo={HERE} />
            )}
          </p>
          <NeedsYouLine needs={{ needed: false }} />
          {outcomeNote(digestsOut) && <p className="note">{outcomeNote(digestsOut)}</p>}
          {digestsOut.kind === "HELD" && digestsOut.value.length > 0 && (
            <p className="plain">
              Last health report <When iso={digestsOut.value[0].writtenAt} /> — nothing in it needs you.
            </p>
          )}
          {digestsOut.kind === "HELD" && digestsOut.value.length > 0 && (
            <details className="status-detail">
              <summary>Technical details — the report the runner wrote</summary>
              <pre className="digest">{digestsOut.value[0].lines.map((l) => plainText(l)).join("\n")}</pre>
            </details>
          )}
        </>
      )}

      <hr />
      <p className="note audit-footer">
        {numbers.length} rendered number(s) checked; each carries a denominator and an interpretation contract. {claims.length} count claim(s) checked;
        every stated number equals its rendered row count. Read at <When iso={nowIso} />.
        {hasSession ? "" : " No admin session cookie was present on this render."}
      </p>
    </main>
  );
}

