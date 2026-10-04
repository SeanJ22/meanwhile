import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { readerBallotSourceForTargetId, genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { ballotQuestionShape, composeOfficeField } from "../lib/ask/ballot-summary.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseCivicRecords } from "../lib/control-plane/workers/parser.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { mergeBallotContests, workerBallotContestsPackage } from "../lib/civic-data/worker-ballot-contests.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";

const now = "2026-10-04T07:00:00.000Z";
function fixture(names = ["Alice Adams", "Bob Baker", "Casey Clark"], pdf = false, state = "NH") {
  const text = "election,office,jurisdictionName,candidateName\n" + names.map((name, at) =>
    `2026 General Election,${at < 2 ? "School Board" : "Mayor"},Alder County,${name}`).join("\n");
  const evidence: WorkerEvidence = { artifactId: "list", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    text, acquiredByAttemptId: "acquired", canonicalUrl: "https://elections.example.gov/candidates", retrievedAt: now,
    sourceId: "Fixture election authority", methodRouteId: "list", ...(pdf ? { sourceDocument: { artifactId: "pdf", contentHash: `sha256-${"a".repeat(64)}`, kind: "PDF_TEXT" as const } } : {}) };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "BALLOT_CONTEST", subjectId: "fixture:alder",
    jurisdiction: { country: "US", state, canonicalId: "fixture:alder" }, identity: { namespace: "fixture-ballot", keyFields: ["election", "office", "candidateName"] },
    sourceScope: { sourceId: evidence.sourceId, publisher: evidence.sourceId, routeIds: ["list"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["election", "office", "candidateName"], completenessScope: "Every candidate row on this saved fixture list", expectedSourceDate: null,
    extraction: { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: Object.fromEntries(["election", "office", "jurisdictionName", "candidateName"].map((field, index) => [field, { source: index, type: "STRING" as const }])) },
    verification: { required: false, authorities: [] } };
  const worker = { role: "PARSER" as const, instance: "fixture", provider: "deterministic", version: "2" };
  const result = parseCivicRecords({ attemptId: "parsed", worker, evidence, contract });
  assert.equal(result.verdict, "EXTRACTED");
  const parser = { id: "parsed", workItemId: "ballot", endedAt: now, result } as WorkerResultRecord;
  const plan = { contract, publication: { contractId: "ballot-contests", bodyId: "fixture-body" } } as AutonomousWorkPlan;
  const registry = { payload: { registry: { divisions: [{ state, label: "Alder County", ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/county:alder`, sourceDataset: "TIGER_CB2023" }] } } } as RegistryRuntimePrior;
  return { plan, parser, registry, now, captures: [{ evidence, observedAt: now, transport: "REACHABLE", partial: false, httpStatus: 200 }] };
}

test("a saved CSV or PDF text candidate list publishes whole contests into the generic typed Reader", async () => {
  for (const pdf of [false, true]) {
    const input = fixture(undefined, pdf), checked = workerBallotContestsPackage(input);
    assert.deepEqual(checked.heldContests, []);
    const payload = checked.package.payload as GenericBallotProjection;
    const ballot = Object.values(payload.ballots)[0];
    assert.equal(ballot.contests.length, 2); assert.equal(ballot.candidacies.length, 3);
    assert.equal(ballot.contests[0].voteFor, null, "an unrecorded seat count is never guessed");
    if (pdf) assert.equal(checked.package.sourceReceipt.sources[0].rawHash, "a".repeat(64));
    const store = new MemoryRoutineDataStore(), candidate = manualProjectionCandidate(checked.package);
    const published = await processRegisteredManualCandidate(store, "ballot-contests", candidate, now, null);
    assert.ok(published.promoted, JSON.stringify(published.candidate));
    assert.equal(published.readerReadback?.status, "PASS");
    const read = await readGenericBallotProjection({ store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED"); if (read.kind === "PROMOTED") assert.deepEqual(read.value, payload);
  }
});

test("an omitted or contradicted candidate holds its entire contest while a complete neighboring contest publishes", () => {
  for (const contradict of [false, true]) {
    const input = fixture();
    assert.equal(input.parser.result.role, "PARSER"); if (input.parser.result.role !== "PARSER") return;
    const records = input.parser.result.records;
    input.parser = { ...input.parser, result: { ...input.parser.result,
      records: contradict ? records.map((row, at) => at === 1 ? { ...row, fields: { ...row.fields, candidateName: "Invented Person" } } : row) : records.filter((_, at) => at !== 1),
      spans: contradict ? input.parser.result.spans : input.parser.result.spans.filter(span => span.recordId !== records[1].id) } };
    const checked = workerBallotContestsPackage(input), ballot = Object.values((checked.package.payload as GenericBallotProjection).ballots)[0];
    assert.equal(checked.heldContests.length, 1); assert.equal(ballot.contests.length, 1);
    assert.equal(ballot.contests[0].title, "Mayor"); assert.deepEqual(ballot.candidacies.map(row => row.familyName), ["Casey Clark"]);
  }
});

test("complete successors replace a contest together and retain unrelated contests with their source receipts", () => {
  const first = workerBallotContestsPackage(fixture()).package;
  const nextInput = fixture(["New Candidate", "Another Candidate", "Casey Clark"]);
  if (nextInput.parser.result.role !== "PARSER") return;
  const omitted = nextInput.parser.result.records[2].id;
  nextInput.parser = { ...nextInput.parser, result: { ...nextInput.parser.result, records: nextInput.parser.result.records.filter((_, at) => at < 2),
    spans: nextInput.parser.result.spans.filter(span => span.recordId !== omitted) } };
  const next = workerBallotContestsPackage(nextInput).package;
  const merged = mergeBallotContests(next, { versionId: "prior", payload: first.payload, sourceReceipt: first.sourceReceipt });
  const ballot = Object.values((merged.payload as GenericBallotProjection).ballots)[0];
  assert.equal(ballot.contests.length, 2);
  assert.deepEqual(ballot.candidacies.map(row => row.familyName).sort(), ["Another Candidate", "Casey Clark", "New Candidate"]);
  assert.equal(new Set(ballot.candidacies.map(row => row.id)).size, 3);
});


test("a newly published jurisdiction is readable in Ask, the ballot source loop and exact-target intake without a state allowlist", async () => {
  const input = fixture(undefined, false, "TX");
  const checked = workerBallotContestsPackage(input).package;
  const store = new MemoryRoutineDataStore();
  const candidate = manualProjectionCandidate(checked);
  const published = await processRegisteredManualCandidate(store, "ballot-contests", candidate, now, null);
  assert.ok(published.promoted);
  const options = { store, now, bypassCache: true };
  const divisions = ["ocd-division/country:us/state:tx/county:alder"];
  const read = await loadBallotForDivisions(divisions, options);
  assert.equal(read.set?.election.state, "TX");
  assert.equal(read.contests.length, 2);
  assert.deepEqual(read.loaderFailures, []);
  const shape = ballotQuestionShape("Who is running for School Board?", read.contests);
  assert.equal(shape?.kind, "OFFICE");
  if (shape?.kind === "OFFICE") {
    const answer = composeOfficeField({ key: shape.key, phrase: shape.phrase, election: read.set!.election, candidacies: read.set!.candidacies, contests: read.contests, nominees: read.nominees, removedCandidacyIds: new Set() });
    assert.ok(answer?.answer.includes("Alice Adams"));
    assert.ok(answer?.answer.includes("Bob Baker"));
    assert.ok(!answer?.answer.includes("Casey Clark"));
  }
  const target = read.set!.candidacies[0].id;
  const source = await readerBallotSourceForTargetId(target, options);
  assert.ok(source);
  const pageBallot = source.source.normalize(await source.source.fetch());
  assert.deepEqual(pageBallot, read.set);
  assert.deepEqual(genericSourcesForDivisions(checked.payload as GenericBallotProjection,
    ["ocd-division/country:us/state:tx/county:neighbor"]), [], "a nearby county never inherits the contest");
  assert.equal(await readerBallotSourceForTargetId("invented:person", options), null);
});
