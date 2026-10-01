/**
 * A STATE WHOSE DESCENT HAS NEVER RUN CANNOT BEGIN A HUNT.
 * (2026-08-26, the descent session, Item 11. **RULING 169** made enforceable,
 * historical descent tooling.)
 *
 * RULING 86's gate asks whether a state's SOURCES were enumerated. This asks
 * the question one step further down: whether anyone ever DESCENDED the tiers
 * to find out what is in that state. They are different questions and a state
 * can pass the first while failing the second — every state in this repo did,
 * on the day this was written.
 *
 * **FAIL CLOSED IN EVERY DIRECTION** (RULING 159):
 *
 *   - no `states/<code>/descent.json`         -> refused
 *   - unparseable, or not a descent ledger    -> refused
 *   - a ledger with zero levels               -> refused
 *   - a ledger failing `assertRun`            -> refused (it re-runs the maths)
 *   - a state code that is not a state        -> refused
 *
 * The last one is the load-bearing one and it is why this does not simply check
 * that a file exists. A ledger claiming a walk it cannot substantiate is worse
 * than no ledger: it is the walk asserted rather than counted, which is exactly
 * what RULING 169 was adopted over. So the gate recomputes the conservation
 * arithmetic instead of trusting the file's own summary of itself.
 *
 * A STALE descent is deliberately NOT refused. RULING 53 makes staleness a
 * state the data carries rather than a gate: a walk from three weeks ago is a
 * measurement that no longer carries a claim on being current, and blocking the
 * hunt over it would stop the very work that refreshes it. The verdict carries
 * the age so a caller can say so.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { assertRun, walkVerdict, type DescentRun } from "./descent.ts";

export type DescentVerdict = "WALKED" | "NO_LEDGER" | "UNREADABLE" | "EMPTY_LEDGER" | "INCOHERENT" | "NOT_A_STATE";

export interface DescentCheck {
  readonly state: string;
  readonly verdict: DescentVerdict;
  readonly path: string;
  /** Written to be read by somebody who is not looking for it. */
  readonly reason: string;
  readonly levels: number;
  /** Whether the walk FINISHED or merely stopped — RULING 169. */
  readonly finished: boolean;
  /** Days since the oldest level was walked, or null when unknown. */
  readonly staleDays: number | null;
}

const STATE_CODES = new Set(
  (
    "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd " +
    "oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc as gu mp pr vi"
  ).split(" "),
);

export function descentLedgerPath(state: string): string {
  return `states/${state.trim().toLowerCase()}/descent.json`;
}

/**
 * How stale, in days, measured against a date the CALLER supplies.
 *
 * The date is a parameter rather than a clock call for the reason RULING 107
 * gives: a module that reads the clock cannot be tested about what it does on a
 * different day, and every freshness bug this project has had was a date
 * nobody could pin.
 */
export function oldestLevelAgeDays(run: DescentRun, today: string): number | null {
  const stamps = run.levels.map((l) => l.walkedOn).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (stamps.length === 0) return null;
  const oldest = stamps.slice().sort()[0];
  const a = Date.parse(`${oldest}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function checkStateDescent(state: string, root: string, today: string): DescentCheck {
  const code = state.trim().toLowerCase();
  const path = descentLedgerPath(code);
  const base = { state: code, path, levels: 0, finished: false, staleDays: null } as const;

  if (!STATE_CODES.has(code)) {
    return {
      ...base,
      verdict: "NOT_A_STATE",
      reason:
        `"${state}" is not a US state, district or territory code. The gate refuses rather than guessing, ` +
        "because a typo reading as an unwalked state and a typo reading as a walked one fail in completely " +
        "different places.",
    };
  }

  const file = join(root, "states", code, "descent.json");
  if (!existsSync(file)) {
    return {
      ...base,
      verdict: "NO_LEDGER",
      reason:
        `There is no ${path}. RULING 169: coverage is built by DESCENDING the tiers, and a body found only ` +
        "by per-entity search when the tier above publishes a list containing it is a defect in the walk " +
        `rather than a find. Run \`pnpm descent --state ${code}\` before hunting ${code.toUpperCase()}.`,
    };
  }

  let run: DescentRun;
  try {
    run = JSON.parse(readFileSync(file, "utf8")) as DescentRun;
  } catch (err) {
    return {
      ...base,
      verdict: "UNREADABLE",
      reason: `${path} could not be parsed as JSON (${(err as Error).message}). A ledger nobody can read is not a ledger.`,
    };
  }

  if (!Array.isArray(run.levels) || run.levels.length === 0) {
    return {
      ...base,
      verdict: "EMPTY_LEDGER",
      reason:
        `${path} records zero levels. A file with a state name and nothing under it is a session having ` +
        "created it and stopped, and a gate one `touch` defeats is not a gate (RULING 159).",
    };
  }

  /* Recompute rather than trust. A ledger's own summary of itself is exactly
   * the assertion RULING 169 exists to replace with a count. */
  try {
    assertRun(run);
  } catch (err) {
    return {
      ...base,
      levels: run.levels.length,
      verdict: "INCOHERENT",
      reason:
        `${path} does not survive its own arithmetic: ${(err as Error).message} ` +
        "A walk asserted rather than counted is the thing RULING 169 was adopted over.",
    };
  }

  const v = walkVerdict(run);
  return {
    state: code,
    path,
    verdict: "WALKED",
    levels: run.levels.length,
    finished: v.finished,
    staleDays: oldestLevelAgeDays(run, today),
    reason: `${path} records ${run.levels.length} level(s) over ${run.passes} pass(es). ${v.reason}`,
  };
}

/**
 * The gate. THROWS on anything that is not WALKED.
 *
 * Throwing rather than returning a flag is the fail-closed direction: a caller
 * that forgot to check a returned boolean would hunt anyway, and the whole
 * point is that the hunt does not begin.
 */
export function requireStateDescent(state: string, root: string, today: string): DescentCheck {
  const check = checkStateDescent(state, root, today);
  if (check.verdict !== "WALKED") {
    throw new Error(
      `HUNT REFUSED — ${check.state.toUpperCase()} has never been descended.\n` +
        `  verdict  ${check.verdict}\n` +
        `  file     ${check.path}\n` +
        `  ${check.reason}`,
    );
  }
  return check;
}
