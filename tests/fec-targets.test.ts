import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import { promotedCongressTargets } from "../lib/funding/fec-targets.ts";

test("a newly promoted member from any state enters the FEC target universe without a prior money row", () => {
  const roster = { officeholders: [{ id: "congress:A000001", name: "Alice Adams", officeTitle: "U.S. Representative", level: "FEDERAL", state: "OR", fecCandidateIds: ["H6OR02001"] },
    { id: "congress:B000002", name: "Bob Baker", officeTitle: "U.S. Senator", level: "FEDERAL", state: "ME" },
    { id: "congress:C000003", name: "Unresolved Member", officeTitle: "Unresolved office", level: "FEDERAL" }],
    divisions: [{ officeholderId: "congress:A000001", ocdId: "ocd-division/country:us/state:or/cd:2" },
      { officeholderId: "congress:B000002", ocdId: "ocd-division/country:us/state:me" }] } as OfficeholderSet;
  const unresolved: string[] = [];
  const targets = promotedCongressTargets(roster, { candidates: [] } as unknown as FundingSnapshot, id => unresolved.push(id));
  assert.deepEqual(unresolved, ["congress:C000003"]);
  assert.deepEqual(targets.map(row => [row.targetKey, row.state, row.office, row.district]), [["congress:A000001", "OR", "H", "02"], ["congress:B000002", "ME", "S", null]]);
  assert.equal(targets[0].knownFecCandidateId, "H6OR02001");
  assert.equal(targets[1].knownFecCandidateId, null, "no name-based match is invented for an unbound person");
});
