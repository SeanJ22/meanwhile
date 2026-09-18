"use client";

/**
 * Work in flight (BUILD.md §D) — the work tab body.
 *
 * The 2 665-row operations read is scoped to this tab alone (BUILD.md §0): the
 * shell only mounts this island for `?tab=work`, so the full payload never
 * reaches the other four tabs. The tab leads with its exceptions — the four
 * lane tiles, the one failing item, the fifty recovering leases that need
 * nothing — then describes the residual thousands as a SHAPE, and keeps the
 * flat 50-per-page list behind a disclosure as the fallback. You cannot triage
 * a 2 665-row list by reading it.
 *
 * Honesty carried from the contract: every lane is DERIVED from a work item's
 * own task states (`fleetItemLane`), never a stored flag; a live lease means
 * activity, not proven progress; spending never prints a bare $0; and when the
 * control plane could not be read this says so rather than showing an empty
 * "all clear".
 */

import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { FleetOperation, FleetOperationsReport } from "@/lib/control-plane/fleet-operations";
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
  scoutPrerequisite,
  spendingDisplay,
} from "@/lib/admin/fleet-operations-view";

/** The five record-class families the residual thousands fall into — read from
 *  the subject strings the page already holds. The families are REAL; the
 *  counts are not computed, so each pill is dashed and says "— no count" rather
 *  than inventing a number (BUILD.md §D, WIRING.md §8). */
const SHAPE_FAMILIES: readonly { readonly family: string; readonly pattern: string; readonly where: string }[] = [
  { family: "State legislature and Congress", pattern: "az:2026:state-az-sldl-* · state-az-cd-*", where: "Arizona" },
  { family: "Municipal and school boards", pattern: "nj:2026:state-nj-place-* · state-nj-school-district-*", where: "New Jersey" },
  { family: "Boards and commissions", pattern: "ocd-division/country:us/state:*#*", where: "AZ · NH" },
  { family: "Ballot measures", pattern: "ballot-az-pima:*", where: "Pima County" },
  { family: "Statewide offices", pattern: "az:2026:state-az:governor · superintendent · nh:…:united-states-senator", where: "AZ · NH" },
];

function pill(active: boolean, color?: string): CSSProperties {
  return {
    appearance: "none", cursor: "pointer", whiteSpace: "nowrap", font: "inherit", fontSize: 13,
    padding: "6px 12px", borderRadius: 999, border: 0,
    background: active ? "#272B36" : "#1A1D24",
    boxShadow: active ? `inset 0 0 0 1px ${color ?? "rgba(255,255,255,0.20)"}` : "inset 0 0 0 1px rgba(255,255,255,0.07)",
    color: "var(--text, #E8E9ED)",
  };
}

export function FleetWorkTab({ initialState }: { initialState?: FleetConsumerState }) {
  const [consumer, setConsumer] = useState<FleetConsumerState>(initialState ?? EMPTY_CONSUMER_STATE);
  const [busy, setBusy] = useState(false);
  const [lane, setLane] = useState<FleetLane | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"oldest" | "newest" | "subject">("oldest");

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
  const laneOf = useCallback((o: FleetOperation) => fleetItemLane(o), []);
  const counts = useMemo(() => {
    const c: Record<FleetLane, number> = { progressing: 0, waiting: 0, failing: 0, recovering: 0 };
    for (const o of ops) c[laneOf(o)] += 1;
    return c;
  }, [ops, laneOf]);

  const failing = useMemo(() => ops.filter((o) => laneOf(o) === "failing"), [ops, laneOf]);
  const recovering = useMemo(() => ops.filter((o) => laneOf(o) === "recovering"), [ops, laneOf]);

  const shownOps = useMemo(() => {
    let filtered = lane ? ops.filter((o) => laneOf(o) === lane) : [...ops];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((o) => o.subject.toLowerCase().includes(q));
    }
    const sorted = [...filtered];
    if (sortKey === "oldest") sorted.sort((a, b) => (a.lastActivity?.at ?? "").localeCompare(b.lastActivity?.at ?? ""));
    else if (sortKey === "newest") sorted.sort((a, b) => (b.lastActivity?.at ?? "").localeCompare(a.lastActivity?.at ?? ""));
    else sorted.sort((a, b) => a.subject.localeCompare(b.subject));
    return sorted;
  }, [ops, lane, laneOf, search, sortKey]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(shownOps.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageOps = shownOps.slice(pageStart, pageStart + pageSize);
  const isOpen = useCallback((id: string) => (id in open ? open[id] : ops[0]?.workItemId === id), [open, ops]);
  const toggleOpen = useCallback((id: string) => setOpen((o) => ({ ...o, [id]: !(id in o ? o[id] : false) })), []);

  return (
    <section data-fleet-map className="fleet-tab" aria-label="Work in flight" style={{ display: "grid", gap: 16 }}>
      <style>{FLEET_MAP_CSS}</style>

      <div className="fleet-tab-head">
        <div>
          <h2>{ops.length} items. <span className="ft-accent">{failing.length + recovering.length + counts.progressing} of them had something happen.</span></h2>
          <p className="note">
            You cannot triage a {ops.length}-row list by reading it — {pageCount} pages of rows that all
            say &ldquo;stage OPEN · other registered work&rdquo;. So the exceptions come first.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={busy}>{busy ? "Reading…" : "Read again"}</button>
      </div>

      {consumer.lastError && (
        <div className="refusal">
          <strong>{report ? "Refresh failed." : "Could not read the operations report."}</strong> {consumer.lastError}
        </div>
      )}

      {!report ? (
        <p className="note">No report loaded yet — use Read again to read on demand.</p>
      ) : report.operations.kind !== "HELD" ? (
        <ControlPlaneState report={report} />
      ) : (
        <>
          {/* 1 — Lane tiles */}
          <div className="fm-lanes" role="group" aria-label="Lanes">
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
                    <span style={{ marginInlineStart: "auto", fontVariantNumeric: "tabular-nums", fontSize: 22 }}>{counts[l.id]}</span>
                  </span>
                  <span className="note" style={{ margin: "4px 0 0", display: "block" }}>{l.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* 2 — The exceptions, named */}
          <div className="ft-exceptions" id="failing">
            <FindingCard rimColor="#cc4b4b">
              <h3>One item carries a refusal, and the list never shows you which one.</h3>
              {failing.length === 0 ? (
                <p className="note">No item is in the failing lane right now — nothing carries an unresolved refusal.</p>
              ) : (
                failing.slice(0, 1).map((o) => {
                  const blocker = o.tasks.find((t) => t.blocker)?.blocker ?? null;
                  return (
                    <dl key={o.workItemId} className="ft-fieldrows">
                      <div><dt>Subject</dt><dd>{o.subject}</dd></div>
                      <div><dt>Refusal</dt><dd>{blocker ? blocker.replaceAll("_", " ").toLowerCase() : "not named on this read"} <span className="note">— tasks[].blocker</span></dd></div>
                      <div><dt>Owed since</dt><dd>{o.lastActivity?.at ?? "not measured"} <span className="note">— lastActivity.at</span></dd></div>
                    </dl>
                  );
                })
              )}
              {failing.length > 1 && <p className="note">{failing.length - 1} more in the failing lane — filter the flat list below.</p>}
            </FindingCard>

            <FindingCard rimColor="#B57BFF">
              <h3>{recovering.length} leases expired while holding work. Nothing is needed from you.</h3>
              <p className="note">
                They are listed only so the one failing row is not hidden among them. Each carries an
                expired lease and a next action of lease reconciliation; the sweep re-admits them.
              </p>
              {recovering.length > 0 && (
                <details>
                  <summary>Sample recovering leases</summary>
                  <ul className="ft-samples">
                    {recovering.slice(0, 3).map((o) => (
                      <li key={o.workItemId} className="note">{o.subject}{o.lastActivity?.at ? ` · ${o.lastActivity.at}` : ""}</li>
                    ))}
                  </ul>
                  {recovering.length > 3 && <p className="note">{recovering.length - 3} more · every one carries an expired lease and a next action of lease reconciliation.</p>}
                </details>
              )}
            </FindingCard>
          </div>

          {/* 3 — The shape of the residual */}
          <section aria-label="The shape of the residual">
            <h3 className="ft-subhead">The other {Math.max(0, ops.length - failing.length - recovering.length - counts.progressing)} read identically. Here is their shape.</h3>
            <div className="ft-shape">
              {SHAPE_FAMILIES.map((f) => (
                <div key={f.family} className="ft-shape-row">
                  <span className="ft-shape-name">{f.family}<span className="ft-mono note">{f.pattern}</span></span>
                  <span className="note">{f.where}</span>
                  <span className="ft-nocount">— no count</span>
                </div>
              ))}
            </div>
            <p className="note ft-shape-foot">
              One more row would finish this: oldest activity per family. <code>lastActivity.at</code> is
              on every item already, and the list sorts on the work-item id instead — so the oldest row
              sits by coincidence, not because it is oldest.
            </p>
          </section>

          {/* 4 — The flat list, behind a disclosure */}
          <details className="ft-flat">
            <summary>The flat list, as shipped — {pageCount} pages</summary>
            <p className="note">Kept, because sometimes you do want the raw rows. It is the fallback, not the front door.</p>
            <section aria-label="Flat operations list" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem" }}>{lane ? fleetLaneMeta(lane).label.toLowerCase() : "all lanes"}</h4>
                <span className="note">Showing {pageOps.length === 0 ? 0 : pageStart + 1}–{pageStart + pageOps.length} of {shownOps.length} matching items · {ops.length} total · ordered by {sortKey === "subject" ? "subject" : sortKey === "newest" ? "newest activity" : "oldest activity"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: ".82rem" }}>
                <input
                  type="search" placeholder="Search subjects…" value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  style={{ flex: "1 1 12rem", minWidth: 0, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--ce-hairline, rgba(255,255,255,.12))", background: "var(--ce-panel, #1A1D24)", color: "inherit", font: "inherit" }}
                />
                <span className="note" style={{ whiteSpace: "nowrap" }}>Sort:</span>
                <button type="button" style={pill(sortKey === "oldest")} onClick={() => { setSortKey("oldest"); setPage(0); }}>Oldest activity</button>
                <button type="button" style={pill(sortKey === "newest")} onClick={() => { setSortKey("newest"); setPage(0); }}>Newest activity</button>
                <button type="button" style={pill(sortKey === "subject")} onClick={() => { setSortKey("subject"); setPage(0); }}>Subject</button>
              </div>
              {shownOps.length === 0 ? (
                <p className="note">{ops.length === 0 ? "The canonical work-item store holds no rows." : "No items match."}</p>
              ) : (
                pageOps.map((o) => (
                  <WorkItem key={o.workItemId} op={o} lane={laneOf(o)} open={isOpen(o.workItemId)} onToggle={toggleOpen} />
                ))
              )}
              {pageCount > 1 && (
                <nav aria-label="Work item pages" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous items</button>
                  <label>Page <select aria-label="Work item page" value={currentPage} onChange={(e) => setPage(Number(e.target.value))}>
                    {Array.from({ length: pageCount }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
                  </select> of {pageCount}</label>
                  <button type="button" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next items</button>
                </nav>
              )}
            </section>
          </details>
        </>
      )}
    </section>
  );
}

function FindingCard({ rimColor, children }: { rimColor: string; children: ReactNode }) {
  return (
    <div className="ft-finding" style={{ boxShadow: `inset 0 0 0 1px ${rimColor}73, 0 0 0 1px ${rimColor}29` }}>
      {children}
    </div>
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

function WorkItem({ op, lane, open, onToggle }: {
  op: FleetOperation; lane: FleetLane; open: boolean; onToggle: (id: string) => void;
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
          <span className="note" style={{ margin: 0 }}>stage {op.stage} · {op.path.replaceAll("_", " ").toLowerCase()} · workItem {op.workItemId}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span className="op-badge" data-op={lane === "progressing" ? "fresh" : lane === "failing" ? "blocked" : "stale"} style={{ color: meta.color }}>{meta.label}</span>
          {when && <span className="note" style={{ margin: 0 }}>{when}</span>}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div id={panelId} style={{ display: "grid", gap: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          {op.tasks.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {op.tasks.map((t) => (
                <li key={t.taskId} className="note" style={{ margin: 0 }}>
                  <span style={{ color: "var(--text, #E8E9ED)" }}>{t.path.replaceAll("_", " ").toLowerCase()}</span>
                  {" · "}state {t.state.toLowerCase()} · lease {t.lease.toLowerCase()}
                  {t.blocker && <> · <span className="op-badge" data-op="blocked">{t.blocker.replaceAll("_", " ").toLowerCase()}</span></>}
                  <br />
                  {nextActionDisplay(t)}
                  {t.scoutAdmission && <><br />{scoutPrerequisite(t.scoutAdmission)}</>}
                </li>
              ))}
            </ul>
          )}
          <p className="note" style={{ margin: 0 }}>
            {op.sourceHealth.lastAcquired
              ? `Source health · last acquired ${op.sourceHealth.lastAcquired.at}, ${op.sourceHealth.lastAcquired.artifactIds.length} artifact(s). ${NOTES.acquisition}`
              : "Source health · no successful acquisition held."}
            {op.sourceHealth.evidenceGaps.length > 0 && ` · ${op.sourceHealth.evidenceGaps.length} evidence gap(s) named.`}
          </p>
          <p className="note" style={{ margin: 0 }}>
            <span className="op-badge" data-op="stale">publication unknown</span> {NOTES.publication}
          </p>
          <DeliveryLine op={op} />
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

const FLEET_MAP_CSS = `
[data-fleet-map] .fm-lanes { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
[data-fleet-map] .fm-lane { text-align: left; cursor: pointer; border: 0; border-radius: 12px; padding: 12px 14px; background: var(--panel, #181a20); color: inherit; display: block; }
[data-fleet-map] .fm-wi-head { width: 100%; display: flex; gap: 10px; align-items: center; justify-content: space-between; background: transparent; border: 0; cursor: pointer; color: inherit; font: inherit; text-align: left; padding: 0; }
[data-fleet-map] button:focus-visible, [data-fleet-map] .fm-lane:focus-visible, [data-fleet-map] .fm-wi-head:focus-visible { outline: 2px solid var(--link, #4fc9e8); outline-offset: 2px; }
`;
