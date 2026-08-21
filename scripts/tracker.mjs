/**
 * **THE TRACKER SCRIPT** — the one thing that writes the two stores.
 * (Prompt E items 6, 9 and 10. 2026-08-20.)
 *
 *   node scripts/tracker.mjs open    # RULING 38 and RULING 41: the session-start read
 *   node scripts/tracker.mjs views   # regenerate the workbook and the readable views
 *   node scripts/tracker.mjs move    # import Sean's edits, move resolved rows, regenerate
 *
 * `pnpm tracker:open` / `pnpm tracker:views` / `pnpm tracker:move`.
 *
 * ## Why one script rather than three
 *
 * Because all three have to agree about what a row is, who may move it, and
 * what "resolved" means, and three scripts holding three copies of that is how
 * the definitions drift. The rules themselves live in `scripts/tracker-core.mjs`
 * so a test can call them without running anything.
 *
 * ## The direction of authority, stated once
 *
 * `docs/tracker-working.csv` and `docs/tracker-resolved.csv` are the stores.
 * `docs/tracker.xlsx` is the surface the author edits. On a `move`, the author's
 * three columns and any row he typed by hand are read OUT of the workbook and
 * INTO the stores; everything else flows the other way. Nothing else in this
 * repository writes the workbook.
 *
 * ## Collision safety (item 6.6)
 *
 * The workbook is digested when it is read and digested again immediately
 * before it is written. A difference means the author saved it while the script
 * was running, and the run REFUSES — writes nothing at all, names the file, and
 * says to run it again. A refused run costs a minute; a clobbered store costs
 * whatever he had typed, and nobody would know what.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";
import {
  COLUMNS,
  RESOLUTIONS,
  RESOLVED_CSV,
  ROOT,
  SEAN_AUTHOR,
  SEAN_COLUMNS,
  SEAN_ID_PREFIX,
  WORKBOOK,
  WORKING_CSV,
  auditSeanRows,
  digest,
  isOpen,
  isSeanAuthored,
  nextId,
  p1Census,
  planMoves,
  readSections,
  readStore,
  writeStore,
} from "./tracker-core.mjs";
import { buildWorkbook, readWorkbook } from "./xlsx.mjs";

const MODE = process.argv[2] ?? "views";
/** Who a SESSION-authored resolution closes as. The author needs no flag. */
const SESSION_LABEL =
  process.argv.find((a) => a.startsWith("--session="))?.slice("--session=".length) ?? "";
const STAMP = today();

const WORKING_SHEET = "Working";
const RESOLVED_SHEET = "Resolved";
const GUIDE_SHEET = "How to use this";

/* ------------------------------------------------------------- the guide --- */

/**
 * A tab the author can read that explains the other two, because a spreadsheet
 * with fifteen columns and three resolution states is a system, and a system
 * nobody wrote down is a system somebody has to remember.
 */
const GUIDE = [
  ["What this is", "The whole tracker, in two tabs. Working is what is left. Resolved is what is finished. Nothing is ever deleted."],
  ["Working", "Every open row, grouped by section. Needs Sean is always first. Read docs/tracker.md instead if you want it in sentences."],
  ["Resolved", "Every finished row, with the date it was resolved and who resolved it. It only grows. This is the record of what was decided and when."],
  ["", ""],
  ["Which columns are yours", "Resolution, Condition and Notes. A session never writes those three. Everything else is written by a script and your edits to it will be overwritten."],
  ["Resolution", "Leave it blank and the row stays open. Otherwise: Resolved, Conditionally resolved, or Pending review. Those three, spelled exactly like that — nothing else is recognised."],
  ["Resolved", "Completely done. The row moves to the Resolved tab the next time a session runs."],
  ["Conditionally resolved", "Done provided something stays true. Write the something in the Condition column in plain language. The next session has to satisfy it or report that it could not."],
  ["Pending review", "Needs a look before it can close. In Needs Sean that means you. Everywhere else a session reviews it."],
  ["Notes", "Anything you want to say. A session reads every note on a row resolved since it last ran, and reports what it did about each one. A note is an instruction, not a comment."],
  ["", ""],
  ["Adding a row", "Type into a blank line at the bottom of Working. Fill in Section, Priority, Title and What this is. LEAVE THE ID BLANK — the script assigns one and tells you which. A session may work your row and may never reword or delete it."],
  ["Section", "One of: needs-sean, nh-hunt, nj-hunt, az-hunt, visual-feedback, data-infrastructure, product-ui, constitution-rules, repo-ops. There is no miscellaneous."],
  ["Priority", "P1 broken or blocking. P2 needed before this section is done. P3 wanted, not needed. Priorities are ranked inside a section and mean nothing across sections."],
  ["", ""],
  ["Needs Sean", "Only you close a row in that section. A session can open one and can work it; it can never mark it resolved or move it out, and the build fails if it tries."],
  ["Needs Sean · P1", "The product is broken or fundamentally different. It doesn't open, or something is drastically changed from what shipped before. Look now."],
  ["Needs Sean · P2", "New information landed — confirm it reads right. The row names one body or class and a sample size."],
  ["Needs Sean · P3", "A small adjustment. Tell me if you like it."],
  ["", ""],
  ["If you are editing while a session runs", "Fine. The script digests this file before and after; if it changed underneath, the run refuses and writes nothing rather than overwriting you."],
];

/* ------------------------------------------------------------- the views --- */

function widthFor(column) {
  if (column === "ID") return 9;
  if (column === "Section") return 20;
  if (column === "Priority") return 9;
  if (column === "Title") return 46;
  if (column === "What this is") return 70;
  if (column === "Resolution") return 22;
  if (column === "Condition") return 40;
  if (column === "Notes") return 46;
  if (column === "Resolved on") return 13;
  if (column === "Opened by" || column === "Closed by") return 26;
  if (column === "Depends on" || column === "Legacy area") return 14;
  return 70;
}

function writeWorkbook(working, resolved) {
  const widths = COLUMNS.map(widthFor);
  const book = buildWorkbook(
    [
      {
        name: WORKING_SHEET,
        header: COLUMNS,
        rows: working.map((r) => COLUMNS.map((c) => r[c] ?? "")),
        widths,
      },
      {
        name: RESOLVED_SHEET,
        header: COLUMNS,
        rows: resolved.map((r) => COLUMNS.map((c) => r[c] ?? "")),
        widths,
      },
      {
        name: GUIDE_SHEET,
        header: ["", "How the tracker works"],
        rows: GUIDE,
        widths: [30, 110],
      },
    ],
    STAMP,
  );
  return book;
}

/** Sections in committed order, each with its open rows sorted for reading. */
function grouped(working, sections) {
  const order = { P1: 0, P2: 1, P3: 2, "": 3 };
  return sections.map((s) => {
    const rows = working
      .filter((r) => (r.Section ?? "").trim() === s.slug)
      .sort((a, b) => {
        const p = (order[(a.Priority ?? "").trim()] ?? 9) - (order[(b.Priority ?? "").trim()] ?? 9);
        if (p !== 0) return p;
        // Within a priority: dependency order — a row nothing depends on
        // sorts after the rows that unblock things.
        const da = (a["Depends on"] ?? "").trim() ? 1 : 0;
        const db = (b["Depends on"] ?? "").trim() ? 1 : 0;
        if (da !== db) return da - db;
        return a.ID.localeCompare(b.ID);
      });
    return { ...s, rows };
  });
}

/**
 * `docs/tracker.md` — the readable view (item 9).
 *
 * Open rows only. A resolved row is not listed, because the whole point of the
 * queue model is that finished work leaves the view; each section states its
 * done count and its open count and nothing more.
 *
 * Row ids appear as LABELS. Everything else is a plain sentence, and a
 * dependency renders as the blocking row's own title rather than as a bare id,
 * because "blocked on B14" tells a reader nothing they did not already not know.
 */
function trackerMarkdown(working, resolved, sections) {
  const byId = new Map([...working, ...resolved].map((r) => [r.ID, r]));
  const groups = grouped(working, sections);
  const census = p1Census(working, sections);
  const out = [];
  const w = (s = "") => out.push(s);

  w("# The tracker — what is left");
  w("");
  w("**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`");
  w("(`scripts/tracker.mjs`) from `docs/tracker-working.csv`. It cannot disagree with the");
  w("store, because it is derived from it.");
  w("");
  w(`Generated ${STAMP} (America/Phoenix, from \`pnpm stamp\`).`);
  w("");
  w("Open rows only. Finished work is in `docs/tracker-resolved.csv` and on the");
  w("**Resolved** tab of `docs/tracker.xlsx`, which is the record of what was decided");
  w("and when. Nothing is ever deleted.");
  w("");
  w("---");
  w("");
  w("## Where the project stands");
  w("");
  w(`- **${working.length} open**, ${resolved.length} resolved.`);
  const needsSean = working.filter((r) => (r.Section ?? "") === "needs-sean");
  w(`- **${needsSean.length} waiting on Sean** — the first section below.`);
  w("- P1 by section:");
  for (const c of census) {
    w(`  - ${c.title} — **${c.P1}** ${c.overCap ? "· **OVER THE FIVE-ROW CAP: THIS SECTION IS STOPPED**" : ""}`.trimEnd());
  }
  const over = census.filter((c) => c.overCap);
  w("");
  if (over.length === 0) {
    w("No section is over the five-P1 cap.");
  } else {
    w(
      `**${over.length} section(s) over the cap.** A section over five P1 rows is STOPPED, ` +
        "and that is reported as a fact. Nothing is relabelled to fit — a demotion changes " +
        "the label and not the situation.",
    );
  }
  w("");
  w("---");
  w("");

  for (const g of groups) {
    const done = resolved.filter((r) => (r.Section ?? "") === g.slug).length;
    w(`## ${g.title}`);
    w("");
    w(g.what);
    w("");
    w(`**${g.rows.length} open · ${done} resolved.**`);
    if (g.onlySeanResolves) {
      w("");
      w("Only Sean closes a row here. A session may open one and may work it.");
    }
    w("");
    if (g.rows.length === 0) {
      w("Nothing open. This section is clear.");
      w("");
      continue;
    }
    let priority = null;
    for (const row of g.rows) {
      const p = (row.Priority ?? "").trim() || "unprioritised";
      if (p !== priority) {
        priority = p;
        w(`### ${p}`);
        w("");
      }
      w(`**${row.ID}** — ${row["What this is"]}`);
      const deps = (row["Depends on"] ?? "")
        .split(/[;,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean)
        .filter((d) => byId.has(d) && isOpen(byId.get(d)));
      if (deps.length) {
        const named = deps.map((d) => `${byId.get(d).Title.toLowerCase()} (${d})`);
        w("");
        w(`  Waiting on ${named.join(", and on ")}.`);
      }
      if ((row.Resolution ?? "").trim() === "Pending review") {
        w("");
        w("  Pending review.");
      }
      w("");
    }
  }

  w("---");
  w("");
  w("Every row also carries who opened it, the technical detail, and the full session");
  w("record. Those are in the spreadsheet and are left out here on purpose: this file");
  w("answers what is left, and the spreadsheet answers everything else.");
  w("");
  return out.join("\n");
}

/* --------------------------------------------------------------- the log --- */

/**
 * `docs/log.md` — what happened, session by session, newest first (item 10).
 *
 * Generated from the attribution and description fields, which is the whole
 * reason those fields exist: a session's entry is the rows it opened and the
 * rows it closed, and both are facts about the repository rather than prose
 * somebody wrote afterwards.
 *
 * The one thing that is not derivable is what a session was FOR. That comes
 * from `docs/log-purposes.json`, authored per session, because "what it was for"
 * in plain language is a sentence and not a query.
 */
function logMarkdown(working, resolved, purposes) {
  const all = [...working, ...resolved];
  const sessions = new Map();
  const touch = (label) => {
    if (!label) return null;
    if (!sessions.has(label)) sessions.set(label, { label, opened: [], closed: [], date: "" });
    return sessions.get(label);
  };
  for (const r of all) {
    const o = touch((r["Opened by"] ?? "").trim());
    if (o) o.opened.push(r);
    const c = touch((r["Closed by"] ?? "").trim());
    if (c) {
      c.closed.push(r);
      if ((r["Resolved on"] ?? "") > c.date) c.date = r["Resolved on"] ?? "";
    }
  }
  // A session's date: the newest date any of its rows carries, or the date in
  // its own label for the runs that predate session handles.
  for (const s of sessions.values()) {
    if (!s.date) {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.label);
      if (m) s.date = m[1];
    }
    for (const r of s.opened) {
      const d = /^(\d{4}-\d{2}-\d{2})/.exec(r["Opened by"] ?? "")?.[1];
      if (d && d > s.date) s.date = d;
    }
  }
  const order = [...sessions.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.label < b.label ? 1 : -1;
  });

  const out = [];
  const w = (s = "") => out.push(s);
  w("# The log — what each session was for, and what came out of it");
  w("");
  w("**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`");
  w("(`scripts/tracker.mjs`) from the tracker's own attribution and description fields,");
  w("plus one authored sentence per session in `docs/log-purposes.json`.");
  w("");
  w(`Generated ${STAMP} (America/Phoenix, from \`pnpm stamp\`).`);
  w("");
  w(`Newest first. **${order.length} sessions.**`);
  w("");
  w("Runs before 2026-08-17 predate the session-naming convention, so they are named by");
  w("their date and their own commit subject. That is a lookup rather than a guess, and");
  w("`git log --grep` finds any of them.");
  w("");
  w("---");
  w("");

  for (const s of order) {
    const purpose = purposes[s.label];
    // A pre-convention label already opens with its own date; repeating it in
    // the heading reads as a mistake and is one.
    const dated = s.date && !s.label.startsWith(s.date) ? ` · ${s.date}` : "";
    w(`## ${s.label}${dated}`);
    w("");
    if (purpose) {
      w(purpose);
      w("");
    }
    if (s.closed.length) {
      w(`**What it finished.** ${s.closed.length} row(s).`);
      w("");
      for (const r of s.closed.slice(0, 12)) w(`- **${r.ID}** — ${r["What this is"]}`);
      if (s.closed.length > 12) w(`- …and ${s.closed.length - 12} more, on the Resolved tab.`);
      w("");
    }
    if (s.opened.length) {
      const stillOpen = s.opened.filter((r) => isOpen(r));
      w(`**What it started.** ${s.opened.length} row(s) opened, ${stillOpen.length} still open.`);
      w("");
      for (const r of stillOpen.slice(0, 12)) {
        w(`- **${r.ID}** — ${r["What this is"]} *(open)*`);
      }
      if (stillOpen.length > 12) w(`- …and ${stillOpen.length - 12} more still open.`);
      w("");
    }
    const sean = s.opened.filter((r) => (r.Section ?? "") === "needs-sean" && isOpen(r));
    w(`**Needs Sean.** ${sean.length === 0 ? "Nothing." : sean.map((r) => r.ID).join(", ")}`);
    w("");
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ read --- */

function loadStores() {
  return { working: readStore(WORKING_CSV), resolved: readStore(RESOLVED_CSV) };
}

function readWorkbookRows() {
  const path = join(ROOT, WORKBOOK);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const sheets = readWorkbook(bytes);
  const pick = (name) => {
    const sheet = sheets.find((s) => s.name === name);
    if (!sheet) return [];
    const header = sheet.rows[0].map((h) => h.trim());
    return sheet.rows.slice(1).map((r) => {
      const row = {};
      header.forEach((h, i) => {
        row[h] = r[i] ?? "";
      });
      return row;
    });
  };
  return {
    digest: digest(bytes),
    working: pick(WORKING_SHEET),
    resolved: pick(RESOLVED_SHEET),
  };
}

/* ------------------------------------------------------------------ open --- */

/**
 * RULING 38 and RULING 41 — the session-start read.
 *
 * Every session opens by reading the resolved store for rows resolved since it
 * last ran, surfacing Sean's notes, and reading the rows he opened himself. A
 * note read and ignored is a session failure, so the read is a command with
 * output rather than a habit somebody has to remember.
 */
function modeOpen(working, resolved) {
  const since = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
  const recent = resolved.filter((r) => !since || (r["Resolved on"] ?? "") >= since);
  const withNotes = recent.filter((r) => (r.Notes ?? "").trim());
  const conditional = resolved.filter(
    (r) => (r.Resolution ?? "").trim() === "Conditionally resolved",
  );
  const seanRows = working.filter(isSeanAuthored);
  const pendingSean = working.filter(
    (r) => (r.Section ?? "") === "needs-sean" && (r.Resolution ?? "").trim() === "Pending review",
  );

  console.log(`\nsession-start read — RULING 38 and RULING 41\n`);
  console.log(`  resolved store        ${resolved.length} row(s)${since ? `, ${recent.length} resolved on or after ${since}` : ""}`);
  console.log(`  carrying a note       ${withNotes.length}`);
  console.log(`  conditionally resolved ${conditional.length} — each condition is a LIVE REQUIREMENT on this session`);
  console.log(`  rows Sean wrote       ${seanRows.length} open`);
  console.log(`  awaiting his review   ${pendingSean.length}`);

  if (withNotes.length) {
    console.log(`\n  HIS NOTES — read every one, and report what was done about each:\n`);
    for (const r of withNotes) {
      console.log(`    ${r.ID} · ${r.Resolution} · ${r["Resolved on"] || "no date"}`);
      console.log(`      ${r.Notes.replace(/\s+/g, " ").trim()}`);
    }
  }
  if (conditional.length) {
    console.log(`\n  CONDITIONS — satisfy each, or report it unsatisfied with the reason:\n`);
    for (const r of conditional) {
      console.log(`    ${r.ID} · ${(r.Condition || "(no condition stated)").replace(/\s+/g, " ").trim()}`);
    }
  }
  if (seanRows.length) {
    console.log(`\n  ROWS SEAN WROTE — his description, never reworded by a session:\n`);
    for (const r of seanRows) {
      console.log(`    ${r.ID} · ${r.Section} · ${(r.Priority || "no priority set")} · ${r.Title}`);
    }
  }
  if (!withNotes.length && !conditional.length && !seanRows.length) {
    console.log(`\n  Nothing waiting. This is a clean open, not an unread one.`);
  }
  console.log("");
}

/* ------------------------------------------------------------------ move --- */

/**
 * **AN ENUM NEAR-MISS IS NOT A REWORDING, AND A TRAILING SPACE IS NOT A
 * DECISION.** (Added 2026-08-20, on the workbook's first real contact with the
 * author — he typed `"Pending "` on two rows, meaning `Pending review`.)
 *
 * RULING 41 forbids a session rewording a row the author wrote. That protects
 * his PROSE — the title and the description, where he is describing what he
 * saw and a session rewriting it replaces the evidence with an interpretation.
 * `Resolution` is not prose. It is a three-value enum, and the honest reading of
 * `"Pending "` is the one state that can begin that way.
 *
 * So: trim, then match case-insensitively as a PREFIX of the three. Exactly one
 * match is taken and REPORTED. Zero matches, or more than one, refuses the whole
 * run and names the row — a value that could mean two things is a question for
 * him, not a guess for a script.
 *
 * The alternative was refusing the run over a trailing space, and a mechanism
 * that fails on the way somebody actually types is a mechanism that gets worked
 * around rather than used.
 */
const normalizations = [];
const resolutionProblems = [];

function normalizeResolution(id, raw) {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  if (RESOLUTIONS.includes(value)) return value;

  const lower = value.toLowerCase();
  const hits = RESOLUTIONS.filter((r) => r.toLowerCase().startsWith(lower));
  if (hits.length === 1) {
    normalizations.push(`${id}: "${raw}" read as "${hits[0]}"`);
    return hits[0];
  }
  resolutionProblems.push(
    hits.length === 0
      ? `${id} carries a resolution of "${raw}", which is none of: ${RESOLUTIONS.join(", ")}`
      : `${id} carries "${raw}", which could mean any of: ${hits.join(", ")}`,
  );
  return value;
}

function modeMove(working, resolved, sections) {
  const book = readWorkbookRows();
  const refusals = [];
  const notes = [];
  const resolutionAuthor = {};
  const assignedIds = [];

  if (book) {
    /*
     * Sean's three columns come OUT of the workbook. A row he touched has a
     * resolution in HIS handwriting, which is what lets RULING 37 let it move
     * out of Needs Sean — the same value written by a session may not.
     */
    const byId = new Map(working.map((r) => [r.ID, r]));
    for (const row of book.working) {
      const id = (row.ID ?? "").trim();
      if (!id) {
        // RULING 41: a row he typed, with no id. The script assigns one.
        const title = (row.Title ?? "").trim();
        if (!title && !(row["What this is"] ?? "").trim()) continue;
        const fresh = nextId(SEAN_ID_PREFIX, [...working, ...resolved, ...assignedIds.map((a) => ({ ID: a }))]);
        assignedIds.push(fresh);
        working.push({
          ...Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? ""])),
          ID: fresh,
          "Opened by": SEAN_AUTHOR,
        });
        continue;
      }
      const store = byId.get(id);
      if (!store) continue;
      for (const c of SEAN_COLUMNS) {
        if ((row[c] ?? "") !== (store[c] ?? "")) {
          if (c === "Resolution") resolutionAuthor[id] = "sean";
          if (c === "Notes" && (row[c] ?? "").trim()) notes.push(`${id}: ${row[c].trim()}`);
          store[c] = c === "Resolution" ? normalizeResolution(id, row[c]) : (row[c] ?? "");
        }
      }
      // RULING 41 again: his row's own words, read back from the file he owns.
      if (isSeanAuthored(store)) {
        for (const c of ["Title", "What this is"]) {
          if ((row[c] ?? "").trim()) store[c] = row[c];
        }
      }
    }
  }

  const before = [...working, ...resolved].map((r) => ({ ...r }));
  const { moves, refusals: moveRefusals } = planMoves({
    working,
    sections,
    actor: "session",
    resolutionAuthor,
  });
  refusals.push(...moveRefusals);

  const moved = new Set(moves.map((r) => r.ID));
  const nextWorking = working.filter((r) => !moved.has(r.ID));
  for (const r of moves) {
    // RULING 39: the stamp is the script's, never a formula's, and a date Sean
    // entered by hand survives.
    if (!(r["Resolved on"] ?? "").trim()) r["Resolved on"] = STAMP;
    /*
     * **WHO CLOSED IT** (added 2026-08-20, on the first real move).
     *
     * RULING 40 says a finished row records which session finished it, and the
     * guard asserts every resolved row carries a `Closed by`. The first move
     * this script ever performed produced two rows with none, because moving a
     * row and recording who moved it had been written as one step and only the
     * first half existed.
     *
     * A resolution read out of the workbook is in the AUTHOR'S handwriting —
     * that is the same fact RULING 37 leans on to let a Needs Sean row move at
     * all — so it closes as `Sean`. Anything else closes as the session, named
     * with `--session=<label>`, and a move with neither REFUSES rather than
     * writing a blank into the column the guard is about to check.
     */
    const closer = resolutionAuthor[r.ID] === "sean" ? SEAN_AUTHOR : SESSION_LABEL;
    if (!(r["Closed by"] ?? "").trim()) {
      if (!closer) {
        refusals.push(
          `${r.ID} is being closed by a session and no session was named — ` +
            "pass --session=<label>. RULING 40: a finished row records which " +
            "session finished it, and a blank is not an attribution.",
        );
        continue;
      }
      r["Closed by"] = closer;
    }
    r.Priority = "";
  }
  const nextResolved = [...resolved, ...moves];

  refusals.push(...resolutionProblems);
  refusals.push(...auditSeanRows({ before, after: [...nextWorking, ...nextResolved] }));

  console.log(`\ntracker move — ${STAMP}\n`);
  console.log(`  workbook read          ${book ? `${book.working.length} working + ${book.resolved.length} resolved row(s)` : "not present — stores only"}`);
  console.log(`  ids assigned           ${assignedIds.length ? assignedIds.join(", ") : "none"}`);
  console.log(`  notes read             ${notes.length}`);
  console.log(`  resolutions normalized ${normalizations.length ? normalizations.join(" · ") : "none"}`);
  console.log(`  rows moved to resolved ${moves.length}`);
  console.log(`  working store          ${working.length} -> ${nextWorking.length}`);
  console.log(`  resolved store         ${resolved.length} -> ${nextResolved.length}`);
  console.log(
    `  the pair               ${nextWorking.length} + ${nextResolved.length} = ${nextWorking.length + nextResolved.length}, against ${before.length} before`,
  );

  if (nextWorking.length + nextResolved.length !== before.length + assignedIds.length) {
    refusals.push(
      `the pair does not reconcile: ${nextWorking.length} + ${nextResolved.length} against ` +
        `${before.length} before plus ${assignedIds.length} new. Nothing is ever deleted.`,
    );
  }

  if (refusals.length) {
    console.log(`\n  REFUSED — nothing written:\n`);
    for (const r of refusals) console.log(`    ${r}`);
    console.log("");
    process.exit(1);
  }

  // Collision check, immediately before the write.
  if (book) {
    const nowDigest = digest(readFileSync(join(ROOT, WORKBOOK)));
    if (nowDigest !== book.digest) {
      console.log(
        `\n  REFUSED — ${WORKBOOK} changed while this ran.\n` +
          `    read  ${book.digest.slice(0, 16)}\n` +
          `    now   ${nowDigest.slice(0, 16)}\n` +
          `    Nothing was written. Sean is probably editing it; run this again.\n`,
      );
      process.exit(1);
    }
  }

  writeFileSync(join(ROOT, WORKING_CSV), writeStore(nextWorking), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(nextResolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}`);
  console.log(`  written  ${RESOLVED_CSV}`);
  return { working: nextWorking, resolved: nextResolved };
}

/* ----------------------------------------------------------------- views --- */

function modeViews(working, resolved, sections) {
  const purposes = existsSync(join(ROOT, "docs/log-purposes.json"))
    ? JSON.parse(readFileSync(join(ROOT, "docs/log-purposes.json"), "utf8"))
    : {};

  const book = writeWorkbook(working, resolved);
  writeFileSync(join(ROOT, WORKBOOK), book);
  writeFileSync(join(ROOT, "docs/tracker.md"), trackerMarkdown(working, resolved, sections), "utf8");
  writeFileSync(join(ROOT, "docs/log.md"), logMarkdown(working, resolved, purposes), "utf8");

  const census = p1Census(working, sections);
  console.log(`\ntracker views — ${STAMP}\n`);
  console.log(`  ${WORKBOOK}            ${book.length} bytes, 3 tabs`);
  console.log(`  docs/tracker.md               ${working.length} open row(s)`);
  console.log(`  docs/log.md                   generated`);
  console.log(`\n  open per section (P1 · P2 · P3):`);
  for (const c of census) {
    console.log(
      `    ${c.title.padEnd(22)} ${String(c.open).padStart(4)}   ${c.P1} · ${c.P2} · ${c.P3}` +
        (c.overCap ? "   OVER THE FIVE-P1 CAP — SECTION STOPPED" : ""),
    );
  }
  console.log(`\n  resolved store                ${resolved.length} row(s)`);
  console.log("");
}

/* ------------------------------------------------------------------ main --- */

const sections = readSections();
let { working, resolved } = loadStores();

if (MODE === "open") {
  modeOpen(working, resolved);
} else if (MODE === "move") {
  ({ working, resolved } = modeMove(working, resolved, sections));
  modeViews(working, resolved, sections);
} else if (MODE === "views") {
  modeViews(working, resolved, sections);
} else {
  console.error(`unknown mode "${MODE}" — expected open, views or move`);
  process.exit(2);
}
