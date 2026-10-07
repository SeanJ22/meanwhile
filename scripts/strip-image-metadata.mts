/**
 * Strip embedded metadata (camera serials, GPS, editing history) from portrait
 * images before they are committed and served.
 *
 * Pure byte transforms, no image decoding, so the pixels are untouched:
 * - JPEG: drops APP1 (EXIF + XMP) and COM segments. JFIF (APP0), ICC
 *   (APP2) and Adobe (APP14) segments stay — removing those can shift
 *   colors, and they carry no capture metadata.
 * - PNG: drops tEXt / zTXt / iTXt / eXIf / tIME chunks.
 *
 * Anything that is not a JPEG or PNG is returned unchanged with
 * `stripped: false` — the caller decides whether an unknown format ships.
 */

export interface StripResult {
  bytes: Buffer;
  /** True when the format was recognized and metadata segments removed. */
  stripped: boolean;
  /** Names of removed segments/chunks, for the run report. */
  removed: string[];
}

export function stripImageMetadata(input: Buffer): StripResult {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8) {
    return stripJpeg(input);
  }
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (input.length >= 8 && input.subarray(0, 8).equals(pngSig)) {
    return stripPng(input);
  }
  return { bytes: input, stripped: false, removed: [] };
}

function stripJpeg(input: Buffer): StripResult {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const removed: string[] = [];
  let i = 2;
  while (i < input.length) {
    // Not a marker where one is expected: keep the rest verbatim rather
    // than guessing at a malformed file's structure.
    if (input[i] !== 0xff) {
      out.push(input.subarray(i));
      break;
    }
    const marker = input[i + 1];
    // SOS: entropy-coded data follows to EOI — copy the remainder whole.
    if (marker === 0xda) {
      out.push(input.subarray(i));
      break;
    }
    // Standalone markers (no length): EOI, TEM, RSTn.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(input.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = input.readUInt16BE(i + 2);
    const segment = input.subarray(i, i + 2 + len);
    // APP1 carries EXIF and XMP; COM carries free-text comments.
    if (marker === 0xe1 || marker === 0xfe) {
      removed.push(marker === 0xe1 ? "APP1" : "COM");
    } else {
      out.push(segment);
    }
    i += 2 + len;
  }
  return { bytes: Buffer.concat(out), stripped: true, removed };
}

const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(input: Buffer): StripResult {
  const out: Buffer[] = [input.subarray(0, 8)];
  const removed: string[] = [];
  let i = 8;
  while (i + 8 <= input.length) {
    const len = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8).toString("latin1");
    const chunk = input.subarray(i, i + 12 + len);
    if (PNG_METADATA_CHUNKS.has(type)) {
      removed.push(type);
    } else {
      out.push(chunk);
    }
    i += 12 + len;
    if (type === "IEND") break;
  }
  return { bytes: Buffer.concat(out), stripped: true, removed };
}
