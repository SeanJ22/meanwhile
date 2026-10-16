import assert from "node:assert/strict";
import { test } from "node:test";
import { azHeldFilingSubjects, requestedHeldFilings } from "../lib/ask/held-filing-subjects.ts";

test("published source-filing profiles retain exact identities outside the mapped ballot without duplicating joined people", () => {
  const provenance = { sourceUrl: "https://azsos.gov/elections/candidates", sourceOrg: "Arizona Secretary of State", collectedAt: "2026-09-26" };
  const rows = azHeldFilingSubjects({
    contests: [
      { id: "us-house-2", title: "U.S. Representative in Congress, District 2", ocdId: "ocd-division/country:us/state:az/cd:2" },
      { id: "governor", title: "Governor", ocdId: "ocd-division/country:us/state:az" },
    ],
    candidacies: [
      { id: "az-sos-2026:us-house-2:crane-eli", contestId: "us-house-2", givenName: "Eli", familyName: "Crane", heldIdentityJoin: null, provenance },
      { id: "az-sos-2026:governor:schweikert-david", contestId: "governor", givenName: "David", familyName: "Schweikert", heldIdentityJoin: { heldCandidacyId: "ballot-az:governor:schweikert-david" }, provenance },
    ],
  });
  const crane = rows.find(row => row.entity.id === "az-sos-2026:us-house-2:crane-eli")!;
  assert.equal(crane.entity.name, "Eli Crane");
  assert.equal(crane.ocdId, "ocd-division/country:us/state:az/cd:2");
  assert.match(crane.record.sourceUrl!, /azsos.gov/);
  assert.match(crane.record.text, /does not establish a current general-election ballot position/);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", [crane.entity.id], new Set()), [crane]);
  const david = rows.find(row => row.entity.id === "az-sos-2026:governor:schweikert-david")!;
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [], new Set([david.heldCandidacyId!])), []);
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [david.entity.id], new Set([david.heldCandidacyId!])), [david]);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", ["invented-person"], new Set()), []);
  assert.throws(() => azHeldFilingSubjects({}), /unreadable/);
});
