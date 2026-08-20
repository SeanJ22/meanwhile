/**
 * **The bridge between the two portrait numbers.** (F01-continued session 2,
 * item 0B, 2026-08-19.)
 *
 * `pnpm photo:reconcile`
 *
 * ## The defect this closes
 *
 * Two scripts count portraits and neither was wrong:
 *
 * * `scripts/photo-review.mts` counts the MANIFEST — the rows in
 *   `lib/registry/official-photos.json` — and asks of each *"can any surface
 *   reach this person?"*
 * * `scripts/photo-census.mts` counts the SLOTS — every person the product
 *   renders — and asks of each *"does this one have a portrait?"*
 *
 * F01-continued session 1 reported both and set them side by side as though
 * they partitioned the same 902: `531 + 23 + 348` against `591 + 311`. They
 * do not, and that is the whole of the 37 nobody could account for. **The
 * standing figure is not a subset of the manifest**: it counts people, it
 * includes ballot candidates whose portraits live in
 * `data/ballot/candidate-cards-2026.json` and never enter the manifest at
 * all, and `311` was only ever `902 − 591` — arithmetic across two
 * populations, which is the same class of defect as a join reporting a 100%
 * match rate while every match points at one row.
 *
 * So this script computes the bridge instead of asserting it: it walks both
 * universes, intersects them by id, and prints every crossing term. Nothing
 * here is a new count — it is the ledger that makes the existing two
 * reconcile.
 *
 * COUNT ONLY. Fetches nothing, writes no data file.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { COVERED, rosterFile } from "../lib/coverage/artifacts.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { photoTotals } from "../lib/coverage/photo-slots.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// ── The manifest universe ───────────────────────────────────────────────
const manifest = read("lib/registry/official-photos.json") as {
  photos: { officeholderId: string; name: string; license: string | null }[];
};

// ── The reach map, read exactly as photo-review.mts builds it ───────────
const divisionReached = new Set<string>();
for (const file of [
  "lib/registry/officeholders-us.json",
  ...COVERED.map((s) => `lib/registry/${rosterFile(s)}`),
]) {
  const parsed = read(file) as { divisions?: { officeholderId: string }[] };
  for (const seat of parsed.divisions ?? []) divisionReached.add(seat.officeholderId);
}
const rosterPhotoIds = new Set<string>(
  Object.keys(read("lib/registry/roster-photos.json") as Record<string, unknown>),
);
const statewideIds = new Set(STATEWIDE_EXECUTIVES.map((e) => e.holder.id));

// ── The slot universe, from the one module that walks the surfaces ─────
const totals = photoTotals(ROOT);

// ── The ledger ──────────────────────────────────────────────────────────
const collected = manifest.photos.length;
const viaDivision = manifest.photos.filter((p) =>
  divisionReached.has(p.officeholderId),
).length;
const viaRoster = manifest.photos.filter(
  (p) => !divisionReached.has(p.officeholderId) && rosterPhotoIds.has(p.officeholderId),
).length;
const viaStatewide = manifest.photos.filter(
  (p) =>
    !divisionReached.has(p.officeholderId) &&
    !rosterPhotoIds.has(p.officeholderId) &&
    statewideIds.has(p.officeholderId),
).length;
const reachable = viaDivision + viaRoster + viaStatewide;
const unreachable = collected - reachable;

/** The crossing term: manifest rows a rendered slot actually draws. */
const drawnIds = new Set(
  totals.slots
    .filter((s) => s.hasPortrait && s.portraitFrom === "manifest" && s.id)
    .map((s) => s.id as string),
);
const manifestDrawn = manifest.photos.filter((p) => drawnIds.has(p.officeholderId)).length;
const reachableNotDrawn = manifest.photos.filter(
  (p) =>
    (divisionReached.has(p.officeholderId) ||
      rosterPhotoIds.has(p.officeholderId) ||
      statewideIds.has(p.officeholderId)) &&
    !drawnIds.has(p.officeholderId),
);
const drawnNotReachable = manifest.photos.filter(
  (p) =>
    drawnIds.has(p.officeholderId) &&
    !divisionReached.has(p.officeholderId) &&
    !rosterPhotoIds.has(p.officeholderId) &&
    !statewideIds.has(p.officeholderId),
);

console.log("=== the two portrait universes, and the bridge between them ===\n");

console.log("MANIFEST SIDE — lib/registry/official-photos.json");
console.log(`  collected (rows)                       ${collected}`);
console.log(`  — reachable via a division mapping     ${viaDivision}`);
console.log(`  — reachable via a curated body roster  ${viaRoster}`);
console.log(`  — reachable via the who-governs card   ${viaStatewide}`);
console.log(`  — reachable by nobody                  ${unreachable}`);
console.log(`  reachable total                        ${reachable}`);
console.log(
  `  partition sums                         ${reachable + unreachable} === ${collected}: ${
    reachable + unreachable === collected
  }\n`,
);

console.log("SLOT SIDE — every person the product renders");
console.log(`  people rendered                        ${totals.people}`);
console.log(`  — with a portrait  (STANDING FIGURE)   ${totals.rendered}`);
console.log(`  — rendering initials                   ${totals.initials}\n`);

console.log("THE BRIDGE — where each rendered portrait's FILE actually is");
console.log(`  manifest                               ${totals.fromManifest}`);
console.log(`  candidate-cards                        ${totals.fromCandidateCards}`);
console.log(`  inline on the officeholder             ${totals.fromInline}`);
console.log(`                                         ----`);
console.log(`  rendered portraits, total              ${totals.rendered}\n`);

console.log("THE CROSSING, AND WHETHER IT CLOSES");
console.log(`  manifest rows a rendered slot draws    ${manifestDrawn}`);
console.log(`  manifest rows reachable but not drawn  ${reachableNotDrawn.length}`);
console.log(`  manifest rows drawn but not reachable  ${drawnNotReachable.length}`);
console.log(
  `\n  ${totals.rendered} rendered = ${totals.fromManifest} manifest-drawn + ` +
    `${totals.fromCandidateCards} candidate-card + ${totals.fromInline} inline`,
);
console.log(`  ${reachable} reachable  vs  ${manifestDrawn} drawn  —  difference ${reachable - manifestDrawn}`);
console.log(
  `  the old unexplained gap: ${totals.rendered} - ${reachable} = ${totals.rendered - reachable}` +
    `, and it is ${totals.fromCandidateCards} candidate-card portraits + ${totals.fromInline} inline.`,
);

for (const [label, rows] of [
  ["reachable but NOT drawn", reachableNotDrawn],
  ["drawn but NOT reachable", drawnNotReachable],
] as const) {
  console.log(`\n  ${label}: ${rows.length}`);
  for (const row of rows) {
    const slot = totals.slots.find((s) => s.id === row.officeholderId);
    console.log(
      `    ${row.name} — ${slot ? slot.surface : "no rendered slot"} (${row.officeholderId})`,
    );
  }
}

const closes =
  reachableNotDrawn.length === 0 &&
  drawnNotReachable.length === 0 &&
  totals.rendered === manifestDrawn + totals.fromCandidateCards + totals.fromInline;
console.log(`\n  LEDGER CLOSES WITH NO RESIDUE: ${closes}`);
if (!closes) process.exitCode = 1;
