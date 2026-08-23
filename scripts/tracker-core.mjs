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
 * ## RULING 37 — who may move a row
 *
 * A session marks its own completed work Resolved and moves it, in every
 * section except **Needs Sean**. Only Sean closes a Needs Sean row. Sessions
 * OPEN Needs Sean rows — routing something to his attention is the session's
 * job, and he does not have to notice that something needs him.
 *
 * ## RULING 41 — Sean authors rows too
 *
 * He types a description into the workbook and does not invent an id; the
 * script assigns one and reports which. A session may work the row and set a
 * priority if none is set. It may never reword, retitle or delete it.
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
  "Resolved on",
  "Opened by",
  "Closed by",
  "Depends on",
  "Legacy area",
  "Detail",
  "Session record",
];

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

/** RULING 41 — the prefix the script assigns to a row the author typed. */
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
  const missing = COLUMNS.filter((c) => !header.includes(c));
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
    rows.map((r) => COLUMNS.map((c) => r[c] ?? "")),
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

/* ------------------------------------------------- RULING 37 and RULING 41 --- */

/**
 * What a session is ALLOWED to do to the stores, decided here so the guard test
 * and the move script cannot disagree.
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
 * @param {{working: TrackerRow[], sections: TrackerSection[], actor?: string, resolutionAuthor?: Record<string,string>}} input
 * @returns {{moves: TrackerRow[], refusals: string[]}}
 */
export function planMoves({ working, sections, actor = "session", resolutionAuthor = {} }) {
  const onlySean = new Set(
    sections.filter((s) => s.onlySeanResolves).map((s) => s.slug),
  );
  const moves = [];
  const refusals = [];

  for (const row of working) {
    if (!closesRow(row)) continue;
    const id = (row.ID ?? "").trim();
    const section = (row.Section ?? "").trim();
    const author = resolutionAuthor[id] ?? actor;

    /*
     * **RULING 79 (2026-08-22) — a ruling closes the row it answers.**
     *
     * This amends RULING 37 narrowly and deliberately. RULING 37 stands for a
     * row awaiting his judgement. What it did not anticipate is the row he has
     * ALREADY ANSWERED: he rules in conversation, the ruling is recorded in
     * `docs/rulings.md` and shipped, and the row that asked the question sits
     * open waiting for him to say the same thing a second time in a
     * spreadsheet. Needs Sean stood at 54 open and an unknown share were
     * already answered — the accumulation the section exists to prevent.
     *
     * `"ruling"` is a THIRD author, not a session pretending to be him. The
     * move script only sets it after checking that the named ruling exists in
     * `docs/rulings.md`, it records the ruling number on the row, and every
     * such close is reported individually so he can reverse any the session got
     * wrong. Ambiguity is not a licence: a row no ruling answers stays open.
     */
    if (onlySean.has(section) && author !== "sean" && author !== "ruling") {
      refusals.push(
        `RULING 37 — ${id} is in "${section}" and only Sean closes a row there. ` +
          `A session may open one and may work it; it may never mark it ` +
          `"${(row.Resolution ?? "").trim()}" or move it out, however finished it looks. ` +
          `RULING 79 is the one exception and it needs a dated ruling in docs/rulings.md ` +
          `that demonstrably answers this row, named with --ruling ${id}=<number>.`,
      );
      continue;
    }
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

/**
 * RULING 41 — a session may not reword, retitle or delete a row the author
 * wrote. It may work the row and set a priority if none is set.
 *
 * Both stores are compared, because "delete" includes moving a row somewhere
 * it stops being visible.
 */
export const SEAN_IMMUTABLE = ["Title", "What this is"];

/**
 * @param {{before: TrackerRow[], after: TrackerRow[]}} input
 * @returns {string[]}
 */
export function auditSeanRows({ before, after }) {
  const wasSean = new Map(
    before.filter(isSeanAuthored).map((r) => [(r.ID ?? "").trim(), r]),
  );
  const now = new Map(after.map((r) => [(r.ID ?? "").trim(), r]));
  const refusals = [];

  for (const [id, was] of wasSean) {
    const is = now.get(id);
    if (!is) {
      refusals.push(`RULING 41 — ${id} was written by Sean and is no longer in either store.`);
      continue;
    }
    for (const field of SEAN_IMMUTABLE) {
      if ((was[field] ?? "") !== (is[field] ?? "")) {
        refusals.push(
          `RULING 41 — ${id} was written by Sean and its "${field}" was changed by a ` +
            "session. The description is his. A session may work the row, set a " +
            "priority if none is set, and resolve it under RULING 37 — nothing else.",
        );
      }
    }
    if (isSeanAuthored(was) && !isSeanAuthored(is)) {
      refusals.push(`RULING 41 — ${id}'s attribution to Sean was overwritten.`);
    }
  }
  return refusals;
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
