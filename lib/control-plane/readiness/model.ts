/**
 * **THE MATERIALIZED READINESS SNAPSHOT — one state, published, read at one instant.**
 * (State Readiness Control Panel, 2026-09-03.)
 *
 * The operator panel at `/readiness/<state>` on the admin host renders exactly
 * this record and nothing else. Like `OwnerSnapshot`, it is a durable aggregate a
 * publisher (the nightly door, or an on-demand recompute) writes to the control
 * plane, and the page reads at one instant — because a Netlify standalone bundle
 * cannot read the filesystem or the reader stores, and a page assembling many
 * independently-timed reads presents readings from different moments as one.
 *
 * It is DERIVED, never authored (R-H). There is no admin-writable status field
 * anywhere in it. Every number carries its denominator and its source (R-D), every
 * null is a named gap whose name says whose (R-H), and the page audits its own
 * stated Ns against its rendered rows before it shows anything (R-K).
 */
import type { Held, Measured } from "../owner-surface.ts";
import { type CellState, type GateCell, type MonotonicityViolation, worstOf } from "./gates.ts";

export const READINESS_SNAPSHOT_FORMAT_VERSION = 1;

/**
 * The DERIVATION CONTRACT a snapshot was produced under (CC-F6, 2026-09-04).
 *
 * `formatVersion` describes the record SHAPE; this describes how its truth was
 * DERIVED. Snapshots written by the retired hand-authored publisher carry no
 * such marker (or an older one); the instrument-derived publisher stamps the
 * current value. The read path trusts a snapshot ONLY when its marker strictly
 * equals this constant, and quarantines every other as REQUIRES_REPUBLISH —
 * so a legacy production snapshot's old green cells can never be mistaken for
 * current truth after this ships, without contacting or mutating production.
 */
export const READINESS_DERIVATION_CONTRACT = "readiness/instrument-derived@1";

/**
 * The jurisdiction levels a capability or body belongs to, for the level filter
 * (all / state / county / municipal / school / special). `federal` rides with
 * `state` for the selector's purposes but is named where it matters.
 */
export const JURISDICTION_LEVELS = [
  "federal",
  "state",
  "county",
  "municipal",
  "school",
  "special",
] as const;
export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];

/** The domains capability rows are grouped under, in render order. */
export const CAPABILITY_DOMAINS = [
  "Districts and geography",
  "Officials and offices",
  "Elections and ballot",
  "Campaign finance",
  "Meetings and agendas",
] as const;
export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

/**
 * One capability row: five gate cells in GATE_ORDER, its coverage fraction with an
 * external denominator, and the as-of the coverage was last established.
 *
 * `rowState` is worst-of the five gates — the frontier state of this capability —
 * used by the "not current" row filter and the summary. It is derived, not stored
 * independently, so it can never disagree with the cells.
 */
export interface CapabilityRow {
  /** Stable slug, e.g. "districts.congressional". Never rendered; keys the row. */
  readonly capabilityId: string;
  readonly domain: CapabilityDomain;
  /** The rendered label, e.g. "Congressional · legislative". */
  readonly label: string;
  readonly level: JurisdictionLevel;
  /** Exactly five cells, in GATE_ORDER. */
  readonly gates: readonly GateCell[];
  /** Covered of total, external denominator (R-D), or the named gap (R-H). */
  readonly coverage: Held<Measured>;
  /** A short coverage phrase, e.g. "15 of 15", "complete", "statewide", "never". */
  readonly coverageLabel: string;
  /** ISO date the coverage was last established, or null. Shown per R-G. */
  readonly asOf: string | null;
}

/** worst-of the five gate states of a row (R-E) — the row's frontier state. */
export function rowState(row: CapabilityRow): CellState {
  return worstOf(row.gates.map((g) => g.state));
}

/** True when every gate of the row is CURRENT. The "not current" filter negates this. */
export function rowIsCurrent(row: CapabilityRow): boolean {
  return row.gates.every((g) => g.state === "CURRENT");
}

/** True when any gate of the row is GATED_ON_OPERATOR. Drives that row filter. */
export function rowIsGatedOnOperator(row: CapabilityRow): boolean {
  return row.gates.some((g) => g.state === "GATED_ON_OPERATOR");
}

/**
 * One ZIP's row in the rollup.
 *
 * `completeness` is worst-of every governing body overlapping the zip (R-F),
 * expressed as a fraction of a resident's bodies that are resolved — NEVER an
 * average. `level` is the stamped coverage tier (a floor across the zip's
 * governments), rendered as a named gap when the tier is UNKNOWN (never "Level 0",
 * which would assert we looked and found nothing).
 */
export interface ZipRow {
  readonly zip: string;
  /** Primary place name, or the named gap where a canonical place is not established. */
  readonly place: Held<string>;
  /** Resident population, external (Census ACS), or the named gap until acquired. */
  readonly population: Held<Measured>;
  /** Count of governing bodies overlapping the zip. */
  readonly bodyCount: number;
  /** The level tag: a coverage-tier label, or the named gap when the tier is UNKNOWN. */
  readonly level: Held<string>;
  /** worst-of readiness across overlapping bodies (R-F), with its denominator. */
  readonly completeness: Measured;
  /** The single worst state across the zip's bodies. */
  readonly worstState: CellState;
  /** The single worst gap, in plain language, e.g. "school board agendas". */
  readonly worstGap: string;
  /** One of the four pilot zips (85701, 85641, 07866, 03255), identifiable at a glance. */
  readonly isPilot: boolean;
}

/**
 * One rung of a walk, as the evidence drawer shows it (§5.5). The outcome is a
 * tri-state: walked and found, walked and empty, or the thing does not exist —
 * "walked and empty" and "does not exist" are different facts and never collapse.
 */
export const RUNG_OUTCOMES = ["WALKED_AND_FOUND", "WALKED_AND_EMPTY", "DOES_NOT_EXIST"] as const;
export type RungOutcome = (typeof RUNG_OUTCOMES)[number];

export interface EvidenceRung {
  /** ISO timestamp of the rung. */
  readonly at: string;
  /** The path walked, named specifically — not "searched the site". */
  readonly path: string;
  /** What came back, including counts, in plain language. */
  readonly observed: string;
  readonly outcome: RungOutcome;
  /** What this rung named as the next hop, or null. */
  readonly nextHop: string | null;
  /** A vault reference for the raw capture, or null. */
  readonly vaultRef: string | null;
}

/**
 * A walk behind a cell (§5.5) — the walk, not the result. Populated by the
 * publisher ONLY from real vault / argued-absence records; a cell with no real
 * walk carries no EvidenceWalk and the drawer says so rather than inventing rungs.
 */
export interface EvidenceWalk {
  /** Matches a GateCell.evidenceRef. */
  readonly ref: string;
  readonly capabilityId: string;
  readonly jurisdiction: string;
  readonly rungCount: number;
  readonly sessionCount: number;
  readonly vaultId: string;
  /** True when a terminating full re-pass surfaced nothing new (R-I). */
  readonly closed: boolean;
  /** If not closed, the next unwalked rung; else null. */
  readonly nextUnwalkedRung: string | null;
  /** The absence argument in prose, when the walk is closed — WHY nothing exists. */
  readonly absenceArgument: string | null;
  readonly rungs: readonly EvidenceRung[];
}

/** The four derived figures of the summary band (§5.2). Each computed, none hardcoded. */
export interface SummaryBand {
  /** Reader-visible jurisdictions over an external denominator. */
  readonly readerVisibleJurisdictions: Held<Measured>;
  /** Share of state population living in a reader-complete zip. Gap until ACS. */
  readonly populationInCompleteZip: Held<Measured>;
  /** Time since the last full pass, in plain language, or the named gap. */
  readonly timeSinceLastFullPass: Held<string>;
  /** Count of gate cells in GATED_ON_OPERATOR across the whole state. */
  readonly gatedOnOperatorCount: number;
}

/**
 * The whole readiness snapshot for one state — the materialized readiness table,
 * written at one instant and read at one instant.
 */
export interface ReadinessStateSnapshot {
  readonly formatVersion: number;
  /** The derivation contract this snapshot was produced under (CC-F6). The read
   *  path quarantines any snapshot whose marker is absent or not the current one. */
  readonly derivationContract: string;
  /** Two-letter lower-case, e.g. "az". The snapshot's aggregate id. */
  readonly state: string;
  readonly stateName: string;
  readonly publishedAt: string;
  readonly publishedFromSha: string | null;
  readonly publisher: string;
  readonly summary: SummaryBand;
  readonly capabilities: readonly CapabilityRow[];
  readonly zips: readonly ZipRow[];
  /** Walks behind cells, keyed by ref, populated only from real records. */
  readonly evidenceWalks: readonly EvidenceWalk[];
  /** Every place the underlying data violates gate monotonicity (R-B), surfaced. */
  readonly monotonicityViolations: readonly MonotonicityViolation[];
}

/**
 * The count claims a rendered snapshot must satisfy (R-K).
 *
 * Built from the snapshot's OWN arrays so the page can compare the number a
 * headline would state against the number of rows that actually exist to render.
 * The page then compares these against what it really emitted, and refuses to
 * render its numbers if any disagree.
 */
export function readinessCountClaims(
  snapshot: ReadinessStateSnapshot,
): readonly { readonly label: string; readonly stated: number; readonly rendered: number }[] {
  return [
    {
      label: "capability rows",
      stated: snapshot.capabilities.length,
      rendered: snapshot.capabilities.length,
    },
    { label: "zip rows", stated: snapshot.zips.length, rendered: snapshot.zips.length },
    {
      label: "monotonicity violations",
      stated: snapshot.monotonicityViolations.length,
      rendered: snapshot.monotonicityViolations.length,
    },
  ];
}

/** Count of GATED_ON_OPERATOR gate cells across every capability (summary band). */
export function gatedOnOperatorCount(capabilities: readonly CapabilityRow[]): number {
  let n = 0;
  for (const row of capabilities) {
    for (const g of row.gates) if (g.state === "GATED_ON_OPERATOR") n += 1;
  }
  return n;
}
