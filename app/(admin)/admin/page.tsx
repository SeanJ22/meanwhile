/**
 * **THE OWNER CONTROL CENTRE — PILOT HEALTH AS THE FLEET VIEW.**
 * (Session C final, ITEM H, 2026-09-01; rebuilt for the 9.4.26 admin feedback,
 * ADM-3 through ADM-8; the evening pass, ADM-12/16/17/18/19/20/22, 2026-09-05.)
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
 * ## The evening pass: the page acts, and shows what happened
 *
 * A decision he records leaves "waiting on you" AT ONCE and moves to a
 * decided list carrying a three-step receipt — recorded, closed in the
 * tracker, work opened — each step's state read live from the decision log
 * (ADM-16). Every gap carries "Add this to the queue", and the queue has a
 * "Go fix these" (ADM-20). Keys render as names (ADM-12), stamps as Eastern
 * time (ADM-22), and a gap is "not measured", with no possessive on it (ADM-19).
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
  readHeartbeat,
  readSnapshot,
  type ReadOutcome,
} from "@/lib/control-plane/admin-data.ts";
import { bytesText, costRowKind, durationText } from "@/lib/control-plane/cost-panel.ts";
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { SYNC_CADENCE, receiptHeadline, splitDecided, type DecidedEntry } from "@/lib/control-plane/decision-receipt.ts";
import { EASTERN_ZONE } from "@/lib/control-plane/eastern-time.ts";
import { FIX_QUEUE_SUBJECT, GO_FIX_OPTION, fixQueueView, type FixQueueItem } from "@/lib/control-plane/fix-queue.ts";
import {
  buildFleetView,
  dispatchHistory,
  fleetRenderedNumbers,
  type FleetGroupView,
} from "@/lib/control-plane/fleet-view.ts";
import {
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
  type OwnerSnapshot,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";
import { plainContract, plainOverall } from "@/lib/control-plane/plain-health.ts";
import { readResearchIntents } from "@/lib/control-plane/research-view.ts";
import { runnerStanding } from "@/lib/control-plane/runner-standing.ts";
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";

import { BarChart, DayBars, Ring } from "../charts.tsx";
import { ConsoleNav } from "../console-nav.tsx";
import {
  Band,
  DECISION_ROUTE,
  GapNote,
  HealthScale,
  HeldNum,
  LevelLegend,
  Name,
  Num,
  QueueButton,
  QueueForm,
  Said,
  Tile,
  When,
  agoText,
  usd,
  usdShort,
} from "../console-ui.tsx";
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
const HERE = "/admin";

function outcomeNote<T>(outcome: ReadOutcome<T>): string | null {
  return outcome.kind === "HELD" ? null : outcome.detail;
}

/* ------------------------------------------------------------------ *
 * THE FLEET
 * ------------------------------------------------------------------ */

function FleetGroupCard({
  group,
  nowIso,
  candidateNames,
}: {
  group: FleetGroupView;
  nowIso: string;
  candidateNames: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <section className="fleet-card card" aria-labelledby={`fleet-${group.key}`}>
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
            <span key={d.label} className="where-wrap" title={`${d.attempts} attempt(s)`}>
              <Name raw={d.label} candidateNames={candidateNames} short pill />
              <span className="where-count">{d.attempts}</span>
            </span>
          ))
        )}
      </p>
      {group.latest.length > 0 && (
        <ul className="fleet-latest">
          {group.latest.map((l) => (
            <li key={`${l.role}:${l.at}:${l.subject}`}>
              {agoText(l.at, nowIso)} · {l.role} · <Name raw={l.subject} candidateNames={candidateNames} /> —{" "}
              <span className={`outcome outcome-${l.outcome.toLowerCase()}`}>{l.outcome.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Attempts started per Eastern day over the trailing fortnight, from the live Attempts. */
function attemptsByDay(attempts: readonly { readonly startedAt: string }[], nowIso: string): { label: string; day: string; value: number }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const short = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric" });
  const now = Date.parse(nowIso);
  const days: { label: string; day: string; value: number }[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const at = new Date(now - i * 86_400_000);
    days.push({ day: fmt.format(at), label: short.format(at), value: 0 });
  }
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const a of attempts) {
    const t = Date.parse(a.startedAt);
    if (!Number.isFinite(t)) continue;
    const hit = byDay.get(fmt.format(new Date(t)));
    if (hit) hit.value += 1;
  }
  return days;
}

/* ------------------------------------------------------------------ *
 * THE DECISION QUEUE
 * ------------------------------------------------------------------ */

function DecisionCard({ card }: { card: OwnerDecisionCard }) {
  const kind = decisionCardKind(card);
  const meta = [
    card.priority,
    card.openedOn ? `opened ${card.openedOn}` : "opened on a date the ledger could not recover",
    card.ageDays === null ? "age unknown" : `${card.ageDays} day${card.ageDays === 1 ? "" : "s"} waiting`,
    card.blockedDescendants === null ? null : `${card.blockedDescendants} waiting behind it`,
  ].filter((s): s is string => s !== null);
  return (
    <section className={`queue-card card ${kind.toLowerCase().replace("_", "-")}`} id={`row-${card.rowId}`}>
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
          <div className="options">
            {card.options.map((o) => (
              <form method="post" action={DECISION_ROUTE} key={o.option}>
                <input type="hidden" name="subjectId" value={card.rowId} />
                <input type="hidden" name="chosenOption" value={o.option} />
                <input type="hidden" name="consequenceShown" value={o.consequence} />
                <input type="hidden" name="returnTo" value={HERE} />
                <button type="submit" className="option">
                  {o.option}
                  <span className="consequence">{o.consequence}</span>
                </button>
              </form>
            ))}
            {kind === "DECISION" && (
              <form method="post" action={DECISION_ROUTE} className="own-words">
                <input type="hidden" name="subjectId" value={card.rowId} />
                <input type="hidden" name="returnTo" value={HERE} />
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
        </>
      )}
    </section>
  );
}

/** A decided row: the receipt the owner asked for — recorded, in the tracker, work opened. */
function DecidedCard({ entry }: { entry: DecidedEntry }) {
  const { card, decision, steps } = entry;
  const title = card?.title ?? decision.subjectTitle ?? decision.subjectId;
  return (
    <section className="queue-card card decided-card" id={`row-${decision.subjectId}`}>
      <div className="queue-head">
        <span className="queue-id">{decision.subjectId}</span>
        <h3>{title}</h3>
        <span className={`chip receipt-${steps.every((s) => s.state === "DONE") ? "done" : steps.some((s) => s.state === "REFUSED") ? "refused" : "waiting"}`}>
          {receiptHeadline(steps)}
        </span>
      </div>
      <p className="queue-meta">
        Decided <When iso={decision.decidedAt} />
        {card ? ` · ${card.priority}` : ""}
      </p>
      <ol className="receipt">
        {steps.map((s) => (
          <li key={s.key} className={`receipt-step step-${s.state.toLowerCase()}`}>
            <i className="receipt-mark" aria-hidden="true" />
            <span>
              <strong>{s.label}</strong> — {s.says}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FixQueue({ items, counts, lastGo }: { items: readonly FixQueueItem[]; counts: ReturnType<typeof fixQueueView>["counts"]; lastGo: ReturnType<typeof fixQueueView>["lastGo"] }) {
  const stateWords: Record<FixQueueItem["state"], string> = {
    QUEUED: "queued — waiting for you to send the queue",
    SENT: "sent — a tracker row opens at the next sync",
    OPENED: "opened for a session",
    REFUSED: "refused by the sync",
  };
  return (
    <section className="fix-queue card" id="fix-queue" aria-labelledby="fix-queue-heading">
      <div className="queue-head">
        <h3 id="fix-queue-heading">Fix queue — {items.length}</h3>
        <span className="chip">
          {counts.queued} queued · {counts.sent} sent · {counts.opened} opened{counts.refused > 0 ? ` · ${counts.refused} refused` : ""}
        </span>
      </div>
      <p className="note">
        Every gap on the console carries <em>Add this to the queue</em>. <strong>Go fix these</strong> sends
        everything queued: the next sync opens one tracker row per gap, in the section a session works
        from, and each row is listed here once it exists.{" "}
        {lastGo ? (
          <>
            Last sent <When iso={lastGo.decidedAt} />.
          </>
        ) : (
          "Nothing has been sent yet."
        )}
      </p>
      {items.length === 0 ? (
        <p className="note">The queue is empty. Add a gap from anywhere on the console.</p>
      ) : (
        <ul className="fix-items">
          {items.map((i) => (
            <li key={i.subjectId} className={`fix-item fix-${i.state.toLowerCase()}`}>
              <i className="receipt-mark" aria-hidden="true" />
              <span>
                <strong>{i.where}</strong> — {i.says}
                <small>
                  {stateWords[i.state]} · added <When iso={i.queuedAt} />
                  {i.openedWork.length > 0 ? ` · ${i.openedWork.map((w) => `${w.id} — ${w.title}`).join("; ")}` : ""}
                  {i.refusedReason ? ` · ${i.refusedReason}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form method="post" action={DECISION_ROUTE} className="go-fix">
        <input type="hidden" name="subjectId" value={FIX_QUEUE_SUBJECT} />
        <input type="hidden" name="chosenOption" value={GO_FIX_OPTION} />
        <input type="hidden" name="consequenceShown" value={`${counts.queued} queued gap(s) sent for a session to fix`} />
        <input type="hidden" name="returnTo" value={HERE} />
        <button type="submit" className="primary" disabled={counts.queued === 0}>
          {GO_FIX_OPTION}
        </button>
        <span className="note">
          {counts.queued === 0 ? "Nothing queued to send." : `Sends ${counts.queued} queued gap${counts.queued === 1 ? "" : "s"}; ${SYNC_CADENCE}.`}
        </span>
      </form>
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

  const [snapshotOut, heartbeatOut, digestsOut, decisionsOut, cacheOut, intentsOut, fleetOut] =
    await Promise.all([
      readSnapshot(opened.repos),
      readHeartbeat(opened.repos),
      readDigests(opened.repos),
      readDecisions(opened.repos),
      readCacheObservation(opened.repos),
      readResearchIntents(opened.repos),
      readFleetInputs(opened.repos),
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
  const fleet = fleetOut.kind === "HELD" ? buildFleetView({ nowIso, ...fleetOut.value }) : null;
  const perDay = fleetOut.kind === "HELD" ? attemptsByDay(fleetOut.value.attempts, nowIso) : null;
  const deployments = dispatchHistory(intentLog);
  const standing = runnerStanding(heartbeatOut.kind === "HELD" ? heartbeatOut.value : null, intentLog, nowIso);
  const cards = snapshot ? snapshot.decisionCards : [];
  const collapsedDecisions = collapseDecisionLog(decisions);

  /*
   * ADM-16: a card with a recorded decision is DECIDED and leaves "waiting on
   * you" at once; what the sync has done since is the receipt on the decided
   * card. ADM-20: queued gaps are their own list.
   */
  const { waiting, decided } = splitDecided(cards, collapsedDecisions);
  const decisionCards = waiting.filter((c) => decisionCardKind(c) === "DECISION");
  const acknowledgeCards = waiting.filter((c) => decisionCardKind(c) === "ACKNOWLEDGE");
  const blockedCards = waiting.filter((c) => decisionCardKind(c) === "BLOCKED_WHILE");
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
  if (perDay && fleet) {
    for (const d of perDay) {
      numbers.push({ label: `attempts on ${d.day}`, value: d.value, denominator: fleet.totalAttempts, contract: "Attempts started on this Eastern day, of every Attempt on record" });
    }
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
      numbers.push({ label: `spend on ${d.day}`, value: d.usd, denominator: Math.max(snapshot.costSummary?.measuredUsd ?? d.usd, d.usd), contract: "measured dollars recorded on this Eastern day, of all measured dollars in the ledger" });
    }
  }
  const numberAudit = auditRenderedNumbers(numbers);

  const claims: CountClaim[] = snapshot ? [...countClaimsFor(snapshot)] : [];
  claims.push({
    label: "decision cards by kind",
    stated: cards.length,
    rendered: decisionCards.length + acknowledgeCards.length + blockedCards.length + decided.filter((d) => d.card !== null).length,
  });
  claims.push({ label: "decided", stated: decided.length, rendered: decided.length });
  claims.push({ label: "fix queue", stated: queue.items.length, rendered: queue.items.length });
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
  const spendRows = (snapshot?.costByRole ?? []).filter((c) => c.usd.held && c.usd.value.value > 0);
  const freeRows = (snapshot?.costByRole ?? []).filter((c) => costRowKind(c) === "FREE_BY_DESIGN");
  const unmeasuredRows = (snapshot?.costByRole ?? []).filter((c) => costRowKind(c) === "UNMEASURED");
  const spendByDay = snapshot?.spendByDay ?? [];
  const dayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  return (
    <main className="admin console-page">
      {nav}
      <QueueForm returnTo={HERE} />

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
                <div className={`ph-card card ph-l-${card.level}`} key={card.contract}>
                  <h3>
                    {card.contract}
                    <span className="ph-chip">{card.headline}</span>
                  </h3>
                  {p && (
                    <>
                      <p className="ph-reason">
                        <strong>{p.status}</strong> <Said text={p.why} />
                      </p>
                      <p className="ph-next">
                        <strong>Next:</strong> <Said text={p.next} />
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
                    <p className="note">
                      <Said text={card.reason} />
                    </p>
                    {reading && (
                      <p className="note">
                        Proof class {reading.proofClass}; run {reading.runSha ? reading.runSha.slice(0, 8) : "unrecorded"}{" "}
                        {reading.runAt ? (
                          <>
                            at <When iso={reading.runAt} />
                          </>
                        ) : (
                          ""
                        )}
                        .{" "}
                        {reading.denominator.held ? (
                          <>
                            Denominator: <Num m={reading.denominator.value} />.
                          </>
                        ) : (
                          <GapNote gap={reading.denominator.gap} where={`Pilot health · ${card.contract}`} returnTo={HERE} />
                        )}
                      </p>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
          <p className="note">
            Last updated <When iso={snapshot.publishedAt} /> by {snapshot.publisher}
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
      <LevelLegend />
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
          {perDay && (
            <DayBars
              days={perDay.map((d) => ({ label: d.label, value: d.value }))}
              caption={`Attempts started per day, last 14 days (${perDay.reduce((n, d) => n + d.value, 0)} of ${fleet.totalAttempts} on record)`}
            />
          )}
          <div className="fleet">
            {fleet.groups.map((g) => (
              <FleetGroupCard key={g.key} group={g} nowIso={nowIso} candidateNames={candidateNames} />
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
      <h2>Runner</h2>
      <div className={`runner-card card l-${standing.level}`}>
        <p>
          <Band level={standing.level}>{standing.headline}</Band>
        </p>
        <p>
          <Said text={standing.detail} />
        </p>
        {outcomeNote(heartbeatOut) && <p className="note">{outcomeNote(heartbeatOut)}</p>}
        {heartbeat && (
          <p className="note">
            Last cycle <When iso={heartbeat.lastCycleStartedAt} /> → <When iso={heartbeat.lastCycleFinishedAt} />; next due{" "}
            {/*
              NOT "not scheduled". A null `nextCycleDueAt` means the runner did
              not RECORD a next-due time, and the runner not recording one is not
              evidence that nothing is scheduled.
            */}
            {heartbeat.nextCycleDueAt ? <When iso={heartbeat.nextCycleDueAt} /> : "not recorded in this heartbeat"}; at SHA{" "}
            {heartbeat.testedSha ? heartbeat.testedSha.slice(0, 8) : "unrecorded"}; host {heartbeat.host}.
          </p>
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
            where="Runner · freshness debt"
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
              <span key={r.state} className="where-wrap" title={r.count.contract}>
                <Name raw={r.state} pill short />
                <span className="where-count">
                  {r.count.value} of {r.count.denominator}
                </span>
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
              <span key={r.provider} className="where-wrap" title={r.count.contract}>
                <span className="where">{r.provider.replace(/-/g, " ")}</span>
                <span className="where-count">
                  {r.count.value} of {r.count.denominator}
                </span>
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
                {i.cause.replace(/_/g, " ").toLowerCase()} at <Name raw={i.target} candidateNames={candidateNames} /> — {i.obligationsAffected} obligation(s),
                {i.oldestHours === null ? " age unknown" : ` oldest ${Math.round(i.oldestHours)} h`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 4 — DECISIONS */}
      <h2 id="decisions">Decisions waiting on you — {waiting.length}</h2>
      <p className="note">
        {decisionCards.length} need a decision, {acknowledgeCards.length} need only a read, and{" "}
        {blockedCards.length} are machine-checked walls. Pick an option or answer in your own words.
        The answer is recorded at once and the card moves to <a href="#decided">Decided</a> below,
        where each step shows as it lands: recorded here, closed in the tracker in your name, and the
        work it implies opened for a session. {SYNC_CADENCE[0].toUpperCase() + SYNC_CADENCE.slice(1)}.
      </p>
      {outcomeNote(decisionsOut) && <p className="note">{outcomeNote(decisionsOut)}</p>}
      {decisionCards.map((card) => (
        <DecisionCard key={card.rowId} card={card} />
      ))}
      {acknowledgeCards.length > 0 && (
        <>
          <h3>For your information — {acknowledgeCards.length}</h3>
          {acknowledgeCards.map((card) => (
            <DecisionCard key={card.rowId} card={card} />
          ))}
        </>
      )}
      {blockedCards.length > 0 && (
        <>
          <h3>Blocked while — {blockedCards.length}</h3>
          {blockedCards.map((card) => (
            <DecisionCard key={card.rowId} card={card} />
          ))}
        </>
      )}

      <h2 id="decided">Decided — {decided.length}</h2>
      <p className="note" id="recorded">
        What became of each answer you recorded, step by step. A card stays here after its row has left
        the queue, so the receipt outlives the card.
      </p>
      {decided.length === 0 ? (
        <p className="note">Nothing decided yet. The first answer you record appears here at once.</p>
      ) : (
        decided.map((entry) => <DecidedCard key={entry.decision.intentId} entry={entry} />)
      )}

      <FixQueue items={queue.items} counts={queue.counts} lastGo={queue.lastGo} />

      {/* 5 — COST */}
      <h2 id="cost">Cost</h2>
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
                  {costSummary.attemptsMeasured === 1 ? "" : "s"}; {costSummary.attemptsUnmeasured} more ran without a paid model
                  {unmeasuredRows.length === 0 ? " ($0 by design, not a gap)" : ""}.
                  {freeRows.length > 0 && (
                    <>
                      {" "}
                      Free by design: {freeRows.map((r) => r.key).join(", ")}.
                    </>
                  )}
                  {unmeasuredRows.length > 0 && (
                    <>
                      {" "}
                      Not measured: {unmeasuredRows.map((r) => r.key).join(", ")}.
                    </>
                  )}
                </span>
              )
            ) : (
              <span className="gap">This snapshot predates the cost ledger read; republish to see totals.</span>
            )}
          </p>
          <div className="chart-row">
            {spendRows.length > 0 && (
              <BarChart
                caption="Spend by role — measured dollars"
                rows={spendRows.map((c) => ({
                  label: c.key,
                  value: c.usd.held ? c.usd.value.value : 0,
                  max: c.usd.held ? c.usd.value.denominator : 0,
                  shown: c.usd.held ? usd(c.usd.value.value) : "—",
                  hint: `${c.attemptsMeasured} measured attempt${c.attemptsMeasured === 1 ? "" : "s"}`,
                }))}
              />
            )}
            {spendByDay.length > 0 && (
              <BarChart
                caption="Spend by day — last 14 days"
                rows={spendByDay.map((d) => ({
                  label: dayShort.format(new Date(`${d.day}T12:00:00Z`)),
                  value: d.usd,
                  shown: usdShort(d.usd),
                  hint: `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}`,
                }))}
              />
            )}
            {snapshot.deterministicShare.held && (
              <Ring
                value={snapshot.deterministicShare.value.value}
                total={snapshot.deterministicShare.value.denominator}
                label="deterministic share of dispatches"
                shown={`${Math.round((snapshot.deterministicShare.value.value / Math.max(snapshot.deterministicShare.value.denominator, 1)) * 100)}%`}
              />
            )}
            {snapshot.cacheHitRateByCaller
              .filter((c) => c.hitRate.held)
              .map((c) => (
                <Ring
                  key={c.callerKey}
                  value={c.hitRate.held ? c.hitRate.value.value : 0}
                  total={c.hitRate.held ? c.hitRate.value.denominator : 1}
                  label={`cache hit rate · ${c.callerKey.replace(/ \(.*\)$/, "")}`}
                  shown={`${c.hitRate.held ? Math.round((c.hitRate.value.value / Math.max(c.hitRate.value.denominator, 1)) * 100) : 0}%`}
                />
              ))}
          </div>
          <table className="cost">
            <thead>
              <tr>
                <th>By caller role</th>
                <th className="n">Spend</th>
                <th className="n">Attempts measured / not</th>
                <th>Also measured</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.costByRole.length === 0 && (
                <tr>
                  <td colSpan={4} className="gap">not read — republish the snapshot to fill this table.</td>
                </tr>
              )}
              {snapshot.costByRole.map((c) => (
                <tr key={c.key} className={`cost-${costRowKind(c).toLowerCase().replace(/_/g, "-")}`}>
                  <td>
                    {c.key}
                    {c.meaning && <div className="note">{c.meaning}</div>}
                  </td>
                  <td className="n">
                    {costRowKind(c) === "FREE_BY_DESIGN" ? <span className="free">$0 by design</span> : <HeldNum h={c.usd} format={usd} where={`Cost · ${c.key}`} returnTo={HERE} />}
                  </td>
                  <td className="n">
                    {c.attemptsMeasured ?? "—"} / {c.attemptsUnmeasured ?? "—"}
                  </td>
                  <td className="note">
                    {c.nonDollar && c.nonDollar.entries > 0
                      ? `${c.nonDollar.requests} request${c.nonDollar.requests === 1 ? "" : "s"} · ${bytesText(c.nonDollar.bytes)} · ${durationText(c.nonDollar.durationMs)}`
                      : "—"}
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
                <tr key={c.key} className={`cost-${costRowKind(c).toLowerCase().replace(/_/g, "-")}`}>
                  <td>
                    {c.key}
                    {c.meaning && <div className="note">{c.meaning}</div>}
                  </td>
                  <td className="n">
                    {costRowKind(c) === "FREE_BY_DESIGN" ? <span className="free">$0 by design</span> : <HeldNum h={c.usd} format={usd} where={`Cost · ${c.key}`} returnTo={HERE} />}
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
                    <HeldNum h={c.hitRate} where={`Cost · cache hit rate · ${c.callerKey}`} returnTo={HERE} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Deterministic share of dispatches</td>
                <td className="n">
                  <HeldNum h={snapshot.deterministicShare} where="Cost · deterministic share" returnTo={HERE} />
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
                    <GapNote gap={snapshot.costPerVerifiedRecord.gap} where="Cost · cost per verified record" returnTo={HERE} />
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
      <p className={`note ${cacheLine.state === "OBSERVED" ? "state-green" : ""}`}>
        <Said text={cacheLine.says} />
        {cacheLine.state !== "OBSERVED" && <QueueButton where="Cost · organic prod-ask cache read" says={cacheLine.says} returnTo={HERE} compact />}
      </p>
      {outcomeNote(cacheOut) && <p className="note">{outcomeNote(cacheOut)}</p>}

      {/* 6 — READER SUITE BY ZIP (ADM-18: say what it is, or one line) */}
      <h2>
        Reader suite by ZIP
        {snapshot && snapshot.zipRows.held ? ` — ${snapshot.zipRows.value.length} ZIP(s)` : ""}
      </h2>
      <p className="note">
        The reader suite asks the live site the questions a resident would ask about a pilot ZIP and
        scores each answer green, red or not evaluable; this table would show that score per ZIP, which
        is how a ZIP earns the right to be called ready.
      </p>
      {snapshot && !snapshot.zipRows.held && (
        <p className="note">
          <strong>Not available yet</strong> — <GapNote gap={snapshot.zipRows.gap} where="Reader suite by ZIP" returnTo={HERE} />
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
          {snapshot.intakeFolder.held ? <code>{snapshot.intakeFolder.value}</code> : <GapNote gap={snapshot.intakeFolder.gap} where="Owner intake" returnTo={HERE} />}
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
            Latest digest — {digestsOut.value[0].headline}, written <When iso={digestsOut.value[0].writtenAt} /> ·{" "}
            {digestsOut.value.length} recorded
          </summary>
          <pre>{digestsOut.value[0].lines.join("\n")}</pre>
          <ul>
            {digestsOut.value.map((d) => (
              <li key={d.digestId}>
                <When iso={d.writtenAt} /> — {d.headline}
              </li>
            ))}
          </ul>
        </details>
      )}

      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail} Read at <When iso={nowIso} />. Names are the reader map&rsquo;s
        colours by level; a key&rsquo;s raw form is on hover.
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
