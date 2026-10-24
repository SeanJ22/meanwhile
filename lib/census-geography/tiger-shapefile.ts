/** Full-resolution TIGER geometry is decoded one SHP record at a time. The
 * national ZCTA archive never becomes a country-sized array of coordinates. */
import { parseShapeRecord, readDbfRecords, type Feature } from "../geo/shapefile.ts";
import { openZipFile, type FileArchiveMember } from "../sources/archive.ts";
import { TIGER_ARCHIVE_LIMITS } from "./tiger-source.ts";

const MAX_RECORD_BYTES = 256 * 1024 * 1024;
async function memberBytes(member: FileArchiveMember, signal?: AbortSignal, maxBytes = 128 * 1024 * 1024): Promise<Buffer> {
  // Attributes are small; the national SHP member always uses RecordStream.
  if (member.size > maxBytes) throw new Error("shapefile: attribute or sidecar byte bound exceeded");
  const bytes = Buffer.alloc(member.size);
  let at = 0;
  for await (const chunk of member.stream()) {
    signal?.throwIfAborted();
    bytes.set(chunk, at); at += chunk.byteLength;
  }
  return bytes;
}
class RecordStream {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private readonly signal?: AbortSignal;
  private chunk: Buffer = Buffer.alloc(0);
  private at = 0;
  constructor(member: FileArchiveMember, signal?: AbortSignal) { this.signal = signal; this.iterator = member.stream()[Symbol.asyncIterator](); }
  async read(size: number): Promise<Buffer> {
    this.signal?.throwIfAborted();
    const bytes = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) {
      this.signal?.throwIfAborted();
      if (this.at === this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) throw new Error("shp: truncated complete file");
        this.chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        this.at = 0;
      }
      const n = Math.min(size - filled, this.chunk.length - this.at);
      this.chunk.copy(bytes, filled, this.at, this.at + n); this.at += n; filled += n;
    }
    return bytes;
  }
  async finish(): Promise<void> {
    if (this.at !== this.chunk.length) throw new Error("shp: bytes past complete file length");
    this.signal?.throwIfAborted();
    if (!(await this.iterator.next()).done) throw new Error("shp: bytes past complete file length");
  }
  async close(): Promise<void> {
    try {
      // Even an early consumer return finishes the member CRC. An aborted
      // acquisition stops reading promptly and can never admit the source.
      if (!this.signal?.aborted) {
        for (;;) { this.signal?.throwIfAborted(); if ((await this.iterator.next()).done) break; }
      }
    } finally { await this.iterator.return?.(); }
  }
}
/** Consumers finish this iterator before publishing overlaps. The whitelist
 * limits returned ZCTAs to those touching the worker's held state scope. */
export async function* tigerFeatures(path: string, wantedZctas?: ReadonlySet<string>, signal?: AbortSignal,
  wantedFeature?: (properties: Readonly<Record<string, string>>) => boolean): AsyncIterable<Feature> {
  signal?.throwIfAborted();
  const entries = await openZipFile(path, TIGER_ARCHIVE_LIMITS);
  const shapes = entries.filter(entry => entry.name.toLowerCase().endsWith(".shp"));
  if (shapes.length !== 1) throw new Error("boundary zip must hold exactly one .shp");
  const shp = shapes[0], stem = shp.name.slice(0, -4).toLowerCase();
  const dbf = entries.find(entry => entry.name.toLowerCase() === `${stem}.dbf`);
  if (!dbf) throw new Error("boundary zip holds no paired .dbf");
  const prj = entries.find(entry => entry.name.toLowerCase() === `${stem}.prj`);
  if (!prj) throw new Error("boundary zip holds no paired .prj coordinate reference");
  const projection = (await memberBytes(prj, signal, 64 * 1024)).toString("ascii").trim();
  if (!/^GEOGCS\s*\[/i.test(projection) || !/(?:North[_ ]American[_ ]1983|NAD[_ ]?83|NAD[_ ]?1983)/i.test(projection) || !/UNIT\s*\[\s*"degrees?"/i.test(projection)) {
    throw new Error("shapefile: Census geographic NAD83 coordinates are required");
  }
  const cpg = entries.find(entry => entry.name.toLowerCase() === `${stem}.cpg`);
  const declared = cpg ? (await memberBytes(cpg, signal, 64 * 1024)).toString("ascii").trim().toUpperCase() : "";
  const rows = readDbfRecords(await memberBytes(dbf, signal), /UTF-?8/.test(declared) ? "utf8" : "latin1");
  const stream = new RecordStream(shp, signal);
  try {
    const header = await stream.read(100);
    if (header.readInt32BE(24) * 2 !== shp.size) throw new Error("shp: invalid complete file length");
    let bytesRead = 100, ordinal = 0;
    while (bytesRead < shp.size) {
      if (bytesRead + 8 > shp.size) throw new Error("shp: truncated record header");
      const framing = await stream.read(8), number = framing.readInt32BE(0), length = framing.readInt32BE(4) * 2;
      if (number !== ordinal + 1 || length < 4 || bytesRead + 8 + length > shp.size) throw new Error("shp: invalid record framing");
      if (length > MAX_RECORD_BYTES) throw new Error("shp: geometry record byte bound exceeded");
      if (ordinal >= rows.length) throw new Error("shapefile pairing is broken: more geometries than attribute rows");
      const bytes = await stream.read(length), properties = rows[ordinal++];
      bytesRead += 8 + length;
      if (!properties) continue;
      if (wantedZctas && !wantedZctas.has(properties.ZCTA5CE20 ?? properties.ZCTA5CE10 ?? properties.GEOID20 ?? properties.GEOID10 ?? "")) continue;
      if (wantedFeature && !wantedFeature(properties)) continue;
      const geometry = parseShapeRecord(bytes, number);
      if (!geometry.rings.length) continue;
      yield { properties, rings: geometry.rings, bbox: geometry.bbox };
    }
    if (ordinal !== rows.length) throw new Error("shapefile pairing is broken: fewer geometries than attribute rows");
    await stream.finish();
  } finally { await stream.close(); }
}
