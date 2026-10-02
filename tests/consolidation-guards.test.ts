/** The frontier and working guide remain consistent with their source documents. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the frontier is unordered and carries no priority sequence", () => {
  const f = readFileSync(join(ROOT, "docs/frontier.md"), "utf8");
  assert.ok(!/in priority order/i.test(f), "frontier still claims a priority order");
});

test("every rulings section CLAUDE.md applies exists in docs/rulings.md", () => {
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const rulings = readFileSync(join(ROOT, "docs", "rulings.md"), "utf8");
  const sections = new Set<number>();
  for (const m of claude.matchAll(/§(\d+)(?:–(\d+))?/g)) {
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n += 1) sections.add(n);
  }
  assert.ok(sections.size >= 8, "found too few CLAUDE.md rulings references — parser drift");
  for (const n of sections) {
    assert.match(rulings, new RegExp(`^## ${n}\\. `, "m"), `CLAUDE.md applies rulings §${n}, which docs/rulings.md does not have`);
  }
  // And it no longer carries a ledger ruling as though it were current policy.
  assert.doesNotMatch(claude, /\((?:RULING\s+)?\d{2,4}\)/, "CLAUDE.md cites a ledger ruling as a rule carrier");
});
