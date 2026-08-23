/**
 * **RULING 88 — the expansion requirement, made checkable.**
 * (Adopted 2026-08-22, the author's Discovery Conduct brief, items 3A and 7.)
 *
 * Every hunt report carries an expansion section listing routes that did not
 * exist at session start. `docs/expansion-log.md` is where that section lands
 * permanently, and this guard is what stops it being the thing a tired session
 * skips.
 *
 * ## What it asserts
 *
 * The newest session named in `docs/log.md` — the generated session record —
 * must have an entry under the same session id in `docs/expansion-log.md`.
 *
 * ## Why the newest session and not all of them
 *
 * `docs/log.md` reaches back 121 sessions, every one of which predates this
 * rule. Demanding entries for all of them would fail the build for history
 * nobody can go back and write, which is a guard that gets deleted rather than
 * satisfied. The newest is the one this rule can actually bind, and binding it
 * every session is what accumulates the file.
 *
 * ## Why the exemption is a MARKER and not an inference
 *
 * A non-hunt session — a governance pass, a visual build, a refactor — has no
 * routes to report, and forcing an empty section on it would teach every
 * session that an empty section is acceptable. So it is exempt. But the
 * exemption is claimed by putting **`-nonhunt` in the session id**, not by the
 * test working out what the session did.
 *
 * That distinction is the whole design. A test that inferred exemption would be
 * guessing, and its guess would be wrong in the direction that costs something:
 * a hunt session whose id happened to look like housekeeping would be silently
 * excused. A marker cannot be claimed by accident — it is typed into
 * `--session=<label>` and it appears in the generated log for anyone to see.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOG = join(ROOT, "docs", "log.md");
const EXPANSION = join(ROOT, "docs", "expansion-log.md");

/** The marker that claims the non-hunt exemption. */
const NONHUNT = "-nonhunt";

/**
 * Session headings in `docs/log.md` read `## <label> · <date>`, newest first.
 *
 * The file carries other `##` headings — `Deleted rows — RULING 46` is one — so
 * the date suffix is what identifies a session rather than the heading level.
 */
const SESSION_HEADING = /^##\s+(\S+)\s+·\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function newestSession(logText: string): { id: string; date: string } | null {
  for (const line of logText.split(/\r?\n/)) {
    const m = SESSION_HEADING.exec(line);
    if (m !== null) return { id: m[1], date: m[2] };
  }
  return null;
}

export function hasExpansionEntry(expansionText: string, id: string): boolean {
  return expansionText
    .split(/\r?\n/)
    .some((line) => line.startsWith("## ") && line.slice(3).trim().split(/\s+·\s+/)[0] === id);
}

test("the newest session in docs/log.md has an expansion-log entry, or claims the non-hunt marker", () => {
  const log = readFileSync(LOG, "utf8");
  const expansion = readFileSync(EXPANSION, "utf8");

  const newest = newestSession(log);
  assert.notEqual(
    newest,
    null,
    "docs/log.md names no session at all — the heading format `## <label> · <date>` has changed and this guard can no longer see sessions",
  );
  if (newest === null) return;

  if (newest.id.includes(NONHUNT)) {
    // Exempt. Nothing further is asserted about it — a non-hunt session has no
    // routes to report, and demanding a placeholder would teach every session
    // that a placeholder is what this file is for.
    return;
  }

  assert.ok(
    hasExpansionEntry(expansion, newest.id),
    `docs/expansion-log.md has no entry for session "${newest.id}" (${newest.date}).\n` +
      "RULING 88: every hunt report lists the routes that did not exist at session start — how each was\n" +
      "conceived, the literal query or URL, what it returned INCLUDING ZERO, and whether it generalises.\n" +
      "A route that returned nothing is a reported success and belongs in the log.\n" +
      `If this session hunted nothing, claim the exemption explicitly by putting "${NONHUNT}" in its\n` +
      "session id (--session=<label>). The exemption is never inferred.",
  );
});

test("the non-hunt exemption is claimed by a marker in the id, never inferred", () => {
  // The marker is the mechanism, so it is asserted directly against the two
  // helpers rather than against whatever happens to be in the files today.
  const log = "## somehunt-0823 · 2026-08-23\n";
  const empty = "# The expansion log\n";
  assert.equal(newestSession(log)?.id, "somehunt-0823");
  assert.equal(hasExpansionEntry(empty, "somehunt-0823"), false);

  const exempt = "## somepass-0823-nonhunt · 2026-08-23\n";
  assert.equal(newestSession(exempt)?.id.includes(NONHUNT), true);

  // And a session id that merely LOOKS like housekeeping is not exempt.
  const looksLikeHousekeeping = "## docs-cleanup-0823 · 2026-08-23\n";
  assert.equal(newestSession(looksLikeHousekeeping)?.id.includes(NONHUNT), false);
});

test("docs/expansion-log.md states that a zero-yield route is a reported success", () => {
  // The clause most likely to be quietly dropped, so it is pinned. Every other
  // figure in this project rewards rows found; without this sentence in front of
  // a session, an expansion section with four zero-yield routes reads as empty.
  const expansion = readFileSync(EXPANSION, "utf8");
  assert.match(expansion, /returned NOTHING belongs here exactly as much as/);
  assert.match(expansion, /The invention is the deliverable; the yield is\s+not\./);
});
