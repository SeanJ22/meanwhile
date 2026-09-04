/**
 * **THE OWNER CONTROL CENTRE.** (Session C final, ITEM H, 2026-09-01.)
 *
 * Reachable only on `ADMIN_ORIGIN`, only with a valid session — both enforced
 * upstream in `middleware.ts`, which returns 404 for this path on the public
 * host and redirects an unauthenticated request to the login page before this
 * component is ever invoked.
 *
 * ## Everything here comes from the durable control plane
 *
 * No filesystem read, no Drive mirror, no process table, no agent output.
 * `next.config.ts` documents at length what a `process.cwd()` read does in a
 * Netlify standalone bundle when nobody traced it: returns nothing, the catch
 * returns null, and the surface renders its own gap wording — which is
 * indistinguishable from honest missing data. On a HEALTH page that failure
 * tells the owner his pilot is fine because the page could not find the file
 * that says otherwise. So the data plane is Postgres and this page reads it.
 *
 * ## The page checks itself before it shows anything
 *
 * Two audits run against what is about to be rendered, not against the code
 * that produced it:
 *
 *   - every number carries a denominator and an interpretation contract
 *   - every stated N equals the number of rows actually rendered
 *
 * A failure replaces the numbers with a refusal. A control centre that renders
 * a wrong number confidently is worse than one that renders nothing, because
 * the owner acts on it.
 */

import { cookies } from "next/headers";

import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { ConsoleNav } from "../console-nav.tsx";

import {
  openControlPlane,
  readCacheObservation,
  readDecisions,
  readDigests,
  readHeartbeat,
  readSnapshot,
  type ReadOutcome,
} from "@/lib/control-plane/admin-data.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  countClaimsFor,
  livenessOf,
  renderCacheObservation,
  type CountClaim,
  type Held,
  type Measured,
  type OwnerSnapshot,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";

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

/* ------------------------------------------------------------------ *
 * SMALL RENDER HELPERS
 * ------------------------------------------------------------------ */

/** A held value, or the named gap where it would have been. */
function GapOrValue({ held, children }: { held: Held<unknown>; children: React.ReactNode }) {
  if (held.held) return <>{children}</>;
  const whose =
    held.gap.whose === "OURS"
      ? "our gap"
      : held.gap.whose === "THEIRS"
        ? "their gap"
        : "cannot tell";
  return (
    <span className="gap">
      <span className="gap-whose">{whose}</span> {held.gap.says}
    </span>
  );
}

/** A measured number, always with its denominator visible. */
function Num({ m }: { m: Measured }) {
  return (
    <span title={`${m.contract} — denominator from ${m.denominatorSource}`}>
      <strong>{m.value}</strong>
      <span className="denom"> of {m.denominator}</span>
    </span>
  );
}

function outcomeNote<T>(outcome: ReadOutcome<T>): string | null {
  return outcome.kind === "HELD" ? null : outcome.detail;
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

  const [snapshotOut, heartbeatOut, digestsOut, decisionsOut, cacheOut] = await Promise.all([
    readSnapshot(opened.repos),
    readHeartbeat(opened.repos),
    readDigests(opened.repos),
    readDecisions(opened.repos),
    readCacheObservation(opened.repos),
  ]);

  const snapshot: OwnerSnapshot | null = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const nowIso = new Date().toISOString();

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

  if (snapshot) {
    for (const row of snapshot.obligationsByState) {
      numbers.push({
        label: `obligations ${row.state}`,
        value: row.count.value,
        denominator: row.count.denominator,
        contract: row.count.contract,
      });
    }
    for (const row of snapshot.obligationsByProvider) {
      numbers.push({
        label: `provider ${row.provider}`,
        value: row.count.value,
        denominator: row.count.denominator,
        contract: row.count.contract,
      });
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
  if (digestsOut.kind === "HELD") {
    claims.push({
      label: "digest history",
      stated: digestsOut.value.length,
      rendered: digestsOut.value.length,
    });
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

  const liveness = livenessOf(heartbeatOut.kind === "HELD" ? heartbeatOut.value : null, nowIso);
  const cacheLine = renderCacheObservation(cacheOut.kind === "HELD" ? cacheOut.value : null);

  return (
    <main className="admin console-page">
      {nav}
      {/* 1 — PILOT HEALTH */}
      <h1>
        Pilot health{" "}
        {snapshot ? (
          <span className={snapshot.pilotGreen ? "state-green" : "state-red"}>
            {snapshot.pilotGreen === null ? "NOT READY" : snapshot.pilotGreen ? "GREEN" : "RED"}
          </span>
        ) : (
          <span className="state-unknown">no snapshot recorded</span>
        )}
      </h1>
      <p className="note">
        <a href="/admin/research">Research — Level 1</a>
      </p>
      {outcomeNote(snapshotOut) && <p className="note">{outcomeNote(snapshotOut)}</p>}
      {snapshot && (
        <>
          <p className="note">
            Published {snapshot.publishedAt} by {snapshot.publisher} at{" "}
            {snapshot.publishedFromSha ?? "an unrecorded SHA"}.
          </p>
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>State</th>
                <th>Denominator</th>
                <th>Proof class</th>
                <th>Run</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.contracts.map((c) => (
                <tr key={c.contract}>
                  <td>{c.contract}</td>
                  <td>{c.state}</td>
                  <td>
                    <GapOrValue held={c.denominator}>
                      {c.denominator.held && <Num m={c.denominator.value} />}
                    </GapOrValue>
                  </td>
                  <td>{c.proofClass}</td>
                  <td>
                    {c.runSha ?? "—"} {c.runAt ?? ""}
                  </td>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 2 — THE DIGEST */}
      <h2>Latest digest</h2>
      {outcomeNote(digestsOut) && <p className="note">{outcomeNote(digestsOut)}</p>}
      {digestsOut.kind === "HELD" && digestsOut.value[0] && (
        <>
          <p>
            <strong>{digestsOut.value[0].headline}</strong>{" "}
            <span className="note">written {digestsOut.value[0].writtenAt}</span>
          </p>
          <pre>{digestsOut.value[0].lines.join("\n")}</pre>
          <h3>History — {digestsOut.value.length} recorded</h3>
          <ul>
            {digestsOut.value.map((d) => (
              <li key={d.digestId}>
                {d.writtenAt} — {d.headline}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 3 — NEEDS SEAN */}
      <h2>Decisions waiting on you — {snapshot ? snapshot.decisionCards.length : 0}</h2>
      {snapshot?.decisionCards.map((card) => (
        <section className="card" key={card.rowId}>
          <h3>
            {card.rowId} · {card.title}
          </h3>
          <p className="note">
            {card.priority} · opened {card.openedOn ?? "on an unrecorded date"} ·{" "}
            {card.ageDays === null ? "age unknown" : `${card.ageDays} days old`} ·{" "}
            {card.blockedDescendants} blocked descendant(s) · {card.verifiability}
          </p>
          <p>
            <strong>What is needed:</strong> {card.whatIsNeeded}
          </p>
          <p>
            <strong>Why no machine can decide it:</strong> {card.whyNoMachineCanDecide}
          </p>
          <form method="post" action="/api/admin/decision">
            <input type="hidden" name="subjectId" value={card.rowId} />
            {card.options.map((o) => (
              <button key={o.option} type="submit" name="chosenOption" value={o.option}>
                {o.option} — {o.consequence}
              </button>
            ))}
          </form>
        </section>
      ))}

      {/* Decisions already recorded, and what became of them. */}
      {decisionsOut.kind === "HELD" && decisionsOut.value.length > 0 && (
        <>
          <h3>Decisions recorded — {decisionsOut.value.length}</h3>
          <ul>
            {decisionsOut.value.map((d) => (
              <li key={d.intentId}>
                {d.decidedAt} · {d.subjectId} · chose <strong>{d.chosenOption}</strong> ·{" "}
                <span className={d.state === "CANONICALIZED" ? "state-green" : "state-unknown"}>
                  {d.state}
                </span>
                {d.canonicalRef ? ` · landed as ${d.canonicalRef}` : ""}
                {d.refusedReason ? ` · refused: ${d.refusedReason}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 4 — RUNNER */}
      <h2>Runner</h2>
      <p>
        <span className={liveness.state === "ALIVE" ? "state-green" : "state-red"}>
          {liveness.state}
        </span>{" "}
        {liveness.detail}
      </p>
      {outcomeNote(heartbeatOut) && <p className="note">{outcomeNote(heartbeatOut)}</p>}
      {heartbeatOut.kind === "HELD" && (
        <p className="note">
          Last cycle {heartbeatOut.value.lastCycleStartedAt ?? "—"} →{" "}
          {heartbeatOut.value.lastCycleFinishedAt ?? "—"}; next due{" "}
          {/*
            NOT "not scheduled". A null `nextCycleDueAt` means the runner did
            not RECORD a next-due time, and the runner not recording one is not
            evidence that nothing is scheduled — the scheduler may well have a
            due time this heartbeat simply did not carry. Asserting "not
            scheduled" out of that null is the absence-to-assertion defect
            exactly, on the one panel whose job is to say whether work is
            still happening.
          */}
          {heartbeatOut.value.nextCycleDueAt ?? "not recorded in this heartbeat"}; at SHA{" "}
          {heartbeatOut.value.testedSha ?? "unrecorded"}.
        </p>
      )}
      {snapshot && (
        <>
          <h3>Obligations by state</h3>
          <ul>
            {snapshot.obligationsByState.map((r) => (
              <li key={r.state}>
                {r.state}: <Num m={r.count} />
              </li>
            ))}
          </ul>
          <h3>Obligations by provider</h3>
          <ul>
            {snapshot.obligationsByProvider.map((r) => (
              <li key={r.provider}>
                {r.provider}: <Num m={r.count} />
              </li>
            ))}
          </ul>
          <h3>Freshness debt</h3>
          <p>
            <GapOrValue held={snapshot.freshnessDebtRows}>
              {snapshot.freshnessDebtRows.held && <Num m={snapshot.freshnessDebtRows.value} />}
            </GapOrValue>
          </p>
          <h3>Incidents — {snapshot.incidents.length}</h3>
          <ul>
            {snapshot.incidents.map((i) => (
              <li key={`${i.cause}:${i.target}`}>
                {i.cause} at {i.target} — {i.obligationsAffected} obligation(s),
                {i.oldestHours === null ? " age unknown" : ` oldest ${i.oldestHours}h`}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 5 — COST */}
      <h2>Cost</h2>
      {snapshot && (
        <>
          <h3>By caller role</h3>
          <ul>
            {snapshot.costByRole.map((c) => (
              <li key={c.key}>
                {c.key}:{" "}
                <GapOrValue held={c.usd}>{c.usd.held && <Num m={c.usd.value} />}</GapOrValue>
              </li>
            ))}
          </ul>
          <h3>By model</h3>
          <ul>
            {snapshot.costByModel.map((c) => (
              <li key={c.key}>
                {c.key}:{" "}
                <GapOrValue held={c.usd}>{c.usd.held && <Num m={c.usd.value} />}</GapOrValue>
              </li>
            ))}
          </ul>
          <h3>Cache hit rate by caller key</h3>
          <ul>
            {snapshot.cacheHitRateByCaller.map((c) => (
              <li key={c.callerKey}>
                {c.callerKey}:{" "}
                <GapOrValue held={c.hitRate}>
                  {c.hitRate.held && <Num m={c.hitRate.value} />}
                </GapOrValue>
              </li>
            ))}
          </ul>
          <p>
            Deterministic vs model share:{" "}
            <GapOrValue held={snapshot.deterministicShare}>
              {snapshot.deterministicShare.held && <Num m={snapshot.deterministicShare.value} />}
            </GapOrValue>
          </p>
          <p>
            Cost per verified record:{" "}
            <GapOrValue held={snapshot.costPerVerifiedRecord}>
              {snapshot.costPerVerifiedRecord.held && (
                <Num m={snapshot.costPerVerifiedRecord.value} />
              )}
            </GapOrValue>
          </p>
        </>
      )}
      {/*
        THE H1 WAIVER'S STANDING CHECK (owner, 2026-09-01). Three states, and
        the third one is why this is not a boolean: "not yet observed" is a
        claim about our RECORD, and it is only honest if the recording path is
        wired. If it is not, we have observed nothing — not an absence.
      */}
      <p className={cacheLine.state === "OBSERVED" ? "state-green" : "state-unknown"}>
        {cacheLine.says}
      </p>
      {outcomeNote(cacheOut) && <p className="note">{outcomeNote(cacheOut)}</p>}

      {/* 6 — READER SUITE BY ZIP */}
      <h2>
        Reader suite by ZIP —{" "}
        {snapshot && snapshot.zipRows.held ? `${snapshot.zipRows.value.length} ZIP(s)` : "no grid"}
      </h2>
      {snapshot && !snapshot.zipRows.held && (
        <p>
          <GapOrValue held={snapshot.zipRows}>{null}</GapOrValue>
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

      {/* 7 — OWNER INTAKE */}
      <h2>Owner intake</h2>
      {snapshot && (
        <p>
          Latest folder swept:{" "}
          <GapOrValue held={snapshot.intakeFolder}>
            {snapshot.intakeFolder.held && <code>{snapshot.intakeFolder.value}</code>}
          </GapOrValue>
          {" · found "}
          <GapOrValue held={snapshot.intakeItemsFound}>
            {snapshot.intakeItemsFound.held && <Num m={snapshot.intakeItemsFound.value} />}
          </GapOrValue>
          {" · processed "}
          <GapOrValue held={snapshot.intakeItemsProcessed}>
            {snapshot.intakeItemsProcessed.held && <Num m={snapshot.intakeItemsProcessed.value} />}
          </GapOrValue>
          {" · unidentifiable "}
          <GapOrValue held={snapshot.intakeUnidentifiable}>
            {snapshot.intakeUnidentifiable.held && <Num m={snapshot.intakeUnidentifiable.value} />}
          </GapOrValue>
        </p>
      )}

      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail}
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
