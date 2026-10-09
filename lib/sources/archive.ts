/** One complete ZIP reader for source archives, workbooks and state geometry.
 * Large sources are opened from a staged file and decoded one member at a time.
 * A consumer must finish each stream before committing its parsed records. */
import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInflateRaw, inflateRawSync } from "node:zlib";

export interface ArchiveLimits {
  readonly maxEntries?: number;
  readonly maxMemberBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxDirectoryBytes?: number;
}
const DEFAULTS = { maxEntries: 100_000, maxMemberBytes: 128 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024, maxDirectoryBytes: 32 * 1024 * 1024 };
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let v = n;
  for (let bit = 0; bit < 8; bit++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return crc >>> 0;
}
export const archiveCrc32 = (bytes: Uint8Array): number => (crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
const fail = (why: string): never => { throw new Error(`ZIP_INVALID:${why}`); };
function bounds(bytes: Buffer, offset: number, size: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) fail("truncated structure");
}
function u16(bytes: Buffer, offset: number): number { bounds(bytes, offset, 2); return bytes.readUInt16LE(offset); }
function u32(bytes: Buffer, offset: number): number { bounds(bytes, offset, 4); return bytes.readUInt32LE(offset); }
function u64(bytes: Buffer, offset: number): number {
  bounds(bytes, offset, 8); const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("ZIP64 value exceeds safe file offsets");
  return Number(value);
}
function limitsOf(options: ArchiveLimits) {
  const limits = { ...DEFAULTS, ...options };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) fail("invalid resource bound");
  return limits;
}
interface Directory { count: number; offset: number; size: number }
interface Member { name: string; size: number; compressed: number; offset: number; flags: number; method: number; crc: number }
function endDirectory(tail: Buffer, start: number, fileSize: number): { directory: Directory; zip64Offset?: number; end: number } {
  let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) {
    if (u32(tail, p) === 0x06054b50 && p + 22 + u16(tail, p + 20) === tail.length) { end = p; break; }
  }
  if (end < 0) fail("end of central directory missing");
  if (u16(tail, end + 4) || u16(tail, end + 6) || u16(tail, end + 8) !== u16(tail, end + 10)) fail("multiple disks");
  const directory = { count: u16(tail, end + 10), size: u32(tail, end + 12), offset: u32(tail, end + 16) };
  if (directory.count === 0xffff || directory.size === 0xffffffff || directory.offset === 0xffffffff) {
    if (end < 20 || u32(tail, end - 20) !== 0x07064b50 || u32(tail, end - 16) !== 0 || u32(tail, end - 4) !== 1) fail("ZIP64 locator invalid");
    const zip64Offset = u64(tail, end - 12);
    if (zip64Offset + 56 > fileSize) fail("ZIP64 directory outside file");
    return { directory, zip64Offset, end: start + end - 20 };
  }
  return { directory, end: start + end };
}
function zip64Directory(bytes: Buffer, offset: number, end: number): Directory {
  if (u32(bytes, 0) !== 0x06064b50 || u64(bytes, 4) < 44 || offset + 12 + u64(bytes, 4) !== end ||
      u32(bytes, 16) !== 0 || u32(bytes, 20) !== 0 || u64(bytes, 24) !== u64(bytes, 32)) fail("ZIP64 directory invalid");
  return { count: u64(bytes, 32), size: u64(bytes, 40), offset: u64(bytes, 48) };
}
function checkDirectory(d: Directory, end: number, limits: ReturnType<typeof limitsOf>) {
  if (d.count > limits.maxEntries || d.size > limits.maxDirectoryBytes) fail("directory resource bound exceeded");
  if (d.offset + d.size !== end) fail("central directory size does not reconcile");
}
function members(bytes: Buffer, d: Directory, limits: ReturnType<typeof limitsOf>): Member[] {
  const result: Member[] = [], names = new Set<string>();
  let p = 0, total = 0;
  for (let i = 0; i < d.count; i++) {
    bounds(bytes, p, 46);
    if (u32(bytes, p) !== 0x02014b50) fail("central member header invalid");
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10);
    if (flags & ~0x080e || flags & 1 || ![0, 8].includes(method)) fail("unsupported encryption, flags or compression");
    const n = u16(bytes, p + 28), e = u16(bytes, p + 30), c = u16(bytes, p + 32);
    bounds(bytes, p + 46, n + e + c);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "windows-1252", { fatal: true }).decode(bytes.subarray(p + 46, p + 46 + n));
    if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..") || names.has(name)) fail(`unsafe or duplicate name: ${name}`);
    names.add(name);
    let size = u32(bytes, p + 24), compressed = u32(bytes, p + 20), offset = u32(bytes, p + 42);
    if (size === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff) {
      let extra = p + 46 + n, found = false;
      while (extra + 4 <= p + 46 + n + e) {
        const id = u16(bytes, extra), length = u16(bytes, extra + 2); extra += 4;
        if (extra + length > p + 46 + n + e) fail("extra field truncated");
        if (id === 1) {
          let at = extra;
          const read = () => { if (at + 8 > extra + length) fail("ZIP64 member truncated"); const value = u64(bytes, at); at += 8; return value; };
          if (size === 0xffffffff) size = read();
          if (compressed === 0xffffffff) compressed = read();
          if (offset === 0xffffffff) offset = read();
          found = true; break;
        }
        extra += length;
      }
      if (!found) fail("ZIP64 member sizes absent");
    }
    total += size;
    if (size > limits.maxMemberBytes || total > limits.maxTotalBytes || !Number.isSafeInteger(total)) fail("expanded resource bound exceeded");
    if (u16(bytes, p + 34) !== 0 || offset + 30 + compressed > d.offset) fail("member outside archive data");
    result.push({ name, size, compressed, offset, flags, method, crc: u32(bytes, p + 16) });
    p += 46 + n + e + c;
  }
  if (p !== bytes.length) fail("central directory member count mismatch");
  return result;
}
function localStart(header: Buffer, member: Member, centralOffset: number): number {
  if (u32(header, 0) !== 0x04034b50 || u16(header, 6) !== member.flags || u16(header, 8) !== member.method) fail(`${member.name}: local header mismatch`);
  const n = u16(header, 26), e = u16(header, 28); bounds(header, 30, n + e);
  const name = new TextDecoder(member.flags & 0x800 ? "utf-8" : "windows-1252", { fatal: true }).decode(header.subarray(30, 30 + n));
  if (name !== member.name || (!(member.flags & 8) && u32(header, 14) !== member.crc)) fail(`${member.name}: local identity mismatch`);
  if (!(member.flags & 8) && ((u32(header, 18) !== 0xffffffff && u32(header, 18) !== member.compressed) ||
    (u32(header, 22) !== 0xffffffff && u32(header, 22) !== member.size))) fail(`${member.name}: local size mismatch`);
  const start = member.offset + 30 + n + e;
  if (start + member.compressed > centralOffset) fail(`${member.name}: data overlaps directory`);
  return start;
}
function checkMemberRanges(entries: readonly { member: Member; start: number }[]) {
  const sorted = [...entries].sort((a, b) => a.member.offset - b.member.offset);
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1]!.start + sorted[i - 1]!.member.compressed > sorted[i]!.member.offset) fail("overlapping member data");
}
export function readZipEntries(value: Uint8Array, options: ArchiveLimits = {}): { name: string; data: Buffer }[] {
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength), limits = limitsOf(options);
  const end = endDirectory(bytes, 0, bytes.length);
  const d = end.zip64Offset === undefined ? end.directory : zip64Directory(bytes.subarray(end.zip64Offset), end.zip64Offset, end.end);
  checkDirectory(d, end.zip64Offset ?? end.end, limits); bounds(bytes, d.offset, d.size);
  const entries = members(bytes.subarray(d.offset, d.offset + d.size), d, limits).map(member => ({ member, start: localStart(bytes.subarray(member.offset), member, d.offset) }));
  checkMemberRanges(entries);
  return entries.map(({ member, start }) => {
    const compressed = bytes.subarray(start, start + member.compressed);
    const data = member.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, member.size) });
    if (data.length !== member.size || archiveCrc32(data) !== member.crc) fail(`${member.name}: size or CRC mismatch`);
    return { name: member.name, data };
  });
}
export interface FileArchiveMember { readonly name: string; readonly size: number; stream(): AsyncIterable<Uint8Array> }
export async function openZipFile(path: string, options: ArchiveLimits = {}): Promise<FileArchiveMember[]> {
  const limits = limitsOf(options), file = await open(path, "r");
  try {
    const stat = await file.stat();
    const read = async (offset: number, size: number) => {
      if (offset < 0 || offset + size > stat.size) fail("file structure outside archive");
      const buffer = Buffer.alloc(size); let at = 0;
      while (at < size) { const r = await file.read(buffer, at, size - at, offset + at); if (!r.bytesRead) fail("file truncated"); at += r.bytesRead; }
      return buffer;
    };
    const tailSize = Math.min(stat.size, 65_557), start = stat.size - tailSize;
    const end = endDirectory(await read(start, tailSize), start, stat.size);
    const d = end.zip64Offset === undefined ? end.directory : zip64Directory(await read(end.zip64Offset, 56), end.zip64Offset, end.end);
    checkDirectory(d, end.zip64Offset ?? end.end, limits);
    const entries = members(await read(d.offset, d.size), d, limits);
    const result: FileArchiveMember[] = [], ranges: { member: Member; start: number }[] = [];
    for (const member of entries) {
      const header = await read(member.offset, 30);
      const dataStart = localStart(await read(member.offset, 30 + u16(header, 26) + u16(header, 28)), member, d.offset);
      ranges.push({ member, start: dataStart });
      result.push({ name: member.name, size: member.size, async *stream() {
        let size = 0, crc = 0xffffffff;
        if (member.compressed === 0) { if (member.size !== 0 || member.crc !== 0) fail(`${member.name}: empty member mismatch`); return; }
        const source = createReadStream(path, { start: dataStart, end: dataStart + member.compressed - 1 });
        const decoded = member.method === 8 ? source.pipe(createInflateRaw()) : source;
        // Propagate source read errors through the decompressor as well.
        if (decoded !== source) source.on("error", error => decoded.destroy(error));
        try {
          for await (const chunk of decoded) {
            const bytes = chunk as Buffer; size += bytes.length;
            if (size > member.size || size > limits.maxMemberBytes) fail(`${member.name}: expanded resource bound exceeded`);
            crc = crcUpdate(crc, bytes); yield bytes;
          }
          if (size !== member.size || ((crc ^ 0xffffffff) >>> 0) !== member.crc) fail(`${member.name}: size or CRC mismatch`);
        } finally { source.destroy(); decoded.destroy(); }
      } });
    }
    checkMemberRanges(ranges); return result;
  } finally { await file.close(); }
}
