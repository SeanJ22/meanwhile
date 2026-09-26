import assert from "node:assert/strict";
import test from "node:test";
import { indexBodies, registryBodyOf } from "../lib/control-plane/admin-view/coverage.ts";
import { previewScopeBodies } from "../lib/control-plane/admin-view/scope-preview.ts";

test("scope preview retains body identity, shared records and partial ZIP coverage", () => {
  const index = indexBodies([
    registryBodyOf({ id: "county#board", name: "County board", ocdId: "county", coverageStatus: "LIVE" }),
    registryBodyOf({ id: "school#board", name: "School board", ocdId: "school", alsoServesOcdIds: ["school-alias"], coverageStatus: "NOT_ATTEMPTED" }),
    registryBodyOf({ id: "elsewhere#board", ocdId: "elsewhere" }),
  ]);
  const rows = previewScopeBodies([
    { zcta5: "85635", indexed: true, divisions: ["county", "school"], partial: ["school"] },
    { zcta5: "85650", indexed: true, divisions: ["county", "school", "school-alias"], partial: ["school"] },
    { zcta5: "00000", indexed: false, divisions: ["elsewhere"], partial: [] },
  ], index);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].codes, [{ zcta5: "85635", partial: false }, { zcta5: "85650", partial: false }]);
  assert.equal(rows[1].coverageStatus, "NOT_ATTEMPTED");
  assert.deepEqual(rows[1].codes, [{ zcta5: "85635", partial: true }, { zcta5: "85650", partial: false }]);
  assert.deepEqual(previewScopeBodies([], index), []);
});
