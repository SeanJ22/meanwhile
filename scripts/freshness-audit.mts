/**
 * `pnpm freshness:audit` — **RULING 107 made countable.**
 *
 * Written 2026-08-23 (visual-tail-and-rehunt session, item 1), which is the
 * session that caught `docs/congress-legislators-diff.md` moving its header
 * date from 2026-08-16 to 2026-08-23 with nothing read.
 *
 * It answers the three figures item 1 asks for, with denominators:
 *
 * - **N of M generators audited** — M is the registered generators in
 *   `lib/ops/generated-register.ts`, walked through their whole source closure,
 *   so a stamp written three imports deep is still this generator's stamp.
 * - **N able to restamp without reading** — a freshness field taking a clock
 *   value in a file that has not declared its stamps sit in the reading path.
 * - **N fixed** — the author of the fix reports this; the tool reports what is
 *   left.
 *
 * ```
 * pnpm freshness:audit          # report, exit 0
 * pnpm freshness:audit --strict # exit 1 if any generator can restamp
 * pnpm freshness:audit --all    # sweep every script and lib file, not only registered generators
 * ```
 *
 * `--all` exists because of the named-instance rule: the registered generators
 * are where RULING 102 already looks, and they are not the whole class. The
 * wider sweep is REPORTED rather than enforced, so the number is visible
 * without the guard failing on files nobody has triaged yet.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { GENERATED } from "../lib/ops/generated-register.ts";
import { entryFor, repoPath, sourceClosure } from "../lib/ops/generator-digest.ts";
import { judge, sweep, type StampSite } from "../lib/ops/freshness-audit.ts";

const ROOT = process.cwd();
const strict = process.argv.includes("--strict");
const all = process.argv.includes("--all");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(?:ts|mts|tsx|mjs)$/.test(name)) out.push(relative(ROOT, abs).split(sep).join("/"));
  }
  return out;
}

function show(sites: StampSite[], label: string): void {
  if (sites.length === 0) return;
  console.log(`\n  ${label}`);
  for (const s of sites) {
    console.log(`    ${s.file}:${s.line}  ${s.field} <- ${s.clock}`);
    console.log(`      ${s.text.slice(0, 130)}`);
  }
}

console.log("freshness audit — RULING 107\n");

let auditable = 0;
let unresolved = 0;
const offending = new Map<string, StampSite[]>();

for (const artifact of GENERATED) {
  const entry = entryFor(ROOT, artifact.command);
  if (entry === null) {
    // An unresolvable generator is REPORTED, never treated as clean — the same
    // choice `lib/ops/generator-digest.ts` makes for the same reason.
    unresolved += 1;
    console.log(`  UNRESOLVED  ${artifact.path} — cannot resolve \`${artifact.command}\` to a script`);
    continue;
  }
  auditable += 1;
  const closure = sourceClosure(ROOT, entry).map((f) => repoPath(ROOT, join(ROOT, f)));
  const verdict = judge(sweep(ROOT, closure));
  if (verdict.restamping.length > 0) offending.set(artifact.path, verdict.restamping);
}

const M = GENERATED.length;
console.log(`\n  generators audited          ${auditable} of ${M}`);
console.log(`  unresolvable (reported)     ${unresolved} of ${M}`);
console.log(`  able to restamp w/o reading ${offending.size} of ${auditable}`);

for (const [path, sites] of offending) show(sites, `${path}:`);

if (all) {
  const files = [...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "lib"))];
  const verdict = judge(sweep(ROOT, files));
  const readingFiles = new Set(verdict.reading.map((s) => s.file));
  const restampFiles = new Set(verdict.restamping.map((s) => s.file));
  console.log(`\n  WIDER SWEEP (reported, not enforced) — ${files.length} files read`);
  console.log(`    files declaring the stamp sits in the reading path  ${readingFiles.size}`);
  console.log(`    files with an undeclared clock-fed freshness field  ${restampFiles.size}`);
  for (const f of [...restampFiles].sort()) console.log(`      ${f}`);
}

if (strict && offending.size > 0) {
  console.error("\nFAIL: a registered generator can restamp a freshness date without reading.");
  process.exit(1);
}
