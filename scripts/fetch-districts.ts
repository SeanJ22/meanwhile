/**
 * Build public/geo/cd119.geojson from the Census cartographic boundary file
 * for the 119th Congress.
 *
 *   pnpm districts:fetch
 *
 * CLAUDE.md names TIGER/Line for district boundaries. This uses the
 * *cartographic boundary* release instead — the same Census source and the
 * same geography, generalized to 1:500,000. Full-resolution TIGER/Line is
 * roughly an order of magnitude larger and is built for spatial joins, not for
 * shipping to a browser. The tradeoff is recorded in docs/state.md §4.
 *
 * The file this writes is committed, the way lib/geo/zcta-centroids.json is.
 * Rerun when Census publishes a new vintage; the diff shows what moved.
 *
 * Dependency-free on purpose, matching scripts/fetch-zcta-centroids.ts: a
 * minimal ZIP reader, a minimal DBF reader, and a minimal shapefile reader.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { gzipSync, inflateRawSync } from "node:zlib";

import { districtIdentity } from "../lib/ocd/fips.ts";

const VINTAGE = "2025";
const CONGRESS = "119";
const SOURCE_URL = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp/cb_${VINTAGE}_us_cd${CONGRESS}_500k.zip`;
const SOURCE_ORG = "U.S. Census Bureau";

/**
 * Coordinate grid, in decimal degrees. 4 places is about 11 m, finer than a
 * generalized 1:500,000 boundary can honestly claim, and it is what makes the
 * simplification below topology-safe: two districts sharing a border round
 * their shared vertices to identical values.
 */
const QUANTIZE_DECIMALS = Number(process.env.DISTRICTS_QUANTIZE ?? 4);

/**
 * Drop a vertex when it sits closer than this to the straight line between its
 * neighbours. Degrees; 0.0001 is roughly 11 m.
 *
 * Override these to sweep for a tolerance while tuning, without re-downloading:
 *   DISTRICTS_KEEP_ZIP=1 DISTRICTS_TOLERANCE=0.002 pnpm districts:fetch
 */
const SIMPLIFY_TOLERANCE_DEG = Number(process.env.DISTRICTS_TOLERANCE ?? 0.0018);

/** How many simplification passes to run. */
const SIMPLIFY_PASSES = Number(process.env.DISTRICTS_PASSES ?? 8);

/** Keep the downloaded archive so a tuning sweep does not re-download it. */
const KEEP_ZIP = process.env.DISTRICTS_KEEP_ZIP === "1";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, "..", "public", "geo", "cd119.geojson");
const TMP_ZIP = join(here, "..", ".districts-download.zip");

/* ------------------------------------------------------------------ zip --- */

/** Every entry in the archive, by filename. */
function extractAll(zip: Buffer): Map<string, Buffer> {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;

  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("Not a zip archive: no end-of-central-directory record.");
  }

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  const files = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt zip: central directory entry ${i} has a bad signature.`);
    }

    const compressionMethod = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("latin1");

    if (zip.readUInt32LE(localHeaderOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt zip: local header signature mismatch for ${name}.`);
    }

    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) files.set(name, Buffer.from(data));
    else if (compressionMethod === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported compression method ${compressionMethod} for ${name}.`);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/* ------------------------------------------------------------------ dbf --- */

/** Attribute table rows, as strings. Numeric coercion is the caller's job. */
function parseDbf(buf: Buffer): Record<string, string>[] {
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);

  const fields: { name: string; length: number }[] = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buf[offset] === 0x0d) break;
    const name = buf
      .subarray(offset, offset + 11)
      .toString("latin1")
      .replace(/\0.*$/, "")
      .trim();
    fields.push({ name, length: buf[offset + 16] });
  }

  const rows: Record<string, string>[] = [];
  for (let r = 0; r < recordCount; r++) {
    const start = headerLength + r * recordLength;
    // First byte is the deletion flag; 0x2a marks a deleted record.
    if (buf[start] === 0x2a) continue;

    let cursor = start + 1;
    const row: Record<string, string> = {};
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

/* ------------------------------------------------------------------ shp --- */

type Ring = [number, number][];
/** One polygon: exterior ring first, then any holes. */
type Polygon = Ring[];

/**
 * Signed area by the shoelace formula. Positive is counter-clockwise.
 * Shapefiles wind exterior rings clockwise and holes counter-clockwise, so
 * this sign test is what tells an outer ring from a hole.
 */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

/** Polygon geometries, one entry per shapefile record, in file order. */
function parseShp(buf: Buffer): Polygon[][] {
  const shapes: Polygon[][] = [];
  let offset = 100; // file header

  while (offset < buf.length) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    const shapeType = buf.readInt32LE(content);

    // 0 is a null shape; 5 is Polygon. Nothing else appears in a cb_ cd file.
    if (shapeType === 0) {
      shapes.push([]);
      offset = content + contentLength;
      continue;
    }
    if (shapeType !== 5) {
      throw new Error(`Unexpected shape type ${shapeType} at byte ${content}.`);
    }

    const numParts = buf.readInt32LE(content + 36);
    const numPoints = buf.readInt32LE(content + 40);
    const partsStart = content + 44;
    const pointsStart = partsStart + numParts * 4;

    const partIndex: number[] = [];
    for (let p = 0; p < numParts; p++) {
      partIndex.push(buf.readInt32LE(partsStart + p * 4));
    }

    const rings: Ring[] = [];
    for (let p = 0; p < numParts; p++) {
      const from = partIndex[p];
      const to = p + 1 < numParts ? partIndex[p + 1] : numPoints;
      const ring: Ring = [];
      for (let i = from; i < to; i++) {
        const at = pointsStart + i * 16;
        ring.push([buf.readDoubleLE(at), buf.readDoubleLE(at + 8)]);
      }
      rings.push(ring);
    }

    // A clockwise ring (negative area) opens a new polygon; counter-clockwise
    // rings are holes belonging to the polygon that opened before them.
    const polygons: Polygon[] = [];
    for (const ring of rings) {
      if (signedArea(ring) < 0 || polygons.length === 0) polygons.push([ring]);
      else polygons[polygons.length - 1].push(ring);
    }

    shapes.push(polygons);
    offset = content + contentLength;
  }

  return shapes;
}

/* ------------------------------------------------------- simplification --- */

const key = (p: [number, number]) => `${p[0]},${p[1]}`;

function quantizeRing(ring: Ring): Ring {
  const f = 10 ** QUANTIZE_DECIMALS;
  const out: Ring = [];
  for (const [x, y] of ring) {
    const q: [number, number] = [Math.round(x * f) / f, Math.round(y * f) / f];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  // Keep the ring closed.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  }
  return out;
}

/** Perpendicular distance from p to the line through a and b, in degrees. */
function deviation(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** A ring below this many vertices is left alone; the saving is not worth the risk. */
const MIN_RING_VERTICES = 12;

/**
 * Drop vertices that add no shape, without opening gaps between neighbours.
 *
 * The decision is made once per *vertex*, globally, not once per ring. Every
 * ring that contains a vertex votes on whether it could be dropped, and it is
 * removed only if all of them agree. A district can therefore never shed a
 * point that its neighbour keeps, which is the only way a sliver opens along a
 * shared border — and it holds at any tolerance, rather than only at tolerances
 * small enough that the two sides happen not to disagree.
 *
 * Pinned vertices (arc endpoints and junctions) always vote no, as does every
 * vertex of a ring too small to simplify safely.
 */
function simplifyGlobally(
  rings: Ring[],
  pinned: Set<string>,
): { rings: Ring[]; removed: number } {
  let current = rings;
  let removedTotal = 0;

  for (let pass = 0; pass < SIMPLIFY_PASSES; pass++) {
    const votes = new Map<string, { drop: number; total: number }>();

    for (const ring of current) {
      const open = ring.slice(0, -1);
      const simplifiable = open.length >= MIN_RING_VERTICES;

      for (let i = 0; i < open.length; i++) {
        const k = key(open[i]);
        let record = votes.get(k);
        if (!record) votes.set(k, (record = { drop: 0, total: 0 }));
        record.total++;

        if (!simplifiable || pinned.has(k)) continue;

        const a = open[(i - 1 + open.length) % open.length];
        const b = open[(i + 1) % open.length];
        if (deviation(open[i], a, b) < SIMPLIFY_TOLERANCE_DEG) record.drop++;
      }
    }

    const remove = new Set<string>();
    for (const [k, record] of votes) {
      if (record.drop === record.total) remove.add(k);
    }
    if (remove.size === 0) break;

    // A ring cannot fall below four vertices and still be a polygon. Restoring
    // such a ring wholesale would re-add points that other rings had already
    // dropped, which is itself an asymmetry — so instead veto those vertices
    // everywhere and settle, rather than letting one ring opt out alone.
    for (let guard = 0; guard < 8; guard++) {
      const veto = new Set<string>();
      for (const ring of current) {
        const open = ring.slice(0, -1);
        const kept = open.filter((p) => !remove.has(key(p)));
        if (kept.length < 4) for (const p of open) veto.add(key(p));
      }
      if (veto.size === 0) break;
      for (const k of veto) remove.delete(k);
    }
    if (remove.size === 0) break;

    const next: Ring[] = [];
    for (const ring of current) {
      const open = ring.slice(0, -1);
      const kept = open.filter((p) => !remove.has(key(p)));
      if (kept.length < 4) {
        next.push(ring);
        continue;
      }
      removedTotal += open.length - kept.length;
      next.push([...kept, [kept[0][0], kept[0][1]]]);
    }

    current = next;
  }

  return { rings: current, removed: removedTotal };
}

/* ----------------------------------------------------------------- main --- */

interface Feature {
  type: "Feature";
  properties: { ocdId: string; state: string; district: string; label: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

async function main() {
  const cached = KEEP_ZIP && existsSync(TMP_ZIP);

  if (cached) {
    console.log(`Reusing cached ${TMP_ZIP}`);
  } else {
    console.log(`Fetching ${SOURCE_URL}`);

    const response = await fetch(SOURCE_URL);
    if (!response.ok || !response.body) {
      throw new Error(
        `Census returned ${response.status} ${response.statusText}. ` +
          `Check GENZ${VINTAGE} in this script; Census moves these paths between releases.`,
      );
    }

    await mkdir(dirname(TMP_ZIP), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(TMP_ZIP),
    );
  }

  console.log(
    `  quantize=${QUANTIZE_DECIMALS}dp tolerance=${SIMPLIFY_TOLERANCE_DEG}deg passes=${SIMPLIFY_PASSES}`,
  );

  try {
    const zip = await readFile(TMP_ZIP);
    console.log(`  ${(zip.length / 1_048_576).toFixed(1)} MB archive`);

    const files = extractAll(zip);
    const shpName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".shp"));
    const dbfName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".dbf"));
    const prjName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".prj"));
    if (!shpName || !dbfName) throw new Error("Archive has no .shp/.dbf pair.");

    // cb_ files ship in NAD83. Its difference from WGS84 is on the order of a
    // metre, below the resolution of a 1:500,000 boundary and far below the
    // grid used here, so the degrees are used as-is rather than reprojected.
    if (prjName) {
      const prj = files.get(prjName)!.toString("latin1");
      const datum = /GEOGCS\["([^"]+)"/.exec(prj)?.[1] ?? "unknown";
      console.log(`  source CRS: ${datum} (treated as WGS84, sub-metre difference)`);
    }

    const rows = parseDbf(files.get(dbfName)!);
    const shapes = parseShp(files.get(shpName)!);
    if (rows.length !== shapes.length) {
      throw new Error(
        `Attribute/geometry mismatch: ${rows.length} rows, ${shapes.length} shapes.`,
      );
    }
    console.log(`  ${rows.length} records`);

    const cdField = Object.keys(rows[0]).find((f) => /^CD\d*FP$/.test(f));
    if (!cdField) {
      throw new Error(`No CD**FP field. Saw: ${Object.keys(rows[0]).join(", ")}`);
    }

    // Report the raw code inventory before anything is mapped. A code this
    // script does not expect must be seen, not silently dropped.
    const codeCounts = new Map<string, number>();
    for (const row of rows) {
      codeCounts.set(row[cdField], (codeCounts.get(row[cdField]) ?? 0) + 1);
    }
    const codes = [...codeCounts].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`\n  distinct ${cdField} values (${codeCounts.size}):`);
    console.log(
      `    ${codes.map(([c, n]) => `${c}:${n}`).join("  ")}`,
    );

    // Pass one: identity and geometry, quantized. Pinning needs every ring in
    // hand before any of them can be simplified.
    interface Pending {
      ocdId: string;
      state: string;
      district: string;
      label: string;
      polygons: Polygon[];
    }
    const pending: Pending[] = [];
    const dropped = new Map<string, number>();
    const noteDrop = (why: string) => dropped.set(why, (dropped.get(why) ?? 0) + 1);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const identity = districtIdentity(row.STATEFP, row[cdField]);

      if (!identity) {
        noteDrop(
          row[cdField] === "ZZ"
            ? "ZZ: water or unassigned area, not a seat"
            : `unmapped STATEFP ${row.STATEFP} / ${cdField} ${row[cdField]}`,
        );
        continue;
      }
      if (shapes[i].length === 0) {
        noteDrop("null geometry");
        continue;
      }

      pending.push({
        ...identity,
        polygons: shapes[i].map((poly) => poly.map(quantizeRing).filter((r) => r.length >= 4)),
      });
    }

    // Pin the vertices where simplification would otherwise disagree with the
    // neighbouring district.
    //
    // Along the interior of a shared border, a vertex has exactly two distinct
    // neighbours and both districts see the same triple, so both make the same
    // decision. At the *end* of a shared arc the triples differ, and dropping
    // the vertex on one side but not the other opens a sliver.
    //
    // Counting rings is not enough to find those endpoints: where an inland
    // border runs into the coast, only two districts meet, so the use-count is
    // two even though it is a junction. Counting distinct neighbours across
    // every ring finds them, and finds three-district junctions for free.
    const uses = new Map<string, number>();
    const neighbours = new Map<string, Set<string>>();

    const link = (a: [number, number], b: [number, number]) => {
      const ka = key(a);
      let set = neighbours.get(ka);
      if (!set) neighbours.set(ka, (set = new Set()));
      set.add(key(b));
    };

    for (const item of pending) {
      for (const poly of item.polygons) {
        for (const ring of poly) {
          const open = ring.slice(0, -1);
          // Count each ring once per vertex: a ring that touches itself would
          // otherwise look like two districts meeting.
          const seen = new Set<string>();
          for (let i = 0; i < open.length; i++) {
            const k = key(open[i]);
            if (!seen.has(k)) {
              seen.add(k);
              uses.set(k, (uses.get(k) ?? 0) + 1);
            }
            link(open[i], open[(i - 1 + open.length) % open.length]);
            link(open[i], open[(i + 1) % open.length]);
          }
        }
      }
    }

    const pinned = new Set<string>();
    for (const [k, set] of neighbours) if (set.size > 2) pinned.add(k);
    console.log(`  pinned ${pinned.size.toLocaleString()} junction vertices`);

    // Every ring in the country, simplified together so the votes above can be
    // taken across districts rather than within one.
    const flatRings: Ring[] = [];
    const ringOwner: { item: number; poly: number }[] = [];
    for (let i = 0; i < pending.length; i++) {
      for (let p = 0; p < pending[i].polygons.length; p++) {
        for (const ring of pending[i].polygons[p]) {
          flatRings.push(ring);
          ringOwner.push({ item: i, poly: p });
        }
      }
    }

    const verticesBefore = flatRings.reduce((n, r) => n + r.length, 0);
    const { rings: simplifiedRings } = simplifyGlobally(flatRings, pinned);
    const verticesAfter = simplifiedRings.reduce((n, r) => n + r.length, 0);

    // Reassemble rings back into their polygons, in the original order.
    const rebuilt: Polygon[][] = pending.map((item) => item.polygons.map(() => []));
    for (let r = 0; r < simplifiedRings.length; r++) {
      const { item, poly } = ringOwner[r];
      rebuilt[item][poly].push(simplifiedRings[r]);
    }

    const features: Feature[] = [];

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const simplified = rebuilt[i]
        .map((poly) => poly.filter((r) => r.length >= 4))
        .filter((poly) => poly.length > 0);

      if (simplified.length === 0) {
        noteDrop("geometry collapsed during simplification");
        continue;
      }

      features.push({
        type: "Feature",
        properties: {
          ocdId: item.ocdId,
          state: item.state,
          district: item.district,
          label: item.label,
        },
        geometry:
          simplified.length === 1
            ? { type: "Polygon", coordinates: simplified[0] }
            : { type: "MultiPolygon", coordinates: simplified },
      });
    }

    // Gap check. A vertex that two districts shared before simplification must
    // survive in both or in neither. If it survives in exactly one, the two
    // sides disagreed about the same border and a sliver opens between them —
    // which is the failure this whole scheme exists to prevent, and it is not
    // visible in a size number.
    const usesAfter = new Map<string, number>();
    for (const feature of features) {
      const polys =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          const seen = new Set<string>();
          for (const p of ring.slice(0, -1)) {
            const k = `${p[0]},${p[1]}`;
            if (seen.has(k)) continue;
            seen.add(k);
            usesAfter.set(k, (usesAfter.get(k) ?? 0) + 1);
          }
        }
      }
    }

    let asymmetric = 0;
    for (const [k, before] of uses) {
      if (before !== 2) continue;
      if (usesAfter.get(k) === 1) asymmetric++;
    }
    console.log(
      `  shared-border check: ${asymmetric} vertex/vertices kept on one side only`,
    );
    if (asymmetric > 0) {
      throw new Error(
        `${asymmetric} shared vertices were dropped asymmetrically, which opens ` +
          `gaps between neighbouring districts. Lower DISTRICTS_TOLERANCE.`,
      );
    }

    const ids = new Set(features.map((f) => f.properties.ocdId));
    if (ids.size !== features.length) {
      throw new Error(
        `${features.length - ids.size} duplicate ocdId(s). ` +
          `OCD-IDs are the join key and must be unique.`,
      );
    }
    if (features.length < 400) {
      throw new Error(
        `Only ${features.length} districts survived; expected well over 400. ` +
          `Refusing to overwrite the committed file with a partial result.`,
      );
    }

    const collection = {
      type: "FeatureCollection" as const,
      source: SOURCE_URL,
      sourceOrg: SOURCE_ORG,
      vintage: VINTAGE,
      congress: CONGRESS,
      generatedAt: new Date().toISOString(),
      note:
        "Congressional district boundaries, 119th Congress, Census cartographic " +
        "boundary release generalized to 1:500,000. Orientation and display only. " +
        "Regenerate with `pnpm districts:fetch`.",
      features,
    };

    const json = JSON.stringify(collection);
    await mkdir(dirname(OUT_PATH), { recursive: true });
    await writeFile(OUT_PATH, `${json}\n`);

    const bytes = Buffer.byteLength(json);
    const gzipped = gzipSync(json).length;

    console.log(`\n  features written : ${features.length}`);
    console.log(
      `  vertices         : ${verticesBefore.toLocaleString()} -> ${verticesAfter.toLocaleString()}`,
    );
    console.log(`  size             : ${(bytes / 1_048_576).toFixed(2)} MB`);
    console.log(`  gzipped          : ${(gzipped / 1_048_576).toFixed(2)} MB`);

    if (dropped.size > 0) {
      console.log(`\n  dropped:`);
      for (const [why, count] of dropped) {
        console.log(`    ${String(count).padStart(4)}  ${why}`);
      }
    } else {
      console.log(`\n  dropped: none`);
    }

    console.log(`\nWrote ${OUT_PATH}`);
  } finally {
    if (!KEEP_ZIP) await rm(TMP_ZIP, { force: true });
  }
}

main().catch((error) => {
  console.error(`\ndistricts:fetch failed: ${error.message}`);
  process.exitCode = 1;
});
