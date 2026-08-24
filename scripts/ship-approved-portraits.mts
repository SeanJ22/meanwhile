/**
 * `pnpm ship:approved` — ship portraits Sean has APPROVED into the registry.
 *
 * ## What this is for
 *
 * A portrait reaches a reader only after four things have happened: it was
 * found, it was READ AS AN IMAGE, Sean said yes, and somebody wrote it into the
 * registry. The fourth step had no tool. `NH78`'s seven Morris County
 * commissioner portraits sat sourced, eyeballed and recorded in an evidence
 * file from 2026-08-23 with **one of the seven shipped**, because shipping the
 * other six was hand work nobody had a command for.
 *
 * So this is the command. It takes an APPROVAL FILE — the decision, the asset,
 * the door and the attribution — fetches each image, strips its metadata,
 * verifies it is really an image, writes it beside our own origin and updates
 * `lib/registry/official-photos.json`.
 *
 * ## The disciplines it carries, because a tool is where a rule actually lives
 *
 * - **A 200 that is not the thing is not a document.** Every fetch is checked
 *   for real image magic bytes; a host answering 200 with an HTML error page is
 *   a REFUSAL naming what it saw.
 * - **A row is never silently lost.** The registry row count is reported before
 *   and after, and a fall refuses (the same guard `NH118` needed).
 * - **A miss row is retired when its portrait ships**, so the two sides cannot
 *   both claim the same person.
 * - **EXIF is stripped**, per the photo rule, at every door.
 * - **The date is a READ STAMP** (RULING 107) — it names the day the bytes were
 *   actually fetched, never a clock call standing in for one.
 *
 * ## `@freshness-reads-here`
 *
 * **This file stamps `collectedAt` from the clock, and that is legitimate here
 * because the clock sits INSIDE the reading path** (RULING 107). Every row it
 * writes is stamped in the same iteration that just fetched those bytes over
 * the network, verified them as a real image and stripped their metadata — so
 * the date names the day somebody genuinely read the source, which is what a
 * read stamp means.
 *
 * The carve-out is DECLARED rather than inferred, because a carve-out nobody
 * has to write down is a carve-out that grows. What RULING 107 forbids is a
 * program printing today's date over a value it did not re-read; nothing here
 * carries a date forward from an earlier run.
 *
 * Usage:
 *   pnpm ship:approved data/photos/approved-<date>.json [--dry]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { stripImageMetadata } from "./strip-image-metadata.mts";

interface Approval {
  officeholderId: string;
  name: string;
  imageUrl: string;
  pageUrl: string;
  fileName: string;
  attribution: string;
  basis: string;
  door: string;
  judgment: string;
  approvedBy: string;
  approvedOn: string;
}

const ROOT = process.cwd();
const FILE = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!FILE) {
  console.error("usage: pnpm ship:approved <approval-file.json> [--dry]");
  process.exit(2);
}

const approvals = JSON.parse(readFileSync(join(ROOT, FILE), "utf8")) as {
  note: string;
  approvals: Approval[];
};
const MANIFEST = join(ROOT, "lib", "registry", "official-photos.json");
const registry = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  generatedAt: string;
  photos: Record<string, unknown>[];
  missing: Record<string, unknown>[];
};

const priorPhotos = registry.photos.length;
const priorMissing = registry.missing.length;

/** Real image, or it is not an image whatever the Content-Type said. */
const looksLikeImage = (b: Buffer): string | null => {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
};

let shipped = 0;
let refused = 0;
let alreadyThere = 0;
const refusals: string[] = [];

for (const a of approvals.approvals) {
  if (registry.photos.some((p) => p.officeholderId === a.officeholderId)) {
    alreadyThere += 1;
    console.log(`  ALREADY  ${a.officeholderId.padEnd(20)} ${a.name}`);
    continue;
  }

  let raw: Buffer;
  try {
    const response = await fetch(a.imageUrl, {
      headers: { "user-agent": "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)" },
    });
    if (!response.ok) {
      refused += 1;
      refusals.push(`${a.name}: HTTP ${response.status} at ${a.imageUrl}`);
      console.log(`  REFUSED  ${a.name} — HTTP ${response.status}`);
      continue;
    }
    raw = Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    refused += 1;
    refusals.push(`${a.name}: ${(cause as Error).message}`);
    console.log(`  REFUSED  ${a.name} — ${(cause as Error).message}`);
    continue;
  }

  const kind = looksLikeImage(raw);
  if (!kind) {
    refused += 1;
    const head = raw.subarray(0, 60).toString("utf8").replace(/\s+/g, " ");
    refusals.push(`${a.name}: ${raw.length} bytes that are not an image — starts "${head}"`);
    console.log(`  REFUSED  ${a.name} — 200 carrying ${raw.length} bytes that are not an image`);
    continue;
  }

  const { bytes, stripped } = stripImageMetadata(raw);
  if (!stripped) {
    refused += 1;
    refusals.push(`${a.name}: ${kind} could not be certified metadata-free`);
    console.log(`  REFUSED  ${a.name} — could not strip metadata`);
    continue;
  }

  const outDir = join(ROOT, "public", "officials");
  if (!DRY) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, a.fileName), bytes);
  }

  registry.photos.push({
    officeholderId: a.officeholderId,
    name: a.name,
    url: `/officials/${a.fileName}`,
    sourceUrl: a.pageUrl,
    license: `Official portrait published by ${a.attribution} (${a.pageUrl}) — used under the ${a.door} basis with attribution and remove-on-request; no licence claimed.`,
    attribution: a.attribution,
    basis: a.basis,
    judgment: a.judgment,
    approvedBy: a.approvedBy,
    approvedOn: a.approvedOn,
    /*
     * A READ STAMP: today is the day these bytes were actually fetched, by this
     * code path, in this run. RULING 107 — a freshness date is written only by
     * the code that performed the read.
     */
    collectedAt: new Date().toISOString(),
  });
  // The person is no longer a miss. Both sides may not claim them at once.
  registry.missing = registry.missing.filter((m) => m.officeholderId !== a.officeholderId);
  shipped += 1;
  console.log(`  SHIPPED  ${a.officeholderId.padEnd(20)} ${a.name}  ${bytes.length} bytes (${kind})`);
}

console.log("");
console.log(`SHIP APPROVED${DRY ? " (DRY — nothing written)" : ""}`);
console.log(`  approvals in file:  ${approvals.approvals.length}`);
console.log(`  shipped:            ${shipped}`);
console.log(`  already in registry:${alreadyThere}`);
console.log(`  REFUSED:            ${refused}`);
for (const r of refusals) console.log(`     ${r}`);
console.log(`  registry photos:    ${priorPhotos} → ${registry.photos.length}`);
console.log(`  registry misses:    ${priorMissing} → ${registry.missing.length}`);

if (registry.photos.length < priorPhotos) {
  console.error("REFUSED: the registry shrank. A row is never silently lost.");
  process.exit(1);
}
if (!DRY) {
  writeFileSync(MANIFEST, JSON.stringify(registry, null, 2) + "\n");
  const back = JSON.parse(readFileSync(MANIFEST, "utf8")) as { photos: unknown[] };
  console.log(`  re-read:            ${back.photos.length} row(s)`);
  if (back.photos.length !== registry.photos.length) {
    console.error("REFUSED: the registry did not read back with the same row count.");
    process.exit(1);
  }

  /*
   * **THE DERIVATIVE IS REGENERATED HERE, NOT IN A SECOND COMMAND.**
   * (RULING 102 — fixing a generator is not finished until its output is
   * regenerated; RULING 113 — observe the step's product at the step.)
   *
   * `lib/registry/roster-photos.json` is the tiny client-safe map the roster
   * surfaces read. Shipping six commissioner portraits into the manifest and
   * leaving this stale meant the manifest said they existed and the surface
   * could not see them — caught by `tests/officials-surface.test.ts`, which is
   * the guard working, and which would have been a red suite for somebody else
   * to puzzle over if it had not run here.
   */
  const rosterPhotos: Record<string, string> = {};
  for (const p of registry.photos) {
    const id = p.officeholderId as string;
    if (id.startsWith("roster:") && p.license) rosterPhotos[id] = p.url as string;
  }
  const ROSTER = join(ROOT, "lib", "registry", "roster-photos.json");
  const priorRoster = Object.keys(
    JSON.parse(readFileSync(ROSTER, "utf8")) as Record<string, string>,
  ).length;
  writeFileSync(ROSTER, JSON.stringify(rosterPhotos, null, 2) + "\n");
  console.log(
    `  roster derivative:  ${priorRoster} → ${Object.keys(rosterPhotos).length} entries`,
  );
}
if (refused > 0) process.exit(1);
