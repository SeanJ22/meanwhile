/**
 * **THE AMENDMENT HISTORY** — every rule added or changed, when, and by which
 * session. (Prompt E item 13.3, 2026-08-20.)
 *
 * ## Why it exists
 *
 * The rules have been amended across eleven days and roughly a hundred
 * sessions, and there was no single place to read what changed and when.
 * `CLAUDE.md` shows the rules as they stand now; `docs/rulings.md` shows the
 * decisions that are not law. Neither shows the SHAPE of the change — that a
 * rule was tightened on the 16th, contradicted on the 19th and rewritten on the
 * 20th — and that shape is most of what somebody needs when they are trying to
 * work out why a rule says what it says.
 *
 * ## It is derived, never composed
 *
 * Every entry comes from `git log -p` over `CLAUDE.md` and `docs/rulings.md`.
 * An amendment is an ADDED line that opens a rule: a bold lead-in at the start
 * of a line, or a markdown heading. The session is the commit's, through the
 * same lookup `scripts/tracker-attribution.mjs` uses, so this file and the
 * tracker's attribution cannot disagree about which session did what.
 *
 * A composed history would be a session's account of the rules rather than the
 * rules' own record, and this project has been bitten twice by a document that
 * described the code instead of being derived from it.
 *
 * Run:  corepack pnpm rules:history
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";
import { labelFor, sessionOf } from "./tracker-attribution.mjs";
import { ROOT } from "./tracker-core.mjs";

const FILES = ["CLAUDE.md", "docs/rulings.md"];
const STAMP = today();

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512e6 });

/**
 * A line that OPENS a rule, rather than a line inside one.
 *
 * Deliberately narrow. Every rule in `CLAUDE.md` opens with a bold lead-in at
 * the start of a line, and every entry in `docs/rulings.md` opens with a
 * heading. A looser pattern would report every reflowed paragraph as an
 * amendment, and a history that lists everything lists nothing.
 */
const RULE_OPENERS = [
  /^\*\*(.+?)\*\*/,
  /^#{2,4}\s+(.+?)\s*$/,
];

/** Trim a rule's opener down to the sentence a person would recognise it by. */
function ruleName(line) {
  for (const re of RULE_OPENERS) {
    const m = re.exec(line);
    if (!m) continue;
    let name = m[1]
      .replace(/`/g, "")
      .replace(/\*\*/g, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    if (name.length < 12) return null;
    if (name.length > 110) name = `${name.slice(0, 108)}…`;
    return name;
  }
  return null;
}

const commits = git([
  "log",
  "--reverse",
  "--format=%H\x1f%ad\x1f%s",
  "--date=short",
  "--",
  ...FILES,
])
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [sha, date, subject] = l.split("\x1f");
    return { sha, date, subject, session: sessionOf(subject) };
  });

// Same same-day back-fill the attribution lookup uses, so the two agree.
for (let i = 0; i < commits.length; i++) {
  if (commits[i].session) continue;
  for (let j = i + 1; j < commits.length; j++) {
    if (commits[j].date !== commits[i].date) break;
    if (commits[j].session) {
      commits[i].session = commits[j].session;
      break;
    }
  }
}
for (let i = commits.length - 1; i >= 0; i--) {
  if (commits[i].session) continue;
  for (let j = i - 1; j >= 0; j--) {
    if (commits[j].date !== commits[i].date) break;
    if (commits[j].session) {
      commits[i].session = commits[j].session;
      break;
    }
  }
}

const seen = new Set();
const entries = [];
let diffsRead = 0;

for (const c of commits) {
  let patch;
  try {
    patch = git(["show", "--unified=0", "--format=", c.sha, "--", ...FILES]);
  } catch {
    continue;
  }
  diffsRead += 1;
  let file = null;
  const added = [];
  const removed = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const name = ruleName(line.slice(1));
      if (name) added.push({ file, name });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const name = ruleName(line.slice(1));
      if (name) removed.push(name);
    }
  }

  const fresh = [];
  const changed = [];
  for (const a of added) {
    const key = `${a.file}::${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (removed.length > 0 ? changed : fresh).push(a);
  }
  const gone = removed.filter((r) => !added.some((a) => a.name === r));

  if (fresh.length === 0 && changed.length === 0 && gone.length === 0) continue;
  entries.push({ ...c, fresh, changed, gone });
}

/* ----------------------------------------------------------------- render --- */

const out = [];
const w = (s = "") => out.push(s);

w("# The amendment history — what the rules said, and when it changed");
w();
w("**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm rules:history`");
w("(`scripts/amendment-history.mjs`) from `git log -p` over `CLAUDE.md` and");
w("`docs/rulings.md`. It is derived rather than composed, so it cannot become a");
w("session's account of the rules instead of the rules' own record.");
w();
w(`Generated ${STAMP} (America/Phoenix, from \`pnpm stamp\`).`);
w();
w("Newest first. An entry is a commit that opened or reworded a rule.");
w();
w(
  `**${entries.length} commits changed a rule**, out of ${commits.length} that touched ` +
    `either file. ${diffsRead} diffs were read.`,
);
w();
w("`CLAUDE.md` is LAW: a rule there binds every session and is changed only by");
w("Sean. `docs/rulings.md` is the append-only record of decisions that are not");
w("law. A ruling that becomes law is written into `CLAUDE.md` and its entry says");
w("so; a ruling that contradicts `CLAUDE.md` does not silently win — the conflict");
w("is named and Sean rules.");
w();
w("---");
w();

for (const e of [...entries].reverse()) {
  w(`## ${e.date} · ${labelFor(e)}`);
  w();
  w(`*${e.subject}*`);
  w();
  if (e.fresh.length) {
    w("**Added.**");
    w();
    for (const a of e.fresh) w(`- ${a.name}  \`${a.file}\``);
    w();
  }
  if (e.changed.length) {
    w("**Changed or rewritten.**");
    w();
    for (const a of e.changed) w(`- ${a.name}  \`${a.file}\``);
    w();
  }
  if (e.gone.length) {
    w("**Removed or superseded in place.**");
    w();
    for (const r of e.gone) w(`- ${r}`);
    w();
  }
}

writeFileSync(join(ROOT, "docs", "amendment-history.md"), `${out.join("\n")}\n`, "utf8");
console.log(
  `\nWROTE docs/amendment-history.md — ${entries.length} rule-changing commit(s) ` +
    `of ${commits.length} touching CLAUDE.md or docs/rulings.md, ${diffsRead} diffs read\n`,
);
