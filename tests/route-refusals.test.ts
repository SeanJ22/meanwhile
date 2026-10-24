import assert from "node:assert/strict";
import test from "node:test";

import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as directoryGET } from "../app/api/directory/route.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { fixtureZipResolution } from "./helpers/zip-location.ts";
import {
  matching,
  numeric,
  numericInRange,
  rejectUnknown,
} from "../lib/api/params.ts";

const url = (path: string) => new Request(`https://example.test${path}`);
await installRegistryAuthority();

test("Number(null) is 0 — the coercion this whole file exists for", () => {
  assert.equal(Number(null), 0);
  assert.ok(Number.isFinite(Number(null)));
  assert.ok(Number(null) >= -90 && Number(null) <= 90);
});

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

test("/api/meetings resolves a ZIP-only request to its own centroid rather than 0,0", async () => {
  const response = await meetingsGET(url("/api/meetings?zip=85701"));
  assert.equal(response.status, 200);

  const body = (await response.json()) as { center: { lat: number; lng: number }; nearZip: string };
  const zip = fixtureZipResolution("85701");
  assert.ok(zip.ok);
  assert.deepEqual(body.center, { lat: zip.centroid.lat, lng: zip.centroid.lng });
  assert.equal(body.nearZip, "85701");
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
  const response = await meetingsGET(url("/api/meetings?lat=32.21696&lng=-110.971&zip=8570"));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /zip/);
});

test("/api/directory refuses a malformed member instead of asserting no record", async () => {
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
    // comment-stripping regex silently matches nothing.
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
