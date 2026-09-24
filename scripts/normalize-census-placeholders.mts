/**
 * `pnpm exec tsx scripts/normalize-census-placeholders.mts`
 *
 * The Census's own placeholder names, translated into what they mean (item
 * 6b, 2026-08-15, the author's finding).
 *
 * The defect: at the Tohono O'odham reservation area the map rendered a
 * district called "School District Not Defined" beside Indian Oasis-
 * Baboquivari Unified. Diagnosed before touching anything, and BOTH halves
 * of the author's question turn out to be true:
 *
 *  - It IS a real gap geometry. GEOID 0499997 is a genuine Census feature —
 *    a MultiPolygon over land that sits inside no unified school district.
 *    It is adjacent to Indian Oasis-Baboquivari rather than on top of it,
 *    which is why both render: they are different places.
 *  - It IS a labeling defect. "School District Not Defined" is the Census's
 *    internal placeholder, and we rendered it verbatim as though it were
 *    the name of a district. CLAUDE.md: identifiers and internal keys never
 *    reach a reader; a label map translates, or the row does not render.
 *
 * So the geometry stays — deleting it would erase a true fact about the
 * place — and the NAME becomes the fact: "No unified school district here."
 *
 * Idempotent and re-runnable: it rewrites labels in the committed registry
 * and boundary artifacts, states its counts, and exits non-zero if it
 * changed nothing AND nothing was already normalized (an edit that edits
 * nothing must never exit 0 quietly).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The placeholder strings and their plain words live beside the registry's placeholder rule (lib/registry/census-placeholders.ts).
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export { CENSUS_PLACEHOLDER_LABELS };

/*
 * **`lib/registry/registry.json` is deliberately NOT here** (NH232, 2026-08-27).
 *
 * It used to be the first entry, and that made this script a third writer to a
 * GENERATED artifact — the same class of defect that let `pnpm registry:build`
 * silently delete 731 promoted bodies. The registry derives its division labels
 * from the canonical state geometry, which IS in this list, so rewriting the boundary
 * file and rebuilding produces the normalised label through the generator
 * instead of behind its back. Verified on 2026-08-27 for Arizona: the geojson
 * already carries `No unified school district here`. New Hampshire's unified
 * layer carried the same placeholder and was missed until 2026-09-23: the
 * guard in tests/districts.test.ts never read New Hampshire's file, and its
 * pattern could not match the registry's pretty-printed label. The registry
 * is now frozen first-seed evidence that still carries New Hampshire's raw
 * label; its first-seed composition and every registry promotion translate it
 * (lib/registry/census-placeholders.ts).
 */
const TARGETS = [
  join(ROOT, "data", "states", "az", "geo", "unsd-04.geojson"),
  join(ROOT, "data", "states", "az", "streets", "85321.json"),
  join(ROOT, "data", "states", "az", "streets", "85601.json"),
  join(ROOT, "data", "states", "az", "streets", "85602.json"),
  // New Hampshire's unified layer carries the same placeholder (GEOID 3399997); found 2026-09-23, its guard having never read this file.
  join(ROOT, "data", "states", "nh", "geo", "unsd-33.geojson"),
];

let changedFiles = 0;
let alreadyClean = 0;
let replacements = 0;

for (const file of TARGETS) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log(`  MISSING   ${file}`);
    continue;
  }
  let updated = text;
  let fileHits = 0;
  for (const [placeholder, plain] of Object.entries(CENSUS_PLACEHOLDER_LABELS)) {
    // Only the LABEL is rewritten. The ocdId keeps its slug: it is a join
    // key, it is never rendered, and changing it would break every stored
    // reference to this division for a cosmetic reason.
    const pattern = new RegExp(`("(?:label|name|NAME)"\\s*:\\s*")${placeholder}(")`, "g");
    const before = updated;
    updated = updated.replace(pattern, `$1${plain}$2`);
    if (updated !== before) {
      fileHits += before.split(placeholder).length - 1;
    }
  }
  if (fileHits > 0) {
    writeFileSync(file, updated, "utf8");
    changedFiles += 1;
    replacements += fileHits;
    console.log(`  REWROTE   ${file.replace(ROOT, ".")} — ${fileHits} label(s)`);
  } else if (
    Object.values(CENSUS_PLACEHOLDER_LABELS).some((plain) => text.includes(plain))
  ) {
    alreadyClean += 1;
    console.log(`  ALREADY   ${file.replace(ROOT, ".")}`);
  } else {
    console.log(`  NO_MATCH  ${file.replace(ROOT, ".")} — placeholder not present`);
  }
}

console.log("");
console.log(
  `${replacements} label(s) rewritten across ${changedFiles} file(s); ${alreadyClean} already normalized.`,
);

if (changedFiles === 0 && alreadyClean === 0) {
  console.error(
    "nothing was rewritten and nothing was already normalized — this edit edited nothing, which is a failure, not a clean run",
  );
  process.exit(1);
}
