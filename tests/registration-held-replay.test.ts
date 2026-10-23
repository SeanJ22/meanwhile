import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { join } from "node:path";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "../lib/civic-data/types.ts";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { reconcileRegistrationHeldReceipt, registrationHeldReplayIsExact } from "../lib/registration/held-evidence.ts";
import { REGISTRATION_HELD_RETRIEVED_AT, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference, type LoadedReference } from "../lib/registration/reference.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";

const ROOT = join(import.meta.dirname, "..");
const recheckedAt = "2026-10-09T10:24:23.616Z";
const replayAt = "2026-10-10T00:25:00.000Z";
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");

/** The held reference as the Census of Governments alone built it, before district boundaries and tribal areas joined it. */
function censusOnly(loaded: LoadedReference): LoadedReference {
  const { boundarySources: _sources, ...rest } = loaded.reference;
  const divisions = rest.divisions.filter(d => d[1] !== "district" && d[1] !== "aiannh");
  const at = (index: number) => index < 0 ? -1 : divisions.indexOf(rest.divisions[index]);
  const governments = rest.governments.filter(g => g[5] !== "AIANNH_CODE" && g[5] !== "BOUNDARY_SOURCE_ONLY").map(([pid, id, name, type, division, how, alternate]) =>
    how === "BOUNDARY_SOURCE" || how === "COUNTY_NAMED" ? [pid, id, name, type, -1, "NO_CENSUS_GEOGRAPHY", at(alternate)] as const : [pid, id, name, type, at(division), how, at(alternate)] as const);
  const reference = { ...rest, divisions, governments };
  return { ...loaded, reference, sha256: hash(`${JSON.stringify(reference)}\n`), generatedAt: "2026-09-23" };
}

async function legacyRegistration() {
  const store = new MemoryRoutineDataStore(), target = registrationTarget("NH");
  const reference = censusOnly(loadRegistrationReference(ROOT, target.state));
  const baseline = registrationCandidate({ target, reference, receipt: heldRegistrationReceipt() });
  const model = baseline.readModel as RegistrationReadModel;
  const government = model.governments!.find(row => row.nativeIds.census_pid6 && row.associations.length)!;
  const body = {
    id: `${government.associations[0].divisionId}#governing`, ocdId: government.associations[0].divisionId,
    name: null, bodyClass: "GOVERNING", bodyOrigin: "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS",
    coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null,
    meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "COG_2022",
    censusId: government.nativeIds.census_pid6, censusUnitType: government.governmentClass,
    jurisdictionId: government.jurisdictionId, provenance: government.provenance,
  };
  // Historical /3 had no named listing collection. Its 304 date meant the
  // publisher check, and it carried no separate sourceCheck. One native body
  // stands for the former inventory placeholders; the held divisions are real.
  const { governments: _listings, ...legacyModel } = model;
  const readModel = { ...legacyModel, bodies: [body] };
  const normalizedHash = hash(readModel);
  const normalizedPayload = { formatVersion: 1, state: model.state, readModelHash: normalizedHash,
    sourceSha256: REGISTRATION_SOURCE_SHA256, referenceSha256: reference.sha256,
    reviewedRegistryVersionId: null, divisions: model.divisions.length, bodies: 1 };
  const previous: RoutineCandidate = { ...baseline, id: "cv-historical-nh-registration-3",
    retrieval: { succeeded: true, requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL,
      httpStatus: 304, retrievedAt: recheckedAt, rawHash: hash(`${REGISTRATION_SOURCE_SHA256}\n${reference.sha256}\nnull`) },
    normalization: { ...baseline.normalization, parserVersion: "registration/3", schemaVersion: "registration:2",
      normalizedHash, normalizedPayloadHash: hash(normalizedPayload), inputRecords: model.divisions.length + 1, outputRecords: model.divisions.length + 1 },
    normalizedPayload, readModel };
  // Historical GOOD is stored using its original contract receipt, not
  // relitigated under today's parser declaration or 304-response rule.
  const validation = validateRoutineCandidate(baseline, null, recheckedAt);
  assert.equal(validation.state, "VALIDATED");
  const receipt = { ...validation.receipt, candidateId: previous.id };
  await store.create({ candidate: previous, state: "FETCHED", acquisitionSucceeded: true, receipt: null,
    promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
  { candidateId: previous.id, sequence: 1, state: "FETCHED", at: recheckedAt, detail: "Historical registration/3 provider check." });
  await store.transition(previous.id, "NORMALIZED", recheckedAt, "Historical normalization.");
  await store.transition(previous.id, "VALIDATED", recheckedAt, "Historical GOOD.", receipt);
  await store.promote(previous.id, receipt, recheckedAt);
  const prior = (await store.readCandidate(previous.id))!;
  const reconciled = reconcileRegistrationHeldReceipt(heldRegistrationReceipt(), reference, prior);
  const candidate = registrationCandidate({ target, reference, receipt: reconciled, previous: readModel as RegistrationReadModel });
  return { store, target, reference, prior, candidate, body, baseline };
}

test("the current registration parser replays original held listings after the real later /3 304 date, preserving prior facts and source clocks", async () => {
  const { store, target, reference, prior, candidate, body, baseline } = await legacyRegistration();
  assert.equal(prior.candidate.retrieval.rawHash, "2f6130d4781a90e2dd1b0e735965378584b3b70386bdc5a41602c1e7051fdf9d", "matches the production NH source/reference proof");
  assert.equal(registrationHeldReplayIsExact(candidate, prior), true);
  const unproven = validateRoutineCandidate(baseline, prior, replayAt);
  assert.equal(unproven.state, "TEMPORAL_INVALID", "a bare older capture remains refused");
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, replayAt);
  assert.equal(outcome.promoted?.versionId, candidate.id, outcome.candidate.failureDetail ?? "");
  const read = await readRegistrationProjection(target.state, { store, now: replayAt, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  const delivered = read.value as RegistrationReadModel;
  assert.ok(delivered.governments!.length > 0);
  assert.equal(delivered.bodies.length, 0);
  assert.deepEqual(delivered.divisions, (prior.candidate.readModel as RegistrationReadModel).divisions);
  assert.ok(delivered.governments!.find(row => row.nativeIds.census_pid6 === body.censusId)!.aliases.includes(body.id));
  assert.deepEqual(delivered.governments!.map(row => row.provenance.collectedAt), (baseline.readModel as RegistrationReadModel).governments!.map(row => row.provenance.collectedAt));
  assert.equal(candidate.retrieval.retrievedAt, REGISTRATION_HELD_RETRIEVED_AT);
  assert.deepEqual(candidate.retrieval.sourceCheck, { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL,
    httpStatus: 304, rawHash: REGISTRATION_SOURCE_SHA256, checkedAt: recheckedAt });
  const task = routineTaskFromContract(requiredRoutineContract(target.contractId));
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastSucceededAt, REGISTRATION_HELD_RETRIEVED_AT);
  assert.equal(clock.lastSucceededObservedAt, recheckedAt, "reparse does not claim a new publisher check");
  assert.equal(routineTaskDue(task, clock, Date.parse(recheckedAt) + task.cadenceMs - 1), false);
  assert.equal(routineTaskDue(task, clock, Date.parse(recheckedAt) + task.cadenceMs), true);
  const normal = registrationCandidate({ target, reference, receipt: heldRegistrationReceipt(), previous: delivered });
  assert.notEqual(normal.id, candidate.id, "different replay evidence has a distinct immutable candidate identity");
  const unchanged = await processRegisteredRoutineCandidate(store, target.contractId, normal, replayAt);
  assert.equal(unchanged.promoted?.versionId, candidate.id, unchanged.candidate.failureDetail ?? "");
  assert.equal(unchanged.confirmed?.recheck.id, normal.id);
  assert.equal((await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion)).lastSucceededObservedAt, recheckedAt);
});

test("the current registration parser is due after an immutable /4 temporal refusal without changing the six-hour retry", async () => {
  const { store, target, prior, baseline } = await legacyRegistration();
  const failedAt = "2026-10-10T00:24:00.000Z";
  const failed = { ...baseline, id: `${baseline.id}:failed-v4`, normalization: { ...baseline.normalization, parserVersion: "registration/4" } };
  const currentRefusal = validateRoutineCandidate(baseline, prior, failedAt);
  const refused = { ...currentRefusal, receipt: { ...currentRefusal.receipt, candidateId: failed.id } };
  assert.equal(refused.state, "TEMPORAL_INVALID");
  await store.create({ candidate: failed, state: "FETCHED", acquisitionSucceeded: true, receipt: null,
    promotedVersion: null, lastKnownGoodVersion: prior.candidate.id, failureCode: null, failureDetail: null },
  { candidateId: failed.id, sequence: 1, state: "FETCHED", at: failedAt, detail: "Previous parser held replay." });
  await store.transition(failed.id, "NORMALIZED", failedAt, "Previous parser normalization.");
  const firstFailure = refused.receipt.checks.find(check => check.verdict !== "PASS")!;
  await store.transition(failed.id, refused.state, failedAt, "Older capture refused.", refused.receipt,
    { code: firstFailure.code, detail: firstFailure.detail });
  const task = routineTaskFromContract(requiredRoutineContract(target.contractId));
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastAttemptedAt, undefined);
  assert.equal(clock.lastSucceededParserVersion, "registration/3");
  assert.equal(task.retryMs, 6 * 60 * 60_000);
  assert.equal(routineTaskDue(task, clock, Date.parse(failedAt) + 1), true);
  assert.equal((await store.readCandidate(failed.id))!.state, "TEMPORAL_INVALID", "old failure remains immutable evidence");
});

test("unrelated or altered held evidence still fails the acquisition-time regression guard", async () => {
  const { candidate, prior, reference } = await legacyRegistration();
  const cases: readonly [string, (next: RoutineCandidate, old: CandidateVersionRecord) => void][] = [
    ["wrong predecessor", next => { (next.normalizedPayload as Record<string, unknown>).replayedFromVersionId = "another-version"; }],
    ["wrong archive", next => { (next.normalizedPayload as Record<string, unknown>).sourceSha256 = "a".repeat(64); }],
    ["wrong state reference", next => { (next.normalizedPayload as Record<string, unknown>).referenceSha256 = "b".repeat(64); }],
    ["wrong scope", next => { Object.assign(next, { scope: "US-AZ:registration:v1" }); }],
    ["changed division", next => { ((next.readModel as { divisions: { label: string }[] }).divisions[0]).label = "Changed"; }],
    ["lost native alias", next => { for (const row of (next.readModel as { governments: { aliases: string[] }[] }).governments) row.aliases = []; }],
    ["newly invented check date", next => { Object.assign(next.retrieval.sourceCheck!, { checkedAt: replayAt }); }],
    ["different source vintage", next => { Object.assign(next.temporal, { sourceThrough: "2021" }); }],
    ["unrelated parser", next => { Object.assign(next.normalization, { parserVersion: "another-parser/5" }); }],
    ["prior is not GOOD", (_next, old) => { Object.assign(old, { state: "TEMPORAL_INVALID" }); }],
    ["prior raw evidence differs", (_next, old) => { Object.assign(old.candidate.retrieval, { rawHash: "c".repeat(64) }); }],
    ["valid prior body facts", (_next, old) => { (old.candidate.readModel as { bodies: { homepageUrl: string | null }[] }).bodies[0].homepageUrl = "https://www.nh.gov/"; }],
    ["additional prior body contact", (_next, old) => { Object.assign((old.candidate.readModel as { bodies: unknown[] }).bodies[0]!, { officePhone: "6035550100" }); }],
  ];
  for (const [label, change] of cases) {
    const next = structuredClone(candidate), old = structuredClone(prior);
    change(next, old);
    assert.equal(registrationHeldReplayIsExact(next, old), false, label);
    const result = validateRoutineCandidate(next, old, replayAt);
    assert.equal(result.receipt.checks.find(check => check.check === "TEMPORAL_VALIDITY")?.code, "ACQUISITION_TIME_REGRESSION", label);
  }
  assert.equal(reconcileRegistrationHeldReceipt(heldRegistrationReceipt(), { ...reference, sha256: "d".repeat(64) }, prior).replayedFromVersionId, undefined);
});
