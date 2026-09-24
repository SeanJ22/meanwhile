import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceProjectionEvidence, type ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import {
  FEDERAL_DIRECTORY_SCOPE,
  FEDERAL_DIRECTORY_SOURCE_ID,
  failedFederalDirectoryCandidate,
  federalDirectoryCandidate,
  type FederalDirectoryAcquisition,
} from "../lib/officials/federal-directory-data-plane.ts";
import { federalDirectoryFirstSeed, readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import {
  REGISTRY_RUNTIME_SCOPE,
  REGISTRY_RUNTIME_SOURCE_ID,
  registryRuntimeCandidate,
  registryRuntimeProjectionIssues,
  type RegistryRuntimePackage,
  type RegistryRuntimeReadModel,
} from "../lib/registry/runtime-data-plane.ts";
import { getRegistryRuntimeReadModel, primeRegistryRuntimeFromValue, readRegistryRuntimeProjection, registryRuntimeFirstSeed } from "../lib/registry/runtime-read-model.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE, isCensusPlaceholderDivision } from "../lib/registry/census-placeholders.ts";
import { slotsFor } from "../lib/registry/derive.ts";
import type { Registry } from "../lib/registry/types.ts";

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function federalSeed() {
  const read = await readFederalDirectoryProjection({ store: new MemoryRoutineDataStore(), bypassCache: true });
  if (read.kind !== "BOOTSTRAP") throw new Error(`expected federal bootstrap, received ${read.kind}`);
  return structuredClone(read.value);
}

function federalAcquisitions(sourceSha: string, suffix: string): FederalDirectoryAcquisition[] {
  return ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"].map((name) => {
    const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: `${suffix}:${name}` };
  });
}

function registryUrls(value: RegistryRuntimeReadModel): string[] {
  return [...new Set([
    ...value.registry.divisions.map((division) => division.provenance?.sourceUrl ?? ""),
    ...value.registry.bodies.map((body) => body.provenance?.sourceUrl ?? ""),
    ...value.bodyRosters.flatMap((roster) => [roster.sourceUrl, roster.partisanshipSourceUrl ?? "", ...roster.members.flatMap((member) => [member.websiteUrl ?? "", member.partySourceUrl ?? ""])]),
    ...value.statewideExecutives.flatMap((row) => [row.sourceUrl, row.partySourceUrl ?? ""]),
    ...value.officialCandidacies.rows.map((row) => row.candidacy?.sourceUrl ?? ""),
    ...value.officialPhotos.photos.map((photo) => photo.sourceUrl ?? ""),
  ].filter((url) => /^https:\/\//.test(url)))].sort();
}

function receipt(value: RegistryRuntimeReadModel, at: string, salt: string): ManualSourceSetReceipt {
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

async function registryPackage(at: string, salt: string): Promise<RegistryRuntimePackage> {
  const read = await readRegistryRuntimeProjection({ store: new MemoryRoutineDataStore(), bypassCache: true });
  if (read.kind !== "BOOTSTRAP") throw new Error(`expected registry bootstrap, received ${read.kind}`);
  const payload = structuredClone(read.value);
  return { contractId: "registry-runtime-bindings", version: at, sourceThrough: at, sourceReceipt: receipt(payload, at, salt), payload };
}

test("federal roster/directory promotes once and failed acquisition preserves its exact GOOD pointer", async () => {
  const store = new MemoryRoutineDataStore();
  const projection = await federalSeed();
  const good = federalDirectoryCandidate({ acquisitions: federalAcquisitions(projection.sourceSha, "good"), retrievedAt: T0, projection });
  const promoted = await processRegisteredManualCandidate(store, "congress-bulk-roster", good, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.deepEqual((await store.events(good.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  const read = await readFederalDirectoryProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, good.id);

  const alteredProjection = structuredClone(projection);
  alteredProjection.roster.officeholders[0]!.name = `${alteredProjection.roster.officeholders[0]!.name} Altered`;
  const altered = federalDirectoryCandidate({ acquisitions: federalAcquisitions(projection.sourceSha, "good"), retrievedAt: T0, projection: alteredProjection });
  assert.notEqual(altered.id, good.id, "the federal candidate identity binds the exact normalized projection");

  const oneFile = federalAcquisitions(projection.sourceSha, "duplicate")[0]!;
  const incomplete = federalDirectoryCandidate({ acquisitions: Array.from({ length: 5 }, () => oneFile), retrievedAt: T1, projection });
  const incompleteOutcome = await processRegisteredManualCandidate(store, "congress-bulk-roster", incomplete, T1);
  assert.equal(incompleteOutcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE))?.versionId, good.id);

  const failed = failedFederalDirectoryCandidate(T1, "directory source unavailable");
  const refused = await processRegisteredManualCandidate(store, "congress-bulk-roster", failed, T1);
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE))?.versionId, good.id);
});

test("federal civic member ordering is independent of source-map insertion order", async () => {
  const projection = await federalSeed();
  const reordered = structuredClone(projection);
  reordered.directory.byMember = Object.fromEntries(
    Object.entries(reordered.directory.byMember).reverse(),
  );
  reordered.directory.committees = Object.fromEntries(
    Object.entries(reordered.directory.committees).reverse(),
  );
  const acquisitions = federalAcquisitions(projection.sourceSha, "stable-order");
  const original = federalDirectoryCandidate({ acquisitions, retrievedAt: T0, projection });
  const roundTripped = federalDirectoryCandidate({
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

test("registry relational bindings remain coherent while exact member deltas promote and bad successors leave LKG live", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "first");
  const first = registryRuntimeCandidate(firstPackage);
  const promoted = await processRegisteredManualCandidate(store, "registry-runtime-bindings", first, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.ok(firstPackage.payload.bodyRosters.length > 0);
  assert.ok(firstPackage.payload.rosterReaderDispositions.some((row) => row.state === "IDENTITY_UNRESOLVED"));
  assert.ok(firstPackage.payload.statewideExecutives.length > 0);
  assert.ok(firstPackage.payload.officialCandidacies.rows.some((row) => row.status === "RESOLVED"));
  assert.ok(firstPackage.payload.officialCandidacies.rows.every((row) => !("sourcePath" in row.holder) && !(row.candidacy && "sourcePath" in row.candidacy)));
  const firstRead = await readRegistryRuntimeProjection({ store, bypassCache: true, now: T0 });
  assert.equal(firstRead.kind, "PROMOTED");
  assert.equal(firstRead.metadata.versionId, first.id);

  const changedBase = await registryPackage(T1, "changed");
  const changedRoster = changedBase.payload.bodyRosters[0];
  const changedBridgeRow = changedBase.payload.officialCandidacies.rows.find((row) => row.status === "NO_APPLICABLE_CANDIDACY");
  assert.ok(changedRoster);
  assert.ok(changedBridgeRow);
  const changedPayload: RegistryRuntimeReadModel = {
    ...changedBase.payload,
    bodyRosters: [{ ...changedRoster, members: [{ ...changedRoster.members[0]!, phone: "555-0100" }, ...changedRoster.members.slice(1)] }, ...changedBase.payload.bodyRosters.slice(1)],
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
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `body-roster:${changedRoster.bodyId}`));
  assert.ok(changedOutcome.candidate.candidate.changeSet?.changed.some((record) => record.key === `official-candidacy:${changedBridgeRow.holder.id}`));
  const changedRead = await readRegistryRuntimeProjection({ store, bypassCache: true, now: T1 });
  assert.equal(changedRead.kind, "PROMOTED");
  assert.equal(
    changedRead.value.bodyRosters.find((roster) => roster.bodyId === changedRoster.bodyId)?.members[0]?.phone,
    "555-0100",
  );
  assert.match(changedRead.value.officialCandidacies.rows.find((row) => row.holder.id === changedBridgeRow.holder.id)?.reason ?? "", /successor package/);

  const badPackage: RegistryRuntimePackage = {
    ...structuredClone(changedPackage),
    version: `${T1}-bad`,
    sourceReceipt: { ...changedPackage.sourceReceipt, reviewedAt: "2026-09-08T12:02:00.000Z" },
    payload: {
      ...changedPackage.payload,
      officialCandidacies: {
        ...changedPackage.payload.officialCandidacies,
        rows: changedPackage.payload.officialCandidacies.rows.map((row) => row.holder.authority === "REGISTRY_BODY_ROSTER"
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

test("one blocked registry publisher holds only its dependent members while an unrelated roster update promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const firstPackage = await registryPackage(T0, "isolation-first");
  const first = registryRuntimeCandidate(firstPackage);
  await processRegisteredManualCandidate(store, "registry-runtime-bindings", first, T0, null);

  const nextPackage = await registryPackage(T1, "isolation-next");
  const [supportedRoster, blockedRoster] = nextPackage.payload.bodyRosters.filter((roster, index, rows) =>
    rows.findIndex((candidate) => candidate.sourceUrl === roster.sourceUrl) === index
  ).slice(0, 2);
  assert.ok(supportedRoster && blockedRoster && supportedRoster.sourceUrl !== blockedRoster.sourceUrl);
  const changedPayload = structuredClone(nextPackage.payload);
  const changedSupported = changedPayload.bodyRosters.find((roster) => roster.bodyId === supportedRoster.bodyId)!;
  changedSupported.members[0] = { ...changedSupported.members[0]!, phone: "555-0199" };
  const currentReceipt = receipt(changedPayload, T1, "isolation-next");
  const partialReceipt: ManualSourceSetReceipt = {
    ...currentReceipt,
    sources: currentReceipt.sources.map((source) => source.finalUrl === blockedRoster.sourceUrl
      ? {
          ...source,
          httpStatus: 503,
          rawHash: hash(`blocked:${source.finalUrl}`),
          reviewOutcome: "BLOCKED" as const,
          failureDetail: "The unrelated registry publisher was unavailable.",
        }
      : source),
  };
  const next = registryRuntimeCandidate({
    ...nextPackage,
    payload: changedPayload,
    sourceReceipt: partialReceipt,
  }, {
    prior: {
      versionId: first.id,
      payload: first.readModel as RegistryRuntimeReadModel,
      sourceReceipt: first.retrieval.manualSourceReceipt!,
    },
  });
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
    record.key === `body-roster:${supportedRoster.bodyId}`
  ));
  assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `body-roster:${blockedRoster.bodyId}` && fact.code === "MANUAL_MEMBER_HELD_LKG"
  ));
  const promoted = outcome.promoted!.payload as RegistryRuntimeReadModel;
  assert.equal(
    promoted.bodyRosters.find((roster) => roster.bodyId === supportedRoster.bodyId)?.members[0]?.phone,
    "555-0199",
  );
  assert.deepEqual(
    promoted.bodyRosters.find((roster) => roster.bodyId === blockedRoster.bodyId),
    firstPackage.payload.bodyRosters.find((roster) => roster.bodyId === blockedRoster.bodyId),
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
  const seed = registryRuntimeFirstSeed().value;
  const real = seed.registry.divisions.find((division) => division.divisionType === "school_district" && !isCensusPlaceholderDivision(division));
  assert.ok(real);
  assert.deepEqual(slotsFor(real), { slots: [{ bodyClass: "GOVERNING", slot: "board" }], skipped: null });
  assert.equal(isCensusPlaceholderDivision({ ...real, geoid: "0499997" }), true);
  assert.equal(isCensusPlaceholderDivision({ ocdId: placeholders.divisions[0]!.ocdId }), true);
  assert.equal(isCensusPlaceholderDivision({ ...placeholders.divisions[0]!, divisionType: "place" }), false);

  // The composed first seed leaves both bodies out and keeps both places.
  assert.equal(seed.registry.bodies.some((body) => body.ocdId !== null && placeholders.ids.has(body.ocdId)), false);
  assert.equal(seed.registry.divisions.filter((division) => placeholders.ids.has(division.ocdId)).length, 2);
  assert.equal(registryRuntimeProjectionIssues(seed).some((issue) => issue.startsWith(CENSUS_PLACEHOLDER_BODY_ISSUE)), false);
  const carrying: RegistryRuntimeReadModel = { ...seed, registry: { ...seed.registry, bodies: [...seed.registry.bodies, ...placeholders.bodies] } };
  assert.deepEqual(
    registryRuntimeProjectionIssues(carrying).filter((issue) => issue.startsWith(CENSUS_PLACEHOLDER_BODY_ISSUE)),
    [`${CENSUS_PLACEHOLDER_BODY_ISSUE}:${placeholders.bodies.map((body) => body.id).sort().join(",")}`],
  );
});

test("a promotion drops placeholder bodies whichever side holds them, names why, and translates the placeholder's name", async () => {
  const placeholders = frozenPlaceholders();
  // The prior as production held it on 2026-09-14: both bodies, and New Hampshire's raw Census name.
  const base = await registryPackage(T0, "placeholder-prior");
  const priorPayload = structuredClone(base.payload);
  priorPayload.registry.bodies = [...priorPayload.registry.bodies, ...placeholders.bodies].sort((left, right) => left.id.localeCompare(right.id));
  priorPayload.registry.divisions = priorPayload.registry.divisions.map((division) =>
    division.state === "NH" && placeholders.ids.has(division.ocdId) ? { ...division, label: "School District Not Defined" } : division);
  const prior = { versionId: "placeholder-prior", payload: priorPayload, sourceReceipt: receipt(priorPayload, T0, "placeholder-prior") };
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

  // Carried by the package itself, raw name and all.
  const carryingPayload = structuredClone(priorPayload);
  const carrying: RegistryRuntimePackage = { ...next, payload: carryingPayload, sourceReceipt: receipt(carryingPayload, T1, "placeholder-carrying") };
  const fromPackage = registryRuntimeCandidate(carrying);
  const fromPackageModel = fromPackage.readModel as RegistryRuntimeReadModel;
  assert.deepEqual(fromPackage.semantics.violations, []);
  assert.equal(fromPackageModel.registry.bodies.some((body) => body.ocdId !== null && placeholders.ids.has(body.ocdId)), false);
  assert.deepEqual(plainNames(fromPackageModel), ["No unified school district here", "No unified school district here"]);
  assert.deepEqual(removals(fromPackage), expectedRemovals);
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "registry-runtime-bindings", fromPackage, T1);
  assert.equal(outcome.candidate.state, "PROMOTED");
});

test("the version production serves keeps reading until its correction promotes; no other defect is tolerated", async () => {
  const placeholders = frozenPlaceholders();
  const seed = registryRuntimeFirstSeed().value;
  const legacy: RegistryRuntimeReadModel = { ...seed, registry: { ...seed.registry, bodies: [...seed.registry.bodies, ...placeholders.bodies] } };
  try {
    primeRegistryRuntimeFromValue(legacy, "legacy-with-placeholder-bodies");
    assert.equal(getRegistryRuntimeReadModel().registry.bodies.length, seed.registry.bodies.length + 2);
    const duplicated: RegistryRuntimeReadModel = { ...legacy, registry: { ...legacy.registry, bodies: [...legacy.registry.bodies, legacy.registry.bodies[0]!] } };
    assert.throws(() => primeRegistryRuntimeFromValue(duplicated, "duplicate-body"), /BODY_ID_INVALID_OR_DUPLICATED/);
  } finally {
    const restored = await readRegistryRuntimeProjection({ store: new MemoryRoutineDataStore(), bypassCache: true });
    assert.equal(restored.kind, "BOOTSTRAP");
  }
});

test("both Reader projections reject cross-source proof and never bootstrap on store failure", async () => {
  const projection = await federalSeed();
  const candidate = federalDirectoryCandidate({ acquisitions: federalAcquisitions(projection.sourceSha, "proof"), retrievedAt: T0, projection });
  const mismatched = { ...candidate, id: `${candidate.id}-bad-proof`, sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_DIRECTORY_SOURCE_ID, "FEDERAL_DIRECTORY", "US:wrong-scope") };
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "congress-bulk-roster", mismatched, T0);
  assert.equal(outcome.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(outcome.promoted, null);

  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const reads = await Promise.all([
    readFederalDirectoryProjection({ store: brokenStore, bypassCache: true }),
    readRegistryRuntimeProjection({ store: brokenStore, bypassCache: true }),
  ]);
  assert.deepEqual(reads.map((read) => read.kind), ["STORE_UNREACHABLE", "STORE_UNREACHABLE"]);
  assert.equal(candidateReads, 0);
});

test("manual contracts have no clock and retired tracked writers cannot be invoked", () => {
  const ids = new Set(["congress-bulk-roster", "registry-runtime-bindings"]);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.equal(contracts.length, 2);
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY" && !("cadence" in contract)));
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, T0, contracts);
  assert.ok(view.contracts.every((row) => row.cadence.clock === "MANUAL" && row.cadence.nextDue.kind === "NOT_APPLICABLE"));

  const federalImport = federalDirectoryFirstSeed();
  const registryImport = registryRuntimeFirstSeed();
  assert.equal(federalImport.sourceId, FEDERAL_DIRECTORY_SOURCE_ID);
  assert.equal(registryImport.sourceId, REGISTRY_RUNTIME_SOURCE_ID);
  assert.match(federalImport.versionId, /^bootstrap:FEDERAL_DIRECTORY:/);
  assert.match(registryImport.versionId, /^bootstrap:REGISTRY_RUNTIME_BINDING:/);
  assert.ok(federalImport.value.roster.officeholders.length >= 500);
  assert.ok(registryImport.value.officialCandidacies.rows.length > 800);

  for (const path of ["scripts/build-officeholders.ts", "scripts/enrich-federal-officeholders.mts", "scripts/fetch-official-photos.mts", "scripts/migrate-congress-directory.mts"]) {
    assert.equal(existsSync(path), false, path);
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["congress:fetch"],
    "node scripts/installed-runtime-command.mjs manual-promote --contract=congress-bulk-roster",
  );
  assert.equal(
    pkg.scripts["registry:promote"],
    "node scripts/installed-runtime-command.mjs manual-promote --contract=registry-runtime-bindings",
  );
  assert.equal(pkg.scripts["registry:build"], undefined);
  assert.equal(pkg.scripts["officials:build"], undefined);
  assert.equal(pkg.scripts["officials:enrich"], undefined);
  assert.equal(pkg.scripts["officials:photos"], undefined);
});
