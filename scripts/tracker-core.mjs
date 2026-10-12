/**
 * **THE TRACKER'S TWO STORES — the shape, the rules, and the pure functions.**
 *
 * Created 2026-08-20 (Prompt E items 5–8). Everything that DECIDES anything
 * about a tracker row lives here so a test can call it without running a
 * script, and so the script and the guard cannot drift apart by holding two
 * copies of the same rule.
 *
 * ## RULING 35 — every section is a queue that empties
 *
 * The tracker was an ongoing list that never emptied: 456 rows, 315 of them
 * finished, in one view. The number the author looked at was 456 rather than
 * what was actually left. So there are TWO stores. The WORKING store holds open
 * rows. The RESOLVED store holds finished ones. Nothing is ever deleted; the
 * resolved store is permanent and is the record of what was decided and when.
 *
 * ## The format, and why it is two files each
 *
 * The author edits `docs/tracker.xlsx` — one workbook, three tabs, opening
 * normally in Excel and Google Sheets. The canonical text is
 * `docs/tracker-working.csv` and `docs/tracker-resolved.csv`, which is what
 * every script and test reads, because **git can diff a CSV and cannot diff a
 * ZIP**. A tracker whose history is a wall of binary blobs cannot answer "when
 * did this row change and who changed it", which is most of what a tracker is
 * for.
 *
 * The two are not two sources of truth. The CSVs are authoritative for
 * everything a session writes; the workbook is authoritative for the three
 * columns the AUTHOR writes (`Resolution`, `Condition`, `Notes`) and for rows
 * he adds by hand. `pnpm tracker:move` reconciles in exactly that direction,
 * every run, and refuses rather than guessing when the two disagree about
 * whether a row exists at all.
 *
 * ## Who may move a row
 *
 * A session marks completed work Resolved (with evidence) and moves it. Sessions
 * also OPEN Needs Sean rows — routing something to his attention is the
 * session's job, and he does not have to notice that something needs him.
 *
 * ## Rows Sean types into the workbook
 *
 * He types a description into the workbook and does not invent an id; the
 * script assigns one and reports which.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv, toCsv } from "./xlsx.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WORKING_CSV = "docs/tracker-working.csv";
export const RESOLVED_CSV = "docs/tracker-resolved.csv";
export const WORKBOOK = "docs/tracker.xlsx";
export const SECTIONS_JSON = "docs/tracker-sections.json";

/**
 * **THE OPENED-ROW LEDGER** (2026-08-21, NH Hunt 2 item 1.4).
 *
 * Append-only, one entry per `tracker add` run: the session that ran it, the
 * stamped day, and every id the run assigned. It exists because a session
 * REPORTS how many rows it opened for the author and nothing checked that
 * claim against the stores — so "opened for you" and "present in the tracker"
 * were two different facts with no instrument between them, and the only way
 * to notice a divergence was for him to go looking for a row and not find one.
 *
 * The invariant is small and total: **every id ever assigned is present in the
 * working store or the resolved store.** Nothing is deleted from either except
 * by his own hand (RULING 46), and a deletion he authorises is recorded in
 * `docs/tracker-deletions.json`, so the guard reads that too rather than
 * treating his decision as a missing row.
 */
export const OPENED_JSON = "docs/tracker-opened.json";
/** The pre-rebuild tracker, frozen. Read for history; never written again. */
export const FROZEN_CSV = "docs/tracker.csv";

/* ---------------------------------------------------------------- schema --- */

/**
 * The columns, in the order the author reads them.
 *
 * Reader-facing first, archival last: he opens this to find out where the
 * project stands, and `Session record` — the thousands of words of session
 * prose the old `Notes` column had become — belongs at the far right where it
 * is available and not in the way.
 */
export const COLUMNS = [
  "ID",
  "Section",
  "Priority",
  "Title",
  "What this is",
  "Resolution",
  "Condition",
  "Notes",
  "Opened on",
  "Resolved on",
  "Last verified",
  "Opened by",
  "Closed by",
  "Depends on",
  "Legacy area",
  "Detail",
  "Session record",
];

/**
 * **`Opened on` — DERIVED, IMMUTABLE, AND NEVER TYPED BY ANYBODY.**
 * (Session C Part B, 2026-08-31.)
 *
 * The tracker could say what was left and who opened it. It could not say WHEN,
 * for any row, anywhere — so nothing in the queue had an AGE, and a queue
 * without ages cannot be triaged. What stood in for an age was prose inside a
 * row's own text, written once by the session that opened it and never
 * rechecked: `NH281` said "stuck since 7/13/2025" about a thing that had
 * already cleared.
 *
 * The column is a projection of `docs/tracker-opened.json`, resolved on every
 * generation by `lib/tracker/opened-dates.mjs`. That is what makes it immutable
 * in the only way that holds: editing the cell changes nothing, because the
 * next generation writes the derived value back over it. A date that cannot be
 * recovered from history reads `UNKNOWN` and is never guessed.
 *
 * **`Last verified` — when a machine last checked whether the row is still
 * true.** Written only by the RULING 227 reconciler (`lib/tracker/reconcile.mjs`) for
 * rows carrying a predicate. Blank means no predicate has ever run against this
 * row, which is itself the honest reading.
 */
export const DERIVED_COLUMNS = ["Opened on", "Last verified"];

/** The three columns the author owns. A session never writes these. */
export const SEAN_COLUMNS = ["Resolution", "Condition", "Notes"];

/**
 * RULING 36 — three resolution states, and only these three. A row carrying
 * none of them is OPEN.
 */
export const RESOLUTIONS = ["Resolved", "Conditionally resolved", "Pending review"];
/** The two that move a row out of the working store. */
export const CLOSING_RESOLUTIONS = ["Resolved", "Conditionally resolved"];

/** RULING 29 — three priority levels. No fourth. */
export const PRIORITIES = ["P1", "P2", "P3"];

/** RULING 30 — five P1 rows maximum per section. */
export const P1_CAP = 5;

/** The prefix the script assigns to a row the author typed into the workbook. */
export const SEAN_ID_PREFIX = "SEAN";
export const SEAN_AUTHOR = "Sean";

/* -------------------------------------------------------------- sections --- */

/**
 * @typedef {{slug: string, title: string, what: string, onlySeanResolves?: boolean, priorities?: Record<string,string>}} TrackerSection
 */

/**
 * @param {string} [root]
 * @returns {TrackerSection[]}
 */
export function readSections(root = ROOT) {
  const spec = JSON.parse(readFileSync(join(root, SECTIONS_JSON), "utf8"));
  const slugs = spec.sections.map((s) => s.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupes.length) throw new Error(`duplicate section slug(s): ${dupes.join(", ")}`);
  if (slugs[0] !== "needs-sean") {
    throw new Error("RULING 31 — Needs Sean is always the first section");
  }
  return spec.sections;
}

/**
 * Display order from the committed list, never from a number on a row.
 *
 * This is the whole of the identifier scheme, and it is why inserting "New
 * Mexico hunt" between two existing sections renumbers nothing: rows carry a
 * SLUG, order is this array's index, and neither a row nor any other section
 * changes when a line is added here.
 */
/** @param {TrackerSection[]} sections @returns {Map<string, number>} */
export function sectionOrder(sections) {
  return new Map(sections.map((s, i) => [s.slug, i]));
}

/* ------------------------------------------------------------------ rows --- */

/**
 * @typedef {Record<string, string>} TrackerRow
 */

/**
 * @param {string} path
 * @param {string} [root]
 * @returns {TrackerRow[]}
 */
export function readStore(path, root = ROOT) {
  const grid = parseCsv(readFileSync(join(root, path), "utf8"));
  const header = grid[0].map((h) => h.trim());
  /*
   * A DERIVED column may be absent from the file on disk and that is not a
   * defect: it is recomputed from history on every generation, so a store
   * written before the column existed still reads, and reads correctly — the
   * value was never in the file in the first place. Only the columns somebody
   * actually WRITES are required to be present, because a missing one of those
   * is data loss.
   */
  const derived = new Set(DERIVED_COLUMNS);
  const missing = COLUMNS.filter((c) => !derived.has(c) && !header.includes(c));
  if (missing.length) {
    throw new Error(`${path} is missing column(s): ${missing.join(", ")}`);
  }
  return grid.slice(1).map((r) => {
    const row = {};
    header.forEach((h, i) => {
      row[h] = r[i] ?? "";
    });
    return row;
  });
}

/** @param {TrackerRow[]} rows @returns {string} */
export function writeStore(rows) {
  return toCsv(
    COLUMNS,
    rows.map((r) => COLUMNS.map((c) =>
      // Historical watcher rows contain multiline log excerpts whose source
      // text ended lines with a space. Once a row moves between stores those
      // become newly-added physical lines and fail `git diff --check`, even
      // though the evidence itself is unchanged. Normalize only horizontal
      // whitespace at embedded line endings; words, line breaks, attribution,
      // and every other byte with evidentiary meaning remain intact.
      String(r[c] ?? "").replace(/[ \t]+(?=\r?\n)/g, "")
    )),
  );
}

/**
 * A row is OPEN when it is not carrying a CLOSING resolution.
 *
 * **This read `!RESOLUTIONS.includes(...)` until 2026-08-20, and that was
 * wrong** — caught on the workbook's first real contact with the author, which
 * is the only place it could have been caught.
 *
 * `Pending review` is one of the three states and it does NOT close a row: it
 * means "needs a look before it can close", and the row stays in the working
 * store because nothing has finished. Treating it as not-open made two rows
 * that were still sitting in the working store, still rendering in their
 * section, invisible to every count — so `docs/tracker.md` stated **140 open**
 * above sections summing to **138**, and the two rows it lost were both P1,
 * which took Needs Sean from three P1 rows to zero without anything happening.
 *
 * A stated number that disagrees with the rows underneath it is the defect
 * `CLAUDE.md`'s stated-N-equals-rendered-rows rule exists to refuse, and this
 * shipped it. `tests/tracker-stores.test.ts` now asserts the summary and the
 * per-section census reconcile, so the arithmetic cannot come apart again.
 *
 * @param {TrackerRow} row @returns {boolean}
 */
export function isOpen(row) {
  return !CLOSING_RESOLUTIONS.includes((row.Resolution ?? "").trim());
}

/** @param {TrackerRow} row @returns {boolean} */
export function closesRow(row) {
  return CLOSING_RESOLUTIONS.includes((row.Resolution ?? "").trim());
}

/** @param {TrackerRow} row @returns {boolean} */
export function isSeanAuthored(row) {
  return (row["Opened by"] ?? "").trim() === SEAN_AUTHOR;
}

/* ------------------------------------------------------------- id minting --- */

/**
 * The next free id in a prefix, from the ids that EXIST rather than from a
 * regex over a file.
 *
 * `docs/tracker.csv` has quoted ids beside bare ones, and a raw
 * `^([A-Z]+)(\d+),` sweep silently skipped the quoted ones — it reported max
 * `R12` when the truth was `R13`, and appending from there created the
 * duplicate-id pair `CLAUDE.md` says breaks every lookup. So this is handed
 * parsed rows, never text.
 */
/** @param {string} prefix @param {TrackerRow[]} allRows @returns {string} */
export function nextId(prefix, allRows) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const r of allRows) {
    const m = re.exec((r.ID ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- moves --- */

/**
 * Which closed rows may move to the resolved store, decided here so the guard
 * test and the move script cannot disagree.
 *
 * Returns `{ moves, refusals }`. A refusal is a sentence naming the row and the
 * rule; the caller writes NOTHING when there is one, because a partial write to
 * a store the author is also editing is worse than a refused run.
 *
 * `actor` is `"session"` or `"sean"`. A session running unattended is always
 * `"session"`; `"sean"` is what the move script uses for a resolution it read
 * out of the workbook, because that resolution is in his handwriting.
 */
/**
 * @param {{working: TrackerRow[], sections?: TrackerSection[], actor?: string, resolutionAuthor?: Record<string,string>}} input
 * @returns {{moves: TrackerRow[], refusals: string[]}}
 */
export function planMoves({ working, actor = "session", resolutionAuthor = {} }) {
  const moves = [];
  const refusals = [];

  for (const row of working) {
    if (!closesRow(row)) continue;
    const id = (row.ID ?? "").trim();
    const author = resolutionAuthor[id] ?? actor;

    /*
     * **RULING 79 (2026-08-22) — a ruling closes the row it answers.**
     *
     * A row can ask a question he has ALREADY ANSWERED: he rules in
     * conversation, the ruling is recorded in `docs/rulings.md` and shipped,
     * and the row that asked the question sits open waiting for him to say the same thing a second time in a
     * spreadsheet. Needs Sean stood at 54 open and an unknown share were
     * already answered — the accumulation the section exists to prevent.
     *
     * `"ruling"` is a THIRD author, not a session pretending to be him. The
     * move script only sets it after checking that the named ruling exists in
     * `docs/rulings.md`, it records the ruling number on the row, and every
     * such close is reported individually so he can reverse any the session got
     * wrong. Ambiguity is not a licence: a row no ruling answers stays open.
     */
    /*
     * **RULING 227 (2026-08-31) — escalation without reconciliation is prohibited.**
     *
     * A FOURTH author, and like RULING 79's it is not a session wearing a
     * disguise. RULING 79 handles the row the author has already ANSWERED.
     * RULING 227 handles the row whose PREMISE HAS EXPIRED — the blocker it
     * describes is measurably no longer there.
     *
     * The three rows that produced the rule: `NH272` asked for a secret that by
     * then existed, `NH281` said production was stuck on a build it had long
     * since moved off, and `NH300` asked for a proof that had already been run
     * 7 of 7 against live Postgres. All three were P1, all three were named in
     * a close-out as "what requires you", and all three were FALSE when that
     * sentence was written. Nobody lied: a row records the wall at the moment a
     * session hits it, and then nothing ever asks whether the wall is still
     * standing. The author reads a queue and cannot tell which rows are
     * photographs.
     *
     * So `"predicate"` closes a row only when a registered predicate in
     * `lib/tracker/registry.mjs` has been RE-EVALUATED against committed
     * artifacts on this run and returned `RESOLVED_BY_EVIDENCE`. The evidence
     * that earned it is written onto the row, so every such close is as
     * reversible and as auditable as a RULING 79 close.
     *
     * A row no machine can decide is marked NOT_MACHINE_VERIFIABLE and carries
     * a decision card, and no predicate may ever touch it. RULING 208 stands
     * too: a predicate closes the ROW, which was a request for the author's
     * attention, and never the record OBLIGATION the row was about.
     */
    if (author === "ruling" && !/RULING \d+/.test(row.Resolution ?? "") && !/RULING \d+/.test(row.Notes ?? "")) {
      refusals.push(
        `RULING 79 — ${id} is being closed by a ruling and the row does not name which. ` +
          `The ruling number is the whole of the authority for the close, and a close ` +
          `he cannot trace is a close he cannot reverse.`,
      );
      continue;
    }
    if ((row.Resolution ?? "").trim() === "Conditionally resolved" && !(row.Condition ?? "").trim()) {
      refusals.push(
        `RULING 36 — ${id} is Conditionally resolved and states no condition. ` +
          "The condition is the whole of what makes it conditional, and RULING 38 " +
          "makes it a live requirement on the next session, which cannot read a blank.",
      );
      continue;
    }
    moves.push(row);
  }
  return { moves, refusals };
}

/* ------------------------------------------------------- RULING 46: Delete --- */

/**
 * **THE FOURTH RESOLUTION STATE, AND ONLY THE AUTHOR MAY SET IT.**
 * (RULING 46, 2026-08-20.)
 *
 * RULING 35's "nothing is ever deleted" governs WORK rows — a session may not
 * erase its own row by marking it done. It was never meant to bind his audit.
 * He must be able to look at a row, judge that it is not project work and does
 * not belong in the tracker at all, and have it gone. `B08` is the first: a
 * personal legal errand that reached the tracker and has nothing to do with
 * this product.
 *
 * `Delete` is therefore a resolution he can write, and a session never can. It
 * is deliberately NOT in `RESOLUTIONS`, because that list is the set of states
 * a row may CARRY and a deleted row carries nothing — it is gone from both
 * stores. What survives is one line in `docs/tracker-deletions.json`, which
 * `docs/log.md` renders: the id, the date, and that he removed it. The record
 * that the row existed survives without the row cluttering anything.
 */
export const DELETE_RESOLUTION = "Delete";

/** Every value the Resolution column may legally hold, for validation. */
export const ALL_RESOLUTIONS = [...RESOLUTIONS, DELETE_RESOLUTION];

/** The permanent record of what was deleted. Never rewritten, only appended. */
export const DELETIONS_JSON = "docs/tracker-deletions.json";

/**
 * His instruction to delete, in his own words, as it appears in the Notes
 * column he owns.
 *
 * This is the SECOND route to a deletion and it exists because the first one
 * cannot reach a row he has already resolved: `Delete` is read out of the
 * workbook's Resolution column, and he wrote "Delete this entirely" into the
 * NOTES of a row he had already marked Resolved. Requiring his words in a
 * column a session may not write is what stops this being a self-authorization
 * — a session cannot manufacture the evidence, because writing that column is
 * itself a refusal.
 */
export const DELETE_INSTRUCTION =
  /\bdelete\s+(this|it|that|the\s+row)\b|\bdelete\s+entirely\b|\bremove\s+this\s+(row\s+)?entirely\b/i;

/**
 * Who may delete what, decided here so the move script and the guard test
 * cannot disagree.
 *
 * @param {{rows: TrackerRow[], requested?: string[], resolutionAuthor?: Record<string,string>, actor?: string}} input
 * @returns {{deletions: {row: TrackerRow, evidence: string}[], refusals: string[]}}
 */
export function planDeletions({
  rows,
  requested = [],
  resolutionAuthor = {},
  actor = "session",
}) {
  const byId = new Map(rows.map((r) => [(r.ID ?? "").trim(), r]));
  /** @type {{row: TrackerRow, evidence: string}[]} */
  const deletions = [];
  const refusals = [];

  const ids = new Set([
    ...rows
      .filter((r) => (r.Resolution ?? "").trim() === DELETE_RESOLUTION)
      .map((r) => (r.ID ?? "").trim()),
    ...requested.map((s) => s.trim()).filter(Boolean),
  ]);

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      refusals.push(
        `RULING 46 — ${id} was named for deletion and is in neither store.`,
      );
      continue;
    }
    const wroteResolution = (resolutionAuthor[id] ?? actor) === "sean";
    const note = (row.Notes ?? "").trim();
    const instructed = DELETE_INSTRUCTION.test(note);

    if (!wroteResolution && !instructed) {
      refusals.push(
        `RULING 46 — ${id} may not be deleted. Delete is the author's state ` +
          "alone: it is set by writing \"Delete\" into the workbook's Resolution " +
          "column, or carried by his own instruction in the Notes column he " +
          "owns. A session has neither here, and a session may never delete a " +
          "row — not its own, and not his.",
      );
      continue;
    }
    deletions.push({
      row,
      evidence: wroteResolution
        ? 'Resolution "Delete", in his handwriting, read out of the workbook'
        : `his note: "${note}"`,
    });
  }
  return { deletions, refusals };
}

/* ------------------------------------------------------------- collisions --- */

/**
 * **THE COLLISION MECHANISM** (item 6.6).
 *
 * The author may be editing `docs/tracker.xlsx` while a session runs, and a
 * session that assumes it owns the file will overwrite whatever he typed in the
 * seconds between the read and the write.
 *
 * So: the workbook is digested when it is READ, and digested again immediately
 * before it is WRITTEN. If the two differ, the file changed under the session
 * and the run REFUSES — it writes nothing at all, names the file, and says to
 * run it again. A refused run costs a minute; a clobbered store costs whatever
 * he had typed and nobody would know what.
 *
 * The committed CSVs are the snapshot everything else reads, so a session that
 * never runs the move script cannot collide with him in the first place.
 */
/** @param {Buffer|Uint8Array|string} buffer @returns {string} */
export function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/* ------------------------------------------------------------- reporting --- */

/**
 * RULING 30, measured. Over-cap sections are REPORTED as stopped and nothing is
 * relabelled to fit — the cap is never satisfied by demotion, because a
 * demotion changes the label and not the situation.
 */
/**
 * @param {TrackerRow[]} working
 * @param {TrackerSection[]} sections
 */
export function p1Census(working, sections) {
  return sections.map((s) => {
    const rows = working.filter((r) => (r.Section ?? "").trim() === s.slug && isOpen(r));
    const p1 = rows.filter((r) => (r.Priority ?? "").trim() === "P1");
    return {
      slug: s.slug,
      title: s.title,
      open: rows.length,
      P1: p1.length,
      P2: rows.filter((r) => (r.Priority ?? "").trim() === "P2").length,
      P3: rows.filter((r) => (r.Priority ?? "").trim() === "P3").length,
      overCap: p1.length > P1_CAP,
      p1Rows: p1.map((r) => `${r.ID} — ${r.Title}`),
    };
  });
}

/* ------------------------------------------- RULING 271: dashboard decisions --- */

/**
 * **A DECISION MADE ON THE DASHBOARD FLOWS OUT TO THE TRACKER.**
 * (ADM-4, the 9.4.26 admin feedback. Lane C.)
 *
 * The owner decides on the control centre; the button appends a durable
 * `OwnerDecisionIntent` to the control plane. Until this existed nothing
 * carried that decision into `docs/tracker-working.csv`, so the Needs Sean
 * queue never emptied from the page — he decided, and then had to go and
 * find the same row in a spreadsheet and decide it again. His words: *"I want
 * to use this dashboard where I can resolve these and then it can go out and
 * be fixed."*
 *
 * `pnpm owner:decisions:pull` exports the collapsed decision log to
 * `docs/tracker-owner-decisions.json`. This function reads that export and
 * decides — PURELY, so a test can hand it any stores it likes — which open
 * Needs Sean rows the owner's recorded decisions close, what work each close
 * implies, and which decisions must be refused and why.
 *
 * ## What earns a close (RULING 271: only the author closes a Needs Sean row)
 *
 * - the intent's subject is an OPEN row in `needs-sean` in the working store;
 * - the intent has not already been applied — no row's `Closed by` carries the
 *   intent id — and it is the LATEST decision about that subject, because a
 *   later decision supersedes an earlier one and applying both would close a
 *   row on an answer he had already changed;
 * - `adminSessionRef` is non-empty: the decision was made in his own
 *   authenticated session, which is what makes it his handwriting rather than
 *   a session's;
 * - and EITHER the chosen option is one of the row's decision-card options,
 *   verbatim, OR he answered in his own words (`ownerAnswer`), in which case
 *   the chosen option may be the `Answered in my own words` literal.
 *
 * A predicate row is REFUSED. Its blocker is a machine-checked wall, not a
 * question; it closes when the wall goes down (RULING 227) and a decision
 * cannot knock it down.
 *
 * ## What a close never does
 *
 * It never closes the OBLIGATION the row was about. Closing a Needs Sean row
 * records that the question was answered; the work the answer implies is
 * opened as a row in the `decided` section, which a session then does and
 * resolves in the ordinary way. A "Decline"/"Defer" answer implies no work
 * and opens nothing.
 *
 * The caller (`scripts/tracker.mjs move`) registers each close as a
 * resolution in the author's hand — `resolutionAuthor[id] = "sean"` — and
 * hands it to `planMoves` on that existing path. There is no bypass here:
 * `planMoves` still decides whether the row may move.
 */

/** The committed export `pnpm owner:decisions:pull` writes and `move` reads. */
export const OWNER_DECISIONS_JSON = "docs/tracker-owner-decisions.json";
/** The section a follow-up row opens in (`docs/tracker-sections.json`). */
export const DECIDED_SECTION = "decided";
/** `Opened by` on every follow-up row, and the ledger session that claims it. */
/*
 * The `-nonhunt` suffix is the expansion-log convention (tests/expansion-log.test.ts):
 * a session heading in docs/log.md carrying it owes no expansion entry, and a
 * dashboard decision hunts nothing — it records what the owner chose.
 */
export const DASHBOARD_OPENER = "dashboard-decision-nonhunt";
/** The id prefix follow-up rows are minted under. */
export const FOLLOW_UP_PREFIX = "DEC";
/**
 * The `chosenOption` literal the dashboard records for an own-words answer.
 * The same string as `ANSWERED_IN_OWN_WORDS` in `lib/control-plane/owner-surface.ts`;
 * repeated here because a `.mjs` run under plain node cannot import TypeScript,
 * and `tests/owner-decisions-outflow.test.ts` asserts the two agree.
 */
export const ANSWERED_IN_OWN_WORDS = "Answered in my own words";
/**
 * An option that begins with one of these implies no work: the row closes on
 * the decision and no follow-up opens. Case-insensitive, matched at the start.
 */
export const NO_FOLLOW_UP_OPTION =
  /^(decline|defer|refuse|open none|say it is no longer|acknowledge|confirm)\b/i;

/** How a dashboard close is attributed in `Closed by`. */
export function dashboardCloser(intentId) {
  return `${SEAN_AUTHOR} (dashboard ${intentId})`;
}

/* ------------------------------------------------- ADM-20: the fix queue --- */

/**
 * **A GAP THE OWNER QUEUED BECOMES A ROW WHEN HE SENDS THE QUEUE.**
 * (ADM-20, the 9.4.26 evening admin feedback.)
 *
 * The control centre's "Add this to the queue" button appends an
 * `OwnerDecisionIntent` whose subject is `fix:<hash>` and whose consequence is
 * "<where> — <what the gap said>"; "Go fix these" appends one whose subject is
 * `fix-queue`. Both travel the decision export. This planner reads them and
 * decides — PURELY — which queued gaps become rows in the `decided` section
 * (Sean decided they get fixed) and which wait.
 *
 * The rule: a queued gap opens a row once a "Go fix these" has been recorded
 * AT OR AFTER it was queued, and only once per queueing (the row's `Detail`
 * carries the intent id; the same gap queued again later is a new intent and
 * opens a new row). A gap queued after the newest Go waits for the next one,
 * because sending the queue is his act, not the applier's.
 *
 * Nothing here closes anything. A fix row is ordinary session work: a session
 * does it and resolves it in the ordinary way.
 */
export const FIX_SUBJECT_PREFIX = "fix:";
export const FIX_QUEUE_SUBJECT = "fix-queue";
/** `Opened by` on every fix row, and the ledger session that claims it. `-nonhunt`: it hunts nothing. */
export const FIX_OPENER = "dashboard-fix-queue-nonhunt";
/** The id prefix fix rows are minted under. */
export const FIX_PREFIX = "FIX";
/** The `Detail` marker a fix row carries, so the applier and the canonicalizer find it by intent. */
export function fixRowMarker(intentId) {
  return `(fix-intent ${intentId})`;
}
export function goRowMarker(goIntentId) {
  return `(sent-by ${goIntentId})`;
}

export function isFixQueueIntent(intent) {
  const subject = (intent?.subjectId ?? "").trim();
  return subject.startsWith(FIX_SUBJECT_PREFIX) || subject === FIX_QUEUE_SUBJECT;
}

/** `where — says` as the queue button recorded it, split back. */
function splitFixConsequence(consequence) {
  const text = (consequence ?? "").trim();
  const at = text.indexOf(" — ");
  return at < 0 ? { where: "the control centre", says: text } : { where: text.slice(0, at), says: text.slice(at + 3) };
}

/**
 * @param {{ working: TrackerRow[], resolved: TrackerRow[], decisions: {intentId: string, subjectId: string, chosenOption: string, consequenceShown?: string, decidedAt: string, adminSessionRef?: string}[] }} input
 * @returns {{ opens: {subjectId: string, intentId: string, goIntentId: string, row: Record<string,string>}[], waiting: {subjectId: string, intentId: string, reason: string}[], refusals: {intentId: string, id: string, reason: string, line: string}[], go: {intentId: string, decidedAt: string} | null }}
 */
export function planFixQueue({ working, resolved, decisions }) {
  const opens = [];
  const waiting = [];
  const refusals = [];
  const fixes = decisions.filter((d) => (d.subjectId ?? "").trim().startsWith(FIX_SUBJECT_PREFIX));
  const goes = decisions
    .filter((d) => (d.subjectId ?? "").trim() === FIX_QUEUE_SUBJECT)
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const go = goes[0] ? { intentId: goes[0].intentId, decidedAt: goes[0].decidedAt } : null;
  const applied = (intentId) => [...working, ...resolved].some((r) => (r.Detail ?? "").includes(fixRowMarker(intentId)));

  // The newest queueing of each gap is the one that stands.
  const bySubject = new Map();
  for (const intent of fixes) {
    const subject = intent.subjectId.trim();
    const held = bySubject.get(subject);
    if (!held || held.decidedAt < intent.decidedAt) bySubject.set(subject, intent);
  }

  for (const intent of bySubject.values()) {
    const subject = intent.subjectId.trim();
    if (applied(intent.intentId)) continue;
    if (!(intent.adminSessionRef ?? "").trim()) {
      refusals.push({ intentId: intent.intentId, id: subject, reason: "no admin session is recorded on the queued gap, so it cannot be shown to be his", line: `${intent.intentId} · ${subject} — no admin session recorded` });
      continue;
    }
    if (go === null || go.decidedAt < intent.decidedAt) {
      waiting.push({ subjectId: subject, intentId: intent.intentId, reason: go === null ? 'queued; no "Go fix these" has been sent yet' : `queued after the newest "Go fix these" (${go.intentId}); waits for the next one` });
      continue;
    }
    const { where, says } = splitFixConsequence(intent.consequenceShown);
    const title = `Fix: ${says}`.slice(0, 120);
    opens.push({
      subjectId: subject,
      intentId: intent.intentId,
      goIntentId: go.intentId,
      row: {
        prefix: FIX_PREFIX,
        Section: DECIDED_SECTION,
        Priority: "P2",
        Title: title,
        "What this is":
          `${where}: ${says} Sean queued this gap from the control centre at ${intent.decidedAt} ` +
          `and sent the queue with "Go fix these" at ${go.decidedAt}. Close the gap on the surface that ` +
          "reported it — measure it, or wire the recording path — then resolve this row.",
        Detail: `${fixRowMarker(intent.intentId)} ${goRowMarker(go.intentId)} subject ${subject}`,
        "Opened by": FIX_OPENER,
      },
    });
  }
  return { opens, waiting, refusals, go };
}

/** The sentence appended to the row's Notes, so the close is traceable on the row itself. */
export function dashboardNote({ intentId, decidedAt, option, consequence, ownerAnswer, ownWords }) {
  if (ownWords) {
    return `Answered on the dashboard ${decidedAt} (intent ${intentId}): "${ownerAnswer}".`;
  }
  const tail = consequence ? ` — ${consequence}` : "";
  return `Decided on the dashboard ${decidedAt} (intent ${intentId}): ${option}${tail}.`;
}

/**
 * The row a session acts on after a close. `What this is` restates the
 * original question, his choice and his words, because the Needs Sean row it
 * came from has left the working view by the time anyone reads this.
 */
export function followUpRowFor({ row, close }) {
  const id = (row.ID ?? "").trim();
  const words = close.ownerAnswer ? close.ownerAnswer : "none";
  const consequence = close.consequence ? ` — ${close.consequence}` : "";
  return {
    prefix: FOLLOW_UP_PREFIX,
    Section: DECIDED_SECTION,
    Priority: "P2",
    Title: `Act on ${id}: ${close.option}`,
    "What this is":
      `${(row.Title ?? "").trim()}. Sean chose: ${close.option}${consequence}. ` +
      `Sean's words: ${words}. Do the work this choice implies, then resolve this row; ` +
      `the Needs Sean row ${id} is closed on his decision and the obligation it concerned ` +
      "stays live (RULING 271).",
    "Depends on": id,
    "Opened by": DASHBOARD_OPENER,
  };
}

/**
 * @param {{
 *   working: TrackerRow[],
 *   resolved: TrackerRow[],
 *   decisions: {intentId: string, subjectId: string, chosenOption: string, consequenceShown?: string, decidedAt: string, adminSessionRef?: string, ownerAnswer?: string|null}[],
 *   registry: {rowId: string, kind: string, options?: {option: string, consequence: string}[]}[],
 * }} input
 * @returns {{
 *   closes: {id: string, intentId: string, option: string, consequence: string, ownerAnswer: string|null, adminSessionRef: string, decidedAt: string, ownWords: boolean, note: string, followUp: boolean}[],
 *   followUps: Record<string, string>[],
 *   refusals: {intentId: string, id: string, reason: string, line: string}[],
 * }}
 */
export function planOwnerDecisions({ working, resolved, decisions, registry }) {
  const closes = [];
  const followUps = [];
  const refusals = [];
  const refuse = (intent, reason) => {
    const id = (intent.subjectId ?? "").trim() || "(no subject)";
    refusals.push({ intentId: intent.intentId, id, reason, line: `${intent.intentId} · ${id} — ${reason}` });
  };

  const workingById = new Map(working.map((r) => [(r.ID ?? "").trim(), r]));
  const resolvedById = new Map(resolved.map((r) => [(r.ID ?? "").trim(), r]));
  const entryById = new Map(registry.map((e) => [e.rowId, e]));
  const appliedIntent = (intentId) =>
    [...resolved, ...working].find((r) => (r["Closed by"] ?? "").includes(intentId));

  /*
   * Only the LATEST decision per subject applies. Grouping first, before any
   * row is looked at, so an earlier decision is refused as superseded rather
   * than as whatever else happens to be wrong with it.
   */
  const bySubject = new Map();
  for (const intent of decisions) {
    // ADM-20: a queued gap or a "Go fix these" is the fix queue's, not a row decision.
    if (isFixQueueIntent(intent)) continue;
    const subject = (intent.subjectId ?? "").trim();
    const list = bySubject.get(subject) ?? [];
    list.push(intent);
    bySubject.set(subject, list);
  }

  for (const [subject, list] of bySubject) {
    const ordered = [...list].sort((a, b) => {
      if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? 1 : -1;
      return a.intentId < b.intentId ? 1 : -1;
    });
    const latest = ordered[0];
    for (const earlier of ordered.slice(1)) {
      refuse(
        earlier,
        `superseded by ${latest.intentId}, a later decision about the same row; only the latest decision applies`,
      );
    }

    const already = appliedIntent(latest.intentId);
    if (already) {
      refuse(latest, `already applied: ${(already.ID ?? "").trim()} is closed by "${already["Closed by"]}"`);
      continue;
    }
    const row = workingById.get(subject);
    if (!row) {
      const done = resolvedById.get(subject);
      refuse(
        latest,
        done
          ? `${subject} is already in the resolved store, closed by "${done["Closed by"]}" on ` +
              `${done["Resolved on"] || "an unrecorded date"}; this decision did not close it`
          : `${subject} is not a row in either store`,
      );
      continue;
    }
    if ((row.Section ?? "").trim() !== "needs-sean") {
      refuse(
        latest,
        `${subject} is in "${row.Section}", and the dashboard applier reaches only Needs Sean (RULING 271)`,
      );
      continue;
    }
    if (!isOpen(row)) {
      refuse(latest, `${subject} already carries "${(row.Resolution ?? "").trim()}" and is not open`);
      continue;
    }
    if (!(latest.adminSessionRef ?? "").trim()) {
      refuse(latest, "no admin session is recorded on the decision, so it cannot be shown to be his");
      continue;
    }
    const entry = entryById.get(subject);
    if (entry && entry.kind === "predicate") {
      refuse(
        latest,
        `${subject} is a machine-checked wall, not a decision: it closes when its predicate goes ` +
          "false (RULING 227), never on a button",
      );
      continue;
    }

    const chosen = (latest.chosenOption ?? "").trim();
    const answer = typeof latest.ownerAnswer === "string" ? latest.ownerAnswer.trim() : "";
    const options = Array.isArray(entry?.options) ? entry.options : [];
    const picked = options.find((o) => (o.option ?? "").trim() === chosen);

    let close;
    if (picked) {
      close = {
        id: subject,
        intentId: latest.intentId,
        option: picked.option.trim(),
        consequence: (latest.consequenceShown ?? "").trim() || (picked.consequence ?? "").trim(),
        ownerAnswer: answer || null,
        adminSessionRef: latest.adminSessionRef.trim(),
        decidedAt: latest.decidedAt,
        ownWords: false,
      };
    } else if (answer) {
      close = {
        id: subject,
        intentId: latest.intentId,
        option: chosen || ANSWERED_IN_OWN_WORDS,
        consequence: "",
        ownerAnswer: answer,
        adminSessionRef: latest.adminSessionRef.trim(),
        decidedAt: latest.decidedAt,
        ownWords: true,
      };
    } else {
      refuse(
        latest,
        entry
          ? `"${chosen}" is none of the ${options.length} option(s) on ${subject}'s decision card ` +
              "and no answer in his own words was given"
          : `${subject} has no decision card in lib/tracker/registry.mjs and no answer in his own ` +
              "words was given, so there is nothing to check the option against",
      );
      continue;
    }
    close.note = dashboardNote(close);
    close.followUp = !NO_FOLLOW_UP_OPTION.test(close.option);
    closes.push(close);
    if (close.followUp) followUps.push(followUpRowFor({ row, close }));
  }

  return { closes, followUps, refusals };
}
