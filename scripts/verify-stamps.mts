/**
 * `pnpm verify-stamps` — check every "Adopted <date>" stamp in `CLAUDE.md`
 * against the git history that would have to be true for it.
 *
 * Three rules in `CLAUDE.md` are stamped later than the file's own last
 * modification and later than every commit in the repo. That is not a typo:
 * it is a date produced because one was expected, in the file that holds this
 * product's non-negotiable constraints. The stamps say *when a rule became
 * law*, so a wrong one misdates the constraint every later decision was
 * supposedly made under.
 *
 * The method is the pickaxe. Each rule's opening clause — the bold title it
 * leads with — is a string that entered `CLAUDE.md` exactly once, so
 * `git log -S<clause>` recovers the commit that introduced it, and the
 * commit's author date is when the rule actually landed.
 *
 * **This script writes no corrections.** It produces `docs/stamp-audit.md`
 * and prints the same table. Every stamp it flags is a decision the author
 * makes — an agent that "fixed" a date here would be doing the exact thing
 * that caused the defect: writing a plausible date rather than a read one.
 *
 * Not in the test gate. It runs a `git log` per stamp over the whole history
 * and belongs at handoff, not on every `pnpm test`.
 *
 * ---
 *
 * **On `--diff-filter=A`.** The brief specified
 * `git log -S<clause> --diff-filter=A`. That filter restricts the log to
 * commits where a *file was added*, and `CLAUDE.md` was added once, long
 * before any of these rules were written — so with the filter on, every
 * single stamp comes back NOT FOUND and the audit says nothing. It is run
 * anyway and reported in its own column, because a spec silently dropped is
 * how a report starts lying; the recovered date comes from the unfiltered
 * pickaxe, oldest commit first, which is the introduction.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stamp } from "./stamp.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "CLAUDE.md";
const OUT = "docs/stamp-audit.md";

interface Stamp {
  /** 1-based line in CLAUDE.md. */
  line: number;
  /** The date the document claims. */
  claimed: string;
  /** Exactly as written — "Adopted" or "adopted". */
  wording: string;
  /** The rule's opening clause, used as the pickaxe search string. */
  clause: string;
}

interface Finding extends Stamp {
  recovered: string | null;
  sha: string | null;
  subject: string | null;
  deltaDays: number | null;
  /** How many commits the unfiltered pickaxe matched. */
  matches: number;
  /** What the literal `--diff-filter=A` form returned. */
  addedFilter: string;
}

/**
 * The verbs that stamp a rule with a date.
 *
 * Kept as an explicit list rather than "any word before a date": a blunt
 * pattern would drag in every date in the file's prose and drown the four
 * real claims. Add to it when a new stamping verb appears — a stamp this
 * list does not know is a stamp nothing audits.
 */
const STAMP_VERBS = [
  "Adopted",
  "adopted",
  "Author-revised",
  "author-revised",
  "Revised",
  "revised",
  "Amended",
  "amended",
  "Tightened",
  "tightened",
];

const STAMP_RE = new RegExp(`\\b(${STAMP_VERBS.join("|")})\\s+(\\d{4}-\\d{2}-\\d{2})`, "g");

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * Every adoption stamp in `CLAUDE.md`, with the clause that identifies it.
 *
 * The clause is the **bold title** the rule opens with, which is what makes
 * this checkable at all: it is a long, distinctive string that entered the
 * file once. Where a stamp has no bold title in front of it, the run of text
 * back to the start of the line is used and the search is looser — reported
 * rather than hidden, since a loose search that matches several commits
 * cannot claim to have found the introduction.
 */
function readStamps(text: string): Stamp[] {
  const lines = text.split(/\r?\n/);
  const stamps: Stamp[] = [];

  for (const [i, line] of lines.entries()) {
    // Every verb that stamps a rule with a date, not just the one the brief
    // named. "Door 2 adopted ..." is the same claim in lower case, and
    // "(Author-revised ...)" on the disclosure rule is a stamp the first
    // version of this audit walked straight past — it reported eight of nine
    // and called that complete, which is the failure this whole file exists
    // to catch. The wording is carried per row so nothing is silently
    // reclassified as something it does not say.
    for (const match of line.matchAll(STAMP_RE)) {
      const before = line.slice(0, match.index);
      const bold = [...before.matchAll(/\*\*(.+?)\*\*/g)].pop();
      let clause = (bold ? bold[1] : before)
        .replace(/^[\s*(]+|[\s*(—-]+$/g, "")
        .trim();

      /*
       * THE HEADING FALLBACK (2026-08-17, g6).
       *
       * Most rules in `CLAUDE.md` are a bold sentence with the stamp inside
       * it, and the bold lead is the pickaxe string. **A rule that is a
       * SECTION is not** — its title lives in a `###` heading a line or two
       * above, and the stamp's own line opens with a bare `(Adopted …`. Those
       * produced an EMPTY clause, which the pickaxe then searched for,
       * matched nothing with, and reported as `NOT FOUND` — a blank row in
       * the table with a date and no rule name.
       *
       * Two stamps were in that state: THE TRANSPARENCY MANDATE, and THE
       * DEFERRAL BOUNDARY, which this same session had just written. So a
       * session added a rule and the auditor could not name it on the same
       * day, which is precisely the failure `CLAUDE.md` warns about in the
       * photo rule — "a stamp nothing audits is a stamp nobody can catch" —
       * arriving through the back door: audited, counted, and anonymous.
       *
       * The nearest preceding heading is the rule's title in that shape, and
       * it is just as unique a string in the file as a bold lead.
       */
      if (clause.length < 3) {
        for (let back = i; back >= 0 && i - back < 12; back -= 1) {
          const heading = /^#{2,4}\s+(.+?)\s*$/.exec(lines[back]);
          if (heading) {
            clause = heading[1].trim();
            break;
          }
        }
      }

      stamps.push({
        line: i + 1,
        claimed: match[2],
        wording: match[1],
        clause,
      });
    }
  }
  return stamps;
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function investigate(entry: Stamp): Finding {
  // The form the brief specified, run verbatim so the report can say what it
  // returned rather than quietly substituting a different command.
  let addedFilter = "none";
  try {
    const out = git([
      "log",
      `-S${entry.clause}`,
      "--diff-filter=A",
      "--format=%H %ad %s",
      "--date=short",
      "--",
      TARGET,
    ]);
    addedFilter = out === "" ? "none" : out.split("\n")[0];
  } catch {
    addedFilter = "command failed";
  }

  let log = "";
  try {
    log = git([
      "log",
      `-S${entry.clause}`,
      "--format=%H %ad %s",
      "--date=short",
      "--",
      TARGET,
    ]);
  } catch {
    log = "";
  }

  const rows = log === "" ? [] : log.split("\n");
  if (rows.length === 0) {
    return {
      ...entry,
      recovered: null,
      sha: null,
      subject: null,
      deltaDays: null,
      matches: 0,
      addedFilter,
    };
  }

  // `git log` is newest first; the introduction is the last line.
  const introduction = rows[rows.length - 1];
  const [sha, recovered, ...rest] = introduction.split(" ");

  return {
    ...entry,
    recovered,
    sha,
    subject: rest.join(" "),
    deltaDays: daysBetween(entry.claimed, recovered),
    matches: rows.length,
    addedFilter,
  };
}

/* ----------------------------------------------------------------- run --- */

const text = readFileSync(join(ROOT, TARGET), "utf8");
const stamps = readStamps(text);
const findings = stamps.map(investigate);

const today = stamp();
const wrong = findings.filter((f) => f.deltaDays !== null && f.deltaDays !== 0);
const missing = findings.filter((f) => f.recovered === null);
const future = findings.filter((f) => f.claimed > today);

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

function table(): string[] {
  const head = [
    "| Rule (opening clause) | Claimed | Recovered | Delta | Introducing commit |",
    "|---|---|---|---|---|",
  ];
  const rows = findings.map((f) => {
    const clause = f.clause.length > 58 ? `${f.clause.slice(0, 57)}…` : f.clause;
    const recovered = f.recovered ?? "**NOT FOUND**";
    const delta =
      f.deltaDays === null
        ? "—"
        : f.deltaDays === 0
          ? "0"
          : `${f.deltaDays > 0 ? "+" : ""}${f.deltaDays} d`;
    const subject = f.subject
      ? `\`${f.sha!.slice(0, 7)}\` ${f.subject.replace(/\|/g, "\\|")}`
      : "—";
    return `| ${clause.replace(/\|/g, "\\|")} | ${f.claimed} | ${recovered} | ${delta} | ${subject} |`;
  });
  return [...head, ...rows];
}

const doc = [
  "# Stamp audit — the dated rule stamps in `CLAUDE.md` against git history",
  "",
  "Generated by `pnpm verify-stamps` (`scripts/verify-stamps.mts`). Stamp verbs",
  `audited: ${STAMP_VERBS.join(", ")}. A verb missing from that list is a stamp`,
  "nothing audits — the first version of this file looked only for `Adopted` and",
  "walked straight past the `Author-revised` stamp on the disclosure rule.",
  "**This file is a report. Nothing here has been corrected — the author decides",
  "each one, and the corrected date is typed into `CLAUDE.md` by hand from",
  "`pnpm stamp` or from the recovered column below.**",
  "",
  `Run on ${today} (America/Phoenix). ${findings.length} stamp(s) audited.`,
  "",
  "**Method.** Each rule's opening clause — the bold title it leads with — is a",
  "long string that entered `CLAUDE.md` once. `git log -S<clause> -- CLAUDE.md`",
  "recovers every commit that changed the number of times it occurs; the oldest",
  "is the commit that introduced the rule, and its author date is when the rule",
  "actually became law. **Delta** is claimed minus recovered, in days: a positive",
  "number means the document claims a rule was adopted later than the commit that",
  "introduced it — a date nobody could have read, because the day had not",
  "happened.",
  "",
  "**On `--diff-filter=A`.** The brief specified that filter. It restricts the log",
  "to commits where a file was *added*, and `CLAUDE.md` was added once, long",
  "before any of these rules existed — so it returns nothing for every stamp. It",
  "is run verbatim anyway and its result is in the last table below, because a",
  "specified command silently swapped for a working one is how a report starts",
  "lying. The recovered dates come from the unfiltered pickaxe.",
  "",
  ...table(),
  "",
  "## What the deltas say",
  "",
  `- **${wrong.length} stamp(s) disagree with git history.**`,
  `- **${future.length} stamp(s) are still later than today** (${today}) — a date that had not happened when it was written.`,
  `- **${missing.length} stamp(s) could not be recovered** and are printed \`NOT FOUND\` rather than guessed.`,
  "",
  ...(wrong.length > 0
    ? [
        "| Line | Claimed | Recovered | Delta | Note |",
        "|---|---|---|---|---|",
        ...wrong.map(
          (f) =>
            `| \`CLAUDE.md:${f.line}\` | ${f.claimed} | ${f.recovered} | ${f.deltaDays! > 0 ? "+" : ""}${f.deltaDays} d | ${
              f.claimed > today
                ? "claimed date is in the future"
                : "claimed date is later than the introducing commit"
            } |`,
        ),
        "",
      ]
    : []),
  "## The literal `--diff-filter=A` result, per stamp",
  "",
  "| Rule (opening clause) | `--diff-filter=A` returned | Unfiltered matches |",
  "|---|---|---|",
  ...findings.map((f) => {
    const clause = f.clause.length > 58 ? `${f.clause.slice(0, 57)}…` : f.clause;
    return `| ${clause.replace(/\|/g, "\\|")} | ${f.addedFilter} | ${f.matches} |`;
  }),
  "",
  "A `1` in the last column means the clause entered the file exactly once and",
  "the recovery is unambiguous. Anything higher means the string was touched more",
  "than once and the oldest commit is the introduction but the rule may have been",
  "reworded since — worth a look before accepting the recovered date.",
  "",
];

writeFileSync(join(ROOT, OUT), doc.join("\n"), "utf8");

/* -------------------------------------------------------------- stdout --- */

console.log(`\nstamp audit — ${TARGET}, run ${today} (America/Phoenix)\n`);

const widths = {
  clause: Math.max(6, ...findings.map((f) => Math.min(f.clause.length, 46))),
};

console.log(
  `  ${pad("rule", widths.clause)}  ${pad("claimed", 10)}  ${pad("recovered", 11)}  ${pad("delta", 7)}  commit`,
);
console.log(`  ${"-".repeat(widths.clause + 46)}`);

for (const f of findings) {
  const clause =
    f.clause.length > widths.clause
      ? `${f.clause.slice(0, widths.clause - 1)}…`
      : f.clause;
  const delta =
    f.deltaDays === null ? "—" : `${f.deltaDays > 0 ? "+" : ""}${f.deltaDays}d`;
  console.log(
    `  ${pad(clause, widths.clause)}  ${pad(f.claimed, 10)}  ${pad(f.recovered ?? "NOT FOUND", 11)}  ${pad(delta, 7)}  ${
      f.sha ? `${f.sha.slice(0, 7)} ${f.subject}` : "—"
    }`,
  );
}

console.log("");
console.log(`  ${findings.length} stamp(s) audited.`);
console.log(`  ${wrong.length} disagree with git history.`);
console.log(`  ${future.length} are later than today (${today}).`);
console.log(`  ${missing.length} could not be recovered — printed NOT FOUND, never guessed.`);
console.log("");
console.log(`  Written to ${OUT}. No correction was made to ${TARGET}; the author decides.`);
console.log("");

// Exit 0 regardless. This is a report, not a gate — `tests/doc-dates.test.ts`
// is the gate, and a report that fails a handoff for describing a known,
// tracked defect would only teach everyone to stop running it.
