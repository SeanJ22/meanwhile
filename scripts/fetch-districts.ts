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

import {
  countyIdentity,
  legislativeIdentity,
  placeIdentity,
  schoolIdentity,
  subdivisionIdentity,
  type DivisionIdentity,
} from "../lib/ocd/divisions.ts";
import { CLIP_COUNTIES, COVERED_FIPS } from "../lib/coverage/artifacts.ts";
import { districtIdentity } from "../lib/ocd/fips.ts";

const VINTAGE = "2025";
const CONGRESS = "119";
const SOURCE_ORG = "U.S. Census Bureau";
const BASE = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp`;
/**
 * Full TIGER/Line, read for its attribute table only.
 *
 * Geometry still comes from the cartographic release above — TIGER/Line is an
 * order of magnitude heavier and is built for spatial joins, not for shipping
 * to a browser. But it is the only place `FUNCSTAT` and `CLASSFP` exist, and
 * without those there is no way to tell a real municipality from the fictitious
 * placeholder Census writes into the other layer for the same ground.
 */
const TIGER_BASE = `https://www2.census.gov/geo/tiger/TIGER${VINTAGE}`;

/**
 * The counties everything below Congress is clipped to.
 *
 * National coverage across all these types is 13,000+ features, which ends the
 * committed-GeoJSON approach and forces vector tiling. Three counties keeps it
 * to a few dozen features per type, keeps this tested pipeline, and defers the
 * tiling decision until coverage actually expands. These three are the counties
 * behind the four target zips.
 */
/*
 * CLIP_COUNTIES and CLIP_STATES both come from the coverage manifest since
 * AUD-06 (g18). They were two of fourteen hand-kept state lists.
 */
const CLIP_STATES = COVERED_FIPS;

type Row = Record<string, string>;

interface DistrictType {
  /** Output filename stem, and the `--type` value. */
  key: string;
  /** Per-state Census archive, or one national file. */
  url: (statefp: string) => string;
  /** True when one archive covers the country. */
  national?: boolean;
  identity: (row: Row) => DivisionIdentity | null;
  /** Human description for the run log. */
  note: string;
  /**
   * TIGER/Line layer to join extra attributes from, on GEOID.
   *
   * The cartographic files carry LSAD but **not** `FUNCSTAT` or `CLASSFP`, and
   * those two are what decide whether a polygon is a government and whether it
   * is the same government as a row in the other layer. They exist only in
   * full TIGER/Line, so the attributes are pulled from there and joined onto
   * the generalized geometry. GEOID is identical across the two releases, so
   * the join is exact rather than a name match.
   */
  tigerLayer?: string;
}

/**
 * Every district type this script can build.
 *
 * Congressional is deliberately absent: it is already built nationally as
 * cd119.geojson, it is asserted at 441 features by tests/districts.test.ts, and
 * national coverage is worth keeping for the one tier where a reader benefits
 * from seeing beyond their own county. Everything else is clipped.
 */
const TYPES: DistrictType[] = [
  {
    key: "sldu",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_sldu_500k.zip`,
    identity: (row) =>
      legislativeIdentity(row.STATEFP, "sldu", row.SLDUST, row.NAMELSAD),
    note: "State legislative districts, upper chamber",
  },
  {
    key: "sldl",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_sldl_500k.zip`,
    identity: (row) =>
      legislativeIdentity(row.STATEFP, "sldl", row.SLDLST, row.NAMELSAD),
    note: "State legislative districts, lower chamber",
  },
  {
    key: "county",
    url: () => `${BASE}/cb_${VINTAGE}_us_county_500k.zip`,
    national: true,
    /*
     * RULING 80: the county layer draws THE WHOLE EXTENT — the primaries and
     * the counties adjacent to them.
     *
     * It used to draw exactly the three primaries, on the reasoning that "for
     * the layer that IS the clip, including eighteen neighbours would
     * misrepresent what this build covers". That reasoning was correct about a
     * build whose extent was three counties and is wrong about this one: the
     * extent IS the neighbours now, and a county layer that omitted them would
     * be the one misrepresenting the build — it would draw a boundary around
     * territory whose towns, districts and school boards this file is about to
     * draw anyway.
     *
     * What is covered and what is DRAWABLE stay separate elsewhere:
     * `CLIP_COUNTIES` is unchanged and still means "the county this state's
     * data is about", which is what the coverage denominator counts.
     */
    identity: (row) =>
      CLIP_EXTENT.has(`${row.STATEFP}${row.COUNTYFP}`)
        ? countyIdentity(row.STATEFP, row.NAME)
        : null,
    note: "Counties",
  },
  {
    key: "place",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_place_500k.zip`,
    identity: (row) =>
      placeIdentity(row.STATEFP, row.NAME, row.LSAD, row.FUNCSTAT, row.CLASSFP),
    tigerLayer: "place",
    note: "Incorporated places and census designated places",
  },
  {
    // The other half of municipal government, and in two of the three clip
    // counties it is the only half. New Jersey's 564 municipalities and New
    // Hampshire's 222 towns are county subdivisions; neither Newbury NH nor
    // Rockaway Township NJ appears in the place file. Arizona has no minor
    // civil divisions at all — its 80 county subdivisions are statistical
    // CCDs, which is why LSAD has to ride along and be read downstream.
    key: "cousub",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_cousub_500k.zip`,
    identity: (row) =>
      subdivisionIdentity(
        row.STATEFP,
        row.NAMELSADCO,
        row.NAMELSAD,
        row.LSAD,
        row.FUNCSTAT,
        row.CLASSFP,
      ),
    tigerLayer: "cousub",
    note: "County subdivisions — towns, townships, boroughs, and CCDs",
  },
  {
    key: "unsd",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_unsd_500k.zip`,
    identity: (row) => schoolIdentity(row.STATEFP, row.NAME),
    note: "Unified school districts",
  },
  {
    key: "elsd",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_elsd_500k.zip`,
    identity: (row) => schoolIdentity(row.STATEFP, row.NAME),
    note: "Elementary school districts",
  },
  {
    key: "scsd",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_scsd_500k.zip`,
    identity: (row) => schoolIdentity(row.STATEFP, row.NAME),
    note: "Secondary school districts",
  },
];

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
const GEO_DIR = join(here, "..", "public", "geo");
const TMP_DIR = join(here, "..", ".districts-cache");

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

/* ----------------------------------------------------------------- clip --- */

type Bbox = [number, number, number, number];

function bboxOf(polygons: Polygon[]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const poly of polygons) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return [minX, minY, maxX, maxY];
}

function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/** Ray casting against a polygon's exterior ring, minus its holes. */
function pointInPolygon(point: [number, number], poly: Polygon): boolean {
  const inRing = (ring: Ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > point[1] !== yj > point[1] &&
        point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  };

  if (!inRing(poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(poly[h])) return false;
  return true;
}

/**
 * Whether two multipolygons share any area.
 *
 * Tests whether any vertex of one falls inside the other, in both directions,
 * after a bounding-box reject. That misses the pathological case of two shapes
 * whose boundaries cross with no vertex of either inside the other — but these
 * are counties against districts, shapes of comparable size that overlap in
 * area when they overlap at all, so the case does not arise here.
 *
 * Deliberately not a bbox test alone: Merrimack County's bounding box reaches
 * into half of New Hampshire, and a bbox clip would pull in districts that
 * never touch the county.
 */
function overlaps(a: Polygon[], b: Polygon[]): boolean {
  const boxA = bboxOf(a);
  const boxB = bboxOf(b);
  if (!bboxesOverlap(boxA, boxB)) return false;

  for (const polyA of a) {
    for (const point of polyA[0]) {
      for (const polyB of b) if (pointInPolygon(point, polyB)) return true;
    }
  }

  for (const polyB of b) {
    for (const point of polyB[0]) {
      for (const polyA of a) if (pointInPolygon(point, polyA)) return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------- download --- */

async function download(url: string, dest: string): Promise<Buffer> {
  if (KEEP_ZIP && existsSync(dest)) {
    console.log(`  reusing cached ${dest}`);
    return readFile(dest);
  }

  console.log(`  fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Census returned ${response.status} ${response.statusText} for ${url}. ` +
        `Check GENZ${VINTAGE}; Census moves these paths between releases.`,
    );
  }

  await mkdir(dirname(dest), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );

  return readFile(dest);
}

/** The .shp/.dbf pair out of a Census archive. */
function readShapefile(zip: Buffer): { rows: Row[]; shapes: Polygon[][] } {
  const files = extractAll(zip);
  const shpName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".shp"));
  const dbfName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".dbf"));
  if (!shpName || !dbfName) throw new Error("Archive has no .shp/.dbf pair.");

  const rows = parseDbf(files.get(dbfName)!);
  const shapes = parseShp(files.get(shpName)!);
  if (rows.length !== shapes.length) {
    throw new Error(
      `Attribute/geometry mismatch: ${rows.length} rows, ${shapes.length} shapes.`,
    );
  }

  return { rows, shapes };
}

/**
 * `FUNCSTAT` and `CLASSFP` per GEOID, out of TIGER/Line.
 *
 * The cartographic release drops both. They are the two fields that say
 * whether a polygon is a government, and whether it is the same government the
 * other layer already listed — so they have to come from somewhere, and
 * TIGER/Line is the same geography under the same GEOID, which makes this an
 * exact key join rather than a name match.
 *
 * Only the attribute table is used; the full-resolution geometry in the archive
 * is never parsed. The archives are small at state scale (0.4–1.1 MB), and this
 * runs in a maintenance script rather than at request time.
 */
async function tigerAttributes(
  layer: string,
  statefp: string,
): Promise<Map<string, Row>> {
  const url = `${TIGER_BASE}/${layer.toUpperCase()}/tl_${VINTAGE}_${statefp}_${layer}.zip`;
  const zip = await download(url, join(TMP_DIR, `tl-${layer}-${statefp}.zip`));

  const files = extractAll(zip);
  const dbfName = [...files.keys()].find((n) => n.toLowerCase().endsWith(".dbf"));
  if (!dbfName) throw new Error(`TIGER archive ${url} has no .dbf`);

  const byGeoid = new Map<string, Row>();
  for (const row of parseDbf(files.get(dbfName)!)) {
    if (row.GEOID) byGeoid.set(row.GEOID, row);
  }
  return byGeoid;
}

/**
 * THE CLIP EXTENT — every county in it, with its polygons, quantized to the
 * same grid as everything else.
 *
 * **RULING 80 (2026-08-22, NJ Hunt 4 item 4), which closed `NH44`.** This used
 * to be exactly the three primary counties. A zip's first-rung circle crosses
 * county lines — 3 of the 4 pilot zips do, and 184 of 279 measured — so towns
 * inside that circle entered the registry with their boards, their rosters and
 * their meetings, and NO POLYGON. RULING 57 says a body is named first and
 * hunted second; a body that cannot be DRAWN because a build-time clip was
 * convenient is that rule losing to a file format.
 *
 * **Adjacency is MEASURED, never remembered.** No list of neighbouring county
 * FIPS is written down anywhere in this repo, because a hand-written one is a
 * claim about American geography with nothing behind it and it goes stale the
 * next time Census redraws anything. Two counties are adjacent here when their
 * quantized boundaries SHARE A VERTEX — TIGER's neighbouring counties share
 * boundary arcs exactly, so after the same quantization both sides carry the same
 * points, and the test is an equality rather than a tolerance.
 *
 * The national county file is downloaded once and serves three purposes: the
 * clip polygons, the adjacency, and the `county` layer itself.
 */
interface ClipCounty {
  label: string;
  polygons: Polygon[];
  /** True for a county this build is ABOUT; false for one it can merely draw. */
  primary: boolean;
}

/**
 * Filled by `loadClipExtent` before any layer is built, and read by the
 * `county` type's identity function, which runs later inside `buildClipped`.
 * A module-level binding rather than a parameter because `TYPES` is a const
 * declared above and threading the extent through it would change every
 * identity signature for one caller.
 */
let CLIP_EXTENT: Map<string, ClipCounty> = new Map();

async function loadClipExtent(): Promise<Map<string, Polygon[]>> {
  const zip = await download(
    `${BASE}/cb_${VINTAGE}_us_county_500k.zip`,
    join(TMP_DIR, "county-us.zip"),
  );
  const { rows, shapes } = readShapefile(zip);

  const primary = new Map<string, string>(
    CLIP_COUNTIES.map((c) => [c.fips as string, c.label as string]),
  );

  /* Every county's quantized polygons, once — adjacency needs all of them. */
  const quantized = new Map<string, { polygons: Polygon[]; label: string }>();
  for (let i = 0; i < rows.length; i++) {
    const geoid = `${rows[i].STATEFP}${rows[i].COUNTYFP}`;
    quantized.set(geoid, {
      polygons: shapes[i].map((poly) => poly.map(quantizeRing).filter((r) => r.length >= 4)),
      label: `${rows[i].NAME} County, ${rows[i].STATEFP}`,
    });
  }

  for (const [fips, label] of primary) {
    if (!quantized.has(fips)) throw new Error(`Clip county ${label} (${fips}) not found.`);
  }

  /* The vertices on every primary county's boundary. */
  const primaryVertices = new Set<string>();
  for (const fips of primary.keys()) {
    for (const poly of quantized.get(fips)!.polygons) {
      for (const ring of poly) {
        for (const [x, y] of ring) primaryVertices.add(`${x},${y}`);
      }
    }
  }

  const out = new Map<string, Polygon[]>();
  const extent = new Map<string, ClipCounty>();

  for (const [geoid, { polygons, label }] of quantized) {
    const isPrimary = primary.has(geoid);
    const touches =
      isPrimary ||
      polygons.some((poly) =>
        poly.some((ring) => ring.some(([x, y]) => primaryVertices.has(`${x},${y}`))),
      );
    if (!touches) continue;
    out.set(geoid, polygons);
    extent.set(geoid, { label: primary.get(geoid) ?? label, polygons, primary: isPrimary });
  }

  CLIP_EXTENT = extent;

  /*
   * The count, stated. A zero-row read is a failed read: a national county file
   * that produced no neighbour for any of three counties would mean the
   * adjacency test is broken, not that the counties are islands.
   */
  const adjacent = [...extent.values()].filter((c) => !c.primary).length;
  console.log(
    `\nclip extent (RULING 80): ${primary.size} primary + ${adjacent} adjacent = ${extent.size} counties`,
  );
  if (adjacent === 0) {
    throw new Error(
      "No adjacent county was found for any primary county. Three counties in the " +
        "continental United States are not islands, so this is a failed adjacency " +
        "read rather than an empty one.",
    );
  }

  return out;
}

/* ----------------------------------------------------------------- main --- */

interface Feature {
  type: "Feature";
  properties: {
    ocdId: string;
    state: string;
    district: string;
    label: string;
    lsad?: string;
    funcstat?: string;
    classfp?: string;
    /**
     * The clip counties whose polygons this feature's geometry overlaps
     * (RULING 80). Exact, measured at build time, and the answer to "which
     * county is this municipality in" that nothing downstream has to guess.
     */
    clipCounties?: string[];
    /**
     * The Census GEOID, verbatim. Complete by construction and exact — it
     * matched 100% on every layer during the M17 TIGER join. Retained so
     * that if the OCD-ID convention ever has to change, identifiers are
     * re-derived from an exact key rather than rebuilt from name fields and
     * slug rules that already produced 348 canonical-match misses.
     */
    geoid?: string;
  };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface BuildOptions {
  /** Output file stem under public/geo. */
  outName: string;
  sourceUrl: string;
  note: string;
  rows: Row[];
  shapes: Polygon[][];
  identity: (row: Row) => DivisionIdentity | null;
  /** Keep only features passing this. Absent means keep everything. */
  keep?: (polygons: Polygon[]) => boolean;
  /**
   * The clip counties this feature's geometry actually OVERLAPS, as GEOIDs.
   *
   * RULING 80 (2026-08-22, NJ Hunt 4 item 4). Recorded because the alternative
   * turned out to be a guess: `tests/coverage.test.ts` placed each municipality
   * in a county by averaging its exterior-ring vertices and testing that point
   * against the SIMPLIFIED county polygon, and once the clip widened, three
   * Sussex County municipalities on the Lake Hopatcong shore — Byram, Hopatcong
   * and Stanhope — landed inside Morris and inflated a federal cross-check by
   * three. A vertex average is not a centroid, and a 200-metre-simplified
   * boundary is not a boundary.
   *
   * This is computed here from the real overlap, against the county polygons the
   * clip is built from, before any simplification. It is exact, it costs a few
   * bytes per feature, and it means no consumer has to guess again.
   */
  clipCountiesFor?: (polygons: Polygon[], geoid?: string) => string[];
  /** Refuse to write below this, so a partial result never overwrites a good file. */
  minFeatures: number;
  extra?: Record<string, unknown>;
}

async function build(opts: BuildOptions): Promise<number> {
  const { rows, shapes } = opts;

  console.log(
    `  quantize=${QUANTIZE_DECIMALS}dp tolerance=${SIMPLIFY_TOLERANCE_DEG}deg passes=${SIMPLIFY_PASSES}`,
  );
  console.log(`  ${rows.length} records`);

  {
    // Pass one: identity and geometry, quantized. Pinning needs every ring in
    // hand before any of them can be simplified.
    interface Pending {
      ocdId: string;
      state: string;
      district: string;
      label: string;
      lsad?: string;
      funcstat?: string;
      classfp?: string;
      geoid?: string;
      clipCounties?: string[];
      polygons: Polygon[];
    }
    const pending: Pending[] = [];
    const dropped = new Map<string, number>();
    const noteDrop = (why: string) => dropped.set(why, (dropped.get(why) ?? 0) + 1);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const identity = opts.identity(row);

      if (!identity) {
        noteDrop("no OCD identity: water, unassigned area, or unmapped code");
        continue;
      }
      if (shapes[i].length === 0) {
        noteDrop("null geometry");
        continue;
      }

      const polygons = shapes[i].map((poly) =>
        poly.map(quantizeRing).filter((r) => r.length >= 4),
      );

      // The clip. Done before simplification so the expensive global pass only
      // sees geometry that will actually be written.
      if (opts.keep && !opts.keep(polygons)) {
        noteDrop("outside the clip counties");
        continue;
      }

      // GEOID rides along from the raw row for every layer — it is the exact
      // key the OCD identifiers could be re-derived from if the convention
      // ever changes, and it costs a few bytes per feature to keep.
      pending.push({
        ...identity,
        geoid: (row as { GEOID?: string }).GEOID || undefined,
        clipCounties: opts.clipCountiesFor
          ? opts.clipCountiesFor(polygons, (row as { GEOID?: string }).GEOID)
          : undefined,
        polygons,
      });
    }

    if (pending.length === 0) {
      throw new Error("Nothing survived identity and clip; refusing to write.");
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
          // Only where it exists — the legislative and school layers have no
          // LSAD worth carrying, and an undefined key is dropped by
          // JSON.stringify rather than written as null.
          ...(item.lsad ? { lsad: item.lsad } : {}),
          // FUNCSTAT is the field that says whether this polygon governs; CLASSFP
          // says whether it is the same government the other layer listed.
          ...(item.funcstat ? { funcstat: item.funcstat } : {}),
          ...(item.classfp ? { classfp: item.classfp } : {}),
          ...(item.geoid ? { geoid: item.geoid } : {}),
          /*
           * RULING 80: the clip counties this feature's geometry actually
           * overlaps, measured against the county polygons the clip is built
           * from. Several is normal and real — a school district crosses county
           * lines all the time. Absent on the unclipped national layers.
           */
          ...(item.clipCounties && item.clipCounties.length > 0
            ? { clipCounties: item.clipCounties }
            : {}),
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

    /*
     * TWO PLACES, ONE NAME, ONE STATE — a collision the widened clip surfaced.
     *
     * (RULING 80, NJ Hunt 4 item 4, 2026-08-22.) `placeIdentity` keys on state
     * and name, and New Jersey has TWO Silver Lake CDPs: `3467590` and
     * `3467650`. Both slug to `state:nj/place:silver_lake`. The build refused,
     * correctly — an OCD-ID is the universal join key and a duplicate one is a
     * join that collapses, which is exactly the failure the distinctness rule in
     * `CLAUDE.md` was written for.
     *
     * The refusal was right and stopping there would have been wrong: it would
     * have meant the geometry cannot widen because two hamlets share a name.
     * `subdivisionIdentity` already solved the same problem for county
     * subdivisions by carrying more of the row in the identifier, and this is
     * the same answer with a narrower blast radius.
     *
     * **Only the COLLIDING ids are disambiguated, and every side of a collision
     * is disambiguated** — never one kept bare and one suffixed, because "which
     * one is the real Silver Lake" is not a question this build gets to answer,
     * and a bare id that changes owner between builds is worse than no id.
     * The suffix is the Census GEOID, which is exact, stable and already carried
     * on every feature.
     *
     * A collision on an id that is ALREADY COMMITTED is a different and worse
     * event — it would move an identifier something else joins on — so it is
     * named loudly rather than silently renamed.
     */
    const byId = new Map<string, Feature[]>();
    for (const f of features) {
      const list = byId.get(f.properties.ocdId) ?? [];
      list.push(f);
      byId.set(f.properties.ocdId, list);
    }
    let disambiguated = 0;
    for (const [id, group] of byId) {
      if (group.length < 2) continue;
      console.log(
        `  COLLISION ${id}: ${group.map((f) => `${f.properties.label} [${f.properties.geoid ?? "no geoid"}]`).join(" | ")}`,
      );
      if (group.some((f) => !f.properties.geoid)) {
        throw new Error(
          `${id} collides ${group.length} ways and at least one side carries no GEOID, ` +
            `so there is nothing exact to disambiguate on.`,
        );
      }
      for (const f of group) {
        f.properties.ocdId = `${id}_${f.properties.geoid}`;
        disambiguated++;
      }
    }
    if (disambiguated > 0) {
      console.log(
        `  disambiguated ${disambiguated} feature(s) across ${[...byId.values()].filter((g) => g.length > 1).length} name collision(s), ` +
          `every side suffixed with its Census GEOID`,
      );
    }

    const ids = new Set(features.map((f) => f.properties.ocdId));
    if (ids.size !== features.length) {
      throw new Error(
        `${features.length - ids.size} duplicate ocdId(s) survived disambiguation. ` +
          `OCD-IDs are the join key and must be unique.`,
      );
    }
    if (features.length < opts.minFeatures) {
      throw new Error(
        `Only ${features.length} features survived; expected at least ` +
          `${opts.minFeatures}. Refusing to overwrite with a partial result.`,
      );
    }

    const collection = {
      type: "FeatureCollection" as const,
      source: opts.sourceUrl,
      sourceOrg: SOURCE_ORG,
      vintage: VINTAGE,
      generatedAt: new Date().toISOString(),
      note: opts.note,
      ...opts.extra,
      features,
    };

    const outPath = join(GEO_DIR, `${opts.outName}.geojson`);
    const json = JSON.stringify(collection);
    await mkdir(GEO_DIR, { recursive: true });
    await writeFile(outPath, `${json}\n`);

    const bytes = Buffer.byteLength(json);

    console.log(`  features written : ${features.length}`);
    console.log(
      `  vertices         : ${verticesBefore.toLocaleString()} -> ${verticesAfter.toLocaleString()}`,
    );
    console.log(
      `  size             : ${(bytes / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`,
    );

    if (dropped.size > 0) {
      for (const [why, count] of dropped) {
        console.log(`  dropped ${String(count).padStart(5)}  ${why}`);
      }
    }

    console.log(`  wrote ${outPath}`);
    return features.length;
  }
}

/* ------------------------------------------------------------- driver --- */

/** Congressional stays national: tests/districts.test.ts asserts 441 features,
 *  and it is the one tier where seeing past your own county is worth the bytes. */
async function buildCongressional(): Promise<number> {
  const url = `${BASE}/cb_${VINTAGE}_us_cd${CONGRESS}_500k.zip`;
  console.log(`\ncongressional (national)`);

  const zip = await download(url, join(TMP_DIR, `cd${CONGRESS}-us.zip`));
  const { rows, shapes } = readShapefile(zip);

  const cdField = Object.keys(rows[0]).find((f) => /^CD\d*FP$/.test(f));
  if (!cdField) {
    throw new Error(`No CD**FP field. Saw: ${Object.keys(rows[0]).join(", ")}`);
  }

  return build({
    outName: "cd119",
    sourceUrl: url,
    note:
      "Congressional district boundaries, 119th Congress, Census cartographic " +
      "boundary release generalized to 1:500,000. Orientation and display only. " +
      "Regenerate with `pnpm districts:fetch`.",
    rows,
    shapes,
    identity: (row) => districtIdentity(row.STATEFP, row[cdField]),
    minFeatures: 400,
    extra: { congress: CONGRESS },
  });
}

async function buildClipped(
  type: DistrictType,
  clip: Map<string, Polygon[]>,
): Promise<void> {
  const countyEntries = [...clip.entries()];
  const counties = countyEntries.map(([, polys]) => polys);
  const keep = (polygons: Polygon[]) =>
    counties.some((county) => overlaps(polygons, county));
  /**
   * The clip county a feature SITS IN, and it is not the same question as which
   * counties it touches.
   *
   * `overlaps` is true for NEIGHBOURS — quantized county boundaries share their
   * vertices exactly, so every municipality along the Morris–Sussex line
   * "overlaps" both, and a first version of this recorded both and over-counted
   * a federal cross-check by 27 in one county.
   *
   * So the measure is a VOTE OF THE FEATURE'S OWN VERTICES: for each clip
   * county, how many of this feature's boundary points fall inside it. A town in
   * Sussex has all of its vertices inside Sussex and at most a couple of shared
   * ones ambiguous against Morris. The winner is the county with the most, and a
   * genuine straddler — a regional school district across a county line — keeps
   * every county that holds at least a fifth of its vertices, because that is a
   * real fact about it rather than a rounding of one.
   */
  const clipCountiesFor = (polygons: Polygon[], geoid?: string) => {
    /*
     * **READ IT WHERE THE DATA SAYS IT, AND ONLY VOTE WHERE IT DOES NOT.**
     *
     * A county-subdivision GEOID is state(2) + county(3) + cousub(5), so for
     * every New England town and every New Jersey township the county is
     * already in the key — exact, and not a question geometry has to answer.
     * The vote below is a good instrument and it is still an instrument: it put
     * Sunapee town in Merrimack, because Sunapee sits on the Sullivan–Merrimack
     * line across Lake Sunapee and has more of its boundary vertices on the
     * Merrimack side. Its own GEOID says Sullivan, and its own GEOID is right.
     *
     * So: read the county off the key when the key carries one, and vote only
     * for the layers whose keys do not — places (state + place) and school
     * districts (state + district).
     */
    if (geoid && geoid.length === 10) {
      const fromKey = geoid.slice(0, 5);
      if (clip.has(fromKey)) return [fromKey];
    }
    const votes: { geoid: string; n: number }[] = [];
    for (const [geoid, county] of countyEntries) {
      if (!overlaps(polygons, county)) continue;
      let n = 0;
      for (const poly of polygons) {
        for (const point of poly[0]) {
          if (county.some((c) => pointInPolygon(point, c))) n++;
        }
      }
      votes.push({ geoid, n });
    }
    if (votes.length === 0) return [];
    const best = Math.max(...votes.map((v) => v.n));
    if (best === 0) {
      /*
       * Not one vertex of this feature is inside any clip county, yet it
       * overlapped one — which means the county is INSIDE the feature (a state
       * legislative district containing the whole county, say). Every county it
       * overlaps is then correct.
       */
      return votes.map((v) => v.geoid);
    }
    return votes.filter((v) => v.n === best).map((v) => v.geoid);
  };

  // A national source is read once; per-state sources once per state.
  const states = type.national ? ["us"] : CLIP_STATES;

  for (const statefp of states) {
    const url = type.url(statefp);
    const outName = `${type.key}-${statefp}`;
    console.log(`\n${type.key} (${statefp}) — ${type.note}`);

    // Not every state has every type. New Hampshire runs unified districts
    // only, so it has no elementary or secondary file at all — a 404 there is
    // the correct answer, not a failure. Say so and move on.
    let zip: Buffer;
    try {
      zip = await download(url, join(TMP_DIR, `${outName}.zip`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("404")) {
        console.log(`  no such file — this state has no ${type.key} districts`);
        continue;
      }
      throw error;
    }

    const { rows, shapes } = readShapefile(zip);

    // Join the two fields the cartographic release drops. A row that finds no
    // TIGER match keeps its cartographic attributes and is counted, rather than
    // being silently dropped or silently treated as non-governing — a missing
    // attribute is a gap to see, not a verdict.
    if (type.tigerLayer) {
      const attrs = await tigerAttributes(type.tigerLayer, statefp);
      let matched = 0;
      for (const row of rows) {
        const hit = row.GEOID ? attrs.get(row.GEOID) : undefined;
        if (!hit) continue;
        row.FUNCSTAT = hit.FUNCSTAT ?? "";
        row.CLASSFP = hit.CLASSFP ?? "";
        matched++;
      }
      console.log(
        `  TIGER ${type.tigerLayer}: FUNCSTAT/CLASSFP joined on ${matched}/${rows.length} rows`,
      );
      if (matched === 0) {
        throw new Error(
          `TIGER join matched nothing for ${type.key} ${statefp} — GEOID shapes disagree, refusing to write a file whose governance fields are all empty`,
        );
      }
    }

    await build({
      outName,
      sourceUrl: url,
      note: `${type.note}, clipped to ${CLIP_COUNTIES.map((c) => c.label).join("; ")} and every county adjacent to them (RULING 80, adjacency measured from the Census county file by shared boundary vertex, never from a written-down list). Census cartographic boundary release generalized to 1:500,000. Orientation and display only.`,
      rows,
      shapes,
      identity: type.identity,
      keep,
      clipCountiesFor,
      // One is enough: some types genuinely have a single feature in a county,
      // and a floor above that would reject a correct result.
      minFeatures: 1,
      extra: {
        clippedTo: CLIP_COUNTIES.map((c) => c.fips),
        clipExtent: [...CLIP_EXTENT.keys()].sort(),
      },
    });
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const only = new Set(requested);

  try {
    if (only.size === 0 || only.has("cd") || only.has("congressional")) {
      await buildCongressional();
    }

    const types = TYPES.filter((t) => only.size === 0 || only.has(t.key));
    if (types.length > 0) {
      const clip = await loadClipExtent();
      console.log(
        `\nclip: ${CLIP_COUNTIES.map((c) => c.label).join("; ")}`,
      );
      for (const type of types) await buildClipped(type, clip);
    }
  } finally {
    if (!KEEP_ZIP) await rm(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\ndistricts:fetch failed: ${error.message}`);
  process.exitCode = 1;
});
