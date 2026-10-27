import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { statePeopleCandidate, publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";

test("unchanged civic facts retain upgraded and newly changed source fingerprints", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const at = "2026-10-01T00:00:00.000Z", later = "2026-10-01T01:00:00.000Z";
  const url = `https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/data/az/legislature/One.yml`;
  const body = "id: ocd-person/one\nname: Member One\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\n";
  const acquisition = { requestedUrl: url, finalUrl: url, httpStatus: 200, body, retrievedAt: at };
  const roster = { ...normalize(yamlToPeople(body, "az", url, at), new Map(), at, "US-AZ"), currentMembershipComplete: true };
  const fresh = statePeopleCandidate({ state: "az", roster, captures: [], releaseId: "a".repeat(40), now: at });
  const { rawHashBasis: _basis, ...retrieval } = fresh.retrieval;
  const legacy = { ...fresh, id: "legacy-source-fingerprint", retrieval: { ...retrieval,
    succeeded: true, requestedUrl: url, finalUrl: url, httpStatus: 200,
    rawHash: canonicalCivicDataHash(fresh.normalizedPayload) } };
  const first = await processRegisteredRoutineCandidate(store, "openstates-people-az", legacy, at);
  assert.ok(first.promoted, JSON.stringify(first.candidate.receipt));
  const upgraded = await publishStatePeople({ store, vault, state: "az", roster, acquisitions: [{ ...acquisition, retrievedAt: later }],
    releaseId: "a".repeat(40), now: later });
  assert.ok(upgraded.outcome.promoted);
  assert.equal(upgraded.outcome.confirmed, undefined);
  const before = await store.readSourceHead("STATE_LEGISLATOR", fresh.scope);
  assert.equal(before?.rawHashBasis, "SOURCE_CONTENT_V1");
  const changedAt = "2026-10-01T02:00:00.000Z";
  const changed = await publishStatePeople({ store, vault, state: "az", roster,
    acquisitions: [{ ...acquisition, body: body + "# publisher added a comment\n", retrievedAt: changedAt }],
    releaseId: "a".repeat(40), now: changedAt });
  assert.ok(changed.outcome.promoted);
  assert.equal(changed.outcome.confirmed, undefined);
  assert.notEqual((await store.readSourceHead("STATE_LEGISLATOR", fresh.scope))?.rawHash, before?.rawHash);
  const partial={...changed.candidate,id:"partial-source-same-bytes",retrieval:{...changed.candidate.retrieval,complete:false}};
  assert.ok((await processRegisteredRoutineCandidate(store,"openstates-people-az",partial,changedAt,undefined,{confirmUnchanged:false})).promoted);
  const complete={...partial,id:"complete-source-same-bytes",retrieval:{...partial.retrieval,complete:true}};
  const completed=await processRegisteredRoutineCandidate(store,"openstates-people-az",complete,changedAt);
  assert.ok(completed.promoted);
  assert.equal(completed.confirmed,undefined,"an unchanged fact set cannot discard completed acquisition progress");
  assert.equal((await store.readSourceHead("STATE_LEGISLATOR",fresh.scope))?.acquisitionComplete,true);
});
