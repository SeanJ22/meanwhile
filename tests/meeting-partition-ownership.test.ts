import assert from "node:assert/strict";
import test from "node:test";
import { createMeetingPartitionOwnership, reviewedGovernmentPairs } from "../lib/control-plane/scheduler/meeting-ownership.ts";
import type { LoadedReference } from "../lib/registration/reference.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { DerivedWiringProjection } from "../lib/civic-data/derived-meeting-wiring.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";

const registration = (bodies: { id: string; jurisdictionId: string }[]) =>
  ({ kind: "PROMOTED", value: { bodies } }) as unknown as CivicDataReadResult<RegistrationReadModel>;
const wiring = (records: { body: string; jurisdiction: string; status?: string }[]) =>
  ({ kind: "PROMOTED", value: { records: records.map(r => ({ status: r.status ?? "ACTIVE", row: { bodyId: r.body, jurisdictionId: r.jurisdiction, state: "US-AZ" } })) } }) as unknown as CivicDataReadResult<DerivedWiringProjection>;

test("reviewed government joins require the promoted Census vintage and preserve conflicting exact IDs", () => {
  const reference = { sha256: "version", reference: { governments: [["1", "az:city:a", "A", "MUNICIPAL", 0, "CENSUS_CODE", 1]], divisions: [["place:a"], ["cousub:a"]] } } as unknown as LoadedReference;
  assert.deepEqual(reviewedGovernmentPairs(reference, "version", new Set(["place:a#governing", "place:a#committee"])), [{ id: "az:city:a", bodyId: "place:a#governing" }]);
  assert.equal(reviewedGovernmentPairs(reference, "version", new Set(["place:a#governing", "cousub:a#governing"])).length, 2);
  assert.throws(() => reviewedGovernmentPairs(reference, "different-vintage", new Set()), /REFERENCE_VERSION_MISMATCH/);
});

test("meeting ownership joins exact bodies, never a county's committees or neighboring governments", async () => {
  const owner = createMeetingPartitionOwnership({
    staticBodies: new Set(["county#committee", "city-a#governing"]), registryBodies: () => [],
    readWiring: async () => wiring([{ body: "city-b#governing", jurisdiction: "az:city:b", status: "SUSPENDED" }]),
    readRegistration: async () => registration([
      { id: "county#governing", jurisdictionId: "az:county:county" },
      { id: "city-a#governing", jurisdictionId: "az:city:a" },
      { id: "city-b#governing", jurisdictionId: "az:city:b" },
    ]),
  });
  await owner.readStates(["az"]);
  assert.equal(owner.ownerOf("az:county:county"), "NONE");
  assert.equal(owner.ownerOf("az:city:a"), "PARTITION");
  assert.equal(owner.ownerOf("az:city:b"), "PARTITION");
  assert.equal(owner.ownerOf("az:city:unknown"), "UNKNOWN");
  assert.match(owner.reasonFor!("az:city:unknown"), /no exact registered governing-body identity/);
});

test("unread wiring holds only unowned routes and conflicting government identities stay held", async () => {
  const owner = createMeetingPartitionOwnership({
    staticBodies: new Set(["a#governing"]),
    registryBodies: () => [{ id: "az:a", bodyId: "a#governing" }, { id: "az:ambiguous", bodyId: "other#governing" }],
    readWiring: async () => { throw new Error("store unavailable"); },
    readRegistration: async () => registration([{ id: "b#governing", jurisdictionId: "az:b" }, { id: "first#governing", jurisdictionId: "az:ambiguous" }]),
  });
  await owner.readStates(["az"]);
  assert.equal(owner.ownerOf("az:a"), "PARTITION");
  assert.equal(owner.ownerOf("az:b"), "UNKNOWN");
  assert.equal(owner.ownerOf("az:ambiguous"), "UNKNOWN");
  assert.match(owner.reasonFor!("az:ambiguous"), /conflicting exact governing-body IDs/);
  assert.match(owner.reasonFor!("az:b"), /store unavailable/);
  assert.match(owner.source, /store unavailable/);
});

test("later Admin scopes reuse readings and load each newly reached state once", async () => {
  let wiringReads = 0;
  const states: string[] = [];
  const owner = createMeetingPartitionOwnership({
    staticBodies: new Set(), registryBodies: () => [],
    readWiring: async () => { wiringReads++; return wiring([{ body: "a#committee", jurisdiction: "az:a" }]); },
    readRegistration: async state => { states.push(state); return registration([{ id: `${state}#governing`, jurisdictionId: `${state}:a` }]); },
  });
  assert.equal(owner.ownerOf("az:a"), "UNKNOWN");
  await owner.readStates(["AZ", "az"]);
  await owner.readStates(["az", "oh"]);
  assert.equal(wiringReads, 1);
  assert.deepEqual(states, ["az", "oh"]);
  assert.equal(owner.ownerOf("az:a"), "NONE");
  assert.equal(owner.ownerOf("oh:a"), "NONE");
});
