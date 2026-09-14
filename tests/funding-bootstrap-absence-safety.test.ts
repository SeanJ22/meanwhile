import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};

test("FEC bootstrap preserves the candidate LKG without reviving unproven frozen absences", async () => {
  const tracked = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "data", "fec", "fec-2026.json"), "utf8"),
  ) as FundingSnapshot;
  assert.equal(tracked.candidates.length, 24);
  assert.equal(tracked.absences.length, 14, "the historical rows remain intact as held evidence");

  const result = await readFundingSnapshot({
    store: noPointer,
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(result.kind, "BOOTSTRAP");
  if (result.kind !== "BOOTSTRAP") return;

  assert.deepEqual(
    result.value.candidates.map((candidate) => candidate.fecCandidateId),
    tracked.candidates.map((candidate) => candidate.fecCandidateId),
    "the established 24-candidate LKG remains available",
  );
  assert.deepEqual(result.value.absences, [], "bootstrap makes no FEC absence claim");
  assert.match(result.detail, /14 frozen absence rows are withheld/);
});
