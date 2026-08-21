/**
 * **THE DONE-ROW AUDIT** (Prompt E item 7.3, 2026-08-20).
 *
 * 315 rows say they are finished. Item 7.3's point is that they are not all the
 * same KIND of claim, and inheriting them wholesale is how an optimistic
 * tracker stays optimistic:
 *
 *   - a row whose evidence can be CHECKED — it names a file, a test, a command
 *     or a production walk check that exists in this repository today — is a
 *     claim anybody can verify in a minute;
 *   - a row that is finished because a session said it was finished is a claim
 *     resting entirely on the session's own report.
 *
 * Both may be true. They are not equally checkable, and the tracker should say
 * which is which rather than printing one number over both.
 *
 * ## What counts as checkable, and why it is deliberately strict
 *
 * The row's own text has to NAME something, and the thing named has to EXIST
 * NOW. A note saying "tests pass" is a session's word; a note saying
 * `tests/reactions.test.ts` is a lookup, and the lookup is run rather than
 * trusted — a path that has since been deleted does not count, because the
 * evidence a reader would go and read is gone.
 *
 * Three kinds of evidence, in descending strength:
 *   LIVE     the row's id or a file it names appears in `scripts/walk-all.mts`,
 *            which runs against PRODUCTION. The strongest available: not "it
 *            was built" but "it is still working".
 *   REPO     the row names a path, a test or a `pnpm` script that exists today.
 *   WORD     neither. Finished on the session's report alone.
 *
 * `git grep` is not used: this has to run on a checkout with no git. It reads
 * the files itself and prints how many it read, which is the operation-count
 * rule applied to the audit's own instrument.
 *
 * Run:  node scripts/tracker-done-audit.mjs [--json <path>]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RESOLVED_CSV, ROOT, readStore } from "./tracker-core.mjs";

const rows = readStore(RESOLVED_CSV);

const walkSrc = readFileSync(join(ROOT, "scripts", "walk-all.mts"), "utf8");
const packageScripts = Object.keys(
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {},
);

/** Paths a row's text names. Deliberately narrow: a real path shape only. */
const PATH_RE =
  /\b((?:app|components|lib|scripts|tests|docs|data|states|\.github)\/[A-Za-z0-9_@./-]+\.[A-Za-z0-9]{1,5})/g;
const PNPM_RE = /\bpnpm\s+([a-z][a-z0-9]*(?::[a-z0-9-]+)?)/g;

function evidenceFor(row) {
  const text = `${row.Detail ?? ""} ${row["Session record"] ?? ""}`;
  const namedPaths = [...new Set([...text.matchAll(PATH_RE)].map((m) => m[1]))];
  const existing = namedPaths.filter((p) => existsSync(join(ROOT, p)));
  const namedScripts = [
    ...new Set([...text.matchAll(PNPM_RE)].map((m) => m[1])),
  ].filter((s) => packageScripts.includes(s));

  // LIVE: production still asserts this row's claim.
  const inWalk =
    walkSrc.includes(`"${row.ID}"`) ||
    walkSrc.includes(`[${row.ID}]`) ||
    existing.some((p) => walkSrc.includes(p));
  if (inWalk) return { kind: "LIVE", evidence: `named in scripts/walk-all.mts` };

  if (existing.length) {
    return { kind: "REPO", evidence: existing.slice(0, 3).join(", ") };
  }
  if (namedScripts.length) {
    return { kind: "REPO", evidence: namedScripts.map((s) => `pnpm ${s}`).join(", ") };
  }
  return {
    kind: "WORD",
    evidence:
      namedPaths.length > 0
        ? `names ${namedPaths.length} path(s), none of which exist now: ${namedPaths.slice(0, 3).join(", ")}`
        : "names no file, test or command that exists today",
  };
}

const audited = rows.map((r) => ({ ...evidenceFor(r), ID: r.ID, Title: r.Title, Section: r.Section }));
const live = audited.filter((a) => a.kind === "LIVE");
const repo = audited.filter((a) => a.kind === "REPO");
const word = audited.filter((a) => a.kind === "WORD");

console.log(`\nthe done-row audit — item 7.3\n`);
console.log(`  resolved rows read            ${rows.length}`);
console.log(`  files the instrument read      2 (scripts/walk-all.mts, package.json) + one existence check per named path`);
console.log(``);
console.log(`  VERIFIABLE against repo or live site   ${live.length + repo.length}`);
console.log(`    · still asserted against PRODUCTION  ${live.length}`);
console.log(`    · names a file or command that exists ${repo.length}`);
console.log(`  ON A SESSION'S WORD                    ${word.length}`);
console.log(
  `  the pair                               ${live.length + repo.length} + ${word.length} = ${live.length + repo.length + word.length}, against ${rows.length} resolved`,
);

if (word.length) {
  console.log(`\n  NAMED INDIVIDUALLY — a row that is neither is named, never counted:\n`);
  for (const a of word) console.log(`    ${a.ID.padEnd(7)} ${a.Title.slice(0, 78)}`);
}
console.log("");

const at = process.argv.indexOf("--json");
if (at > 0 && process.argv[at + 1]) {
  writeFileSync(process.argv[at + 1], JSON.stringify(audited, null, 1), "utf8");
}
