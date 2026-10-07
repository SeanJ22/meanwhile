/**
 * Minimal shapefile reader: .shp geometry, .dbf attributes, .zip container.
 * Reads polygon (5), polygonZ (15) and null (0) shapes only; any other shape
 * type throws.
 */

import { inflateRawSync } from "node:zlib";

export type Ring = Array<[number, number]>;

export type ShapeRecord = {
  /** 1-based record number from the file itself. */
  recordNumber: number;
  /** Every ring in file order; outer rings and holes are not separated. */
  rings: Ring[];
  bbox: [number, number, number, number];
};

/* ZIP */

type ZipEntry = { name: string; data: Buffer };

/**
 * Reads a ZIP central directory and inflates the members. Handles stored and
 * deflated entries only, with no encryption and no zip64.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // End of central directory: scan back for the signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70_000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x0605_4b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x0201_4b50) throw new Error("zip: bad central header");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // The local header repeats the name and extra lengths, and its extra
    // field is frequently a different length from the central one.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
  }
  return out;
}

/* .shp */

const NULL_SHAPE = 0;
const POLYGON = 5;
const POLYGON_Z = 15;

export function readShp(buf: Buffer): ShapeRecord[] {
  const records: ShapeRecord[] = [];
  let p = 100; // fixed-length file header

  while (p + 8 <= buf.length) {
    const recordNumber = buf.readInt32BE(p);
    const contentWords = buf.readInt32BE(p + 4);
    const body = p + 8;
    p = body + contentWords * 2;

    const type = buf.readInt32LE(body);
    if (type === NULL_SHAPE) continue;
    if (type !== POLYGON && type !== POLYGON_Z) {
      throw new Error(
        `shp: record ${recordNumber} is shape type ${type}; this reader handles ` +
          "polygons (5) and polygonZ (15) only",
      );
    }

    const bbox: [number, number, number, number] = [
      buf.readDoubleLE(body + 4),
      buf.readDoubleLE(body + 12),
      buf.readDoubleLE(body + 20),
      buf.readDoubleLE(body + 28),
    ];
    const numParts = buf.readInt32LE(body + 36);
    const numPoints = buf.readInt32LE(body + 40);

    const partStarts: number[] = [];
    for (let i = 0; i < numParts; i += 1) partStarts.push(buf.readInt32LE(body + 44 + i * 4));

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
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const recordCount = buf.readUInt32LE(4);

  const fields: Array<{ name: string; length: number }> = [];
  for (let p = 32; buf[p] !== 0x0d && p < headerLength; p += 32) {
    const name = buf.toString("ascii", p, p + 11).replace(/\0.*$/, "");
    fields.push({ name, length: buf[p + 16]! });
  }

  const out: Record<string, string>[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const start = headerLength + i * recordLength;
    if (buf[start] === 0x2a) continue; // deleted record marker
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
  const rows = readDbf(dbf.data, encodingFrom(entries));
  if (shapes.length !== rows.length) {
    throw new Error(
      `shapefile pairing is broken: ${shapes.length} geometries against ${rows.length} ` +
        "attribute rows. Records pair BY POSITION, so a mismatch means every feature " +
        "past the first gap carries another feature's name.",
    );
  }

  return {
    features: shapes.map((s, i) => ({
      properties: rows[i]!,
      rings: s.rings,
      bbox: s.bbox,
    })),
    counts: `${shapes.length} geometries, ${rows.length} attribute rows, paired`,
  };
}
