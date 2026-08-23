/**
 * `pnpm sweep:absence-defaults` — **every render default that could turn a
 * null into a finding.** (Item 3, 2026-08-23.)
 *
 * The shape and its three instances are documented in
 * `lib/text/absence-defaults.ts`. This walks `app/` and `components/`, prints
 * every sentence-shaped default it finds against the recorded baseline, and
 * exits 1 on anything unrecorded.
 *
 * ```
 * pnpm sweep:absence-defaults           # report and gate
 * pnpm sweep:absence-defaults --write   # re-record the baseline
 * ```
 *
 * `--write` refuses to record an entry with no reason, so making the build
 * pass is always a diff that says why the default is not a claim. The baseline
 * only shrinks: an entry that has been fixed is reported so it can be removed,
 * and it can never come back silently.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { RENDER_ROOTS, absenceDefaultsIn } from "../lib/text/absence-defaults.ts";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "tests", "absence-defaults.json");

interface Entry {
  file: string;
  text: string;
  reason: string;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

const files = RENDER_ROOTS.flatMap((r) => walk(join(ROOT, r), []));
const found: Omit<Entry, "reason">[] = [];
for (const file of files) {
  for (const hit of absenceDefaultsIn(readFileSync(file, "utf8"))) {
    found.push({ file: relative(ROOT, file), text: hit.text });
  }
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as { entries: Entry[] };
const keyOf = (e: { file: string; text: string }) => `${e.file} :: ${e.text}`;
const recorded = new Map(baseline.entries.map((e) => [keyOf(e), e]));

if (process.argv.includes("--write")) {
  const kept: Entry[] = [];
  for (const f of found) {
    const at = recorded.get(keyOf(f));
    if (at === undefined || at.reason.trim() === "") {
      console.error(
        `refusing to record without a reason: ${f.file} — "${f.text}"\n` +
          `  add the entry to tests/absence-defaults.json with a reason first.`,
      );
      process.exit(1);
    }
    kept.push(at);
  }
  writeFileSync(BASELINE, `${JSON.stringify({ entries: kept }, null, 2)}\n`, "utf8");
  console.log(`recorded ${kept.length} entries`);
  process.exit(0);
}

const unrecorded = found.filter((f) => !recorded.has(keyOf(f)));
const gone = baseline.entries.filter((e) => !found.some((f) => keyOf(f) === keyOf(e)));

console.log(
  `\nabsence-to-assertion sweep — ${files.length} files under ${RENDER_ROOTS.join(", ")}`,
);
console.log(`  sentence-shaped defaults found:  ${found.length}`);
console.log(`  recorded with a reason:          ${found.length - unrecorded.length}`);
console.log(`  UNRECORDED:                      ${unrecorded.length}`);
for (const u of unrecorded) console.log(`    ${u.file}  "${u.text}"`);
if (gone.length > 0) {
  console.log(`\n  baseline entries no longer present (the baseline only shrinks — run --write):`);
  for (const g of gone) console.log(`    ${g.file}  "${g.text}"`);
}
console.log("");
if (unrecorded.length > 0) process.exit(1);
