/**
 * **`docs/tracker-owner-view.md` — the one surface built for the author to ACT on.**
 *
 * Session C Part B, 2026-08-31. `docs/tracker.md` answers "what is left" across
 * the whole project and is the right shape for that. It is the wrong shape for
 * the question the author actually opens the tracker with, which is **"what
 * needs ME, and how long has it been waiting?"**
 *
 * Before this file, that question had no answer anywhere:
 *
 * - Needs Sean rendered in id order inside a priority, so a decision opened on
 *   2026-08-11 sat below one opened yesterday with nothing to tell them apart.
 * - No row carried a date at all, so nothing had an age.
 * - Nothing distinguished a row that wants a DECISION from a row that wants an
 *   ACKNOWLEDGEMENT — `NH208` says in its own body that nothing is wrong and no
 *   setting needs changing, and it sat in the same list, at the same weight, as
 *   "approve this message before 272 real people receive it".
 * - And three P1 rows were stating blockers that had already cleared.
 *
 * So this view sorts by **priority first and then by age, oldest first**, splits
 * ACTIONABLE from INFORMATIONAL, and puts a date and a verification state on
 * every row.
 *
 * ## Why age sorts oldest-first inside a priority
 *
 * Because the failure mode is a row sitting unread, and a queue sorted
 * newest-first hides exactly the rows that have been ignored longest. A row
 * whose opened date could not be recovered sorts with the OLDEST rather than
 * the newest, for the same reason: an unrecoverable date means the row predates
 * the ledger's stamped era, which makes it old, and sorting it as new would put
 * the most-ignored rows at the bottom.
 */

import { UNKNOWN } from "./opened-dates.mjs";
import { ageInDays, describeAge } from "./reconcile.mjs";
import { RESOLVED_BY_EVIDENCE, CANNOT_TELL, HOLDS } from "./predicates.mjs";

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };

/**
 * A row is INFORMATIONAL when its card's options are an acknowledgement rather
 * than a fork — the session has already done the work and the row exists so the
 * author knows, not so he decides.
 *
 * The test is deliberately conservative and textual: a card qualifies only when
 * its own `whatIsNeeded` opens with a word that means "read this". Everything
 * else is ACTIONABLE, because misfiling a real decision as informational is the
 * expensive direction of this error and misfiling the reverse merely costs him
 * a moment.
 */
const INFORMATIONAL_OPENER = /^(Acknowledge|Confirm the|Confirm that)\b/;

/** @param {object} card */
export function isInformational(card) {
  return Boolean(card && INFORMATIONAL_OPENER.test(card.whatIsNeeded ?? ""));
}

/**
 * Sort key: priority, then age (oldest first), then id for stability.
 *
 * @param {Record<string,string>} row
 * @param {string} stamp
 */
function sortKey(row, stamp) {
  const p = PRIORITY_RANK[(row.Priority ?? "").trim()] ?? 9;
  const age = ageInDays(row["Opened on"] ?? "", stamp);
  // An unrecoverable date sorts as maximally old, never as brand new.
  const ageRank = age === null ? Number.MAX_SAFE_INTEGER : age;
  return { p, ageRank, id: (row.ID ?? "").trim() };
}

function compare(a, b) {
  if (a.key.p !== b.key.p) return a.key.p - b.key.p;
  if (a.key.ageRank !== b.key.ageRank) return b.key.ageRank - a.key.ageRank;
  return a.key.id.localeCompare(b.key.id);
}

/**
 * Render the view.
 *
 * @param {{
 *   working: Record<string,string>[],
 *   registry: object[],
 *   outcomes: {rowId: string, kind: string, outcome: object}[],
 *   autoResolved: {rowId: string, blocker: string, outcome: object}[],
 *   stamp: string,
 *   openedCounts: Record<string, number>,
 * }} input
 * @returns {string}
 */
export function ownerView({ working, registry, outcomes, autoResolved, stamp, openedCounts }) {
  const cardById = new Map(registry.map((e) => [e.rowId, e]));
  const outcomeById = new Map(outcomes.map((o) => [o.rowId, o.outcome]));

  /*
   * Open rows only, and "open" here means the same thing it means everywhere
   * else: not carrying a CLOSING resolution. A row this very run auto-resolved
   * is still sitting in the working store until `tracker:move` carries it
   * across, and listing it under "decisions waiting on you" would be the exact
   * lie this view was built to end.
   */
  const CLOSING = new Set(["Resolved", "Conditionally resolved"]);
  const needsSean = working
    .filter(
      (r) =>
        (r.Section ?? "").trim() === "needs-sean" &&
        !CLOSING.has((r.Resolution ?? "").trim()),
    )
    .map((r) => ({ row: r, key: sortKey(r, stamp) }))
    .sort(compare);

  const actionable = [];
  const informational = [];
  for (const item of needsSean) {
    const entry = cardById.get((item.row.ID ?? "").trim());
    (isInformational(entry) ? informational : actionable).push({ ...item, entry });
  }

  const out = [];
  const w = (s = "") => out.push(s);

  w("# What needs you");
  w("");
  w("**GENERATED FILE — do not hand-edit.** Written by `pnpm tracker:views`");
  w("(`lib/tracker/owner-view.mjs`) from `docs/tracker-working.csv`, the opened ledger");
  w("and the RULING 227 registry. It cannot disagree with the stores, because it is");
  w("derived from them.");
  w("");
  w(`Generated ${stamp} (America/Phoenix, from \`pnpm stamp\`).`);
  w("");
  w("Sorted by priority, then by **age, oldest first** — because the failure this view");
  w("exists to fix is a row sitting unread, and a newest-first queue hides exactly the");
  w("rows that have been ignored longest.");
  w("");
  w("---");
  w("");

  /* ---------------------------------------------- what the machine cleared --- */

  w("## Cleared by the machine in this generation");
  w("");
  if (autoResolved.length === 0) {
    /*
     * "Nothing" here is a statement about THIS RUN and must not be read as
     * "nothing has ever been cleared" — the rows cleared by an earlier
     * generation are closed and gone from the working store by the time the
     * next one runs. Saying where they are is the difference between an
     * accurate empty state and one that quietly erases the mechanism's work.
     */
    w(
      "Nothing in this run. Every predicated row still open holds — and this is a " +
        "statement about this generation, not about the mechanism's history: a row " +
        "cleared by an earlier run is already closed and has left the working store. " +
        "Past auto-resolutions are in `docs/tracker-resolved.csv`, each carrying its " +
        "evidence, and every run's verdicts are in `docs/tracker-reconciliation.json`.",
    );
  } else {
    w(
      `**${autoResolved.length} row(s) auto-resolved under RULING 227.** Each was ` +
        "re-evaluated against committed artifacts, each blocker was found to have gone " +
        "away, and the evidence is on the row. **None of these needs you any more.**",
    );
    w("");
    for (const a of autoResolved) {
      const outcome = a.outcome;
      w(`### ${a.rowId} — resolved`);
      w("");
      w(`- **It said:** ${a.blocker}.`);
      w(`- **It is now:** ${outcome.why}`);
      w("- **Evidence:**");
      for (const e of outcome.evidence) w(`  - ${e}`);
      w("");
    }
    w(
      "The obligations these rows concerned are NOT closed by this (RULING 208). What " +
        "is closed is the request for your attention.",
    );
  }
  w("");
  w("---");
  w("");

  /* -------------------------------------------------------- the decisions --- */

  w("## Decisions waiting on you");
  w("");
  w(
    `**${actionable.length} row(s).** Each carries what is needed, the options, what ` +
      "each option costs, and how long it has been waiting.",
  );
  w("");

  let priority = null;
  for (const { row, entry, key } of actionable) {
    const p = (row.Priority ?? "").trim() || "unprioritised";
    if (p !== priority) {
      priority = p;
      w(`### ${p}`);
      w("");
    }
    const opened = row["Opened on"] || UNKNOWN;
    w(`#### ${row.ID} — ${row.Title}`);
    w("");
    w(
      `*Opened ${opened === UNKNOWN ? "on a date not recoverable from history" : opened} · ` +
        `${describeAge(opened, stamp)} · ${verificationLine(row, outcomeById.get((row.ID ?? "").trim()), entry)}*`,
    );
    w("");
    if (!entry) {
      w(
        "**NO DECISION CARD.** This row escalated with no way back down, which RULING 227 " +
          "prohibits. It is listed here so the omission is visible rather than silent.",
      );
      w("");
      continue;
    }
    /*
     * A PREDICATED row that is still here is a row whose blocker was rechecked
     * this run and genuinely still holds — or could not be read. It has no
     * options, because it is not a decision: it is a wall, and the useful thing
     * to say about it is what the machine checked and what it found.
     */
    if (entry.kind === "predicate") {
      w(`**Blocked while.** ${entry.blocker}.`);
      w("");
      const outcome = outcomeById.get((row.ID ?? "").trim());
      w(
        `**Rechecked this run.** ${outcome ? outcome.why : "no outcome recorded."}` +
          (outcome && outcome.read.length
            ? ` Read: ${outcome.read.join(", ")}.`
            : ""),
      );
      w("");
      continue;
    }

    w(`**What is needed.** ${entry.whatIsNeeded}`);
    w("");
    w(`**Why no machine can decide it.** ${entry.whyNoMachineCanDecide}`);
    w("");
    w("**Your options.**");
    w("");
    for (const o of entry.options ?? []) {
      w(`- **${o.option}** — ${o.consequence}`);
    }
    w("");
    void key;
  }

  /* ----------------------------------------------------- the informational --- */

  w("---");
  w("");
  w("## For your information — no decision required");
  w("");
  if (informational.length === 0) {
    w("Nothing.");
  } else {
    w(
      `**${informational.length} row(s).** The work is done or the question is answered; ` +
        "these are here so you know, not so you decide. Each closes on your " +
        "acknowledgement.",
    );
    w("");
    for (const { row, entry } of informational) {
      const opened = row["Opened on"] || UNKNOWN;
      w(`- **${row.ID}** (${row.Priority}, ${describeAge(opened, stamp)}) — ${entry.whatIsNeeded}`);
    }
  }
  w("");
  w("---");
  w("");

  /* --------------------------------------------------------- the coverage --- */

  w("## How this view knows what it knows");
  w("");
  w("**Dates.** Every row's `Opened on` is derived from `docs/tracker-opened.json`, the");
  w("append-only ledger of every id any session has ever claimed. It is never typed and");
  w("never guessed.");
  w("");
  w(`- ${openedCounts["opened-ledger"] ?? 0} row(s) carry a date the ledger stamped directly.`);
  w(
    `- ${openedCounts["session-label"] ?? 0} row(s) take the date from the session the ledger names, ` +
      "where the entry was reconstructed on 2026-08-21 without a stamp.",
  );
  w(
    `- ${openedCounts.unrecoverable ?? 0} row(s) read **UNKNOWN**. Their ledger entries were ` +
      "reconstructed with no stamped day and name a session that carries no date. The " +
      "ledger bound around them is a multi-day range, and a range is not a date; this " +
      "clone is also shallow at 2026-08-25, so git cannot answer for rows older than " +
      "that either. **UNKNOWN is the honest reading and is never replaced by a guess.**",
  );
  w("");
  w("**Verification.** Every row above is either predicated or explicitly marked");
  w("NOT_MACHINE_VERIFIABLE, per RULING 227. A predicated row is re-evaluated against");
  w("committed artifacts on EVERY tracker generation — not when a session remembers —");
  w("and auto-resolves the moment its blocker stops being true.");
  w("");

  const predicated = outcomes.filter((o) => o.kind === "predicate");
  w(`- ${predicated.length} row(s) carry a machine-verifiable predicate.`);
  w(`- ${outcomes.length - predicated.length} row(s) are marked NOT_MACHINE_VERIFIABLE with a card.`);
  w("");
  return out.join("\n");
}

/**
 * How a row's verification state reads on the view.
 *
 * The `entry.kind` check comes FIRST and it is load-bearing. A carded row's
 * outcome is `HOLDS` — that is what `evaluateEntry` returns for anything marked
 * NOT_MACHINE_VERIFIABLE, because the thing it waits on is a person. Reading
 * that as "verified still blocked" would tell the author a machine had checked
 * a row no machine can check, which is a stronger claim than the truth and
 * exactly the kind of overstatement this whole view exists to remove.
 */
function verificationLine(row, outcome, entry) {
  const lastVerified = (row["Last verified"] ?? "").trim();
  if (!entry || entry.kind !== "predicate") {
    return "NOT_MACHINE_VERIFIABLE — waits on your judgement, which no artifact can supply";
  }
  if (!outcome) return "unverified — no predicate outcome recorded this run";
  if (outcome.verdict === HOLDS) {
    return `verified still blocked (${lastVerified || "this run"})`;
  }
  if (outcome.verdict === CANNOT_TELL) {
    return `COULD NOT VERIFY this run — ${outcome.why}`;
  }
  if (outcome.verdict === RESOLVED_BY_EVIDENCE) {
    return `resolved by evidence (${lastVerified || "this run"})`;
  }
  return "unverified";
}
