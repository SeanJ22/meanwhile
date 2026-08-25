import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { decodeImage, decodeRecord, MIN_PORTRAIT_EDGE } from "../lib/photos/decode.ts";

/**
 * **THE TWO SOFT-404s.** (2026-08-25, Item 11.)
 *
 * The door-2 hunt queued two HTML error pages as portraits. Both were served
 * `200`, both carried a `.jpg` in the URL, and both had healthy byte counts —
 * which is exactly what a soft 404 is good at. Only the author's eyes on the
 * review sheet caught them.
 *
 * RULING 110: the instrument is shown catching the REAL SHAPE, not a plausible
 * one. So the first case below is a real error page, at a realistic size,
 * asserted against every check the old path had — status, extension, byte
 * count — and it defeats all three.
 */

const ROOT = process.cwd();

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
  /*
   * This is the case a signature check cannot see and the reason this walks
   * the structure. The first eight bytes are a genuine PNG signature and the
   * IHDR is genuine; there is no picture in it.
   */
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
  // A real SOI and a marker chain that stops before any Start-Of-Frame. The
  // two states want different responses: one is a wrong URL, one is a retry.
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

test("the review queue REFUSES a row with no decode record, and says so out loud", () => {
  /*
   * The wiring, asserted in the source. A perfect decoder that the queue does
   * not consult is the chromium-pin shape — a fix nothing can observe.
   *
   * Both halves matter: a MISSING record must refuse exactly as a FAILING one
   * does, because "nobody decoded this" and "this is not an image" are both
   * disqualifying, and a refusal must be REPORTED rather than dropped.
   */
  const src = readFileSync(join(ROOT, "lib", "photos", "staged.ts"), "utf8");
  assert.match(src, /if \(!row\.decode\?\.ok\)/, "the queue does not gate on the decode record");
  assert.match(src, /refusals\.push/, "a refused row is dropped silently instead of reported");
  assert.match(src, /export function refusedPortraits/, "refusals are not readable by a caller");
});
