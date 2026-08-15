import assert from "node:assert/strict";
import test from "node:test";

import { stripImageMetadata } from "../scripts/strip-image-metadata.mts";

/**
 * The EXIF rule (photo session, 2026-08-14): committed portraits carry no
 * embedded metadata. Synthetic files, not fixtures — the structures under
 * test are the container formats, not any particular photo.
 */

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

test("JPEG: APP1 (EXIF) and COM go, JFIF and pixel data stay", () => {
  const jfif = jpegSegment(0xe0, Buffer.from("JFIF\0"));
  const exif = jpegSegment(0xe1, Buffer.from("Exif\0\0gps-coords-here"));
  const comment = jpegSegment(0xfe, Buffer.from("shot on a phone"));
  const sos = Buffer.concat([
    Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02]),
    Buffer.from("entropy-coded-data"),
    Buffer.from([0xff, 0xd9]),
  ]);
  const input = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, comment, sos]);

  const result = stripImageMetadata(input);
  assert.equal(result.stripped, true);
  assert.deepEqual(result.removed.sort(), ["APP1", "COM"]);
  assert.ok(!result.bytes.includes("gps-coords-here"), "EXIF payload removed");
  assert.ok(!result.bytes.includes("shot on a phone"), "comment removed");
  assert.ok(result.bytes.includes("JFIF"), "JFIF segment kept");
  assert.ok(result.bytes.includes("entropy-coded-data"), "pixel data kept");
});

function pngChunk(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, "latin1");
  // CRC bytes are structural filler here; the stripper never validates them.
  return Buffer.concat([head, payload, Buffer.alloc(4)]);
}

test("PNG: text and eXIf chunks go, IHDR/IDAT/IEND stay", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const input = Buffer.concat([
    sig,
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("tEXt", Buffer.from("Author\0somebody")),
    pngChunk("eXIf", Buffer.from("exif-blob")),
    pngChunk("IDAT", Buffer.from("pixels")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  const result = stripImageMetadata(input);
  assert.equal(result.stripped, true);
  assert.deepEqual(result.removed.sort(), ["eXIf", "tEXt"]);
  assert.ok(!result.bytes.includes("somebody"));
  assert.ok(!result.bytes.includes("exif-blob"));
  assert.ok(result.bytes.includes("pixels"));
  assert.ok(result.bytes.includes("IEND"));
});

test("unknown formats pass through unchanged and say so", () => {
  const input = Buffer.from("GIF89a-not-handled");
  const result = stripImageMetadata(input);
  assert.equal(result.stripped, false);
  assert.ok(result.bytes.equals(input));
});
