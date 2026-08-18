/**
 * The lint allowlist, enforced — 3b (2026-08-18).
 *
 *   corepack pnpm lint:allowlist
 *
 * ## The word had no mechanism behind it
 *
 * Standing reports had been describing this repository's lint warnings as
 * "allowlisted" for several sessions. An external audit went looking for the
 * allowlist and found none: the warnings were merely TOLERATED, and the word in
 * the reports was describing a thing that did not exist. That is the same
 * defect class as a stated count nobody can check — it reads as "these were
 * reviewed and accepted" while nobody has reviewed anything, and it degrades
 * silently, because the next warning to appear joins a group whose name already
 * says it is fine.
 *
 * This is the mechanism. `lint-allowlist.json` lists every tolerated warning
 * with its reason; this script refuses when a warning appears that is not on
 * that list, and names entries on the list that no longer match anything.
 *
 * ## Both directions, because only one of them is the obvious one
 *
 * A new warning failing loudly is the point. A STALE entry is the quieter
 * problem: an allowlist that keeps entries for warnings that no longer exist
 * grows into permission for whatever turns up next under the same file and
 * rule, and its count stops describing the tree. Stale entries are reported;
 * they do not fail the run, because a warning disappearing is somebody having
 * fixed something, and failing a build over a fix is how a check teaches people
 * to skip it.
 *
 * ## Matching
 *
 * file + rule + symbol. NOT line number: a line drifts whenever anything above
 * it is edited, and an allowlist that goes stale on an unrelated edit is one
 * people regenerate without reading, which is the same as not having one. The
 * symbol is read out of the message text, which is where the identifier lives.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const ROOT = process.cwd();
const ALLOWLIST = "lint-allowlist.json";

const allow = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
const entries = allow.warnings ?? [];

/**
 * ESLint through its Node API rather than its CLI.
 *
 * Shelling out to `npx eslint --format json` produced no output in this
 * environment, and a checker whose subprocess quietly returns nothing is a
 * checker that reports a clean tree it never looked at. The API returns the
 * same result objects the JSON formatter serialises, with no shell, no PATH
 * resolution and no exit-code ambiguity in between.
 */
const { ESLint } = await import("eslint");
const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(["."]);

if (results.length === 0) {
  console.error("lint-allowlist · ESLint linted no files — nothing was checked.");
  process.exit(1);
}

/** `'foo' is defined but never used.` → `foo` */
function symbolOf(message) {
  const m = /^'([^']+)'/.exec(message);
  return m ? m[1] : null;
}

const found = [];
let errorCount = 0;
for (const file of results) {
  const rel = relative(ROOT, file.filePath).replace(/\\/g, "/");
  for (const m of file.messages) {
    if (m.severity === 2) errorCount += 1;
    found.push({
      file: rel,
      rule: m.ruleId,
      symbol: symbolOf(m.message),
      line: m.line,
      severity: m.severity,
      message: m.message,
    });
  }
}

const key = (w) => `${w.file}|${w.rule}|${w.symbol}`;
const allowed = new Set(entries.map(key));
const seen = new Set(found.map(key));

const unlisted = found.filter((w) => !allowed.has(key(w)));
const stale = entries.filter((e) => !seen.has(key(e)));

console.log(
  `lint-allowlist · ${found.length} warning(s) reported · ${entries.length} allowlisted · ` +
    `${unlisted.length} NOT allowlisted · ${stale.length} stale entr(ies) · ` +
    `${errorCount} error(s)`,
);

if (stale.length > 0) {
  // Reported, never fatal: a warning going away is somebody having fixed
  // something, and failing over a fix teaches people to skip the check.
  console.log("\nlint-allowlist · stale entries (the warning no longer occurs — remove them):");
  for (const e of stale) console.log(`  ${e.file} · ${e.rule} · ${e.symbol}`);
}

if (errorCount > 0) {
  console.error(
    `\nlint-allowlist · REFUSED — ${errorCount} lint ERROR(s). ` +
      "This file governs tolerated WARNINGS; an error is never tolerated.",
  );
  process.exit(1);
}

if (unlisted.length > 0) {
  console.error("\nlint-allowlist · REFUSED — warning(s) outside the allowlist:\n");
  for (const w of unlisted) {
    console.error(`  ${w.file}:${w.line}  ${w.rule}  ${w.message}`);
  }
  console.error(
    `\n  Fix the warning, or add it to ${ALLOWLIST} WITH A REASON.\n` +
      "  An entry with no reason is the thing this check was built to replace.\n",
  );
  process.exit(1);
}

console.log("\nlint-allowlist · every reported warning is listed with a reason.");
