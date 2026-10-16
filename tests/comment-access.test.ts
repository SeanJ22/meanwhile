import assert from "node:assert/strict";
import { test } from "node:test";

import { commentAccessFor, primeCommentAccess } from "../lib/registry/comment-access.ts";
import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

primeCommentAccess({ kind: "comment-access", records: COMMENT_ACCESS.map((row) => ({ id: `comment-access:${row.bodyId}`, ...row })) });

test("every comment-access row names a real registry body and cites a source", () => {
  const bodyIds = new Set(registry.bodies.map((b) => b.id));
  for (const row of COMMENT_ACCESS) {
    assert.ok(bodyIds.has(row.bodyId), `${row.bodyId} is not in the registry`);
    if (row.ocdId === null) {
      assert.match(row.bodyId, /^curated:/, row.bodyId);
    } else {
      assert.equal(row.bodyId.split("#")[0], row.ocdId, row.bodyId);
    }
    assert.match(row.sourceUrl, /^https:\/\//, `${row.bodyId} must cite a page`);
  }
});

test("an UNKNOWN row claims nothing beyond its link", () => {
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
  const tucsonOcd = "ocd-division/country:us/state:az/place:tucson";
  const mc = commentAccessFor(tucsonOcd, "Mayor & Council");
  assert.ok(mc);
  assert.equal(mc.timeLimit, "3 minutes per speaker.");

  const pc = commentAccessFor(tucsonOcd, "Planning Commission");
  assert.ok(pc);
  assert.ok(pc.bodyId.endsWith("#planning-commission"));
  assert.notEqual(pc.bodyId, mc.bodyId);
  assert.notEqual(pc.signup, mc.signup);
  assert.notEqual(pc.timeLimit, mc.timeLimit);

  assert.equal(commentAccessFor(tucsonOcd, "Design Review Board"), undefined);
  assert.equal(commentAccessFor(tucsonOcd), undefined);

  const pcc = commentAccessFor(null, "Regular Governing Board", "curated:az/pima-community-college#governing");
  assert.ok(pcc);
  assert.equal(pcc.commentPeriod, "YES");
  assert.equal(commentAccessFor(null, "Regular Governing Board"), undefined);
  assert.equal(commentAccessFor(null, "Regular Governing Board", "curated:other#governing"), undefined);
  assert.equal(commentAccessFor(tucsonOcd, "Mayor & Council", "curated:az/pima-community-college#governing"), undefined);

  assert.equal(
    commentAccessFor("ocd-division/country:us/state:mt/place:absarokee"),
    undefined,
  );
});

test("every held standing rule survives its exact canonical body join", () => {
  for (const row of COMMENT_ACCESS) {
    // The edge copy carries a transport id that is stripped on the way out, so content survives by value.
    assert.deepEqual(commentAccessFor(row.ocdId, "Unrelated vendor heading", row.bodyId), row);
  }
});

test("one held policy in a division never supplies an unidentified sibling body's rules", () => {
  const pima = "ocd-division/country:us/state:az/county:pima";
  const merrimack = "ocd-division/country:us/state:nh/county:merrimack";
  assert.equal(commentAccessFor(pima, "Planning and Zoning Commission"), undefined);
  assert.equal(commentAccessFor(merrimack, "Delegation"), undefined);
  assert.equal(commentAccessFor(pima), undefined);
  assert.equal(commentAccessFor(merrimack), undefined);
});
