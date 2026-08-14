/**
 * Download portraits for the wired officials — D20, un-suspended 2026-08-14
 * for exactly the people the four-zip surface renders.
 *
 * `pnpm officials:photos`
 *
 * Federal only, deliberately: the `unitedstates/images` collection republishes
 * the GPO Congressional Pictorial Directory portraits, which are U.S. federal
 * government works in the public domain — a license we can state per image.
 * Congress.gov's `depiction` fallback is NOT used: its attribution reads
 * "Image courtesy of the Member", which is a member-provided image of unknown
 * license, and D20's rule is that unknown is not clearable — such an official
 * renders as initials until the pictorial directory carries them.
 *
 * State legislature portraits need a per-state terms hunt (recorded in
 * docs/source-ladder.md) and are not fetched yet.
 *
 * Images are committed and served from our origin — a hotlink makes the
 * reader's browser announce itself to a third party. The manifest records
 * source and license per image; the missing list records who was tried and
 * not shipped, with the reason, so an absence is a documented state.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { coverageAt } from "../lib/registry/server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "officials");
const MANIFEST = join(ROOT, "lib", "registry", "official-photos.json");

const ZIPS: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

const SOURCE_BASE = "https://unitedstates.github.io/images/congress/450x550";
const LICENSE =
  "Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images)";

interface PhotoRecord {
  officeholderId: string;
  name: string;
  /** Path on our origin. */
  url: string;
  sourceUrl: string;
  license: string;
  attribution: string | null;
  collectedAt: string;
}

interface MissingRecord {
  officeholderId: string;
  name: string;
  reason: string;
  attemptedAt: string;
}

const wired = new Map<string, string>();
for (const [, [lat, lng]] of Object.entries(ZIPS)) {
  const c = await coverageAt(lat, lng, 1);
  for (const s of c.seats)
    for (const r of s.representatives) wired.set(r.id, r.name);
  for (const r of c.senators) wired.set(r.id, r.name);
}

const federal = [...wired.entries()].filter(([id]) =>
  id.startsWith("congress:"),
);
const state = [...wired.entries()].filter(([id]) => id.startsWith("plural:"));

console.log(
  `${wired.size} wired officials across ${Object.keys(ZIPS).length} zips — ${federal.length} federal (fetching), ${state.length} state (terms hunt pending, not fetched)`,
);

await mkdir(OUT_DIR, { recursive: true });

const photos: PhotoRecord[] = [];
const missing: MissingRecord[] = [];
const now = new Date().toISOString();

// Serialized, identified — the public-records fetch discipline.
for (const [id, name] of federal) {
  const bioguide = id.slice("congress:".length);
  const sourceUrl = `${SOURCE_BASE}/${bioguide}.jpg`;
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent":
        "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)",
    },
  });

  if (!response.ok) {
    missing.push({
      officeholderId: id,
      name,
      reason: `pictorial-directory image HTTP ${response.status}; Congress.gov depiction exists but is "Image courtesy of the Member" (unknown license — not shippable per D20)`,
      attemptedAt: now,
    });
    console.log(`  MISS ${bioguide} ${name} — ${response.status}`);
    continue;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(OUT_DIR, `${bioguide}.jpg`), bytes);
  photos.push({
    officeholderId: id,
    name,
    url: `/officials/${bioguide}.jpg`,
    sourceUrl,
    license: LICENSE,
    attribution: null,
    collectedAt: now,
  });
  console.log(`  OK   ${bioguide} ${name} — ${Math.round(bytes.length / 1024)} KB`);
}

for (const [id, name] of state) {
  missing.push({
    officeholderId: id,
    name,
    reason:
      "state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md)",
    attemptedAt: now,
  });
}

await writeFile(
  MANIFEST,
  JSON.stringify({ generatedAt: now, photos, missing }, null, 2) + "\n",
);

console.log(
  `wrote ${photos.length} photos, ${missing.length} recorded absences → ${MANIFEST}`,
);
if (photos.length === 0) {
  console.error("zero photos fetched — that is a finding, check the source");
  process.exit(1);
}
