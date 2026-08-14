/**
 * Build the device-local street index for the narrowing prompt — M26/4.6.3c.
 *
 * `pnpm streets:build`
 *
 * Census TIGER ADDRFEAT (address-range feature edges) per covered county:
 * every street edge carries its street name (FULLNAME) and the zip on each
 * side (LZIP/RZIP). Each edge's midpoint is resolved against the committed
 * registry geometry to the municipal government and school district covering
 * it, and the result aggregates per (zip, street).
 *
 * Output, per ambiguous zip: `public/streets/<zip>.json` — a small static
 * file the client fetches and matches AGAINST ON THE DEVICE. The reader's
 * street never leaves their browser; the only thing the server ever sees is
 * the zip-level file request, which reveals nothing the map didn't already
 * know. Plus `lib/registry/street-index-summary.json`: per-zip counts, which
 * is what makes the prompt's counts computed and the ambiguity trigger
 * checkable ("no prompt where the answer would not change").
 *
 * The run reports edges read / resolved / dropped per county, and refuses
 * to write a zip file with zero streets — the count invariant.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import { divisionsAt } from "../lib/registry/server.ts";
import registryJson from "../lib/registry/registry.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "streets");
const SUMMARY = join(ROOT, "lib", "registry", "street-index-summary.json");
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

const COUNTIES = ["04019", "34027", "33013"];

// Which municipal divisions actually govern: the registry's GOVERNING body
// rows are the derivation's answer — never re-derived here.
const governingMunicipal = new Set(
  (registryJson as { bodies: { ocdId: string; bodyClass: string }[] }).bodies
    .filter((b) => b.bodyClass === "GOVERNING")
    .map((b) => b.ocdId),
);

// ---- minimal zip/dbf/polyline-shp readers (self-contained on purpose) ----
function extractAll(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString();
    const method = zip.readUInt16LE(offset + 10);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function parseDbf(buf: Buffer): Record<string, string>[] {
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);
  const fields: { name: string; length: number }[] = [];
  for (let off = 32; off < headerSize - 1; off += 32) {
    const name = buf
      .subarray(off, off + 11)
      .toString("ascii")
      .replace(/\0.*$/, "");
    fields.push({ name, length: buf[off + 16] });
  }
  const rows: Record<string, string>[] = [];
  const recordCount = buf.readUInt32LE(4);
  for (let i = 0; i < recordCount; i++) {
    const base = headerSize + i * recordSize + 1;
    const row: Record<string, string> = {};
    let cursor = base;
    for (const field of fields) {
      row[field.name] = buf
        .subarray(cursor, cursor + field.length)
        .toString("latin1")
        .trim();
      cursor += field.length;
    }
    rows.push(row);
  }
  return rows;
}

/** Polyline SHP (type 3): one midpoint per record. */
function parseMidpoints(buf: Buffer): ([number, number] | null)[] {
  const midpoints: ([number, number] | null)[] = [];
  let offset = 100;
  while (offset < buf.length) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const shapeType = buf.readInt32LE(offset + 8);
    if (shapeType === 3 || shapeType === 13) {
      const numParts = buf.readInt32LE(offset + 44);
      const numPoints = buf.readInt32LE(offset + 48);
      const pointsStart = offset + 52 + numParts * 4;
      const mid = Math.floor(numPoints / 2);
      const x = buf.readDoubleLE(pointsStart + mid * 16);
      const y = buf.readDoubleLE(pointsStart + mid * 16 + 8);
      midpoints.push([x, y]);
    } else {
      midpoints.push(null);
    }
    offset += 8 + contentLength;
  }
  return midpoints;
}

// ---- build ---------------------------------------------------------------
interface ZipEntry {
  municipalities: Map<string, string>;
  schoolDistricts: Map<string, string>;
  streets: Map<string, { muni: Set<string>; school: Set<string> }>;
}

const byZip = new Map<string, ZipEntry>();
const resolveCache = new Map<string, { muni: [string, string][]; school: [string, string][] }>();

for (const county of COUNTIES) {
  const url = `https://www2.census.gov/geo/tiger/TIGER2025/ADDRFEAT/tl_2025_${county}_addrfeat.zip`;
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const files = extractAll(zip);
  const dbfName = [...files.keys()].find((n) => n.endsWith(".dbf"))!;
  const shpName = [...files.keys()].find((n) => n.endsWith(".shp"))!;
  const rows = parseDbf(files.get(dbfName)!);
  const midpoints = parseMidpoints(files.get(shpName)!);

  let resolved = 0;
  let dropped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const midpoint = midpoints[i];
    const name = row.FULLNAME?.trim();
    if (!midpoint || !name) {
      dropped++;
      continue;
    }
    const zips = [row.ZIPL, row.ZIPR].filter((z) => /^\d{5}$/.test(z ?? ""));
    if (zips.length === 0) {
      dropped++;
      continue;
    }

    // Grid-cache the resolution: neighbouring edges share districts, and a
    // ~200 m cell keeps the point-in-polygon cost linear in area, not edges.
    const cacheKey = `${midpoint[0].toFixed(3)},${midpoint[1].toFixed(3)}`;
    let hit = resolveCache.get(cacheKey);
    if (!hit) {
      const divisions = await divisionsAt(midpoint[1], midpoint[0]);
      hit = {
        // Subdivision-derived municipalities are typed "place" in the
        // registry, so one check covers both layers.
        muni: divisions
          .filter(
            (d) => d.divisionType === "place" && governingMunicipal.has(d.ocdId),
          )
          .map((d) => [d.ocdId, d.label] as [string, string]),
        school: divisions
          .filter((d) => d.divisionType === "school_district")
          .map((d) => [d.ocdId, d.label] as [string, string]),
      };
      resolveCache.set(cacheKey, hit);
    }
    resolved++;

    const streetKey = name.toUpperCase();
    for (const zipCode of new Set(zips)) {
      let entry = byZip.get(zipCode);
      if (!entry) {
        entry = {
          municipalities: new Map(),
          schoolDistricts: new Map(),
          streets: new Map(),
        };
        byZip.set(zipCode, entry);
      }
      let street = entry.streets.get(streetKey);
      if (!street) {
        street = { muni: new Set(), school: new Set() };
        entry.streets.set(streetKey, street);
      }
      for (const [ocdId, label] of hit.muni) {
        entry.municipalities.set(ocdId, label);
        street.muni.add(ocdId);
      }
      for (const [ocdId, label] of hit.school) {
        entry.schoolDistricts.set(ocdId, label);
        street.school.add(ocdId);
      }
    }
  }

  console.log(
    `${county}: ${rows.length} edges — ${resolved} resolved, ${dropped} dropped (no name/midpoint/zip)`,
  );
}

// ---- emit ----------------------------------------------------------------
await mkdir(OUT_DIR, { recursive: true });
const generatedAt = new Date().toISOString();
const summary: Record<
  string,
  { municipalities: number; schoolDistricts: number; streets: number }
> = {};
let written = 0;

for (const [zipCode, entry] of [...byZip.entries()].sort()) {
  const municipalityCount = entry.municipalities.size;
  const schoolCount = entry.schoolDistricts.size;
  // The computed ambiguity trigger: no file — and no prompt — where the
  // answer would not change what is listed.
  if (municipalityCount <= 1 && schoolCount <= 1) continue;
  if (entry.streets.size === 0) {
    throw new Error(`${zipCode}: ambiguous but zero streets — refusing to write`);
  }

  const municipalities = [...entry.municipalities.entries()].map(
    ([ocdId, label]) => ({ ocdId, label }),
  );
  const schoolDistricts = [...entry.schoolDistricts.entries()].map(
    ([ocdId, label]) => ({ ocdId, label }),
  );
  const muniIndex = new Map(municipalities.map((m, i) => [m.ocdId, i]));
  const schoolIndex = new Map(schoolDistricts.map((s, i) => [s.ocdId, i]));

  const streets: Record<string, { m: number[]; s: number[] }> = {};
  for (const [name, street] of [...entry.streets.entries()].sort()) {
    streets[name] = {
      m: [...street.muni].map((id) => muniIndex.get(id)!).sort((a, b) => a - b),
      s: [...street.school]
        .map((id) => schoolIndex.get(id)!)
        .sort((a, b) => a - b),
    };
  }

  await writeFile(
    join(OUT_DIR, `${zipCode}.json`),
    JSON.stringify(
      {
        zip: zipCode,
        generatedAt,
        source:
          "U.S. Census Bureau TIGER/Line 2025 ADDRFEAT (street edges with zip on each side); midpoints resolved against the committed registry geometry",
        municipalities,
        schoolDistricts,
        streets,
      },
      null,
      0,
    ),
  );
  summary[zipCode] = {
    municipalities: municipalityCount,
    schoolDistricts: schoolCount,
    streets: entry.streets.size,
  };
  written++;
}

await writeFile(
  SUMMARY,
  JSON.stringify({ generatedAt, zips: summary }, null, 1) + "\n",
);

console.log(
  `${byZip.size} zips seen, ${written} ambiguous zips written to public/streets/, summary → ${SUMMARY}`,
);
console.log(
  `85641: ${JSON.stringify(summary["85641"] ?? "not ambiguous")} · 07866: ${JSON.stringify(summary["07866"] ?? "not ambiguous")}`,
);
if (written === 0) {
  console.error("zero ambiguous zips written — that is a finding, check the resolution");
  process.exit(1);
}
