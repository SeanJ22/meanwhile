/**
 * **THE RECHECK — run on EVERY tracker generation, not on a session's memory.**
 *
 * RULING 227's operative half. `predicates.mjs` carries the rule, `registry.mjs`
 * carries the data, and this is the thing that actually runs, wired into
 * `pnpm tracker:views` so that it cannot be skipped by a session that never
 * thought to look.
 *
 * That wiring is the whole design. A recheck attached to a session's diligence
 * is a recheck that happens when somebody remembers, and the failure this
 * answers is precisely that nobody remembered for weeks. A recheck attached to
 * the generator happens every time anything regenerates the tracker at all.
 *
 * Three things happen here, in this order:
 *
 * 1. **`Opened on` is derived** for every row in both stores, from the
 *    append-only opened ledger. This is what gives a card its AGE, and the age
 *    is load-bearing: an old decision and a new one are different decisions,
 *    and the author cannot see which he is looking at without the date.
 * 2. **Every predicate is re-evaluated** against committed artifacts, and the
 *    verdict and the day are written to `Last verified`.
 * 3. **A predicate that has gone false AUTO-RESOLVES its row**, with the
 *    evidence that earned it appended to the session record.
 *
 * ## What this deliberately does not do
 *
 * It does not close the OBLIGATION a row was about. RULING 208 is untouched:
 * a Needs Sean row is a request for the author's attention, and discharging
 * that request says nothing about the public record the row concerned. `NH300`
 * auto-resolving means the author no longer needs to provision a credential —
 * it does not mean the freshness contract is READY, and the row's own note says
 * so.
 *
 * It also does not touch a row marked `NOT_MACHINE_VERIFIABLE`. Those rows wait
 * on judgement, RULING 37 governs them entire, and no predicate may ever reach
 * one.
 */

import { RESOLVED_BY_EVIDENCE, CANNOT_TELL, HOLDS, evaluateEntry } from "./predicates.mjs";
import { UNKNOWN, resolveAllOpenedDates } from "./opened-dates.mjs";

/** The author a RULING 227 close is recorded under. Never "session". */
export const PREDICATE_AUTHOR = "predicate";

/**
 * Write the derived `Opened on` onto every row.
 *
 * The value is written unconditionally, overwriting whatever is in the cell.
 * That IS the immutability mechanism: the column is a projection, so a hand
 * edit does not survive a generation and there is nothing to enforce by rule.
 *
 * @param {{rows: Record<string,string>[], root?: string}} input
 */
export function applyOpenedDates({ rows, root }) {
  const ids = rows.map((r) => (r.ID ?? "").trim());
  const { byId, counts } = resolveAllOpenedDates({ ids, root });
  for (const row of rows) {
    const resolvedDate = byId.get((row.ID ?? "").trim());
    row["Opened on"] = resolvedDate ? resolvedDate.date : UNKNOWN;
  }
  return { byId, counts };
}

/**
 * Age in whole days, or `null` when the row's opened date is UNKNOWN.
 *
 * `null` is rendered as "age unknown" and never as 0. A row whose age cannot be
 * recovered is not a new row, and sorting it as one would put the oldest
 * unrecoverable rows at the bottom of a view sorted by age — the exact opposite
 * of the truth.
 *
 * @param {string} openedOn
 * @param {string} stamp
 * @returns {number|null}
 */
export function ageInDays(openedOn, stamp) {
  if (!openedOn || openedOn === UNKNOWN) return null;
  const from = Date.parse(`${openedOn}T00:00:00Z`);
  const to = Date.parse(`${stamp}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86400000));
}

/** How an age reads on a surface. Never a bare number, never a fake zero. */
export function describeAge(openedOn, stamp) {
  const days = ageInDays(openedOn, stamp);
  if (days === null) return "age unknown — opened date not recoverable from history";
  if (days === 0) return "opened today";
  if (days === 1) return "1 day old";
  return `${days} days old`;
}

/**
 * **RUN EVERY PREDICATE, AND CLOSE WHAT HAS GONE FALSE.**
 *
 * @param {{
 *   working: Record<string,string>[],
 *   registry: object[],
 *   stamp: string,
 *   sessionLabel: string,
 *   root?: string,
 * }} input
 */
export function reconcile({ working, registry, stamp, sessionLabel, root }) {
  const byId = new Map(working.map((r) => [(r.ID ?? "").trim(), r]));
  const outcomes = [];
  const autoResolved = [];

  for (const entry of registry) {
    const row = byId.get(entry.rowId);
    /*
     * A registry entry for a row that is not open is not an error: the row may
     * already have been closed by the author, or by a previous run of this very
     * mechanism. It is reported as orphaned by auditCoverage and skipped here.
     */
    if (!row) continue;

    const outcome = evaluateEntry(entry, { root });
    outcomes.push({ rowId: entry.rowId, kind: entry.kind, outcome });

    if (entry.kind !== "predicate") continue;

    /*
     * `Last verified` records the day AND the verdict, because "verified
     * 2026-08-31" alone cannot distinguish "checked, still blocked" from
     * "checked, could not tell" — and those are different facts about how much
     * the row's own text can be trusted.
     */
    row["Last verified"] = `${stamp} · ${outcome.verdict}`;

    if (outcome.verdict !== RESOLVED_BY_EVIDENCE) continue;

    /*
     * **AN AUTO-RESOLVE IS WRITTEN ONCE, AND THIS IS WHERE THAT IS ENFORCED.**
     *
     * The recheck runs on EVERY generation, and an auto-resolved row STAYS IN
     * THE WORKING STORE until `pnpm tracker:move` carries it across. So between
     * the resolve and the move, every further generation found the same row,
     * re-evaluated the same predicate to the same RESOLVED_BY_EVIDENCE, and
     * appended the same paragraph again.
     *
     * It did. `NH272`, `NH281` and `NH300` each reached the resolved store
     * carrying their RULING 227 evidence paragraph TWICE, verbatim — six
     * occurrences across three rows. Nothing was wrong with the verdict; the
     * append simply had no memory.
     *
     * That matters because the paragraph is the AUTHOR'S CARD. RULING 227 makes
     * the card the thing he reads to decide whether a blocker is still his
     * problem, and a card that repeats itself every generation is a card that
     * gets skimmed. An unbounded note is also a generated artifact that grows
     * without a diff anyone can read.
     *
     * A row the author closed himself is skipped by the same line, and that is
     * correct rather than incidental: a predicate may not overwrite an author's
     * own resolution, and RULING 37 is what says so.
     */
    if ((row.Resolution ?? "").trim()) continue;

    row.Resolution = "Resolved";
    row["Resolved on"] = stamp;
    row["Closed by"] = `${sessionLabel} (RULING 227 auto-reconciliation)`;

    const record =
      `${stamp} (${sessionLabel}). AUTO-RESOLVED under RULING 227: the blocker this row ` +
      `describes was re-evaluated against committed artifacts and no longer holds. ` +
      `BLOCKED_WHILE: ${entry.blocker}. VERDICT: ${outcome.why} EVIDENCE: ` +
      outcome.evidence.map((e, i) => `(${i + 1}) ${e}`).join(" ") +
      ` The row is closed; the obligation it concerned is NOT (RULING 208).`;
    const before = (row["Session record"] ?? "").trim();
    row["Session record"] = before ? `${before} ${record}` : record;

    autoResolved.push({ rowId: entry.rowId, blocker: entry.blocker, outcome });
  }

  return { outcomes, autoResolved };
}

/**
 * A one-screen summary of what the recheck found, for the run's own output.
 *
 * @param {{outcomes: {rowId: string, kind: string, outcome: {verdict: string}}[]}} input
 */
export function summarize({ outcomes }) {
  const predicates = outcomes.filter((o) => o.kind === "predicate");
  return {
    predicates: predicates.length,
    notMachineVerifiable: outcomes.length - predicates.length,
    holds: predicates.filter((o) => o.outcome.verdict === HOLDS).length,
    resolved: predicates.filter((o) => o.outcome.verdict === RESOLVED_BY_EVIDENCE).length,
    cannotTell: predicates.filter((o) => o.outcome.verdict === CANNOT_TELL).length,
  };
}
