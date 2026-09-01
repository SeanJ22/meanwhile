/**
 * **WHEN WAS THIS ROW OPENED?** — the `Opened on` column, derived and never typed.
 *
 * Added 2026-08-31 (Session C, Part B). The tracker could say what was left and
 * who opened it; it could not say WHEN, anywhere, for any row. A queue with no
 * ages cannot be triaged: "stuck since" was prose inside a row's own Detail
 * text, written by the session that opened it and never rechecked, which is how
 * `NH281` came to state "stuck since 7/13/2025" while the thing it described
 * had already resolved.
 *
 * ## Why this is DERIVED rather than a column somebody fills in
 *
 * `Opened on` is IMMUTABLE. The way to make a column immutable is not to write
 * a rule saying nobody may edit it — it is to make the column a projection of
 * an append-only source, so that editing the CSV cell changes nothing and the
 * next generation puts it back. `docs/tracker-opened.json` is that source: one
 * entry per `tracker add` run, the session that ran it, the stamped day, and
 * every id the run assigned. It is already append-only and already guarded
 * (`tests/tracker-stores.test.ts`, item 1.4).
 *
 * So the date is resolved HERE, on every generation, from history — and
 * `docs/tracker-opened-dates.json` records the derivation with its provenance
 * so a reader can audit any single row without re-deriving all 389.
 *
 * ## The precedence, and why git is not in it
 *
 * 1. **`opened-ledger`** — the ledger entry carries a real stamped
 *    `YYYY-MM-DD`. This is the strongest source and covers every row opened
 *    since the ledger began.
 * 2. **`session-label`** — the entry is one of the 2026-08-21 reconstructions
 *    (`"opened": "reconstructed-2026-08-21"`), but the session it names begins
 *    with its own date, e.g. `2026-08-11 · Add national congressional district
 *    overlay`. That prefix is the session's own report of the day it ran.
 * 3. **`UNKNOWN`** — everything else. Not a guess, not a bound, not a range
 *    collapsed to its nearest end.
 *
 * **Git is deliberately absent, and the reason is measured rather than
 * assumed.** The obvious source is the first commit whose
 * `docs/tracker-working.csv` blob contains the id. That is exact — in a full
 * clone. This repository is not one: `git rev-parse --is-shallow-repository`
 * answers `true`, the graft boundary is 2026-08-25, and the oldest commit
 * touching the store is `646d5d3b` on that same day. Rows opened on 2026-08-11
 * are already present in the oldest blob available, so a first-appearance walk
 * dates every one of them 2026-08-25 — fourteen days late, with no error and no
 * missing value to notice. `gitFirstAppearance()` below therefore REFUSES on a
 * shallow clone instead of answering; it is kept because on a full clone it is
 * the right instrument, and because a function that returns a wrong date
 * silently is worse than one that is not there.
 *
 * ## What was refused, and why it is worth writing down
 *
 * Seventeen reconstructed ledger entries name a session with no date prefix
 * (`Prompt B`, `g8`, `truth-session-0815`, `AUD-04`, …), covering 87 open rows.
 * Two tempting rescues were both refused:
 *
 * - **Decode the digits in the label.** `truth-session-0815` looks like
 *   2026-08-15. But those seventeen entries sit in one CONTIGUOUS run in the
 *   ledger, bounded by 2026-08-16 before and 2026-08-21 after — and 08-15 falls
 *   OUTSIDE that bound. So either the block is not in chronological position or
 *   the decode is wrong, and there is no third reading in which the decoded
 *   date is trustworthy. A label is a name, not a stamp.
 * - **Interpolate from the neighbours.** The ledger's dated entries are
 *   non-decreasing (checked: 104 dated entries, 0 ordering violations), so a
 *   gap between two entries sharing one date would pin the rows between them.
 *   No such gap exists here — all seventeen are in the same run, so the bound
 *   is a five-day range and a range is not a date.
 *
 * 87 rows therefore read `UNKNOWN`, and that is the correct answer. CLAUDE.md:
 * a plausible date is a fabrication, and it misdates the rule every later
 * decision was supposedly made under.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPENED_JSON, ROOT } from "../../scripts/tracker-core.mjs";

/** What an unrecoverable date reads as, on every surface. Never blank. */
export const UNKNOWN = "UNKNOWN";

/** A stamped day, and nothing that merely looks like one. */
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})$/;
/** A session label that opens with its own day. */
const LABEL_DAY = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The opened ledger, oldest entry first, as committed.
 *
 * @param {string} [root]
 * @returns {{session: string, opened: string, reconstructed?: boolean, ids: string[]}[]}
 */
export function readOpenedLedger(root = ROOT) {
  const raw = JSON.parse(readFileSync(join(root, OPENED_JSON), "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${OPENED_JSON} is not an array`);
  return raw;
}

/**
 * **THE FIRST entry that claimed an id wins.**
 *
 * An id can appear in more than one entry — a reconciliation run re-states ids
 * it did not assign — and the question this column answers is when the row was
 * OPENED, so a later mention is not a competing answer.
 *
 * @param {{session: string, opened: string, reconstructed?: boolean, ids: string[]}[]} ledger
 * @returns {Map<string, {session: string, opened: string, reconstructed?: boolean}>}
 */
export function firstClaimByLedger(ledger) {
  /** @type {Map<string, {session: string, opened: string, reconstructed?: boolean}>} */
  const first = new Map();
  for (const entry of ledger) {
    for (const id of entry.ids ?? []) {
      const key = String(id).trim();
      if (key && !first.has(key)) first.set(key, entry);
    }
  }
  return first;
}

/**
 * Resolve one id to a date and the provenance that earned it.
 *
 * @param {string} id
 * @param {Map<string, {session: string, opened: string, reconstructed?: boolean}>} claims
 * @returns {{id: string, date: string, source: string, why: string}}
 */
export function resolveOpenedDate(id, claims) {
  const key = String(id).trim();
  const entry = claims.get(key);
  if (!entry) {
    return {
      id: key,
      date: UNKNOWN,
      source: "unrecoverable",
      why: `no entry in ${OPENED_JSON} ever claimed this id`,
    };
  }
  const stamped = ISO_DAY.exec(String(entry.opened ?? "").trim());
  if (stamped) {
    return {
      id: key,
      date: stamped[1],
      source: "opened-ledger",
      why: `${OPENED_JSON} stamped this run ${stamped[1]} (session "${entry.session}")`,
    };
  }
  const labelled = LABEL_DAY.exec(String(entry.session ?? "").trim());
  if (labelled) {
    return {
      id: key,
      date: labelled[1],
      source: "session-label",
      why:
        `${OPENED_JSON} reconstructed this entry on 2026-08-21 and did not stamp the ` +
        `original day; the session it names reports its own: "${entry.session}"`,
    };
  }
  return {
    id: key,
    date: UNKNOWN,
    source: "unrecoverable",
    why:
      `${OPENED_JSON} reconstructed this entry with no stamped day, and the session ` +
      `it names ("${entry.session}") carries no date. The ledger bound around it is a ` +
      "multi-day range, and a range is not a date. Git cannot answer either: this " +
      "clone is shallow at 2026-08-25 and the row predates the graft.",
  };
}

/**
 * Every id in the two stores, resolved.
 *
 * @param {{ids: string[], root?: string}} input
 * @returns {{byId: Map<string, {id: string, date: string, source: string, why: string}>, counts: Record<string, number>}}
 */
export function resolveAllOpenedDates({ ids, root = ROOT }) {
  const claims = firstClaimByLedger(readOpenedLedger(root));
  const byId = new Map();
  /** @type {Record<string, number>} */
  const counts = { "opened-ledger": 0, "session-label": 0, unrecoverable: 0 };
  for (const id of ids) {
    const resolvedDate = resolveOpenedDate(id, claims);
    byId.set(resolvedDate.id, resolvedDate);
    counts[resolvedDate.source] = (counts[resolvedDate.source] ?? 0) + 1;
  }
  return { byId, counts };
}

/**
 * **THE INSTRUMENT THAT REFUSES RATHER THAN ANSWERING WRONG.**
 *
 * On a full clone this is the exact answer: the first commit whose blob for
 * `path` contains `id`. On a shallow clone every row older than the graft
 * boundary reports the boundary's own date, with no error raised and nothing
 * missing to notice — a wrong date that looks exactly like a right one.
 *
 * So the shallow check comes first and the function returns `null` with a
 * reason. Callers record `UNKNOWN`.
 *
 * @param {{id: string, path?: string, root?: string}} input
 * @returns {{date: string|null, reason: string}}
 */
export function gitFirstAppearance({ id, path = "docs/tracker-working.csv", root = ROOT }) {
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

  let shallow = "false";
  try {
    shallow = git(["rev-parse", "--is-shallow-repository"]).trim();
  } catch {
    return { date: null, reason: "git could not be consulted from this checkout" };
  }
  if (shallow === "true") {
    return {
      date: null,
      reason:
        "this clone is SHALLOW. A first-appearance walk would date every row older " +
        "than the graft boundary to the boundary itself — a fabricated date that " +
        "raises no error. Refusing to answer is the correct output here.",
    };
  }

  let log = "";
  try {
    log = git(["log", "--reverse", "--format=%H %ad", "--date=short", "--", path]);
  } catch {
    return { date: null, reason: `git log over ${path} failed` };
  }
  const commits = log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sha, date] = l.split(/\s+/);
      return { sha, date };
    });

  const needle = new RegExp(`(^|,|")${id}(,|"|$)`, "m");
  for (const c of commits) {
    let blob = "";
    try {
      blob = git(["show", `${c.sha}:${path}`]);
    } catch {
      continue;
    }
    if (needle.test(blob)) {
      return { date: c.date, reason: `first present in ${c.sha} (${path})` };
    }
  }
  return { date: null, reason: `${id} never appears in any available blob of ${path}` };
}
