import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { mergeBallotFixture } from "./helpers/ballot-merge.ts";
import { stateBallotContractId, stateBallotScope } from "../lib/ballot/state-scopes.ts";
import { composeBallotOnlyAnswer } from "../lib/ask/ballot-only-answer.ts";
import { promotedEdgeEntryOf } from "../lib/civic-data/read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { readerBallotSourceForTargetId, genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { ballotQuestionShape, composeOfficeField } from "../lib/ask/ballot-summary.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "./helpers/playbooks.ts";
import { parseCivicRecords } from "../lib/control-plane/workers/parser.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { workerBallotContestsPackage } from "../lib/civic-data/worker-ballot-contests.ts";
import { verifiedWorkerRecords } from "../lib/civic-data/worker-publication-evidence.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { ballotElectionKey, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";

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
  const plan = { contract, publication: { contractId: stateBallotContractId("ballot-contests", state), bodyId: "fixture-body" } } as AutonomousWorkPlan;
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
    const published = await processRegisteredManualCandidate(store, stateBallotContractId("ballot-contests", Object.values((candidate.readModel as GenericBallotProjection).ballots)[0].election.state), candidate, now, null);
    assert.ok(published.promoted, JSON.stringify(published.candidate));
    assert.equal(published.readerReadback?.status, "PASS", JSON.stringify(published.readerReadback));
    const read = await readGenericBallotProjection("NH", { store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED"); if (read.kind === "PROMOTED") assert.deepEqual(read.value, payload);
  }
});

test("DC ballots use their registered OCD prefixes through promotion and the reader", async () => {
  for (const [state, prefix] of [["DC", "district:dc/ward:1"]]) {
    const input = fixture(undefined, false, state);
    const ocdId = `ocd-division/country:us/${prefix}`;
    input.registry = { payload: { registry: { divisions: [{ state, label: "Alder County", ocdId, sourceDataset: "TIGER_CB2023" }] } } } as RegistryRuntimePrior;
    const checked = workerBallotContestsPackage(input).package;
    const store = new MemoryRoutineDataStore();
    const promoted = await processRegisteredManualCandidate(store, checked.contractId, manualProjectionCandidate(checked), now, null);
    assert.ok(promoted.promoted, JSON.stringify(promoted.candidate));
    const read = await loadBallotForDivisions([ocdId], { store, now, bypassCache: true });
    assert.equal(read.set?.election.state, state);
    assert.equal(read.contests.length, 2);
    assert.deepEqual(read.loaderFailures, []);
  }
});

test("an omitted or contradicted candidate leaves its contest named while complete contests publish", () => {
  for (const contradict of [false, true]) {
    const input = fixture();
    assert.equal(input.parser.result.role, "PARSER"); if (input.parser.result.role !== "PARSER") return;
    const records = input.parser.result.records;
    input.parser = { ...input.parser, result: { ...input.parser.result,
      records: contradict ? records.map((row, at) => at === 1 ? { ...row, fields: { ...row.fields, candidateName: "Invented Person" } } : row) : records.filter((_, at) => at !== 1),
      spans: contradict ? input.parser.result.spans : input.parser.result.spans.filter(span => span.recordId !== records[1].id) } };
    const checked = workerBallotContestsPackage(input), ballot = Object.values((checked.package.payload as GenericBallotProjection).ballots)[0];
    assert.equal(checked.heldContests.length, 1); assert.equal(ballot.contests.length, 1);
    assert.equal(ballot.heldContests?.[0].title, "School Board");
    assert.deepEqual(ballot.candidacies.map(row => row.familyName), ["Casey Clark"]);
  }
});

test("structured ballot verification retains the full official receipt and rejects a quote from another source row", () => {
  const input = fixture();
  if (input.parser.result.role !== "PARSER") throw new Error("Expected parser fixture");
  const extraction = input.parser.result, first = extraction.records[0], second = extraction.records[1];
  const other = extraction.spans.find(span => span.recordId === second.id && span.field === "election")!;
  input.parser = { ...input.parser, result: { ...extraction, spans: extraction.spans.map(span =>
    span.recordId === first.id && span.field === "election" ? { ...span, start: other.start, end: other.end } : span) } };
  const checked = verifiedWorkerRecords(input);
  assert.deepEqual(checked.heldRecordIds, [first.id]);
  assert.deepEqual(checked.extraction.records.map(record => record.id), extraction.records.slice(1).map(record => record.id));
  assert.equal(checked.sourceReceipt.sources[0].rawHash, input.captures[0].evidence.contentHash.slice(7));
  assert.equal(checked.sourceReceipt.sources[0].finalUrl, input.captures[0].evidence.canonicalUrl);
  assert.equal(checked.sourceReceipt.sources[0].sourceClass, "OFFICIAL_PUBLISHER");
});

test("complete successors replace a contest together and retain unrelated contests with their source receipts", () => {
  const first = workerBallotContestsPackage(fixture()).package;
  const nextInput = fixture(["New Candidate", "Another Candidate", "Casey Clark"]);
  if (nextInput.parser.result.role !== "PARSER") return;
  const omitted = nextInput.parser.result.records[2].id;
  nextInput.parser = { ...nextInput.parser, result: { ...nextInput.parser.result, records: nextInput.parser.result.records.filter((_, at) => at < 2),
    spans: nextInput.parser.result.spans.filter(span => span.recordId !== omitted) } };
  const next = workerBallotContestsPackage(nextInput).package;
  const merged = mergeBallotFixture(next, { versionId: "prior", payload: first.payload, sourceReceipt: first.sourceReceipt });
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
  const published = await processRegisteredManualCandidate(store, stateBallotContractId("ballot-contests", Object.values((candidate.readModel as GenericBallotProjection).ballots)[0].election.state), candidate, now, null);
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
  const source = await readerBallotSourceForTargetId(target, divisions, options);
  assert.ok(source);
  const pageBallot = source.source.normalize(await source.source.fetch());
  assert.deepEqual(pageBallot, read.set);
  assert.deepEqual(genericSourcesForDivisions(checked.payload as GenericBallotProjection,
    ["ocd-division/country:us/state:tx/county:neighbor"]), [], "a nearby county never inherits the contest");
  assert.equal(await readerBallotSourceForTargetId("invented:person", divisions, options), null);
});


test("a direct ballot request serves from its proven edge without unrelated source reads", async () => {
  const checked = workerBallotContestsPackage(fixture(undefined, false, "TX")).package;
  const store = new MemoryRoutineDataStore();
  const published = await processRegisteredManualCandidate(store, checked.contractId, manualProjectionCandidate(checked), now, null);
  assert.ok(published.promoted);
  const read = await readGenericBallotProjection("TX", { store, now });
  const edge = promotedEdgeEntryOf(read, "BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "TX"), store);
  assert.ok(edge);
  const bundle = { promoted: new Map([[`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", "TX")}`, edge]]),
    promotedFamilies: new Set(["ballot-contests"]), edgeOnly: true as const };
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const response = await withReaderAuthorityEdge(bundle, () => POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-forwarded-for": "ballot-direct-fixture" },
    body: JSON.stringify({ question: "Who is running for School Board?", ocdIds: ["ocd-division/country:us/state:tx/county:alder"], today: "2026-10-04", surface: "BALLOT" }),
  })));
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.ok(answer.answer.includes("Alice Adams"));
  assert.ok(answer.answer.includes("Bob Baker"));
  assert.equal(answer.trace.validation.passed, true);
  assert.equal(answer.trace.synthesis.ran, false);
  assert.equal(answer.trace.sourcesLoaded, "ESSENTIAL");
  for (const name of ["funding", "stateMoney", "outcomes", "candidateProfiles", "candidateCorpus", "azPimaFinance", "federalVotes", "meetings"]) {
    assert.equal(answer.trace.preloads[name], undefined, name);
  }
  assert.equal(answer.records.filter((row: { kind: string }) => row.kind === "CANDIDACY").length, 2);
  const ballot = await loadBallotForDivisions(["ocd-division/country:us/state:tx/county:alder"], { store, now, bypassCache: true });
  assert.equal(composeBallotOnlyAnswer(ballot, "Who is running for Unknown Office?", "2026-10-04"), null);
});

test("an incomplete successor keeps independently held candidates from the same contest", () => {
  const first = workerBallotContestsPackage(fixture()).package;
  const next = fixture();
  if (next.parser.result.role !== "PARSER") return;
  const omitted = next.parser.result.records[1].id;
  next.parser = { ...next.parser, result: { ...next.parser.result,
    records: next.parser.result.records.filter(row => row.id !== omitted),
    spans: next.parser.result.spans.filter(row => row.recordId !== omitted) } };
  const successor = workerBallotContestsPackage(next).package;
  const merged = mergeBallotFixture(successor, { versionId: "prior", payload: first.payload, sourceReceipt: first.sourceReceipt });
  const ballot = Object.values((merged.payload as GenericBallotProjection).ballots)[0];
  assert.deepEqual(ballot.candidacies.map(row => row.familyName).sort(), ["Alice Adams", "Bob Baker", "Casey Clark"]);
  assert.equal(ballot.contests.find(row => row.title === "School Board")?.candidateListComplete, true);
});

test("a source's contests update the single working state and capture prior facts before replacing each record", () => {
  const original = workerBallotContestsPackage(fixture()).package;
  const before = Object.values((original.payload as GenericBallotProjection).ballots)[0];
  const oldCandidate = before.candidacies[0], oldContest = before.contests[0];
  oldContest.scopeNote = "Previously held description";
  const updated = workerBallotContestsPackage({ ...fixture(), prior: { versionId: "prior",
    payload: original.payload, sourceReceipt: original.sourceReceipt } });
  const ballot = Object.values((updated.package.payload as GenericBallotProjection).ballots)[0];
  assert.equal(ballot, before);
  assert.equal(ballot.candidacies.find(row => row.id === oldCandidate.id), oldCandidate);
  assert.equal(ballot.contests.find(row => row.id === oldContest.id), oldContest);
  assert.equal(oldContest.scopeNote, null);
  assert.deepEqual(updated.changes.records, { added: 0, changed: 1, reused: 1 });
  const change = updated.changes.recordChanges.find(row => row.recordId === oldContest.id)!;
  assert.equal(change.change, "UPDATED");
  assert.notEqual(change.previousFactsHash, change.factsHash);
  assert.equal(ballot.contests.length, 2); assert.equal(ballot.candidacies.length, 3);
});


test("partial national updates retain every state attachment and remove contacts only with their candidacy", () => {
  for (const state of ["az", "nh", "nj"]) {
    const held = JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8"));
    const prior = { kind: "ballot-contests" as const, ballots: held.ballots };
    const ballot = Object.values(prior.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
    const contest = ballot.contests.find(row => row.type === "CANDIDACY")!;
    const candidacies = ballot.candidacies.filter(row => row.contestId === contest.id);
    const update = { ...ballot, contests: [contest], candidacies, measures: [], absences: [],
      measureRecords: undefined, generalLineup: undefined, measureAnalyses: undefined, filingCandidacies: undefined,
      lineupReconciliation: undefined, contacts: undefined, removals: undefined };
    const fields = ["absences", "removals", "measureRecords", "generalLineup", "measureAnalyses", "filingCandidacies", "lineupReconciliation", "contacts"] as const;
    const expected = new Map(fields.map(key => [key, canonicalCivicDataHash(ballot[key] ?? null)]));
    const input = { contractId: stateBallotContractId("ballot-contests", state), version: "partial", sourceThrough: now,
      sourceReceipt: held.sourceReceipt, payload: { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: update } } };
    const merged = mergeBallotFixture(input, { versionId: "held", payload: prior, sourceReceipt: held.sourceReceipt });
    const result = (merged.payload as GenericBallotProjection).ballots[ballotElectionKey(ballot)];
    for (const key of fields) assert.equal(canonicalCivicDataHash(result[key] ?? null), expected.get(key), `${state}:${key}`);
    assert.ok(merged.sourceReceipt.sources.length <= held.sourceReceipt.sources.length);
    assert.deepEqual(manualProjectionCandidate(merged).semantics.violations, []);
  }
  const first = workerBallotContestsPackage(fixture()).package;
  const previous = Object.values((first.payload as GenericBallotProjection).ballots)[0];
  previous.contacts = previous.candidacies.map(row => ({ candidacyId: row.id, email: "candidate@example.test",
    sourceUrl: row.provenance.sourceUrl!, sourceOrg: "Election authority", collectedAt: now }));
  const retainedContactIds = previous.contacts.filter(contact => previous.candidacies.find(candidate => candidate.id === contact.candidacyId)?.familyName === "Casey Clark")
    .map(row => row.candidacyId);
  const next = workerBallotContestsPackage(fixture(["New Candidate", "Another Candidate", "Casey Clark"])).package;
  const merged = mergeBallotFixture(next, { versionId: "held", payload: first.payload, sourceReceipt: first.sourceReceipt });
  const result = Object.values((merged.payload as GenericBallotProjection).ballots)[0];
  assert.deepEqual(result.contacts?.map(row => row.candidacyId), retainedContactIds);
  assert.deepEqual(manualProjectionCandidate(merged).semantics.violations, []);
});


test("an older worker capture cannot replace a newer complete candidate list", () => {
  const prior = workerBallotContestsPackage(fixture()).package;
  const incoming = workerBallotContestsPackage(fixture(["Previous Candidate", "Another Previous Candidate", "Casey Clark"])).package;
  for (const ballot of Object.values((incoming.payload as GenericBallotProjection).ballots)) {
    for (const row of [...ballot.contests, ...ballot.candidacies]) row.provenance.collectedAt = "2026-09-01T00:00:00.000Z";
  }
  const expected = canonicalCivicDataHash(prior.payload);
  const merged = mergeBallotFixture(incoming, { versionId: "prior", payload: prior.payload, sourceReceipt: prior.sourceReceipt });
  assert.equal(canonicalCivicDataHash(merged.payload), expected);
});

test("supplement rows without their own timestamp follow the exact container's chronology", () => {
  const held = JSON.parse(readFileSync("data/ballot/2026-general/az.json", "utf8"));
  const payload: GenericBallotProjection = { kind: "ballot-contests", ballots: held.ballots };
  const ballot = Object.values(payload.ballots)[0], original = ballot.generalLineup!;
  const expected = canonicalCivicDataHash(original);
  const next = { ...ballot, contests: [], candidacies: [], measures: [], absences: [], generalLineup: {
    ...original, curatedAt: "2020-01-01", contests: [{ ...original.contests[0], nominees: [{ name: "Earlier Nominee", partyLabel: "X", note: null }] }] },
    measureRecords: undefined, filingCandidacies: undefined, contacts: undefined, measureAnalyses: undefined, lineupReconciliation: undefined };
  const input = { contractId: stateBallotContractId("ballot-contests", "AZ"), version: "supplement", sourceThrough: now,
    sourceReceipt: held.sourceReceipt, payload: { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: next } } };
  const older = mergeBallotFixture(input, { versionId: "prior", payload, sourceReceipt: held.sourceReceipt });
  assert.equal(canonicalCivicDataHash(Object.values((older.payload as GenericBallotProjection).ballots)[0].generalLineup), expected);
  next.generalLineup.curatedAt = "2027-01-01";
  next.generalLineup.contests[0].nominees[0].name = "Newer Nominee";
  const newer = mergeBallotFixture(input, { versionId: "older", payload: older.payload, sourceReceipt: older.sourceReceipt });
  const lineup = Object.values((newer.payload as GenericBallotProjection).ballots)[0].generalLineup!;
  assert.equal(lineup.curatedAt, "2027-01-01");
  assert.equal(lineup.contests[0].nominees[0].name, "Newer Nominee");
});

test("successive captures retain only receipt versions cited by current core or supplemental facts", () => {
  const original = workerBallotContestsPackage(fixture()).package;
  const firstBallot = Object.values((original.payload as GenericBallotProjection).ballots)[0];
  const url = firstBallot.contests[0].provenance.sourceUrl!;
  firstBallot.contacts = [{ candidacyId: firstBallot.candidacies[0].id, email: "candidate@example.gov", sourceUrl: url, sourceOrg: "Official election authority",
    collectedAt: firstBallot.contests[0].provenance.collectedAt }];
  const update = structuredClone(original);
  const updatedBallot = Object.values((update.payload as GenericBallotProjection).ballots)[0];
  const firstAt = "2026-10-05T00:00:00.000Z", secondAt = "2026-10-06T00:00:00.000Z";
  for (const row of [...updatedBallot.contests, ...updatedBallot.candidacies]) row.provenance.collectedAt = firstAt;
  updatedBallot.contacts = undefined;
  const firstHash = "b".repeat(64), secondHash = "c".repeat(64);
  const first = mergeBallotFixture({ ...update, sourceThrough: firstAt, sourceReceipt: { ...update.sourceReceipt,
    reviewedAt: firstAt, sources: update.sourceReceipt.sources.map(row => ({ ...row, retrievedAt: firstAt, rawHash: firstHash })) } },
    { versionId: "original", payload: original.payload, sourceReceipt: original.sourceReceipt });
  assert.deepEqual(new Set(first.sourceReceipt.sources.map(row => row.rawHash)), new Set([original.sourceReceipt.sources[0].rawHash, firstHash]),
    "the older contact still cites its original capture after every contest and candidacy advances");
  const contactOnly = { ...updatedBallot, contests: [], candidacies: [],
    contacts: [{ ...firstBallot.contacts[0], email: "current@example.gov", collectedAt: secondAt }] };
  const second = mergeBallotFixture({ ...update, sourceThrough: secondAt, payload: { kind: "ballot-contests",
    ballots: { [ballotElectionKey(contactOnly)]: contactOnly } }, sourceReceipt: { ...update.sourceReceipt,
      reviewedAt: secondAt, sources: update.sourceReceipt.sources.map(row => ({ ...row, retrievedAt: secondAt, rawHash: secondHash })) } },
    { versionId: "first", payload: first.payload, sourceReceipt: first.sourceReceipt });
  assert.deepEqual(new Set(second.sourceReceipt.sources.map(row => row.rawHash)), new Set([firstHash, secondHash]),
    "the uncited original bytes disappear while the current candidate list keeps its older capture");
  const candidate = manualProjectionCandidate(second);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.deepEqual(candidate.normalization.missingRequiredFields, []);
});
