import { inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP reader — enough for a LegiScan dataset and nothing more.
 *
 * LegiScan's `getDataset` returns the whole session as one base64 ZIP. Node
 * ships `zlib` but no archive reader, and the alternative was a dependency
 * for a format we need exactly two things from: the file names and their
 * bytes. This reads the central directory (never the local headers, whose
 * sizes may be zeroed in favour of a data descriptor) and inflates each
 * entry.
 *
 * Supports stored (method 0) and deflated (method 8), which is what the
 * archives use. Anything else throws by name rather than returning empty —
 * a silently skipped entry is exactly the "operation that returned nothing"
 * failure this repo keeps finding.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The EOCD is at the end, after a comment of up to 65,535 bytes.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("not a zip archive: no end-of-central-directory record");
}

export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip central directory entry ${i} has a bad signature`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);

    // Directories are entries too; they carry no data worth inflating.
    if (!name.endsWith("/")) {
      // The local header's own name/extra lengths are what locate the data —
      // the central directory's `extra` field is frequently a different size.
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buf.subarray(start, start + compressedSize);

      let data: Buffer;
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = inflateRawSync(raw);
      else throw new Error(`zip entry "${name}" uses compression method ${method}`);

      entries.push({ name, data });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
