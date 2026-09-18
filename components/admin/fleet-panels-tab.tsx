/**
 * Panels tab (BUILD.md §F, WIRING.md §9). Server component — no interactivity.
 *
 * The six panels split by whether a producer exists, so an empty panel stops
 * carrying the same weight as a measured one. The three that read something are
 * filled cards with their own caveat; the three with no producer are
 * transparent, dashed, and say so. Spending is three separate rows — a known
 * subtotal of zero and an unknown total are different statements — never one $0
 * figure. Reads only the owner snapshot (via readFleetPanels), never the
 * fleet-activity scan.
 */

import type { FleetPanelsReading } from "@/lib/control-plane/fleet-operations";
import { FLEET_MAP_CONTRACTS, FLEET_MAP_PANELS } from "@/lib/admin/fleet-map-meta";
import { NOTES, receiptLoadingSummary, receiptSourceSummary } from "@/lib/admin/fleet-operations-view";

function SpendingRows({ spending }: { readonly spending: FleetPanelsReading["spending"] }) {
  if (!spending) {
    return <p className="note" style={{ margin: 0 }}>Not measured — the owner snapshot carries no cost summary yet.</p>;
  }
  const measured = spending.measuredUsd !== null
    ? `$${spending.measuredUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : "not measured";
  const unmeasured = spending.attemptsUnmeasured > 0 ? "present" : "none";
  const complete = spending.attemptsUnmeasured === 0 && spending.measuredUsd !== null;
  return (
    <dl className="ft-spend">
      <div><dt>Measured</dt><dd>{measured}</dd></div>
      <div><dt>Unmeasured rows</dt><dd className={unmeasured === "present" ? "ft-warn" : undefined}>{unmeasured}</dd></div>
      <div><dt>Total</dt><dd className={complete ? undefined : "ft-warn"}>{complete ? measured : "unknown"}</dd></div>
    </dl>
  );
}

function PanelBody({ id, reading }: { readonly id: string; readonly reading: FleetPanelsReading }) {
  if (id === "receipts") {
    const s = receiptLoadingSummary(reading.receiptLoading);
    const src = receiptSourceSummary(reading.receiptSource);
    return (
      <div className="note" style={{ display: "grid", gap: 4 }}>
        <span>{s.text}</span>
        {src && <span>{src.text}</span>}
        {s.caveat && <span>{s.caveat}</span>}
      </div>
    );
  }
  if (id === "spending") return <SpendingRows spending={reading.spending} />;
  if (id === "coverage") {
    const c = reading.coverageGaps;
    if (c.kind !== "HELD") {
      return <p className="note" style={{ margin: 0 }}>Coverage instrument unavailable — {c.kind === "STORE_UNREACHABLE" ? c.detail : "not recorded"}.</p>;
    }
    const zip = c.value.zipRows;
    return (
      <p className="note" style={{ margin: 0 }}>
        {zip.held
          ? `${zip.value.length} ZIP row(s), snapshot published ${c.value.publishedAt}. ${NOTES.coverage}`
          : `${zip.gap.says} (snapshot ${c.value.publishedAt}).`}
      </p>
    );
  }
  if (id === "served") {
    return (
      <p className="note" style={{ margin: 0 }}>
        publication.status is the literal <strong>UNKNOWN</strong> and its reason names the missing join.
        There is no producer for served-reader proof in any read file; this panel stays empty until that
        evidence exists.
      </p>
    );
  }
  // throughput / demand
  return <p className="note" style={{ margin: 0 }}>No producer. Building this needs a new persisted series — a backend dependency, not a rendering task. Named, not faked.</p>;
}

export function FleetPanelsTab({ reading }: { readonly reading: FleetPanelsReading }) {
  const reads = FLEET_MAP_PANELS.filter((p) => p.producer !== "NO_PRODUCER");
  const noProducer = FLEET_MAP_PANELS.filter((p) => p.producer === "NO_PRODUCER");
  return (
    <section className="fleet-tab" aria-label="Panels">
      <div className="fleet-tab-head">
        <div>
          <h2>Six panels. <span className="ft-accent">{reads.length} read something.</span></h2>
          <p className="note">
            Until now all six rendered as equal cards in one grid, so an empty panel and a measured one
            looked alike until you read the badge.
          </p>
        </div>
      </div>

      <div className="ft-group-header">
        <span className="ft-chip" aria-hidden="true" />
        <span className="ft-group-label">Reads something · {reads.length}</span>
        <span className="ft-rule" aria-hidden="true" />
      </div>
      <div className="ft-panels-grid">
        {reads.map((p) => (
          <div key={p.id} className="ft-panel-card">
            <div className="ft-panel-head">
              <strong>{p.title}</strong>
              <span className={`ft-status ${p.producer === "WIRED" ? "ft-status-wired" : "ft-status-partial"}`}>
                {p.producer === "WIRED" ? "Wired" : "Partial"}
              </span>
            </div>
            <PanelBody id={p.id} reading={reading} />
            {p.note && <p className="note ft-panel-caveat">{p.note}</p>}
          </div>
        ))}
      </div>

      <div className="ft-group-header ft-group-header-dashed">
        <span className="ft-chip ft-chip-dashed" aria-hidden="true" />
        <span className="ft-group-label">No producer · {noProducer.length}</span>
        <span className="ft-rule" aria-hidden="true" />
      </div>
      <p className="note ft-no-producer-lede">
        Amber means a reading that will arrive. These three have no producer anywhere in the codebase —
        there is no reading to be late, and refreshing forever changes nothing. The dashed treatment is
        what says so.
      </p>
      <div className="ft-panels-grid">
        {noProducer.map((p) => (
          <div key={p.id} className="ft-panel-card ft-panel-card-dashed">
            <div className="ft-panel-head">
              <strong>{p.title}</strong>
            </div>
            <PanelBody id={p.id} reading={reading} />
          </div>
        ))}
      </div>

      <p className="note ft-panels-footer">
        {FLEET_MAP_CONTRACTS} · deliveryFreshness {reading.deliveryFreshness}. {NOTES.delivery}
      </p>
    </section>
  );
}
