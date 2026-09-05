"use client";

/**
 * The interactive readiness panel (client). It renders a `ReadinessStateSnapshot`
 * that the server component already read and audited — it never fetches, never
 * writes, and holds no status of its own. Every colour, count and bar traces to a
 * derived cell in the snapshot. The evidence drawer is pure React state: it never
 * touches history, because the Next router owns history and an overlay that pushes
 * to it remounts this island and dies on open.
 */
import { useMemo, useState } from "react";

import type { Measured } from "@/lib/control-plane/owner-surface.ts";
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
  type ReadinessStateSnapshot,
  type RungOutcome,
  type ZipRow,
  rowIsCurrent,
  rowIsGatedOnOperator,
} from "@/lib/control-plane/readiness/model.ts";

// The swatches, legend and tiles are the console's shared primitives (9.4.26):
// one implementation for this panel and for Pilot Health.
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";
import { LEVEL_CLASS, type JurisdictionLevel as ColourLevel } from "@/lib/control-plane/display-name.ts";

import { LevelLegend, QueueButton, STATE_CLASS, STATE_HUMAN, ReadinessLegend, Tile, When, heldFigure } from "../../console-ui.tsx";

/** The console's four colours for the readiness taxonomy's six levels (ADM-21): county, municipal and special are local. */
const COLOUR_LEVEL: Record<JurisdictionLevel, ColourLevel> = { federal: "federal", state: "state", county: "local", municipal: "local", school: "school", special: "local" };
const INTENT_ROUTE = "/api/admin/research";
/** The panel's own display label for a coverage tier (introduced here — §5.4). */
const TIER_DISPLAY: Record<string, string> = {
  TIER_0: "Level 0",
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
          <strong>NO PUBLISHED READINESS SNAPSHOT for {snapshot.stateName}.</strong> No readiness run
          has ever measured this state. The grid below is rendered <code>NOT_WALKED</code> at read
          time — the <em>absence of a measurement</em>, not a run that measured every cell and found
          nothing. Publish one with <code>pnpm readiness:refresh</code>.
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

      {snapshot.monotonicityViolations.length > 0 && (
        <div className="rq-violations">
          <h3>Gate monotonicity violations — {snapshot.monotonicityViolations.length}</h3>
          <p className="note">
            A gate cannot be current past a gap to its left. These cells claim it anyway; they are
            surfaced here rather than silently rendered as current.
          </p>
          <ul>
            {snapshot.monotonicityViolations.map((v, i) => (
              <li key={`${v.capabilityId}:${v.gate}:${i}`}>
                <code>{v.capabilityId}</code> · {v.gate} — {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>Zip codes in {snapshot.stateName}</h2>
      <ZipTable zips={zips} sort={zipSort} onSort={setZipSort} stateCode={snapshot.state} stateName={snapshot.stateName} />
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
            {row.label} <span className={`rq-level ${LEVEL_CLASS[COLOUR_LEVEL[row.level]]}`}><i className="lvl-dot" aria-hidden="true" />{row.level}</span>
          </td>
          {row.gates.map((cell) => (
            <td key={cell.gate} className="rq-gatecell">
              <button
                type="button"
                className={`rq-cell ${STATE_CLASS[cell.state]}${cell.monotonicityOk ? "" : " rq-violation"}`}
                title={`${GATE_LABEL[cell.gate]}: ${STATE_HUMAN[cell.state]}${cell.asOf ? ` · as of ${cell.asOf}` : ""} — ${cell.detail}`}
                aria-label={`${row.label} — ${GATE_LABEL[cell.gate]}: ${STATE_HUMAN[cell.state]}`}
                onClick={() => props.onCell(row, cell)}
              />
            </td>
          ))}
          <td className="rq-cov">
            {row.coverageLabel}
            {row.asOf ? ` · ${shortDate(row.asOf)}` : " · never"}
          </td>
        </tr>
      ))}
    </>
  );
}

function SummaryBand({ snapshot }: { snapshot: ReadinessStateSnapshot }) {
  const s = snapshot.summary;
  return (
    <div className="rq-summary">
      <Tile
        figure={heldFigure(s.readerVisibleJurisdictions)}
        caption="Reader-visible jurisdictions"
        held={s.readerVisibleJurisdictions}
      />
      <Tile
        figure={heldFigure(s.populationInCompleteZip)}
        caption="Population in a reader-complete zip"
        held={s.populationInCompleteZip}
      />
      <Tile
        figure={s.timeSinceLastFullPass.held ? s.timeSinceLastFullPass.value : "—"}
        caption="Since the last full pass"
        gapText={s.timeSinceLastFullPass.held ? null : s.timeSinceLastFullPass.gap.says}
      />
      <Tile figure={String(s.gatedOnOperatorCount)} caption="Cells gated on you" />
    </div>
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
                      {z.population.value.value.toLocaleString()} people
                    </span>
                  ) : (
                    <span className="gap">{z.population.gap.says}</span>
                  )}
                </div>
              </td>
              <td>{z.bodyCount}</td>
              <td className="rq-level">
                {z.level.held ? (TIER_DISPLAY[z.level.value] ?? z.level.value) : <span className="gap">tier not stamped</span>}
              </td>
              <td>
                <span className={`rq-cell ${STATE_CLASS[z.worstState]}`} />{" "}
                {residentComplete ? "complete" : "not complete"}
                <div className="rq-worstgap">
                  {residentComplete
                    ? "every governing body a resident belongs to is resolved (worst-of)"
                    : `worst-of: ${STATE_HUMAN[z.worstState]} · least-ready body: ${z.worstGap}`}
                </div>
              </td>
              <td>
                <div className="rq-barwrap">
                  <div className="rq-bartrack">
                    <div
                      className={`rq-bar ${barClass(fraction(z.completeness))}`}
                      style={{ width: `${Math.round(fraction(z.completeness) * 100)}%` }}
                    />
                  </div>
                  <span className="rq-pct">{Math.round(fraction(z.completeness) * 100)}%</span>
                </div>
                <div className="rq-worstgap">how far along, weighted by readiness</div>
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
          {STATE_HUMAN[cell.state]}
          {cell.asOf ? ` · as of ${shortDate(cell.asOf)}` : ""}
          {walk ? ` · ${walk.rungCount} rungs · ${walk.sessionCount} sessions · vault ${walk.vaultId}` : ""}
        </p>

        <p className="note">{GATE_DEFINITION[cell.gate]}</p>
        <p>{cell.detail}</p>

        {walk ? (
          <>
            {walk.rungs.map((r, i) => (
              <div key={`${r.at}:${i}`} className={`rq-rung ${RUNG_CLASS[r.outcome]}`}>
                <span className="rq-rung-mark" />
                <div className="rq-rung-when">{r.at}</div>
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
  const deploy = (label: string) => (
    <form method="post" action={INTENT_ROUTE} className="deploy-here">
      <input type="hidden" name="action" value="DISPATCH" />
      <input type="hidden" name="note" value={target} />
      <input type="hidden" name="returnTo" value={`/readiness/${stateCode}`} />
      <button type="submit" className="primary" title={`Records a Deploy-fleet intent: ${target}`}>
        {label}
      </button>
    </form>
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

function sortZips(zips: readonly ZipRow[], sort: ZipSort): ZipRow[] {
  const arr = [...zips];
  switch (sort) {
    case "zip":
      return arr.sort((a, b) => a.zip.localeCompare(b.zip));
    case "population":
      return arr.sort((a, b) => popValue(b) - popValue(a)); // largest first, gaps last
    case "gap":
      return arr.sort((a, b) => fraction(a.completeness) - fraction(b.completeness)); // biggest gap first
    case "readiness":
    default:
      // Most-complete first (progress), then least-ready floor as the tiebreak.
      return arr.sort(
        (a, b) => fraction(b.completeness) - fraction(a.completeness) || rank[b.worstState] - rank[a.worstState],
      );
  }
}
function popValue(z: ZipRow): number {
  return z.population.held ? z.population.value.value : -1;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : iso;
}
