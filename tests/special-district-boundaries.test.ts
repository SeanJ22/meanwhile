import assert from "node:assert/strict";
import test from "node:test";
import { readSpecialDistrictBoundariesForCounties } from "../lib/registry/special-district-boundary-reader.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";

test("a complete cold reader edge without optional boundary entries makes zero store reads", async () => {
  await withReaderAuthorityEdge({ promoted: new Map() } as unknown as ReaderAuthorityEdgeBundle, async () => {
    assert.deepEqual(await readSpecialDistrictBoundariesForCounties(["ocd-division/country:us/state:oh/county:alder"]),[]);
  });
});
