/**
 * The Admin integration seam: GET /api/census-geography/zctas. Proves the route
 * returns the contract's typed result — every wholly-or-partly overlapping ZCTA
 * with its whole flag — over the AZ bootstrap (the non-prod fallback that stands
 * in until production promotion, after which the same route serves live data).
 * Unknown is never zero: a bad type is a 400, an absent geoid is NOT_IN_COVERAGE.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { GroupingZctaResult } from "@/lib/census-geography/contract";
import { GET } from "@/app/api/census-geography/zctas/route";

interface RouteBody {
  readonly ok: boolean;
  readonly error?: string;
  readonly source?: "published" | "bootstrap" | "unavailable";
  readonly activePublishedVersion?: string;
  readonly result?: GroupingZctaResult;
}

async function call(qs: string): Promise<{ status: number; body: RouteBody }> {
  const res = await GET(new Request(`http://localhost/api/census-geography/zctas${qs}`));
  return { status: res.status, body: (await res.json()) as RouteBody };
}

test("route: AZ-06 returns 79 ZCTAs, each carrying the wholly/partly flag", async () => {
  const { status, body } = await call("?type=congressional_district&geoid=0406&version=cd:119");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result?.status.kind, "OK");
  assert.equal(body.result?.count, 79);
  assert.equal(body.result?.count, body.result?.overlaps.length);
  assert.ok(body.result?.overlaps.every((o) => typeof o.whole === "boolean"));
  assert.ok(body.result?.overlaps.some((o) => o.whole), "some ZCTAs are wholly inside");
  assert.ok(body.result?.overlaps.some((o) => !o.whole), "some ZCTAs only partly overlap");
});

test("route: version is optional and resolves the published version for the type", async () => {
  const { body } = await call("?type=congressional_district&geoid=0406");
  assert.equal(body.ok, true);
  assert.equal(body.result?.status.kind, "OK");
  assert.equal(body.result?.count, 79);
});

test("route: a metropolitan CBSA returns its overlaps and its cbsaClass", async () => {
  const { body } = await call("?type=cbsa&geoid=38060&version=cbsa:2023");
  assert.equal(body.ok, true);
  assert.equal(body.result?.status.kind, "OK");
  assert.equal(body.result?.count, 169);
  assert.equal(body.result?.geography.cbsaClass, "metropolitan");
});

test("route: an unknown geography type is a 400, never a false empty", async () => {
  const { status, body } = await call("?type=zip_code&geoid=85001");
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test("route: a malformed geoid is a 400", async () => {
  const { status } = await call("?type=county&geoid=not-a-geoid");
  assert.equal(status, 400);
});

test("route: a well-formed but absent geoid is typed NOT_IN_COVERAGE, never zero", async () => {
  const { body } = await call("?type=congressional_district&geoid=0499&version=cd:119");
  assert.equal(body.ok, true);
  assert.equal(body.result?.status.kind, "NOT_IN_COVERAGE");
  assert.equal(body.result?.count, 0);
});

test("route: states its data source, so a fixture is never mistaken for live coverage", async () => {
  const { body } = await call("?type=cbsa&geoid=38060&version=cbsa:2023");
  // In tests (non-production, no store configured) the source is the AZ
  // bootstrap. In production the read-model's fixture gate is off, so this is
  // only ever "published" or (before activation) "unavailable" — never
  // "bootstrap". Admin treats anything but "published" as not-yet-live.
  assert.equal(body.source, "bootstrap");
  assert.ok(["published", "bootstrap", "unavailable"].includes(body.source ?? ""));
  assert.equal(typeof body.activePublishedVersion, "string");
});
