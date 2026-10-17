import { immutableStateHash, immutableStateValue } from "../lib/civic-data/state-publication.ts";
import { bindStatePublicationPrior, consumeStatePublicationRecord, rememberStatePublicationHashes, rememberStatePublicationPrior, reuseStatePublicationRecord, statePublicationRecordHash, takeStatePublicationPrior, withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { canonicalCivicDataJson, candidateChangeSet, civicRecordFacts, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { decodeStateCandidate, durableStateHash, encodeStateCandidate, immutableStateCandidate } from "../lib/civic-data/state-publication.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const URL = "https://elections.example.gov/az/locations";

function candidate(at = NOW, replacement?: string): RoutineCandidate {
  return votingSitesCandidate({ state: "AZ", current: { generatedAt: "2026-10-16", jurisdictions: [{
    ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County", state: "AZ", model: "VOTE_CENTER",
    election: "2026 General", sourceOrg: "Example County Elections", sourceUrl: URL, collectedAt: "2026-10-16", refusal: null,
    sites: Array.from({ length: 80 }, (_, index) => ({ id: `site-${index}`, name: `Official center ${index}`,
      address: index === 0 && replacement ? replacement : `${index} Main Street, Exampleville, AZ 85000`, room: null, lat: 32.2, lng: -110.9,
      kind: "ELECTION_DAY" as const, election: "2026 General", serves: null })),
  }] }, prior: null, failures: [], successfulAuthorityReads: 1, requestedUrl: URL, finalUrl: URL, retrievedAt: at,
  acquisition: [{ url: URL, contentType: "text/html", vaultKey: "held/official-voting-sites",
    rawHash: "a".repeat(64), byteLength: 1000 }] });
}

test("state admission freezes one JSON graph and preserves exact durable values and shared rows", () => {
  const input = candidate(), expected = JSON.parse(JSON.stringify(input));
  const snapshot = immutableStateCandidate(input);
  assert.deepEqual(snapshot, expected);
  assert.equal(snapshot.readModel, input.readModel);
  assert.equal((snapshot.normalizedPayload as { projection: unknown }).projection, snapshot.readModel);
  const record = snapshot.civicRecords!.find(row => row.key.includes("site-0"))!;
  const payload = snapshot.readModel as { jurisdictions: { sites: { name: string }[] }[] };
  assert.equal(record.record, payload.jurisdictions[0].sites[0]);
  assert.throws(() => { payload.jurisdictions[0].sites[0].name = "unsourced replacement"; }, TypeError);
  assert.throws(() => Object.assign(snapshot.normalization, { normalizedHash: "f".repeat(64) }), TypeError);
  assert.equal(durableStateHash(snapshot.readModel), createHash("sha256").update(canonicalCivicDataJson(expected.readModel)).digest("hex"));
  assert.equal(durableStateHash({ missing: undefined }), null);
  assert.equal(durableStateHash({ nonfinite: Infinity }), canonicalCivicDataHash({ nonfinite: null }));
});

test("state storage contains each payload row once and reconstructs all audit aliases", async () => {
  const input = candidate(), changed = { ...input, changeSet: candidateChangeSet(input, null) };
  const saved = new Map<string, unknown>();
  const parts = new CivicPayloadParts({ existing: async hashes => hashes.filter(hash => saved.has(hash)),
    write: async values => { for (const value of values) saved.set(value.hash, structuredClone(value.payload)); },
    read: async hashes => hashes.map(hash => ({ hash, payload: saved.get(hash) })),
  });
  const encoded = encodeStateCandidate(changed);
  const bytes = JSON.stringify(encoded);
  assert.equal(bytes.split('"name":"Official center 0"').length - 1, 1);
  assert.equal(encoded.readModel, input.readModel);
  const stored = await parts.store(encoded, ["id", "sourceId", "recordClass", "scope", "normalization"]);
  const decoded = decodeStateCandidate(await parts.load(stored)) as RoutineCandidate;
  assert.deepEqual(decoded, JSON.parse(JSON.stringify(changed)));
  assert.equal((decoded.normalizedPayload as { projection: unknown }).projection, decoded.readModel);
  const site = (decoded.readModel as { jurisdictions: { sites: unknown[] }[] }).jurisdictions[0].sites[0];
  assert.equal(decoded.civicRecords!.find(row => row.key.includes("site-0"))!.record, site);
  assert.equal(decoded.changeSet!.added.find(row => row.key.includes("site-0"))!.after, site);
  assert.throws(() => decodeStateCandidate({ readModel: {}, normalizedPayload: { $civicCandidatePath: ["missing"] } }), /PATH_INVALID/);
});

test("state publication uses scalar encoding and an unchanged verified pass writes nothing", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-16T14:00:00.000Z"));
  const store = new MemoryRoutineDataStore(), input = candidate();
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (value: unknown, ...args: unknown[]) => {
    assert.ok(value === null || typeof value !== "object" || !["jurisdictions", "readModel", "normalizedPayload"].some(key => Object.hasOwn(value, key)),
      "publication must not stringify an aggregate candidate or payload");
    return stringify(value, ...args as []);
  });
  const first = await processRegisteredManualCandidate(store, "voting-sites:AZ", input, NOW);
  assert.equal(first.candidate.state, "PROMOTED", first.candidate.failureDetail ?? "");
  const history = await store.events(first.candidate.candidate.id);
  t.mock.method(store, "create", () => assert.fail("unchanged state must not create a candidate"));
  t.mock.method(store, "confirmUnchanged", () => assert.fail("unchanged state must not append confirmation evidence"));
  t.mock.method(store, "appendEvidence", () => assert.fail("unchanged state must not append reader evidence"));
  const second = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate("2026-10-16T13:00:00.000Z"), "2026-10-16T13:00:00.000Z");
  assert.equal(second.confirmed?.versionId, first.promoted?.versionId);
  assert.deepEqual(await store.events(first.candidate.candidate.id), history);
});


test("identical state rows share their owned prior while any durable field change remains distinct", () => {
  const input = candidate(), indexed = withStateRecordHashes(input), store = {};
  const payload = input.readModel as { jurisdictions: { sites: { id: string; address: string }[] }[] };
  const original = payload.jurisdictions[0].sites[0];
  const projection = { scope: input.scope, recordClass: input.recordClass, versionId: input.id, payload };
  immutableStateHash(immutableStateValue(payload));
  rememberStatePublicationHashes(projection, indexed.normalization);
  rememberStatePublicationPrior(store, projection);
  assert.equal(reuseStatePublicationRecord(original, structuredClone(original)), original);
  assert.ok(Object.isFrozen(original));
  assert.equal(reuseStatePublicationRecord(original, { ...original, address: "Changed official address" }), null);
  assert.equal(reuseStatePublicationRecord(original, { ...original, checkedAt: "2026-10-16T14:00:00.000Z" }), null);
  const invalid = { ...original, address: BigInt(1) };
  assert.equal(reuseStatePublicationRecord(original, invalid), null);
  assert.throws(() => immutableStateValue(invalid), /BigInt/);
  const altered = payload.jurisdictions[0].sites[1], captured = structuredClone(altered);
  assert.throws(() => { altered.address = "Changed after index verification"; }, TypeError);
  assert.equal(reuseStatePublicationRecord(altered, captured), altered);
  consumeStatePublicationRecord(original, original);
  const prior = takeStatePublicationPrior(store, input.recordClass, input.scope)!;
  assert.equal(prior.recordHashes, indexed.normalization.stateRecordHashes);
  const member = civicRecordsFor(input.recordClass, payload).find(member => member.record === original)!;
  assert.ok(!Object.hasOwn(prior.members.get(member.key)!, "record"));
});

test("state merge releases reused prior facts immediately and preserves exact changed audit values", () => {
  const prior = candidate(), next = candidate("2026-10-16T13:00:00.000Z"), store = {};
  const before = prior.readModel as { jurisdictions: { collectedAt: string; sites: { id: string; address: string }[] }[] };
  const after = next.readModel as typeof before;
  const original = before.jurisdictions[0], updated = after.jurisdictions[0];
  updated.collectedAt = "2026-10-16T13:00:00.000Z";
  updated.sites[1].address = "Verified replacement address";
  updated.sites.pop();
  const expected = candidateChangeSet(next, prior.readModel);
  const projection = { key: `${prior.recordClass}:${prior.scope}`, versionId: prior.id,
    lastKnownGoodVersionId: prior.id, sourceId: prior.sourceId, recordClass: prior.recordClass, scope: prior.scope,
    payload: prior.readModel, promotedAt: NOW, receipt: null as never };
  rememberStatePublicationHashes(projection, withStateRecordHashes(prior).normalization);
  immutableStateHash(immutableStateValue(projection.payload));
  rememberStatePublicationPrior(store, projection);
  consumeStatePublicationRecord(original, updated);
  for (const old of original.sites) consumeStatePublicationRecord(old, updated.sites.find(row => row.id === old.id) ?? null);
  const indexed = takeStatePublicationPrior(store, prior.recordClass, prior.scope)!;
  const reused = [...indexed.members].filter(([key]) => key.startsWith("site:") && !key.endsWith(":site-1") && !key.endsWith(":site-79"));
  assert.ok(reused.every(([, member]) => !Object.hasOwn(member, "record")), "no old reused record survives the merge");
  assert.ok(!Object.hasOwn([...indexed.members.values()].find(member => member.key.startsWith("jurisdiction:"))!, "record"));
  const actual = candidateChangeSet(next, null, undefined, indexed);
  assert.deepEqual(actual, expected);
  assert.equal(actual.changed[0].before, original.sites[1]);
  assert.equal(actual.changed[0].after, updated.sites[1]);
  assert.ok([...indexed.members.values()].every(member => !Object.hasOwn(member, "record")), "validation holds hashes and only changeSet holds old changed values");
  assert.equal(takeStatePublicationPrior(store, prior.recordClass, prior.scope), undefined);
});


test("a shared profile object is consumed separately for each civic key", () => {
  const shared = { name: "A verified candidate", office: "Mayor" }, changed = { ...shared, office: "Council" };
  const prior = { kind: "candidate-profiles", cards: { cards: { first: shared, alias: shared } } };
  const next = { kind: "candidate-profiles", cards: { cards: { first: shared, alias: changed } } };
  const input = { ...candidate(), recordClass: "CANDIDATE_PROFILE" as const, scope: "US-AZ:candidate-profiles", readModel: next }, store = {};
  const projection = { key: `${input.recordClass}:${input.scope}`, sourceId: input.sourceId, recordClass: input.recordClass,
    scope: input.scope, versionId: "prior", lastKnownGoodVersionId: "prior", payload: prior, promotedAt: NOW, receipt: null as never };
  rememberStatePublicationHashes(projection, withStateRecordHashes({ ...input, readModel: prior,
    normalization: { ...input.normalization, normalizedHash: canonicalCivicDataHash(prior) } }).normalization);
  immutableStateHash(immutableStateValue(projection.payload));
  rememberStatePublicationPrior(store, projection);
  consumeStatePublicationRecord(shared, shared, "card:first");
  consumeStatePublicationRecord(shared, changed, "card:alias");
  const index = takeStatePublicationPrior(store, input.recordClass, input.scope)!;
  assert.ok(!Object.hasOwn(index.members.get("card:first")!, "record"));
  assert.equal(index.members.get("card:alias")!.record, shared);
  const delta = candidateChangeSet(input, null, undefined, index);
  assert.deepEqual(delta.changed, [{ key: "card:alias", before: shared, after: changed }]);
});


test("a stale state merge is refused without reading its superseded payload", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-16T16:00:00.000Z"));
  const store = new MemoryRoutineDataStore();
  const first = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate(), NOW);
  const second = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate("2026-10-16T13:00:00.000Z", "1 Updated Road, Exampleville, AZ 85000"), "2026-10-16T13:00:00.000Z");
  assert.equal(second.candidate.state, "PROMOTED");
  Object.assign(store, { readStatePublicationBase: async () => ({
    current: { ...second.promoted!, payload: null },
    lkg: { ...second.candidate, candidate: { ...second.candidate.candidate, readModel: null, normalizedPayload: null } },
  }) });
  const readCandidate = store.readCandidate.bind(store);
  t.mock.method(store, "readCandidate", async (id: string) => {
    assert.notEqual(id, first.candidate.candidate.id, "lost CAS must not hydrate the superseded state");
    return readCandidate(id);
  });
  const result = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate("2026-10-16T14:00:00.000Z", "2 Updated Road, Exampleville, AZ 85000"),
    "2026-10-16T14:00:00.000Z", first.candidate.candidate.id);
  assert.equal(result.candidate.failureCode, "PROMOTION_BASE_CHANGED");
  assert.equal(result.promoted, null);
  assert.equal((await store.readPromotion("VOTING_SITE", "US-AZ:voting-sites"))?.versionId, second.promoted!.versionId);
});


test("state publication derives persisted member hashes and refuses a forged prior index", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-16T14:00:00.000Z"));
  const store = new MemoryRoutineDataStore(), input = candidate();
  const supplied = { ...input, normalization: { ...input.normalization, stateRecordHashes: {
    readModelHash: input.normalization.normalizedHash!, members: [{ key: "invented", factsHash: "f".repeat(64), sha256: "f".repeat(64) }],
  } } };
  const outcome = await processRegisteredManualCandidate(store, "voting-sites:AZ", supplied, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
  const hashes = outcome.candidate.candidate.normalization.stateRecordHashes!;
  assert.equal(hashes.readModelHash, input.normalization.normalizedHash);
  assert.deepEqual(hashes.members, civicRecordsFor(input.recordClass, input.readModel).map(member => ({
    key: member.key, sha256: canonicalCivicDataHash(member.record), factsHash: canonicalCivicDataHash(civicRecordFacts(input.recordClass, member)),
  })));
  const read = await readPromotedCivicData(input.recordClass, input.scope, { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const firstSite = (read.value as { jurisdictions: { sites: object[] }[] }).jurisdictions[0].sites[0];
  assert.ok(Object.isFrozen(firstSite));
  assert.throws(() => Object.defineProperty(firstSite, "address", { value: "Changed after verification" }), TypeError);
  rememberStatePublicationPrior(store, read.projection);
  const prior = takeStatePublicationPrior(store, input.recordClass, input.scope)!;
  assert.equal(prior.members.size, hashes.members.length);
  const tampered = { ...outcome.candidate.candidate, normalization: { ...outcome.candidate.candidate.normalization,
    stateRecordHashes: { ...hashes, members: hashes.members.map((member, index) => index ? member : { ...member, factsHash: "f".repeat(64) }) } } };
  assert.throws(() => bindStatePublicationPrior(tampered, prior), /STATE_PRIOR_RECORD_HASHES_MISMATCH/);
  assert.throws(() => rememberStatePublicationHashes(read.projection, { ...input.normalization,
    stateRecordHashes: { ...hashes, readModelHash: "f".repeat(64) } }), /STATE_RECORD_HASHES_PAYLOAD_MISMATCH/);
  assert.throws(() => rememberStatePublicationPrior({}, { ...read.projection }), /STATE_RECORD_HASHES_NOT_VERIFIED/);
});

test("state digest reuse never trusts a caller's shallow freeze", () => {
  const nested = { title: "Before" }, shallow = Object.freeze({ nested });
  const before = immutableStateHash(shallow);
  nested.title = "After";
  assert.notEqual(immutableStateHash(shallow), before);
  const owned = immutableStateValue(shallow);
  assert.equal(immutableStateValue(owned), owned);
  assert.equal(immutableStateHash(owned), canonicalCivicDataHash(owned));
  assert.throws(() => { nested.title = "Changed after ownership"; }, TypeError);
});

test("indexed immutable state records compare durable structure without serializing or rehashing rows", t => {
  const record = { name: "An official candidate", details: { party: "Independent", incumbent: false },
    aliases: ["Official name", null], position: 0 };
  const payload = { kind: "candidate-profiles", cards: { cards: { candidate: record } } };
  const input = { ...candidate(), recordClass: "CANDIDATE_PROFILE" as const, scope: "US-AZ:candidate-profiles",
    readModel: structuredClone(payload), normalization: { ...candidate().normalization, normalizedHash: canonicalCivicDataHash(payload) } };
  const indexed = withStateRecordHashes(input), store = {};
  const projection = { scope: input.scope, recordClass: input.recordClass, versionId: input.id,
    payload: immutableStateValue(payload) };
  assert.equal(immutableStateHash(projection.payload), indexed.normalization.normalizedHash);
  rememberStatePublicationHashes(projection, indexed.normalization);
  const equivalent = { position: -0, aliases: ["Official name", undefined], details: { incumbent: false, party: "Independent" },
    name: "An official candidate", omitted: undefined };
  t.mock.method(JSON, "stringify", () => assert.fail("verified state members do not need another serialization"));
  rememberStatePublicationPrior(store, projection);
  assert.equal(immutableStateHash(record), indexed.normalization.stateRecordHashes!.members[0].sha256);
  assert.equal(reuseStatePublicationRecord(record, equivalent), record);
  assert.equal(Object.isFrozen(equivalent), false);
  assert.equal(Object.isFrozen(equivalent.details), false);
  equivalent.details.party = "Discarded incoming value";
  assert.equal(record.details.party, "Independent");
  assert.equal(reuseStatePublicationRecord(record, { ...record, aliases: ["Official name", NaN] }), record);
  let invoked = 0;
  const accessor = { ...record, get name() { invoked++; return record.name; } };
  const customJson = { ...record };
  Object.defineProperty(customJson, "toJSON", { value() { invoked++; return record; } });
  assert.equal(reuseStatePublicationRecord(record, accessor), null);
  assert.equal(reuseStatePublicationRecord(record, customJson), null);
  assert.equal(reuseStatePublicationRecord(record, new Proxy({ ...record }, {
    getPrototypeOf() { assert.fail("a proxy must be declined before invoking its traps"); },
  })), null);
  assert.equal(invoked, 0);
  assert.equal(reuseStatePublicationRecord(record, { ...record, aliases: [null, "Official name"] }), null);
  assert.equal(reuseStatePublicationRecord(record, { ...record, details: { ...record.details, incumbent: true } }), null);
  assert.equal(reuseStatePublicationRecord(record, { ...record, checkedAt: NOW }), null);
  assert.throws(() => { record.details.party = "Mutated"; }, TypeError);
  assert.throws(() => Object.assign(indexed.normalization.stateRecordHashes!.members[0], { sha256: "f".repeat(64) }), TypeError);
});

test("a prior index cannot seed member digests without the exact privately owned verified payload", () => {
  const input = candidate(), indexed = withStateRecordHashes(input), store = {};
  const projection = { scope: input.scope, recordClass: input.recordClass, versionId: input.id, payload: input.readModel };
  rememberStatePublicationHashes(projection, indexed.normalization);
  assert.throws(() => rememberStatePublicationPrior(store, projection), /STATE_PRIOR_PAYLOAD_NOT_VERIFIED/);
  immutableStateValue(projection.payload);
  assert.throws(() => rememberStatePublicationPrior(store, projection), /STATE_PRIOR_PAYLOAD_NOT_VERIFIED/);
  assert.equal(immutableStateHash(projection.payload), indexed.normalization.normalizedHash);
  rememberStatePublicationPrior(store, projection);
  assert.equal(takeStatePublicationPrior(store, input.recordClass, input.scope)!.recordHashes, indexed.normalization.stateRecordHashes);
});

test("successor indexes share verified immutable entries only for the same record and civic key", t => {
  const held = { name: "Official candidate", office: "Mayor" }, changed = { ...held, office: "Council" };
  const before = { kind: "candidate-profiles", cards: { cards: { original: held } } };
  const input = { ...candidate(), recordClass: "CANDIDATE_PROFILE" as const, scope: "US-AZ:candidate-profiles",
    readModel: structuredClone(before), normalization: { ...candidate().normalization, normalizedHash: canonicalCivicDataHash(before) } };
  const stored = withStateRecordHashes(input).normalization.stateRecordHashes!;
  const projection = { scope: input.scope, recordClass: input.recordClass, versionId: input.id, payload: immutableStateValue(before) };
  assert.equal(immutableStateHash(projection.payload), stored.readModelHash);
  rememberStatePublicationHashes(projection, { ...input.normalization, stateRecordHashes: stored });
  rememberStatePublicationPrior({}, projection);
  const next = immutableStateValue({ ...before, note: "Checked again" });
  const nextHash = immutableStateHash(next), stringify = t.mock.method(JSON, "stringify", () => assert.fail("unchanged member entries are shared"));
  const shared = withStateRecordHashes({ ...input, readModel: next, normalization: { ...input.normalization, normalizedHash: nextHash } });
  assert.equal(shared.normalization.stateRecordHashes!.members[0], stored.members[0]);
  stringify.mock.restore();
  const moved = immutableStateValue({ kind: "candidate-profiles", cards: { cards: { moved: held, original: changed } } });
  const updated = withStateRecordHashes({ ...input, readModel: moved, normalization: { ...input.normalization, normalizedHash: immutableStateHash(moved) } });
  const [movedEntry, changedEntry] = updated.normalization.stateRecordHashes!.members;
  assert.notEqual(movedEntry, stored.members[0]);
  assert.equal(movedEntry.sha256, stored.members[0].sha256);
  assert.equal(movedEntry.key, "card:moved");
  assert.notEqual(changedEntry.sha256, stored.members[0].sha256);
  assert.throws(() => { held.office = "Mutation"; }, TypeError);
});

test("member-index caching separates record classes and never trusts a caller's shallow freeze", () => {
  const row = immutableStateValue({ id: "contest-one", title: "Official contest" });
  const payload = immutableStateValue({ ballots: { AZ: { contests: [row] } } });
  const input = { ...candidate(), recordClass: "BALLOT_CANDIDACY" as const, scope: "US-AZ:state-election-ballots",
    readModel: payload, normalization: { ...candidate().normalization, normalizedHash: immutableStateHash(payload) } };
  const first = withStateRecordHashes(input).normalization.stateRecordHashes!.members[0];
  assert.equal(statePublicationRecordHash("CANDIDATE_PROFILE", { key: first.key, record: row }), undefined);
  assert.equal(statePublicationRecordHash("BALLOT_CANDIDACY", { key: first.key, record: row }), first);
  const nested = { title: "Before" }, shallow = Object.freeze({ id: "contest-two", nested });
  const mutable = { ...input, readModel: { ballots: { AZ: { contests: [shallow] } } } };
  const prior = withStateRecordHashes(mutable).normalization.stateRecordHashes!.members[0];
  nested.title = "After";
  const successor = withStateRecordHashes(mutable).normalization.stateRecordHashes!.members[0];
  assert.notEqual(successor.sha256, prior.sha256);
});


test("state change auditing honors custom facts even when standard record hashes are cached", () => {
  const before = immutableStateCandidate(candidate()), after = immutableStateCandidate(candidate(NOW, "Different official address"));
  withStateRecordHashes(before);
  withStateRecordHashes(after);
  assert.equal(candidateChangeSet(after, before.readModel).changed.length, 1);
  const custom = { members: civicRecordsFor, facts: () => null };
  assert.equal(candidateChangeSet(after, before.readModel, custom).changed.length, 0);
});
