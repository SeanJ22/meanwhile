/**
 * **THE READINESS GATE LOGIC — six cell states, five ordered gates, worst-of.**
 * (State Readiness Control Panel, 2026-09-03. Hardcoded rulings R-A, R-B, R-E,
 * R-F, R-G, R-I from the build brief; canonical ledger numbering owed.)
 *
 * This module is PURE. It reads no clock, no filesystem, no database, and holds
 * no React. Everything a readiness cell means is decided here so a test can fail
 * it, and so the panel cannot render a state that this module did not derive.
 *
 * The panel's one job is that it cannot lie — it can never believe it has data
 * it has not verified, and never believe it is missing data that does not exist.
 * Those two failures are `NOT_WALKED` and `ARGUED_ABSENT`, and the whole point of
 * six states instead of two is that they can never render as the same thing.
 */
import { type Held, type Measured, gap, held, measured } from "../owner-surface.ts";

/* ------------------------------------------------------------------ *
 * R-A — SIX CELL STATES, NEVER TWO.
 * ------------------------------------------------------------------ */

/**
 * The only states a readiness cell may hold. Binary red/green is prohibited.
 *
 *   CURRENT             gate satisfied, within its freshness threshold
 *   PARTIAL_OR_STALE    satisfied for SOME jurisdictions, or satisfied but stale
 *   NOT_WALKED          we have not looked; NO claim is made
 *   ARGUED_ABSENT       the full ladder was walked, every rung recorded, and the
 *                       thing does not exist
 *   BLOCKED             we tried; something is actively stopping us; it is named
 *   GATED_ON_OPERATOR   work is stopped pending Sean's decision; it is named
 *
 * `NOT_WALKED` and `ARGUED_ABSENT` mean opposite things — "we don't know" versus
 * "we know it isn't there" — and conflating them causes work to be done on things
 * that do not exist. They are ordered apart and rendered apart, always.
 */
export const CELL_STATES = [
  "CURRENT",
  "PARTIAL_OR_STALE",
  "NOT_WALKED",
  "ARGUED_ABSENT",
  "BLOCKED",
  "GATED_ON_OPERATOR",
] as const;
export type CellState = (typeof CELL_STATES)[number];

const CELL_STATE_SET: ReadonlySet<string> = new Set<string>(CELL_STATES);
export function isCellState(value: string): value is CellState {
  return CELL_STATE_SET.has(value);
}

/* ------------------------------------------------------------------ *
 * R-B — FIVE GATES, ORDERED AND MONOTONIC.
 * ------------------------------------------------------------------ */

/**
 * The gates, left to right. A gate may not render CURRENT if any gate to its
 * left is not CURRENT. Publisher observation precedes any claim about what a
 * publisher publishes; reconciliation against an external authority precedes any
 * claim of verification; and so on rightward.
 */
export const GATE_ORDER = [
  "SOURCE_KNOWN",
  "ACQUIRED",
  "VERIFIED",
  "SHOWN_TO_READER",
  "ASK_ANSWERS",
] as const;
export type Gate = (typeof GATE_ORDER)[number];

/** The column header each gate carries — spelled out in full, never abbreviated. */
export const GATE_LABEL: Record<Gate, string> = {
  SOURCE_KNOWN: "Source known",
  ACQUIRED: "Acquired",
  VERIFIED: "Verified",
  SHOWN_TO_READER: "Shown to reader",
  ASK_ANSWERS: "Ask answers",
};

/**
 * What each gate asserts, so a drawer can say what a cell means without the
 * reader guessing. These are the definitions the panel is answerable to.
 */
export const GATE_DEFINITION: Record<Gate, string> = {
  SOURCE_KNOWN:
    "A named, reachable publisher path exists and has been observed. Publisher observation precedes any claim about what they publish.",
  ACQUIRED: "Records have been pulled and vaulted, with an as-of timestamp.",
  VERIFIED:
    "Reconciled against an external authority. No reconciliation may compare a parser to itself; if the only thing confirming our count is our own count, this gate is NOT_WALKED.",
  SHOWN_TO_READER:
    "Rendered on a live reader surface, and stated N equals rendered rows.",
  ASK_ANSWERS:
    "Ask answers from this data under the answer contract, without falling back to general knowledge.",
};

/* ------------------------------------------------------------------ *
 * R-E / R-F — WORST-OF, NEVER AVERAGE.
 * ------------------------------------------------------------------ */

/**
 * Readiness rank: higher is more complete for a resident. Worst-of takes the
 * MINIMUM, because averaging hides exactly the gap the panel exists to expose.
 *
 * The two "resolved" states sit at the top together: CURRENT is a complete
 * answer, and ARGUED_ABSENT is also a complete answer — "there are no municipal
 * committees because the place is unincorporated" is a finished answer, not a
 * hole. NOT_WALKED sits at the bottom: an unmade claim is the least ready state,
 * below even BLOCKED, because BLOCKED at least knows a specific wall is there.
 */
export const READINESS_RANK: Record<CellState, number> = {
  CURRENT: 5,
  ARGUED_ABSENT: 5,
  PARTIAL_OR_STALE: 3,
  GATED_ON_OPERATOR: 2,
  BLOCKED: 1,
  NOT_WALKED: 0,
};

/**
 * The worst (least ready) of a set of states.
 *
 * An EMPTY set is `NOT_WALKED`, not `CURRENT`: no jurisdictions to roll up is no
 * evidence of readiness, and defaulting an empty worst-of to the best state is
 * how "we found nothing" becomes "everything is fine".
 */
export function worstOf(states: readonly CellState[]): CellState {
  if (states.length === 0) return "NOT_WALKED";
  let worst = states[0];
  for (const s of states) {
    if (READINESS_RANK[s] < READINESS_RANK[worst]) worst = s;
  }
  return worst;
}

/** A cell is "current" only when it is exactly CURRENT. Used by the row filter. */
export function isCurrent(state: CellState): boolean {
  return state === "CURRENT";
}

/* ------------------------------------------------------------------ *
 * THE GATE CELL, AND ITS DERIVATION.
 * ------------------------------------------------------------------ */

/**
 * One gate's cell for one capability. `state` is worst-of across the
 * capability's jurisdictions for THIS gate (R-E). `asOf` is the freshness date
 * this cell was last established (R-G: every cell displays its as-of date).
 *
 * `monotonicityOk` is false when this cell claims CURRENT while a gate to its
 * left is not CURRENT (R-B). The data layer never silently renders such a cell
 * as CURRENT; the panel shows the violation.
 */
export interface GateCell {
  readonly gate: Gate;
  readonly state: CellState;
  /** ISO date (YYYY-MM-DD) this gate was last established, or null when NOT_WALKED. */
  readonly asOf: string | null;
  /** Plain language: why this state, for the drawer and hover. */
  readonly detail: string;
  /** A walk / vault reference the evidence drawer can open, or null. */
  readonly evidenceRef: string | null;
  /** False = this cell is CURRENT past a non-CURRENT gate to its left (R-B). */
  readonly monotonicityOk: boolean;
}

/**
 * R-G — a per-capability freshness verdict. `staleAfterDays` is the capability's
 * own threshold; a gate past it renders PARTIAL_OR_STALE regardless of how it was
 * last recorded. `null` threshold means "never goes stale" (a boundary at rest).
 */
export interface FreshnessVerdict {
  readonly fresh: boolean;
  readonly asOf: string | null;
  readonly ageDays: number | null;
  readonly staleAfterDays: number | null;
}

/**
 * Decide freshness from an as-of date and a threshold, against a supplied `now`.
 * Never reads a clock. An unreadable/absent as-of is NOT fresh and NOT stale —
 * it is unknown, and the caller renders that as NOT_WALKED, never as fresh.
 */
export function freshnessOf(
  asOf: string | null,
  staleAfterDays: number | null,
  nowIso: string,
): FreshnessVerdict {
  if (asOf === null) {
    return { fresh: false, asOf: null, ageDays: null, staleAfterDays };
  }
  const then = Date.parse(asOf);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) {
    return { fresh: false, asOf, ageDays: null, staleAfterDays };
  }
  const ageDays = Math.max(0, Math.floor((now - then) / 86_400_000));
  const fresh = staleAfterDays === null ? true : ageDays <= staleAfterDays;
  return { fresh, asOf, ageDays, staleAfterDays };
}

/**
 * The evidence a single gate cell is derived from.
 *
 * `covered`/`total` is this gate's own progress across the capability's
 * jurisdictions (e.g. 38 of 236 school districts ACQUIRED). `walkClosed` and
 * `blockedReason` and `gatedReason` carry the three non-fraction dispositions.
 * The data layer NEVER authors a state; every field here is a measurement.
 */
export interface GateEvidence {
  readonly covered: number;
  readonly total: number;
  readonly asOf: string | null;
  readonly staleAfterDays: number | null;
  /** A closed walk proved the thing does not exist (R-I). Overrides the fraction. */
  readonly walkClosed: boolean;
  /** Something is actively stopping us; the named wall. Overrides the fraction. */
  readonly blockedReason: string | null;
  /** Stopped pending Sean's decision; the named decision. Overrides the fraction. */
  readonly gatedReason: string | null;
  /** A walk / vault reference to open in the drawer, or null. */
  readonly evidenceRef: string | null;
}

/**
 * Derive ONE gate cell from its evidence, against a supplied clock, before
 * monotonicity is applied. Time is a parameter, as everywhere in the control
 * plane, so a test can put the clock where it needs it and a replay is exact.
 *
 * Precedence, highest first:
 *   1. GATED_ON_OPERATOR — a named decision is pending (owner-gated work).
 *   2. BLOCKED — a named wall is actively stopping us.
 *   3. ARGUED_ABSENT — a closed walk proved the thing does not exist (R-I). This
 *      requires `walkClosed`; a bare zero with no walk is NOT_WALKED, never
 *      absent (R-I: no absence from our own empty record).
 *   4. NOT_WALKED — covered 0 with no walk and no as-of.
 *   5. PARTIAL_OR_STALE — some but not all, OR complete but past its freshness.
 *   6. CURRENT — complete and fresh.
 *
 * A total of 0 is a special case: with a closed walk it is ARGUED_ABSENT; without
 * one it is NOT_WALKED. A zero denominator is never a vacuous CURRENT.
 */
export function deriveGateCell(gate: Gate, ev: GateEvidence, nowIso: string): GateCell {
  const base = { gate, evidenceRef: ev.evidenceRef, monotonicityOk: true };
  if (ev.gatedReason) {
    return { ...base, state: "GATED_ON_OPERATOR", asOf: ev.asOf, detail: ev.gatedReason };
  }
  if (ev.blockedReason) {
    return { ...base, state: "BLOCKED", asOf: ev.asOf, detail: ev.blockedReason };
  }
  if (ev.walkClosed) {
    return {
      ...base,
      state: "ARGUED_ABSENT",
      asOf: ev.asOf,
      detail:
        "The full ladder was walked, every rung recorded, and the thing does not exist. Open the evidence to read the argument.",
    };
  }
  // Nothing acquired and no walk on record: we have not looked. No claim.
  if (ev.covered <= 0 && ev.asOf === null) {
    return { ...base, state: "NOT_WALKED", asOf: null, detail: "Not walked. No claim is made." };
  }
  const fresh = freshnessOf(ev.asOf, ev.staleAfterDays, nowIso);
  // Complete, and fresh.
  if (ev.total > 0 && ev.covered >= ev.total && fresh.fresh) {
    return {
      ...base,
      state: "CURRENT",
      asOf: ev.asOf,
      detail: `Complete: ${ev.covered} of ${ev.total}, within its freshness threshold.`,
    };
  }
  // Everything else with any evidence at all is partial or stale.
  const why =
    ev.total > 0 && ev.covered >= ev.total
      ? fresh.ageDays === null
        ? "Complete, but its as-of date could not be read for freshness."
        : `Complete, but ${fresh.ageDays} days old and its threshold is ${fresh.staleAfterDays} days.`
      : ev.total > 0
        ? `${ev.covered} of ${ev.total} — satisfied for some jurisdictions, not all.`
        : `${ev.covered} recorded against an unestablished denominator.`;
  return { ...base, state: "PARTIAL_OR_STALE", asOf: ev.asOf, detail: why };
}

/* ------------------------------------------------------------------ *
 * R-B — MONOTONICITY, ENFORCED IN THE DATA LAYER.
 * ------------------------------------------------------------------ */

/** One recorded violation of gate monotonicity, for the snapshot to surface. */
export interface MonotonicityViolation {
  readonly capabilityId: string;
  readonly gate: Gate;
  readonly detail: string;
}

/**
 * Apply monotonicity to a capability's five gate cells, left to right.
 *
 * A gate that is CURRENT while any gate to its left is not CURRENT is a defect in
 * the underlying data. It is not silently rendered as CURRENT: the cell is marked
 * `monotonicityOk: false` and a violation is recorded so the panel surfaces it.
 * The cell KEEPS its computed state — hiding the claim would be its own lie — but
 * the mark and the violation row make the contradiction visible.
 */
export function enforceMonotonicity(
  capabilityId: string,
  cells: readonly GateCell[],
): { readonly gates: readonly GateCell[]; readonly violations: readonly MonotonicityViolation[] } {
  const violations: MonotonicityViolation[] = [];
  let allLeftCurrent = true;
  const gates = cells.map((cell) => {
    const ok = cell.state === "CURRENT" ? allLeftCurrent : true;
    if (!ok) {
      violations.push({
        capabilityId,
        gate: cell.gate,
        detail: `${cell.gate} is CURRENT while a gate to its left is not. A gate cannot be current past a gap to its left.`,
      });
    }
    // Update the running frontier AFTER judging this cell.
    if (cell.state !== "CURRENT") allLeftCurrent = false;
    return ok ? cell : { ...cell, monotonicityOk: false };
  });
  return { gates, violations };
}

/**
 * Build the five gate cells for one capability, in GATE_ORDER, from per-gate
 * evidence, then enforce monotonicity. `evidence` must supply one entry per gate
 * in GATE_ORDER; a missing gate is treated as NOT_WALKED evidence.
 */
export function deriveGateCells(
  capabilityId: string,
  evidence: Partial<Record<Gate, GateEvidence>>,
  nowIso: string,
): { readonly gates: readonly GateCell[]; readonly violations: readonly MonotonicityViolation[] } {
  const cells = GATE_ORDER.map((gate) => {
    const ev = evidence[gate] ?? {
      covered: 0,
      total: 0,
      asOf: null,
      staleAfterDays: null,
      walkClosed: false,
      blockedReason: null,
      gatedReason: null,
      evidenceRef: null,
    };
    return deriveGateCell(gate, ev, nowIso);
  });
  return enforceMonotonicity(capabilityId, cells);
}

/* ------------------------------------------------------------------ *
 * R-D — COVERAGE IS A FRACTION WITH AN EXTERNAL DENOMINATOR.
 * ------------------------------------------------------------------ */

/**
 * Build the coverage cell for a capability row: covered of total, where total
 * comes from an external authority. Never "we found 4, so 4 of 4".
 *
 * A total of 0 that no external authority established is a named gap, NOT a
 * vacuous "0 of 0" — the panel says whose gap it is. A total the authority states
 * as genuinely zero (the class does not exist in this state) is `measured(0,0,…)`
 * only when the authority is the one saying zero, and is rendered as the argued
 * absence it is, never as an empty success.
 */
export function coverageCell(input: {
  readonly covered: number;
  readonly total: number | null;
  readonly authority: string | null;
  readonly contract: string;
}): Held<Measured> {
  if (input.total === null || input.authority === null) {
    return gap(
      "OURS",
      "No external denominator is established for this capability yet, so a coverage fraction would be our own count checking itself.",
    );
  }
  return held(measured(input.covered, input.total, input.contract, input.authority));
}
