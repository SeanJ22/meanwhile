"use client";

/**
 * Admin consumer of the fleet operations contract (`fleet-operations/v1`).
 *
 * On-demand: it fetches GET /api/admin/fleet/operations when asked (mount + a
 * Refresh control), NEVER on the 8-second pulse — the cheap heartbeat stays in
 * app/api/admin/live. It renders every section's own typed outcome (HTTP 200
 * never means all sections were measured), keeps publication UNKNOWN, keeps
 * delivery freshness distinct from source freshness, never shows unknown
 * spending as $0, never presents a next prerequisite as a dispatch time, and on
 * a failed refresh RETAINS the last successful report and its original
 * observedAt while surfacing the new error (it does not restamp).
 *
 * The honesty logic lives in lib/admin/fleet-operations-view.ts and is covered
 * by a producer→consumer test (tests/fleet-operations-consumer.test.ts).
 */

import { useCallback, useState } from "react";

import type { FleetOperation, FleetOperationsReport } from "@/lib/control-plane/fleet-operations";
import {
  applyRefresh,
  deliveryItemStatusLabel,
  deliverySummary,
  EMPTY_CONSUMER_STATE,
  extensionCapability,
  type FleetConsumerState,
  type FleetFetch,
  NOTES,
  nextActionDisplay,
  progressSummary,
  receiptLoadEntryLabel,
  receiptLoadingSummary,
  scoutPrerequisite,
  spendingDisplay,
} from "@/lib/admin/fleet-operations-view";

async function fetchFleetOperations(): Promise<FleetFetch> {
  try {
    const res = await fetch("/api/admin/fleet/operations", { headers: { accept: "application/json" }, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | (FleetOperationsReport & { error?: undefined })
      | { formatVersion?: string; observedAt?: string; error?: { code?: string; detail?: string } }
      | { says?: string }
      | null;
    if (body && "error" in body && body.error?.code === "CONTROL_PLANE_UNAVAILABLE") {
      return { status: "CONTROL_PLANE_UNAVAILABLE", observedAt: body.observedAt ?? "", detail: body.error.detail ?? "" };
    }
    if (body && "formatVersion" in body && body.formatVersion && "operations" in body) {
      return { status: "REPORT", report: body as FleetOperationsReport };
    }
    const says = body && "says" in body ? body.says : undefined;
    return { status: "TRANSPORT_ERROR", detail: says ?? `HTTP ${res.status}` };
  } catch (error) {
    return { status: "TRANSPORT_ERROR", detail: (error as Error)?.message ?? "network error" };
  }
}

function DeliveryBadge({ freshness }: { freshness: FleetOperationsReport["deliveryFreshness"] }) {
  const op = freshness === "FRESH" ? "fresh" : freshness === "STALE" ? "stale" : "blocked";
  return <span className="op-badge" data-op={op}>{`Delivery ${freshness.toLowerCase()}`}</span>;
}

function Outcome({ label, outcome, children }: { label: string; outcome: { kind: string; detail?: string }; children?: React.ReactNode }) {
  if (outcome.kind === "STORE_UNREACHABLE") {
    return <p className="note"><span className="op-badge" data-op="blocked">{label}: unreadable</span> {outcome.detail}</p>;
  }
  if (outcome.kind === "NOT_RECORDED") {
    return <p className="note"><span className="op-badge" data-op="stale">{label}: not recorded</span> {outcome.detail}</p>;
  }
  return <>{children}</>;
}

function DeliveryBlock({ delivery }: { delivery: FleetOperation["publication"]["delivery"] }) {
  // Older producer (no extension) omits delivery entirely.
  if (!delivery) return null;
  const d = deliverySummary(delivery);
  return (
    <div className="note">
      <span className="op-badge" data-op="stale">delivery</span> {d.text}. {NOTES.deliveryLocal}
      {delivery.kind === "HELD" && delivery.value.items.length > 0 && (
        <ul style={{ margin: ".2rem 0 0", paddingLeft: "1rem" }}>
          {delivery.value.items.slice(0, 4).map((it, i) => (
            <li key={i} className="note">
              {deliveryItemStatusLabel(it).text}
              {it.gaps.length > 0 && ` · gaps: ${it.gaps.join(", ")}`}
              {it.receiptLoads.length > 0 && (
                <ul style={{ margin: ".15rem 0 0", paddingLeft: "1rem" }}>
                  {it.receiptLoads.map((load, j) => (
                    <li key={j} className="note">{receiptLoadEntryLabel(load).text}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {delivery.kind === "HELD" && delivery.value.receiptAvailability === "NOT_PROVIDED" && (
        <span> {NOTES.receiptsNotProvided}</span>
      )}
    </div>
  );
}

function OperationCard({ op }: { op: FleetOperation }) {
  const spend = spendingDisplay(op.spending);
  const prog = progressSummary(op);
  return (
    <div className="card" style={{ marginBottom: ".6rem" }}>
      <h3 style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "baseline" }}>
        <span>{op.subject}</span>
        <span className="op-badge" data-op={op.stage === "OPEN" ? "exporting" : "stale"}>{op.stage}</span>
      </h3>
      <p className="note">{op.path.replaceAll("_", " ").toLowerCase()} · work item <code>{op.workItemId}</code></p>

      {/* Heartbeat vs useful progress — an activity move is not evidence advancing. */}
      <p className="note">
        {prog.advanced ? `Progress advanced (last useful result ${prog.progressAt})` : "No useful progress recorded yet"}
        {prog.activityAt ? ` · last activity ${prog.activityAt}${prog.progressAt !== prog.activityAt ? " (heartbeat/retry ≠ progress)" : ""}` : ""}
      </p>

      {/* Acquired ≠ published: last held acquisition, and any later failure, kept apart. */}
      {op.sourceHealth.lastAcquired ? (
        <p className="note">Acquired: {op.sourceHealth.lastAcquired.artifactIds.length} artifact(s) at {op.sourceHealth.lastAcquired.at}. {NOTES.acquisition}</p>
      ) : (
        <p className="note">No successful acquisition held.</p>
      )}
      {op.sourceHealth.latestAcquisition && op.sourceHealth.latestAcquisition.resultId !== op.sourceHealth.lastAcquired?.resultId && (
        <p className="note">Latest acquisition attempt verdict: {op.sourceHealth.latestAcquisition.verdict} (a later result does not discard the held one).</p>
      )}
      {op.sourceHealth.evidenceGaps.length > 0 && (
        <p className="note"><span className="op-badge" data-op="blocked">evidence gaps</span> {op.sourceHealth.evidenceGaps.length} named, unproven/expired — never counted as success.</p>
      )}

      {/* Publication is UNKNOWN (conservative served result); delivery narrows it locally. */}
      <p className="note"><span className="op-badge" data-op="stale">publication unknown</span> {NOTES.publication}
        {op.publication.recordedStages.length > 0 && ` (${op.publication.recordedStages.length} recorded stage(s), for drill-down only)`}</p>
      <DeliveryBlock delivery={op.publication.delivery} />

      {/* Spending — unknown/incomplete is never $0. */}
      <p className="note">
        <span className="op-badge" data-op={spend.known && spend.complete ? "finished" : "stale"}>spending</span>{" "}
        {spend.text}
      </p>

      {/* Tasks: blocker + next prerequisite (not a dispatch), lease. */}
      {op.tasks.length > 0 && (
        <ul style={{ margin: ".3rem 0 0", paddingLeft: "1rem" }}>
          {op.tasks.map((t) => (
            <li key={t.taskId} className="note" style={{ margin: ".2rem 0" }}>
              <code>{t.path.toLowerCase()}</code> · {t.state.toLowerCase()} · lease {t.lease.toLowerCase()}
              {t.blocker && <> · <span className="op-badge" data-op="blocked">{t.blocker.replaceAll("_", " ").toLowerCase()}</span></>}
              <br />
              {nextActionDisplay(t)}
              {t.scoutAdmission && <><br />{scoutPrerequisite(t.scoutAdmission)}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReceiptLoadingBlock({ loading }: { loading?: FleetOperationsReport["receiptLoading"] }) {
  // An older producer (pre-v1.2) omits the field entirely; render nothing then.
  if (!loading) return null;
  const s = receiptLoadingSummary(loading);
  const op = !s.available ? (loading.kind === "STORE_UNREACHABLE" ? "blocked" : "stale") : s.unresolved ? "stale" : "finished";
  const entries = loading.kind === "HELD" ? loading.value.entries : [];
  return (
    <div className="note" data-receipt-loading>
      <span className="op-badge" data-op={op}>receipt loading</span> {s.text}
      {s.caveat && <><br />{s.caveat}</>}
      {entries.length > 0 && (
        <ul style={{ margin: ".2rem 0 0", paddingLeft: "1rem" }}>
          {entries.slice(0, 6).map((e, i) => (
            <li key={i} className="note">{receiptLoadEntryLabel(e).text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FleetOperationsView({ state }: { state: FleetConsumerState }) {
  const report = state.shown;
  return (
    <section data-fleet-operations>
      {state.lastError && (
        <div className="refusal" style={{ marginBottom: ".75rem" }}>
          <strong>{report ? "Refresh failed." : "Could not read the operations report."}</strong> {state.lastError}
          {report && ` Showing the last successful read from ${report.observedAt} (unchanged).`}
        </div>
      )}

      {!report ? (
        <p className="note">No report loaded yet.</p>
      ) : (
        <>
          <p className="plain" style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
            <DeliveryBadge freshness={report.deliveryFreshness} />
            {extensionCapability(report) === "UNAVAILABLE" && (
              <span className="op-badge" data-op="blocked" title={NOTES.extensionUnavailable}>extension unavailable</span>
            )}
            <span className="note">Read at {report.observedAt}. {NOTES.delivery}</span>
          </p>

          <ReceiptLoadingBlock loading={report.receiptLoading} />

          <h2>Is useful work advancing?</h2>
          <Outcome label="Operations" outcome={report.operations}>
            {report.operations.kind === "HELD" && (report.operations.value.length === 0
              ? <p className="note">The canonical work-item store holds no rows.</p>
              : report.operations.value.map((op) => <OperationCard key={op.workItemId} op={op} />))}
          </Outcome>

          <h2>What remains missing by ZIP?</h2>
          <Outcome label="Coverage" outcome={report.coverageGaps}>
            {report.coverageGaps.kind === "HELD" && (
              report.coverageGaps.value.zipRows.held
                ? <p className="note">{report.coverageGaps.value.zipRows.value.length} ZIP row(s), snapshot published {report.coverageGaps.value.publishedAt}. {NOTES.coverage}</p>
                : <p className="note"><span className="op-badge" data-op="stale">ZIP gap</span> {report.coverageGaps.value.zipRows.gap.says} (snapshot {report.coverageGaps.value.publishedAt}).</p>
            )}
          </Outcome>

          <h2>What needs your decision?</h2>
          <Outcome label="Owner decisions" outcome={report.ownerDecisions}>
            {report.ownerDecisions.kind === "HELD" && (report.ownerDecisions.value.cards.length === 0
              ? <p className="note">No unanswered owner decisions (machine blockers and acknowledgements are excluded).</p>
              : <ul style={{ paddingLeft: "1rem" }}>{report.ownerDecisions.value.cards.map((c) => (
                  <li key={c.rowId} className="note">{c.title}</li>
                ))}</ul>)}
          </Outcome>
        </>
      )}
    </section>
  );
}

export function FleetOperationsPanel({ initialState }: { initialState?: FleetConsumerState }) {
  // The committed route (app/(admin)/admin/fleet/page.tsx) is a server component
  // that reads the control plane once and passes that first read in as
  // initialState — the same on-demand read the endpoint performs, taken at
  // navigation time, never the 8s pulse. Refresh then re-reads on demand through
  // GET /api/admin/fleet/operations. With no seed the panel simply shows nothing
  // until Refresh; it never fetches from an effect.
  const [state, setState] = useState<FleetConsumerState>(initialState ?? EMPTY_CONSUMER_STATE);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    setBusy(true);
    void fetchFleetOperations().then((incoming) => {
      setState((prev) => applyRefresh(prev, incoming));
      setBusy(false);
    });
  }, []);
  return (
    <div>
      <div className="controls-row" style={{ marginBottom: ".6rem" }}>
        <button type="button" onClick={refresh} disabled={busy}>{busy ? "Reading…" : "Refresh operations (on demand)"}</button>
      </div>
      <FleetOperationsView state={state} />
    </div>
  );
}
