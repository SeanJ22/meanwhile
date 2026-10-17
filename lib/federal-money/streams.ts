import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { createInflateRaw } from "node:zlib";

export const FEDERAL_MONEY_CHUNK_ROWS = 500;
const MAX_RECORD_BYTES = 8 * 1024 * 1024 - 4096;
function decodeText(decoder: TextDecoder, bytes?: Uint8Array): string {
  try { return decoder.decode(bytes, { stream: bytes !== undefined }); }
  catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source document is not valid UTF-8."); }
}
export interface FederalZipEntry { readonly name: string; readonly offset: number; readonly compressed: number; readonly expanded: number; readonly method: number; readonly crc: number }
const safeNumber = (value: bigint) => { const number = Number(value); if (!Number.isSafeInteger(number)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive exceeds safe file offsets."); return number; };

export async function* federalZipEntries(path: string): AsyncGenerator<FederalZipEntry> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size, tail = Buffer.alloc(Math.min(size, 65_557));
    await file.read(tail, 0, tail.length, size - tail.length);
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--;
    if (end < 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive has no ZIP directory.");
    let count = tail.readUInt16LE(end + 10), position = tail.readUInt32LE(end + 16);
    if (count === 0xffff || position === 0xffffffff) {
      const locator = Buffer.alloc(20); await file.read(locator, 0, 20, size - tail.length + end - 20);
      if (locator.readUInt32LE() !== 0x07064b50) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive has no ZIP64 locator.");
      const record = Buffer.alloc(56); await file.read(record, 0, 56, safeNumber(locator.readBigUInt64LE(8)));
      if (record.readUInt32LE() !== 0x06064b50) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive has no ZIP64 directory.");
      count = safeNumber(record.readBigUInt64LE(32)); position = safeNumber(record.readBigUInt64LE(48));
    }
    for (let index = 0; index < count; index++) {
      const header = Buffer.alloc(46); await file.read(header, 0, 46, position);
      if (header.readUInt32LE() !== 0x02014b50 || (header.readUInt16LE(8) & 1)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive has an invalid or encrypted entry.");
      const nameSize = header.readUInt16LE(28), extraSize = header.readUInt16LE(30), commentSize = header.readUInt16LE(32);
      const variable = Buffer.alloc(nameSize + extraSize); await file.read(variable, 0, variable.length, position + 46);
      let compressed = header.readUInt32LE(20), expanded = header.readUInt32LE(24), offset = header.readUInt32LE(42);
      for (let at = nameSize; at + 4 <= variable.length;) {
        const tag = variable.readUInt16LE(at), length = variable.readUInt16LE(at + 2); at += 4;
        if (tag === 1) {
          let cursor = at;
          if (expanded === 0xffffffff) { expanded = safeNumber(variable.readBigUInt64LE(cursor)); cursor += 8; }
          if (compressed === 0xffffffff) { compressed = safeNumber(variable.readBigUInt64LE(cursor)); cursor += 8; }
          if (offset === 0xffffffff) offset = safeNumber(variable.readBigUInt64LE(cursor));
        }
        at += length;
      }
      yield { name: variable.subarray(0, nameSize).toString("utf8"), offset, compressed, expanded, method: header.readUInt16LE(10), crc: header.readUInt32LE(16) };
      position += 46 + nameSize + extraSize + commentSize;
    }
  } finally { await file.close(); }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export async function* federalZipBytes(path: string, entry: FederalZipEntry): AsyncGenerator<Buffer> {
  const file = await open(path, "r");
  let start: number;
  try { const header = Buffer.alloc(30); await file.read(header, 0, 30, entry.offset); if (header.readUInt32LE() !== 0x04034b50) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive entry has no local header."); start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28); }
  finally { await file.close(); }
  if (![0, 8].includes(entry.method)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive uses an unsupported compression method.");
  if (!entry.compressed) { if (entry.expanded) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive has a truncated entry."); return; }
  const input = createReadStream(path, { start, end: start + entry.compressed - 1, highWaterMark: 64 * 1024 });
  const stream = entry.method === 8 ? input.pipe(createInflateRaw()) : input;
  let length = 0, crc = 0xffffffff;
  try {
    for await (const bytes of stream) { const chunk = bytes as Buffer; length += chunk.length; for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8); yield chunk; }
    if (length !== entry.expanded || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source archive entry failed its length or checksum check.");
  } finally { stream.destroy(); input.destroy(); }
}

export async function* federalCsvRecords(input: AsyncIterable<Uint8Array>, encoding = "utf-8", quote: string | null = '"'): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  let record = "", quoted = false;
  for await (const bytes of input) {
    const text = decodeText(decoder, bytes);
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === quote) quoted = !quoted;
      if (text[index] === "\n" && !quoted) { record += text.slice(start, index + 1); if (record.length > MAX_RECORD_BYTES) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A source CSV row exceeds the record size limit."); yield record; record = ""; start = index + 1; }
    }
    record += text.slice(start);
    if (record.length > MAX_RECORD_BYTES) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A source CSV row exceeds the record size limit.");
  }
  record += decodeText(decoder);
  if (quoted) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source CSV ends inside a quoted field.");
  if (record) yield record;
}

export interface FederalJsonEnvelope { value?: Record<string, unknown>; rows: number; found: boolean }
export async function* federalJsonRecords(input: AsyncIterable<Uint8Array>, arrayKey: string, envelope: FederalJsonEnvelope): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let control = "", depth = 0, inString = false, escaped = false, keyBuffer = "", readingKey = false, selected = false, rowDepth = 0, ended = false, needsComma = false;
  let rowParts: string[] = [], rowLength = 0;
  const keys: string[] = [];
  let keyDepth = 0;
  async function* consume(text: string): AsyncGenerator<string> {
    let rowStart = rowDepth ? 0 : -1;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (selected && !ended) {
        if (!rowDepth) {
          if (/\s/.test(char)) continue;
          if (char === "," && needsComma) { needsComma = false; continue; }
          if (char === "]" && (needsComma || envelope.rows === 0)) { selected = false; ended = true; control += "]"; depth--; continue; }
          if (char !== "{" || needsComma) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source JSON array has an invalid row or separator.");
          rowParts = []; rowLength = 0; rowStart = index; rowDepth = 1; inString = false; continue;
        }
        if (inString) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; }
        else if (char === '"') inString = true;
        else if (char === "{" || char === "[") rowDepth++;
        else if (char === "}" || char === "]") rowDepth--;
        if (rowLength + index - rowStart + 1 > MAX_RECORD_BYTES) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A source JSON row exceeds the record size limit.");
        if (!rowDepth) {
          rowParts.push(text.slice(rowStart, index + 1));
          const row = rowParts.length === 1 ? rowParts[0] : rowParts.join("");
          JSON.parse(row); envelope.rows++; needsComma = true;
          yield row;
          rowParts = []; rowLength = 0; rowStart = -1;
        }
        continue;
      }
      control += char;
      if (control.length > 256 * 1024) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source JSON control envelope exceeds its size limit.");
      if (inString) {
        if (readingKey) keyBuffer += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') { inString = false; if (readingKey) { keys[keyDepth] = JSON.parse(`"${keyBuffer}`) as string; readingKey = false; } }
        continue;
      }
      if (char === '"') { inString = true; readingKey = depth > 0; keyDepth = depth - 1; keyBuffer = ""; }
      else if (char === "{" || char === "[") {
        if (char === "[" && (depth === 0 || keys.slice(0, depth).join(".") === arrayKey)) { selected = true; envelope.found = true; }
        depth++;
      } else if (char === "}" || char === "]") depth--;
    }
    if (rowDepth && rowStart >= 0) { const part = text.slice(rowStart); rowParts.push(part); rowLength += part.length; }
  }
  for await (const bytes of input) yield* consume(decodeText(decoder, bytes));
  yield* consume(decodeText(decoder));
  if (selected || rowDepth || inString || depth !== 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The source JSON ended before its records were complete.");
  const parsed: unknown = JSON.parse(control.replace(/^\uFEFF/, ""));
  envelope.value = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
