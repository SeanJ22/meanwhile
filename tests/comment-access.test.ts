import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMENT_ACCESS, commentAccessFor } from "../lib/registry/comment-access.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/** D25 — how to be heard, and what a curated row is allowed to claim. */

test("every comment-access row names a real registry body and cites a source", () => {
  const bodyIds = new Set(registry.bodies.map((b) => b.id));
  for (const row of COMMENT_ACCESS) {
    assert.ok(bodyIds.has(row.bodyId), `${row.bodyId} is not in the registry`);
    if (row.ocdId === null) {
      // Division-less bodies (D28) use the documented curated: id scheme.
      assert.match(row.bodyId, /^curated:/, row.bodyId);
    } else {
      assert.equal(row.bodyId.split("#")[0], row.ocdId, row.bodyId);
    }
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

test("lookup is by division plus published body name, never the wrong body's rule", () => {
  // Tucson now carries several bodies (D29). The Mayor & Council rule must
  // resolve for Mayor & Council meetings and must NOT resolve for a board
  // meeting in the same division — a Planning Commission meeting rendering
  // speaker-card rules it does not follow is a false claim.
  const tucsonOcd = "ocd-division/country:us/state:az/place:tucson";
  const mc = commentAccessFor(tucsonOcd, "Mayor & Council");
  assert.ok(mc);
  assert.equal(mc.timeLimit, "3 minutes per speaker.");

  const pc = commentAccessFor(tucsonOcd, "Planning Commission");
  assert.ok(pc);
  assert.equal(pc.commentPeriod, "UNKNOWN");

  // A body with no row of its own gets nothing — never a sibling's rule.
  assert.equal(commentAccessFor(tucsonOcd, "Design Review Board"), undefined);
  assert.equal(commentAccessFor(tucsonOcd), undefined);

  // The division-less path (D28): PCC's rule resolves through the null key.
  const pcc = commentAccessFor(null, "Regular Governing Board");
  assert.ok(pcc);
  assert.equal(pcc.commentPeriod, "YES");

  assert.equal(
    commentAccessFor("ocd-division/country:us/state:mt/place:absarokee"),
    undefined,
  );
});
