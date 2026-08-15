/**
 * One-time data repair for mojibake in committed stores (M60, 2026-08-15).
 *
 * `pnpm tsx scripts/repair-mojibake.mts [--dry]`
 *
 * Not a pipeline step and not scheduled. The pipelines that produce these
 * files were fixed at their own source — the street index now reads TIGER's
 * DBFs as UTF-8 instead of latin1, and the HTML extractor repairs the
 * double-encoded bytes Diligent's portal actually serves. This exists for the
 * rows already on disk, which nothing re-derives: an agenda document is never
 * re-fetched while its `contentHash` is unchanged, and the candidate cards
 * are hand-curated.
 *
 * It refuses to write unless the repair accounts for itself: every sequence
 * gone, the recovered characters counted, and the record counts unchanged.
 * A repair script that can quietly damage data is worse than the mojibake.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findMojibake, repairMojibake } from "../lib/text/mojibake.ts";

const ROOT = join(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

/** Files whose stored text is repaired in place. */
const TARGETS = [
  "data/ballot/candidate-cards-2026.json",
  "data/meetings-snapshot.json",
];

let totalFixed = 0;
for (const rel of TARGETS) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, "utf8");
  const hitsBefore = findMojibake(before).length;

  if (hitsBefore === 0) {
    console.log(`${rel}: clean`);
    continue;
  }

  const after = repairMojibake(before);
  const hitsAfter = findMojibake(after).length;

  // The invariants. An operation that can do nothing must be asked what it
  // did, and a repair that can damage must be asked what it damaged.
  if (hitsAfter !== 0) {
    throw new Error(`${rel}: ${hitsAfter} sequences survived the repair`);
  }
  if (after.includes("�") && !before.includes("�")) {
    throw new Error(`${rel}: the repair produced replacement characters`);
  }
  const parsedBefore = JSON.parse(before) as unknown;
  const parsedAfter = JSON.parse(after) as unknown;
  const shape = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.length}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v).length}}`
        : typeof v;
  if (shape(parsedBefore) !== shape(parsedAfter)) {
    throw new Error(`${rel}: the document's shape changed`);
  }

  console.log(
    `${rel}: ${hitsBefore} sequences repaired, ${before.length - after.length} characters recovered`,
  );
  totalFixed += hitsBefore;
  if (DRY) {
    console.log("  (dry run, not written)");
  } else {
    writeFileSync(path, after);
    console.log("  written");
  }
}

console.log(
  `\n${totalFixed} mojibake sequences ${DRY ? "would be " : ""}repaired across ${TARGETS.length} files`,
);
