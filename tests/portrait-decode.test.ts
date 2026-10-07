import assert from "node:assert/strict";
import test from "node:test";

import { decodeImage, decodeRecord, MIN_PORTRAIT_EDGE } from "../lib/photos/decode.ts";

// A soft 404 is served 200 with a `.jpg` URL and a healthy byte count; only decoding the structure catches it.

/** A soft 404, at the size a real one is. */
function softNotFound(): Uint8Array {
  const body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Page Not Found</title></head>
<body><h1>We can't find that page</h1>
<p>The page you requested is no longer available.</p>
${"<div class=\"filler\">navigation and footer markup</div>\n".repeat(120)}
</body></html>`;
  return new TextEncoder().encode(body);
}

/** A minimal but STRUCTURALLY REAL PNG, large enough to be a portrait. */
function realPng(width = 200, height = 250): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // colour type
  const idat = Buffer.alloc(20);
  idat.writeUInt32BE(8, 0);
  idat.write("IDAT", 4, "ascii");
  return new Uint8Array(Buffer.concat([sig, ihdr, idat]));
}

test("the soft 404 that got through: an HTML error page is refused as NOT_AN_IMAGE", () => {
  const bytes = softNotFound();

  // It defeats every check the old path actually had.
  assert.ok(bytes.length > 4000, "the fixture is not the realistic size a soft 404 is");

  const verdict = decodeImage(bytes);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "NOT_AN_IMAGE");
  // The report says what it saw instead, so a person can act on it.
  assert.match(verdict.detail, /DOCTYPE|html/i);
});

test("a real PNG decodes, and reports its own dimensions", () => {
  const verdict = decodeImage(realPng(200, 250));
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.equal(verdict.format, "png");
  assert.equal(verdict.width, 200);
  assert.equal(verdict.height, 250);
});

test("MAGIC BYTES ALONE ARE NOT ENOUGH: a PNG header with no image data is refused", () => {
  // A genuine PNG signature and IHDR with no picture in it: a signature check cannot see this.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(200, 8);
  ihdr.writeUInt32BE(250, 12);
  const verdict = decodeImage(new Uint8Array(Buffer.concat([sig, ihdr])));
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "NO_IMAGE_DATA");
});

test("a truncated JPEG is TRUNCATED, which is not the same answer as NOT_AN_IMAGE", () => {
  // A real SOI and a marker chain that stops before any Start-Of-Frame. The two states want different responses:
  // one is a wrong URL, one is a retry.
  const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(20).fill(0)]);
  const verdict = decodeImage(buf);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "TRUNCATED");
});

test("an icon-sized image is refused as TOO_SMALL, with both numbers stated", () => {
  const verdict = decodeImage(realPng(48, 48));
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "TOO_SMALL");
  assert.match(verdict.detail, /48x48/);
  assert.match(verdict.detail, new RegExp(String(MIN_PORTRAIT_EDGE)));
});

test("zero bytes is EMPTY — a failed fetch never reads as a bad image", () => {
  const verdict = decodeImage(new Uint8Array(0));
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "EMPTY");
});

test("the record carries the decode DATE, because a decode is a measurement", () => {
  const record = decodeRecord(decodeImage(realPng()), "2026-08-25");
  assert.equal(record.ok, true);
  assert.equal(record.decodedAt, "2026-08-25");
  const bad = decodeRecord(decodeImage(softNotFound()), "2026-08-25");
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "NOT_AN_IMAGE");
  assert.equal(bad.decodedAt, "2026-08-25");
});
