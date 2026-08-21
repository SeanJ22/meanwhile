/**
 * **RULING 40 — ATTRIBUTION HAS NO SOFT LANDING.** (Prompt E item 8b,
 * 2026-08-20.)
 *
 * The project is eleven days old, every row was written by a session that
 * reported what it did, and the commits are in the repo. Attribution is a
 * LOOKUP, not a guess, and `UNKNOWN` is a defect rather than an acceptable
 * ending.
 *
 * ## The lookup
 *
 * Every commit that ever touched `docs/tracker.csv`, oldest first. The first
 * commit in which an id appears is the commit that OPENED that row; the first
 * commit in which its Status reads Done or Absorbed is the commit that CLOSED
 * it. Both are facts about the repository, checkable by anyone with `git show`.
 *
 * ## Naming the session rather than the commit
 *
 * A SHA is an attribution nobody can read. Session names live in the commit
 * subjects — `Prompt D: …`, `F22: …`, `g19 records: …` — and this repo's
 * sessions end with a records commit that names the session out loud. So a
 * commit whose subject carries a session token IS that session, and the
 * unlabelled work commits that precede it belong to the same session: they are
 * the work the records commit is the record of. That back-fill is why there is
 * no residue.
 *
 * Where a run is still unnamed after both passes, it is reported INDIVIDUALLY
 * with its date and subject — never as a bare count, and never as `UNKNOWN`.
 *
 * Run:  node scripts/tracker-attribution.mjs [--json <path>]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { parseCsv } from "./xlsx.mjs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256e6 });

/**
 * The session tokens this repo actually uses, most specific first.
 *
 * **Deliberately narrow.** A first draft matched a bare `gNN` anywhere in a
 * subject and attributed five rows to `g5` on the strength of the phrase
 * "g5's three deliverables measured" — a sentence in a `g19` commit ABOUT an
 * earlier session. A pattern loose enough to read a mention as an authorship
 * claim produces attributions that are worse than none, because they look
 * looked-up. So a `gNN` token counts only in the shapes this repo's records
 * commits actually take.
 */
const SESSION_PATTERNS = [
  [/^F01C2\b|^F01-continued session 2\b/, "F01C2"],
  [/^F01-continued\b/, "F01C"],
  [/^F01\b/, "F01"],
  [/^F22\b/, "F22"],
  [/^Prompt ([A-E])\b/, (m) => `Prompt ${m[1]}`],
  [/^AUD-(\d\d)\b/, (m) => `AUD-${m[1]}`],
  // The three shapes a records commit takes: "g19 records:", "The record for
  // g12:", "The session documents: g16's record".
  [/^([gh]\d{1,2}) records\b/, (m) => m[1]],
  [/\bThe record for ([gh]\d{1,2})\b/, (m) => m[1]],
  [/\b([gh]\d{1,2})'s record\b/, (m) => m[1]],
  // A handoff commit names the branch, and the branch names the session.
  [/^Session handoff: \d+ commit\(s\) from claude\/([a-z0-9-]+)/, (m) => m[1]],
];

export function sessionOf(subject) {
  for (const [re, out] of SESSION_PATTERNS) {
    const m = re.exec(subject);
    if (m) return typeof out === "function" ? out(m) : out;
  }
  return null;
}

/**
 * **THE SESSIONS THAT PREDATE THE NAMING CONVENTION.**
 *
 * Session handles (`g8`, `F01`, `Prompt D`) start on 2026-08-17. Before that,
 * a session is identified in this repo by its own records commit and by its
 * section in `docs/state.md` — there is no token to match, and inventing one
 * now would be a name nobody could check.
 *
 * So those rows are attributed to the RUN, by its date and its own commit
 * subject: `2026-08-14 · the tester's mobile pass…`. That is a lookup result,
 * stated individually, and a person can find it with one `git log --grep`. It
 * is not `UNKNOWN`, which RULING 40 calls a defect, and it is not a guess.
 */
export function labelFor(commit) {
  if (commit.session) return commit.session;
  const subject = commit.subject.replace(/\s+/g, " ").trim();
  const short = subject.length > 58 ? `${subject.slice(0, 57)}…` : subject;
  return `${commit.date} · ${short}`;
}

export function attribute() {
  const log = git([
    "log",
    "--reverse",
    "--follow",
    "--format=%H\x1f%ad\x1f%s",
    "--date=short",
    "--",
    "docs/tracker.csv",
  ])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, date, subject] = l.split("\x1f");
      return { sha, date, subject, session: sessionOf(subject) };
    });

  /*
   * Back-fill. A session's work commits come first and its records commit names
   * it, so an unlabelled run inherits the label of the next labelled commit ON
   * THE SAME DAY. The same-day condition is the guard: without it, a stretch of
   * unlabelled commits would be swallowed by whatever session happened to
   * commit next, which is a guess wearing a lookup's clothes.
   */
  for (let i = 0; i < log.length; i++) {
    if (log[i].session) continue;
    for (let j = i + 1; j < log.length; j++) {
      if (log[j].date !== log[i].date) break;
      if (log[j].session) {
        log[i].session = log[j].session;
        log[i].inherited = true;
        break;
      }
    }
  }
  // A commit still unlabelled takes the previous labelled commit on the same
  // day — the tail of a session that committed its records first.
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].session) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (log[j].date !== log[i].date) break;
      if (log[j].session) {
        log[i].session = log[j].session;
        log[i].inherited = true;
        break;
      }
    }
  }

  const opened = new Map();
  const closed = new Map();
  const unnamed = [];

  for (const c of log) {
    let text;
    try {
      text = git(["show", `${c.sha}:docs/tracker.csv`]);
    } catch {
      continue; // the file did not exist at this commit under this name
    }
    const grid = parseCsv(text);
    const header = grid[0].map((h) => h.trim());
    const idAt = header.indexOf("ID");
    const statusAt = header.indexOf("Status");
    if (idAt < 0) continue;

    for (const r of grid.slice(1)) {
      const id = (r[idAt] ?? "").trim();
      if (!id) continue;
      if (!opened.has(id)) {
        opened.set(id, c);
        if (!c.session) unnamed.push({ id, ...c });
      }
      const status = statusAt >= 0 ? (r[statusAt] ?? "").trim() : "";
      if (["Done", "Absorbed"].includes(status) && !closed.has(id)) closed.set(id, c);
    }
  }

  return { log, opened, closed, unnamed };
}

/* ------------------------------------------------------------------ main --- */

if (process.argv[1] && process.argv[1].endsWith("tracker-attribution.mjs")) {
  const { log, opened, closed, unnamed } = attribute();
  const bySession = {};
  for (const [, c] of opened) {
    const key = labelFor(c);
    bySession[key] = (bySession[key] ?? 0) + 1;
  }

  console.log(`\ntracker attribution — RULING 40\n`);
  console.log(`  commits touching docs/tracker.csv   ${log.length}`);
  console.log(`  ids with an opening commit          ${opened.size}`);
  console.log(`  ids with a closing commit           ${closed.size}`);
  console.log(`  ids opened by an unnamed run        ${unnamed.length}`);
  console.log(`\n  rows opened, by session:`);
  for (const [s, n] of Object.entries(bySession).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${s}`);
  }
  if (unnamed.length) {
    console.log(`\n  NAMED INDIVIDUALLY — a bare count is not an acceptable report line:`);
    for (const u of unnamed) console.log(`    ${u.id}  ${u.date}  ${u.sha.slice(0, 8)}  ${u.subject}`);
  }

  const at = process.argv.indexOf("--json");
  if (at > 0 && process.argv[at + 1]) {
    writeFileSync(
      process.argv[at + 1],
      JSON.stringify(
        {
          opened: Object.fromEntries(
            [...opened].map(([id, c]) => [id, { label: labelFor(c), session: c.session, date: c.date, sha: c.sha, subject: c.subject }]),
          ),
          closed: Object.fromEntries(
            [...closed].map(([id, c]) => [id, { label: labelFor(c), session: c.session, date: c.date, sha: c.sha, subject: c.subject }]),
          ),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n  written to ${process.argv[at + 1]}`);
  }
  console.log("");
}
