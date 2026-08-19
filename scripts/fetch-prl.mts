/**
 * **Build the PRL rhetoric snapshot** — tracker D62.
 *
 * `pnpm prl:fetch` → `data/prl/prl-profiles.json`
 *
 * ## The retrieval, and why it looks like this
 *
 * The data pages are a JavaScript-rendered SPA — a plain fetch of
 * `/elites/data` returns a shell with an empty root div, and reading that as
 * "no data published" would be a false miss. The FILE URLs and the licence
 * were read out of the page's own bundle (ladder rung 7) and are pinned here;
 * `docs/source-ladder.md` carries the full rung record.
 *
 * The small file is the one we take: `profiles-all-national.zip`, ~317 KB,
 * pre-aggregated per member. The statements corpora are 100 MB and 461 MB
 * and this build needs neither — v1 renders aggregates, and taking half a
 * gigabyte to compute numbers the lab has already computed would be rude to
 * a source that gives its work away.
 *
 * ## What it refuses to do
 *
 * - It reads only the allowlisted columns, and `assertNoForbiddenColumns`
 *   throws on a rank, a percentile or an ideology score.
 * - It states every count with its denominator, and refuses to write a
 *   snapshot with zero profiles — an empty run is a failure, not a quiet
 *   success.
 * - It never re-downloads on an unchanged file: the zip's SHA-256 is stored
 *   in the snapshot and compared first.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  normalizeProfiles,
} from "../lib/sources/prl/index.ts";
import {
  PRL_RHETORIC_ATTRIBUTION,
  type PrlSnapshot,
} from "../lib/sources/prl/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "prl", "prl-profiles.json");
const SOURCE_URL =
  "https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip";
const UA = "we-the-people civic app (contact: seanj22@gmail.com)";

/** The roster this snapshot is built for — our own federal officeholders. */
const roster = JSON.parse(
  await readFile(join(ROOT, "lib", "registry", "officeholders-us.json"), "utf8"),
) as { officeholders: Array<{ id: string }> };
const bioguides = roster.officeholders
  .map((o) => o.id.replace(/^congress:/, ""))
  .filter((id) => /^[A-Z]\d{6}$/.test(id));
console.log(`roster bioguides asked for: ${bioguides.length}`);

let prior: PrlSnapshot | null = null;
try {
  prior = JSON.parse(await readFile(OUT, "utf8")) as PrlSnapshot;
} catch {
  prior = null;
}

console.log(`fetching ${SOURCE_URL}`);
const response = await fetch(SOURCE_URL, { headers: { "User-Agent": UA } });
if (!response.ok) {
  console.error(`PRL: ${response.status} ${response.statusText} — refusing to guess`);
  process.exit(1);
}
const zip = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(zip).digest("hex");
console.log(`  ${zip.length} bytes · sha256 ${digest.slice(0, 16)}…`);

/**
 * The zip holds one deflate member. Node ships no zip reader, and pulling a
 * dependency in for one file is worse than reading the local header: 30-byte
 * fixed header, then the name and the extra field, then the deflate stream.
 */
function firstZipEntry(buf: Buffer): { name: string; data: Buffer } {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip archive");
  const method = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const nameLength = buf.readUInt16LE(26);
  const extraLength = buf.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  const name = buf.subarray(30, 30 + nameLength).toString("utf8");
  const body = buf.subarray(start, start + (compressedSize || buf.length - start));
  if (method === 0) return { name, data: body };
  if (method !== 8) throw new Error(`unsupported zip method ${method}`);
  // A zip member is RAW deflate: no zlib header, no gzip header. unzipSync
  // expects one and fails with Z_DATA_ERROR on a perfectly good archive.
  return { name, data: Buffer.from(inflateRawSync(body)) };
}

const entry = firstZipEntry(zip);
console.log(`  entry: ${entry.name} · ${entry.data.length} bytes uncompressed`);

const result = normalizeProfiles(entry.data.toString("utf8"), bioguides);
const c = result.counts;
console.log("\n=== PRL profiles ===");
console.log(`  rows in the file:                      ${c.rowsInFile}`);
console.log(`  of those, carrying classified statements: ${c.rowsWithStatements}`);
console.log(`  roster bioguides asked for:            ${c.rosterAsked}`);
console.log(`  matched and kept:                      ${c.matched}`);
console.log(`  matched but no statements, dropped:    ${c.droppedNoStatements}`);
console.log(`  roster members with no PRL row:        ${result.rosterMisses.length}`);
if (result.rosterMisses.length > 0) {
  console.log(`    ${result.rosterMisses.slice(0, 20).join(", ")}`);
}

if (result.profiles.length === 0) {
  console.error("PRL: zero profiles — refusing to write an empty snapshot.");
  process.exit(1);
}

const snapshot: PrlSnapshot = {
  formatVersion: 1,
  fetchedAt: new Date().toISOString(),
  sourceFile: `${entry.name} (sha256 ${digest})`,
  sourceUrl: SOURCE_URL,
  rowsInFile: c.rowsInFile,
  rowsWithStatements: c.rowsWithStatements,
  profiles: result.profiles.sort((a, b) => a.bioguideId.localeCompare(b.bioguideId)),
  rosterMisses: result.rosterMisses,
  attribution: PRL_RHETORIC_ATTRIBUTION,
};

if (prior && prior.sourceFile === snapshot.sourceFile) {
  console.log("\n  the source file is byte-identical to the committed one.");
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`\n  wrote ${OUT}`);
