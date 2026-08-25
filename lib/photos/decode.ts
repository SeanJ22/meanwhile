/**
 * **A STAGED PORTRAIT MUST DECODE AS AN IMAGE BEFORE IT CAN QUEUE.**
 * (2026-08-25, Item 11 of the one-session brief.)
 *
 * ## What happened
 *
 * The door-2 hunt of the night before queued **two soft-404 HTML pages as
 * portraits**. Both had healthy byte counts — a 404 page is several kilobytes
 * of real markup — both were served at `200`, and both carried a `.jpg` in the
 * URL. Nothing between the fetch and the review sheet asked whether the bytes
 * were an image, so two error pages went into a queue whose entire purpose is
 * to put a face in front of the author, and only his eyes on the sheet caught
 * them.
 *
 * ## Why a status code and a byte count cannot catch it
 *
 * They are the two things a soft 404 is specifically good at. `200` is what
 * makes it SOFT, and the byte count of an error page is indistinguishable from
 * the byte count of a portrait. RULING 117 settled the same question for the
 * asset store and settled it the same way: **a 200 that is not the thing is
 * not a document**, and the check has to be on the CONTENT.
 *
 * ## Magic bytes, and then an actual decode
 *
 * Magic bytes alone are necessary and not sufficient — they read four bytes
 * and say nothing about the 40,000 after them, so a truncated file, a
 * half-written download, or an image whose body is an error page with a
 * borrowed header all pass. So each format is walked through its own structure
 * until the DIMENSIONS fall out of it:
 *
 * - **PNG** — the signature, then `IHDR` at the position the spec fixes it at,
 *   then a scan for `IDAT`, because a PNG with no image data is a header.
 * - **JPEG** — the SOI, then the marker chain walked segment by segment to a
 *   Start-Of-Frame. A file that runs out of bytes before one is not a JPEG.
 * - **GIF** and **WebP** — signature plus the dimension fields their headers
 *   carry.
 *
 * Reaching a real width and height means the byte stream was structurally an
 * image for as far as it needed to be. An HTML page cannot produce one, and
 * neither can a truncated download.
 *
 * ## Why this is a module rather than a function in the fetcher
 *
 * There WAS a dimension reader — `imageSize` inside
 * `scripts/fetch-official-portraits.mts` — and it was perfectly good. It lived
 * in one script, so the door-2 hunt did not call it, and a check nobody can
 * reach from a second staging path is a check the second staging path does not
 * have. RULING 103: fix at the shared code path.
 */

/** The smallest a portrait may be and still be a portrait rather than an icon. */
export const MIN_PORTRAIT_EDGE = 96;

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

export type DecodeVerdict =
  | {
      ok: true;
      format: ImageFormat;
      width: number;
      height: number;
      bytes: number;
    }
  | {
      ok: false;
      /** Named states, never a bare false — a caller must be able to say WHY. */
      reason:
        | "EMPTY"
        | "NOT_AN_IMAGE"
        | "TRUNCATED"
        | "NO_IMAGE_DATA"
        | "TOO_SMALL";
      /** What it looked like instead, for a report a person can act on. */
      detail: string;
      bytes: number;
    };

/** The first bytes, rendered readably for a report. Never the whole payload. */
function sniff(buf: Uint8Array): string {
  const head = Buffer.from(buf.subarray(0, 64)).toString("utf8");
  const printable = head.replace(/[^\x20-\x7e]/g, "·").trim();
  return printable.slice(0, 60);
}

function startsWith(buf: Uint8Array, bytes: number[], at = 0): boolean {
  if (buf.length < at + bytes.length) return false;
  return bytes.every((b, i) => buf[at + i] === b);
}

/**
 * Walk a JPEG's marker chain to a Start-Of-Frame.
 *
 * Returns `null` for a stream that ends before one, which is the truncated
 * case and is a different answer from "not a JPEG at all".
 */
function jpegSize(buf: Uint8Array): { w: number; h: number } | null {
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 2;
  while (i < view.length - 9) {
    if (view[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = view[i + 1];
    // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc), which sit in the
    // same numeric range and are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: view.readUInt16BE(i + 5), w: view.readUInt16BE(i + 7) };
    }
    const length = view.readUInt16BE(i + 2);
    if (length < 2) return null; // a malformed segment length loops forever
    i += 2 + length;
  }
  return null;
}

/**
 * Decode enough of `buf` to be certain it is an image, and say how big.
 *
 * Every failure is NAMED. A caller that cannot tell "this is an HTML page"
 * from "this is a truncated JPEG" cannot write a useful report, and the two
 * want different responses — one is a wrong URL, the other is a retry.
 */
export function decodeImage(buf: Uint8Array): DecodeVerdict {
  const bytes = buf.length;
  if (bytes === 0) {
    return { ok: false, reason: "EMPTY", detail: "zero bytes", bytes };
  }

  let format: ImageFormat | null = null;
  let size: { w: number; h: number } | null = null;

  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    format = "png";
    if (bytes < 24) {
      return { ok: false, reason: "TRUNCATED", detail: "a PNG shorter than its own IHDR", bytes };
    }
    const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    // The spec fixes IHDR as the first chunk, at offset 12.
    if (view.subarray(12, 16).toString("ascii") !== "IHDR") {
      return { ok: false, reason: "TRUNCATED", detail: "a PNG whose first chunk is not IHDR", bytes };
    }
    // A PNG with no IDAT is a header with no picture in it.
    if (!view.includes(Buffer.from("IDAT", "ascii"))) {
      return { ok: false, reason: "NO_IMAGE_DATA", detail: "a PNG carrying no IDAT chunk", bytes };
    }
    size = { w: view.readUInt32BE(16), h: view.readUInt32BE(20) };
  } else if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    format = "jpeg";
    size = jpegSize(buf);
    if (!size) {
      return {
        ok: false,
        reason: "TRUNCATED",
        detail: "a JPEG whose marker chain ends before any Start-Of-Frame",
        bytes,
      };
    }
  } else if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) {
    format = "gif";
    if (bytes < 10) {
      return { ok: false, reason: "TRUNCATED", detail: "a GIF shorter than its header", bytes };
    }
    const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    size = { w: view.readUInt16LE(6), h: view.readUInt16LE(8) };
  } else if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    format = "webp";
    const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    // VP8X carries the canvas size as two 24-bit minus-one fields.
    if (view.subarray(12, 16).toString("ascii") === "VP8X" && bytes >= 30) {
      size = {
        w: (view.readUIntLE(24, 3) ?? 0) + 1,
        h: (view.readUIntLE(27, 3) ?? 0) + 1,
      };
    } else if (view.subarray(12, 16).toString("ascii") === "VP8L" && bytes >= 25) {
      const b = view.readUInt32LE(21);
      size = { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    } else if (bytes >= 30) {
      size = { w: view.readUInt16LE(26) & 0x3fff, h: view.readUInt16LE(28) & 0x3fff };
    }
    if (!size) {
      return { ok: false, reason: "TRUNCATED", detail: "a WebP shorter than its header", bytes };
    }
  }

  if (!format || !size) {
    return {
      ok: false,
      reason: "NOT_AN_IMAGE",
      detail: `no image signature — it begins "${sniff(buf)}"`,
      bytes,
    };
  }

  if (size.w < MIN_PORTRAIT_EDGE || size.h < MIN_PORTRAIT_EDGE) {
    return {
      ok: false,
      reason: "TOO_SMALL",
      detail: `${size.w}x${size.h} — smaller than ${MIN_PORTRAIT_EDGE}px on an edge, so it is an icon rather than a portrait`,
      bytes,
    };
  }

  return { ok: true, format, width: size.w, height: size.h, bytes };
}

/**
 * The record a staging artifact must carry before a row may reach the review
 * sheet. Written by whatever fetched the bytes, because that is the only place
 * the bytes exist.
 */
export interface PortraitDecodeRecord {
  ok: boolean;
  format?: ImageFormat;
  width?: number;
  height?: number;
  bytes?: number;
  reason?: string;
  detail?: string;
  /** When the bytes were read. A decode is a measurement and carries its date. */
  decodedAt: string;
}

/** Shape a verdict into the record a staging artifact stores. */
export function decodeRecord(verdict: DecodeVerdict, decodedAt: string): PortraitDecodeRecord {
  return verdict.ok
    ? {
        ok: true,
        format: verdict.format,
        width: verdict.width,
        height: verdict.height,
        bytes: verdict.bytes,
        decodedAt,
      }
    : {
        ok: false,
        reason: verdict.reason,
        detail: verdict.detail,
        bytes: verdict.bytes,
        decodedAt,
      };
}
