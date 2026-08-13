import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMENT_ACCESS, commentAccessFor } from "../lib/registry/comment-access.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/** D25 — how to be heard, and what a curated row is allowed to claim. */

test("every comment-access row names a real registry body and cites a source", () => {
  const bodyIds = new Set(registry.bodies.map((b) => b.id));
  for (const row of COMMENT_ACCESS) {
    assert.ok(bodyIds.has(row.bodyId), `${row.bodyId} is not in the registry`);
    assert.equal(row.bodyId.split("#")[0], row.ocdId, row.bodyId);
    assert.match(row.sourceUrl, /^https:\/\//, `${row.bodyId} must cite a page`);
  }
});

test("an UNKNOWN row claims nothing beyond its link", () => {
  // "Unknown" must never arrive dressed as knowledge: a row that cannot say
  // whether a comment period exists cannot say where it falls or how long a
  // speaker gets.
  for (const row of COMMENT_ACCESS) {
    if (row.commentPeriod !== "UNKNOWN") continue;
    assert.equal(row.commentPeriodDetail, null, row.bodyId);
    assert.equal(row.timeLimit, null, row.bodyId);
    assert.equal(row.signup, null, row.bodyId);
  }
});

test("a YES row states where the period falls, in the body's own terms", () => {
  for (const row of COMMENT_ACCESS) {
    if (row.commentPeriod !== "YES") continue;
    assert.ok(row.commentPeriodDetail, `${row.bodyId} must say where it falls`);
  }
});

test("lookup is by division, the key every meeting carries", () => {
  const tucson = commentAccessFor("ocd-division/country:us/state:az/place:tucson");
  assert.ok(tucson);
  assert.equal(tucson.timeLimit, "3 minutes per speaker.");
  assert.equal(commentAccessFor("ocd-division/country:us/state:mt/place:absarokee"), undefined);
});
