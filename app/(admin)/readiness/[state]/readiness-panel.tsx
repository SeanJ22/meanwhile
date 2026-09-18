"use client";

/**
 * The interactive readiness panel (client). It renders a `ReadinessStateSnapshot`
 * that the server component already read and audited — it never fetches, never
 * writes, and holds no status of its own. Every colour, count and bar traces to a
 * derived cell in the snapshot. The evidence drawer is pure React state: it never
 * touches history, because the Next router owns history and an overlay that pushes
 * to it remounts this island and dies on open.
 */
import { useMemo, useState, type ReactNode } from "react";

import { formatCalendarDate } from "@/lib/control-plane/eastern-time.ts";
import type { Measured } from "@/lib/control-plane/owner-surface.ts";
// The source, vintage and geography the population figures come from, named on
// the face because §9A.19 requires it and because a ZCTA is not a town.
import {
  ACS_SOURCE_LABEL,
  ACS_VINTAGE_LABEL,
  ACS_ZCTA_GEOGRAPHY_LABEL,
} from "@/lib/reference/acs-labels.ts";
import { count, plainCode, plainMeaning } from "@/lib/control-plane/plain-words.ts";
import {
  GATE_DEFINITION,
  GATE_LABEL,
  GATE_ORDER,
  type CellState,
  type GateCell,
} from "@/lib/control-plane/readiness/gates.ts";
import {
  type CapabilityRow,
  type EvidenceWalk,
  type JurisdictionLevel,
  type ReaderDelivery,
  type ReadinessStateSnapshot,
  type RungOutcome,
  type ZipPopulationBasis,
  type ZipRow,
  rowIsCurrent,
  rowIsGatedOnOperator,
} from "@/lib/control-plane/readiness/model.ts";

// The swatches, legend and tiles are the console's shared primitives (9.4.26):
// one implementation for this panel and for Pilot Health.
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";
import { DeployFleet } from "@/app/(admin)/admin/deploy-fleet.tsx";
import { LEVEL_CLASS, type JurisdictionLevel as ColourLevel } from "@/lib/control-plane/display-name.ts";

import { LevelLegend, QueueButton, STATE_CLASS, ReadinessLegend, Tile, When, heldFigure } from "../../console-ui.tsx";

/** The console's four colours for the readiness taxonomy's six levels (ADM-21): county, municipal and special are local. */
const COLOUR_LEVEL: Record<JurisdictionLevel, ColourLevel> = { federal: "federal", state: "state", county: "local", municipal: "local", school: "school", special: "local" };
/** The level tag beside a capability, in words rather than the raw enum. */
const LEVEL_WORDS: Record<JurisdictionLevel, string> = {
  federal: "federal",
  state: "statewide",
  county: "county",
  municipal: "city and town",
  school: "school",
  special: "special district",
};
/*
 * Every cell state on this page renders through `plainCode` — `NOT_WALKED`
 * reads "Not checked yet", `ARGUED_ABSENT` reads "Looked for, does not exist" —
 * and the raw constant survives on the hover and in the drawer. The console's
 * shared per-state word map is Pilot Health's vocabulary and is deliberately not
 * reached into from here: this panel passes its own words, from the one
 * dictionary, so a second drifting list of state words cannot appear.
 */
/**
 * The panel's own display label for a coverage tier (§5.4). One word for one
 * scale: this map used to call the floor a Level and everything above it a
 * Tier, which reads as two different scales — and the floor's old wording is
 * the exact phrase the ZIP row's own gap sentence says must never be printed
 * for a ZIP whose tier was never stamped.
 */
const TIER_DISPLAY: Record<string, string> = {
  TIER_0: "Tier 0",
  TIER_1: "Tier 1",
  TIER_2: "Tier 2",
  TIER_3: "Tier 3",
};
const RUNG_CLASS: Record<RungOutcome, string> = {
  WALKED_AND_FOUND: "rq-found",
  WALKED_AND_EMPTY: "rq-empty",
  DOES_NOT_EXIST: "rq-none",
};

const LEVEL_FILTERS: readonly (JurisdictionLevel | "all")[] = [
  "all",
  "federal",
  "state",
  "county",
  "municipal",
  "school",
  "special",
];
const ROW_FILTERS = ["all", "not-current", "gated"] as const;
type RowFilter = (typeof ROW_FILTERS)[number];
type ZipSort = "readiness" | "zip" | "population" | "gap";

const fraction = (m: Measured): number => (m.denominator > 0 ? m.value / m.denominator : 0);
/** The completeness bar colour tracks PROGRESS (how far along), not the worst body. */
const barClass = (pct: number): string =>
  pct >= 0.67 ? "rq-current" : pct >= 0.34 ? "rq-partial" : "rq-blocked";
const rank: Record<CellState, number> = {
  CURRENT: 5,
  ARGUED_ABSENT: 5,
  PARTIAL_OR_STALE: 3,
  GATED_ON_OPERATOR: 2,
  BLOCKED: 1,
  NOT_WALKED: 0,
};

export function ReadinessPanel(props: {
  snapshot: ReadinessStateSnapshot;
  notice: string | null;
  /** True when this is a real published snapshot; false when it is the synthetic
   *  render-time NOT_WALKED placeholder for a state with no published record. */
  published: boolean;
  source: string;
}) {
  const { snapshot } = props;
  const [level, setLevel] = useState<JurisdictionLevel | "all">("all");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [zipSort, setZipSort] = useState<ZipSort>("readiness");
  const [drawer, setDrawer] = useState<{ row: CapabilityRow; cell: GateCell } | null>(null);

  const rows = useMemo(() => {
    return snapshot.capabilities.filter((r) => {
      if (level !== "all" && r.level !== level) return false;
      if (rowFilter === "not-current" && rowIsCurrent(r)) return false;
      if (rowFilter === "gated" && !rowIsGatedOnOperator(r)) return false;
      return true;
    });
  }, [snapshot.capabilities, level, rowFilter]);

  const zips = useMemo(() => sortZips(snapshot.zips, zipSort), [snapshot.zips, zipSort]);
  const walkByRef = useMemo(
    () => new Map(snapshot.evidenceWalks.map((w) => [w.ref, w])),
    [snapshot.evidenceWalks],
  );

  // Render rows grouped by domain, but only domains with a visible row.
  const domains = useMemo(() => {
    const order: string[] = [];
    const byDomain = new Map<string, CapabilityRow[]>();
    for (const r of rows) {
      if (!byDomain.has(r.domain)) {
        byDomain.set(r.domain, []);
        order.push(r.domain);
      }
      byDomain.get(r.domain)!.push(r);
    }
    return order.map((d) => ({ domain: d, rows: byDomain.get(d)! }));
  }, [rows]);

  return (
    <>
      <h1>
        State readiness — {snapshot.stateName}{" "}
        <span className="note" style={{ fontSize: ".8rem", fontWeight: 400 }}>
          {props.published ? (
            <>
              last updated <When iso={snapshot.publishedAt} /> by {snapshot.publisher}
              {snapshot.publishedFromSha ? <span title={snapshot.publishedFromSha}> at commit {snapshot.publishedFromSha.slice(0, 8)}</span> : null}
            </>
          ) : (
            <>
              no published snapshot — rendered <When iso={snapshot.publishedAt} />
            </>
          )}
        </span>
      </h1>

      {!props.published && (
        <div className="rq-unpublished" role="status">
          <strong>Nobody has measured {snapshot.stateName} yet.</strong> No readiness run has ever
          looked at this state, so every cell below reads &ldquo;not checked yet&rdquo; — the{" "}
          <em>absence of a measurement</em>, not a run that looked everywhere and found nothing.{" "}
          <strong>Needs you: No.</strong> The standing runner measures a state once it is added to
          the readiness publisher&rsquo;s list; nothing here is waiting on a decision from you.
        </div>
      )}

      <div className="rq-controls">
        <label>
          Jurisdiction level
          <select value={level} onChange={(e) => setLevel(e.target.value as JurisdictionLevel | "all")}>
            {LEVEL_FILTERS.map((l) => (
              <option key={l} value={l}>
                {l === "all" ? "All levels" : l[0].toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rows
          <select value={rowFilter} onChange={(e) => setRowFilter(e.target.value as RowFilter)}>
            <option value="all">All rows</option>
            <option value="not-current">Not current</option>
            <option value="gated">Gated on you</option>
          </select>
        </label>
      </div>

      {props.notice && <p className="note">{props.notice}</p>}
      <p className="rq-source">Source: {props.source}.</p>

      <SummaryBand snapshot={snapshot} />

      <h2>Capabilities</h2>
      <ReadinessLegend />
      <LevelLegend />
      <div className="rq-gridwrap">
        <table className="rq-grid">
          <thead>
            <tr>
              <th>Capability</th>
              {GATE_ORDER.map((g) => (
                <th key={g} className="rq-gatecol" title={GATE_DEFINITION[g]}>
                  {GATE_LABEL[g]}
                </th>
              ))}
              <th style={{ textAlign: "right" }}>Coverage · as of</th>
            </tr>
          </thead>
          <tbody>
            {domains.length === 0 && (
              <tr>
                <td colSpan={GATE_ORDER.length + 2} className="note">
                  No capability rows match this filter.
                </td>
              </tr>
            )}
            {domains.map(({ domain, rows: drows }) => (
              <RowsForDomain
                key={domain}
                domain={domain}
                rows={drows}
                onCell={(row, cell) => setDrawer({ row, cell })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ReaderDeliveryBlock
        delivery={snapshot.delivery}
        capabilities={snapshot.capabilities}
        stateName={snapshot.stateName}
      />

      {snapshot.monotonicityViolations.length > 0 && (
        <div className="rq-violations">
          <h3>
            {snapshot.monotonicityViolations.length === 1
              ? "One step is finished ahead of the step before it"
              : `${snapshot.monotonicityViolations.length} steps are finished ahead of the step before them`}
          </h3>
          <p className="note">
            A step cannot be finished past a gap to its left. These have direct evidence anyway —
            usually because the two steps were measured over different things. They are shown here
            rather than silently rendered as done. <strong>Needs you: No.</strong> Each one is a
            measurement to reconcile, not a decision.
          </p>
          <ul>
            {snapshot.monotonicityViolations.map((v, i) => (
              <li key={`${v.capabilityId}:${v.gate}:${i}`}>
                <span title={v.capabilityId}>
                  {snapshot.capabilities.find((c) => c.capabilityId === v.capabilityId)?.label ?? v.capabilityId}
                </span>{" "}
                · {(GATE_LABEL as Record<string, string>)[v.gate] ?? v.gate} — {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>Zip codes in {snapshot.stateName}</h2>
      <ZipTable zips={zips} sort={zipSort} onSort={setZipSort} stateCode={snapshot.state} stateName={snapshot.stateName} />
      {/*
        §9A.10 / §9A.19: the population number must name its source, its year and
        its geography on the face. It is a ZIP Code Tabulation Area estimate —
        not a city or town estimate, not a county figure, and not a Population
        Estimates Program value, and a ZCTA boundary is not a town's boundary.
      */}
      <p className="note">
        <strong>Where the population comes from.</strong> Each figure is the{" "}
        {ACS_SOURCE_LABEL}, {ACS_VINTAGE_LABEL} (table B01003), for that ZIP&rsquo;s{" "}
        {ACS_ZCTA_GEOGRAPHY_LABEL} — the Census Bureau&rsquo;s own approximation of the ZIP, built
        from census blocks. It is not a city or town estimate, not a county figure, and not a
        Population Estimates Program value, and the tabulation area&rsquo;s boundary is not the
        town&rsquo;s. 2024 is the newest 5-year release the Bureau publishes for this geography.
        These are survey estimates, so each carries the Bureau&rsquo;s own 90% margin of error where
        it published one; an estimate that its margin reaches is reported as such rather than as a
        count.
      </p>
      <p className="note">
        Two different measures, kept apart. <strong>Resident readiness</strong> is worst-of every
        governing body overlapping the zip, never an average: a zip is complete for a resident only
        when every body they belong to is resolved, so the single least-ready body governs and is
        named. <strong>Progress</strong> is how far along the zip&rsquo;s bodies are overall,
        weighted by how ready each is — a work measure, not a completeness claim. The Level tag is
        the worst-of coverage-tier floor.
      </p>

      {drawer && (
        <EvidenceDrawer
          row={drawer.row}
          cell={drawer.cell}
          walk={drawer.cell.evidenceRef ? (walkByRef.get(drawer.cell.evidenceRef) ?? null) : null}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}

function RowsForDomain(props: {
  domain: string;
  rows: readonly CapabilityRow[];
  onCell: (row: CapabilityRow, cell: GateCell) => void;
}) {
  return (
    <>
      <tr className="rq-domain">
        <td colSpan={GATE_ORDER.length + 2}>{props.domain}</td>
      </tr>
      {props.rows.map((row) => (
        <tr key={row.capabilityId}>
          <td>
            {row.label}{" "}
            <span className={`rq-level ${LEVEL_CLASS[COLOUR_LEVEL[row.level]]}`} title={row.capabilityId}>
              <i className="lvl-dot" aria-hidden="true" />
              {LEVEL_WORDS[row.level]}
            </span>
          </td>
          {row.gates.map((cell) => (
            <td key={cell.gate} className="rq-gatecell">
              {/*
                The swatch alone could not tell "there is no data" from "this is
                live and the proof is stale" — both are the amber state, and the
                owner read the amber as nothing (§9A.9). So every cell carries
                its own words: the cell's `says` when the derivation has a
                sentence for it, otherwise the state's short word. The full
                phrase and the raw state stay on the hover.
              */}
              <button
                type="button"
                className={`rq-cell ${STATE_CLASS[cell.state]}${cell.monotonicityOk ? "" : " rq-violation"}`}
                title={`${GATE_LABEL[cell.gate]} — ${cell.says}${cell.asOf ? ` · as of ${cell.asOf}` : ""}. ${cell.detail} [${cell.state}]`}
                aria-label={`${row.label} — ${GATE_LABEL[cell.gate]}: ${cell.says}`}
                onClick={() => props.onCell(row, cell)}
              />
              <span className="rq-cellword" aria-hidden="true">
                {cellWord(cell)}
              </span>
            </td>
          ))}
          <td className="rq-cov">
            {row.coverageLabel}
            {row.asOf ? ` · ${shortDate(row.asOf)}` : ""}
            {row.coverageSays && <div className="rq-covsays">{row.coverageSays}</div>}
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * **THE FOUR TILES, EACH WITH AN INSTRUMENT BEHIND IT.** (ADM-39, §9A.7.)
 *
 * Two of these used to render a bare em dash on every load, because nothing
 * could ever fill them: there was no reader-visible count of jurisdictions, and
 * no recorded full research pass. *Do not render a dash as though it were a
 * metric* — so both were replaced by the question they were reaching for, each
 * answerable from a committed instrument, and each tile now says what fills it.
 */
function SummaryBand({ snapshot }: { snapshot: ReadinessStateSnapshot }) {
  const s = snapshot.summary;
  const oldest = s.oldestEvidence;
  return (
    <div className="rq-summary">
      <Tile
        figure={s.capabilitiesServedToReaders.held ? heldFigure(s.capabilitiesServedToReaders) : "Not checked yet"}
        caption="Rows below the Reader is served from — the rest are held, blocked, or not looked at yet"
        held={s.capabilitiesServedToReaders}
      />
      <Tile
        figure={
          s.populationInCompleteZip.held
            ? `${count(s.populationInCompleteZip.value.value)} / ${count(s.populationInCompleteZip.value.denominator)}`
            : "Not checked yet"
        }
        caption="People living in a ZIP where every one of their governments is resolved"
        held={s.populationInCompleteZip}
      />
      {/* Never a bare dash: an unfilled figure says what it is (§9A.7). */}
      <Tile
        figure={oldest.held ? formatCalendarDate(oldest.value) : "Not checked yet"}
        caption="Oldest evidence on this grid — a re-walk of that source is what moves it"
        gapText={oldest.held ? null : oldest.gap.says}
      />
      <Tile
        figure={String(s.gatedOnOperatorCount)}
        caption={
          s.gatedOnOperatorCount === 0
            ? `Nothing here is waiting on a decision from you, of ${snapshot.capabilities.length * GATE_ORDER.length} cells in the grid`
            : `Cells waiting on a decision from you, of ${snapshot.capabilities.length * GATE_ORDER.length} cells in the grid`
        }
      />
    </div>
  );
}

/**
 * **WHAT THE READER IS BEING SERVED, IN ONE PLACE.** (ADM-40, §9A.9.)
 *
 * The owner's finding was that the Admin claimed nothing where the live site
 * plainly had something. The grid now says so per cell; this block says it in
 * full sentences, per holding, with the counts and the declaration behind them —
 * so "we have candidate listings in New Hampshire, live right now" can be
 * checked against this page in one read rather than disproved by opening the
 * site.
 *
 * Every line is derived. Nothing here asserts a rendering: the last sentence of
 * each line is what the declaration does NOT prove.
 */
function ReaderDeliveryBlock({
  delivery,
  capabilities,
  stateName,
}: {
  delivery: readonly ReaderDelivery[];
  capabilities: readonly CapabilityRow[];
  stateName: string;
}) {
  const labelOf = (id: string) => capabilities.find((c) => c.capabilityId === id)?.label ?? id;
  if (delivery.length === 0) {
    return (
      <>
        <h2>What the Reader is being served</h2>
        <p className="note">
          No committed holding for {stateName} is declared an input to a reader surface yet, so
          nothing on this page claims the site is serving anything here. That is a gap in what has
          been checked, not a finding that the site shows nothing.
        </p>
      </>
    );
  }
  return (
    <>
      <h2>What the Reader is being served</h2>
      <p className="note">
        Each line is a committed holding this state&rsquo;s rows live in, and the reader surface the
        canonical dataset contract declares reads it. That is a standing declaration and not a count
        of rows a reader saw today, so each of those cells in the grid above reads{" "}
        <strong>Shown on the Reader · verification proof needs a fresh check</strong> — never
        &ldquo;no data&rdquo; and never an empty cell for something that is live.{" "}
        <strong>Needs you: No.</strong> A fresh reader readback is what turns those cells green;
        nothing here is waiting on a decision from you.
      </p>
      <ul className="rq-delivery">
        {delivery.map((d) => (
          <li key={`${d.capabilityId}:${d.holding}`}>
            <strong>{labelOf(d.capabilityId)}</strong> — {count(d.rows)} {d.unit} held for {stateName}
            {d.asOf ? <>, as of {formatCalendarDate(d.asOf)}</> : null}.{" "}
            <span className="rq-delivery-where">
              Served on: {d.surfaces.length > 0 ? d.surfaces.join(", ") : "a reader route"}
              {d.askAnswers ? " · Ask answers from it" : ""}
            </span>
            <div className="rq-delivery-src" title={d.holding}>
              {d.routes.length > 0
                ? `The ${d.routes.join(" and ")} route(s) must be able to read this holding, and the build fails when they cannot.`
                : "The dataset contract names the reader surface for this holding; no route trace is declared for it."}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function ZipTable(props: {
  zips: readonly ZipRow[];
  sort: ZipSort;
  onSort: (s: ZipSort) => void;
  stateCode: string;
  stateName: string;
}) {
  const hdr = (key: ZipSort, label: string) => (
    <button type="button" onClick={() => props.onSort(key)} aria-pressed={props.sort === key}>
      {label}
      {props.sort === key ? " ▾" : ""}
    </button>
  );
  return (
    <div className="rq-gridwrap">
      <table className="rq-zip">
        <thead>
          <tr>
            <th>{hdr("zip", "Zip")}</th>
            <th>Place</th>
            <th>Bodies</th>
            <th>Level</th>
            <th>Resident readiness</th>
            <th>{hdr("readiness", "Progress")}</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {props.zips.length === 0 && (
            <tr>
              <td colSpan={7} className="note">
                No zip readiness computed for this state yet.
              </td>
            </tr>
          )}
          {props.zips.map((z) => {
            // Resident readiness is WORST-OF: a zip is complete for a resident
            // only when every governing body they belong to is resolved (CURRENT
            // or ARGUED_ABSENT). The bar to the right is PROGRESS, a different
            // measure, and never stands in for this.
            const residentComplete = rank[z.worstState] >= rank.CURRENT;
            return (
            <tr key={z.zip} className={z.isPilot ? "rq-pilot" : undefined}>
              <td>
                {z.zip}
                {z.isPilot && <span className="rq-pilot-tag">pilot</span>}
              </td>
              <td>
                {z.place.held ? z.place.value : <span className="gap">{z.place.gap.says}</span>}
                <div className="rq-worstgap">
                  {z.population.held ? (
                    <span title={`${z.population.value.contract} — ${z.population.value.denominatorSource}`}>
                      {populationSentence(z)}
                    </span>
                  ) : (
                    <span className="gap">{z.population.gap.says}</span>
                  )}
                </div>
              </td>
              <td>{z.bodyCount}</td>
              <td className="rq-level">
                {z.level.held ? (
                  <span title={z.level.value}>{TIER_DISPLAY[z.level.value] ?? plainCode(z.level.value)}</span>
                ) : (
                  <span className="gap">{z.level.gap.says}</span>
                )}
              </td>
              <td>
                <span className={`rq-cell ${STATE_CLASS[z.worstState]}`} />{" "}
                {residentComplete ? "complete" : "not complete"}
                <div className="rq-worstgap">
                  {residentComplete
                    ? "every governing body a resident belongs to is resolved (worst-of)"
                    : `least ready of this ZIP's governments: ${plainGap(z.worstGap)} — ${plainCode(z.worstState).toLowerCase()}`}
                </div>
              </td>
              <td>
                {z.completeness.held ? (
                  <>
                    <div className="rq-barwrap">
                      <div className="rq-bartrack">
                        <div
                          className={`rq-bar ${barClass(fraction(z.completeness.value))}`}
                          style={{ width: `${Math.round(fraction(z.completeness.value) * 100)}%` }}
                        />
                      </div>
                      <span
                        className="rq-pct"
                        title={`${z.completeness.value.value} of ${z.completeness.value.denominator} — ${z.completeness.value.contract}; denominator from ${z.completeness.value.denominatorSource}`}
                      >
                        {Math.round(fraction(z.completeness.value) * 100)}%
                      </span>
                    </div>
                    <div className="rq-worstgap">how far along, weighted by readiness</div>
                  </>
                ) : (
                  <>
                    <span className="rq-pct" title={z.completeness.gap.says}>not measured</span>
                    <div className="rq-worstgap">body readiness is not walked in this snapshot</div>
                  </>
                )}
              </td>
              <td className="rq-next">
                <NextStep zip={z} residentComplete={residentComplete} stateCode={props.stateCode} stateName={props.stateName} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <div className="rq-controls" style={{ marginTop: ".5rem" }}>
        <label>
          Sort by
          <select value={props.sort} onChange={(e) => props.onSort(e.target.value as ZipSort)}>
            <option value="readiness">Progress</option>
            <option value="zip">Zip</option>
            <option value="population">Population</option>
            <option value="gap">Largest gap</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function EvidenceDrawer(props: {
  row: CapabilityRow;
  cell: GateCell;
  walk: EvidenceWalk | null;
  onClose: () => void;
}) {
  const { row, cell, walk } = props;
  return (
    <div className="rq-drawer-backdrop" onClick={props.onClose} role="presentation">
      <aside
        className="rq-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.label} — ${GATE_LABEL[cell.gate]} evidence`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="rq-drawer-close" onClick={props.onClose}>
          Close
        </button>
        <h2>
          {row.label} · {GATE_LABEL[cell.gate]}
        </h2>
        <p className="rq-drawer-meta">
          <span title={cell.state}>{cell.says}</span>
          {cell.asOf ? ` · as of ${shortDate(cell.asOf)}` : ""}
          {walk ? ` · ${walk.rungCount} rungs · ${walk.sessionCount} sessions · vault ${walk.vaultId}` : ""}
        </p>

        <p className="note">{GATE_DEFINITION[cell.gate]}</p>
        <p>{cell.detail}</p>
        {plainMeaning(cell.state) && (
          <p className="note">
            <strong>{plainCode(cell.state)}</strong> — {plainMeaning(cell.state)}
          </p>
        )}

        {walk ? (
          <>
            {walk.rungs.map((r, i) => (
              <div key={`${r.at}:${i}`} className={`rq-rung ${RUNG_CLASS[r.outcome]}`}>
                <span className="rq-rung-mark" />
                <div className="rq-rung-when">{rungWhen(r.at)}</div>
                <div>
                  <strong>{r.path}</strong>
                </div>
                <div className="note">{r.observed}</div>
                {r.nextHop && <div className="note">→ next hop: {r.nextHop}</div>}
                {r.vaultRef && <div className="note">capture: {r.vaultRef}</div>}
              </div>
            ))}
            {walk.closed && walk.absenceArgument ? (
              <div className="rq-argument">
                <strong>Absence argument</strong>
                <p>{walk.absenceArgument}</p>
              </div>
            ) : (
              <p className="note">
                Walk not closed.{" "}
                {walk.nextUnwalkedRung
                  ? `Next unwalked rung: ${walk.nextUnwalkedRung}.`
                  : "The next unwalked rung was not recorded."}
              </p>
            )}
          </>
        ) : (
          <div className="rq-argument">
            <p className="note">
              No rung-level walk is projected into this snapshot for this cell. The state above is
              derived from coverage and freshness; where a closed walk exists in the vault, the
              publisher projects its rungs here. This cell has none on record yet — which is a gap in
              this panel&rsquo;s projection, not a claim that no walk was ever done.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * **WHAT TO DO ABOUT THIS ZIP, ONE STEP PAST WHAT THE ROW ALREADY KNOWS.**
 * (ADM-15, the 9.4.26 evening admin feedback.)
 *
 * The owner's words: *"maybe it suggests \"Deploy Fleet Here\" or specific
 * pointers, like \"Hey go get this one thing\""*. The row already names its
 * least-ready body and its worst state; the suggestion is that pair read as an
 * instruction, and the button is the existing Deploy-fleet intent aimed at this
 * ZIP — it reorders registered work, it never invents any (ADM-8).
 */
function NextStep({ zip, residentComplete, stateCode, stateName }: { zip: ZipRow; residentComplete: boolean; stateCode: string; stateName: string }) {
  const place = zip.place.held ? zip.place.value : zip.zip;
  const target = `${zip.zip} ${place}, ${stateName}: ${zip.worstGap}`.slice(0, INTENT_NOTE_MAX_CHARS);
  /*
   * §9A.16: the owner has deliberately never pressed this button, because it
   * did not say what it would do. It now opens the same preview the console
   * home uses — what this means, how many owed records match, what it will NOT
   * do, and what happens after — and sends through the one typed Action
   * Gateway. Same component, same explanation, wherever the button appears.
   */
  const deploy = (label: string) => (
    <DeployFleet returnTo={`/readiness/${stateCode}`} maxChars={INTENT_NOTE_MAX_CHARS} prefill={target} label={label} />
  );
  if (residentComplete) return <span className="note">Nothing to do — every governing body a resident belongs to is resolved.</span>;
  const body = plainGap(zip.worstGap);
  switch (zip.worstState) {
    case "BLOCKED":
      return (
        <>
          <strong>Go get this one thing:</strong> {body} — the route we walked hit a wall, so it needs another path.
          {deploy("Deploy fleet here")}
        </>
      );
    case "NOT_WALKED":
      return (
        <>
          <strong>Nobody has looked yet:</strong> {body} has not been walked.
          {deploy("Deploy fleet here")}
        </>
      );
    case "PARTIAL_OR_STALE":
      return (
        <>
          <strong>Refresh:</strong> {body} is partial or stale; a re-walk brings it current.
          {deploy("Deploy fleet here")}
        </>
      );
    case "GATED_ON_OPERATOR":
      return (
        <>
          <strong>Waiting on you:</strong> {body} is gated on your decision — see <a href="/admin#decisions">Decisions</a> on Pilot health.
          <QueueButton where={`State readiness · ${stateName} ${zip.zip}`} says={`${body} is gated on the operator`} returnTo={`/readiness/${stateCode}`} compact />
        </>
      );
    default:
      return <span className="note">{body}</span>;
  }
}

/**
 * A least-ready-body descriptor the publisher could only key, read as words:
 * `GOVERNING (NOT_ATTEMPTED)` is a governing body nobody has tried yet. A
 * named body passes through untouched.
 */
function plainGap(gap: string): string {
  if (!/^[A-Z_]+( \([A-Z_]+\))?$/.test(gap.trim())) return gap;
  return gap
    .replace(/^GOVERNING/, "the governing body")
    .replace(/_/g, " ")
    .replace(/\(([A-Z ]+)\)/, (_, code: string) => `(${code.toLowerCase()})`)
    .replace(/^([A-Z][A-Z ]*)(?= \()/, (code) => code.toLowerCase());
}

/* --------------------------------------------------------------- helpers */

/**
 * **THE WORDS UNDER A GRID CELL.**
 *
 * The swatch alone could not tell "there is no data here" from "this is live on
 * the Reader and the formal proof is stale": both are the amber state, and the
 * owner read the amber as nothing. So every cell carries words. A cell whose
 * derivation supplied its own sentence uses its leading clause — that is how
 * "Shown on the Reader" reaches the face — and everything else gets the state's
 * short word. The whole sentence, including the half after the middle dot, is on
 * the hover, in the evidence drawer, and spelled out in the delivery block below
 * the grid; a column five wide cannot carry a full sentence and stay readable.
 */
function cellWord(cell: GateCell): string {
  const derived = (cell.says ?? "").trim();
  return (derived === "" ? plainCode(cell.state) : derived).split(" · ")[0];
}

/**
 * **THE ZIP'S POPULATION AS A SENTENCE, NOT A BARE NUMBER.** (ADM-41, §9A.10.)
 *
 * The owner's objection was seeing `0 people` presented as a fact about a place
 * where people live, and `32 people` beside a town's name. Both were faithful
 * American Community Survey values and both said more than the Bureau does. So:
 *
 *   - an estimate of zero says the tabulation area records no residents, with
 *     the year, and never "0 people";
 *   - an estimate its own margin of error reaches says so, because it is not
 *     distinguishable from zero at the Bureau's 90% confidence;
 *   - every other estimate carries its ± margin, so no estimate is ever printed
 *     as an exact count.
 */
function populationSentence(z: ZipRow): string {
  if (!z.population.held) return z.population.gap.says;
  const people = z.population.value.value;
  const margin = z.populationMargin;
  const year = ACS_VINTAGE_LABEL;
  const basis: ZipPopulationBasis = z.populationBasis;
  if (basis === "RECORDED_AS_NONE") {
    return `No residents are recorded in this ZIP's Census tabulation area (${year}${margin === null ? "" : `, margin of error ±${count(margin)}`})`;
  }
  if (basis === "WITHIN_MARGIN_OF_ERROR") {
    return `About ${count(people)} people — but the Census margin of error is ±${count(margin ?? 0)}, so this estimate is not distinguishable from zero (${year})`;
  }
  return margin === null
    ? `${count(people)} people (${year})`
    : `${count(people)} ± ${count(margin)} people (${year})`;
}

/**
 * A rung's stamp as the owner reads it: a bare date is the calendar day it
 * names, never shifted through UTC; an instant is Eastern time with its year.
 */
function rungWhen(at: string): ReactNode {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at.trim())) return formatCalendarDate(at);
  return <When iso={at} year />;
}

function sortZips(zips: readonly ZipRow[], sort: ZipSort): ZipRow[] {
  const arr = [...zips];
  switch (sort) {
    case "zip":
      return arr.sort((a, b) => a.zip.localeCompare(b.zip));
    case "population":
      return arr.sort((a, b) => popValue(b) - popValue(a)); // largest first, gaps last
    case "gap":
      return arr.sort((a, b) => completenessValue(a) - completenessValue(b)); // biggest gap first
    case "readiness":
    default:
      // Most-complete first (progress), then least-ready floor as the tiebreak.
      return arr.sort(
        (a, b) => completenessValue(b) - completenessValue(a) || rank[b.worstState] - rank[a.worstState],
      );
  }
}
function popValue(z: ZipRow): number {
  return z.population.held ? z.population.value.value : -1;
}
/** Sort key for completeness: its fraction when measured, -1 when "not measured"
 *  so unmeasured zips sort last, the same way `popValue` treats a population gap. */
function completenessValue(z: ZipRow): number {
  return z.completeness.held ? fraction(z.completeness.value) : -1;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : iso;
}
