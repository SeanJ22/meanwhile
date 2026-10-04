import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import { fecDistrictTargets, promotedCongressTargets } from "../lib/funding/fec-targets.ts";

test("a newly promoted member from any state enters the FEC target universe without a prior money row", () => {
  const roster = { officeholders: [{ id: "congress:A000001", name: "Alice Adams", officeTitle: "U.S. Representative", level: "FEDERAL", state: "OR" },
    { id: "congress:B000002", name: "Bob Baker", officeTitle: "U.S. Senator", level: "FEDERAL", state: "ME" }],
    divisions: [{ officeholderId: "congress:A000001", ocdId: "ocd-division/country:us/state:or/cd:2" },
      { officeholderId: "congress:B000002", ocdId: "ocd-division/country:us/state:me" }] } as OfficeholderSet;
  const targets = promotedCongressTargets(roster, { candidates: [] } as unknown as FundingSnapshot);
  assert.deepEqual(targets.map(row => [row.targetKey, row.state, row.office, row.district]), [["congress:A000001", "OR", "H", "02"], ["congress:B000002", "ME", "S", null]]);
  assert.ok(targets.every(row => row.knownFecCandidateId === null));
});

test("district search financial identities never mint ballot candidacies and refuse another district", () => {
  const targets = fecDistrictTargets({ state: "OR", district: "02" }, [{ candidate_id: "H6OR02001", name: "ADAMS, ALICE", state: "OR", office: "H", district: "2" }]);
  assert.equal(targets[0].targetKey, "fec:H6OR02001"); assert.equal(targets[0].route, "fec");
  assert.throws(() => fecDistrictTargets({ state: "OR", district: "02" }, [{ candidate_id: "H6OR02001", name: "ADAMS, ALICE", state: "OR", office: "H", district: "3" }]), /IDENTITY_INVALID/);
});
