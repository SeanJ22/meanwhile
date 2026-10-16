import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { recordRoutineReaderProjectionReadback } from "../lib/civic-data/reader-verification.ts";
import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { getTableName } from "drizzle-orm";
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
  REGISTRY_RUNTIME_SCOPE,
  readRegistryRuntimePrior,
  registryBaseSourceReceipt,
  registryRuntimeCandidate,
  registryRuntimeProjectionIssues,
  type RegistryRuntimePackage,
  type RegistryRuntimeCarton,
  type RegistryRuntimeReadModel,
} from "../lib/registry/runtime-data-plane.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { getRegistryRuntimeReadModel, primeRegistryRuntimeFromValue, readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE, isCensusPlaceholderDivision, withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";
import { slotsFor } from "../lib/registry/derive.ts";
import type { Registry } from "../lib/registry/types.ts";
import { registryTransferImport, syntheticFederalDirectory, syntheticStateLegislators } from "./helpers/promoted-fixtures.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** The synthetic federal directory over the registry's own districts (the bundled first seed is gone). */
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

function servedRegistry(): RegistryRuntimeCarton {
  const { bodyRosters: _rosters, rosterReaderDispositions: _dispositions, ...imported } = registryTransferImport().projection.payload;
  const placeholders = frozenPlaceholders().ids;
  return { ...imported, registry: { ...imported.registry, bodies: imported.registry.bodies.filter((body) => body.ocdId === null || !placeholders.has(body.ocdId)) } };
}

async function registryPackage(at: string, salt: string): Promise<RegistryRuntimePackage> {
  const payload = structuredClone(servedRegistry());
  return { contractId: "registry-runtime-bindings", version: at, sourceThrough: at, sourceReceipt: receipt(payload, at, salt), payload };
}

test("Ask reads native state people beside a partitioned registry without reviving superseded legislative seat rows", async () => {
  const memory = new MemoryRoutineDataStore();
  const pkg = await registryPackage(T0, "district-seats");
  const model = structuredClone(registryRuntimeCandidate(pkg).readModel) as { -readonly [K in keyof RegistryRuntimeCarton]: RegistryRuntimeCarton[K] };
  const districts = ["ocd-division/country:us/state:oh/sldl:1", "ocd-division/country:us/state:oh/sldu:15"];
  for (const [index, division] of districts.entries()) {
    const id = `${division}#seat`;
    model.registry.divisions.push({ ...model.registry.divisions[0]!, ocdId: division });
    model.registry.bodies.push({ ...model.registry.bodies[0]!, id, ocdId: division, name: `Ohio legislative seat ${index}` });
    const memberId = `roster:${id}#held`;
    model.officialCandidacies = { ...model.officialCandidacies, rows: [...model.officialCandidacies.rows, {
      holder: { id: memberId, name: `Superseded seat member ${index}`,
        officeTitle: index ? "Senator" : "Representative", divisions: [division], authority: "REGISTRY_BODY_ROSTER",
        sourceUrl: `https://ohio.example.gov/seat/${index}` },
      status: "NOT_CHECKED", candidacy: null, reason: "This fixture has no candidacy finding.", unresolvedCandidacyIds: [],
    }] };
  }
  const candidate = registryRuntimeCandidate({ ...pkg, payload: model, sourceReceipt: receipt(model, T0, "district-seats") });
  const published = await processRegisteredManualCandidate(memory, "registry-runtime-bindings", candidate, T0);
  assert.equal(published.candidate.state, "PROMOTED", published.candidate.failureDetail ?? undefined);
  const pointer = published.promoted!;
  const payload = partitionCivicPayload(pointer.payload);
  const envelope = partitionCivicPayload(published.candidate.candidate, ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal"]);
  const parts = [...new Map([...payload.parts, ...envelope.parts].map(row => [row.hash, row])).values()];
  assert.ok(payload.parts.length > 0, "this must exercise a storage reference, not inline JSON");
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://local:local@ep-test.neon.tech/neondb";
  installFactReader(null);
  try {
    const postgres = new PostgresRoutineDataStore();
    const queries: string[] = [];
    Object.assign(postgres, { db: { select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: () => {
      const name = getTableName(table); queries.push(name);
      const rows = name === "civic_data_payload_parts" ? parts : name === "civic_data_promotions" ? [{
        key: pointer.key, sourceId: pointer.sourceId, recordClass: pointer.recordClass, scope: pointer.scope,
        currentVersionId: pointer.versionId, lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
        promotedAt: pointer.promotedAt, validationReceipt: pointer.receipt, payload: payload.value,
      }] : name === "civic_data_candidates" ? [{
        id: candidate.id, candidate: envelope.value, state: published.candidate.state, acquisitionSucceeded: true,
        validationReceipt: published.candidate.receipt, promotedVersionId: candidate.id,
        lastKnownGoodVersionId: candidate.id, failureCode: null, failureDetail: null,
      }] : [];
      return Object.assign(Promise.resolve(rows), { limit: async () => rows });
    } }) }) } });
    const read = await readRegistryRuntimeProjection({ store: postgres, bypassCache: true, now: T0 });
    if (read.kind !== "PROMOTED") throw new Error(JSON.stringify(read));
    assert.ok(queries.includes("civic_data_payload_parts"));
    const registryRuntime = { value: read.value, versionId: read.metadata.versionId! };
    await withReaderAuthorityEdge({ edgeOnly: true, registryRuntime }, async () => {
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
    await withReaderAuthorityEdge({ edgeOnly: true, registryRuntime, stateLegislators: { jurisdictions: new Set(["US-OH"]), load: async scope => {
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
    const first = await processRegisteredManualCandidate(store, "registry-runtime-bindings", registryRuntimeCandidate(firstPackage), T0);
    assert.equal(first.candidate.state, "PROMOTED");
    const contract = requiredManualProductionContract("registry-runtime-bindings");
    await recordRoutineReaderProjectionReadback(store, contract, first.promoted!, T1);
    const secondPackage = await registryPackage(T0, "same-pass-second");
    const payload = changed ? { ...secondPackage.payload, registry: { ...secondPackage.payload.registry,
      bodies: secondPackage.payload.registry.bodies.map((body, index) => index ? body : { ...body, homepageUrl: "https://changed.example.gov/" }) } } : secondPackage.payload;
    const second = await processRegisteredManualCandidate(store, "registry-runtime-bindings", registryRuntimeCandidate({ ...secondPackage, payload }), T0);
    assert.equal(second.candidate.state, "PROMOTED", second.candidate.failureDetail ?? undefined);
    assert.equal(Boolean(second.confirmed), !changed);
    const readback = second.readerReadback ?? await recordRoutineReaderProjectionReadback(store, contract, second.promoted!, T0);
    assert.equal(readback?.status, "PASS");
    assert.ok(Date.parse(readback!.observedAt) >= Date.parse(T1));
    assert.ok(Date.parse(second.confirmed?.at ?? second.candidate.receipt!.validatedAt) >= Date.parse(T1));
    const events = await store.events(second.promoted!.versionId);
    assert.ok(events.every((event, index) => index === 0 || Date.parse(event.at) >= Date.parse(events[index - 1]!.at)));
  }
});

test("registry relational bindings remain coherent while exact member deltas promote and bad successors leave LKG live", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "first");
  const first = registryRuntimeCandidate(firstPackage);
  const promoted = await processRegisteredManualCandidate(store, "registry-runtime-bindings", first, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.ok(firstPackage.payload.statewideExecutives.length > 0);
  assert.ok(firstPackage.payload.officialCandidacies.rows.some((row) => row.status === "RESOLVED"));
  assert.ok(firstPackage.payload.officialCandidacies.rows.every((row) => !("sourcePath" in row.holder) && !(row.candidacy && "sourcePath" in row.candidacy)));
  const firstRead = await readRegistryRuntimeProjection({ store, bypassCache: true, now: T0 });
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
  const changedOutcome = await processRegisteredManualCandidate(store, "registry-runtime-bindings", changed, T1);
  assert.equal(changedOutcome.candidate.state, "PROMOTED");
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `body:${changedBody.id}`));
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `official-candidacy:${changedBridgeRow.holder.id}`));
  const changedRead = await readRegistryRuntimeProjection({ store, bypassCache: true, now: T1 });
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
  const held = await processRegisteredManualCandidate(store, "registry-runtime-bindings", bad, "2026-09-08T12:02:00.000Z");
  assert.equal(held.candidate.state, "SEMANTIC_INVALID");
  assert.match(held.candidate.failureDetail ?? "", /OFFICIAL_CANDIDACY_HOLDER_FACT_MISMATCH/);
  assert.equal(held.promoted, null);
  assert.equal((await store.readPromotion("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE))?.versionId, changed.id);
});

test("one blocked registry publisher holds only its dependent members while an unrelated body update promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "isolation-first");
  const first = registryRuntimeCandidate(firstPackage);
  await processRegisteredManualCandidate(store, "registry-runtime-bindings", first, T0, null);

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
  const prior = await readRegistryRuntimePrior(store, T1);
  assert.equal(prior?.versionId, first.id);
  assert.equal(prior?.readModelSha256, first.normalization.normalizedHash);
  assert.deepEqual(prior?.sourceReceipt, first.retrieval.manualSourceReceipt);
  const next = registryRuntimeCandidate({
    ...nextPackage,
    payload: changedPayload,
    sourceReceipt: partialReceipt,
  }, { prior });
  // A receipted base carries its members' sources forward; nothing is inherited on authority alone.
  assert.equal(next.manualPriorAuthority, undefined);
  const outcome = await processRegisteredManualCandidate(
    store,
    "registry-runtime-bindings",
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

/** The frozen first seed still holds the two bodies once minted on Census placeholders (Arizona, New Hampshire). */
function frozenPlaceholders() {
  const frozen = JSON.parse(readFileSync("lib/registry/registry.json", "utf8")) as Registry;
  const divisions = frozen.divisions.filter((division) => isCensusPlaceholderDivision(division));
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
  // Known by the Census's own code whatever its slug or label says, the slug
  // standing in only where no code is held; never a division of another layer.
  const seed = servedRegistry();
  const real = seed.registry.divisions.find((division) => division.divisionType === "school_district" && !isCensusPlaceholderDivision(division));
  assert.ok(real);
  assert.deepEqual(slotsFor(real), { slots: [{ bodyClass: "GOVERNING", slot: "board" }], skipped: null });
  assert.equal(isCensusPlaceholderDivision({ ...real, geoid: "0499997" }), true);
  assert.equal(isCensusPlaceholderDivision({ ocdId: placeholders.divisions[0]!.ocdId }), true);
  assert.equal(isCensusPlaceholderDivision({ ...placeholders.divisions[0]!, divisionType: "place" }), false);

  // The served registry keeps both places as geography.
  assert.equal(seed.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).length, 2);

  // One view of the frozen file for everything that counts its bodies: it drops exactly the two boards
  // and keeps every place.
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
  const placeholders = frozenPlaceholders();
  // A prior holding both bodies and a raw Census name.
  const base = await registryPackage(T0, "placeholder-prior");
  const priorPayload = structuredClone(base.payload);
  priorPayload.registry.bodies = [...priorPayload.registry.bodies, ...placeholders.bodies].sort((left, right) => left.id.localeCompare(right.id));
  priorPayload.registry.divisions = priorPayload.registry.divisions.map((division) =>
    division.state === "NH" && placeholders.ids.has(division.ocdId) ? { ...division, label: "School District Not Defined" } : division);
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

  // Omitted by the package: this open family would otherwise keep a prior member forever.
  const next = await registryPackage(T1, "placeholder-next");
  const fromPrior = registryRuntimeCandidate(next, { prior });
  const fromPriorModel = fromPrior.readModel as RegistryRuntimeReadModel;
  assert.deepEqual(fromPrior.semantics.violations, []);
  assert.equal(fromPriorModel.registry.bodies.length, base.payload.registry.bodies.length);
  assert.deepEqual(plainNames(fromPriorModel), ["No unified school district here", "No unified school district here"]);
  assert.deepEqual(removals(fromPrior), expectedRemovals);
  assert.equal((fromPrior.excludedFacts ?? []).some((fact) => fact.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING" && expectedRemovals.includes(fact.key ?? "")), false);
  // The removals it proves to the plane are the prior's, named by their division.
  assert.deepEqual(fromPrior.removalEvidence, placeholders.bodies.map((body) => ({ key: `body:${body.id}`, code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT", divisionOcdId: body.ocdId })).sort((left, right) => left.key.localeCompare(right.key)));

  // Carried by the package itself, raw name and all.
  const carryingPayload = structuredClone(priorPayload);
  const carrying: RegistryRuntimePackage = { ...next, payload: carryingPayload, sourceReceipt: receipt(carryingPayload, T1, "placeholder-carrying") };
  const fromPackage = registryRuntimeCandidate(carrying);
  const fromPackageModel = fromPackage.readModel as RegistryRuntimeReadModel;
  assert.deepEqual(fromPackage.semantics.violations, []);
  assert.equal(fromPackageModel.registry.bodies.some((body) => body.ocdId !== null && placeholders.ids.has(body.ocdId)), false);
  assert.deepEqual(plainNames(fromPackageModel), ["No unified school district here", "No unified school district here"]);
  assert.deepEqual(removals(fromPackage), expectedRemovals);
  assert.equal(fromPackage.removalEvidence, undefined, "no pointer held them, so nothing is removed from one");
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "registry-runtime-bindings", fromPackage, T1);
  assert.equal(outcome.candidate.state, "PROMOTED");
});

// This transfer fixture is retained history, without source authentication or publication authority.
async function transferImportedRegistry(store: MemoryRoutineDataStore, at: string) {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as {
    record: CandidateVersionRecord;
    projection: PromotedProjection;
  };
  assert.equal(projection.promotedAt, at, "the recorded transfer promoted at T0");
  assert.equal(promotionProofIssue(record.candidate.recordClass, record.candidate.scope, projection, record), null);
  const imported = record.candidate;
  const base = projection.payload as RegistryRuntimeReadModel;
  Object.assign(store, { candidates: new Map([[imported.id, record]]), promotions: new Map([[projection.key, projection]]) });
  return { imported, base, placeholders: frozenPlaceholders(), record, projection };
}

/** A correction that re-reviews only the two placeholder divisions against the Census directory they cite. */
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
    contractId: "registry-runtime-bindings",
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
    #reads = { promotion: 0, proof: 0, candidate: 0 };
    get reads() { return { ...this.#reads }; }
    resetReads() { this.#reads = { promotion: 0, proof: 0, candidate: 0 }; }
    override async readPromotion<T>(recordClass: RoutineRecordClass, scope: string) {
      this.#reads.promotion++;
      return super.readPromotion<T>(recordClass, scope);
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
  const prior = await readRegistryRuntimePrior(store, T1);
  assert.ok(prior);
  assert.equal(prior.versionId, imported.id);
  assert.deepEqual(store.reads, { promotion: 1, proof: 1, candidate: 0 }, "only the current proof row is read, using the original private-field store");
  assert.equal(prior.readModelSha256, imported.normalization.normalizedHash);
  assert.deepEqual(prior.sourceReceipt.sources, [], "the import has no source receipt to carry");
  assert.equal(prior.sourceReceipt.reviewedAt, imported.retrieval.retrievedAt);
  store.resetReads();
  const fallback = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: store.readCandidate.bind(store),
  };
  assert.deepEqual(await readRegistryRuntimePrior(fallback, T1), prior, "a store without a proof door returns the same verified metadata");
  assert.deepEqual(store.reads, { promotion: 1, proof: 0, candidate: 1 }, "the whole-read fallback is not repeated");

  const next = registryRuntimeCandidate(placeholderCorrection(base, placeholders.ids, T1), { prior });
  assert.deepEqual(next.semantics.violations, []);
  const phantomKeys = placeholders.bodies.map((body) => `body:${body.id}`).sort();
  const rosterKeys = civicRecordsFor("REGISTRY_RUNTIME_BINDING", prior.payload).map((member) => member.key).filter((key) => /^(body-roster|roster-disposition):/.test(key));
  assert.ok(rosterKeys.length > 0, "the import still carried rosters; they leave for the fact store");
  const removedKeys = [...phantomKeys, ...rosterKeys].sort((left, right) => left.localeCompare(right));
  assert.deepEqual((next.removalEvidence ?? []).map((row) => row.key), removedKeys);
  const inherited = new Set(next.manualPriorAuthority?.retainedMembers.map((member) => member.key));
  assert.ok(inherited.size > 1_000, `every untouched cited member carries the import's authority (${inherited.size})`);
  assert.equal([...placeholders.ids].some((id) => inherited.has(`division:${id}`)), false, "the reviewed divisions stand on the review");

  const outcome = await processRegisteredManualCandidate(store, "registry-runtime-bindings", next, T1, imported.id);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt?.checks.filter((check) => check.verdict !== "PASS")));
  assert.equal(outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code, "CURRENT_SOURCES_AND_EXACT_PRIOR_AUTHORITY_VALID");
  const changes = outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changes.removed.map((delta) => delta.key).sort((left, right) => left.localeCompare(right)), removedKeys);
  assert.deepEqual(changes.changed.map((delta) => delta.key), [`division:${placeholders.divisions.find((division) => division.state === "NH")!.ocdId}`]);
  assert.deepEqual(changes.added, []);
  const served = outcome.promoted!.payload as RegistryRuntimeReadModel;
  assert.equal(served.registry.bodies.length, base.registry.bodies.length - 2);
  assert.deepEqual(served.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).map((division) => division.label), ["No unified school district here", "No unified school district here"]);

  // The next correction builds on that one; what is still carried from the import keeps carrying.
  const secondPrior = await readRegistryRuntimePrior(store, T1);
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
  assert.deepEqual(registryBaseSourceReceipt(record.candidate).sources, []);
  const { bootstrapImport, ...withoutImport } = record.candidate;
  assert.ok(bootstrapImport);
  assert.throws(() => registryBaseSourceReceipt(withoutImport), /REGISTRY_RUNTIME_BASE_PROOF_INVALID:MANUAL_SOURCE_RECEIPT_INVALID/);
  const reattested = { ...record.candidate, bootstrapImport: { ...bootstrapImport, kind: "TRUSTED_LKG_REATTESTATION" } } as unknown as RoutineCandidate;
  assert.throws(() => registryBaseSourceReceipt(reattested), /REGISTRY_RUNTIME_BASE_PROOF_INVALID:MANUAL_SOURCE_RECEIPT_INVALID/);

  // Through the real read: a pointer that no longer matches its candidate is never a base, whichever layer sees it first.
  const moved = structuredClone(projection.payload) as RegistryRuntimeReadModel;
  moved.registry.bodies = moved.registry.bodies.slice(1);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, { ...projection, payload: moved }]]) });
  await assert.rejects(readRegistryRuntimePrior(store, T1), /REGISTRY_RUNTIME_BASE_(?:PROOF_INVALID|UNAVAILABLE):/);
});

test("the plane refuses what the registry door does not prove: a changed carried member, an unexplained removal, a real board passed off as a placeholder", async () => {
  const store = new MemoryRoutineDataStore();
  const { imported, base, placeholders } = await transferImportedRegistry(store, T0);
  const prior = await readRegistryRuntimePrior(store, T1);
  const next = registryRuntimeCandidate(placeholderCorrection(base, placeholders.ids, T1), { prior });
  const lkg = await store.readCandidate(imported.id);
  const codes = (candidate: RoutineCandidate) =>
    validateRoutineCandidate({ ...candidate, changeSet: candidateChangeSet(candidate, base) }, lkg, T1).receipt.checks
      .filter((check) => check.verdict !== "PASS").map((check) => check.code);
  assert.deepEqual(codes(next), []);

  // A member carried on the import's authority may not change.
  const changed = structuredClone(next) as RoutineCandidate & { readModel: RegistryRuntimeReadModel };
  const carriedBody = changed.readModel.registry.bodies.find((body) => next.manualPriorAuthority!.retainedMembers.some((member) => member.key === `body:${body.id}`))!;
  carriedBody.name = `${carriedBody.name ?? "A body"} (unreviewed)`;
  assert.ok(codes(changed).includes("MANUAL_PRIOR_AUTHORITY_INVALID"), JSON.stringify(codes(changed)));

  // A removal with no evidence stays unexplained.
  const unexplained = { ...next, removalEvidence: undefined };
  assert.deepEqual(codes(unexplained), ["INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED"]);

  // A real board removed under the placeholder code is refused.
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

test("the version production serves keeps reading until its correction promotes; no other defect is tolerated", async () => {
  const placeholders = frozenPlaceholders();
  const seed: RegistryRuntimeReadModel = { ...registryTransferImport().projection.payload, registry: servedRegistry().registry };
  const legacy: RegistryRuntimeReadModel = { ...seed, registry: { ...seed.registry, bodies: [...seed.registry.bodies, ...placeholders.bodies] } };
  try {
    primeRegistryRuntimeFromValue(legacy, "legacy-with-placeholder-bodies");
    assert.equal(getRegistryRuntimeReadModel().registry.bodies.length, seed.registry.bodies.length + 2);
    const duplicated: RegistryRuntimeReadModel = { ...legacy, registry: { ...legacy.registry, bodies: [...legacy.registry.bodies, legacy.registry.bodies[0]!] } };
    assert.throws(() => primeRegistryRuntimeFromValue(duplicated, "duplicate-body"), /BODY_ID_INVALID_OR_DUPLICATED/);
  } finally {
    primeRegistryRuntimeFromValue(seed, "corrected");
    assert.equal(getRegistryRuntimeReadModel().registry.bodies.length, seed.registry.bodies.length);
  }
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
    readRegistryRuntimeProjection({ store: brokenStore, bypassCache: true }),
  ]);
  assert.deepEqual(reads.map((read) => read.kind), ["STORE_UNREACHABLE", "STORE_UNREACHABLE"]);
  assert.equal(candidateReads, 0);
});

test("manual contracts have no clock and retired tracked writers cannot be invoked", () => {
  const ids = new Set(["congress-bulk-roster:AZ", "registry-runtime-bindings"]);
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
