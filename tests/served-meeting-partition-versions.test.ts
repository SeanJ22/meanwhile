import assert from "node:assert/strict";
import test from "node:test";
import { hostedMeetingPartitionMatches, servedMeetingPartitionVersions } from "../lib/meetings/served-partition-versions.ts";
import type { MeetingPartitionReadback } from "../lib/meetings/snapshot.ts";

const partition: MeetingPartitionReadback = {
  contractId: "meetings:legistar:pima", source: "legistar", bodyId: "pima-board",
  scope: "source:legistar:body:pima-board", kind: "PROMOTED",
  versionId: "version-2", detail: null,
};

test("public meeting response exposes only versions that contribute returned exact rows", () => {
  assert.deepEqual(servedMeetingPartitionVersions([
    { id: "legistar:1825", bodyId: "pima-board" },
  ], [partition, { ...partition, scope: "source:ical:body:newbury", source: "ical", bodyId: "newbury", versionId: "unrelated" }]), [
    { scope: partition.scope, versionId: "version-2", meetingIds: ["legistar:1825"] },
  ]);
});

test("ambiguous, held, unversioned, and wrong-body versions never acquire a public binding", () => {
  const meeting = { id: "legistar:1825", bodyId: "pima-board" };
  for (const variants of [
    [partition, { ...partition, scope: "other" }],
    [{ ...partition, kind: "NOT_RECORDED" as const, heldFrom: { contractId: "old", scope: "old", versionId: "old" } }],
    [{ ...partition, versionId: null }],
    [{ ...partition, bodyId: "another-body" }],
  ]) assert.deepEqual(servedMeetingPartitionVersions([meeting], variants), []);
});

test("an old cached version or partial meeting set cannot certify the hosted successor", () => {
  const hosted = [{ scope: partition.scope, versionId: "version-1", meetingIds: ["legistar:1825"] }];
  assert.equal(hostedMeetingPartitionMatches(hosted, partition.scope, "version-2", ["legistar:1825"]), false);
  assert.equal(hostedMeetingPartitionMatches([{ ...hosted[0], versionId: "version-2" }],
    partition.scope, "version-2", ["legistar:1825", "legistar:1826"]), false);
  assert.equal(hostedMeetingPartitionMatches([{ ...hosted[0], versionId: "version-2" }],
    partition.scope, "version-2", ["legistar:1825"]), true);
});
