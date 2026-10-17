import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { publishOfficialBallotCandidacies, statePeopleCandidacyHolders } from "../lib/civic-data/official-candidacy-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { primeFederalDirectoryFromValue } from "../lib/officials/federal-directory-read-model.ts";
import { officialCandidacySeatMatches, reconcileOfficialCandidacies, type OfficialCandidacyBridge } from "../lib/registry/runtime-data-plane.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { currentStatePeopleProjection, primeStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installManualValue, registryTransferImport, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { rowKeyedCivicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { trustedLkgImportUrl } from "../lib/civic-data/trusted-lkg-import.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "../lib/civic-data/changes.ts";
import { trustedLkgCandidateEnvelopeSha256 } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgValidatorIds } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgCandidateId } from "../lib/civic-data/trusted-lkg-import.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";

function stateRegistryRuntimeStore(state: string, store = new MemoryRoutineDataStore()): MemoryRoutineDataStore {
  const original = registryTransferImport();
  const payload = registryFixtureForState(state), scope = stateRegistryRuntimeScope(state), contractId = stateRegistryRuntimeContractId(state);
  const civicRecords = rowKeyedCivicRecordsFor("REGISTRY_RUNTIME_BINDING", payload), digest = canonicalCivicDataHash(payload);
  const candidate = { ...original.record.candidate, scope,
    retrieval: { ...original.record.candidate.retrieval, requestedUrl: trustedLkgImportUrl(contractId) },
    normalization: { ...original.record.candidate.normalization, normalizedHash: digest, normalizedPayloadHash: digest,
      inputRecords: civicRecords.length, outputRecords: civicRecords.length, droppedRecords: 0 },
    normalizedPayload: payload, readModel: payload, civicRecords, identities: [],
    horizon: { ...original.record.candidate.horizon, returnedRecords: civicRecords.length },
    sourceProjectionEvidence: { kind: "SOURCE_PROJECTION_CONTRACT" as const, sourceId: original.record.candidate.sourceId, recordClass: original.record.candidate.recordClass, scope },
  };
  Object.assign(candidate, { normalization: withStateRecordHashes(candidate).normalization });
  candidate.changeSet = candidateChangeSet(candidate, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  candidate.bootstrapImport = { ...original.record.candidate.bootstrapImport!, contractId, scope,
    normalizedPayloadSha256: digest, readModelSha256: digest, candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate), validatorIds: trustedLkgValidatorIds(candidate) };
  candidate.id = trustedLkgCandidateId(candidate.bootstrapImport);
  const receipt = { ...original.record.receipt!, candidateId: candidate.id, scope };
  const record = { ...original.record, candidate, receipt, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id };
  const projection = { ...original.projection, key: `REGISTRY_RUNTIME_BINDING:${scope}`, scope, versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id, payload, receipt };
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

const now = "2026-10-13T12:00:00.000Z";
const registry = registryTransferImport().projection.payload;
const source = "https://elections.example.gov/official-candidates";
const provenance = { sourceUrl: source, sourceOrg: "State election authority", collectedAt: now, verifiedAt: now };

function ballot(state: string, office: string, name: string, division = `ocd-division/country:us/state:${state.toLowerCase()}`): BallotSet {
  const id = `ballot-contest:${state.toLowerCase()}-fixture`;
  return { election: { id: `${state}-general`, state, name: "General Election", date: "2026-11-03" },
    contests: [{ id, electionId: `${state}-general`, ocdId: division, divisionVintage: "TIGER2026", title: office,
      type: "CANDIDACY", voteFor: null, termYears: null, scopeNote: null, candidateListComplete: true, provenance }],
    candidacies: [{ id: `ballot-candidacy:${state.toLowerCase()}-incumbent`, contestId: id, givenName: "", familyName: name,
      partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance }], measures: [], absences: [] };
}

test("Ohio and Michigan national candidacies resolve by exact seat with a null seat count", () => {
  const ballots = [ballot("OH", "United States Senator", "Jon Husted"), ballot("MI", "U.S. Senator", "Elissa Slotkin")];
  const bridge = reconcileOfficialCandidacies({ bridge: registry.officialCandidacies, ballots });
  for (const [state, officialId] of [["oh", "congress:H001104"], ["mi", "congress:S001208"]]) {
    const row = bridge.rows.find(row => row.holder.id === officialId)!;
    assert.equal(row.status, "RESOLVED");
    assert.equal(row.candidacy?.candidacyId, `ballot-candidacy:${state}-incumbent`);
    assert.equal(officialCandidacySeatMatches(row), true);
  }
  assert.deepEqual(bridge.rows.find(row => row.holder.id === "statewide:az/governor"),
    registry.officialCandidacies.rows.find(row => row.holder.id === "statewide:az/governor"));
});

test("same names in another office, division or numbered seat never become candidacy links", () => {
  for (const candidate of [ballot("OH", "Governor", "Jon Husted"), ballot("MI", "U.S. Senator", "Jon Husted"),
    ballot("OH", "United States Senator, Seat 2", "Jon Husted")]) {
    const bridge = reconcileOfficialCandidacies({ bridge: registry.officialCandidacies, ballots: [candidate] });
    assert.equal(bridge.rows.find(row => row.holder.id === "congress:H001104")?.status, "NO_APPLICABLE_CANDIDACY");
  }
  for (const id of ["congress:B001302", "congress:S001183", "statewide:az/state-treasurer"]) {
    assert.equal(officialCandidacySeatMatches(registry.officialCandidacies.rows.find(row => row.holder.id === id)!), false);
  }
});

test("a duplicate name on one contest stays unresolved", () => {
  const duplicate = ballot("OH", "United States Senator", "Jon Husted");
  duplicate.candidacies.push({ ...duplicate.candidacies[0], id: "ballot-candidacy:oh-other" });
  const bridge = reconcileOfficialCandidacies({ bridge: registry.officialCandidacies, ballots: [duplicate] });
  const row = bridge.rows.find(row => row.holder.id === "congress:H001104")!;
  assert.equal(row.status, "IDENTITY_UNRESOLVED");
  assert.deepEqual(row.unresolvedCandidacyIds, ["ballot-candidacy:oh-incumbent", "ballot-candidacy:oh-other"]);
});

test("STATE_PEOPLE current-holder checks connect a national candidacy and refuse a successor", async () => {
  const division = "ocd-division/country:us/state:mi/sldl:7";
  const template = syntheticFederalDirectory().roster.officeholders[0];
  const person = { ...template, id: "plural:mi:fixture", name: "Morgan Example", officeTitle: "State Representative", state: "MI", chamber: "lower", level: "STATE" as const };
  const roster = { scope: "26", generatedAt: now, officeholders: [person],
    divisions: [{ officeholderId: person.id, ocdId: division, bodyId: null }], unmatched: [] };
  const candidate = ballot("MI", "State Representative, District 7", person.name, division);
  const bridge = reconcileOfficialCandidacies({ bridge: registry.officialCandidacies, ballots: [candidate], holders: statePeopleCandidacyHolders(roster) });
  const value = { ...registry, officialCandidacies: bridge };
  installManualValue("registry-runtime:MI", registryFixtureForState("MI", value), "state-person");
  await readRegistryRuntimeProjection(["MI"], { bypassCache: true });
  primeStatePeopleProjection({ formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-MI", term: "2026", generatedAt: now, roster });
  assert.deepEqual(officialIdsForCandidacy(candidate.candidacies[0].id), [person.id]);
  assert.deepEqual(resolvedCandidacyForOfficial(person.id), { candidacyId: candidate.candidacies[0].id, contestId: candidate.contests[0].id });
  primeStatePeopleProjection({ formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-MI", term: "2026", generatedAt: now,
    roster: { ...roster, officeholders: [{ ...person, name: "A Different Person" }] } });
  assert.deepEqual(officialIdsForCandidacy(candidate.candidacies[0].id), []);

});

test("state people used by a reader stay within that request", () => {
  const model = { formatVersion: 1 as const, sourceId: "plural-openstates", jurisdiction: "US-MI" as const,
    term: "2026", generatedAt: now, roster: syntheticFederalDirectory().roster };
  withReaderAuthorityEdge({}, () => {
    primeStatePeopleProjection(model);
    assert.equal(currentStatePeopleProjection("US-MI"), model);
    withReaderAuthorityEdge({}, () => assert.equal(currentStatePeopleProjection("US-MI"), null));
    assert.equal(currentStatePeopleProjection("US-MI"), model);
  });
});

test("published national ballot rows are written to the promoted registry bridge", async () => {
  const store = stateRegistryRuntimeStore("OH", new MemoryRoutineDataStore());
  stateRegistryRuntimeStore("MI", store);
  const ballots = [ballot("OH", "United States Senator", "Jon Husted"), ballot("MI", "U.S. Senator", "Elissa Slotkin")];
  const sourceReceipt: ManualSourceSetReceipt = { contractVersion: 1, reviewedAt: now, reviewedBy: "state-election-authority",
    sources: [{ requestedUrl: source, finalUrl: source, publisher: "State election authority", sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: now, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "Exact official candidate list and contest identities reviewed." }] };
  for (const row of ballots) await publishOfficialBallotCandidacies({ store, ballots: [row], sourceReceipt, now });
  const read = await readRegistryRuntimeProjection(["OH", "MI"], { store, now, bypassCache: true });
  assert.equal(read.kind, "BOOTSTRAP");
  if (read.kind !== "BOOTSTRAP") return;
  primeFederalDirectoryFromValue(syntheticFederalDirectory(read.value), "national-federal-directory");
  assert.deepEqual(officialIdsForCandidacy("ballot-candidacy:oh-incumbent"), ["congress:H001104"]);
  assert.deepEqual(officialIdsForCandidacy("ballot-candidacy:mi-incumbent"), ["congress:S001208"]);
  const held = read.value.officialCandidacies as OfficialCandidacyBridge;
  assert.equal(held.rows.find(row => row.holder.id === "congress:H001104")?.status, "RESOLVED");
  const removed = structuredClone(ballots[0]);
  removed.candidacies[0] = { ...removed.candidacies[0], id: "ballot-candidacy:oh-challenger", familyName: "Morgan Example" };
  await publishOfficialBallotCandidacies({ store, ballots: [removed], sourceReceipt, now: "2026-10-13T12:01:00.000Z" });
  await readRegistryRuntimeProjection(["OH", "MI"], { store, now: "2026-10-13T12:01:00.000Z", bypassCache: true });
  primeFederalDirectoryFromValue(syntheticFederalDirectory(), "withdrawal-federal-directory");
  assert.equal(resolvedCandidacyForOfficial("congress:H001104"), null);
  assert.deepEqual(officialIdsForCandidacy("ballot-candidacy:oh-incumbent"), []);
  assert.deepEqual(officialIdsForCandidacy("ballot-candidacy:mi-incumbent"), ["congress:S001208"]);
  const duplicate = structuredClone(ballots[0]);
  duplicate.candidacies.push({ ...duplicate.candidacies[0], id: "ballot-candidacy:oh-duplicate" });
  await publishOfficialBallotCandidacies({ store, ballots: [duplicate], sourceReceipt, now: "2026-10-13T12:02:00.000Z" });
  primeFederalDirectoryFromValue(syntheticFederalDirectory(), "ambiguity-federal-directory");
  const ambiguous = await readRegistryRuntimeProjection(["OH", "MI"], { store, now: "2026-10-13T12:02:00.000Z", bypassCache: true });
  assert.equal(ambiguous.kind, "BOOTSTRAP");
  if (ambiguous.kind === "BOOTSTRAP") assert.equal(ambiguous.value.officialCandidacies.rows.find(row => row.holder.id === "congress:H001104")?.status, "IDENTITY_UNRESOLVED");
  assert.deepEqual(officialIdsForCandidacy("ballot-candidacy:oh-incumbent"), []);
});
