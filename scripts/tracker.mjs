/**
 * **THE TRACKER SCRIPT** — the one thing that writes the two stores.
 * (Prompt E items 6, 9 and 10. 2026-08-20.)
 *
 *   node scripts/tracker.mjs open    # RULING 38: the session-start read
 *   node scripts/tracker.mjs views   # regenerate the workbook and the readable views
 *   node scripts/tracker.mjs move    # import Sean's edits, move resolved rows, regenerate
 *   node scripts/tracker.mjs add <rows.json>   # open new rows in the working store
 *   node scripts/tracker.mjs note <ID> <file>  # append to a row's Session record
 *
 * `pnpm tracker:open` / `pnpm tracker:views` / `pnpm tracker:move` /
 * `pnpm tracker:add`.
 *
 * ## Why `add` had to exist (NH Hunt, 2026-08-20)
 *
 * Opening rows is a session's JOB — routing something to his attention is the
 * session's job, and he does not have to notice that something needs him —
 * and there was no command that did it. The old
 * `scripts/tracker-add-row.mjs` writes `docs/tracker.csv`, which is the
 * FROZEN pre-rebuild snapshot and may never be written again, so a session
 * that used it would have written a row into a file nothing reads.
 *
 * A session with no way to open a row either invents one (writing a store
 * directly, past every guard in this file) or does not open it. Both were
 * available and neither is acceptable.
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
  ALL_RESOLUTIONS,
  CLOSING_RESOLUTIONS,
  DASHBOARD_OPENER,
  DELETIONS_JSON,
  FIX_OPENER,
  OPENED_JSON,
  OWNER_DECISIONS_JSON,
  dashboardCloser,
  planDeletions,
  planOwnerDecisions,
  RESOLVED_CSV,
  ROOT,
  SEAN_AUTHOR,
  SEAN_COLUMNS,
  SEAN_ID_PREFIX,
  WORKBOOK,
  WORKING_CSV,
  digest,
  isOpen,
  isSeanAuthored,
  PRIORITIES,
  nextId,
  p1Census,
  planMoves,
  readSections,
  readStore,
  writeStore,
} from "./tracker-core.mjs";
import { buildWorkbook, readWorkbook } from "./xlsx.mjs";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { reconcileTracker, reconciliationReport } from "../lib/ops/tracker-transaction.ts";
import { REGISTRY } from "../lib/tracker/registry.mjs";
import { RESOLVED_BY_EVIDENCE, auditCoverage, evaluateEntry } from "../lib/tracker/predicates.mjs";
import { applyOpenedDates, reconcile, summarize } from "../lib/tracker/reconcile.mjs";
import { ownerView } from "../lib/tracker/owner-view.mjs";

const MODE = process.argv[2] ?? "views";
/** Who a SESSION-authored resolution closes as. The author needs no flag. */
const SESSION_LABEL =
  process.argv.find((a) => a.startsWith("--session="))?.slice("--session=".length) ?? "";

/**
 * RULING 46 — rows to hard-remove. A session may pass this flag, and a session
 * still cannot delete anything with it: `planDeletions` refuses every id whose
 * authority is not in the author's own handwriting, either as a `Delete`
 * resolution in the workbook or as his instruction in the Notes column he owns.
 * The flag is how his instruction gets EXECUTED, never how one gets made.
 */
const DELETE_IDS = (
  process.argv.find((a) => a.startsWith("--delete="))?.slice("--delete=".length) ?? ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
/**
 * **RULING 79 (2026-08-22) — the rows a recorded ruling closes.**
 *
 * `--ruling NS02=78,NS04=81` says: RULING 78 answers `NS02`, RULING 81 answers
 * `NS04`. Each named ruling is checked against `docs/rulings.md` before
 * anything moves — a close whose authority does not exist is refused, not
 * written — and the ruling number is stamped onto the row so he can trace and
 * reverse any the session got wrong.
 *
 * This is the ONLY way a session closes a Needs Sean row, and it is not a
 * general-purpose flag: `planMoves` still refuses every Needs Sean row that
 * arrives without one.
 */
const RULING_CLOSURES = Object.fromEntries(
  (process.argv.find((a) => a.startsWith("--ruling="))?.slice("--ruling=".length) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((pair) => {
      const [id, ruling] = pair.split("=");
      return [id.trim(), (ruling ?? "").trim()];
    }),
);

/**
 * **A SESSION CLOSING ITS OWN WORK HAD NO PATH.** (`NH64`, closed 2026-08-22.)
 *
 * A session marks its own completed work Resolved and moves it, and this
 * script had no mode or flag that did it: `Resolution`, `Condition` and
 * `Notes` were read ONLY out of the workbook, and anything found there is
 * attributed to SEAN. So a session finishing its own work either left the row
 * open or wrote a resolution into a file the tool credits to him — and both are
 * worse than the rule not existing.
 *
 * `--resolve=PU02,NJ07` marks those rows Resolved and closes them as the
 * session (`--session=`).
 */
const RESOLVE_IDS = (
  process.argv.find((a) => a.startsWith("--resolve="))?.slice("--resolve=".length) ?? ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

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
  ["Section", "One of: needs-sean, nh-hunt, nj-hunt, az-hunt, visual-feedback, data-infrastructure, product-ui, constitution-rules, repo-ops, decided. There is no miscellaneous. (decided is where the work behind a dashboard decision waits; a session opens those rows, not you.)"],
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
  if (column === "Resolved on" || column === "Opened on") return 13;
  if (column === "Last verified") return 34;
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
  /* The opened ledger, for sessions whose rows are all still open. See below. */
  const openedLedgerPath = join(ROOT, OPENED_JSON);
  const openedLedger = existsSync(openedLedgerPath)
    ? JSON.parse(readFileSync(openedLedgerPath, "utf8"))
    : [];
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
  /*
   * A session's date: the newest date any of its rows carries, the date the
   * OPENED LEDGER recorded for it, or the date in its own label for the runs
   * that predate session handles.
   *
   * **The ledger reading was added 2026-08-23 and it closes a real hole.** A
   * session that only OPENS rows — which is every session that finds more than
   * it finishes, and is a perfectly ordinary shape — had no date at all: rows
   * carry `Resolved on` and nothing else dated, `Opened by` is a bare session
   * label, and a modern label like `discovery-conduct-0823-nonhunt` has no ISO
   * date in it to fall back to.
   *
   * The consequence was not cosmetic. An undated session sorts BELOW every
   * dated one, so the newest run in the repo rendered at the BOTTOM of a
   * newest-first document, with no date beside its name. `docs/tracker-opened.json`
   * has recorded the date all along; nothing was reading it.
   */
  for (const s of sessions.values()) {
    if (!s.date) {
      /*
       * ISO ONLY. 89 of the ledger's 111 entries record
       * `reconstructed-2026-08-21` rather than a date, and that string sorts
       * ABOVE every real date — the first version of this lookup put six
       * reconstructed runs at the top of a newest-first document. A value that
       * is not a date is not a date.
       */
      const fromLedger = openedLedger.find((e) => e.session === s.label)?.opened ?? "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromLedger)) s.date = fromLedger;
    }
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

  /*
   * **RULING 46 — the deleted rows, which are in neither store.**
   *
   * A deleted row is hard-removed, so it cannot appear in the session entries
   * below: those are generated FROM the stores. The record that it existed
   * lives in `docs/tracker-deletions.json` and is rendered here, which is what
   * the ruling asks for — id, date, and that he removed it — without the row
   * cluttering anything.
   */
  const deletionRecord = existsSync(join(ROOT, DELETIONS_JSON))
    ? JSON.parse(readFileSync(join(ROOT, DELETIONS_JSON), "utf8"))
    : { deletions: [] };
  if (deletionRecord.deletions.length) {
    w("## Deleted rows — RULING 46");
    w("");
    w("Rows Sean removed outright, because they are not project work and do not");
    w("belong in the tracker at all. **Only he may delete a row**; a session never");
    w("may, and `tests/tracker-stores.test.ts` fails the build if one tries. These");
    w("are hard-removed from both stores — this list is the whole surviving record.");
    w("");
    for (const d of deletionRecord.deletions) {
      w(`- **${d.id}** — ${d.title || "(no title)"} · deleted ${d.deletedOn} by ${d.deletedBy} · authority: ${d.evidence}`);
    }
    w("");
    w("---");
    w("");
  }

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
    /*
     * **RULING 106 (2026-08-23) — the twelve-row clips are gone.**
     *
     * These read `.slice(0, 12)` with an "…and N more" line beneath. That is a
     * size cap on a generated document wearing a polite face: the rows exist,
     * the file knows them, and it prints a count instead — which is a partial
     * that reconciles and reports success. `docs/log.md` is the session record,
     * and the rows it dropped were exactly the ones from a busy session, which
     * is when a reader most needs them.
     *
     * The count still prints. Now it prints as the denominator of a list that
     * is actually there, which is the stated-N-equals-rendered-rows rule.
     */
    if (s.closed.length) {
      w(`**What it finished.** ${s.closed.length} row(s).`);
      w("");
      for (const r of s.closed) w(`- **${r.ID}** — ${r["What this is"]}`);
      w("");
    }
    if (s.opened.length) {
      const stillOpen = s.opened.filter((r) => isOpen(r));
      w(`**What it started.** ${s.opened.length} row(s) opened, ${stillOpen.length} still open.`);
      w("");
      for (const r of stillOpen) {
        w(`- **${r.ID}** — ${r["What this is"]} *(open)*`);
      }
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
 * RULING 38 — the session-start read.
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

  console.log(`\nsession-start read — RULING 38\n`);
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
    console.log(`\n  ROWS SEAN WROTE:\n`);
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
 * A row's title and description are prose — what the person who wrote it saw.
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
  // RULING 46: "Delete" is a legal value in the column even though a deleted
  // row carries nothing afterwards — it has to survive normalisation to reach
  // `planDeletions`, which is the thing that decides whether it is allowed.
  if (ALL_RESOLUTIONS.includes(value)) return value;

  const lower = value.toLowerCase();
  const hits = ALL_RESOLUTIONS.filter((r) => r.toLowerCase().startsWith(lower));
  if (hits.length === 1) {
    normalizations.push(`${id}: "${raw}" read as "${hits[0]}"`);
    return hits[0];
  }
  resolutionProblems.push(
    hits.length === 0
      ? `${id} carries a resolution of "${raw}", which is none of: ${ALL_RESOLUTIONS.join(", ")}`
      : `${id} carries "${raw}", which could mean any of: ${hits.join(", ")}`,
  );
  return value;
}

/**
 * **RULING 271 — the decisions he made on the dashboard, read into the move.**
 * (ADM-4, the 9.4.26 admin feedback. Lane C.)
 *
 * `pnpm owner:decisions:pull` writes `docs/tracker-owner-decisions.json`; this
 * reads it and asks `planOwnerDecisions` (in `tracker-core.mjs`, pure, tested
 * against synthetic stores) which open Needs Sean rows the owner's recorded
 * decisions close and what work each close implies. The follow-up rows go
 * through `mintRows` — the SAME validation `add` applies — attributed to
 * `dashboard-decision`.
 *
 * Nothing here asks a question, deletes a row, or rewords one. Absent file:
 * nothing to apply, and the block says so rather than printing zeros.
 */
function planDashboardDecisions({ working, resolved, sections }) {
  const path = join(ROOT, OWNER_DECISIONS_JSON);
  if (!existsSync(path)) return null;
  const file = JSON.parse(readFileSync(path, "utf8"));
  const decisions = Array.isArray(file?.intents) ? file.intents : [];
  const plan = planOwnerDecisions({ working, resolved, decisions, registry: REGISTRY });
  const minted = mintRows(plan.followUps, { working, resolved, sections, label: DASHBOARD_OPENER });
  /*
   * ADM-20: the gaps he queued and sent with "Go fix these" open as rows too,
   * minted through the SAME validation, after the decision follow-ups so the
   * ids do not collide, and attributed to the fix queue.
   */
  const fixes = { opens: [], waiting: [], refusals: [], go: null };
  const mintedFixes = mintRows(fixes.opens.map((o) => o.row), {
    working,
    resolved: [...resolved, ...minted.added],
    sections,
    label: FIX_OPENER,
  });
  return { decisions, plan, minted, fixes, mintedFixes };
}

/**
 * `--only=dashboard` (ADM-16, the 9.4.26 evening feedback): apply the owner's
 * recorded dashboard decisions and queued fixes WITHOUT importing the
 * workbook. The standing runner runs this after every cycle
 * (`scripts/apply-owner-decisions.mts`); importing his workbook edits is a
 * session's deliberate act at a session's start, not something a machine does
 * every twenty minutes while he may be typing in it.
 */
const ONLY_DASHBOARD = process.argv.includes("--only=dashboard");

function modeMove(working, resolved, sections) {
  const book = ONLY_DASHBOARD ? null : readWorkbookRows();
  if (ONLY_DASHBOARD) console.log("\n  --only=dashboard: the workbook is not imported on this run");
  const refusals = [];
  const notes = [];
  const resolutionAuthor = {};
  const assignedIds = [];

  if (book) {
    /*
     * Sean's three columns come OUT of the workbook. A row he touched has a
     * resolution in HIS handwriting, so it is recorded as closed by him rather
     * than by a session.
     */
    const byId = new Map(working.map((r) => [r.ID, r]));
    for (const row of book.working) {
      const id = (row.ID ?? "").trim();
      if (!id) {
        // A row he typed, with no id. The script assigns one.
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
      // His row's own words, read back from the workbook he edits.
      if (isSeanAuthored(store)) {
        for (const c of ["Title", "What this is"]) {
          if ((row[c] ?? "").trim()) store[c] = row[c];
        }
      }
    }
  }

  /*
   * **RULING 271 — the owner's dashboard decisions, applied before anything
   * is planned.** A close here is in HIS handwriting: the decision was made
   * in his authenticated admin session and pulled from the control plane, so
   * it registers as `resolutionAuthor = "sean"` — the same path a resolution
   * read out of his workbook takes. `planMoves` is not bypassed: it still
   * decides, on that path, whether the row may move.
   */
  const dashboard = planDashboardDecisions({ working, resolved, sections });
  const dashboardRows = dashboard ? [...dashboard.minted.added, ...dashboard.mintedFixes.added] : [];
  if (dashboard) {
    refusals.push(...dashboard.mintedFixes.refusals);
    console.log(`\nfix queue (ADM-20) — ${OWNER_DECISIONS_JSON}`);
    console.log(
      `  ${dashboard.fixes.go ? `newest "Go fix these" ${dashboard.fixes.go.intentId} at ${dashboard.fixes.go.decidedAt}` : 'no "Go fix these" recorded yet'}` +
        `; rows opened ${dashboard.mintedFixes.added.length ? dashboard.mintedFixes.added.map((r) => `${r.ID} (${r.Title})`).join(", ") : "none"}` +
        `; waiting ${dashboard.fixes.waiting.length}` +
        (dashboard.fixes.refusals.length ? `; refused ${dashboard.fixes.refusals.length}: ${dashboard.fixes.refusals.map((r) => r.line).join("; ")}` : ""),
    );
    for (const close of dashboard.plan.closes) {
      const row = working.find((r) => (r.ID ?? "").trim() === close.id);
      if (!(row.Resolution ?? "").trim()) row.Resolution = "Resolved";
      row.Notes = [(row.Notes ?? "").trim(), close.note].filter(Boolean).join(" ");
      row["Closed by"] = dashboardCloser(close.intentId);
      resolutionAuthor[close.id] = "sean";
    }
    refusals.push(...dashboard.minted.refusals);

    console.log(`\ndashboard decisions (RULING 271) — ${OWNER_DECISIONS_JSON}`);
    console.log(
      `  ${floorLine(
        floored(
          "intents applied as Needs Sean closes",
          OWNER_DECISIONS_JSON,
          dashboard.decisions.length,
          dashboard.plan.closes.length,
          dashboard.decisions.length === 0
            ? "the export holds no intent — nothing has been decided on the dashboard, or pnpm owner:decisions:pull has not run"
            : undefined,
        ),
      )}`,
    );
    for (const c of dashboard.plan.closes) {
      console.log(`  ${c.id} ← ${c.ownWords ? `answered in his own words` : c.option} (intent ${c.intentId})`);
    }
    console.log(
      `  follow-ups opened      ${
        dashboardRows.length
          ? dashboardRows.map((r) => `${r.ID} (acts on ${r["Depends on"]})`).join(", ")
          : "none"
      }`,
    );
    if (dashboard.plan.refusals.length) {
      console.log(`  not applied            ${dashboard.plan.refusals.length} of ${dashboard.decisions.length}, each by reason:`);
      for (const r of dashboard.plan.refusals) console.log(`    ${r.line}`);
    }
  } else {
    console.log(`\ndashboard decisions (RULING 271) — ${OWNER_DECISIONS_JSON} is not present; nothing to apply`);
  }

  /*
   * RULING 79, applied before anything is planned: mark the rows a recorded
   * ruling closes, refusing any whose ruling is not actually in the file.
   */
  /*
   * Resolved against the CANONICAL LEDGER, not by parsing a markdown heading.
   *
   * This used to test `^### RULING n` against `docs/rulings.md`. That file is
   * GENERATED now and emits `## RULING n`, so the old pattern matched NOTHING
   * and every ruling-backed closure would have been refused — a guard that
   * looks strict while having stopped reading its subject.
   *
   * The ledger is the record a ruling actually exists in, and asking it means
   * this check keeps working however the human-readable view is formatted.
   */
  const LEDGER = join(ROOT, "docs", "governance", "ledger.jsonl");
  const ledgerIds = new Set();
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      const n = /^R-0*(\d+)$/.exec(rec.id);
      if (n) ledgerIds.add(n[1]);
    }
  }
  const rulingCloses = [];
  for (const [id, ruling] of Object.entries(RULING_CLOSURES)) {
    const row = working.find((r) => (r.ID ?? "").trim() === id);
    if (!row) {
      refusals.push(`RULING 79 — ${id} is not an open row, so no ruling can close it.`);
      continue;
    }
    if (!/^\d+$/.test(ruling)) {
      refusals.push(`RULING 79 — ${id}=${ruling} does not name a ruling NUMBER.`);
      continue;
    }
    if (!ledgerIds.has(String(Number(ruling)))) {
      refusals.push(
        `RULING 79 — RULING ${ruling} is not in docs/governance/ledger.jsonl, so it cannot ` +
          `close ${id}. A close whose authority does not exist is worse than an open row.`,
      );
      continue;
    }
    if (!(row.Resolution ?? "").trim()) row.Resolution = "Resolved";
    const note = `Closed under RULING ${ruling} (RULING 79), ${STAMP}${SESSION_LABEL ? `, ${SESSION_LABEL}` : ""}.`;
    row.Notes = [(row.Notes ?? "").trim(), note].filter(Boolean).join(" ");
    resolutionAuthor[id] = "ruling";
    rulingCloses.push(`${id} ← RULING ${ruling}`);
  }
  if (rulingCloses.length > 0) {
    console.log(`\nRULING 79 closes (each is reported so any can be reversed):`);
    for (const line of rulingCloses) console.log(`  ${line}`);
  }

  /* A session closing its own completed work. */
  const sessionCloses = [];
  for (const id of RESOLVE_IDS) {
    const row = working.find((r) => (r.ID ?? "").trim() === id);
    if (!row) {
      refusals.push(`${id} is not an open row, so a session cannot resolve it.`);
      continue;
    }
    if (!(row.Resolution ?? "").trim()) row.Resolution = "Resolved";
    sessionCloses.push(id);
  }
  if (sessionCloses.length > 0) {
    console.log(`
session closes: ${sessionCloses.join(", ")}`);
  }

  const before = [...working, ...resolved].map((r) => ({ ...r }));

  /*
   * RULING 46 — his deletions, executed before anything else moves.
   *
   * Hard-removed from both stores, and recorded permanently in
   * `docs/tracker-deletions.json`, which `docs/log.md` renders. The record has
   * to live outside the stores by construction: the row is gone from them, and
   * the log is generated FROM them.
   */
  const { deletions, refusals: deleteRefusals } = planDeletions({
    rows: [...working, ...resolved],
    requested: DELETE_IDS,
    resolutionAuthor,
    actor: "session",
  });
  refusals.push(...deleteRefusals);
  const deletedIds = new Set(deletions.map((d) => (d.row.ID ?? "").trim()));

  /*
   * **RULING 227 — a row whose predicate has gone false moves out.**
   *
   * The authority is NOT the "(RULING 227 auto-reconciliation)" string sitting
   * in the row's `Closed by` column. That string is data, and data in a CSV is
   * exactly what a session could type by hand. So the predicate is
   * RE-EVALUATED here, at move time, against the committed artifacts — and only a row whose predicate answers
   * RESOLVED_BY_EVIDENCE right now is granted the `predicate` author.
   *
   * A row that HOLDS or that CANNOT_TELL at move time is left exactly where it
   * is, whatever its columns claim.
   */
  const predicateCloses = [];
  for (const entry of REGISTRY) {
    if (entry.kind !== "predicate") continue;
    const row = working.find((r) => (r.ID ?? "").trim() === entry.rowId);
    if (!row || !CLOSING_RESOLUTIONS.includes((row.Resolution ?? "").trim())) continue;
    const outcome = evaluateEntry(entry, { root: ROOT });
    if (outcome.verdict !== RESOLVED_BY_EVIDENCE) {
      refusals.push(
        `RULING 227 — ${entry.rowId} carries a closing resolution but its predicate ` +
          `re-evaluates to ${outcome.verdict} right now: ${outcome.why} The row does not ` +
          "move on a stale claim, including one this mechanism itself wrote earlier.",
      );
      continue;
    }
    resolutionAuthor[entry.rowId] = "predicate";
    predicateCloses.push(`${entry.rowId} ← predicate re-evaluated FALSE: ${outcome.why}`);
  }
  if (predicateCloses.length > 0) {
    console.log("\nRULING 227 auto-reconciliation closes (each is reported so any can be reversed):");
    for (const line of predicateCloses) console.log(`  ${line}`);
  }

  const { moves, refusals: moveRefusals } = planMoves({
    working,
    sections,
    actor: "session",
    resolutionAuthor,
  });
  refusals.push(...moveRefusals);

  const moved = new Set(moves.map((r) => r.ID));
  /* The RULING 271 follow-up rows join the working store here, already
   * validated and minted by `mintRows` with the ledger's claims in the pool. */
  const nextWorking = [
    ...working.filter((r) => !moved.has(r.ID) && !deletedIds.has((r.ID ?? "").trim())),
    ...dashboardRows,
  ];
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
     * A resolution read out of the workbook is in the AUTHOR'S handwriting, so
     * it closes as `Sean`. Anything else closes as the session, named
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
  const nextResolved = [...resolved, ...moves].filter(
    (r) => !deletedIds.has((r.ID ?? "").trim()),
  );

  refusals.push(...resolutionProblems);

  console.log(`\ntracker move — ${STAMP}\n`);
  console.log(`  workbook read          ${book ? `${book.working.length} working + ${book.resolved.length} resolved row(s)` : "not present — stores only"}`);
  console.log(`  ids assigned           ${assignedIds.length ? assignedIds.join(", ") : "none"}`);
  console.log(`  notes read             ${notes.length}`);
  console.log(`  resolutions normalized ${normalizations.length ? normalizations.join(" · ") : "none"}`);
  console.log(`  rows moved to resolved ${moves.length}`);
  console.log(
    `  rows DELETED (RULING 46) ${deletions.length ? deletions.map((d) => d.row.ID).join(", ") : "none"}`,
  );
  console.log(
    `  rows opened (RULING 271) ${dashboardRows.length ? dashboardRows.map((r) => r.ID).join(", ") : "none"}`,
  );
  console.log(`  working store          ${working.length} -> ${nextWorking.length}`);
  console.log(`  resolved store         ${resolved.length} -> ${nextResolved.length}`);
  console.log(
    `  the pair               ${nextWorking.length} + ${nextResolved.length} = ${nextWorking.length + nextResolved.length}, against ${before.length} before`,
  );

  if (
    nextWorking.length + nextResolved.length !==
    before.length + assignedIds.length + dashboardRows.length - deletedIds.size
  ) {
    refusals.push(
      `the pair does not reconcile: ${nextWorking.length} + ${nextResolved.length} against ` +
        `${before.length} before, plus ${assignedIds.length} new, plus ${dashboardRows.length} ` +
        `opened on dashboard decisions (RULING 271), less ${deletedIds.size} deleted under ` +
        "RULING 46. Nothing else is ever deleted.",
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

  if (deletions.length) {
    const path = join(ROOT, DELETIONS_JSON);
    const record = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { note: "RULING 46 — rows Sean removed outright. Append-only.", deletions: [] };
    for (const d of deletions) {
      record.deletions.push({
        id: (d.row.ID ?? "").trim(),
        section: (d.row.Section ?? "").trim(),
        title: (d.row.Title ?? "").trim(),
        deletedOn: STAMP,
        deletedBy: SEAN_AUTHOR,
        evidence: d.evidence,
      });
    }
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`\n  written  ${DELETIONS_JSON}`);
  }

  /*
   * RULING 271 follow-ups are claimed in the opened ledger in the SAME run
   * that mints them, exactly as `add` does — `tests/tracker-stores.test.ts`
   * fails the build on a row in a store that no ledger entry claims.
   */
  if (dashboardRows.length) {
    const ledgerPath = join(ROOT, OPENED_JSON);
    const ledger = readLedger();
    if (dashboard.minted.added.length) {
      ledger.push({
        session: DASHBOARD_OPENER,
        opened: STAMP,
        ids: dashboard.minted.added.map((r) => r.ID),
        dashboardDecisions: dashboard.plan.closes
          .filter((c) => c.followUp)
          .map((c) => ({ actsOn: c.id, intentId: c.intentId })),
      });
    }
    // ADM-20: fix rows are claimed under their own session, so attribution stays exact.
    if (dashboard.mintedFixes.added.length) {
      ledger.push({
        session: FIX_OPENER,
        opened: STAMP,
        ids: dashboard.mintedFixes.added.map((r) => r.ID),
        fixQueue: dashboard.fixes.opens.map((o) => ({ subjectId: o.subjectId, intentId: o.intentId, sentBy: o.goIntentId })),
      });
    }
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
    console.log(
      `\n  written  ${OPENED_JSON} (${dashboard.minted.added.length} id(s) claimed by ${DASHBOARD_OPENER}, ${dashboard.mintedFixes.added.length} by ${FIX_OPENER})`,
    );
  }

  writeFileSync(join(ROOT, WORKING_CSV), writeStore(nextWorking), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(nextResolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}`);
  console.log(`  written  ${RESOLVED_CSV}`);
  return { working: nextWorking, resolved: nextResolved };
}


/* ------------------------------------------------------------------- add --- */

/**
 * Open new rows in the working store.
 *
 * Takes a JSON file holding one object or an array of them. Every field of
 * `COLUMNS` is accepted; `Section`, `Title`, `What this is` and `Opened by`
 * are required, `ID` is MINTED here from the requested prefix, and everything
 * else defaults to empty.
 *
 * The guards, and each one is a rule this repo has been bitten by:
 *
 * - **The id is minted, never supplied.** `nextId` reads the ids that EXIST
 *   across both stores rather than a regex over a file, because a raw sweep
 *   silently skipped quoted ids once and created the duplicate-id pair
 *   `CLAUDE.md` says breaks every lookup.
 * - **A section must be a real one.** RULING 32: every row has a home and
 *   there is no holding section.
 * - **A row must carry a plain-English description.** Item 8a's guard asserts
 *   it on every row in both stores, so a row opened without one fails the
 *   build rather than the review.
 * - **A new row opens OPEN.** A session may not open a row already resolved,
 *   which would be closing its own work without evidence, and it may never
 *   set `Delete` (RULING 46).
 * - **The P1 cap is reported, never enforced by demotion.** RULING 30: a
 *   section over five P1s is REPORTED as stopped. This prints the census
 *   after the append and says so; it does not quietly re-rank anything.
 */
/** The append-only ledger of every id any session has ever claimed. */
function readLedger() {
  const p = join(ROOT, OPENED_JSON);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
}

/**
 * Every id the ledger records as claimed, whether or not the row survived.
 *
 * A withdrawn row's id is still spent — see the note at the mint site. This is
 * deliberately flat and forgiving of shape: a ledger entry that somehow carries
 * no `ids` contributes nothing rather than throwing, because an id minter that
 * crashes on a malformed history cannot be used to repair one.
 */
function claimedInLedger() {
  return readLedger().flatMap((entry) =>
    Array.isArray(entry?.ids) ? entry.ids.filter((id) => typeof id === "string") : [],
  );
}

/**
 * **THE ONE PLACE A NEW ROW IS VALIDATED AND MINTED.**
 *
 * `add` has always applied these guards. The dashboard-decision applier in
 * `move` (RULING 271) opens follow-up rows too, and a second copy of the
 * guards would be a second place for them to drift — so both call this.
 * `label` is the session the rows are attributed to when a row names none.
 *
 * Returns `{ added, refusals, duplicates }`; the caller writes NOTHING when
 * `refusals` is non-empty.
 */
function mintRows(requested, { working, resolved, sections, label }) {
  const slugs = new Set(sections.map((x) => x.slug));
  const refusals = [];
  const added = [];

  for (const row of requested) {
    const where = row.Title || row["What this is"] || "(untitled)";
    if (!slugs.has((row.Section ?? "").trim())) {
      refusals.push(
        `"${where}": Section "${row.Section}" is not one of ${[...slugs].join(", ")}. ` +
          "RULING 32 — every row has a home and there is no holding section.",
      );
      continue;
    }
    if (!(row["What this is"] ?? "").trim()) {
      refusals.push(`"${where}": no plain-English description. Item 8a guards this on every row.`);
      continue;
    }
    if (!(row.Title ?? "").trim()) {
      refusals.push(`"${where}": no title.`);
      continue;
    }
    if (!(row["Opened by"] ?? "").trim() && !label) {
      refusals.push(
        `"${where}": no opening session named — pass --session=<label>. ` +
          "RULING 40: attribution has no soft landing.",
      );
      continue;
    }
    if ((row.Resolution ?? "").trim()) {
      refusals.push(
        `"${where}": a new row opens OPEN. A session closing its own row at the ` +
          "moment it opens it has recorded a decision nobody made.",
      );
      continue;
    }
    if (row.Priority && !PRIORITIES.includes(row.Priority)) {
      refusals.push(`"${where}": priority "${row.Priority}" is none of ${PRIORITIES.join(", ")}.`);
      continue;
    }
    const prefix = (row.prefix ?? "NH").toUpperCase().replace(/[^A-Z]/g, "");
    /*
     * **AN ID IS MINTED AGAINST THE LEDGER TOO, NOT ONLY THE STORES.**
     * (NH Hunt 3, 2026-08-21.)
     *
     * `nextId` reads the ids that EXIST in the two stores, which is right as
     * far as it goes and is not far enough. NH Hunt 2 double-wrote NH18–NH25,
     * removed them from the working store minutes later, and recorded the
     * claim in the ledger with a note saying what had happened. The ids were
     * then absent from both stores — so the very next `add`, this session's,
     * minted NH18 a second time and the ledger held it twice.
     *
     * `tests/tracker-stores.test.ts` caught it, which is the ledger working;
     * an id assigned twice is a ledger that has stopped being able to count.
     * But a guard that only catches it after the write means every session
     * following an aborted one has to notice and re-run by hand.
     *
     * So the ledger's claimed ids join the pool `nextId` mints against. A
     * claim is permanent even when the row it named was withdrawn — that is
     * what append-only means, and it is the whole reason the ledger exists.
     */
    const id = nextId(prefix, [
      ...working,
      ...resolved,
      ...added,
      ...claimedInLedger().map((claimedId) => ({ ID: claimedId })),
    ]);
    const built = Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? ""]));
    built.ID = id;
    built["Opened by"] = (row["Opened by"] ?? "").trim() || label;
    added.push(built);
  }

  /*
   * **A BYTE-IDENTICAL ADD IS REFUSED.** (2026-08-24, the NJ depth session.)
   *
   * The identical duplicate-row accident has now happened twice — 2026-08-21
   * and 2026-08-24 — for the same reason both times, and the reason is not
   * carelessness. `add` printed its confirmation FIRST and then handed off to
   * the views summary, which is long; the operator saw the summary scroll past,
   * could not see whether the add had landed, and ran it again. **Fix the tool,
   * not the operator.**
   *
   * Two changes, and this is the first. A row whose Section, Title and
   * description already exist in the working store is the same row: an id has
   * been minted for it and printing a second one is how a tracker acquires two
   * rows for one thing, which silently breaks every lookup by id.
   *
   * The match is on CONTENT rather than on id, because the whole failure is
   * that the second run has not been given the first run's id.
   */
  const fingerprint = (r) =>
    [r.Section ?? "", r.Title ?? "", r["What this is"] ?? ""]
      .map((s) => String(s).trim().replace(/\s+/g, " ").toLowerCase())
      .join("\u0000");
  const alreadyOpen = new Map(working.map((r) => [fingerprint(r), r.ID]));
  const duplicates = added.filter((r) => alreadyOpen.has(fingerprint(r)));
  for (const d of duplicates) {
    refusals.push(
      `"${d.Title}": this row is ALREADY OPEN as ${alreadyOpen.get(fingerprint(d))} — same section, ` +
        "same title, same description. Nothing was written. If the earlier add is the one you " +
        "could not see land, that id is the answer; if this is genuinely a different row, change " +
        "the title or the description so the two can be told apart.",
    );
  }
  return { added, refusals, duplicates };
}

function modeAdd(working, resolved, sections) {
  const path = process.argv[3];
  if (!path || !existsSync(path)) {
    console.error("usage: node scripts/tracker.mjs add <rows.json>");
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(path, "utf8"));
  const requested = Array.isArray(input) ? input : [input];
  const { added, refusals, duplicates } = mintRows(requested, {
    working,
    resolved,
    sections,
    label: SESSION_LABEL,
  });

  console.log(`\ntracker add — ${STAMP}\n`);
  console.log(`  requested              ${requested.length}`);
  console.log(`  refused                ${refusals.length}`);
  console.log(`  already open           ${duplicates.length}`);

  if (refusals.length) {
    console.log("\n  REFUSED — nothing written:\n");
    for (const r of refusals) console.log(`    ${r}`);
    console.log("");
    process.exit(1);
  }

  const nextWorking = [...working, ...added];
  writeFileSync(join(ROOT, WORKING_CSV), writeStore(nextWorking), "utf8");

  /*
   * THE LEDGER, appended in the same run that assigns the ids (item 1.4).
   *
   * A session reports "rows opened: N" and until now nothing could check
   * that sentence against the stores. Now it can: every id this run
   * assigns is written down here, and `tests/tracker-stores.test.ts` fails
   * the build if any id in this file is absent from BOTH stores. Append-
   * only, for the same reason the resolved store is — the point is the
   * record of what was claimed, and a claim you can edit afterwards is not
   * a claim.
   */
  const ledgerPath = join(ROOT, OPENED_JSON);
  const ledger = readLedger();
  ledger.push({
    session: added[0]?.["Opened by"] ?? SESSION_LABEL,
    opened: STAMP,
    ids: added.map((r) => r.ID),
  });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  const claimed = ledger.reduce((n, e) => n + e.ids.length, 0);
  /*
   * **RULING 113 — OBSERVE THE STEP'S PRODUCT AT THE STEP.**
   *
   * The write above reports success by not throwing. That is a step reporting
   * success with its product unchecked, and the ruling is explicit: where a
   * step's product can be observed, observe it AT the step rather than at the
   * first consumer. Here the product is a file on disk, and reading it back
   * costs one syscall.
   */
  const onDisk = readStore(WORKING_CSV);
  const landed = added.filter((r) => onDisk.some((d) => (d.ID ?? "").trim() === r.ID));
  if (landed.length !== added.length) {
    const missing = added.filter((r) => !landed.includes(r)).map((r) => r.ID);
    console.error(
      `\n  THE WRITE DID NOT LAND. ${landed.length} of ${added.length} id(s) are in ${WORKING_CSV} ` +
        `after writing it; missing: ${missing.join(", ")}. This is reported as a failure rather ` +
        "than as a successful add, because a step whose product cannot be observed has not " +
        "been observed.",
    );
    process.exit(1);
  }

  /*
   * **THE CONFIRMATION IS RETURNED, NOT PRINTED.** (2026-08-24.)
   *
   * The second half of the duplicate-row fix. `add` is followed by the views
   * summary, which is long; a confirmation printed here scrolls out of sight
   * before the operator can read it, and twice now the response to not seeing
   * it was to run `add` again. So the dispatcher prints this AFTER the views
   * summary, where it is the last thing on the screen.
   */
  return {
    working: nextWorking,
    resolved,
    confirmation: [
      "",
      `  ids assigned           ${added.map((r) => r.ID).join(", ")}`,
      `  working store          ${working.length} -> ${nextWorking.length}, re-read from disk and all ${landed.length} present`,
      `  written                ${WORKING_CSV} and ${OPENED_JSON} (${ledger.length} entries, ${claimed} ids claimed)`,
      "",
    ].join("\n"),
  };
}



/* ------------------------------------------------------- the transaction --- */

/**
 * THE END OF THE TRANSACTION: read it all back, and refuse if it disagrees.
 * (2026-08-26, Addendum 2 item 3.)
 *
 * `add` already writes the store, the ledger and all four generated views in
 * ONE process. What was missing is anything that reads the result back — so a
 * write that half-landed reported success, and the disagreement surfaced days
 * later as four red guards on `main`.
 *
 * This is RULING 113 pointed at the tracker's own writer: where a step's
 * product can be observed, observe it AT the step. It reads from DISK, never
 * from the in-memory values the write just used, because comparing a writer to
 * itself proves only that the code is deterministic (RULING 147).
 *
 * It EXITS NON-ZERO on any disagreement. A half transaction that exits 0 is the
 * thing this exists to stop.
 */
function reconcileAfterWrite(addedIds) {
  const working = readStore(WORKING_CSV);
  const ledger = readLedger();
  const sections = readSections();
  const census = p1Census(working, sections);
  const needsSean = census.find((c) => c.slug === "needs-sean");

  const md = existsSync(join(ROOT, "docs/tracker.md"))
    ? readFileSync(join(ROOT, "docs/tracker.md"), "utf8")
    : "";
  const stated = /\*\*(\d+) open\*\*/.exec(md);

  const failures = reconcileTracker(
    {
      workingIds: working.map((r) => (r.ID ?? "").trim()).filter(Boolean),
      claimedIds: ledger.flatMap((e) => e.ids ?? []),
      statedOpenCount: stated ? Number(stated[1]) : null,
      needsSeanP1: needsSean ? needsSean.P1 : 0,
      trackerMdSaysStopped: md.includes("STOPPED"),
      logRegenerated: existsSync(join(ROOT, "docs/log.md")),
    },
    addedIds,
  );

  console.log(reconciliationReport(failures));
  if (failures.length > 0) process.exit(1);
}

/**
 * CLAIM ORPHAN ROWS, CANONICALLY. (2026-08-26, Addendum 2 item 1.)
 *
 * A row that reached a store with no ledger entry claiming it is a half
 * transaction that already landed — `JOB04` and `JOB05` are the instance, and
 * they landed because `job-watch` was permitted to commit the store and not the
 * ledger beside it.
 *
 * **The repair has to be an OPERATION and not a hand edit**, and this session
 * learned that the hard way: the first repair appended the entry to
 * `docs/tracker-opened.json` with a one-off script, which is exactly the class
 * of act the ledger exists to make impossible. This is the instrument that
 * should have done it.
 *
 * It attributes each orphan to the session the ROW ITSELF names in `Opened by`,
 * so the historical fact stays true — `job-watch` opened those rows because
 * those runs failed — rather than being reattributed to whoever ran the repair.
 * A row whose `Opened by` is empty is REFUSED rather than guessed at.
 */
function modeClaim(working, resolved) {
  const ledger = readLedger();
  const claimed = new Set(ledger.flatMap((e) => e.ids ?? []));
  const orphans = [...working, ...resolved]
    .map((r) => ({ id: (r.ID ?? "").trim(), by: (r["Opened by"] ?? "").trim() }))
    .filter((r) => r.id && !claimed.has(r.id));

  console.log(`\ntracker claim — ${STAMP}\n`);
  if (orphans.length === 0) {
    console.log("  nothing to claim        every row in both stores is claimed by a ledger entry");
    return { working, resolved };
  }

  const refused = orphans.filter((o) => !o.by);
  if (refused.length > 0) {
    console.error(
      `  REFUSED                ${refused.map((o) => o.id).join(", ")} carry no \`Opened by\`, so this ` +
        "cannot say who opened them. Attributing them to the session running the repair would " +
        "replace the historical fact with a convenience.",
    );
    process.exit(1);
  }

  const bySession = new Map();
  for (const o of orphans) {
    if (!bySession.has(o.by)) bySession.set(o.by, []);
    bySession.get(o.by).push(o.id);
  }
  for (const [session, ids] of bySession) {
    ledger.push({ session, opened: STAMP, ids });
    console.log(`  claimed                ${ids.join(", ")} -> ${session}`);
  }
  writeFileSync(join(ROOT, OPENED_JSON), JSON.stringify(ledger, null, 2) + "\n", "utf8");
  console.log(`  written                ${OPENED_JSON} (${ledger.length} entries)`);
  return { working, resolved };
}

/* ------------------------------------------------------------------ note --- */

/**
 * Append to ONE row's `Session record` — the session's own column.
 *
 * A status change EDITS the existing row and never appends a second with the
 * same id; `M02` and `M04` each carried a duplicate pair for a day before
 * anybody noticed, and a tracker with two rows per id cannot be read by
 * anything.
 *
 * **It writes `Session record` and nothing else.** `Resolution`, `Condition`
 * and `Notes` are the author's three columns and a session never writes them —
 * which is precisely why this exists. The obvious way to record work on a row
 * a session may not close is to type into his Notes, and the old
 * `scripts/tracker-append-note.mjs` did exactly that, on the frozen
 * `docs/tracker.csv`. Both stores are searched, so a row the author has
 * already resolved can still be told what a later session did about it.
 *
 * It never changes a row's resolution. Moving a row is `move`'s job.
 */
function modeNote(working, resolved) {
  const id = (process.argv[3] ?? "").trim();
  const path = process.argv[4];
  if (!id || !path || !existsSync(path)) {
    console.error("usage: node scripts/tracker.mjs note <ID> <note-file>");
    process.exit(2);
  }
  const text = readFileSync(path, "utf8").trim().replace(/\s+/g, " ");
  if (!text) {
    console.error("the note file is empty — a note that says nothing is not a note");
    process.exit(2);
  }

  const hits = [...working, ...resolved].filter((r) => (r.ID ?? "").trim() === id);
  if (hits.length === 0) {
    console.error(`${id} is in neither store.`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`${id} appears ${hits.length} times — a duplicate id breaks every lookup.`);
    process.exit(1);
  }
  const row = hits[0];
  const before = (row["Session record"] ?? "").trim();
  const stamped = `${STAMP} (${SESSION_LABEL || "session"}). ${text}`;
  row["Session record"] = before ? `${before} ${stamped}` : stamped;

  console.log(`\ntracker note — ${STAMP}\n`);
  console.log(`  row                    ${id} · ${row.Section} · ${row.Title}`);
  console.log(`  resolution             ${(row.Resolution ?? "").trim() || "(open)"} — UNCHANGED`);
  console.log(`  Session record         ${before.length} -> ${row["Session record"].length} chars`);
  writeFileSync(join(ROOT, WORKING_CSV), writeStore(working), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(resolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}\n  written  ${RESOLVED_CSV}`);
  return { working, resolved };
}

/**
 * `tracker amend <ID> <text-file>` — **a session corrects the DESCRIPTION of a
 * row it opened itself, and of no other row.** (NJ Hunt 3, 2026-08-22.)
 *
 * ## Why this exists at all
 *
 * A session wrote a row whose "What this is" contained `VERIFIED_ABSENT`. That
 * is internal hunt-queue vocabulary, `docs/tracker.md` is a generated view a
 * reader can open, and `tests/tracker-stores.test.ts` fails the build when it
 * appears there — correctly, under RULING 28.
 *
 * There was then no way to fix it. `add` would create a SECOND row for the same
 * thing, which the tracker rules forbid outright: a tracker with two rows per
 * subject cannot be read by anything. `note` appends to the session record and
 * leaves the offending text exactly where it is. And nothing but this script may
 * write the stores, so hand-editing the CSV is not an option either. The row was
 * unfixable by any legal move, minutes after being written.
 *
 * ## The two limits, and they are the whole safety of it
 *
 * **A session amends only a row it opened itself.** Another author's row is a
 * record of what they saw; a correction to it is a new row, so this refuses on
 * any row whose `Opened by` is not this session's own label.
 *
 * **The TITLE and the SECTION are untouched.** Only "What this is" moves. A
 * title is how a row is recognised in a list Sean reads; a section is RULING
 * 32's home. Changing either is re-filing, not correcting, and it is out of
 * scope for a session amending its own prose.
 *
 * Every amendment leaves a trace in the session record, so the change is visible
 * as a change rather than as a row that was always worded this way.
 */
function modeAmend(working, resolved) {
  const id = (process.argv[3] ?? "").trim();
  const path = process.argv[4];
  if (!id || !path || !existsSync(path)) {
    console.error("usage: node scripts/tracker.mjs amend <ID> <text-file>");
    process.exit(2);
  }
  const text = readFileSync(path, "utf8").trim().replace(/\s+/g, " ");
  if (!text) {
    console.error("the text file is empty — an amendment that says nothing is not an amendment");
    process.exit(2);
  }
  if (!SESSION_LABEL) {
    console.error("amend needs --session=<label>: it may only touch rows this session opened");
    process.exit(2);
  }

  const hits = [...working, ...resolved].filter((r) => (r.ID ?? "").trim() === id);
  if (hits.length === 0) {
    console.error(`${id} is in neither store.`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`${id} appears ${hits.length} times — a duplicate id breaks every lookup.`);
    process.exit(1);
  }
  const row = hits[0];
  const openedBy = (row["Opened by"] ?? "").trim();
  if (!openedBy.includes(SESSION_LABEL)) {
    console.error(
      `${id} was opened by "${openedBy}", not by "${SESSION_LABEL}".\n` +
        "amend only corrects a row this session opened. Open a new row instead.",
    );
    process.exit(1);
  }

  const before = (row["What this is"] ?? "").trim();
  row["What this is"] = text;
  const trace = `${STAMP} (${SESSION_LABEL}). Description amended by the session that opened this row; ` +
    `title and section unchanged. Previous length ${before.length} chars.`;
  const record = (row["Session record"] ?? "").trim();
  row["Session record"] = record ? `${record} ${trace}` : trace;

  console.log(`\ntracker amend — ${STAMP}\n`);
  console.log(`  row                    ${id} · ${row.Section} · ${row.Title}`);
  console.log(`  opened by              ${openedBy} — this session, so the amendment is allowed`);
  console.log(`  title and section      UNCHANGED`);
  console.log(`  What this is           ${before.length} -> ${text.length} chars`);
  writeFileSync(join(ROOT, WORKING_CSV), writeStore(working), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(resolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}\n  written  ${RESOLVED_CSV}`);
  return { working, resolved };
}

/* ----------------------------------------------------------------- views --- */

function modeViews(working, resolved, sections) {
  const purposes = existsSync(join(ROOT, "docs/log-purposes.json"))
    ? JSON.parse(readFileSync(join(ROOT, "docs/log-purposes.json"), "utf8"))
    : {};

  /*
   * ======================================================================
   * RULING 227 — THE RECHECK, RUN HERE BECAUSE HERE IS WHERE IT CANNOT BE
   * SKIPPED.
   * ======================================================================
   *
   * Three P1 Needs Sean rows were stating blockers that had already cleared,
   * and one of them had been false for days while being named in a close-out
   * as "what requires you". Nobody lied: a row records the wall at the moment a
   * session hits it, and then nothing ever asks whether the wall is still
   * standing.
   *
   * A recheck written into a session's instructions is a recheck that runs when
   * somebody remembers. This one is bolted to the GENERATOR, so it runs every
   * time anything regenerates the tracker at all — including on CI, including
   * from a `tracker add` that has nothing to do with Needs Sean.
   *
   * The stores are written back only if this actually changed something, and
   * the diff is reported rather than performed silently.
   */
  const beforeWorking = writeStore(working);
  const beforeResolved = writeStore(resolved);

  const { counts: openedCounts } = applyOpenedDates({ rows: [...working, ...resolved], root: ROOT });
  const { outcomes, autoResolved } = reconcile({
    working,
    registry: REGISTRY,
    stamp: STAMP,
    sessionLabel: SESSION_LABEL || "tracker:views",
    root: ROOT,
  });
  const coverage = auditCoverage({
    needsSeanIds: working
      .filter((r) => (r.Section ?? "").trim() === "needs-sean" && isOpen(r))
      .map((r) => (r.ID ?? "").trim()),
    registry: REGISTRY,
  });

  writeFileSync(
    join(ROOT, "docs/tracker-owner-view.md"),
    ownerView({ working, registry: REGISTRY, outcomes, autoResolved, stamp: STAMP, openedCounts }),
    "utf8",
  );
  writeFileSync(
    join(ROOT, "docs/tracker-reconciliation.json"),
    JSON.stringify(
      {
        generated: STAMP,
        ruling: "RULING 227",
        openedDateProvenance: openedCounts,
        coverage,
        summary: summarize({ outcomes }),
        outcomes: outcomes.map((o) => ({
          rowId: o.rowId,
          kind: o.kind,
          verdict: o.outcome.verdict,
          why: o.outcome.why,
          read: o.outcome.read,
          evidence: o.outcome.evidence,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const afterWorking = writeStore(working);
  const afterResolved = writeStore(resolved);
  if (afterWorking !== beforeWorking) writeFileSync(join(ROOT, WORKING_CSV), afterWorking, "utf8");
  if (afterResolved !== beforeResolved) {
    writeFileSync(join(ROOT, RESOLVED_CSV), afterResolved, "utf8");
  }

  const recheck = summarize({ outcomes });

  /*
   * THE MARKDOWN VIEWS ARE WRITTEN FIRST, AND A LOCKED WORKBOOK NO LONGER
   * STOPS THEM. (NH Hunt 5, 2026-08-21.)
   *
   * The workbook write used to come first and throw EBUSY whenever Sean had
   * `docs/tracker.xlsx` open in Excel — which is often, because that is the
   * file he edits by hand. The throw killed the process before
   * `docs/tracker.md` and `docs/log.md` were written, so a `tracker:add` that
   * had ALREADY updated the CSV stores left the two generated markdown views
   * describing the store as it was before.
   *
   * That is not untidiness. `tests/tracker-stores.test.ts` asserts the count
   * stated in `tracker.md` equals the rows in the store, so a locked workbook
   * turned the suite RED — and the only scheduled job that runs `pnpm test` on
   * Linux is the refresh gate, which means a governed artifact would stop
   * committing because a spreadsheet was open on somebody's desktop. Found
   * exactly that way, on refresh run 32543393133.
   *
   * The markdown views depend on nothing but the stores, so they are written
   * unconditionally. The workbook is attempted afterwards and its failure is
   * REPORTED rather than thrown: the CSVs are the authoritative stores and the
   * workbook is a generated view of them, so a stale workbook is a thing to be
   * told about, not a reason to abandon a write that already happened.
   *
   * It still exits non-zero, because a stale workbook is a real problem — the
   * next hand edit is made against out-of-date rows and saving it would revert
   * them. What changes is that the failure is now a stated one with everything
   * else correct behind it.
   */
  writeFileSync(join(ROOT, "docs/tracker.md"), trackerMarkdown(working, resolved, sections), "utf8");
  writeFileSync(join(ROOT, "docs/log.md"), logMarkdown(working, resolved, purposes), "utf8");

  let book = null;
  let workbookError = null;
  try {
    book = writeWorkbook(working, resolved);
    writeFileSync(join(ROOT, WORKBOOK), book);
  } catch (error) {
    workbookError = error;
  }

  const census = p1Census(working, sections);
  console.log(`\ntracker views — ${STAMP}\n`);
  console.log(
    workbookError
      ? `  ${WORKBOOK}            NOT WRITTEN — ${workbookError.code ?? "error"}`
      : `  ${WORKBOOK}            ${book.length} bytes, 3 tabs`,
  );
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
  console.log("  RULING 227 recheck — every predicate re-evaluated this run:");
  console.log(`    predicated rows       ${recheck.predicates}`);
  console.log(`      still blocked       ${recheck.holds}`);
  console.log(`      AUTO-RESOLVED       ${recheck.resolved}`);
  console.log(`      could not tell      ${recheck.cannotTell}`);
  console.log(`    NOT_MACHINE_VERIFIABLE ${recheck.notMachineVerifiable} (each carries a decision card)`);
  console.log(
    `  opened-date provenance  ledger ${openedCounts["opened-ledger"] ?? 0} · ` +
      `session label ${openedCounts["session-label"] ?? 0} · UNKNOWN ${openedCounts.unrecoverable ?? 0}`,
  );
  console.log(`  docs/tracker-owner-view.md    written`);
  console.log(`  docs/tracker-reconciliation.json written`);
  for (const a of autoResolved) {
    console.log(`    AUTO-RESOLVED ${a.rowId} — ${a.outcome.why}`);
  }
  console.log("");

  /*
   * RULING 227's invariant, enforced where it is measured. A Needs Sean row in
   * neither arm of the registry escalated to the author with no route back
   * down, which is the whole thing the rule prohibits. It is a REFUSAL rather
   * than a warning, because a warning in a generator's output is a warning
   * nobody reads.
   */
  if (coverage.uncovered.length) {
    console.error(
      `\n  RULING 227 — ${coverage.uncovered.length} Needs Sean row(s) carry neither a ` +
        "machine-verifiable predicate nor a NOT_MACHINE_VERIFIABLE marking with a " +
        "decision card:\n" +
        coverage.uncovered.map((id) => `    ${id}`).join("\n") +
        "\n\n  Escalation without reconciliation is prohibited. Add each row to " +
        "lib/tracker/registry.mjs — a predicate if a machine can check it, a card if not.",
    );
    process.exitCode = 4;
  }

  if (workbookError) {
    console.error(
      `  THE WORKBOOK IS STALE. ${WORKBOOK} could not be written ` +
        `(${workbookError.code ?? "error"}), almost always because it is open in Excel.\n` +
        "\n" +
        "  Everything else IS current: the CSV stores are authoritative and\n" +
        "  docs/tracker.md and docs/log.md were regenerated from them above.\n" +
        "\n" +
        "  CLOSE THE WORKBOOK AND RUN `pnpm tracker:views` BEFORE EDITING IT.\n" +
        "  The open copy is showing rows as they were before this run, and\n" +
        "  saving it would write those older rows back over the stores.",
    );
    process.exitCode = 3;
  }
}

/**
 * `tracker resolve <ID> --session=<label> [--conditional] --evidence <file>`
 * — **a session marks its OWN finished work resolved.** (`NH64`, owed since
 * 2026-08-22; built 2026-08-23.)
 *
 * ## The hole this closes
 *
 * The only way to set Resolution was to write it into the workbook, and the
 * move script then records `resolutionAuthor` as `sean` — a session's close
 * credited to him. Without another path, every session's finished rows
 * accumulated in the working store with their evidence in the Session record
 * and nothing marking them done, which is the queue-that-empties failing to
 * empty.
 *
 * So this writes the resolution with the author stamped as the SESSION rather
 * than as him.
 *
 * ## The three authors, and why a third one was needed
 *
 * `planMoves` already knew about two — `"sean"` for a resolution read out of
 * his workbook, and `"ruling"` for RULING 79's close-by-ruling. What it had no
 * write path for was `"session"`, its default actor. This is that write side.
 *
 * ## Evidence is required, not encouraged
 *
 * `CLAUDE.md`: *nothing is resolved without evidence — the branch name, and
 * which of `test` / `lint` / `build` passed.* A commit SHA cannot be used; it
 * does not exist inside the commit that would name it. So the evidence file is
 * mandatory, it is appended to the Session record where a reader will find it
 * beside the work, and a run with nothing in it is refused rather than
 * recorded.
 */
function modeResolve(working, resolved) {
  const id = (process.argv[3] ?? "").trim();
  const conditional = process.argv.includes("--conditional");
  const evidenceAt = process.argv.indexOf("--evidence");
  const evidencePath = evidenceAt === -1 ? null : process.argv[evidenceAt + 1];

  if (!id || !evidencePath || !existsSync(evidencePath)) {
    console.error(
      "usage: node scripts/tracker.mjs resolve <ID> --session=<label> " +
        "--evidence <file> [--conditional]\n" +
        "\n" +
        "  The evidence file is REQUIRED. CLAUDE.md: nothing is resolved without\n" +
        "  evidence — the branch name, and which of test / lint / build passed.",
    );
    process.exit(2);
  }
  if (!SESSION_LABEL) {
    console.error(
      "resolve refuses without --session=<label>. The label is what stamps the\n" +
        "row's closer as a SESSION rather than as the author, and an unlabelled\n" +
        "close is indistinguishable from his.",
    );
    process.exit(2);
  }

  const evidence = readFileSync(evidencePath, "utf8").trim().replace(/\s+/g, " ");
  if (evidence.length < 20) {
    console.error(
      `the evidence file holds ${evidence.length} character(s). A resolution with no\n` +
        "evidence behind it is an agent grading its own homework, which is the one\n" +
        "thing this tracker exists to refuse.",
    );
    process.exit(2);
  }

  const hits = working.filter((r) => (r.ID ?? "").trim() === id);
  if (hits.length === 0) {
    const already = resolved.some((r) => (r.ID ?? "").trim() === id);
    console.error(
      already
        ? `${id} is already in the resolved store.`
        : `${id} is not in the working store.`,
    );
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`${id} appears ${hits.length} times — a duplicate id breaks every lookup.`);
    process.exit(1);
  }

  const row = hits[0];
  const section = (row.Section ?? "").trim();

  const already = (row.Resolution ?? "").trim();
  if (already) {
    console.error(`${id} already carries the resolution "${already}" — nothing to write.`);
    process.exit(1);
  }

  row.Resolution = conditional ? "Conditionally resolved" : "Resolved";
  row["Resolved on"] = STAMP;
  row["Closed by"] = SESSION_LABEL;
  const before = (row["Session record"] ?? "").trim();
  const stamped = `${STAMP} (${SESSION_LABEL}). RESOLVED by the session. ${evidence}`;
  row["Session record"] = before ? `${before} ${stamped}` : stamped;

  console.log(`\ntracker resolve — ${STAMP}\n`);
  console.log(`  row                    ${id} · ${section} · ${row.Title}`);
  console.log(`  resolution             ${row.Resolution}`);
  console.log(`  closed by              ${SESSION_LABEL} (a SESSION, never the author)`);
  console.log(`  evidence               ${evidence.length} chars appended to the Session record`);

  writeFileSync(join(ROOT, WORKING_CSV), writeStore(working), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(resolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}\n  written  ${RESOLVED_CSV}`);
  console.log(
    "\n  The row is marked and is still in the working store. Run\n" +
      "  `corepack pnpm tracker:move --session=<label>` to move it across.",
  );
  return { working, resolved };
}

/**
 * **UNDO A SESSION'S OWN RESOLUTION, BEFORE IT MOVES.** (Added 2026-08-24,
 * audit-remediation.)
 *
 * `resolve` had no inverse, and the store has exactly one writer — this file —
 * so a session that marked the wrong row had a choice between leaving a false
 * resolution standing and hand-editing a CSV that `CLAUDE.md` says nothing else
 * may write. Both are worse than a mode.
 *
 * It happened here: P-005's row was marked Resolved by a batch script whose
 * "note this one instead" branch silently failed to apply, and the brief for
 * that row says in as many words to leave it OPEN. A row closed on work whose
 * measurement is owed is exactly what the performance-measurement ruling
 * forbids, so it had to come back.
 *
 * THE GUARDS:
 *
 * - **Only a row this session itself closed.** Re-opening another session's
 *   resolution is not an undo, it is a disagreement, and it goes to him.
 * - **Only while the row is still in the WORKING store.** Once `move` has run,
 *   the resolved store is the permanent record and nothing is deleted from it.
 *
 * The Session record KEEPS the resolution text and gains the reopening beside
 * it. An undo that erased what was claimed would leave a row whose history
 * says it was never closed, which is a different lie from the one being
 * corrected.
 */
function modeReopen(working, resolved) {
  const id = process.argv[3];
  const reasonAt = process.argv.indexOf("--reason");
  const reasonPath = reasonAt === -1 ? null : process.argv[reasonAt + 1];

  if (!id || !reasonPath || !existsSync(reasonPath)) {
    console.error(
      "usage: node scripts/tracker.mjs reopen <ID> --session=<label> --reason <file>\n" +
        "\n" +
        "  The reason file is REQUIRED. A resolution withdrawn with no reason is\n" +
        "  indistinguishable from one that was never written.",
    );
    process.exit(2);
  }
  if (!SESSION_LABEL) {
    console.error("reopen refuses without --session=<label>.");
    process.exit(2);
  }

  const reason = readFileSync(reasonPath, "utf8").trim().replace(/\s+/g, " ");
  if (reason.length < 20) {
    console.error(`the reason file holds ${reason.length} character(s).`);
    process.exit(2);
  }

  const hits = working.filter((r) => (r.ID ?? "").trim() === id);
  if (hits.length === 0) {
    const moved = resolved.some((r) => (r.ID ?? "").trim() === id);
    console.error(
      moved
        ? `${id} has already MOVED to the resolved store, which is permanent. Open a new row.`
        : `${id} is not in the working store.`,
    );
    process.exit(1);
  }

  const row = hits[0];
  const section = (row.Section ?? "").trim();

  const already = (row.Resolution ?? "").trim();
  if (!already) {
    console.error(`${id} carries no resolution — there is nothing to withdraw.`);
    process.exit(1);
  }
  const closer = (row["Closed by"] ?? "").trim();
  if (closer !== SESSION_LABEL) {
    console.error(
      `${id} was closed by "${closer}", not by this session. Withdrawing another\n` +
        "session's resolution is a disagreement, not an undo — open a row for it.",
    );
    process.exit(1);
  }

  const before = (row["Session record"] ?? "").trim();
  row["Session record"] =
    `${before} ${STAMP} (${SESSION_LABEL}). RESOLUTION WITHDRAWN by the session that wrote it, ` +
    `and the text above is kept so the history says what was claimed. ${reason}`.trim();
  row.Resolution = "";
  row["Resolved on"] = "";
  row["Closed by"] = "";

  console.log(`\ntracker reopen — ${STAMP}\n`);
  console.log(`  row                    ${id} · ${section} · ${row.Title}`);
  console.log(`  was                    ${already}, closed by ${closer}`);
  console.log(`  now                    OPEN`);
  console.log(`  reason                 ${reason.length} chars appended to the Session record`);

  writeFileSync(join(ROOT, WORKING_CSV), writeStore(working), "utf8");
  console.log(`\n  written  ${WORKING_CSV}`);
  return { working, resolved };
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
} else if (MODE === "note") {
  ({ working, resolved } = modeNote(working, resolved));
  modeViews(working, resolved, sections);
} else if (MODE === "amend") {
  ({ working, resolved } = modeAmend(working, resolved));
  modeViews(working, resolved, sections);
} else if (MODE === "resolve") {
  ({ working, resolved } = modeResolve(working, resolved));
  modeViews(working, resolved, sections);
} else if (MODE === "add") {
  let confirmation;
  const before = new Set(working.map((r) => (r.ID ?? "").trim()));
  ({ working, resolved, confirmation } = modeAdd(working, resolved, sections));
  modeViews(working, resolved, sections);
  /* LAST, on purpose — see modeAdd. The views summary is long and a
   * confirmation printed before it is a confirmation the operator cannot see. */
  console.log(confirmation);
  /* THE TRANSACTION ENDS HERE, and it ends by reading itself back off disk. */
  reconcileAfterWrite(working.map((r) => (r.ID ?? "").trim()).filter((id) => id && !before.has(id)));
} else if (MODE === "claim") {
  ({ working, resolved } = modeClaim(working, resolved));
  modeViews(working, resolved, sections);
  reconcileAfterWrite([]);
} else if (MODE === "reopen") {
  ({ working, resolved } = modeReopen(working, resolved));
  modeViews(working, resolved, sections);
} else {
  console.error(
    `unknown mode "${MODE}" — expected open, views, move, resolve, reopen, add, amend, claim or note`,
  );
  process.exit(2);
}
