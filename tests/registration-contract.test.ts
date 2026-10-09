import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { requiredRoutineContract, ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { routineBaselineOwed, routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { durableRoutineRunnerReceiptIssue, routineReceiptFields } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireRegistrationSource, heldRegistrationReceipt, registrationSourceCheck } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { composeRegistration } from "../lib/registration/compose.ts";
import { REGISTRATION_SOURCE_URL, REGISTRATION_TARGETS, registrationTarget } from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { registrationReferenceFromRelease } from "../lib/registration/source-reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";

const ROOT = join(import.meta.dirname, "..");
const observed = "2026-10-01T12:00:00.000Z";
const input = (state: string) => ({ target: registrationTarget(state), reference: loadRegistrationReference(ROOT, state), receipt: heldRegistrationReceipt() });

test("every state has one ordinary automatic registration contract", () => {
  const contracts = ROUTINE_SOURCE_CONTRACTS.filter(contract => contract.recordClass === "REGISTRATION");
  assert.deepEqual(contracts.map(contract => contract.id), REGISTRATION_TARGETS.map(target => target.contractId));
  assert.equal(contracts.length, 56);
  assert.ok(contracts.every(contract => contract.acquisitionAdapter.authorityMode === "REGISTERED_SOURCE_ROUTES"));
  assert.ok(contracts.every(contract => contract.cadence.defaultEveryMs === 90 * 86400000));
});

test("held native listings promote and read independently; a replay keeps their source date and accepted version", async () => {
  const store = new MemoryRoutineDataStore(), args = input("NH");
  const first = registrationCandidate(args);
  const outcome = await processRegisteredRoutineCandidate(store, args.target.contractId, first, observed);
  assert.equal(outcome.promoted?.versionId, first.id, outcome.candidate.failureDetail ?? "");
  const read = await readRegistrationProjection("NH", { store, now: observed, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  const model = read.value as RegistrationReadModel;
  assert.equal(model.bodies.length, 0);
  assert.ok(model.governments!.some(row => row.kind === "EDUCATION_AGENCY"));
  assert.ok(model.governments!.some(row => row.kind === "DEPENDENT_SCHOOL_SYSTEM"));
  assert.ok(model.governments!.some(row => row.associations.length === 0 && row.name));
  const second = registrationCandidate({ ...args, receipt: { ...args.receipt, checkedAt: observed } });
  const replay = await processRegisteredRoutineCandidate(store, args.target.contractId, second, observed);
  assert.equal(replay.promoted?.versionId, first.id);
  assert.equal(second.retrieval.retrievedAt, "2026-09-23T00:00:00.000Z");
  assert.equal(second.retrieval.sourceCheck?.checkedAt, "2026-09-23T00:00:00.000Z");
});

async function registrationWithPreviousParser() {
  const store = new MemoryRoutineDataStore(), args = input("NH");
  const next = registrationCandidate(args);
  const previous = { ...next, id: `${next.id}:previous-parser`,
    normalization: { ...next.normalization, parserVersion: "registration/3" } };
  const validated = validateRoutineCandidate(next, null, observed);
  assert.equal(validated.state, "VALIDATED");
  const receipt = { ...validated.receipt, candidateId: previous.id };
  await store.create({ candidate: previous, state: "FETCHED", acquisitionSucceeded: true, receipt: null,
    promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
  { candidateId: previous.id, sequence: 1, state: "FETCHED", at: observed, detail: "Historical source acquisition." });
  await store.transition(previous.id, "NORMALIZED", observed, "Historical normalization.");
  await store.transition(previous.id, "VALIDATED", observed, "Historical GOOD.", receipt);
  await store.promote(previous.id, receipt, observed);
  const task = routineTaskFromContract(requiredRoutineContract(args.target.contractId));
  return { store, args, previous, next, task };
}

test("registration/4 replays the held release immediately after registration/3 GOOD, then keeps the 90-day source clock", async () => {
  const { store, args, previous, next, task } = await registrationWithPreviousParser();
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastSucceededParserVersion, "registration/3");
  assert.equal(clock.lastAttemptedAt, undefined, "the old parser has not attempted this implementation");
  assert.equal(clock.lastSucceededAt, previous.retrieval.retrievedAt);
  assert.equal(routineBaselineOwed(task, clock), true);
  assert.equal(routineTaskDue(task, clock, Date.parse(observed)), true);
  assert.equal((await readRegistrationProjection("NH", { store, now: observed, bypassCache: true })).kind, "PROMOTED",
    "the prior GOOD stays readable while its held evidence awaits reparse");
  const result = await processRegisteredRoutineCandidate(store, args.target.contractId, next, observed);
  assert.equal(result.promoted?.versionId, next.id, result.candidate.failureDetail ?? "");
  const replayed = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(replayed.lastSucceededParserVersion, task.parserVersion);
  assert.equal(replayed.lastSucceededAt, clock.lastSucceededAt);
  assert.equal(replayed.lastSucceededObservedAt, clock.lastSucceededObservedAt, "reprocessing does not manufacture a publisher check");
  assert.equal(routineBaselineOwed(task, replayed), false);
  const nextCheck = Date.parse(replayed.lastSucceededObservedAt!) + 90 * 86400000;
  assert.equal(routineTaskDue(task, replayed, nextCheck - 1), false);
  assert.equal(routineTaskDue(task, replayed, nextCheck), true);
});

test("a failed current-parser registration attempt keeps the prior GOOD and its existing six-hour retry", async () => {
  const { store, args, previous, task } = await registrationWithPreviousParser();
  const failedAt = "2026-10-01T13:00:00.000Z";
  await recordRegisteredSourceAcquisitionFailure({ store, contractId: args.target.contractId, attemptedAt: failedAt,
    requestedUrl: REGISTRATION_SOURCE_URL, failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Census unavailable.") });
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastSucceededParserVersion, "registration/3");
  assert.equal(clock.lastAttemptedAt, failedAt);
  assert.equal((await store.readPromotionIdentity(task.recordClass, task.scope))?.versionId, previous.id);
  assert.equal(routineTaskDue(task, clock, Date.parse(failedAt) + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, clock, Date.parse(failedAt) + task.retryMs), true);
});

test("registration held replay and independent school delivery do not erase a later source failure or delay its retry", async () => {
  const store = new MemoryRoutineDataStore(), args = input("NH");
  const first = registrationCandidate(args);
  await processRegisteredRoutineCandidate(store, args.target.contractId, first, observed);
  const failedAt = "2026-10-01T13:00:00.000Z", replayAt = "2026-10-01T14:00:00.000Z";
  await recordRegisteredSourceAcquisitionFailure({ store, contractId: args.target.contractId, attemptedAt: failedAt,
    requestedUrl: REGISTRATION_SOURCE_URL,
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Census release timed out.") });
  const failedClock = await store.clock(first.sourceId, first.recordClass, first.scope);
  await processRegisteredRoutineCandidate(store, args.target.contractId, registrationCandidate(args), replayAt);
  assert.deepEqual(await store.clock(first.sourceId, first.recordClass, first.scope), failedClock);

  const schoolCheck = { requestedUrl: "https://nces.ed.gov/ccd/Data/ccd_lea_029_2526.zip", finalUrl: "https://nces.ed.gov/ccd/Data/ccd_lea_029_2526.zip",
    httpStatus: 200 as const, rawHash: "b".repeat(64), checkedAt: replayAt };
  const listings = referenceGovernmentListings(args.reference).map(row => row.kind === "EDUCATION_AGENCY"
    ? { ...row, officePhone: "6035550100" } : row);
  const delivered = registrationCandidate({ ...args, reference: { ...args.reference, listings },
    receipt: { ...args.receipt, sourceCheck: registrationSourceCheck(args.receipt, [schoolCheck]) } });
  const outcome = await processRegisteredRoutineCandidate(store, args.target.contractId, delivered, replayAt);
  assert.equal(outcome.promoted?.versionId, delivered.id, outcome.candidate.failureDetail ?? "");
  const clock = await store.clock(first.sourceId, first.recordClass, first.scope);
  assert.deepEqual(clock, failedClock, "newly delivered school facts retain the failed Census check and its retry");
  const task = routineTaskFromContract(requiredRoutineContract(args.target.contractId));
  assert.equal(routineTaskDue(task, clock, Date.parse(failedAt) + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, clock, Date.parse(failedAt) + task.retryMs), true);
  const finalFailure = await recordRegisteredSourceAcquisitionFailure({ store, contractId: args.target.contractId, attemptedAt: "2026-10-01T14:00:01.000Z",
    requestedUrl: REGISTRATION_SOURCE_URL,
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Census release remains unavailable.") });
  assert.equal(finalFailure.receipt.lastKnownGoodVersion, delivered.id);
  assert.equal(await durableRoutineRunnerReceiptIssue(finalFailure.receipt, task, store, "HELD"), null);
});

test("the oldest acquired input check can be NCES; unchanged delivery receipts name the pointed version", async () => {
  const store = new MemoryRoutineDataStore(), args = input("NH");
  const ncesCheck = { requestedUrl: "https://nces.ed.gov/ccd/Data/ccd_lea_029_2526.zip", finalUrl: "https://nces.ed.gov/ccd/Data/ccd_lea_029_2526.zip",
    httpStatus: 304 as const, rawHash: "b".repeat(64), checkedAt: "2026-09-24T00:00:00.000Z" };
  const receipt = { ...args.receipt, sourceCheck: { ...args.receipt.sourceCheck!, checkedAt: "2026-09-25T00:00:00.000Z" } };
  const oldest = registrationSourceCheck(receipt, [ncesCheck]);
  assert.deepEqual(oldest, ncesCheck);
  const first = registrationCandidate({ ...args, receipt: { ...receipt, sourceCheck: oldest } });
  assert.equal(validateRoutineCandidate(first, null, observed).state, "VALIDATED");
  await processRegisteredRoutineCandidate(store, args.target.contractId, first, observed);
  const proposal = { ...first, id: `${first.id}-new-envelope`, retrieval: { ...first.retrieval, rawHash: "c".repeat(64) } };
  const outcome = await processRegisteredRoutineCandidate(store, args.target.contractId, proposal, "2026-10-01T13:00:00.000Z");
  assert.equal(outcome.confirmed?.versionId, first.id);
  assert.equal(await store.readCandidateSummary(proposal.id), null);
  const fields = { source: args.target.contractId, ...routineReceiptFields(proposal, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
  assert.equal(fields.candidateId, first.id);
  assert.equal(fields.confirmedAt, outcome.confirmed?.at);
  assert.equal(await durableRoutineRunnerReceiptIssue(fields, routineTaskFromContract(requiredRoutineContract(args.target.contractId)), store, "SUCCESS"), null);
  const schoolFailure = await recordRegisteredSourceAcquisitionFailure({ store, contractId: args.target.contractId,
    requestedUrl: ncesCheck.requestedUrl, attemptedAt: "2026-10-01T14:00:00.000Z",
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "NCES archive timed out.") });
  assert.equal(schoolFailure.outcome.candidate.candidate.retrieval.requestedUrl, ncesCheck.requestedUrl);
  assert.equal(schoolFailure.receipt.lastKnownGoodVersion, first.id);
  const task = routineTaskFromContract(requiredRoutineContract(args.target.contractId));
  assert.equal(await durableRoutineRunnerReceiptIssue(schoolFailure.receipt, task, store, "HELD"), null);
  const failedClock = await store.clock(first.sourceId, first.recordClass, first.scope);
  await processRegisteredRoutineCandidate(store, args.target.contractId, proposal, "2026-10-01T15:00:00.000Z");
  assert.deepEqual(await store.clock(first.sourceId, first.recordClass, first.scope), failedClock);
  assert.equal(routineTaskDue(task, failedClock, Date.parse("2026-10-01T14:00:00.000Z") + task.retryMs), true);
});

test("different native governments sharing a geometry stay separate; reviewed bodies bind only by native ID", () => {
  const args = input("NJ"), reference = args.reference;
  const source = reference.reference.governments.find(row => row[3] === "COUNTY")!;
  const other = ["999999", "nj:county:separate-government", "SEPARATE GOVERNMENT", source[3], source[4], source[5], source[6]] as const;
  const model = registrationCandidate({ ...args, reference: { ...reference, reference: { ...reference.reference, governments: [...reference.reference.governments, other] } } }).readModel as RegistrationReadModel;
  const first = model.governments!.find(row => row.nativeIds.census_pid6 === source[0])!;
  const second = model.governments!.find(row => row.nativeIds.census_pid6 === other[0])!;
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.associations, second.associations);
  const layer = composeRegistration({ divisions: [], bodies: [{ id: "reviewed-county-board", ocdId: first.associations[0].divisionId, censusId: source[0] }] }, model, "native-reg");
  assert.deepEqual(layer.governments.find(row => row.id === first.id)?.bodyIds, ["reviewed-county-board"]);
  assert.deepEqual(layer.governments.find(row => row.id === second.id)?.bodyIds, []);
});

test("a migration keeps old durable body aliases while retiring inventory-created boards", () => {
  const args = input("OH");
  const initial = registrationCandidate(args).readModel as RegistrationReadModel;
  const government = initial.governments!.find(row => row.nativeIds.census_pid6)!;
  const previous = { ...initial, governments: undefined, bodies: [{ id: "legacy-body", censusId: government.nativeIds.census_pid6 }] } as unknown as RegistrationReadModel;
  const migrated = registrationCandidate({ ...args, previous }).readModel as RegistrationReadModel;
  assert.ok(migrated.governments!.find(row => row.id === government.id)?.aliases.includes("legacy-body"));
  assert.equal(migrated.bodies.length, 0);
});

test("all held states validate, retain names and native IDs, and never infer a board from an inventory", () => {
  for (const target of REGISTRATION_TARGETS) {
    const candidate = registrationCandidate(input(target.state));
    const result = validateRoutineCandidate(candidate, null, observed);
    assert.equal(result.state, "VALIDATED", `${target.state}: ${JSON.stringify(result.receipt.checks.filter(check => check.verdict !== "PASS"))}`);
    const model = candidate.readModel as RegistrationReadModel;
    assert.equal(model.bodies.length, 0);
    assert.equal(new Set(model.governments!.map(row => row.id)).size, model.governments!.length);
    assert.ok(model.governments!.every(row => row.name && Object.keys(row.nativeIds).length));
  }
});

test("changed valid release bytes are parsed and a failed update preserves the exact held release", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let now = new Date("2026-01-01T00:00:00Z"), calls = 0;
  const government = input("OH").reference.reference.governments.find(row => row[3] === "COUNTY")!;
  const archive = (name: string) => zip([{ name: "government.csv", data: Buffer.from(`PID6,UNIT_NAME,GOV_TYPE,FIPS_STATE,FIPS_COUNTY,STATE\n${government[0]},${name},COUNTY,39,001,OH\n`) }], "2026-01-01");
  let body: Buffer = archive("OLD NAME");
  const options = { signal: AbortSignal.timeout(10000), store, locks, now: () => now,
    readHeld: async () => null, fetchImpl: (async () => { calls++; return new Response(new Uint8Array(body), { headers: { "content-type": "application/zip", etag: `"${calls}"` } }); }) as typeof fetch };
  const first = await acquireRegistrationSource(options);
  await acquireRegistrationSource(options);
  assert.equal(calls, 1, "state consumers share the national release");
  now = new Date("2026-05-01T00:00:00Z"); body = archive("NEW NAME");
  const changed = await acquireRegistrationSource(options);
  assert.notEqual(changed.sha256, first.sha256);
  const updated = registrationReferenceFromRelease(input("OH").reference, changed.release!);
  assert.equal(updated.listings?.find(row => row.nativeIds.census_pid6 === government[0])?.name, "NEW NAME");
  assert.ok(updated.reference.governments.length > 1000, "missing source classes retain their prior evidence");
  now = new Date("2026-09-01T00:00:00Z"); body = Buffer.from("truncated");
  await assert.rejects(acquireRegistrationSource(options), /could not be acquired or decoded/);
  now = new Date("2026-05-02T00:00:00Z");
  assert.equal((await acquireRegistrationSource(options)).sha256, changed.sha256);
});

test("a raw 304 cannot be used as civic source bytes", () => {
  const args = input("NH");
  const candidate = registrationCandidate({ ...args, receipt: { ...args.receipt, httpStatus: 304 } });
  assert.equal(validateRoutineCandidate(candidate, null, observed).state, "SOURCE_BLOCKED");
});
