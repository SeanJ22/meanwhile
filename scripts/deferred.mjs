/**
 * THE DEFERRED CENSUS — `pnpm deferred`
 *
 * ## Why this exists
 *
 * `docs/tracker.csv` is the source of truth for what is open and it is 329 rows
 * of ~520 KB, which is too large to read at orientation. So "what is still
 * outstanding?" has only ever been answerable by reconstructing it from session
 * reports and `docs/defects.md`. That reconstruction was attempted once by hand
 * and had to be labelled a floor rather than a register, because most of the
 * tracker was not visible to it.
 *
 * This produces the complete list instead. It composes nothing: every field is
 * read from the tracker as written, the discipline `context.md` already follows.
 *
 * ## Run once
 *
 * Deliberately NOT wired into `pnpm handoff` or any recurring path. Whether
 * this should regenerate is a decision the author makes after reading the first
 * one; building the wiring before that is building something nobody asked for.
 *
 * ## The two outputs serve two different acts
 *
 * `docs/deferred.md` is the census — read, at orientation, clipped to stay
 * small. `docs/deferred.csv` is the triage sheet — opened in a spreadsheet,
 * full notes, with an empty `Disposition` column the author fills in row by
 * row. The notes are unclipped there on purpose: a decision made off a clipped
 * note is a decision made blind.
 *
 * ## No empty success
 *
 * The header states three counts and the body must match them. If the header
 * claims 117 open rows and the body lists 115, this writes NOTHING and exits
 * non-zero. Same rule the meetings snapshot enforces at its write boundary, and
 * here for the same reason: a file whose header disagrees with its body is
 * worse than no file, because it will be believed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACKER = "docs/tracker.csv";
const MD_OUT = "docs/deferred.md";
const CSV_OUT = "docs/deferred.csv";

/** The census must stay readable at orientation. */
const MD_CAP_BYTES = 40 * 1024;
const NOTE_CLIP = 200;

/**
 * Statuses this script knows, seeded 2026-08-17 from what the tracker actually
 * contains. Anything outside this set is NAMED in its own section with its
 * literal string, never bucketed and never dropped from the counts.
 *
 * The reason is a near miss the hand-built inventory found: rows written with a
 * status one word off from every other row of their kind. A script that
 * normalises quietly is exactly how that disappears. Four of the tracker's nine
 * statuses today are one-row outliers (`Standing`, `Tabled`, `Undecided`,
 * `Waiting on testing end`), and they are outside this set on purpose so the
 * author sees them enumerated rather than folded in.
 */
const KNOWN_STATUSES = ["Done", "Not started", "In progress", "Parked", "Absorbed"];

/** Closed. Everything else is open, including every unknown status. */
const CLOSED_STATUSES = ["Done", "Absorbed"];

/* ------------------------------------------------------------------- csv --- */

/**
 * A full-field CSV reader — every column, not the six `readTracker` exposes.
 *
 * The triage sheet needs `Detail`, `Depends on` and `Target`, which that helper
 * drops. Quoted fields span newlines in this file (Notes routinely run to 3 KB),
 * so this is a real parser rather than a line split.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function readTrackerFull(text) {
  const rows = parseCsv(text);
  const header = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, i) => (rec[h] = (r[i] ?? "").trim()));
    return rec;
  });
  return { header, records };
}

function csvCell(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/* --------------------------------------------------------------- sorting --- */

/** `M07` before `M120`; prefix first, then the number as a number. */
function idKey(id) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(id);
  return m ? [m[1], Number(m[2])] : [id, -1];
}

function compareIds(a, b) {
  const [pa, na] = idKey(a);
  const [pb, nb] = idKey(b);
  return pa === pb ? na - nb : pa < pb ? -1 : 1;
}

/* --------------------------------------------------------------- history --- */

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * When each row last ENTERED its current status, from the git history of the
 * tracker — there is no changed-at column, so the history is the only place it
 * lives. Same mechanism `context.md`'s status-change section uses: first-parent
 * so a merge reports the branch's net change once.
 *
 * ONE pass over the commits, not one pass per row. The tracker is ~520 KB and
 * there are 55 first-parent commits touching it; re-reading that per row would
 * be eighteen full walks to answer one question.
 *
 * **The history is finite and says so.** It reaches back to the tracker's first
 * commit and no further. A row already holding its status at the oldest commit
 * has an UNRECOVERED entry date — reported as unrecovered, with the oldest
 * commit named, never filled in with the oldest date as though it were the
 * answer.
 */
function readStatusEntry() {
  const log = git([
    "log",
    "--first-parent",
    "--format=%H%x09%ad",
    "--date=short",
    "--",
    TRACKER,
  ]);
  if (!log) {
    return { entries: new Map(), commits: [], dates: [], walked: 0, failure: "git log returned nothing for " + TRACKER };
  }

  // Newest first, as git gives them.
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, date] = l.split("\t");
      return { sha, date };
    });

  /** status map per commit, parsed once. */
  const snapshots = [];
  for (const c of commits) {
    const text = git(["show", `${c.sha}:${TRACKER}`]);
    if (text === null) continue;
    const map = new Map();
    for (const r of readTrackerFull(text).records) {
      if (r.ID) map.set(r.ID, r.Status);
    }
    snapshots.push({ ...c, map });
  }

  const dates = [...new Set(snapshots.map((s) => s.date))].sort();

  /**
   * Walk newest → oldest. The entry commit is the OLDEST consecutive commit in
   * which the row already held its current status.
   */
  const entries = new Map();
  if (snapshots.length === 0) return { entries, commits, dates, walked: 0 };

  const current = snapshots[0].map;
  for (const [id, status] of current) {
    let entry = snapshots[0];
    let recovered = false;
    for (let i = 1; i < snapshots.length; i++) {
      const was = snapshots[i].map.get(id);
      if (was === status) {
        entry = snapshots[i];
        continue;
      }
      // Either the status differed, or the row did not exist yet. Both mean the
      // row entered its current status at `entry`, and both are recoveries.
      recovered = true;
      break;
    }
    entries.set(id, {
      sha: entry.sha,
      date: entry.date,
      recovered,
      oldestWalked: snapshots[snapshots.length - 1],
    });
  }

  return { entries, commits, dates, walked: snapshots.length };
}

/**
 * Sessions a row has been in its current status across.
 *
 * A "session" here is a distinct CALENDAR DATE on which `docs/tracker.csv` was
 * committed. That is deliberately conservative and the file says so: this repo
 * often runs several sessions in one day (state.md §30 is "the seventh of the
 * day"), so counting dates UNDERCOUNTS sessions. A row this measure flags as
 * spanning more than two sessions has certainly spanned more than two.
 */
function sessionsSince(entryDate, dates) {
  return dates.filter((d) => d >= entryDate).length;
}

/* ------------------------------------------------------------------ main --- */

const trackerText = readFileSync(join(ROOT, TRACKER), "utf8");
const { records } = readTrackerFull(trackerText);

const total = records.length;
const closed = records.filter((r) => CLOSED_STATUSES.includes(r.Status));
const open = records.filter((r) => !CLOSED_STATUSES.includes(r.Status));

const statusTally = new Map();
for (const r of records) statusTally.set(r.Status, (statusTally.get(r.Status) ?? 0) + 1);

const unknownRows = open.filter((r) => !KNOWN_STATUSES.includes(r.Status));

open.sort((a, b) =>
  a.Status === b.Status ? compareIds(a.ID, b.ID) : a.Status < b.Status ? -1 : 1,
);

const history = readStatusEntry();

const stalled = [];
for (const r of open.filter((r) => r.Status === "In progress")) {
  const e = history.entries.get(r.ID);
  if (!e) {
    stalled.push({ row: r, unresolved: "no history entry recovered for this ID" });
    continue;
  }
  const sessions = sessionsSince(e.date, history.dates);
  stalled.push({ row: r, entry: e, sessions });
}

/* ---------------------------------------------------------------- render --- */

const stamp = today();

/**
 * Clip a note — without severing a future date from the annotation that makes
 * it legal.
 *
 * **This was a real defect, caught by the suite on the first run.** A plain
 * 200-character cut landed in the middle of
 * `2026-11-03 [expected-future: NH general election …]` and produced
 * `2026-11-03 [expected-future: NH gener…`. Two rules broke at once: a future
 * date with no intact reason beside it, and an annotation whose reason was too
 * short to be one. The tracker row was correct; the CLIP made it wrong.
 *
 * The fix is not an allowlist entry for this file. A generated document that
 * reproduces annotated prose has to satisfy the same rule its source does, so
 * the cut point walks backwards until the surviving text is clean: no opened
 * annotation left unclosed, and no future date left without a complete one.
 * Cutting away a legal date is a smaller loss than shipping an illegal one, and
 * the `…` says something was cut either way.
 */
const ANNOTATION = /(?:<!--\s*expected-future:[^>]*?-->|\[\s*expected-future:[^\]]*?\])/gi;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

function lastUnclosedAnnotation(head) {
  const openers = [...head.matchAll(/(?:<!--|\[)\s*expected-future:/gi)];
  if (openers.length === 0) return -1;
  const last = openers[openers.length - 1];
  const closed = [...head.matchAll(ANNOTATION)].some((m) => m.index === last.index);
  return closed ? -1 : last.index;
}

function lastUnannotatedFutureDate(head, todayStr) {
  const covered = [...head.matchAll(ANNOTATION)].map((m) => [m.index, m.index + m[0].length]);
  let worst = -1;
  for (const m of head.matchAll(ISO_DATE)) {
    if (m[0] <= todayStr) continue;
    // The annotation must sit on the same line, which after flattening means
    // the same string — so any complete annotation in `head` covers it.
    if (covered.length > 0) continue;
    worst = m.index;
  }
  return worst;
}

function clipNote(s, max = NOTE_CLIP, todayStr = stamp) {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;

  let cut = max;
  for (let guard = 0; guard < 50; guard++) {
    const head = flat.slice(0, cut);
    const unclosed = lastUnclosedAnnotation(head);
    if (unclosed !== -1) {
      cut = unclosed;
      continue;
    }
    const bare = lastUnannotatedFutureDate(head, todayStr);
    if (bare !== -1) {
      cut = bare;
      continue;
    }
    break;
  }
  return `${flat.slice(0, cut).trimEnd()}…`;
}

const clip = (s) => clipNote(s);

const L = [];
L.push("# The deferred census — everything still open");
L.push("");
L.push(
  "**This is a GENERATED file.** `docs/tracker.csv` is the source of truth and nothing " +
    "is edited here — an edit to this file changes nothing and will be overwritten. " +
    "Every field below is reproduced from the tracker as written; nothing is composed, " +
    "summarised or reworded. Decisions go in `docs/deferred.csv`, which carries the same " +
    "rows with full unclipped notes and an empty `Disposition` column.",
);
L.push("");
L.push(`Generated **${stamp}** (\`pnpm stamp\`, America/Phoenix) by \`pnpm deferred\`.`);
L.push("");
L.push(`- Rows in \`${TRACKER}\`: **${total}**`);
L.push(`- Done or Absorbed: **${closed.length}**`);
L.push(`- **Still open: ${open.length}**`);
L.push("");
L.push(`Notes are clipped to ${NOTE_CLIP} characters; a clipped note ends in \`…\`.`);
L.push("");

/* every status the tracker contains */
L.push("## Every status value in the tracker");
L.push("");
L.push(
  "The full set, counted across all " +
    `${total} rows. The author has not seen this enumerated in one place before.`,
);
L.push("");
L.push("| status | rows | known to this script | open or closed |");
L.push("| --- | --- | --- | --- |");
for (const [status, n] of [...statusTally.entries()].sort((a, b) => b[1] - a[1])) {
  L.push(
    `| \`${status}\` | ${n} | ${KNOWN_STATUSES.includes(status) ? "yes" : "**no**"} | ` +
      `${CLOSED_STATUSES.includes(status) ? "closed" : "open"} |`,
  );
}
L.push("");

/* unknown statuses, named */
L.push("## Statuses this script does not know");
L.push("");
if (unknownRows.length === 0) {
  L.push("None. Every open row carries a status from the known set.");
} else {
  L.push(
    `${unknownRows.length} open row(s) carry a status outside the known set ` +
      `(\`${KNOWN_STATUSES.join("`, `")}\`). They are listed here with their literal status ` +
      "string, and they are ALSO counted in the totals above and listed in the census below — " +
      "named, never bucketed, never dropped.",
  );
  L.push("");
  L.push("| ID | literal status | item |");
  L.push("| --- | --- | --- |");
  for (const r of [...unknownRows].sort((a, b) => compareIds(a.ID, b.ID))) {
    L.push(`| \`${r.ID}\` | \`${r.Status}\` | ${clip(r.Item)} |`);
  }
}
L.push("");

/* stalled */
L.push("## In progress, and stalled");
L.push("");
L.push(
  "A row that has been `In progress` for a long time reads as progress on a status line and " +
    "functions as a deferral. These are the most misleading rows on the board for a " +
    "decks-clearing pass, because they are the ones that look alive.",
);
L.push("");
L.push(
  `Derived from the git history of \`${TRACKER}\` (first-parent), ` +
    `${history.walked} commit(s) walked across ${history.dates.length} distinct date(s), ` +
    `${history.dates[0] ?? "unknown"} to ${history.dates[history.dates.length - 1] ?? "unknown"}. ` +
    "A **session** here is a distinct calendar date on which the tracker was committed. That " +
    "UNDERCOUNTS sessions — this repo often runs several in a day — so a row flagged as " +
    "spanning more than two sessions has certainly spanned more than two.",
);
L.push("");

const flagged = stalled.filter((s) => s.unresolved || s.sessions > 2);
const notFlagged = stalled.filter((s) => !s.unresolved && s.sessions <= 2);

if (flagged.length === 0) {
  L.push(`None of the ${stalled.length} \`In progress\` row(s) has held that status across more than two sessions.`);
} else {
  L.push(`**${flagged.length} of ${stalled.length}** \`In progress\` row(s) qualify.`);
  L.push("");
  L.push("| ID | entered In progress | sessions held | item |");
  L.push("| --- | --- | --- | --- |");
  for (const s of flagged.sort((a, b) => compareIds(a.row.ID, b.row.ID))) {
    if (s.unresolved) {
      L.push(`| \`${s.row.ID}\` | _not recovered — ${s.unresolved}_ | _not recovered_ | ${clip(s.row.Item)} |`);
      continue;
    }
    const when = s.entry.recovered
      ? `${s.entry.date} (\`${s.entry.sha.slice(0, 7)}\`)`
      : `_not recovered_ — already \`In progress\` at the oldest tracker commit ` +
        `(${s.entry.oldestWalked.date}, \`${s.entry.oldestWalked.sha.slice(0, 7)}\`), so it entered on or before that`;
    const held = s.entry.recovered ? `${s.sessions}` : `at least ${s.sessions}`;
    L.push(`| \`${s.row.ID}\` | ${when} | ${held} | ${clip(s.row.Item)} |`);
  }
}
if (notFlagged.length > 0) {
  L.push("");
  L.push(
    `The other ${notFlagged.length} \`In progress\` row(s) entered that status within the last two ` +
      `sessions and are not flagged: ${notFlagged
        .sort((a, b) => compareIds(a.row.ID, b.row.ID))
        .map((s) => `\`${s.row.ID}\` (${s.entry.date})`)
        .join(", ")}.`,
  );
}
L.push("");

/* the census */
L.push("## The census");
L.push("");
L.push(
  `All ${open.length} open row(s), sorted by status and then by ID. Format: ` +
    "**ID** · item · status · priority · note.",
);
L.push("");

let rendered = 0;
let lastStatus = null;
for (const r of open) {
  if (r.Status !== lastStatus) {
    lastStatus = r.Status;
    L.push("");
    L.push(`### ${r.Status} — ${open.filter((x) => x.Status === r.Status).length} row(s)`);
    L.push("");
  }
  const note = clip(r.Notes);
  L.push(`- **${r.ID}** · ${clip(r.Item)} · ${r.Status} · ${r.Priority}${note ? ` · ${note}` : " · _no note_"}`);
  rendered++;
}
L.push("");

const md = `${L.join("\n")}\n`;

/* ------------------------------------------------------------ reconcile --- */

const problems = [];

if (rendered !== open.length) {
  problems.push(
    `the header states ${open.length} open row(s) and the body rendered ${rendered} — they must be equal`,
  );
}
if (closed.length + open.length !== total) {
  problems.push(
    `${closed.length} closed + ${open.length} open = ${closed.length + open.length}, but the tracker holds ${total} row(s)`,
  );
}
const ids = records.map((r) => r.ID);
if (new Set(ids).size !== ids.length) {
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  problems.push(`the tracker holds duplicate ID(s): ${[...new Set(dupes)].join(", ")}`);
}

const mdBytes = Buffer.byteLength(md, "utf8");
if (mdBytes > MD_CAP_BYTES) {
  // Loud, and it names what would have been dropped. Never a silent truncation,
  // and never an empty section standing in for content that did not fit.
  problems.push(
    `${MD_OUT} is ${mdBytes} bytes, over the ${MD_CAP_BYTES}-byte cap. Nothing was written. ` +
      `To fit, the census section (${rendered} row(s), the largest block) would have to be cut or ` +
      `the ${NOTE_CLIP}-character note clip tightened — and that is the author's call, not this script's.`,
  );
}

if (problems.length > 0) {
  console.error("\npnpm deferred — REFUSED, nothing written\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

/* ---------------------------------------------------------------- write --- */

writeFileSync(join(ROOT, MD_OUT), md, "utf8");

const csvCols = ["ID", "Area", "Item", "Detail", "Priority", "Status", "Depends on", "Target", "Notes"];
const csvLines = [[...csvCols, "Disposition"].map(csvCell).join(",")];
for (const r of open) {
  csvLines.push([...csvCols.map((c) => csvCell(r[c])), csvCell("")].join(","));
}
const csv = `${csvLines.join("\n")}\n`;
writeFileSync(join(ROOT, CSV_OUT), csv, "utf8");

/* --------------------------------------------------------------- report --- */

console.log("\npnpm deferred\n");
console.log(`  tracker rows          ${total}`);
console.log(`  done or absorbed      ${closed.length}`);
console.log(`  still open            ${open.length}`);
console.log(`  rendered in the md    ${rendered} (equal to the header, or this would have refused)`);
console.log(`  statuses in tracker   ${statusTally.size} — ${[...statusTally.keys()].join(", ")}`);
console.log(`  outside known set     ${unknownRows.length} open row(s)${unknownRows.length ? ` — ${unknownRows.map((r) => r.ID).join(", ")}` : ""}`);
console.log(`  in progress           ${stalled.length}, of which ${flagged.length} stalled past two sessions`);
console.log(`  history walked        ${history.walked} commit(s), ${history.dates.length} distinct date(s)`);
console.log(`  ${MD_OUT}    ${mdBytes} bytes of ${MD_CAP_BYTES}`);
console.log(`  ${CSV_OUT}   ${Buffer.byteLength(csv, "utf8")} bytes (no cap — it is for the spreadsheet)`);
console.log("");

if (!existsSync(join(ROOT, MD_OUT)) || statSync(join(ROOT, MD_OUT)).size === 0) {
  console.error("  the md was written but is empty — that is a failure, not a run\n");
  process.exit(1);
}
