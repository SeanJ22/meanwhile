import assert from "node:assert/strict";
import test from "node:test";
import { REACHED_COUNT_SQL, REACHED_SQL, TRAIL_EVENT_LIMIT, TRAIL_ID, reachedView, trailView } from "../lib/control-plane/admin-view/v6-trail-read.ts";
import { validateTrailQuery } from "../lib/control-plane/admin-view/v6-trail-route.ts";

const q = (s: string) => validateTrailQuery(new URLSearchParams(s));

test("the trail read takes exactly one id, from a closed character set", () => {
  assert.deepEqual(q("scope=us&send=DISPATCH:2026-09-30T18:57:07.300Z"), { ok: true, send: "DISPATCH:2026-09-30T18:57:07.300Z", item: null });
  assert.deepEqual(q("scope=us&item=wi-9e69607dc40f61b3dad9ba57"), { ok: true, send: null, item: "wi-9e69607dc40f61b3dad9ba57" });
  assert.deepEqual(q("item=freshness:meetings-discovery:az:county:county-of-maricopa%23own-site-meetings"), { ok: true, send: null, item: "freshness:meetings-discovery:az:county:county-of-maricopa#own-site-meetings" });
  assert.equal((q("scope=us") as { code: string }).code, "DUPLICATE_OR_MISSING_PARAMETER", "neither id");
  assert.equal((q("send=a&item=b") as { code: string }).code, "DUPLICATE_OR_MISSING_PARAMETER", "both ids");
  assert.equal((q("item=a&item=b") as { code: string }).code, "DUPLICATE_OR_MISSING_PARAMETER");
  assert.equal((q("item=a&limit=9") as { code: string }).code, "UNKNOWN_PARAMETER");
  assert.equal((q(`item=${encodeURIComponent("a'; drop table x;--")}`) as { code: string }).code, "INVALID_ID");
  assert.equal(TRAIL_ID.test("x".repeat(241)), false);
});

test("what a send reached is read by its exact mark, bounded, and the total is counted on the same predicate", () => {
  assert.match(REACHED_SQL, /@> \$1::jsonb/);
  assert.match(REACHED_SQL, /a->>'ref' = \$2/);
  assert.match(REACHED_SQL, /LIMIT \$3::int/);
  assert.match(REACHED_COUNT_SQL, /@> \$1::jsonb/);
  const out = reachedView([
    { id: "freshness:jurisdiction:az:county:county-of-maricopa#coverage-discovery:officeholders", relation: "REORDERED", at: "2026-10-01T03:08:55.631Z" },
    { id: "freshness:jurisdiction:nj:city:city-of-hoboken#coverage-discovery:officeholders", relation: "CREATED", at: "2026-09-30T19:53:15.977Z" },
    { id: "odd", relation: null, at: null },
  ], 236);
  assert.equal(out.total, 236);
  assert.deepEqual(out.rows.map((r) => r.relation), ["reordered", "created", "other"]);
  assert.equal(out.rows[0].label, "County of Maricopa, AZ · coverage discovery · officeholders");
  assert.equal(out.rows[2].at, "");
});

test("a trail keeps its saved documents, private-copy control and gaps, and bounds the steps it sends", () => {
  const event = (n: number, extra: object = {}) => ({ id: `e${n}`, stage: "SAVED" as const, at: "2026-10-01T00:00:00.000Z", title: "Document saved", says: "10 bytes", nextAction: null, sourceUrl: "https://x.gov/a",
    publicUrl: null, references: Array.from({ length: 12 }, (_, i) => ["k", `v${i}`] as const), ...extra });
  const out = trailView({ events: [event(0, { privateCopy: { path: "/api/admin/evidence/wi-a/at-b/ar-c", byteLength: 10 } }), ...Array.from({ length: TRAIL_EVENT_LIMIT + 4 }, (_, i) => event(i + 1))], gaps: ["Some saved documents have no eligible private original-copy control here."] });
  assert.equal(out.events.length, TRAIL_EVENT_LIMIT);
  assert.equal(out.eventsHidden, 5);
  assert.deepEqual(out.events[0].privateCopy, { path: "/api/admin/evidence/wi-a/at-b/ar-c", byteLength: 10 });
  assert.equal(out.events[1].privateCopy, null, "a document without an eligible exact capture has no copy control");
  assert.equal(out.events[0].references.length, 8);
  assert.equal(out.gaps.length, 1);
});
