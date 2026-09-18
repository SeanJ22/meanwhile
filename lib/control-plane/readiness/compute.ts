/**
 * **ASSEMBLE A READINESS SNAPSHOT FROM TYPED INPUTS — pure, no fs, no db, no clock-read.**
 * (State Readiness Control Panel, 2026-09-03.)
 *
 * The publisher (`scripts/readiness-refresh.mts`) gathers the messy filesystem and
 * control-plane facts and hands them here as plain values; this module turns them
 * into the record the panel renders. Keeping it pure is what lets a test prove the
 * whole snapshot obeys every ruling without a database or a running app.
 *
 * Every state on every cell is DERIVED here (R-H). A caller cannot inject a
 * "CURRENT"; it can only supply evidence, and the gate logic decides.
 */
import { type Held, type Measured, gap, held, measured } from "../owner-surface.ts";
import {
  type CellState,
  type Gate,
  type GateEvidence,
  type MonotonicityViolation,
  coverageCell,
  deriveGateCells,
  worstOf,
} from "./gates.ts";
import {
  type CapabilityDomain,
  type CapabilityRow,
  type EvidenceWalk,
  type JurisdictionLevel,
  READINESS_SNAPSHOT_FORMAT_VERSION,
  type ReaderDelivery,
  type ReadinessStateSnapshot,
  type SummaryBand,
  type ZipPopulationBasis,
  type ZipRow,
  READINESS_DERIVATION_CONTRACT,
  gatedOnOperatorCount,
} from "./model.ts";

/** The four pilot zips, identifiable at a glance in the rollup (§5.4). */
export const PILOT_ZIPS: ReadonlySet<string> = new Set(["85701", "85641", "07866", "03255"]);

/* ------------------------------------------------------------------ inputs */

/** One capability's evidence, as the publisher gathers it from real authorities. */
export interface CapabilityInput {
  readonly capabilityId: string;
  readonly domain: CapabilityDomain;
  readonly label: string;
  readonly level: JurisdictionLevel;
  /** covered/total with the external authority that established `total` (R-D). */
  readonly coverage: {
    readonly covered: number;
    readonly total: number | null;
    readonly authority: string | null;
    readonly contract: string;
    /** The short coverage phrase the grid prints ("15 of 15", "47 filings"). */
    readonly label: string;
    readonly asOf: string | null;
    /** Why there is no fraction, when there is none. Never a bare "none". */
    readonly says: string | null;
  };
  /** Per-gate evidence; a missing gate is treated as NOT_WALKED. */
  readonly gates: Partial<Record<Gate, GateEvidence>>;
}

/** One overlapping governing body's readiness contribution to a zip (R-F). */
export interface ZipBodyInput {
  readonly state: CellState;
  /** Plain-language descriptor of this body's gap, used to name the worst one. */
  readonly gap: string;
}

/** One zip's evidence. `bodies` are every governing body overlapping the zip. */
export interface ZipInput {
  readonly zip: string;
  readonly place: Held<string>;
  readonly population: Held<Measured>;
  /** How that estimate may honestly be read (ADM-41). */
  readonly populationBasis: ZipPopulationBasis;
  /** The Bureau's published 90% margin on it, or null where it published none. */
  readonly populationMargin: number | null;
  readonly bodies: readonly ZipBodyInput[];
  /** The stamped coverage-tier label ("TIER_0".."TIER_3"), or null when UNKNOWN. */
  readonly tierLabel: string | null;
}

/** Everything the snapshot is assembled from. Supplied by the publisher. */
export interface ReadinessInputs {
  readonly state: string;
  readonly stateName: string;
  readonly publishedAt: string;
  readonly publishedFromSha: string | null;
  readonly publisher: string;
  readonly capabilities: readonly CapabilityInput[];
  readonly zips: readonly ZipInput[];
  /** Capability rows the Reader is declared to be served from (summary). */
  readonly capabilitiesServedToReaders: Held<Measured>;
  /** Share of state population in a reader-complete zip; gap until ACS ingested. */
  readonly populationInCompleteZip: Held<Measured>;
  /** The oldest as-of behind any walked cell, or the named gap. */
  readonly oldestEvidence: Held<string>;
  /** Walks behind cells, from real records only. Optional; defaults to none. */
  readonly evidenceWalks?: readonly EvidenceWalk[];
  /** What the Reader is declared to be served, per capability. Optional. */
  readonly delivery?: readonly ReaderDelivery[];
}

/* ------------------------------------------------------------------ zips */

/**
 * A zip's completeness is worst-of every overlapping body (R-F), expressed as the
 * fraction of the resident's bodies that are RESOLVED (CURRENT or ARGUED_ABSENT —
 * a complete answer either way). It is never an average of readiness scores: the
 * fraction is "how many bodies are fully answered", and the zip's STATE is the
 * single worst body. A zip with no resolvable bodies is worst-of NOT_WALKED.
 *
 * The denominator is the count of overlapping bodies, stated and sourced, so the
 * number cannot be read without knowing what it is out of.
 */
export function computeZipRow(input: ZipInput): ZipRow {
  const bodyStates = input.bodies.map((b) => b.state);
  const worstState = worstOf(bodyStates);
  const total = input.bodies.length;

  // The worst gap: the descriptor of the least-ready body. With no bodies at all,
  // the gap is that no source has been walked for this zip.
  const worstGap =
    total === 0
      ? "no governing body resolved for this zip"
      : (input.bodies
          .slice()
          .sort((a, b) => rankOf(a.state) - rankOf(b.state))[0]?.gap ?? "unnamed gap");

  // PROGRESS, so a mostly-covered zip is not read as fully weak by one gap
  // (owner directive, 2026-09-04, overriding the brief's worst-of-bar): the bar is
  // the readiness of the zip's bodies, weighted by how ready each is — how far
  // along the zip is overall. Worst-of is NOT discarded; it is carried where it
  // belongs and cannot be averaged away: the Level tag is the worst-of tier floor,
  // and `worstState`/`worstGap` name the single least-ready body, so the operator
  // sees both how complete the zip is AND exactly where to point effort.
  // All-NOT_WALKED is UNKNOWN, never 0%: a zip whose bodies have no walked
  // readiness is "not measured", not "0% of bodies are ready". Rendering the
  // measured zero was the defect that put 0% on every AZ zip while the snapshot
  // deliberately defers per-body status to the canonical civic-data receipts.
  const anyWalked = input.bodies.some((b) => b.state !== "NOT_WALKED");
  const progress =
    total === 0 ? 0 : input.bodies.reduce((sum, b) => sum + rankOf(b.state) / 5, 0) / total;
  const completeness: Held<Measured> =
    total === 0 || !anyWalked
      ? gap(
          "OURS",
          "not measured — no governing body's readiness has been walked for this zip; body status is shown from the canonical civic-data receipts, not duplicated in this readiness snapshot",
        )
      : held(
          measured(
            Math.round(progress * 100),
            100,
            "share of this zip's governing bodies that are ready, weighted by how ready each is — a progress measure; the Level tag is the worst-of floor and the worst gap names the least-ready body",
            "zip → governing-body overlap (registry coverage status)",
          ),
        );

  const level: Held<string> =
    input.tierLabel === null
      ? gap(
          "OURS",
          "no coverage tier is stamped for this zip, so we cannot say its level — that is our gap, not Level 0",
        )
      : held(input.tierLabel);

  return {
    zip: input.zip,
    place: input.place,
    population: input.population,
    populationBasis: input.populationBasis,
    populationMargin: input.populationMargin,
    bodyCount: total,
    level,
    completeness,
    worstState,
    worstGap,
    isPilot: PILOT_ZIPS.has(input.zip),
  };
}

function rankOf(state: CellState): number {
  // Local mirror of READINESS_RANK ordering for sorting bodies worst-first.
  const rank: Record<CellState, number> = {
    CURRENT: 5,
    ARGUED_ABSENT: 5,
    PARTIAL_OR_STALE: 3,
    GATED_ON_OPERATOR: 2,
    BLOCKED: 1,
    NOT_WALKED: 0,
  };
  return rank[state];
}

/* ------------------------------------------------------------------ capabilities */

/** Build one capability row: five gate cells (monotonicity enforced) + coverage. */
export function computeCapabilityRow(
  input: CapabilityInput,
  nowIso: string,
): { readonly row: CapabilityRow; readonly violations: readonly MonotonicityViolation[] } {
  const { gates, violations } = deriveGateCells(input.capabilityId, input.gates, nowIso);
  const coverage = coverageCell({
    covered: input.coverage.covered,
    total: input.coverage.total,
    authority: input.coverage.authority,
    contract: input.coverage.contract,
    noDenominatorSays: input.coverage.says,
  });
  const row: CapabilityRow = {
    capabilityId: input.capabilityId,
    domain: input.domain,
    label: input.label,
    level: input.level,
    gates,
    coverage,
    coverageLabel: input.coverage.label,
    coverageSays: input.coverage.says,
    asOf: input.coverage.asOf,
  };
  return { row, violations };
}

/* ------------------------------------------------------------------ the snapshot */

/**
 * Assemble the whole snapshot. Pure: same inputs, same output, replayable.
 *
 * The summary band's `gatedOnOperatorCount` and `monotonicityViolations` are
 * derived from the rows themselves, so the summary can never disagree with the grid.
 */
export function computeReadinessSnapshot(
  inputs: ReadinessInputs,
  nowIso: string,
): ReadinessStateSnapshot {
  const rows: CapabilityRow[] = [];
  const violations: MonotonicityViolation[] = [];
  for (const cap of inputs.capabilities) {
    const built = computeCapabilityRow(cap, nowIso);
    rows.push(built.row);
    violations.push(...built.violations);
  }

  const zips = inputs.zips.map(computeZipRow);

  const summary: SummaryBand = {
    capabilitiesServedToReaders: inputs.capabilitiesServedToReaders,
    populationInCompleteZip: inputs.populationInCompleteZip,
    oldestEvidence: inputs.oldestEvidence,
    gatedOnOperatorCount: gatedOnOperatorCount(rows),
  };

  return {
    formatVersion: READINESS_SNAPSHOT_FORMAT_VERSION,
    // Stamped by the derivation itself, so a hand-authored snapshot cannot carry
    // the current contract without going through this pure path (CC-F6).
    derivationContract: READINESS_DERIVATION_CONTRACT,
    state: inputs.state,
    stateName: inputs.stateName,
    publishedAt: inputs.publishedAt,
    publishedFromSha: inputs.publishedFromSha,
    publisher: inputs.publisher,
    summary,
    capabilities: rows,
    zips,
    evidenceWalks: inputs.evidenceWalks ?? [],
    delivery: inputs.delivery ?? [],
    monotonicityViolations: violations,
  };
}

/**
 * The empty-but-honest snapshot for a state we track but have not walked (R-14:
 * all 50 states load; a state with no data renders fully NOT_WALKED, not blank
 * and not an error). Every capability the taxonomy names renders NOT_WALKED with
 * its external denominator still shown where one exists.
 */
export function emptyStateSnapshot(input: {
  readonly state: string;
  readonly stateName: string;
  readonly publishedAt: string;
  readonly publisher: string;
  readonly capabilities: readonly CapabilityInput[];
}): ReadinessStateSnapshot {
  // Strip every capability's gate evidence to nothing: pure NOT_WALKED, honestly.
  const bare = input.capabilities.map((c) => ({ ...c, gates: {} }));
  return computeReadinessSnapshot(
    {
      state: input.state,
      stateName: input.stateName,
      publishedAt: input.publishedAt,
      publishedFromSha: null,
      publisher: input.publisher,
      capabilities: bare,
      zips: [],
      capabilitiesServedToReaders: gap(
        "OURS",
        "no committed holding has been checked for this state yet, so nothing can be said about what a reader is served here",
      ),
      populationInCompleteZip: gap("OURS", "no zip readiness computed for this state yet"),
      oldestEvidence: gap(
        "OURS",
        "no cell on this grid carries a dated instrument yet, so there is no oldest evidence to report",
      ),
    },
    input.publishedAt,
  );
}
