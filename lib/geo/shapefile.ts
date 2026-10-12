/**
 * Minimal shapefile reader: .shp geometry, .dbf attributes, .zip container.
 * Reads polygon (5), polygonZ (15) and null (0) shapes only; any other shape
 * type throws.
 */

import { readZipEntries } from "../sources/archive.ts";

export interface ZipEntry { readonly name: string; readonly data: Buffer }

export type Ring = Array<[number, number]>;

export type ShapeRecord = {
  /** 1-based record number from the file itself. */
  recordNumber: number;
  /** Every ring in file order; outer rings and holes are not separated. */
  rings: Ring[];
  bbox: [number, number, number, number];
};

/** Geometry-specific bound, checked before any ZIP member inflates. */
export function readZip(buf: Buffer): { name: string; data: Buffer }[] {
  return readZipEntries(buf, { maxMemberBytes: 256 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 });
}

/* .shp */

const NULL_SHAPE = 0;
const POLYGON = 5;
const POLYGON_Z = 15;

export function readShp(buf: Buffer): ShapeRecord[] {
  if (buf.length < 100 || buf.readInt32BE(24) * 2 !== buf.length) throw new Error("shp: invalid complete file length");
  const records: ShapeRecord[] = [];
  let p = 100; // fixed-length file header

  while (p + 8 <= buf.length) {
    const recordNumber = buf.readInt32BE(p);
    const contentWords = buf.readInt32BE(p + 4);
    const body = p + 8;
    if (recordNumber !== records.length + 1 || contentWords < 2 || body + contentWords * 2 > buf.length) throw new Error("shp: invalid record framing");
    p = body + contentWords * 2;

    const type = buf.readInt32LE(body);
    if (type === NULL_SHAPE) { records.push({ recordNumber, rings: [], bbox: [0, 0, 0, 0] }); continue; }
    if (type !== POLYGON && type !== POLYGON_Z) {
      throw new Error(
        `shp: record ${recordNumber} is shape type ${type}; this reader handles ` +
          "polygons (5) and polygonZ (15) only",
      );
    }

    if (contentWords * 2 < 44) throw new Error("shp: truncated polygon");
    const bbox: [number, number, number, number] = [
      buf.readDoubleLE(body + 4),
      buf.readDoubleLE(body + 12),
      buf.readDoubleLE(body + 20),
      buf.readDoubleLE(body + 28),
    ];
    const numParts = buf.readInt32LE(body + 36);
    const numPoints = buf.readInt32LE(body + 40);
    if (numParts <= 0 || numPoints < 4 || 44 + numParts * 4 + numPoints * 16 > contentWords * 2 || !bbox.every(Number.isFinite)) throw new Error("shp: invalid polygon sizes");

    const partStarts: number[] = [];
    for (let i = 0; i < numParts; i += 1) partStarts.push(buf.readInt32LE(body + 44 + i * 4));

    if (partStarts[0] !== 0 || partStarts.some((n, i) => n < 0 || n >= numPoints || (i > 0 && n <= partStarts[i - 1]))) throw new Error("shp: invalid polygon parts");
    const pointsAt = body + 44 + numParts * 4;
    const rings: Ring[] = [];
    for (let i = 0; i < numParts; i += 1) {
      const from = partStarts[i]!;
      const to = i + 1 < numParts ? partStarts[i + 1]! : numPoints;
      const ring: Ring = [];
      for (let j = from; j < to; j += 1) {
        ring.push([buf.readDoubleLE(pointsAt + j * 16), buf.readDoubleLE(pointsAt + j * 16 + 8)]);
      }
      rings.push(ring);
    }

    records.push({ recordNumber, rings, bbox });
  }

  if (p !== buf.length) throw new Error("shp: truncated record header");
  return records;
}

/* .dbf */

/** Encoding from the `.cpg` sidecar; `latin1` (the dBase default) when absent. */
function encodingFrom(entries: ZipEntry[]): BufferEncoding {
  const cpg = entries.find((e) => e.name.toLowerCase().endsWith(".cpg"));
  if (!cpg) return "latin1";
  const declared = cpg.data.toString("ascii").trim().toUpperCase();
  if (declared.includes("UTF-8") || declared.includes("UTF8")) return "utf8";
  return "latin1";
}

/** A boundary zip's attribute rows only, without parsing geometry. */
export function readBoundaryAttributes(buf: Buffer): Record<string, string>[] {
  const entries = readZip(buf);
  const dbf = entries.find((e) => e.name.toLowerCase().endsWith(".dbf"));
  if (!dbf) throw new Error("boundary zip holds no .dbf");
  return readDbf(dbf.data, encodingFrom(entries));
}

export function readDbf(buf: Buffer, encoding: BufferEncoding = "latin1"): Record<string, string>[] {
  return readDbfRecords(buf, encoding).filter((row): row is Record<string, string> => row !== null);
}

function readDbfRecords(buf: Buffer, encoding: BufferEncoding): (Record<string, string> | null)[] {
  if (buf.length < 33) throw new Error("dbf: truncated header");
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const recordCount = buf.readUInt32LE(4);
  if (headerLength < 33 || headerLength > buf.length || recordLength < 1 || headerLength + recordCount * recordLength > buf.length) throw new Error("dbf: invalid complete file length");

  const fields: Array<{ name: string; length: number }> = [];
  for (let p = 32; buf[p] !== 0x0d && p < headerLength; p += 32) {
    const name = buf.toString("ascii", p, p + 11).replace(/\0.*$/, "");
    fields.push({ name, length: buf[p + 16]! });
  }

  if (fields.reduce((n, field) => n + field.length, 1) > recordLength) throw new Error("dbf: invalid field sizes");
  const out: (Record<string, string> | null)[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const start = headerLength + i * recordLength;
    if (buf[start] === 0x2a) { out.push(null); continue; } // preserve ordinal pairing
    let offset = start + 1;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = buf.toString(encoding, offset, offset + f.length).trim();
      offset += f.length;
    }
    out.push(row);
  }
  return out;
}

/* The pairing */

export type Feature = {
  properties: Record<string, string>;
  rings: Ring[];
  bbox: [number, number, number, number];
};

/**
 * Reads one Census boundary zip into features. .shp records pair with .dbf
 * rows by position, so a count mismatch throws rather than mislabeling.
 */
export function readBoundaryZip(buf: Buffer): { features: Feature[]; counts: string } {
  const entries = readZip(buf);
  const shp = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
  const dbf = entries.find((e) => e.name.toLowerCase().endsWith(".dbf"));
  if (!shp) throw new Error("boundary zip holds no .shp");
  if (!dbf) throw new Error("boundary zip holds no .dbf");

  const shapes = readShp(shp.data);
  const rows = readDbfRecords(dbf.data, encodingFrom(entries));
  if (shapes.length !== rows.length) {
    throw new Error(
      `shapefile pairing is broken: ${shapes.length} geometries against ${rows.length} ` +
        "attribute rows. Records pair BY POSITION, so a mismatch means every feature " +
        "past the first gap carries another feature's name.",
    );
  }

  return {
    features: shapes.flatMap((s, i) => rows[i] && s.rings.length ? [{ properties: rows[i]!, rings: s.rings, bbox: s.bbox }] : []),
    counts: `${shapes.length} geometries, ${rows.length} attribute rows, paired`,
  };
}
