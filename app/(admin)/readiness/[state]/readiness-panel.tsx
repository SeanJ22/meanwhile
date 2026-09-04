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

import type { Held, Measured } from "@/lib/control-plane/owner-surface.ts";
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

const STATE_CLASS: Record<CellState, string> = {
  CURRENT: "rq-current",
  PARTIAL_OR_STALE: "rq-partial",
  NOT_WALKED: "rq-notwalked",
  ARGUED_ABSENT: "rq-argued",
  BLOCKED: "rq-blocked",
  GATED_ON_OPERATOR: "rq-gated",
};
const STATE_HUMAN: Record<CellState, string> = {
  CURRENT: "current",
  PARTIAL_OR_STALE: "partial or stale",
  NOT_WALKED: "not walked",
  ARGUED_ABSENT: "argued absent",
  BLOCKED: "blocked",
  GATED_ON_OPERATOR: "gated on you",
};
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
          published {snapshot.publishedAt} by {snapshot.publisher}
        </span>
      </h1>

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
      <Legend />
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
      <ZipTable zips={zips} sort={zipSort} onSort={setZipSort} />
      <p className="note">
        Score is worst-of every governing body overlapping the zip, never an average. A zip is
        complete only when every body a resident belongs to is complete.
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

function Legend() {
  const items: [CellState, string][] = [
    ["CURRENT", "current"],
    ["PARTIAL_OR_STALE", "partial or stale"],
    ["NOT_WALKED", "not walked"],
    ["ARGUED_ABSENT", "argued absent"],
    ["BLOCKED", "blocked"],
    ["GATED_ON_OPERATOR", "gated on you"],
  ];
  return (
    <div className="rq-legend">
      {items.map(([s, label]) => (
        <span key={s}>
          <i className={`rq-cell ${STATE_CLASS[s]}`} /> {label}
        </span>
      ))}
    </div>
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
            {row.label} <span className="rq-level">· {row.level}</span>
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

function Tile(props: {
  figure: string;
  caption: string;
  held?: Held<Measured>;
  gapText?: string | null;
}) {
  const gapText =
    props.gapText ?? (props.held && !props.held.held ? props.held.gap.says : null);
  return (
    <div className="rq-tile">
      <div className="rq-figure">{props.figure}</div>
      <div className="rq-caption">{gapText ?? props.caption}</div>
    </div>
  );
}

function ZipTable(props: {
  zips: readonly ZipRow[];
  sort: ZipSort;
  onSort: (s: ZipSort) => void;
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
            <th>{hdr("readiness", "Complete for a resident")}</th>
          </tr>
        </thead>
        <tbody>
          {props.zips.length === 0 && (
            <tr>
              <td colSpan={5} className="note">
                No zip readiness computed for this state yet.
              </td>
            </tr>
          )}
          {props.zips.map((z) => (
            <tr key={z.zip} className={z.isPilot ? "rq-pilot" : undefined}>
              <td>
                {z.zip}
                {z.isPilot && <span className="rq-pilot-tag">pilot</span>}
              </td>
              <td>
                {z.place.held ? z.place.value : <span className="gap">{z.place.gap.says}</span>}
                <div className="rq-worstgap">
                  {z.population.held
                    ? `${z.population.value.toLocaleString()} people`
                    : "population not on file"}
                </div>
              </td>
              <td>{z.bodyCount}</td>
              <td className="rq-level">
                {z.level.held ? (TIER_DISPLAY[z.level.value] ?? z.level.value) : <span className="gap">tier not stamped</span>}
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
                <div className="rq-worstgap">
                  worst gap: {z.worstGap} · least-ready: {STATE_HUMAN[z.worstState]}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rq-controls" style={{ marginTop: ".5rem" }}>
        <label>
          Sort by
          <select value={props.sort} onChange={(e) => props.onSort(e.target.value as ZipSort)}>
            <option value="readiness">Readiness</option>
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
function heldFigure(h: Held<Measured>): string {
  return h.held ? `${h.value.value} / ${h.value.denominator}` : "—";
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : iso;
}
