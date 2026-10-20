import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import { installFundingFixture } from "./helpers/funding-fixture.ts";

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};

test("exact state pointers preserve every recorded candidate without reviving unproven frozen absences", async () => {
  const tracked = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "data", "fec", "fec-2026.json"), "utf8"),
  ) as FundingSnapshot;
  assert.equal(tracked.candidates.length, 24);
  assert.equal(tracked.absences.length, 14, "the historical rows remain intact as held evidence");

  let checked = 0;
  for (const state of ["AZ", "NH", "NJ"]) {
  const result = await readFundingSnapshot({ state,
    store: noPointer,
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(result.kind, "NOT_RECORDED", "a missing state pointer cannot load a frozen national file");
  const value = await installFundingFixture(state);

  assert.deepEqual(
    value.candidates.map((candidate) => candidate.fecCandidateId),
    tracked.candidates.filter(candidate => candidate.state === state).map((candidate) => candidate.fecCandidateId),
    "the state's established candidate records remain available",
  );
  assert.deepEqual(value.absences, [], "the projection makes no frozen FEC absence claim");
  checked += value.candidates.length;
  }
  assert.equal(checked, 24, "all established candidates are preserved across the state pointers");
});
