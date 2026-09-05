/**
 * **THE OWNER CONTROL CENTRE — PILOT HEALTH AS THE FLEET VIEW.**
 * (Session C final, ITEM H, 2026-09-01; rebuilt for the 9.4.26 admin feedback,
 * ADM-3 through ADM-8.)
 *
 * Reachable only on `ADMIN_ORIGIN`, only with a valid session — both enforced
 * upstream in `middleware.ts`, which returns 404 for this path on the public
 * host and redirects an unauthenticated request to the login page before this
 * component is ever invoked.
 *
 * ## What the page is for, in the owner's words
 *
 * "An area for me to see what all the workers are doing": hunters, detectives,
 * auditors and verifiers — what they are, what they are doing, how many, and
 * where they are deployed — with a button to deploy the fleet, a queue of
 * decisions he can resolve here, a runner line that tells a deliberate pause
 * from a failure, and costs with numbers in them. Plain words first; every
 * instrument's own sentence is one disclosure away, never hidden and never
 * leading.
 *
 * ## Everything here comes from the durable control plane
 *
 * No filesystem read, no Drive mirror, no process table, no agent output.
 * `next.config.ts` documents at length what a `process.cwd()` read does in a
 * Netlify standalone bundle when nobody traced it: returns nothing, the catch
 * returns null, and the surface renders its own gap wording — which is
 * indistinguishable from honest missing data. So the data plane is Postgres
 * and this page reads it: the published owner snapshot for the panels a
 * publisher computes, and the canonical Attempts, WorkItems, RouteTasks and
 * intent log for the fleet, live.
 *
 * ## The page checks itself before it shows anything
 *
 * Two audits run against what is about to be rendered, not against the code
 * that produced it: every number carries a denominator and an interpretation
 * contract, and every stated N equals the number of rows actually rendered.
 * A failure replaces the numbers with a refusal.
 */

import { cookies } from "next/headers";

import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import {
  openControlPlane,
  readCacheObservation,
  readDecisions,
  readDigests,
  readFleetInputs,
  readFleetSafety,
  readHeartbeat,
  readSnapshot,
  type ReadOutcome,
} from "@/lib/control-plane/admin-data.ts";
import { collapseDecisionLog, latestDecisionFor } from "@/lib/control-plane/decision-log.ts";
import {
  buildFleetView,
  dispatchHistory,
  fleetRenderedNumbers,
  type FleetGroupView,
} from "@/lib/control-plane/fleet-view.ts";
import {
  ANSWERED_IN_OWN_WORDS,
  OWNER_ANSWER_MAX_CHARS,
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
  type OwnerDecisionIntent,
  type OwnerSnapshot,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";
import { plainContract, plainOverall } from "@/lib/control-plane/plain-health.ts";
import { readResearchIntents } from "@/lib/control-plane/research-view.ts";
import { runnerStanding } from "@/lib/control-plane/runner-standing.ts";
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";

import { ConsoleNav } from "../console-nav.tsx";
import { Band, GapNote, HealthScale, HeldNum, Num, Tile, agoText, usd } from "../console-ui.tsx";
import { DeployFleet } from "./deploy-fleet.tsx";

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
const DECISION_ROUTE = "/api/admin/decision";
const HERE = "/admin";

function outcomeNote<T>(outcome: ReadOutcome<T>): string | null {
  return outcome.kind === "HELD" ? null : outcome.detail;
}

/* ------------------------------------------------------------------ *
 * THE FLEET
 * ------------------------------------------------------------------ */

function FleetGroupCard({ group, nowIso }: { group: FleetGroupView; nowIso: string }) {
  return (
    <section className="fleet-card" aria-labelledby={`fleet-${group.key}`}>
      <h3 id={`fleet-${group.key}`}>
        {group.name} <span className="fleet-roles">{group.roles.join(" · ")}</span>
      </h3>
      <p className="fleet-what">{group.what}</p>
      <div className="fleet-nums">
        <Tile figure={String(group.working.value)} caption={`working now of ${group.working.denominator} recorded`} />
        <Tile figure={String(group.queued.value)} caption={`waiting of ${group.queued.denominator} registered`} />
        <Tile figure={String(group.completed.value)} caption={`finished of ${group.completed.denominator} recorded`} />
      </div>
      <p className="fleet-doing">{group.doing}</p>
      <p className="fleet-where">
        <strong>Deployed in:</strong>{" "}
        {group.deployedAt.length === 0 ? (
          <span className="gap">nowhere yet — no Attempt on record for these roles</span>
        ) : (
          group.deployedAt.map((d) => (
            <span key={d.label} className="where" title={`${d.attempts} attempt(s)`}>
              {d.label} · {d.attempts}
            </span>
          ))
        )}
      </p>
      {group.latest.length > 0 && (
        <ul className="fleet-latest">
          {group.latest.map((l) => (
            <li key={`${l.role}:${l.at}:${l.subject}`}>
              {agoText(l.at, nowIso)} · {l.role} · {l.subject}
              {l.where ? ` (${l.where})` : ""} — {l.outcome}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * THE DECISION QUEUE
 * ------------------------------------------------------------------ */

function decidedSentence(d: OwnerDecisionIntent): string {
  const what =
    d.chosenOption === ANSWERED_IN_OWN_WORDS
      ? `you answered: "${d.ownerAnswer ?? ""}"`
      : `you chose "${d.chosenOption}"${d.ownerAnswer ? ` and wrote: "${d.ownerAnswer}"` : ""}`;
  const became =
    d.state === "CANONICALIZED"
      ? `applied${d.canonicalRef ? ` as ${d.canonicalRef}` : ""}`
      : d.state === "REJECTED_BY_GATES"
        ? `refused by the gates${d.refusedReason ? `: ${d.refusedReason}` : ""}`
        : "recorded here; it reaches the tracker at the next sync and this card leaves the queue then";
  return `Decided ${d.decidedAt.slice(0, 16).replace("T", " ")}: ${what} — ${became}.`;
}

function DecisionCard({
  card,
  decided,
}: {
  card: OwnerDecisionCard;
  decided: OwnerDecisionIntent | null;
}) {
  const kind = decisionCardKind(card);
  const meta = [
    card.priority,
    card.openedOn ? `opened ${card.openedOn}` : "opened on a date the ledger could not recover",
    card.ageDays === null ? "age unknown" : `${card.ageDays} day${card.ageDays === 1 ? "" : "s"} waiting`,
    card.blockedDescendants === null ? null : `${card.blockedDescendants} waiting behind it`,
  ].filter((s): s is string => s !== null);
  return (
    <section className={`queue-card ${kind.toLowerCase().replace("_", "-")}`} id={`row-${card.rowId}`}>
      <div className="queue-head">
        <span className="queue-id">{card.rowId}</span>
        <h3>{card.title}</h3>
        <span className="chip">
          {kind === "DECISION" ? "your call" : kind === "ACKNOWLEDGE" ? "read and acknowledge" : "blocked while"}
        </span>
      </div>
      <p className="queue-meta">{meta.join(" · ")}</p>

      {kind === "BLOCKED_WHILE" ? (
        <>
          <p>
            <strong>Blocked while</strong> {card.blocker ?? card.whatIsNeeded}
          </p>
          <p className="note">
            {card.checkedThisRun
              ? `Rechecked on the last tracker generation: ${card.checkedThisRun}`
              : "No recheck was recorded on the last tracker generation."}{" "}
            This clears itself the moment the blocker stops being true; it is not a decision.
          </p>
        </>
      ) : (
        <>
          <p>
            <strong>What is needed:</strong> {card.whatIsNeeded}
          </p>
          <details>
            <summary>Why no machine can decide it</summary>
            <p>{card.whyNoMachineCanDecide}</p>
          </details>
        </>
      )}

      {decided ? (
        <p className="decided">{decidedSentence(decided)}</p>
      ) : kind === "BLOCKED_WHILE" ? null : (
        <div className="options">
          {card.options.map((o) => (
            <form method="post" action={DECISION_ROUTE} key={o.option}>
              <input type="hidden" name="subjectId" value={card.rowId} />
              <input type="hidden" name="chosenOption" value={o.option} />
              <input type="hidden" name="consequenceShown" value={o.consequence} />
              <button type="submit">
                {o.option}
                <span className="consequence">{o.consequence}</span>
              </button>
            </form>
          ))}
          {kind === "DECISION" && (
            <form method="post" action={DECISION_ROUTE} className="own-words">
              <input type="hidden" name="subjectId" value={card.rowId} />
              <label>
                Or answer in your own words
                <textarea name="ownerAnswer" maxLength={OWNER_ANSWER_MAX_CHARS} />
              </label>
              <button type="submit" className="primary">
                Record my answer
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
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
          Nothing below is missing — nothing below has been checked. Those are different facts and
          this page will not print one as the other.
        </p>
      </main>
    );
  }

  const [snapshotOut, heartbeatOut, digestsOut, decisionsOut, cacheOut, intentsOut, fleetOut, fleetSafetyOut] =
    await Promise.all([
      readSnapshot(opened.repos),
      readHeartbeat(opened.repos),
      readDigests(opened.repos),
      readDecisions(opened.repos),
      readCacheObservation(opened.repos),
      readResearchIntents(opened.repos),
      readFleetInputs(opened.repos),
      readFleetSafety(opened.repos),
    ]);

  const snapshot: OwnerSnapshot | null = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const nowIso = new Date().toISOString();
  const intentLog = intentsOut.kind === "HELD" ? intentsOut.value : [];
  const decisions = decisionsOut.kind === "HELD" ? decisionsOut.value : [];

  // The compact, act-on-it projection of pilot health (pure; changes presentation,
  // never the health truth). GREEN/AMBER/RED/UNKNOWN + one reason + three cards.
  const health = pilotHealthView(snapshot, nowIso);
  const plain = health.cards.map((card) => {
    const reading = snapshot?.contracts.find((c) => c.contract === card.contract);
    return reading ? plainContract(card, reading) : null;
  });
  const fleet = fleetOut.kind === "HELD" ? buildFleetView({ nowIso, ...fleetOut.value }) : null;
  const deployments = dispatchHistory(intentLog);
  const fleetSafety = fleetSafetyOut.kind === "HELD" ? fleetSafetyOut.value.fleetSafety ?? null : null;
  const standing = runnerStanding(heartbeatOut.kind === "HELD" ? heartbeatOut.value : null, intentLog, nowIso, fleetSafety);
  const cards = snapshot ? snapshot.decisionCards : [];
  const decisionCards = cards.filter((c) => decisionCardKind(c) === "DECISION");
  const acknowledgeCards = cards.filter((c) => decisionCardKind(c) === "ACKNOWLEDGE");
  const blockedCards = cards.filter((c) => decisionCardKind(c) === "BLOCKED_WHILE");
  const collapsedDecisions = collapseDecisionLog(decisions);

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
      numbers.push({
        label,
        value: m.value.value,
        denominator: m.value.denominator,
        contract: m.value.contract,
      });
    }
  };
  if (fleet) {
    for (const m of fleetRenderedNumbers(fleet)) {
      numbers.push({ label: "fleet", value: m.value, denominator: m.denominator, contract: m.contract });
    }
  }
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
  }
  const numberAudit = auditRenderedNumbers(numbers);

  const claims: CountClaim[] = snapshot ? [...countClaimsFor(snapshot)] : [];
  claims.push({
    label: "decision cards by kind",
    stated: cards.length,
    rendered: decisionCards.length + acknowledgeCards.length + blockedCards.length,
  });
  if (fleet) claims.push({ label: "fleet groups", stated: 5, rendered: fleet.groups.length });
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
          A number without a denominator, or a headline that disagrees with the rows beneath it, is
          worse than a blank page: you would act on it.
        </p>
      </main>
    );
  }

  const cacheLine = renderCacheObservation(cacheOut.kind === "HELD" ? cacheOut.value : null);
  const heartbeat = heartbeatOut.kind === "HELD" ? heartbeatOut.value : null;
  const costSummary = snapshot?.costSummary;

  return (
    <main className="admin console-page">
      {nav}

      {/* 1 — PILOT HEALTH, plain, with the scale */}
      <h1>
        Pilot health{" "}
        <Band level={health.overall}>{health.overall === "UNKNOWN" ? "NO READING" : health.overall}</Band>
      </h1>
      <HealthScale />
      <p className="plain">{plainOverall(health.overall, plain.filter((p) => p !== null))}</p>
      {outcomeNote(snapshotOut) && <p className="note">{outcomeNote(snapshotOut)}</p>}
      {snapshot && (
        <>
          <div className="ph-cards">
            {health.cards.map((card, i) => {
              const p = plain[i];
              const reading = snapshot.contracts.find((c) => c.contract === card.contract);
              return (
                <div className={`ph-card ph-l-${card.level}`} key={card.contract}>
                  <h3>
                    {card.contract}
                    <span className="ph-chip">{card.headline}</span>
                  </h3>
                  {p && (
                    <>
                      <p className="ph-reason">
                        <strong>{p.status}</strong> {p.why}
                      </p>
                      <p className="ph-next">
                        <strong>Next:</strong> {p.next}
                      </p>
                      <p className="ph-meta">{p.what}</p>
                    </>
                  )}
                  <p className="ph-meta">
                    {card.proofAge}
                    {card.denominator.held && ` · ${card.denominator.value.value} of ${card.denominator.value.denominator}`}
                  </p>
                  <details className="ph-evidence">
                    <summary>Instrument detail</summary>
                    <p className="note">{card.reason}</p>
                    {reading && (
                      <p className="note">
                        Proof class {reading.proofClass}; run {reading.runSha ? reading.runSha.slice(0, 8) : "unrecorded"}{" "}
                        {reading.runAt ? `at ${reading.runAt}` : ""}.{" "}
                        {reading.denominator.held ? (
                          <>
                            Denominator: <Num m={reading.denominator.value} />.
                          </>
                        ) : (
                          <GapNote gap={reading.denominator.gap} />
                        )}
                      </p>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
          <p className="note">
            Published {snapshot.publishedAt} by {snapshot.publisher}
            {snapshot.publishedFromSha ? ` at ${snapshot.publishedFromSha.slice(0, 8)}` : ""}. The runner
            republishes this after every cycle while it is running.
          </p>
        </>
      )}

      {/* 2 — THE FLEET */}
      <h2>The fleet — what the workers are doing</h2>
      <p className="note">
        Hunters are the Scout and Acquirer workers; Detectives are the Detective and Parser
        workers; Verifiers are Validators; Auditors are the adversarial auditors; Engineers are
        their own line. Counts are read live from the control plane.{" "}
        <a href="/admin/research">Instrument detail</a> has every Attempt and every number behind
        these.
      </p>
      <DeployFleet returnTo={HERE} maxChars={INTENT_NOTE_MAX_CHARS} />
      {fleet ? (
        <>
          <p className="plain">
            {fleet.workingNow === 0
              ? "Nothing is working right now."
              : `${fleet.workingNow} attempt${fleet.workingNow === 1 ? "" : "s"} open right now.`}{" "}
            {fleet.totalAttempts} attempt{fleet.totalAttempts === 1 ? "" : "s"} on record across every role
            {fleet.unassignedAttempts > 0
              ? `, ${fleet.unassignedAttempts} under a role none of the five groups names`
              : ""}
            .
          </p>
          <div className="fleet">
            {fleet.groups.map((g) => (
              <FleetGroupCard key={g.key} group={g} nowIso={nowIso} />
            ))}
          </div>
        </>
      ) : (
        <p className="refusal">
          <strong>The fleet could not be read.</strong> {outcomeNote(fleetOut)}
        </p>
      )}

      <h3>Deployments — {deployments.length}</h3>
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
                  <span className="state-green">Dispatched</span> {agoText(d.honoredAt, nowIso)}
                  {d.honoredBy ? ` by ${d.honoredBy}` : ""}: {d.detail}
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
      <h2>Runner</h2>
      <div className={`runner-card l-${standing.level}`}>
        <p>
          <Band level={standing.level}>{standing.headline}</Band>
        </p>
        <p>{standing.detail}</p>
        {outcomeNote(heartbeatOut) && <p className="note">{outcomeNote(heartbeatOut)}</p>}
        {heartbeat && (
          <p className="note">
            Last cycle {heartbeat.lastCycleStartedAt ?? "—"} → {heartbeat.lastCycleFinishedAt ?? "—"}; next due{" "}
            {/*
              NOT "not scheduled". A null `nextCycleDueAt` means the runner did
              not RECORD a next-due time, and the runner not recording one is not
              evidence that nothing is scheduled.
            */}
            {heartbeat.nextCycleDueAt ?? "not recorded in this heartbeat"}; at SHA{" "}
            {heartbeat.testedSha ? heartbeat.testedSha.slice(0, 8) : "unrecorded"}; host {heartbeat.host}.
          </p>
        )}
        {fleetSafety ? (
          <div className="note">
            <p>
              <strong>Fleet safety state: {standing.state}</strong>
            </p>
            <p>
              Model spend — cycle {fleetSafety.cycle.modelUsd === null ? "UNMEASURED" : usd(fleetSafety.cycle.modelUsd)} of {usd(fleetSafety.bounds.cycleModelUsd)}; operational night{" "}
              {fleetSafety.operationalNight.modelUsd === null ? "UNMEASURED" : usd(fleetSafety.operationalNight.modelUsd)} of {usd(fleetSafety.bounds.operationalNightModelUsd)}; rolling 24 hours{" "}
              {fleetSafety.rolling24Hours.modelUsd === null ? "UNMEASURED" : usd(fleetSafety.rolling24Hours.modelUsd)} of {usd(fleetSafety.bounds.rolling24HourModelUsd)}.
            </p>
            <p>
              Requests {fleetSafety.cycle.requests} of {fleetSafety.bounds.maxProviderRequestsPerCycle}; payload bytes{" "}
              {fleetSafety.cycle.payloadBytes} of {fleetSafety.bounds.maxPayloadBytesPerCycle}; work dispatched{" "}
              {fleetSafety.cycle.dispatches} of {fleetSafety.bounds.maxDispatchesPerCycle}; wall time{" "}
              {fleetSafety.cycle.elapsedMs} ms of {fleetSafety.bounds.maxWallMsPerCycle} ms.
            </p>
            <p>
              Last successful Fleet activity: {fleetSafety.lastSuccessfulActivity === null ? "not recorded by Fleet yet" : fleetSafety.lastSuccessfulActivity}. Current runner heartbeat: {heartbeat === null ? "not recorded by the runner yet" : heartbeat.beatAt}.
            </p>
            <p>Why work stopped: {fleetSafety.stoppedBecause.length === 0 ? "no stop reason recorded for this cycle" : fleetSafety.stoppedBecause.join("; ")}.</p>
            <p>
              Provider circuit breakers:{" "}
              {fleetSafety.providerCircuits.length === 0
                ? "none"
                : fleetSafety.providerCircuits.map((c) => `${c.provider} — ${c.condition}; first observed ${c.firstObservedAt}; eligible ${c.eligibleAt}`).join("; ")}.
            </p>
            {fleetSafety.deferred.length > 0 && (
              <details>
                <summary>Deferred by name — {fleetSafety.deferred.length}</summary>
                <ul>
                  {fleetSafety.deferred.map((d) => (
                    <li key={`${d.work}:${d.code}`}>
                      <code>{d.work}</code> — {d.code}: {d.why}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p>Promotion: <strong>OFF</strong>.</p>
          </div>
        ) : (
          <p className="note">Fleet safety state is not recorded. {outcomeNote(fleetSafetyOut)}</p>
        )}
        {standing.control === "PAUSE_RUNNER" ? (
          <form method="post" action={INTENT_ROUTE}>
            <input type="hidden" name="action" value="PAUSE_RUNNER" />
            <input type="hidden" name="returnTo" value={HERE} />
            <input type="text" name="note" maxLength={INTENT_NOTE_MAX_CHARS} placeholder="Why it is paused (optional)" aria-label="Why the runner is paused" />
            <button type="submit" className="primary">
              Record that I paused the runner
            </button>
          </form>
        ) : (
          <form method="post" action={INTENT_ROUTE}>
            <input type="hidden" name="action" value="RESUME_RUNNER" />
            <input type="hidden" name="returnTo" value={HERE} />
            <button type="submit" className="primary">
              Resume the runner
            </button>
            <span className="note">
              If the scheduled task is disabled, run <code>pnpm pilot:start</code> on the runner machine too.
            </span>
          </form>
        )}
      </div>
      {snapshot && (
        <div className="rq-summary">
          <Tile
            figure={snapshot.freshnessDebtRows.held ? String(snapshot.freshnessDebtRows.value.value) : "—"}
            caption={
              snapshot.freshnessDebtRows.held
                ? `units carrying freshness debt of ${snapshot.freshnessDebtRows.value.denominator} registered`
                : "freshness debt"
            }
            held={snapshot.freshnessDebtRows}
          />
          <Tile figure={String(snapshot.incidents.length)} caption="open incidents by root cause" />
          <Tile
            figure={String(snapshot.obligationsByState.reduce((n, r) => n + r.count.value, 0))}
            caption="standing obligations in the control plane"
          />
        </div>
      )}
      {snapshot && snapshot.obligationsByState.length > 0 && (
        <>
          <h3>Obligations by state</h3>
          <p className="fleet-where">
            {snapshot.obligationsByState.map((r) => (
              <span key={r.state} className="where" title={r.count.contract}>
                {r.state} · {r.count.value} of {r.count.denominator}
              </span>
            ))}
          </p>
        </>
      )}
      {snapshot && snapshot.obligationsByProvider.length > 0 && (
        <>
          <h3>Obligations by provider</h3>
          <p className="fleet-where">
            {snapshot.obligationsByProvider.map((r) => (
              <span key={r.provider} className="where" title={r.count.contract}>
                {r.provider} · {r.count.value} of {r.count.denominator}
              </span>
            ))}
          </p>
        </>
      )}
      {snapshot && (
        <details className="ph-evidence">
          <summary>Incidents — {snapshot.incidents.length}</summary>
          <ul>
            {snapshot.incidents.map((i) => (
              <li key={`${i.cause}:${i.target}`}>
                {i.cause} at {i.target} — {i.obligationsAffected} obligation(s),
                {i.oldestHours === null ? " age unknown" : ` oldest ${Math.round(i.oldestHours)} h`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 4 — DECISIONS */}
      <h2>Decisions waiting on you — {cards.length}</h2>
      <p className="note">
        {decisionCards.length} need a decision, {acknowledgeCards.length} need only a read, and{" "}
        {blockedCards.length} are machine-checked walls. Pick an option or answer in your own words;
        the answer is recorded here at once and carried into the tracker at the next sync, where the
        row closes and the work it implies is opened for a session.
      </p>
      {outcomeNote(decisionsOut) && <p className="note">{outcomeNote(decisionsOut)}</p>}
      {decisionCards.map((card) => (
        <DecisionCard key={card.rowId} card={card} decided={latestDecisionFor(decisions, card.rowId)} />
      ))}
      {acknowledgeCards.length > 0 && (
        <>
          <h3>For your information — {acknowledgeCards.length}</h3>
          {acknowledgeCards.map((card) => (
            <DecisionCard key={card.rowId} card={card} decided={latestDecisionFor(decisions, card.rowId)} />
          ))}
        </>
      )}
      {blockedCards.length > 0 && (
        <>
          <h3>Blocked while — {blockedCards.length}</h3>
          {blockedCards.map((card) => (
            <DecisionCard key={card.rowId} card={card} decided={null} />
          ))}
        </>
      )}
      {collapsedDecisions.length > 0 && (
        <details className="ph-evidence">
          <summary>Decisions recorded — {collapsedDecisions.length}</summary>
          <ul>
            {collapsedDecisions.map((d) => (
              <li key={d.intentId}>
                {d.subjectId} · {decidedSentence(d)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 5 — COST */}
      <h2>Cost</h2>
      {snapshot && (
        <>
          <p className="cost-summary">
            {costSummary ? (
              costSummary.measuredUsd === null ? (
                <span>
                  {costSummary.entries} attempt{costSummary.entries === 1 ? "" : "s"} in the ledger; none reported a dollar cost.
                </span>
              ) : (
                <span>
                  <strong>{usd(costSummary.measuredUsd)}</strong> measured across {costSummary.attemptsMeasured} attempt
                  {costSummary.attemptsMeasured === 1 ? "" : "s"}; {costSummary.attemptsUnmeasured} more reported no cost
                  (deterministic work, not free by assumption).
                </span>
              )
            ) : (
              <span className="gap">This snapshot predates the cost ledger read; republish to see totals.</span>
            )}
          </p>
          <table className="cost">
            <thead>
              <tr>
                <th>By caller role</th>
                <th className="n">Spend</th>
                <th className="n">Attempts measured / not</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.costByRole.length === 0 && (
                <tr>
                  <td colSpan={3} className="gap">not read — republish the snapshot to fill this table.</td>
                </tr>
              )}
              {snapshot.costByRole.map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td>
                  <td className="n">
                    <HeldNum h={c.usd} format={usd} />
                  </td>
                  <td className="n">
                    {c.attemptsMeasured ?? "—"} / {c.attemptsUnmeasured ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="cost">
            <thead>
              <tr>
                <th>By model</th>
                <th className="n">Spend</th>
                <th className="n">Attempts measured / not</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.costByModel.length === 0 && (
                <tr>
                  <td colSpan={3} className="gap">not read — republish the snapshot to fill this table.</td>
                </tr>
              )}
              {snapshot.costByModel.map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td>
                  <td className="n">
                    <HeldNum h={c.usd} format={usd} />
                  </td>
                  <td className="n">
                    {c.attemptsMeasured ?? "—"} / {c.attemptsUnmeasured ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="cost">
            <thead>
              <tr>
                <th>Cache hit rate by caller</th>
                <th className="n">Cached input tokens of all input tokens</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.cacheHitRateByCaller.map((c) => (
                <tr key={c.callerKey}>
                  <td>{c.callerKey}</td>
                  <td className="n">
                    <HeldNum h={c.hitRate} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Deterministic share of dispatches</td>
                <td className="n">
                  <HeldNum h={snapshot.deterministicShare} />
                </td>
              </tr>
              <tr>
                <td>Cost per verified record</td>
                <td className="n">
                  {snapshot.costPerVerifiedRecord.held ? (
                    <span title={snapshot.costPerVerifiedRecord.value.contract}>
                      <strong>{usd(snapshot.costPerVerifiedRecord.value.value)}</strong>
                      <span className="denom"> per record over {snapshot.costPerVerifiedRecord.value.denominator} verified</span>
                    </span>
                  ) : (
                    <GapNote gap={snapshot.costPerVerifiedRecord.gap} />
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {/*
        THE H1 WAIVER'S STANDING CHECK (owner, 2026-09-01). Three states, and
        the third one is why this is not a boolean: "not yet observed" is a
        claim about our RECORD, and it is only honest if the recording path is
        wired. If it is not, we have observed nothing — not an absence.
      */}
      <p className={`note ${cacheLine.state === "OBSERVED" ? "state-green" : ""}`}>{cacheLine.says}</p>
      {outcomeNote(cacheOut) && <p className="note">{outcomeNote(cacheOut)}</p>}

      {/* 6 — READER SUITE BY ZIP */}
      <h2>
        Reader suite by ZIP —{" "}
        {snapshot && snapshot.zipRows.held ? `${snapshot.zipRows.value.length} ZIP(s)` : "no grid"}
      </h2>
      {snapshot && !snapshot.zipRows.held && (
        <p>
          <GapNote gap={snapshot.zipRows.gap} />
        </p>
      )}
      {snapshot?.zipRows.held && (
        <table>
          <thead>
            <tr>
              <th>ZIP</th>
              <th>Green</th>
              <th>Red</th>
              <th>Not evaluable</th>
              <th>Failure classes</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.zipRows.value.map((z) => (
              <tr key={z.zip}>
                <td>{z.zip}</td>
                <td className="state-green">{z.green}</td>
                <td className="state-red">{z.red}</td>
                <td>{z.notEvaluable}</td>
                <td>{z.failureClasses.length === 0 ? "—" : z.failureClasses.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 7 — OWNER INTAKE AND THE DIGEST */}
      <h2>Owner intake</h2>
      {snapshot && (
        <p>
          Latest folder swept:{" "}
          {snapshot.intakeFolder.held ? <code>{snapshot.intakeFolder.value}</code> : <GapNote gap={snapshot.intakeFolder.gap} />}
          {" · found "}
          <HeldNum h={snapshot.intakeItemsFound} />
          {" · processed "}
          <HeldNum h={snapshot.intakeItemsProcessed} />
          {" · unidentifiable "}
          <HeldNum h={snapshot.intakeUnidentifiable} />
        </p>
      )}
      {outcomeNote(digestsOut) && <p className="note">{outcomeNote(digestsOut)}</p>}
      {digestsOut.kind === "HELD" && digestsOut.value[0] && (
        <details className="ph-evidence">
          <summary>
            Latest digest — {digestsOut.value[0].headline}, written {digestsOut.value[0].writtenAt} ·{" "}
            {digestsOut.value.length} recorded
          </summary>
          <pre>{digestsOut.value[0].lines.join("\n")}</pre>
          <ul>
            {digestsOut.value.map((d) => (
              <li key={d.digestId}>
                {d.writtenAt} — {d.headline}
              </li>
            ))}
          </ul>
        </details>
      )}

      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail} Read at {nowIso}.
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
