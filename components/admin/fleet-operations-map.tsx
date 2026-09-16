"use client";

/**
 * **Admin Fleet Operations Map** — the operational overlay, reproduced as a native
 * component from the approved design canvas and driven by the REAL fleet report.
 *
 * This is NOT a second dashboard or backend: it reads the same
 * `FleetOperationsReport` the existing consumer reads (server seed via
 * `readFleetSeedState`, on-demand Refresh via `GET /api/admin/fleet/operations`),
 * through the existing owner-snapshot receipt transport, and reuses the consumer's
 * honesty helpers. It lays that report out as four DERIVED status lanes, expandable
 * work items, and side panels — and it labels which panels have a producer today.
 *
 * Honesty carried over from the design and the contracts:
 *  - Every lane is derived from a work item's own task states (`fleetItemLane`),
 *    never a stored flag. A live lease indicates activity, not proven progress.
 *  - Publication stays UNKNOWN; served-reader proof has no producer. Throughput and
 *    reader-demand have no producer either — they render an honest empty statement,
 *    never a placeholder chart.
 *  - Spending shows the measured subtotal and the unmeasured remainder apart; it
 *    never prints a single $0 total.
 *  - Retained receipts keep their original successful-read time and are never shown
 *    as current proof; the permanent receipt authority is NOT_CONNECTED.
 *  - Unlike the design fixture, this reads real data: when the control plane is
 *    unavailable it says so rather than filling measurements in.
 *
 * Interactions: filter by lane, expand/collapse work items, switch between the
 * Operations view and the Field-mapping-for-Claude-Code view, and toggle code-name
 * visibility. All controls are real buttons — keyboard focusable, aria-pressed —
 * and the layout collapses to one column on narrow viewports.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { DecisionQueue, type PriorityGroupView } from "@/app/(admin)/admin/decisions.tsx";
import { groupWaiting, waitingCardView, waitingSummary } from "@/lib/control-plane/decision-queue.ts";
import type { FleetOperation, FleetOperationsReport } from "@/lib/control-plane/fleet-operations";
import type { OwnerDecisionCard } from "@/lib/control-plane/owner-surface.ts";
import {
  applyRefresh,
  deliveryItemStatusLabel,
  deliverySummary,
  EMPTY_CONSUMER_STATE,
  fetchFleetOperations,
  FLEET_LANES,
  type FleetConsumerState,
  type FleetLane,
  fleetItemLane,
  fleetLaneMeta,
  nextActionDisplay,
  NOTES,
  receiptLoadEntryLabel,
  receiptLoadingSummary,
  receiptSourceSummary,
  scoutPrerequisite,
  spendingDisplay,
} from "@/lib/admin/fleet-operations-view";
import { FLEET_MAP_CONTRACTS, FLEET_MAP_PANELS, type FleetMapPanelMeta } from "@/lib/admin/fleet-map-meta";

type MapView = "operations" | "fields";

function pill(active: boolean, color?: string): CSSProperties {
  return {
    appearance: "none", cursor: "pointer", whiteSpace: "nowrap", font: "inherit", fontSize: 13,
    padding: "6px 12px", borderRadius: 999, border: 0,
    background: active ? "#272B36" : "#1A1D24",
    boxShadow: active
      ? `inset 0 0 0 1px ${color ? color : "rgba(255,255,255,0.20)"}`
      : "inset 0 0 0 1px rgba(255,255,255,0.07)",
    color: "var(--text, #E8E9ED)",
  };
}

export function FleetOperationsMap({ initialState, stateVersion }: { initialState?: FleetConsumerState; stateVersion: string }) {
  const [consumer, setConsumer] = useState<FleetConsumerState>(initialState ?? EMPTY_CONSUMER_STATE);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<MapView>("operations");
  const [lane, setLane] = useState<FleetLane | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showCode, setShowCode] = useState(true);
  const [page, setPage] = useState(0);

  const refresh = useCallback(() => {
    setBusy(true);
    void fetchFleetOperations().then((incoming) => {
      setConsumer((prev) => applyRefresh(prev, incoming));
      setBusy(false);
    });
  }, []);

  const report = consumer.shown;
  const ops = useMemo<readonly FleetOperation[]>(
    () => (report && report.operations.kind === "HELD" ? report.operations.value : []),
    [report],
  );
  const laneOf = useCallback((op: FleetOperation) => fleetItemLane(op), []);
  const counts = useMemo(() => {
    const c: Record<FleetLane, number> = { progressing: 0, waiting: 0, failing: 0, recovering: 0 };
    for (const op of ops) c[laneOf(op)] += 1;
    return c;
  }, [ops, laneOf]);
  const shownOps = useMemo(() => (lane ? ops.filter((o) => laneOf(o) === lane) : ops), [ops, lane, laneOf]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(shownOps.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageOps = shownOps.slice(pageStart, pageStart + pageSize);

  // First item expanded by default (once), matching the design; toggled thereafter.
  const isOpen = useCallback((id: string) => (id in open ? open[id] : ops[0]?.workItemId === id), [open, ops]);
  const toggleOpen = useCallback((id: string) => setOpen((o) => ({ ...o, [id]: !(id in o ? o[id] : false) })), []);

  const decisionCards = useMemo<readonly OwnerDecisionCard[]>(() => {
    const od = report?.ownerDecisions;
    return od?.kind === "HELD" ? od.value.cards : [];
  }, [report]);

  const priorityGroups = useMemo<readonly PriorityGroupView[]>(() => {
    return groupWaiting(decisionCards).map((g) => ({
      priority: g.priority,
      count: g.count,
      types: g.types.map((t) => ({ type: t.type, cards: t.cards.map(waitingCardView) })),
    }));
  }, [decisionCards]);

  const [readAgo, setReadAgo] = useState<string | null>(null);
  useEffect(() => {
    const ts = report?.observedAt;
    if (!ts) { setReadAgo(null); return; }
    const tick = (): void => {
      const ms = Date.now() - Date.parse(ts);
      if (!Number.isFinite(ms) || ms < 0) { setReadAgo(null); return; }
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1) setReadAgo("just now");
      else if (minutes === 1) setReadAgo("1 minute ago");
      else if (minutes < 60) setReadAgo(`${minutes} minutes ago`);
      else { const h = Math.floor(minutes / 60); setReadAgo(`${h} hour${h === 1 ? "" : "s"} ago`); }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [report?.observedAt]);

  return (
    <section data-fleet-map style={{ display: "grid", gap: 16 }}>
      <style>{FLEET_MAP_CSS}</style>

      <header style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", justifyContent: "space-between" }}>
          <p className="note" style={{ margin: 0, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5, letterSpacing: "0.02em" }}>
            {FLEET_MAP_CONTRACTS}
          </p>
          <button type="button" onClick={refresh} disabled={busy}>{busy ? "Reading…" : "Refresh (on demand)"}</button>
        </div>
        {report && (
          <p className="note" style={{ margin: 0 }}>
            Read {readAgo ?? report.observedAt}. Nothing re-reads this page. There is no cycle here.
            {" "}deliveryFreshness {report.deliveryFreshness}. {NOTES.delivery}
          </p>
        )}
      </header>

      {consumer.lastError && (
        <div className="refusal">
          <strong>{report ? "Refresh failed." : "Could not read the operations report."}</strong> {consumer.lastError}
          {report && ` Showing the last successful read from ${readAgo ?? report.observedAt} (unchanged).`}
        </div>
      )}

      {!report ? (
        <p className="note">No report loaded yet — use Refresh to read on demand.</p>
      ) : report.operations.kind !== "HELD" ? (
        <ControlPlaneState report={report} />
      ) : (
        <>
          {/* View switch */}
          <div className="fm-views" role="group" aria-label="Reading">
            <span className="fm-eyebrow">Reading</span>
            <button type="button" aria-pressed={view === "operations"} onClick={() => setView("operations")} style={pill(view === "operations")}>Operations</button>
            <button type="button" aria-pressed={view === "fields"} onClick={() => setView("fields")} style={pill(view === "fields")}>Field mapping for Claude Code</button>
            <label className="fm-codetoggle">
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} /> Show code-name labels
            </label>
          </div>

          {/* Lane filters */}
          <div className="fm-lanes" role="group" aria-label="Filter by lane">
            {FLEET_LANES.map((l) => {
              const active = lane === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setLane(active ? null : l.id); setPage(0); }}
                  className="fm-lane"
                  style={{ boxShadow: active ? `inset 0 0 0 1px ${l.color}` : "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} />
                    <strong style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: l.color }}>{l.label}</strong>
                    <span style={{ marginInlineStart: "auto", fontVariantNumeric: "tabular-nums", fontSize: 18 }}>{counts[l.id]}</span>
                  </span>
                  <span className="note" style={{ margin: "4px 0 0", display: "block" }}>{view === "fields" ? l.derivation : l.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* NEEDS YOU — owner decisions, mounted as the real DecisionQueue */}
          {report.ownerDecisions.kind === "HELD" && (
            <DecisionQueue
              groups={priorityGroups}
              total={decisionCards.length}
              summary={waitingSummary(groupWaiting(decisionCards))}
              actionRoute="/api/admin/action"
              returnTo="/admin/fleet"
              stateVersion={stateVersion}
            />
          )}

          {/* Work in flight */}
          <section aria-label="Work in flight" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Work in flight — {lane ? fleetLaneMeta(lane).label.toLowerCase() : "all lanes"}</h3>
              <span className="note">Showing {pageOps.length === 0 ? 0 : pageStart + 1}–{pageStart + pageOps.length} of {shownOps.length} matching items · {ops.length} total</span>
            </div>
            {shownOps.length === 0 ? (
              <p className="note">{ops.length === 0 ? "The canonical work-item store holds no rows." : "No items in this lane."}</p>
            ) : (
              pageOps.map((op) => (
                <WorkItem key={op.workItemId} op={op} lane={laneOf(op)} open={isOpen(op.workItemId)} onToggle={toggleOpen} view={view} showCode={showCode} />
              ))
            )}
            {pageCount > 1 && (
              <nav aria-label="Work item pages" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous items</button>
                <label>Page <select aria-label="Work item page" value={currentPage} onChange={(event) => setPage(Number(event.target.value))}>
                  {Array.from({ length: pageCount }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}
                </select> of {pageCount}</label>
                <button type="button" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next items</button>
              </nav>
            )}
          </section>

          {/* Panels */}
          <section aria-label="Panels" className="fm-panels">
            {FLEET_MAP_PANELS.map((p) => (
              <Panel key={p.id} meta={p} report={report} view={view} showCode={showCode} />
            ))}
          </section>
        </>
      )}
    </section>
  );
}

function ControlPlaneState({ report }: { report: FleetOperationsReport }) {
  const o = report.operations;
  return (
    <div className="card" style={{ display: "grid", gap: 6 }}>
      <span className="op-badge" data-op="blocked">Operations unavailable</span>
      <p className="note" style={{ margin: 0 }}>
        {o.kind === "STORE_UNREACHABLE"
          ? `The control plane could not be read — ${o.detail}. No fleet facts were read; nothing here is inferred.`
          : o.kind === "NOT_RECORDED"
            ? `No operations were recorded — ${o.detail}.`
            : "Operations are unavailable."}
        {" "}This is a real read against real infrastructure; an unavailable measurement stays unavailable.
      </p>
    </div>
  );
}

function WorkItem({ op, lane, open, onToggle, view, showCode }: {
  op: FleetOperation; lane: FleetLane; open: boolean; onToggle: (id: string) => void; view: MapView; showCode: boolean;
}) {
  const meta = fleetLaneMeta(lane);
  const spend = spendingDisplay(op.spending);
  const when = op.lastActivity?.at ?? op.lastProgress?.at ?? null;
  const panelId = `fm-wi-${op.workItemId}`;
  return (
    <div className="card" style={{ display: "grid", gap: 6 }}>
      <button type="button" className="fm-wi-head" aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(op.workItemId)}>
        <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{op.subject}</span>
          <span className="note" style={{ margin: 0 }}>
            stage {op.stage} · {op.path.replaceAll("_", " ").toLowerCase()}
            {showCode && ` · workItem ${op.workItemId}`}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span className="op-badge" data-op={lane === "progressing" ? "fresh" : lane === "failing" ? "blocked" : "stale"} style={{ color: meta.color }}>{meta.label}</span>
          {when && <span className="note" style={{ margin: 0 }}>{when}</span>}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div id={panelId} style={{ display: "grid", gap: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          {/* Tasks */}
          {op.tasks.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {op.tasks.map((t) => (
                <li key={t.taskId} className="note" style={{ margin: 0 }}>
                  <span style={{ color: "var(--text, #E8E9ED)" }}>{t.path.replaceAll("_", " ").toLowerCase()}</span>
                  {" · "}state {t.state.toLowerCase()} · lease {t.lease.toLowerCase()}
                  {t.blocker && <> · <span className="op-badge" data-op="blocked">{t.blocker.replaceAll("_", " ").toLowerCase()}</span></>}
                  {showCode && <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11 }}> · {t.taskId}</span>}
                  <br />
                  {view === "fields"
                    ? <span>admission {t.admission?.state ?? "—"} · scout {t.scoutAdmission?.state ?? "—"} · nextAutomaticAction {t.nextAutomaticAction}</span>
                    : nextActionDisplay(t)}
                  {t.scoutAdmission && view === "operations" && <><br />{scoutPrerequisite(t.scoutAdmission)}</>}
                </li>
              ))}
            </ul>
          )}

          {/* Source health */}
          <p className="note" style={{ margin: 0 }}>
            {op.sourceHealth.lastAcquired
              ? `Source health · last acquired ${op.sourceHealth.lastAcquired.at}, ${op.sourceHealth.lastAcquired.artifactIds.length} artifact(s). ${NOTES.acquisition}`
              : "Source health · no successful acquisition held."}
            {op.sourceHealth.evidenceGaps.length > 0 && ` · ${op.sourceHealth.evidenceGaps.length} evidence gap(s) named.`}
          </p>

          {/* Recorded stages + publication (UNKNOWN) */}
          <p className="note" style={{ margin: 0 }}>
            <span className="op-badge" data-op="stale">publication unknown</span> {NOTES.publication}
            {op.publication.recordedStages.length > 0 && ` (${op.publication.recordedStages.length} recorded stage(s), drill-down only)`}
          </p>

          {/* Delivery (local, never served proof) */}
          <DeliveryLine op={op} />

          {/* Spending (never $0 when unknown) */}
          <p className="note" style={{ margin: 0 }}>
            <span className="op-badge" data-op={spend.known && spend.complete ? "finished" : "stale"}>spending</span> {spend.text}
          </p>
        </div>
      )}
    </div>
  );
}

function DeliveryLine({ op }: { op: FleetOperation }) {
  const d = deliverySummary(op.publication.delivery);
  const delivery = op.publication.delivery;
  return (
    <div className="note" style={{ margin: 0 }}>
      <span className="op-badge" data-op="stale">delivery</span> {d.text}. {NOTES.deliveryLocal}
      {delivery.kind === "HELD" && delivery.value.items.length > 0 && (
        <ul style={{ margin: ".2rem 0 0", paddingLeft: "1rem" }}>
          {delivery.value.items.slice(0, 4).map((it, i) => (
            <li key={i} className="note" style={{ margin: 0 }}>
              {deliveryItemStatusLabel(it).text}
              {it.receiptLoads.length > 0 && (
                <ul style={{ margin: ".15rem 0 0", paddingLeft: "1rem" }}>
                  {it.receiptLoads.map((load, j) => (
                    <li key={j} className="note" style={{ margin: 0 }}>{receiptLoadEntryLabel(load).text}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Panel({ meta, report, view, showCode }: { meta: FleetMapPanelMeta; report: FleetOperationsReport; view: MapView; showCode: boolean }) {
  const badgeOp = meta.producer === "WIRED" ? "fresh" : meta.producer === "PARTIAL" ? "stale" : "blocked";
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{meta.title}</strong>
        <span className="op-badge" data-op={badgeOp}>{meta.status}</span>
      </div>
      {view === "fields" ? (
        <p className="note" style={{ margin: 0, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5 }}>{meta.field}</p>
      ) : (
        <PanelBody meta={meta} report={report} showCode={showCode} />
      )}
      {meta.note && view === "operations" && <p className="note" style={{ margin: 0 }}>{meta.note}</p>}
    </div>
  );
}

function PanelBody({ meta, report, showCode }: { meta: FleetMapPanelMeta; report: FleetOperationsReport; showCode: boolean }) {
  if (meta.id === "receipts") return <ReceiptsPanel report={report} showCode={showCode} />;
  if (meta.id === "served") {
    const reason = report.operations.kind === "HELD" ? report.operations.value[0]?.publication.reason : "PER_RECORD_PROMOTION_AND_SERVED_READER_PROOF_NOT_JOINED";
    return (
      <p className="note" style={{ margin: 0 }}>
        publication.status <strong>UNKNOWN</strong>{reason ? ` · reason ${reason}` : ""}. No producer for served-reader proof in any read file — this panel stays empty until that evidence exists.
      </p>
    );
  }
  if (meta.id === "spending") return <SpendingPanel report={report} />;
  if (meta.id === "coverage") return <CoveragePanel report={report} />;
  // throughput / demand — no producer, honest empty statement.
  return <p className="note" style={{ margin: 0 }}>No producer. {meta.field.replace(/^NO PRODUCER\.?\s*/i, "")}</p>;
}

function ReceiptsPanel({ report, showCode }: { report: FleetOperationsReport; showCode: boolean }) {
  const s = receiptLoadingSummary(report.receiptLoading);
  const src = receiptSourceSummary(report.receiptSource);
  const entries = report.receiptLoading.kind === "HELD" ? report.receiptLoading.value.entries : [];
  return (
    <div className="note" style={{ margin: 0, display: "grid", gap: 4 }}>
      <span>{s.text}</span>
      {src && <span>{src.text}</span>}
      {entries.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1rem" }}>
          {entries.slice(0, 6).map((e, i) => (
            <li key={i} className="note" style={{ margin: 0 }}>
              {showCode ? receiptLoadEntryLabel(e).text : receiptLoadEntryLabel(e).text.replace(/\breceipt [^:]+:/, "receipt:")}
            </li>
          ))}
        </ul>
      )}
      {s.caveat && <span>{s.caveat}</span>}
    </div>
  );
}

function SpendingPanel({ report }: { report: FleetOperationsReport }) {
  const ops = report.operations.kind === "HELD" ? report.operations.value : [];
  let measured = 0;
  let anyMeasured = false;
  let unmeasuredRows = 0;
  let attemptsNoCost = 0;
  let complete = true;
  for (const op of ops) {
    const u = op.spending.usd;
    if (u.total !== null) { measured += u.total; anyMeasured = true; }
    unmeasuredRows += u.unmeasured;
    attemptsNoCost += op.spending.attemptsWithoutCostEntry.length;
    if (!u.complete || u.unmeasured > 0) complete = false;
  }
  if (attemptsNoCost > 0) complete = false;
  const measuredText = anyMeasured ? `$${measured.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "$0.00";
  return (
    <dl style={{ margin: 0, display: "grid", gap: 4 }}>
      <Row k="Measured" v={measuredText} note="cost rows carrying a USD amount" />
      <Row k="Unmeasured" v={`${unmeasuredRows} row(s)`} note="cost rows with no USD amount recorded" warn />
      <Row k="Attempts with no cost row" v={String(attemptsNoCost)} note="including expired pre-commit computations" warn={attemptsNoCost > 0} />
      <Row k="Total" v={complete ? measuredText : "unknown"} note={complete ? "fully measured" : "known subtotal above; remainder unmeasured"} warn={!complete} />
    </dl>
  );
}

function Row({ k, v, note, warn }: { k: string; v: string; note: string; warn?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "baseline" }}>
      <dt style={{ fontSize: 12 }}>{k} <span className="note">— {note}</span></dt>
      <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums", fontSize: 13, color: warn ? "#FFB000" : "var(--text, #E8E9ED)" }}>{v}</dd>
    </div>
  );
}

function CoveragePanel({ report }: { report: FleetOperationsReport }) {
  const c = report.coverageGaps;
  if (c.kind !== "HELD") return <p className="note" style={{ margin: 0 }}>Coverage instrument unavailable — {c.kind === "STORE_UNREACHABLE" ? c.detail : "not recorded"}.</p>;
  const zip = c.value.zipRows;
  return (
    <p className="note" style={{ margin: 0 }}>
      {zip.held
        ? `${zip.value.length} ZIP row(s), snapshot published ${c.value.publishedAt}. ${NOTES.coverage}`
        : `${zip.gap.says} (snapshot ${c.value.publishedAt}).`}
    </p>
  );
}

const FLEET_MAP_CSS = `
[data-fleet-map] .fm-views { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-fleet-map] .fm-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim, #a8abb7); margin-inline-end: 4px; }
[data-fleet-map] .fm-codetoggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim, #a8abb7); cursor: pointer; margin-inline-start: auto; }
[data-fleet-map] .fm-lanes { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
[data-fleet-map] .fm-lane { text-align: left; cursor: pointer; border: 0; border-radius: 12px; padding: 12px 14px; background: var(--panel, #181a20); color: inherit; display: block; }
[data-fleet-map] .fm-panels { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
[data-fleet-map] .fm-wi-head { width: 100%; display: flex; gap: 10px; align-items: center; justify-content: space-between; background: transparent; border: 0; cursor: pointer; color: inherit; font: inherit; text-align: left; padding: 0; }
[data-fleet-map] button:focus-visible, [data-fleet-map] .fm-lane:focus-visible, [data-fleet-map] .fm-wi-head:focus-visible { outline: 2px solid var(--link, #4fc9e8); outline-offset: 2px; }
`;
