import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { confirmSourceHashUnchanged, sourceContentHash, sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { confirmStatePeopleSource, peopleSourceContentHash, publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { PLURAL_PARSER_VERSION } from "../lib/sources/plural/targets.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const at = "2026-10-01T00:00:00.000Z", later = "2026-10-01T01:00:00.000Z";
const scope = "US-AZ:openstates-people:v1";
const url = `https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/data/az/legislature/One.yml`;
const body = "id: ocd-person/one\nname: Member One\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\n";
const acquisitions = [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body, retrievedAt: at }];
const roster = { ...normalize(yamlToPeople(body, "az", url, at), new Map(), at, "US-AZ"), currentMembershipComplete: true };

test("source digests ignore observations and archive revisions but retain bytes, selected terms and input changes", () => {
  const archive = (sha: string) => ({ ...acquisitions[0], retrievedAt: sha === "a" ? at : later,
    extractedFrom: { requestedUrl: `https://codeload.github.com/openstates/people/zip/${sha.repeat(40)}`, member: "data/az/legislature/One.yml" } });
  assert.equal(sourceContentHash([archive("a")]), sourceContentHash([archive("b")]));
  assert.notEqual(sourceContentHash([archive("a")]), sourceContentHash([{ ...archive("a"), body: body.replace("Member One", "Member Two") }]));
  assert.equal(peopleSourceContentHash(acquisitions, roster), peopleSourceContentHash(acquisitions.map(row => ({ ...row, retrievedAt: later })), { ...roster, generatedAt: later }));
  assert.notEqual(peopleSourceContentHash(acquisitions, roster), peopleSourceContentHash(acquisitions, { ...roster, officeholders: roster.officeholders.map(row => ({ ...row, termEnd: "2026-10-01" })) }));
});

test("an unchanged complete state source confirms using its head and no held payload, metadata or event read", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const first = await publishStatePeople({ store, vault, state: "az", roster, acquisitions, releaseId: "a".repeat(40), now: at });
  assert.ok(first.outcome.promoted, JSON.stringify(first.outcome.candidate.receipt));
  const head = await store.readSourceHead("STATE_LEGISLATOR", scope);
  assert.equal(head?.rawHashBasis, "SOURCE_CONTENT_V1");
  for (const method of ["readCandidate", "readCandidatePath", "readPromotion", "readPublishedCandidateMetadata", "events", "readPromotionIdentity"] as const)
    Object.assign(store, { [method]: async () => { throw new Error(`unchanged source read ${method}`); } });
  const confirmed = await confirmStatePeopleSource({ store, state: "az", roster: { ...roster, generatedAt: later },
    acquisitions: acquisitions.map(row => ({ ...row, retrievedAt: later })), gaps: [], now: later });
  assert.ok(confirmed);
  assert.deepEqual(sourceHashReceiptFields(confirmed), { candidateId: head!.versionId, acquisitionSucceeded: true, state: "PROMOTED",
    decision: "GOOD", promotedVersion: head!.versionId, lastKnownGoodVersion: head!.versionId, confirmedAt: later });
  assert.equal(await confirmStatePeopleSource({ store, state: "az", roster: { ...roster, currentMembershipComplete: false }, acquisitions, now: later }), null);
  const rawHash = peopleSourceContentHash(acquisitions, roster);
  const input = { store, sourceId: "plural-openstates", recordClass: "STATE_LEGISLATOR" as const, scope, parserVersion: PLURAL_PARSER_VERSION,
    rawHash, now: later, complete: true, retrieval: { requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash, retrievedAt: later } };
  assert.equal(await confirmSourceHashUnchanged({ ...input, parserVersion: "repaired-parser" }), null);
  assert.equal(await confirmSourceHashUnchanged({ ...input, rawHash: "f".repeat(64) }), null);
  assert.equal((await store.confirmUnchanged!({ sourceId: input.sourceId, recordClass: input.recordClass, scope,
    parserVersion: "repaired-parser", pointerVersionId: head!.versionId, readModelHash: head!.normalizedHash!,
    basis: "RAW_HASH_UNCHANGED", retrieval: input.retrieval }, later)).kind, "HASH_DIFFERS");
});

test("the real source-head selector and unchanged event rule compare current source bytes and parser atomically", async () => {
  await withMigratedRoutineStore("openstates-people-az", async (store, vault, pg) => {
    const first = await publishStatePeople({ store, vault, state: "az", roster, acquisitions, releaseId: "a".repeat(40), now: at });
    assert.ok(first.outcome.promoted, JSON.stringify(first.outcome.candidate.receipt));
    const head = await store.readSourceHead("STATE_LEGISLATOR", scope);
    assert.equal(head?.rawHashBasis, "SOURCE_CONTENT_V1");
    for (const method of ["readCandidate", "readCandidatePath", "readPromotion", "readPublishedCandidateMetadata", "events"] as const)
      Object.assign(store, { [method]: async () => { throw new Error(`unchanged source read ${method}`); } });
    const confirmed = await confirmStatePeopleSource({ store, state: "az", roster, acquisitions, now: new Date().toISOString() });
    assert.ok(confirmed);
    const rows = (await pg.query<{ detail: string }>("SELECT detail FROM civic_data_candidate_events WHERE candidate_id=$1 ORDER BY sequence DESC LIMIT 1", [head!.versionId])).rows;
    assert.match(rows[0].detail, /RAW_HASH_UNCHANGED/);
    const bad = { sourceId: head!.sourceId, recordClass: head!.recordClass, scope, parserVersion: head!.parserVersion,
      pointerVersionId: head!.versionId, readModelHash: head!.normalizedHash!, basis: "RAW_HASH_UNCHANGED" as const,
      retrieval: { requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash: "f".repeat(64), retrievedAt: at } };
    assert.equal((await store.confirmUnchanged!(bad, new Date().toISOString())).kind, "HASH_DIFFERS");
  });
});
