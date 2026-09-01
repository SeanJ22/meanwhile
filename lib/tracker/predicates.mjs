/**
 * **RULING 227 — ESCALATION WITHOUT RECONCILIATION IS PROHIBITED.**
 *
 * Adopted 2026-08-31 (Session C, Part B). The rule, entire:
 *
 * > A row may not enter NEEDS_SEAN without either a machine-verifiable
 * > predicate that is rechecked on every tracker generation and auto-resolves
 * > the row when false, or an explicit NOT_MACHINE_VERIFIABLE marking with a
 * > decision card. Escalation without reconciliation is prohibited.
 *
 * ## The defect it answers
 *
 * Needs Sean stood at 72 rows. Three of them — `NH272`, `NH281`, `NH300` — were
 * P1, were the three the previous session's close-out named as "what requires
 * you", and **all three were false when that sentence was written**. The secret
 * `NH272` asks for exists and is doing a live production read; the deploys
 * `NH281` says are stuck have published twice since; the proof `NH300` says
 * cannot be run has been run, 7 of 7, against live Postgres.
 *
 * None of that is a lying session. It is the SHAPE of an escalation: a row is
 * opened at the moment a session hits a wall, it records the wall accurately,
 * and then **nothing on earth ever asks whether the wall is still there.** The
 * row's own text is a photograph of one moment, and it keeps being presented as
 * the present tense for as long as it sits in the queue. The author reads a
 * queue of 72 and cannot tell which of them are photographs.
 *
 * Writing "sessions should recheck blockers" is the fix that does not work,
 * because the session that would recheck is a session that never reads the row.
 * The recheck has to be attached to the row and run by the machine.
 *
 * ## What a predicate is
 *
 * A predicate is the row's blocker, expressed as something a computer can
 * evaluate from the repository. It states what is TRUE WHILE THE ROW IS
 * BLOCKED. `evaluate()` returns `holds: true` while the wall stands and
 * `holds: false` the moment the evidence says otherwise — and a `false` is an
 * AUTO-RESOLUTION, with the evidence that earned it written onto the row.
 *
 * Three properties are non-negotiable, and each is a rule this project already
 * has:
 *
 * - **It reads evidence, never effort.** `EFFORT != EVIDENCE`. A predicate may
 *   not conclude from "a session tried and failed"; it reads a recorded
 *   artifact and quotes the field it read.
 * - **It never fabricates an absence.** A predicate that cannot reach its
 *   evidence returns `CANNOT_TELL`, which leaves the row exactly where it is.
 *   Failing to read the proof is not proof of the wall, and it is not proof
 *   against it either (RULING 182's shape, applied to a tracker row).
 * - **It is offline.** Predicates run inside `pnpm tracker:views`, which runs in
 *   CI and on a laptop with no network. Every one of them reads committed files.
 *
 * ## And when a row genuinely cannot be reconciled by machine
 *
 * Most Needs Sean rows are real: they want the author's JUDGEMENT, and no
 * amount of evidence substitutes for it. `OWN03` wants nine portraits approved
 * and RULING 55 reserves that to him; no predicate may ever close it. Those
 * rows are marked `NOT_MACHINE_VERIFIABLE` and must carry a DECISION CARD —
 * what is needed, the options, the consequence of each, and the row's age.
 *
 * The marking is not a loophole. It is the other half of the rule: a row that
 * is neither predicated nor carded is a row that escalated to the author with
 * no way back down, and `tests/tracker-predicates.test.ts` fails the build on
 * one.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../../scripts/tracker-core.mjs";

/** The three answers a predicate may give. There is no fourth. */
export const HOLDS = "HOLDS";
export const RESOLVED_BY_EVIDENCE = "RESOLVED_BY_EVIDENCE";
export const CANNOT_TELL = "CANNOT_TELL";

/** The marking a row carries when no machine can decide it. */
export const NOT_MACHINE_VERIFIABLE = "NOT_MACHINE_VERIFIABLE";

/* ---------------------------------------------------------------- reading --- */

/**
 * Read a committed JSON artifact, or say plainly that it could not be read.
 *
 * The `null` return is what becomes `CANNOT_TELL` upstream. It is never
 * collapsed into "the file says no".
 *
 * @param {string} relPath
 * @param {string} [root]
 * @returns {{ok: true, value: unknown} | {ok: false, why: string}}
 */
export function readArtifact(relPath, root = ROOT) {
  const full = join(root, relPath);
  if (!existsSync(full)) return { ok: false, why: `${relPath} is not present in this checkout` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(full, "utf8")) };
  } catch (error) {
    return { ok: false, why: `${relPath} could not be parsed: ${error.message}` };
  }
}

/**
 * Read a committed text artifact (a workflow YAML, a policy) as a string.
 *
 * @param {string} relPath
 * @param {string} [root]
 * @returns {{ok: true, value: string} | {ok: false, why: string}}
 */
export function readText(relPath, root = ROOT) {
  const full = join(root, relPath);
  if (!existsSync(full)) return { ok: false, why: `${relPath} is not present in this checkout` };
  try {
    return { ok: true, value: readFileSync(full, "utf8") };
  } catch (error) {
    return { ok: false, why: `${relPath} could not be read: ${error.message}` };
  }
}

/* -------------------------------------------------------------- outcomes --- */

/**
 * @typedef {{
 *   verdict: string,
 *   evidence: string[],
 *   read: string[],
 *   why: string,
 * }} PredicateOutcome
 */

/** The wall is still standing. The row stays exactly where it is. */
export function holds(why, { read = [], evidence = [] } = {}) {
  return { verdict: HOLDS, why, read, evidence };
}

/** The wall is gone, and here is the artifact that says so. */
export function resolvedByEvidence(why, { read = [], evidence = [] } = {}) {
  return { verdict: RESOLVED_BY_EVIDENCE, why, read, evidence };
}

/**
 * The evidence could not be reached.
 *
 * **This is not a resolution and it is not a confirmation.** The row does not
 * move, and the run reports that it could not tell — because a predicate that
 * treated an unreadable file as "still blocked" would quietly become a
 * permanent HOLDS the day somebody renamed the artifact.
 */
export function cannotTell(why, { read = [] } = {}) {
  return { verdict: CANNOT_TELL, why, read, evidence: [] };
}

/* -------------------------------------------------------------- registry --- */

/**
 * @typedef {{
 *   rowId: string,
 *   kind: "predicate",
 *   blocker: string,
 *   evaluate: (ctx: {root: string}) => PredicateOutcome,
 * }} RowPredicate
 */

/**
 * @typedef {{
 *   rowId: string,
 *   kind: "NOT_MACHINE_VERIFIABLE",
 *   whatIsNeeded: string,
 *   whyNoMachineCanDecide: string,
 *   options: {option: string, consequence: string}[],
 * }} RowDecisionCard
 */

/**
 * Evaluate one registry entry.
 *
 * A `NOT_MACHINE_VERIFIABLE` entry is not evaluated — it HOLDS by construction,
 * because the thing it is waiting for is a person.
 *
 * Typed as what this function READS rather than as the full union, for the same
 * reason `auditCoverage` is: a parameter type wider than the code's actual
 * requirement forces every caller — the tests especially — to construct a shape
 * this never inspects.
 *
 * @param {{rowId: string, kind: string, evaluate?: (ctx: {root: string}) => PredicateOutcome}} entry
 * @param {{root?: string}} [ctx]
 * @returns {PredicateOutcome}
 */
export function evaluateEntry(entry, { root = ROOT } = {}) {
  if (entry.kind === NOT_MACHINE_VERIFIABLE) {
    return holds(
      `${entry.rowId} is marked NOT_MACHINE_VERIFIABLE and carries a decision card. ` +
        "It waits on the author's judgement, which no artifact can supply.",
      { read: [] },
    );
  }
  try {
    return entry.evaluate({ root });
  } catch (error) {
    return cannotTell(
      `the predicate for ${entry.rowId} threw: ${error.message}. A throw is not a ` +
        "verdict — the row stays put and this run reports that it could not tell.",
    );
  }
}

/**
 * Evaluate a whole registry against the repository.
 *
 * @param {(RowPredicate|RowDecisionCard)[]} registry
 * @param {{root?: string}} [ctx]
 * @returns {{rowId: string, kind: string, outcome: PredicateOutcome}[]}
 */
export function evaluateRegistry(registry, { root = ROOT } = {}) {
  return registry.map((entry) => ({
    rowId: entry.rowId,
    kind: entry.kind,
    outcome: evaluateEntry(entry, { root }),
  }));
}

/**
 * **RULING 227's INVARIANT, measured over the live store.**
 *
 * Every open Needs Sean row is either predicated or carded. A row in neither
 * set escalated to the author with no route back down, which is the exact thing
 * the rule prohibits.
 *
 * The registry parameter is typed as only what this function READS — an id per
 * entry. Declaring the full union here would be a wider contract than the code
 * has, and a caller would then have to satisfy a shape this never inspects.
 *
 * @param {{needsSeanIds: string[], registry: {rowId: string}[]}} input
 * @returns {{covered: string[], uncovered: string[], orphaned: string[]}}
 */
export function auditCoverage({ needsSeanIds, registry }) {
  const registered = new Set(registry.map((e) => e.rowId));
  const open = new Set(needsSeanIds.map((s) => String(s).trim()));
  return {
    covered: [...open].filter((id) => registered.has(id)).sort(),
    uncovered: [...open].filter((id) => !registered.has(id)).sort(),
    orphaned: [...registered].filter((id) => !open.has(id)).sort(),
  };
}
