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
  type DivisionIdentity,
} from "../lib/ocd/divisions.ts";
import { districtIdentity } from "../lib/ocd/fips.ts";

const VINTAGE = "2025";
const CONGRESS = "119";
const SOURCE_ORG = "U.S. Census Bureau";
const BASE = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp`;

/**
 * The counties everything below Congress is clipped to.
 *
 * National coverage across all these types is 13,000+ features, which ends the
 * committed-GeoJSON approach and forces vector tiling. Three counties keeps it
 * to a few dozen features per type, keeps this tested pipeline, and defers the
 * tiling decision until coverage actually expands. These three are the counties
 * behind the four target zips.
 */
const CLIP_COUNTIES = [
  { fips: "04019", label: "Pima County, AZ" },
  { fips: "34027", label: "Morris County, NJ" },
  { fips: "33013", label: "Merrimack County, NH" },
] as const;

/** State FIPS codes the clip counties sit in. */
const CLIP_STATES = ["04", "34", "33"] as const;

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
    // Exactly the clip counties, not everything that touches them. For every
    // other type an adjacent feature that reaches the county line is genuinely
    // nearby and worth drawing; for the layer that *is* the clip, including
    // eighteen neighbours would misrepresent what this build covers.
    identity: (row) =>
      CLIP_COUNTIES.some((c) => c.fips === `${row.STATEFP}${row.COUNTYFP}`)
        ? countyIdentity(row.STATEFP, row.NAME)
        : null,
    note: "Counties",
  },
  {
    key: "place",
    url: (fp) => `${BASE}/cb_${VINTAGE}_${fp}_place_500k.zip`,
    identity: (row) => placeIdentity(row.STATEFP, row.NAME),
    note: "Incorporated places and census designated places",
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
 * The clip polygons, quantized to the same grid as everything else.
 *
 * Built from the national county file, which is also a district type in its own
 * right — the same download serves both.
 */
async function loadClipCounties(): Promise<Map<string, Polygon[]>> {
  const zip = await download(
    `${BASE}/cb_${VINTAGE}_us_county_500k.zip`,
    join(TMP_DIR, "county-us.zip"),
  );
  const { rows, shapes } = readShapefile(zip);

  const wanted = new Map<string, string>(
    CLIP_COUNTIES.map((c) => [c.fips as string, c.label as string]),
  );
  const out = new Map<string, Polygon[]>();

  for (let i = 0; i < rows.length; i++) {
    const geoid = `${rows[i].STATEFP}${rows[i].COUNTYFP}`;
    if (!wanted.has(geoid)) continue;
    out.set(
      geoid,
      shapes[i].map((poly) => poly.map(quantizeRing).filter((r) => r.length >= 4)),
    );
  }

  for (const [fips, label] of wanted) {
    if (!out.has(fips)) throw new Error(`Clip county ${label} (${fips}) not found.`);
  }

  return out;
}

/* ----------------------------------------------------------------- main --- */

interface Feature {
  type: "Feature";
  properties: { ocdId: string; state: string; district: string; label: string };
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

      pending.push({ ...identity, polygons });
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
  const counties = [...clip.values()];
  const keep = (polygons: Polygon[]) =>
    counties.some((county) => overlaps(polygons, county));

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

    await build({
      outName,
      sourceUrl: url,
      note: `${type.note}, clipped to ${CLIP_COUNTIES.map((c) => c.label).join("; ")}. Census cartographic boundary release generalized to 1:500,000. Orientation and display only.`,
      rows,
      shapes,
      identity: type.identity,
      keep,
      // One is enough: some types genuinely have a single feature in a county,
      // and a floor above that would reject a correct result.
      minFeatures: 1,
      extra: { clippedTo: CLIP_COUNTIES.map((c) => c.fips) },
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
      const clip = await loadClipCounties();
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
