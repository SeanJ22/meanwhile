import { registryRuntimeProjectionIssues } from "../lib/registry/runtime-data-plane.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeStatePublicationPrior } from "../lib/civic-data/state-publication.ts";
import test from "node:test";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { recordRoutineReaderProjectionReadback } from "../lib/civic-data/reader-verification.ts";
import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import type { RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { readerOfficeholders } from "../lib/ask/server-sources.ts";
import { composeReaderOfficials, readerOfficialsQuestion } from "../lib/ask/reader-officials.ts";
import { sourceProjectionEvidence, type ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import {
  federalDirectoryForState,
  federalDirectoryScope,
  FEDERAL_DIRECTORY_SOURCE_ID,
  failedFederalDirectoryCandidate,
  federalDirectoryCandidate,
  type FederalDirectoryAcquisition,
} from "../lib/officials/federal-directory-data-plane.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import {
  readRegistryRuntimePrior,
  acceptedRegistryPrior,
  registryRuntimeCandidate,
  registryRuntimeCandidateFromFile,
  type RegistryRuntimePackage,
  type RegistryRuntimeCarton,
  type RegistryRuntimeReadModel,
} from "../lib/registry/runtime-data-plane.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { getRegistryRuntimeReadModel, readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE, isCensusPlaceholderDivision, withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";
import { slotsFor } from "../lib/registry/derive.ts";
import type { Registry } from "../lib/registry/types.ts";
import { registryTransferImport, syntheticFederalDirectory, syntheticStateLegislators } from "./helpers/promoted-fixtures.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { rowKeyedCivicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { trustedLkgImportUrl } from "../lib/civic-data/trusted-lkg-import.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
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

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function federalSeed() {
  return structuredClone(syntheticFederalDirectory());
}

function federalAcquisitions(sourceSha: string, suffix: string): FederalDirectoryAcquisition[] {
  return ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"].map((name) => {
    const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: `${suffix}:${name}` };
  });
}

function registryUrls(value: RegistryRuntimeCarton): string[] {
  return [...new Set([
    ...value.registry.divisions.map((division) => division.provenance?.sourceUrl ?? ""),
    ...value.registry.bodies.map((body) => body.provenance?.sourceUrl ?? ""),
    ...value.statewideExecutives.flatMap((row) => [row.sourceUrl, row.partySourceUrl ?? ""]),
    ...value.officialCandidacies.rows.map((row) => row.candidacy?.sourceUrl ?? ""),
    ...value.officialPhotos.photos.map((photo) => photo.sourceUrl ?? ""),
  ].filter((url) => /^https:\/\//.test(url)))].sort();
}

function receipt(value: RegistryRuntimeCarton, at: string, salt: string): ManualSourceSetReceipt {
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "owner-test",
    sources: registryUrls(value).map((url) => ({
      requestedUrl: url,
      finalUrl: url,
      publisher: "Exact named public source",
      sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: at,
      httpStatus: 200,
      rawHash: hash(`${salt}:${url}`),
      reviewedEvidence: "Exact source bytes and normalized body/person binding reviewed together.",
    })),
  };
}

function servedRegistry(state?: string): RegistryRuntimeCarton {
  const { bodyRosters: _rosters, rosterReaderDispositions: _dispositions, ...imported } = state ? registryFixtureForState(state) : registryTransferImport().projection.payload;
  const placeholders = frozenPlaceholders().ids;
  return { ...imported, registry: { ...imported.registry, bodies: imported.registry.bodies.filter((body) => body.ocdId === null || !placeholders.has(body.ocdId)) } };
}

async function registryPackage(at: string, salt: string, state: "AZ" | "NH" | "OH" = "AZ"): Promise<RegistryRuntimePackage> {
  const payload = structuredClone(servedRegistry(state));
  return { contractId: `registry-runtime:${state}`, version: at, sourceThrough: at, sourceReceipt: receipt(payload, at, salt), payload };
}

test("Ask reads native state people beside a partitioned registry without reviving superseded legislative seat rows", async () => {
  const memory = new MemoryRoutineDataStore();
  const pkg = await registryPackage(T0, "district-seats", "OH");
  const model = structuredClone(registryRuntimeCandidate(pkg).readModel) as { -readonly [K in keyof RegistryRuntimeCarton]: RegistryRuntimeCarton[K] };
  const districts = ["ocd-division/country:us/state:oh/sldl:1", "ocd-division/country:us/state:oh/sldu:15"];
  for (const [index, division] of districts.entries()) {
    const id = `${division}#seat`;
    model.registry.divisions.push({ ...model.registry.divisions[0]!, ocdId: division });
    model.registry.bodies.push({ ...registryFixtureForState("AZ").registry.bodies[0]!, id, ocdId: division, name: `Ohio legislative seat ${index}` });
    const memberId = `roster:${id}#held`;
    model.officialCandidacies = { ...model.officialCandidacies, rows: [...model.officialCandidacies.rows, {
      holder: { id: memberId, name: `Superseded seat member ${index}`,
        officeTitle: index ? "Senator" : "Representative", divisions: [division], authority: "REGISTRY_BODY_ROSTER",
        sourceUrl: `https://ohio.example.gov/seat/${index}` },
      status: "NOT_CHECKED", candidacy: null, reason: "This fixture has no candidacy finding.", unresolvedCandidacyIds: [],
    }] };
  }
  model.registry.bodies[0].provenance = { ...model.registry.bodies[0].provenance, sourceOrg: "Official fixture publisher ".repeat(1500) };
  const candidate = registryRuntimeCandidate({ ...pkg, payload: model, sourceReceipt: receipt(model, T0, "district-seats") });
  const published = await processRegisteredManualCandidate(memory, "registry-runtime:OH", candidate, T0);
  assert.equal(published.candidate.state, "PROMOTED", published.candidate.failureDetail ?? undefined);
  const pointer = published.promoted!;
  const payload = partitionCivicPayload(pointer.payload);
  const metadata = (await memory.readPublishedCandidateMetadata(candidate.id))!;
  const envelope = partitionCivicPayload(metadata.candidate, ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal"]);
  const parts = [...new Map([...payload.parts, ...envelope.parts].map(row => [row.hash, row])).values()];
  assert.ok(payload.parts.length > 0, "this must exercise a storage reference, not inline JSON");
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://local:local@ep-test.neon.tech/neondb";
  installFactReader(null);
  try {
    const postgres = new PostgresRoutineDataStore();
    const queries: unknown[][] = [];
    Object.assign(postgres, { db: { execute: async (statement: SQL) => {
      const query = new PgDialect().sqlToQuery(statement);
      queries.push(query.params);
      assert.match(query.sql, /WHERE p\.key = \$/);
      return { rows: [structuredClone({ value: { projection: { ...pointer, payload: payload.value },
        candidate: { ...metadata, candidate: envelope.value } }, coupled: true, reuse: false, confirmation: null,
        parts: Object.fromEntries(parts.map(part => [part.hash, part.payload])) })] };
    } } });
    const read = await readRegistryRuntimeProjection(["OH"], { store: postgres, bypassCache: true, now: T0 });
    if (read.kind !== "PROMOTED") throw new Error(JSON.stringify(read));
    assert.equal(queries.length, 1, "the state payload, encoded parts and scalar proof arrive in one keyed read");
    assert.ok(queries[0].includes(pointer.key));
    const entry = provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("OH"), sourceId: candidate.sourceId, versionId: read.metadata.versionId!, value: read.value });
    const stateAuthorities = { families: new Set(["registry-runtime"] as const), load: async () => ({ kind: "PROMOTED_POINTERS" as const, entries: [entry] }) };
    await withReaderAuthorityEdge({ edgeOnly: true, stateAuthorities }, async () => {
      const held = await readerOfficeholders(districts);
      assert.ok(held.loaderFailures > 0, "the missing state authority stays a reported gap");
      assert.ok(held.seats.every(seat => !seat.name.startsWith("Superseded seat member")), "registry seat rows are no longer a competing legislative authority");
    });
    const sample = syntheticStateLegislators("US-NJ").roster.officeholders[0]!;
    const people = districts.map((_division, index) => ({
      ...sample, id: `plural:oh:00000000-0000-4000-8000-00000000000${index + 1}`,
      personId: `plural:00000000-0000-4000-8000-00000000000${index + 1}`,
      name: index ? "Hearcel F. Craig" : "Dontavius L. Jarrells", state: "OH", chamber: index ? "upper" : "lower",
      officeTitle: index ? "State Senator" : "State Representative",
      provenance: { sourceUrl: `https://github.com/openstates/people/blob/${"a".repeat(40)}/data/oh/legislature/person-${index}.yml`,
        sourceOrg: "Plural / Open States", collectedAt: T0, verifiedAt: null },
    }));
    const statePeople: OfficialStateLegislatorReadModel = { formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-OH",
      term: "2025-2026", generatedAt: T0, roster: { scope: "OH", generatedAt: T0, officeholders: people,
        divisions: districts.map((ocdId, index) => ({ ocdId, officeholderId: people[index].id, bodyId: null })), unmatched: [] } };
    const stateReads: string[] = [];
    await withReaderAuthorityEdge({ edgeOnly: true, stateAuthorities, stateLegislators: { load: async scope => {
      stateReads.push(scope);
      assert.equal(scope, "US-OH");
      return { value: statePeople, versionId: "test:oh-native-people" };
    } } }, async () => {
      const held = await readerOfficeholders(districts);
      assert.deepEqual(held.seats.map(seat => seat.id).sort(), people.map(person => person.id).sort());
      for (const [question, name] of [["Who is my state representative?", "Dontavius L. Jarrells"], ["Who is my state senator?", "Hearcel F. Craig"]]) {
        const answer = composeReaderOfficials({ ask: readerOfficialsQuestion(question)!, held: held.held, holdingFailed: held.loaderFailures > 0 });
        assert.ok(answer?.answer.includes(name), answer?.answer);
      }
    });
    assert.ok(stateReads.length > 0);
  } finally {
    installFactReader(undefined);
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});

test("a place's federal roster/directory promotes once and failed acquisition preserves its exact GOOD pointer", async () => {
  const store = new MemoryRoutineDataStore();
  const national = await federalSeed(), state = national.roster.officeholders[0]!.state!, scope = federalDirectoryScope(state);
  const projection = federalDirectoryForState(national, state), contract = `congress-bulk-roster:${state}` as "congress-bulk-roster:AZ";
  const good = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions: federalAcquisitions(projection.sourceSha, "good"), retrievedAt: T0, projection });
  const promoted = await processRegisteredManualCandidate(store, contract, good, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.deepEqual((await store.events(good.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  const read = await readStateFederalDirectory(state, { store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, good.id);

  const alteredProjection = structuredClone(projection);
  alteredProjection.roster.officeholders[0]!.name = `${alteredProjection.roster.officeholders[0]!.name} Altered`;
  const altered = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions: federalAcquisitions(projection.sourceSha, "good"), retrievedAt: T0, projection: alteredProjection });
  assert.notEqual(altered.id, good.id, "the federal candidate identity binds the exact normalized projection");
  const elsewhere = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions: federalAcquisitions(projection.sourceSha, "good"), retrievedAt: T0, projection: national });
  assert.ok(national.roster.officeholders.some((holder) => holder.state !== state) ? elsewhere.semantics.violations.includes("OFFICEHOLDER_OUTSIDE_PLACE") : true);

  const oneFile = federalAcquisitions(projection.sourceSha, "duplicate")[0]!;
  const incomplete = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions: Array.from({ length: 5 }, () => oneFile), retrievedAt: T1, projection });
  const incompleteOutcome = await processRegisteredManualCandidate(store, contract, incomplete, T1);
  assert.equal(incompleteOutcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_DIRECTORY", scope))?.versionId, good.id);

  const failed = failedFederalDirectoryCandidate(state, T1, "directory source unavailable");
  const refused = await processRegisteredManualCandidate(store, contract, failed, T1);
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_DIRECTORY", scope))?.versionId, good.id);
});

test("federal civic member ordering is independent of source-map insertion order", async () => {
  const national = await federalSeed(), state = national.roster.officeholders[0]!.state!, projection = federalDirectoryForState(national, state);
  const reordered = structuredClone(projection);
  reordered.directory.byMember = Object.fromEntries(
    Object.entries(reordered.directory.byMember).reverse(),
  );
  reordered.directory.committees = Object.fromEntries(
    Object.entries(reordered.directory.committees).reverse(),
  );
  const acquisitions = federalAcquisitions(projection.sourceSha, "stable-order");
  const original = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions, retrievedAt: T0, projection });
  const roundTripped = await federalDirectoryCandidate({
    state,
    vault: new MemoryEvidenceStore(),
    acquisitions,
    retrievedAt: T0,
    projection: reordered,
  });
  assert.equal(roundTripped.normalization.normalizedHash, original.normalization.normalizedHash);
  assert.deepEqual(roundTripped.civicRecords, original.civicRecords);
  const keys = original.civicRecords?.map(({ key }) => key) ?? [];
  assert.deepEqual(keys, [...keys].sort((left, right) => left.localeCompare(right)));
});

test("registry civic member ordering is independent of JSONB object-key order", async () => {
  const sourcePackage = await registryPackage(T0, "stable-registry-order");
  const candidate = registryRuntimeCandidate(sourcePackage);
  const original = candidate.readModel as RegistryRuntimeReadModel;
  const roundTripped: RegistryRuntimeReadModel = {
    ...structuredClone(original),
    rosterPhotos: Object.fromEntries(Object.entries(original.rosterPhotos).reverse()),
  };
  const originalRecords = civicRecordsFor("REGISTRY_RUNTIME_BINDING", original);
  const roundTrippedRecords = civicRecordsFor("REGISTRY_RUNTIME_BINDING", roundTripped);
  assert.deepEqual(roundTrippedRecords, originalRecords);
  const keys = originalRecords.map(({ key }) => key);
  assert.deepEqual(keys, [...keys].sort((left, right) => left.localeCompare(right)));
});

test("two registry publications in one pass never reuse a clock before the scope's latest event", async () => {
  for (const changed of [false, true]) {
    const store = new MemoryRoutineDataStore();
    const firstPackage = await registryPackage(T0, "same-pass-first");
    const first = await processRegisteredManualCandidate(store, "registry-runtime:AZ", registryRuntimeCandidate(firstPackage), T0);
    assert.equal(first.candidate.state, "PROMOTED");
    const contract = requiredManualProductionContract("registry-runtime:AZ");
    await recordRoutineReaderProjectionReadback(store, contract, first.promoted!, T1);
    const beforeEvents = await store.events(first.promoted!.versionId);
    const secondPackage = await registryPackage(T0, "same-pass-second");
    const payload = changed ? { ...secondPackage.payload, registry: { ...secondPackage.payload.registry,
      bodies: secondPackage.payload.registry.bodies.map((body, index) => index ? body : { ...body, homepageUrl: "https://changed.example.gov/" }) } } : secondPackage.payload;
    const second = await processRegisteredManualCandidate(store, "registry-runtime:AZ", registryRuntimeCandidate({ ...secondPackage, payload }), T0);
    assert.equal(second.candidate.state, "PROMOTED", second.candidate.failureDetail ?? undefined);
    assert.equal(Boolean(second.confirmed), !changed);
    if (changed) {
      const readback = second.readerReadback!;
      assert.equal(readback.status, "PASS");
      assert.ok(Date.parse(readback.observedAt) >= Date.parse(T1));
      assert.ok(Date.parse(second.candidate.receipt!.validatedAt) >= Date.parse(T1));
    } else {
      assert.equal(second.promoted!.versionId, first.promoted!.versionId);
      assert.deepEqual(await store.events(first.promoted!.versionId), beforeEvents, "an unchanged state writes no confirmation or new readback");
      const nextPrior = await acceptedRegistryPrior({ async readPromotion() { throw new Error("must reuse the accepted state graph"); },
        async readCandidate() { throw new Error("must not load another copy"); } }, second);
      assert.equal(nextPrior.payload, second.confirmed!.recheck.readModel);
      assert.equal(nextPrior.versionId, first.promoted!.versionId);
    }
    const events = await store.events(second.promoted!.versionId);
    assert.ok(events.every((event, index) => index === 0 || Date.parse(event.at) >= Date.parse(events[index - 1]!.at)));
  }
});

test("registry relational bindings remain coherent while exact member deltas promote and bad successors leave LKG live", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "first");
  const first = registryRuntimeCandidate(firstPackage);
  const promoted = await processRegisteredManualCandidate(store, "registry-runtime:AZ", first, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.ok(firstPackage.payload.statewideExecutives.length > 0);
  assert.ok(firstPackage.payload.officialCandidacies.rows.some((row) => row.status === "RESOLVED"));
  assert.ok(firstPackage.payload.officialCandidacies.rows.every((row) => !("sourcePath" in row.holder) && !(row.candidacy && "sourcePath" in row.candidacy)));
  const firstRead = await readRegistryRuntimeProjection(["AZ"], { store, bypassCache: true, now: T0 });
  assert.equal(firstRead.kind, "PROMOTED");
  assert.equal(firstRead.metadata.versionId, first.id);

  const changedBase = await registryPackage(T1, "changed");
  const changedBody = changedBase.payload.registry.bodies[0];
  const changedBridgeRow = changedBase.payload.officialCandidacies.rows.find((row) => row.status === "NO_APPLICABLE_CANDIDACY");
  assert.ok(changedBody);
  assert.ok(changedBridgeRow);
  const changedPayload: RegistryRuntimeCarton = {
    ...changedBase.payload,
    registry: { ...changedBase.payload.registry, bodies: [{ ...changedBody, homepageUrl: "https://changed.example.gov/" }, ...changedBase.payload.registry.bodies.slice(1)] },
    officialCandidacies: {
      ...changedBase.payload.officialCandidacies,
      rows: changedBase.payload.officialCandidacies.rows.map((row) => row.holder.id === changedBridgeRow.holder.id
        ? { ...row, reason: `${row.reason} Reviewed in the successor package.` }
        : row),
    },
  };
  const changedPackage: RegistryRuntimePackage = { ...changedBase, payload: changedPayload, sourceReceipt: receipt(changedPayload, T1, "changed") };
  const changed = registryRuntimeCandidate(changedPackage);
  const changedOutcome = await processRegisteredManualCandidate(store, "registry-runtime:AZ", changed, T1);
  assert.equal(changedOutcome.candidate.state, "PROMOTED");
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `body:${changedBody.id}`));
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `official-candidacy:${changedBridgeRow.holder.id}`));
  const changedRead = await readRegistryRuntimeProjection(["AZ"], { store, bypassCache: true, now: T1 });
  assert.equal(changedRead.kind, "PROMOTED");
  assert.equal(changedRead.value.registry.bodies.find((body) => body.id === changedBody.id)?.homepageUrl, "https://changed.example.gov/");
  assert.match(changedRead.value.officialCandidacies.rows.find((row) => row.holder.id === changedBridgeRow.holder.id)?.reason ?? "", /successor package/);

  const badPackage: RegistryRuntimePackage = {
    ...structuredClone(changedPackage),
    version: `${T1}-bad`,
    sourceReceipt: { ...changedPackage.sourceReceipt, reviewedAt: "2026-09-08T12:02:00.000Z" },
    payload: {
      ...changedPackage.payload,
      officialCandidacies: {
        ...changedPackage.payload.officialCandidacies,
        rows: changedPackage.payload.officialCandidacies.rows.map((row) => row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE"
          ? { ...row, holder: { ...row.holder, name: `${row.holder.name} Wrong` } }
          : row),
      },
    },
  };
  const bad = registryRuntimeCandidate(badPackage);
  assert.notEqual(bad.id, changed.id, "the candidate identity binds the exact normalized projection, not only its receipt URLs");
  const held = await processRegisteredManualCandidate(store, "registry-runtime:AZ", bad, "2026-09-08T12:02:00.000Z");
  assert.equal(held.candidate.state, "SEMANTIC_INVALID");
  assert.match(held.candidate.failureDetail ?? "", /OFFICIAL_CANDIDACY_HOLDER_FACT_MISMATCH/);
  assert.equal(held.promoted, null);
  assert.equal((await store.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("AZ")))?.versionId, changed.id);
});

test("one blocked registry publisher holds only its dependent members while an unrelated body update promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "isolation-first");
  const first = registryRuntimeCandidate(firstPackage);
  await processRegisteredManualCandidate(store, "registry-runtime:AZ", first, T0, null);

  const nextPackage = await registryPackage(T1, "isolation-next");
  const sourced = nextPackage.payload.registry.bodies.filter((body) => body.provenance.sourceUrl);
  const [supportedBody, blockedBody] = sourced.filter((body, index) =>
    sourced.findIndex((candidate) => candidate.provenance.sourceUrl === body.provenance.sourceUrl) === index &&
    nextPackage.payload.registry.divisions.every((division) => division.provenance?.sourceUrl !== body.provenance.sourceUrl)
  ).slice(0, 2);
  assert.ok(supportedBody && blockedBody && supportedBody.provenance.sourceUrl !== blockedBody.provenance.sourceUrl);
  const changedPayload = structuredClone(nextPackage.payload);
  const changedSupported = changedPayload.registry.bodies.find((body) => body.id === supportedBody.id)!;
  changedSupported.homepageUrl = "https://supported.example.gov/";
  const currentReceipt = receipt(changedPayload, T1, "isolation-next");
  const partialReceipt: ManualSourceSetReceipt = {
    ...currentReceipt,
    sources: currentReceipt.sources.map((source) => source.finalUrl === blockedBody.provenance.sourceUrl
      ? {
          ...source,
          httpStatus: 503,
          rawHash: hash(`blocked:${source.finalUrl}`),
          reviewOutcome: "BLOCKED" as const,
          failureDetail: "The unrelated registry publisher was unavailable.",
        }
      : source),
  };
  const prior = await readRegistryRuntimePrior(store, T1, "AZ");
  assert.equal(prior?.versionId, first.id);
  assert.equal(prior?.readModelSha256, first.normalization.normalizedHash);
  assert.deepEqual(prior?.sourceReceipt, first.retrieval.manualSourceReceipt);
  const next = registryRuntimeCandidate({
    ...nextPackage,
    payload: changedPayload,
    sourceReceipt: partialReceipt,
  }, { prior });

  assert.equal(next.manualPriorAuthority, undefined);
  const outcome = await processRegisteredManualCandidate(
    store,
    "registry-runtime:AZ",
    next,
    T1,
    first.id,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, []);
  assert.ok(outcome.candidate.candidate.changeSet?.changed.some((record) =>
    record.key === `body:${supportedBody.id}`
  ));
  assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `body:${blockedBody.id}` && fact.code === "MANUAL_MEMBER_HELD_LKG"
  ));
  const promoted = outcome.promoted!.payload as RegistryRuntimeCarton;
  assert.equal(promoted.registry.bodies.find((body) => body.id === supportedBody.id)?.homepageUrl, "https://supported.example.gov/");
  assert.deepEqual(
    promoted.registry.bodies.find((body) => body.id === blockedBody.id),
    firstPackage.payload.registry.bodies.find((body) => body.id === blockedBody.id),
  );
});

function frozenPlaceholders(state?: string) {
  const frozen = JSON.parse(readFileSync("lib/registry/registry.json", "utf8")) as Registry;
  const divisions = frozen.divisions.filter((division) => (!state || division.state === state) && isCensusPlaceholderDivision(division));
  const ids = new Set(divisions.map((division) => division.ocdId));
  return { divisions, ids, bodies: frozen.bodies.filter((body) => body.ocdId !== null && ids.has(body.ocdId)) };
}

test("a Census placeholder division is geography: no body is derived on it and no projection may carry one", () => {
  const placeholders = frozenPlaceholders();
  assert.deepEqual(placeholders.divisions.map((division) => division.geoid).sort(), ["0499997", "3399997"]);
  assert.equal(placeholders.bodies.length, 2);
  for (const division of placeholders.divisions) {
    assert.deepEqual(slotsFor(division), { slots: [], skipped: "census-placeholder-not-a-government" });
  }

  const seed = servedRegistry();
  const real = seed.registry.divisions.find((division) => division.divisionType === "school_district" && !isCensusPlaceholderDivision(division));
  assert.ok(real);
  assert.deepEqual(slotsFor(real), { slots: [{ bodyClass: "GOVERNING", slot: "board" }], skipped: null });
  assert.equal(isCensusPlaceholderDivision({ ...real, geoid: "0499997" }), true);
  assert.equal(isCensusPlaceholderDivision({ ocdId: placeholders.divisions[0]!.ocdId }), true);
  assert.equal(isCensusPlaceholderDivision({ ...placeholders.divisions[0]!, divisionType: "place" }), false);

  assert.equal(seed.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).length, 2);

  const frozen = JSON.parse(readFileSync("lib/registry/registry.json", "utf8")) as Registry;
  const counted = withoutPlaceholderBodies(frozen);
  assert.equal(counted.divisions.length, frozen.divisions.length);
  const kept = new Set(counted.bodies.map((body) => body.id));
  assert.deepEqual(frozen.bodies.filter((body) => !kept.has(body.id)).map((body) => body.id).sort(), placeholders.bodies.map((body) => body.id).sort());
  assert.equal(registryRuntimeProjectionIssues(seed).some((issue) => issue.startsWith(CENSUS_PLACEHOLDER_BODY_ISSUE)), false);
  const carrying: RegistryRuntimeCarton = { ...seed, registry: { ...seed.registry, bodies: [...seed.registry.bodies, ...placeholders.bodies] } };
  assert.deepEqual(
    registryRuntimeProjectionIssues(carrying).filter((issue) => issue.startsWith(CENSUS_PLACEHOLDER_BODY_ISSUE)),
    [`${CENSUS_PLACEHOLDER_BODY_ISSUE}:${placeholders.bodies.map((body) => body.id).sort().join(",")}`],
  );
});

test("a promotion drops placeholder bodies whichever side holds them, names why, and translates the placeholder's name", async () => {
  const placeholders = frozenPlaceholders("AZ");

  const base = await registryPackage(T0, "placeholder-prior");
  const priorPayload = structuredClone(base.payload);
  priorPayload.registry.bodies = [...priorPayload.registry.bodies, ...placeholders.bodies].sort((left, right) => left.id.localeCompare(right.id));
  priorPayload.registry.divisions = priorPayload.registry.divisions.map((division) =>
    division.state === "AZ" && placeholders.ids.has(division.ocdId) ? { ...division, label: "School District Not Defined" } : division);
  const prior = {
    versionId: "placeholder-prior",
    payload: priorPayload,
    sourceReceipt: receipt(priorPayload, T0, "placeholder-prior"),
    readModelSha256: hash(canonicalCivicDataJson(priorPayload)),
  };
  const plainNames = (model: RegistryRuntimeReadModel) =>
    model.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).map((division) => division.label);
  const removals = (candidate: ReturnType<typeof registryRuntimeCandidate>) =>
    (candidate.excludedFacts ?? []).filter((fact) => fact.code === "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT").map((fact) => fact.key ?? "").sort();
  const expectedRemovals = placeholders.bodies.map((body) => `body:${body.id}`).sort();

  const next = await registryPackage(T1, "placeholder-next");
  const fromPrior = registryRuntimeCandidate(next, { prior });
  const fromPriorModel = fromPrior.readModel as RegistryRuntimeReadModel;
  assert.deepEqual(fromPrior.semantics.violations, []);
  assert.equal(fromPriorModel.registry.bodies.length, base.payload.registry.bodies.length);
  assert.deepEqual(plainNames(fromPriorModel), ["No unified school district here"]);
  assert.deepEqual(removals(fromPrior), expectedRemovals);
  assert.equal((fromPrior.excludedFacts ?? []).some((fact) => fact.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING" && expectedRemovals.includes(fact.key ?? "")), false);

  assert.deepEqual(fromPrior.removalEvidence, placeholders.bodies.map((body) => ({ key: `body:${body.id}`, code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT", divisionOcdId: body.ocdId })).sort((left, right) => left.key.localeCompare(right.key)));

  const carryingPayload = structuredClone(priorPayload);
  const carrying: RegistryRuntimePackage = { ...next, payload: carryingPayload, sourceReceipt: receipt(carryingPayload, T1, "placeholder-carrying") };
  const fromPackage = registryRuntimeCandidate(carrying);
  const fromPackageModel = fromPackage.readModel as RegistryRuntimeReadModel;
  assert.deepEqual(fromPackage.semantics.violations, []);
  assert.equal(fromPackageModel.registry.bodies.some((body) => body.ocdId !== null && placeholders.ids.has(body.ocdId)), false);
  assert.deepEqual(plainNames(fromPackageModel), ["No unified school district here"]);
  assert.deepEqual(removals(fromPackage), expectedRemovals);
  assert.equal(fromPackage.removalEvidence, undefined, "no pointer held them, so nothing is removed from one");
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "registry-runtime:AZ", fromPackage, T1);
  assert.equal(outcome.candidate.state, "PROMOTED");
});

async function transferImportedRegistry(store: MemoryRoutineDataStore, at: string) {
  stateRegistryRuntimeStore("AZ", store);
  const projection = (await store.readPromotion<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("AZ")))!;
  const record = (await store.readCandidate(projection.versionId))!;
  assert.equal(projection.promotedAt, at);
  assert.equal(promotionProofIssue(record.candidate.recordClass, record.candidate.scope, projection, record), null);
  const imported = record.candidate, base = projection.payload;
  return { imported, base, placeholders: frozenPlaceholders("AZ"), record, projection };
}

function placeholderCorrection(base: RegistryRuntimeReadModel, placeholderIds: ReadonlySet<string>, at: string): RegistryRuntimePackage {
  const divisions = base.registry.divisions
    .filter((division) => placeholderIds.has(division.ocdId))
    .map((division) => ({ ...division, label: "No unified school district here" }));
  const payload: RegistryRuntimeReadModel = {
    ...base,
    registry: { generatedAt: base.registry.generatedAt, divisions, bodies: [] },
    bodyRosters: [],
    rosterReaderDispositions: [],
    statewideExecutives: [],
    officialCandidacies: { ...base.officialCandidacies, rows: [] },
    officialPhotos: { photos: [] },
    rosterPhotos: {},
  };
  const census = divisions[0]!.provenance!.sourceUrl!;
  return {
    contractId: "registry-runtime:AZ",
    version: at,
    sourceThrough: at,
    payload,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: at,
      reviewedBy: "owner-test",
      sources: [{
        requestedUrl: census,
        finalUrl: census,
        publisher: "U.S. Census Bureau",
        sourceClass: "OFFICIAL_PUBLISHER",
        retrievedAt: at,
        httpStatus: 200,
        rawHash: hash(`census:${at}`),
        reviewedEvidence: "TIGER unified school districts: LEA 99997, School District Not Defined, is land inside no unified district.",
      }],
    },
  };
}

test("the owner door builds on the transfer-time import: untouched members keep its authority, the placeholder boards leave, and the plane re-proves both", async () => {
  class BoundStore extends MemoryRoutineDataStore {
    #reads = { promotion: 0, proof: 0, candidate: 0, metadata: 0 };
    get reads() { return { ...this.#reads }; }
    resetReads() { this.#reads = { promotion: 0, proof: 0, candidate: 0, metadata: 0 }; }
    override async readPromotion<T>(recordClass: RoutineRecordClass, scope: string) {
      this.#reads.promotion++;
      return super.readPromotion<T>(recordClass, scope);
    }
    override async readPublishedCandidateMetadata(candidateId: string) {
      this.#reads.metadata++;
      return super.readPublishedCandidateMetadata(candidateId);
    }
    override async readCandidateProof(candidateId: string) {
      this.#reads.proof++;
      return super.readCandidateProof(candidateId);
    }
    override async readCandidate(candidateId: string) {
      this.#reads.candidate++;
      return super.readCandidate(candidateId);
    }
  }
  const store = new BoundStore();
  const { imported, base, placeholders } = await transferImportedRegistry(store, T0);
  store.resetReads();
  const prior = await readRegistryRuntimePrior(store, T1, "AZ");
  assert.ok(prior);
  assert.equal(prior.versionId, imported.id);
  assert.deepEqual(store.reads, { promotion: 1, proof: 0, candidate: 0, metadata: 1 }, "only the current proof row is read, using the original private-field store");
  assert.equal(prior.readModelSha256, imported.normalization.normalizedHash);
  assert.equal(prior.sourceReceipt, undefined, "a trusted import cannot invent a reviewed source receipt");
  store.resetReads();
  const fallback = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: store.readCandidate.bind(store),
  };
  await assert.rejects(readRegistryRuntimePrior(fallback, T1, "AZ"), /REGISTRY_RUNTIME_BASE_UNAVAILABLE/);
  assert.deepEqual(store.reads, { promotion: 1, proof: 0, candidate: 0, metadata: 0 }, "a missing metadata door cannot cause a second state payload read");

  const next = registryRuntimeCandidate(placeholderCorrection(base, placeholders.ids, T1), { prior });
  assert.deepEqual(next.semantics.violations, []);
  const phantomKeys = placeholders.bodies.map((body) => `body:${body.id}`).sort();
  const rosterKeys = civicRecordsFor("REGISTRY_RUNTIME_BINDING", prior.payload).map((member) => member.key).filter((key) => /^(body-roster|roster-disposition):/.test(key));
  assert.ok(rosterKeys.length > 0, "the imported rosters remain in the state partition");
  const removedKeys = phantomKeys;
  assert.deepEqual((next.removalEvidence ?? []).map((row) => row.key), removedKeys);
  const inherited = new Set(next.manualPriorAuthority?.retainedMembers.map((member) => member.key));
  assert.ok(inherited.size > 100, `every untouched cited member carries the import's authority (${inherited.size})`);
  assert.equal([...placeholders.ids].some((id) => inherited.has(`division:${id}`)), false, "the reviewed divisions stand on the review");

  const outcome = await processRegisteredManualCandidate(store, "registry-runtime:AZ", next, T1, imported.id);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt?.checks.filter((check) => check.verdict !== "PASS")));
  assert.equal(outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code, "CURRENT_SOURCES_AND_EXACT_PRIOR_AUTHORITY_VALID");
  const changes = outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changes.removed.map((delta) => delta.key).sort((left, right) => left.localeCompare(right)), removedKeys);
  assert.deepEqual(changes.changed.map((delta) => delta.key), []);
  assert.deepEqual(changes.added, []);
  const served = outcome.promoted!.payload as RegistryRuntimeReadModel;
  assert.equal(served.registry.bodies.length, base.registry.bodies.length - 1);
  assert.deepEqual(served.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).map((division) => division.label), ["No unified school district here"]);

  const secondPrior = await readRegistryRuntimePrior(store, T1, "AZ");
  assert.equal(secondPrior?.versionId, next.id);
  const later = "2026-09-08T12:02:00.000Z";
  const second = registryRuntimeCandidate(placeholderCorrection(served, placeholders.ids, later), { prior: secondPrior });
  assert.equal(second.manualPriorAuthority?.versionId, next.id);
  const lkg = await store.readCandidate(next.id);
  const secondChecks = validateRoutineCandidate({ ...second, changeSet: candidateChangeSet(second, served) }, lkg, later).receipt.checks;
  assert.deepEqual(secondChecks.filter((check) => check.verdict !== "PASS"), []);
});

test("the door accepts exactly the transfer import as a base without a receipt; any other receipt-less base is still refused", async () => {
  const { record, projection } = await transferImportedRegistry(new MemoryRoutineDataStore(), T0);
  const moved = structuredClone(projection.payload) as RegistryRuntimeReadModel;
  moved.registry.bodies = moved.registry.bodies.slice(1);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, { ...projection, payload: moved }]]) });
  await assert.rejects(readRegistryRuntimePrior(store, T1, "AZ"), /REGISTRY_RUNTIME_BASE_(?:PROOF_INVALID|UNAVAILABLE):/);
});

test("the plane refuses what the registry door does not prove: a changed carried member, an unexplained removal, a real board passed off as a placeholder", async () => {
  const store = new MemoryRoutineDataStore();
  const { imported, base, placeholders } = await transferImportedRegistry(store, T0);
  const prior = await readRegistryRuntimePrior(store, T1, "AZ");
  const next = registryRuntimeCandidate(placeholderCorrection(base, placeholders.ids, T1), { prior });
  const lkg = await store.readCandidate(imported.id);
  const codes = (candidate: RoutineCandidate) =>
    validateRoutineCandidate({ ...candidate, changeSet: candidateChangeSet(candidate, base) }, lkg, T1).receipt.checks
      .filter((check) => check.verdict !== "PASS").map((check) => check.code);
  assert.deepEqual(codes(next), []);

  const changed = structuredClone(next) as RoutineCandidate & { readModel: RegistryRuntimeReadModel };
  const carriedBody = changed.readModel.registry.bodies.find((body) => next.manualPriorAuthority!.retainedMembers.some((member) => member.key === `body:${body.id}`))!;
  carriedBody.name = `${carriedBody.name ?? "A body"} (unreviewed)`;
  assert.ok(codes(changed).includes("MANUAL_PRIOR_AUTHORITY_INVALID"), JSON.stringify(codes(changed)));

  const unexplained = { ...next, removalEvidence: undefined };
  assert.deepEqual(codes(unexplained), ["INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED"]);

  const realBoard = base.registry.bodies.find((body) => body.id.endsWith("#board") && body.ocdId !== null && !placeholders.ids.has(body.ocdId))!;
  const disguised = structuredClone(next) as RoutineCandidate & { readModel: RegistryRuntimeReadModel };
  disguised.readModel.registry.bodies = disguised.readModel.registry.bodies.filter((body) => body.id !== realBoard.id);
  const disguisedCandidate: RoutineCandidate = {
    ...disguised,
    removalEvidence: [...(next.removalEvidence ?? []), { key: `body:${realBoard.id}`, code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" as const, divisionOcdId: realBoard.ocdId! }]
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
  assert.ok(codes(disguisedCandidate).includes("REMOVAL_EVIDENCE_MISMATCH"));
});

test("the recorded state remains readable until its correction promotes", async () => {
  const store = stateRegistryRuntimeStore("AZ");
  const prior = (await readRegistryRuntimePrior(store, T0, "AZ"))!;
  assert.equal(prior.payload.registry.bodies.filter(body => body.ocdId !== null && frozenPlaceholders("AZ").ids.has(body.ocdId)).length, 1);
  await withReaderAuthorityEdge({}, async () => {
    const read = await readRegistryRuntimeProjection(["AZ"], { store, bypassCache: true, now: T0 });
    assert.equal(read.kind, "PROMOTED");
    assert.equal(getRegistryRuntimeReadModel().registry.bodies.length, prior.payload.registry.bodies.length);
  });
});

test("both Reader projections reject cross-source proof and never bootstrap on store failure", async () => {
  const national = await federalSeed(), state = national.roster.officeholders[0]!.state!;
  const candidate = await federalDirectoryCandidate({ state, vault: new MemoryEvidenceStore(), acquisitions: federalAcquisitions(national.sourceSha, "proof"), retrievedAt: T0, projection: federalDirectoryForState(national, state) });
  const mismatched = { ...candidate, id: `${candidate.id}-bad-proof`, sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_DIRECTORY_SOURCE_ID, "FEDERAL_DIRECTORY", "US:wrong-scope") };
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), `congress-bulk-roster:${state}` as "congress-bulk-roster:AZ", mismatched, T0);
  assert.equal(outcome.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(outcome.promoted, null);

  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const reads = await Promise.all([
    readStateFederalDirectory(state, { store: brokenStore, bypassCache: true }),
    readRegistryRuntimeProjection(["AZ"], { store: brokenStore, bypassCache: true }),
  ]);
  assert.deepEqual(reads.map((read) => read.kind), ["STORE_UNREACHABLE", "STORE_UNREACHABLE"]);
  assert.equal(candidateReads, 0);
});

test("manual contracts have no clock and retired tracked writers cannot be invoked", () => {
  const ids = new Set(["congress-bulk-roster:AZ", "registry-runtime:AZ"]);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.equal(contracts.length, 2);
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY" && !("cadence" in contract)));
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, T0, contracts);
  assert.ok(view.contracts.every((row) => row.cadence.clock === "MANUAL" && row.cadence.nextDue.kind === "NOT_APPLICABLE"));

  for (const path of ["scripts/build-officeholders.ts", "scripts/enrich-federal-officeholders.mts", "scripts/fetch-official-photos.mts", "scripts/migrate-congress-directory.mts"]) {
    assert.equal(existsSync(path), false, path);
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["registry:build"], undefined);
  assert.equal(pkg.scripts["officials:build"], undefined);
  assert.equal(pkg.scripts["officials:enrich"], undefined);
  assert.equal(pkg.scripts["officials:photos"], undefined);
});

test("a registry publication cannot use a different state's records or prior", async () => {
  const az = await registryPackage(T0, "az-only"), nh = await registryPackage(T0, "nh-only", "NH");
  assert.throws(() => registryRuntimeCandidate({ ...az, payload: nh.payload }), /REGISTRY_STATE_SCOPE_MISMATCH:AZ/);
  const store = stateRegistryRuntimeStore("NH");
  const foreignPrior = (await readRegistryRuntimePrior(store, T0, "NH"))!;
  assert.throws(() => registryRuntimeCandidate(az, { prior: foreignPrior }), /REGISTRY_STATE_SCOPE_MISMATCH:AZ/);
  const seen: string[] = [];
  const exact = { readPromotion: async <T>(recordClass: RoutineRecordClass, scope: string) => {
    seen.push(scope);
    assert.equal(scope, stateRegistryRuntimeScope("AZ"));
    return store.readPromotion<T>(recordClass, scope);
  }, readCandidate: store.readCandidate.bind(store), readPublishedCandidateMetadata: store.readPublishedCandidateMetadata.bind(store) };
  assert.equal(await readRegistryRuntimePrior(exact, T0, "AZ"), null);
  assert.deepEqual(seen, [stateRegistryRuntimeScope("AZ")]);
  const nhBefore = await store.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("NH"));
  const published = await processRegisteredManualCandidate(store, az.contractId, registryRuntimeCandidate(az), T0);
  assert.equal(published.candidate.state, "PROMOTED");
  assert.deepEqual(await store.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("NH")), nhBefore);
});

test("a receiptless ordinary state version cannot become inherited registry authority", async () => {
  const store = stateRegistryRuntimeStore("AZ");
  const projection = (await store.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("AZ")))!;
  const record = (await store.readCandidate(projection.versionId))!;
  const receipt = { ...record.receipt!, checks: record.receipt!.checks.map(check => check.check === "SOURCE_AUTHENTICITY"
    ? { ...check, code: "SOURCE_AUTHENTICITY_PASS" } : check) };
  Object.assign(store, { candidates: new Map([[record.candidate.id, { ...record, receipt }]]),
    promotions: new Map([[projection.key, { ...projection, receipt }]]) });
  await assert.rejects(readRegistryRuntimePrior(store, T0, "AZ"), /REGISTRY_RUNTIME_BASE_PROOF_INVALID:MANUAL_SOURCE_RECEIPT_INVALID/);
});

test("a sparse state registry successor preserves every held roster, member, disposition, contact and photo", async () => {
  const store = stateRegistryRuntimeStore("AZ"), prior = (await readRegistryRuntimePrior(store, T1, "AZ"))!;
  const before = prior.payload as RegistryRuntimeReadModel;
  assert.ok(before.bodyRosters.length > 0 && before.rosterReaderDispositions.length > 0);
  const body = before.registry.bodies.find(row => {
    const division = before.registry.divisions.find(division => division.ocdId === row.ocdId);
    return row.provenance.sourceUrl?.startsWith("https://") && division && !isCensusPlaceholderDivision(division);
  })!;
  const payload: RegistryRuntimeReadModel = { ...before, registry: { generatedAt: T1, divisions: [], bodies: [{ ...body, name: `${body.name} — official correction` }] },
    bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...before.officialCandidacies, rows: [] },
    officialPhotos: { photos: [] }, rosterPhotos: {} };
  const pkg: RegistryRuntimePackage = { contractId: "registry-runtime:AZ", version: T1, sourceThrough: T1,
    scope: "MEMBERS", payload, sourceReceipt: receipt(payload, T1, "one-body-correction") };
  const preserved = civicRecordsFor("REGISTRY_RUNTIME_BINDING", before).filter(member => /^(body-roster|roster-disposition|official-photo|roster-photo):/.test(member.key));
  const hashes = new Map(preserved.map(member => [member.key, hash(canonicalCivicDataJson(member.record))]));
  const built = registryRuntimeCandidate(pkg, { prior }), after = built.readModel as RegistryRuntimeReadModel;
  for (const member of civicRecordsFor("REGISTRY_RUNTIME_BINDING", after).filter(member => hashes.has(member.key))) {
    assert.equal(hash(canonicalCivicDataJson(member.record)), hashes.get(member.key), member.key);
    assert.equal(member.record, preserved.find(row => row.key === member.key)!.record, "unchanged rows keep the same owned objects");
  }
  assert.equal(after.bodyRosters.length, before.bodyRosters.length);
  assert.equal(after.bodyRosters.reduce((count, roster) => count + roster.members.length, 0), before.bodyRosters.reduce((count, roster) => count + roster.members.length, 0));
  assert.equal(after.rosterReaderDispositions.length, before.rosterReaderDispositions.length);
  assert.equal(after.officialPhotos.photos.length, before.officialPhotos.photos.length);
  assert.deepEqual(after.rosterPhotos, before.rosterPhotos);
  assert.ok(!built.removalEvidence?.some(row => row.code === "MOVED_TO_FACT_STORE"));
  const published = await processRegisteredManualCandidate(store, "registry-runtime:AZ", built, T1, prior.versionId);
  assert.equal(published.candidate.state, "PROMOTED", published.candidate.failureDetail ?? "");
  assert.ok(!published.candidate.candidate.changeSet?.removed.some(row => hashes.has(row.key)));
  const read = (await readRegistryRuntimePrior(store, "2026-09-08T12:02:00.000Z", "AZ"))!;
  const restored = civicRecordsFor("REGISTRY_RUNTIME_BINDING", read.payload);
  for (const [key, digest] of hashes) assert.equal(hash(canonicalCivicDataJson(restored.find(member => member.key === key)!.record)), digest, key);
});

test("reviewed registry files preserve source isolation, duplicate refusal and property-order independence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "registry-stream-test-")), file = join(directory, "reviewed.json");
  try {
    for (const variant of ["supported", "duplicated", "blocked"] as const) {
      const source = await registryPackage(T1, `stream-${variant}`), body = source.payload.registry.bodies[0]!;
      const changed = { ...body, name: `${body.name} reviewed correction` };
      const input: RegistryRuntimePackage = { ...source, payload: { ...source.payload, registry: { ...source.payload.registry,
        bodies: [changed, ...source.payload.registry.bodies.slice(1), ...(variant === "duplicated" ? [body] : [])] } },
        sourceReceipt: variant === "blocked" ? { ...source.sourceReceipt, sources: source.sourceReceipt.sources.map(row =>
          row.finalUrl === body.provenance.sourceUrl ? { ...row, reviewOutcome: "BLOCKED", failureDetail: "The source refused retrieval." } : row) } : source.sourceReceipt };
      const expectedStore = stateRegistryRuntimeStore("AZ"), actualStore = stateRegistryRuntimeStore("AZ");
      const expected = registryRuntimeCandidate(input, { prior: await readRegistryRuntimePrior(expectedStore, T1, "AZ") });
      const reordered = { payload: Object.fromEntries(Object.entries(input.payload).reverse()),
        ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "payload").reverse()) };
      writeFileSync(file, JSON.stringify(reordered));
      const actual = await registryRuntimeCandidateFromFile(file, actualStore, "AZ");
      assert.deepEqual(actual.candidate, expected, variant);
      assert.equal(actual.reviewedAt, T1);
      const outcome = await processRegisteredManualCandidate(actualStore, "registry-runtime:AZ", actual.candidate, T1, actual.priorVersionId);
      assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? variant);
      if (variant === "duplicated") assert.ok(actual.candidate.excludedFacts?.some(row => row.code === "MANUAL_MEMBER_KEY_INVALID_OR_DUPLICATED"));
      if (variant === "blocked") assert.ok(actual.candidate.excludedFacts?.some(row => row.code === "MANUAL_MEMBER_SOURCE_BLOCKED"));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a full reviewed registry stream releases unchanged prior rows and preserves exact changed audit values", async () => {
  const store = stateRegistryRuntimeStore("AZ"), prior = (await readRegistryRuntimePrior(store, T1, "AZ"))!;
  const oldBody = prior.payload.registry.bodies.find(row => row.provenance.sourceUrl?.startsWith("https://") &&
    prior.payload.registry.divisions.some(division => division.ocdId === row.ocdId && !isCensusPlaceholderDivision(division)))!;
  const current = structuredClone(prior.payload), changed = { ...oldBody, name: `${oldBody.name} reviewed replacement` };
  current.registry.bodies = current.registry.bodies.map(row => row.id === oldBody.id ? changed : row);
  const input: RegistryRuntimePackage = { contractId: "registry-runtime:AZ", version: T1, sourceThrough: T1,
    sourceReceipt: receipt(current, T1, "full-stream-audit"), payload: current };
  const directory = mkdtempSync(join(tmpdir(), "registry-owned-test-")), file = join(directory, "reviewed.json");
  try {
    writeFileSync(file, JSON.stringify(input));
    const { candidate } = await registryRuntimeCandidateFromFile(file, store, "AZ");
    const context = takeStatePublicationPrior(store, "REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("AZ"))!;
    assert.deepEqual(context.members.get(`body:${oldBody.id}`)?.record, oldBody);
    assert.deepEqual((candidate.readModel as RegistryRuntimeCarton).registry.bodies.find(row => row.id === oldBody.id), changed);
    const next = new Map(candidate.civicRecords?.map(member => [member.key, member.record]));
    let released = 0;
    for (const [key, entry] of context.members) {
      if (next.has(key) && hash(canonicalCivicDataJson(next.get(key))) === entry.sha256 && typeof next.get(key) === "object") {
        assert.equal(entry.record, undefined, key);
        released++;
      }
    }
    assert.ok(released > 100, "the held index must release every unchanged state row during the streamed merge");
    const delta = candidateChangeSet(candidate, prior.payload);
    assert.deepEqual(delta.changed.find(row => row.key === `body:${oldBody.id}`)?.before, oldBody);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
