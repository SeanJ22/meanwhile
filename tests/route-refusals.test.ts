import assert from "node:assert/strict";
import test from "node:test";

import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as directoryGET } from "../app/api/directory/route.ts";
import {
  matching,
  numeric,
  numericInRange,
  rejectUnknown,
} from "../lib/api/params.ts";

/**
 * ITEM 1b (2026-08-17, the author's ruling): a route answered a question it
 * should have refused, at 0,0.
 *
 * The h session's report disclosed, inside its probe-row list, one nonsense
 * read at latitude 0, longitude 0 — produced by a probe that passed a `zip`
 * parameter `/api/meetings` does not locate by. The route did not fail. It
 * returned 200 with a centre in the Gulf of Guinea, a radius that had climbed
 * the whole ladder to 150 km, a tier, and a `nearZip` of "85701" — and it
 * wrote a matching row into the search log, the store this product sells.
 *
 * The mechanism was one coercion:
 *
 *     Number(params.get("lat"))   // get() returns null when absent
 *     Number(null) === 0          // not NaN
 *
 * so `Number.isFinite(lat)` passed and `-90 <= 0 <= 90` passed. A manufactured
 * claim, which CLAUDE.md ranks worse than an empty success, and which the
 * "no empty success" rule names by shape.
 *
 * Two routes were affected out of eleven audited. Both are pinned here, plus
 * the shared reader they now go through — because the next route to read a
 * coordinate off a query string will reach for `Number()` again unless the
 * refusing reader is the obvious thing to reach for.
 */

const url = (path: string) => new Request(`https://example.test${path}`);

// ── The coercion itself, pinned so nobody re-derives it ────────────────────

test("Number(null) is 0 — the coercion this whole file exists for", () => {
  // Not a hypothetical. This single line is the defect, and a future reader
  // deserves to see it stated rather than described.
  assert.equal(Number(null), 0);
  assert.ok(Number.isFinite(Number(null)));
  assert.ok(Number(null) >= -90 && Number(null) <= 90);
});

// ── The shared reader ──────────────────────────────────────────────────────

test("numeric() refuses absent, empty and malformed rather than coercing", () => {
  const p = new URLSearchParams("blank=&spaces=%20%20&text=abc&hex=0x10&inf=Infinity&good=32.2");

  assert.equal(numeric(p, "missing", "refuse").ok, false, "absent must refuse");
  assert.equal(numeric(p, "blank", "refuse").ok, false, "empty string must refuse");
  assert.equal(numeric(p, "spaces", "refuse").ok, false, "whitespace must refuse");
  assert.equal(numeric(p, "text", "refuse").ok, false, "non-numeric must refuse");
  assert.equal(numeric(p, "hex", "refuse").ok, false, "0x form must refuse");
  assert.equal(numeric(p, "inf", "refuse").ok, false, "Infinity must refuse");

  const good = numeric(p, "good", "refuse");
  assert.ok(good.ok && good.value === 32.2);

  // A default stands in for an ABSENT optional parameter only.
  const absent = numeric(p, "missing", { default: 25 });
  assert.ok(absent.ok && absent.value === 25);
  // ...and never for one the caller sent wrong.
  assert.equal(numeric(p, "text", { default: 25 }).ok, false);
});

test("numericInRange() states the range it refused against", () => {
  const p = new URLSearchParams("lat=91");
  const read = numericInRange(p, "lat", -90, 90, "refuse");
  assert.equal(read.ok, false);
  assert.match(read.ok ? "" : read.error, /between -90 and 90/);
  assert.match(read.ok ? "" : read.error, /91/, "the refusal names what arrived");
});

test("rejectUnknown() names the parameter back and lists what is accepted", () => {
  const read = rejectUnknown(new URLSearchParams("zip=85701"), ["lat", "lng"]);
  assert.equal(read.ok, false);
  assert.match(read.ok ? "" : read.error, /zip/);
  assert.match(read.ok ? "" : read.error, /lat, lng/);
});

test("matching() refuses a malformed value instead of silently nulling it", () => {
  const p = new URLSearchParams("zip=8570");
  assert.equal(matching(p, "zip", /^\d{5}$/, { default: null }).ok, false);
  const absent = matching(new URLSearchParams(), "zip", /^\d{5}$/, { default: null });
  assert.ok(absent.ok && absent.value === null, "absent optional is honestly null");
});

// ── Affected route 1 of 2: /api/meetings ───────────────────────────────────

test("/api/meetings refuses h's exact probe rather than answering at 0,0", async () => {
  // Byte-for-byte the request shape the h session's probe sent.
  const response = await meetingsGET(url("/api/meetings?zip=85701"));
  assert.equal(response.status, 400, "the probe that produced 0,0 must be refused");

  const body = (await response.json()) as { error?: string; center?: unknown };
  assert.ok(typeof body.error === "string" && body.error.length > 0, "the refusal states a reason");
  assert.equal(body.center, undefined, "a refusal carries no centre to mistake for an answer");
});

test("/api/meetings refuses a missing coordinate, each named separately", async () => {
  for (const [path, wanted] of [
    ["/api/meetings", /lat/],
    ["/api/meetings?lat=32.21696", /lng/],
    ["/api/meetings?lng=-110.971", /lat/],
    ["/api/meetings?lat=&lng=", /lat/],
    ["/api/meetings?lat=abc&lng=-110.971", /lat/],
  ] as const) {
    const response = await meetingsGET(url(path));
    assert.equal(response.status, 400, `${path} must refuse`);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, wanted, `${path} must name the parameter at fault`);
  }
});

test("/api/meetings refuses a malformed radiusKm rather than quietly shrinking the search", async () => {
  const response = await meetingsGET(
    url("/api/meetings?lat=32.21696&lng=-110.971&radiusKm=abc"),
  );
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /radiusKm/);
});

test("/api/meetings refuses a malformed zip rather than logging a location-less search", async () => {
  // A four-digit zip is a client typo, and it used to become `null` — a row in
  // the sold store indistinguishable from a reader who panned into open water.
  const response = await meetingsGET(url("/api/meetings?lat=32.21696&lng=-110.971&zip=8570"));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /zip/);
});

test("/api/meetings still answers a well-formed request", async () => {
  // The refusal must not have cost the route its job. This is the regression
  // the fix itself could cause.
  const response = await meetingsGET(
    url("/api/meetings?lat=32.21696&lng=-110.971&zip=85701"),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { center: { lat: number; lng: number } };
  assert.equal(body.center.lat, 32.21696);
  assert.equal(body.center.lng, -110.971);
});

// ── Affected route 2 of 2: /api/directory ──────────────────────────────────

test("/api/directory refuses a malformed member instead of asserting no record", async () => {
  // The old behaviour returned {source:null, districtOffices:[], committees:[]}
  // — byte-identical to the answer for a real member we hold no record of. Two
  // different claims, and only one of them is about a person.
  for (const path of [
    "/api/directory",
    "/api/directory?member=",
    "/api/directory?member=garbage",
    "/api/directory?member=congress:xyz",
    "/api/directory?member=plural:0000",
  ]) {
    const response = await directoryGET(url(path));
    assert.equal(response.status, 400, `${path} must refuse`);
    const body = (await response.json()) as {
      error?: string;
      districtOffices?: unknown;
    };
    assert.ok(typeof body.error === "string" && body.error.length > 0);
    assert.equal(
      body.districtOffices,
      undefined,
      "a refusal must not wear the empty-directory shape",
    );
  }
});

test("/api/directory names an unknown parameter rather than ignoring it", async () => {
  const response = await directoryGET(url("/api/directory?bioguide=C001133"));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /bioguide/);
});

// ── The standing rule, stated as a test over the whole route surface ───────

test("no route reads a coordinate through a bare Number() coercion", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  async function routeFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await routeFiles(full)));
      else if (entry.name === "route.ts") found.push(full);
    }
    return found;
  }

  const files = await routeFiles(join(process.cwd(), "app", "api"));
  assert.ok(files.length >= 10, `expected the whole route surface, found ${files.length}`);

  const offenders: string[] = [];
  for (const file of files) {
    const src = await readFile(file, "utf8");
    // The exact shape that shipped: Number() wrapped straight around a
    // params/searchParams read. Commented lines are excluded — the meetings
    // route quotes the old code in its own explanation of the defect.
    // `.trim()` first, and deliberately: the repo's files are CRLF, and a
    // trailing \r is a line terminator, so `.*$` stops in front of it and a
    // comment-stripping regex silently matches nothing. This test failed on
    // exactly that before it was trusted — it flagged the meetings route's own
    // comment quoting the old code.
    for (const line of src.split("\n").map((l) => l.trim())) {
      const code = line.replace(/^(\*|\/\/|\/\*).*$/, "");
      if (/Number\(\s*(?:\w+\.)*(?:params|searchParams)\.get\(/.test(code)) {
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "read coordinates through lib/api/params.ts — Number(null) is 0, and that is how the Gulf of Guinea became an answer",
  );
});
