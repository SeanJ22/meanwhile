import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PORTRAIT_ACCEPT } from "../lib/photos/decode.ts";

// The Accept header and the decoder's formats must move together: a host that content-negotiates returns a format
// we cannot decode, and the hunt then reports a false absence of a portrait.

const ROOT = join(import.meta.dirname, "..");

/** Every format `decodeImage` actually branches on, read from its source. */
const DECODABLE = ["png", "jpeg", "gif", "webp"] as const;

test("the portrait Accept header offers nothing the decoder cannot read", () => {
  const offered = PORTRAIT_ACCEPT.split(",")
    .map((part) => part.split(";")[0].trim())
    .filter((type) => type.startsWith("image/"))
    .map((type) => type.slice("image/".length));

  assert.ok(offered.length > 0, "the header must name at least one image type");

  for (const type of offered) {
    assert.ok(
      (DECODABLE as readonly string[]).includes(type),
      `the Accept header offers image/${type}, which decodeImage cannot read — ` +
        `a host that honours it hands us a portrait we will record as absent`,
    );
  }
});

test("the header offers EVERY format the decoder can read", () => {
  // A format dropped from the header is a portrait declined and then reported missing.
  for (const format of DECODABLE) {
    assert.ok(
      PORTRAIT_ACCEPT.includes(`image/${format}`),
      `decodeImage reads ${format} but the Accept header does not offer it`,
    );
  }
});

test("the declared decodable set still matches what decodeImage branches on", () => {
  // Reads the module's own `ImageFormat` union rather than trusting the copy above.
  const src = readFileSync(join(ROOT, "lib", "photos", "decode.ts"), "utf8");
  const match = src.match(/export type ImageFormat =([^;]+);/);
  assert.ok(match, "could not find the ImageFormat union in lib/photos/decode.ts");

  const declared = [...match[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    declared,
    [...DECODABLE].sort(),
    "ImageFormat changed — update DECODABLE here AND PORTRAIT_ACCEPT in the same change",
  );
});

test("every portrait fetch sends the header rather than letting the host choose", () => {
  // With no Accept header the host picks the format, so the call sites must send it.
  const sites = [
    join(ROOT, "lib", "hunt", "portrait-pick.ts"),
  ];

  for (const site of sites) {
    const src = readFileSync(site, "utf8");
    assert.ok(
      src.includes("PORTRAIT_ACCEPT"),
      `${site} fetches portrait bytes but does not send PORTRAIT_ACCEPT`,
    );
  }
});
