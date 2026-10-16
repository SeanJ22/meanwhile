import { manualPriorAuthorityIssue } from "../lib/civic-data/manual-prior-authority.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { candidateChangeSet, civicRecordsFor, rowKeyedCivicRecordsFor, ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "../lib/civic-data/changes.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication-prior.ts";
import { trustedLkgCandidateEnvelopeSha256, trustedLkgCandidateId, trustedLkgImportEvidenceIssue, trustedLkgImportUrl, trustedLkgValidatorIds } from "../lib/civic-data/trusted-lkg-import.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "../lib/civic-data/types.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { stateBallotScope } from "../lib/ballot/state-scopes.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { CandidateCorpus, CandidateDocument } from "../lib/candidates/corpus.ts";
import { measureRecordsForBallot, type MeasureRecord } from "../lib/ballot/measure-records.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import { type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  manualProjectionCandidate,
  readManualProjectionPrior,
  type ManualProjectionContractId,
  type ManualProjectionPackage,
  type CandidateProfilesProjection,
} from "../lib/civic-data/manual-projections.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceProjectionEvidence, type ManualSourceClass, type ManualSourceSetReceipt } from "../lib/civic-data/types.ts";

const ROOT = process.cwd();
const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";
const T2 = "2026-09-08T12:02:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const URL = "https://elections.example.gov/reviewed-source";

function receipt(at: string, sourceClass: ManualSourceClass, rawHash: string): ManualSourceSetReceipt {
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "owner-test",
    sources: [{
      requestedUrl: URL,
      finalUrl: URL,
      publisher: "Named primary publisher",
      sourceClass,
      retrievedAt: at,
      httpStatus: 200,
      rawHash,
      reviewedEvidence: "Exact response bytes and normalized projection reviewed together.",
    }],
  };
}

function candidateDocument(candidateKey: string, documentUrl: string, contentHash: string, at: string): CandidateDocument {
  const text = `Candidate-authored publication ${contentHash.slice(0, 8)}.`;
  const normalizedTextHash = createHash("sha256").update(text).digest("hex");
  return {
    id: `${candidateKey}@${normalizedTextHash}`,
    candidateKey,
    sourceClass: "CAMPAIGN_SITE",
    basis: "HUNTED_AND_VERIFIED",
    metaDescription: null,
    documentUrl,
    contentHash: normalizedTextHash,
    retrievedAt: at,
    contentType: "text/html; charset=utf-8",
    text,
    extraction: "html",
    extractionNote: null,
  };
}

function candidateCorpusPackage(documents: readonly CandidateDocument[], at: string): ManualProjectionPackage {
  return {
    contractId: "candidate-corpus:AZ",
    version: at,
    sourceThrough: at,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: at,
      reviewedBy: "owner-test",
      sources: documents.map((document) => ({
        requestedUrl: document.documentUrl,
        finalUrl: document.documentUrl,
        publisher: "Named candidate primary publisher",
        sourceClass: "CANDIDATE_CONTROLLED",
        retrievedAt: document.retrievedAt,
        httpStatus: 200,
        rawHash: document.contentHash,
        reviewedEvidence: "Exact candidate publication bytes and normalized document reviewed together.",
      })),
    },
    payload: {
      formatVersion: 1,
      fetchedAt: at,
      attempted: documents.length,
      documents: [...documents],
      failures: [],
    } satisfies CandidateCorpus,
  };
}

function ballotPayload(state: "AZ" | "NH", familyName = "DOE") {
  const prefix = state.toLowerCase();
  const contestId = `ballot-${prefix}-test:office`;
  const candidacyId = `${contestId}:jane-doe`;
  const provenance = { sourceUrl: URL, retrievedAt: T0, note: "reviewed test evidence" };
  const ballot = {
    formatVersion: 1,
    curatedAt: T0,
    election: { id: `${prefix}-2026`, state, date: "2026-11-03", label: "2026 general election" },
    contests: [{
      id: contestId,
      electionId: `${prefix}-2026`,
      ocdId: `ocd-division/country:us/state:${prefix}`,
      divisionVintage: "2020",
      title: "Test office",
      type: "CANDIDACY",
      voteFor: 1,
      provenance,
    }],
    candidacies: [{
      id: candidacyId,
      contestId,
      givenName: "Jane",
      familyName,
      partyLabel: null,
      slogan: null,
      incumbent: false,
      provenance,
    }],
    measures: [],
    absences: [],
    coverageNotes: [],
  };
  return { kind: "ballot-contests", ballots: { [`${state}:${ballot.election.id}`]: ballot } };
}

function packageFor(
  contractId: ManualProjectionContractId,
  at = T0,
  rawHash = HASH_A,
  familyName = "DOE",
): ManualProjectionPackage {
  if (contractId === "ballot-contests:NH") {
    return {
      contractId,
      version: "2026-11-03",
      sourceThrough: at,
      sourceReceipt: receipt(at, "ELECTION_AUTHORITY", rawHash),
      payload: ballotPayload("NH", familyName),
    } as unknown as ManualProjectionPackage;
  }
  if (contractId === "candidate-profiles:AZ") {
    return {
      contractId,
      version: at,
      sourceThrough: at,
      sourceReceipt: receipt(at, "CANDIDATE_CONTROLLED", rawHash),
      payload: {
        cards: { curatedAt: at, note: "reviewed", cards: { "ballot-az-test:jane-doe": {} }, hunts: [] },
        links: { curatedAt: at, note: "reviewed", links: { "ballot-az-test:jane-doe": {} }, hunts: [] },
      },
    } as unknown as ManualProjectionPackage;
  }
  const text = `Candidate-authored publication ${rawHash.slice(0, 8)}.`;
  const normalizedTextHash = createHash("sha256").update(text).digest("hex");
  return {
    contractId,
    version: at,
    sourceThrough: at,
    sourceReceipt: receipt(at, "CANDIDATE_CONTROLLED", normalizedTextHash),
    payload: {
      formatVersion: 1,
      fetchedAt: at,
      attempted: 1,
      documents: [{
        id: `ballot-az-test:jane-doe@${normalizedTextHash}`,
        candidateKey: "ballot-az-test:jane-doe",
        sourceClass: "CAMPAIGN_SITE",
        basis: "HUNTED_AND_VERIFIED",
        metaDescription: null,
        documentUrl: URL,
        contentHash: normalizedTextHash,
        retrievedAt: at,
        contentType: "text/html; charset=utf-8",
        text,
        extraction: "html",
        extractionNote: null,
      }],
      failures: [],
    },
  } as unknown as ManualProjectionPackage;
}

test("national ballot and candidate authorities promote through the canonical candidate/event/pointer plane", async () => {
  const store = new MemoryRoutineDataStore();
  for (const id of ["ballot-contests:NH", "candidate-profiles:AZ", "candidate-corpus:AZ"] as const) {
    const candidate = manualProjectionCandidate(packageFor(id));
    const outcome = await processRegisteredManualCandidate(store, id, candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.equal(outcome.candidate.receipt?.decision, "GOOD", id);
    assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify({ id, readback: outcome.readerReadback }));
    assert.deepEqual((await store.events(candidate.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  }

  const reads = await Promise.all([
    readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NH"), { store, bypassCache: true, now: T0 }),
    readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", "AZ"), { store, bypassCache: true, now: T0 }),
    readPromotedCivicData<CandidateCorpus>("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", "AZ"), { store, bypassCache: true, now: T0 }),
  ]);
  assert.deepEqual(reads.map((read) => read.kind), ["PROMOTED", "PROMOTED", "PROMOTED"]);
});

test("measure records survive civic-data promotion and change without a software release", async () => {
  const store = new MemoryRoutineDataStore();
  const original = packageFor("ballot-contests:NH");
  const payload = structuredClone(original.payload) as GenericBallotProjection;
  const contest = { ...payload.ballots["NH:nh-2026"].contests[0]!, id: "ballot-nh-test:measure", type: "MEASURE" as const };
  payload.ballots["NH:nh-2026"].contests.push(contest);
  payload.ballots["NH:nh-2026"].measures.push({ id: "measure:test", contestId: contest.id, questionText: "Create a program?", officialStatement: null, provenance: contest.provenance });
  const record: MeasureRecord = { contestId: contest.id, whatItDoes: "Creates a program.",
    yesMeans: null, noMeans: null, parts: [], sourceUrl: URL, sourceHash: HASH_A, writtenAt: T0 };
  for (const [at, whatItDoes] of [[T0, "Creates a program."], [T1, "Changes the program."]] as const) {
    const input = { ...original, sourceThrough: at, sourceReceipt: receipt(at, "ELECTION_AUTHORITY", HASH_A),
      payload: { ...payload, ballots: { ...payload.ballots, "NH:nh-2026": { ...payload.ballots["NH:nh-2026"], measureRecords: [{ ...record, whatItDoes }] } } } };
    const candidate = manualProjectionCandidate(input);
    const published = await processRegisteredManualCandidate(store, "ballot-contests:NH", candidate, at);
    assert.equal(published.candidate.state, "PROMOTED");
    const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NH"), { store, now: at, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    assert.ok(read.value);
    assert.equal(summaryForContest(contest.id, measureRecordsForBallot(read.value.ballots["NH:nh-2026"]))?.summary, whatItDoes);
    assert.ok(candidate.civicRecords?.some(row => row.key === `measure-record:${contest.id}`));
  }
});

test("a changed ballot yields an exact record delta; a bad successor is held and cannot erase LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(packageFor("ballot-contests:NH"));
  await processRegisteredManualCandidate(store, "ballot-contests:NH", first, T0);

  const changed = manualProjectionCandidate(packageFor("ballot-contests:NH", T1, HASH_B, "ROE"));
  const promoted = await processRegisteredManualCandidate(store, "ballot-contests:NH", changed, T1);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.deepEqual(promoted.candidate.candidate.changeSet?.changed.map((record) => record.key), ["candidacy:ballot-nh-test:office:jane-doe"]);

  const brokenPackage = structuredClone(packageFor("ballot-contests:NH", T2, "c".repeat(64), "BAD"));
  const brokenPayload = brokenPackage.payload as unknown as ReturnType<typeof ballotPayload>;
  brokenPayload.ballots["NH:nh-2026"].candidacies[0].contestId = "missing-contest";
  const broken = manualProjectionCandidate(brokenPackage);
  const refused = await processRegisteredManualCandidate(store, "ballot-contests:NH", broken, T2);
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal((await store.readPromotion("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NH")))?.versionId, changed.id);
});

test("one candidate-publication receipt mismatch cannot hold an unrelated exact document version", async () => {
  const store = new MemoryRoutineDataStore();
  const firstUrl = "https://one.example.campaign/issues";
  const secondUrl = "https://two.example.campaign/issues";
  const firstDocs = [
    candidateDocument("ballot-az-test:one", firstUrl, HASH_A, T0),
    candidateDocument("ballot-az-test:two", secondUrl, HASH_B, T0),
  ];
  const first = manualProjectionCandidate(candidateCorpusPackage(firstDocs, T0));
  await processRegisteredManualCandidate(store, "candidate-corpus:AZ", first, T0, null);

  const validNew = candidateDocument("ballot-az-test:one", firstUrl, HASH_C, T1);
  const mismatchedNew = candidateDocument("ballot-az-test:two", secondUrl, HASH_D, T1);
  const attemptedBase = candidateCorpusPackage([validNew, mismatchedNew], T1);
  const attempted: ManualProjectionPackage = {
    ...attemptedBase,
    sourceReceipt: {
      ...attemptedBase.sourceReceipt,
      sources: attemptedBase.sourceReceipt.sources.map((source) => source.finalUrl === secondUrl
        ? { ...source, rawHash: "e".repeat(64) }
        : source),
    },
  };
  const next = manualProjectionCandidate(attempted, {
    prior: {
      versionId: first.id,
      payload: first.readModel as CandidateCorpus,
      sourceReceipt: first.retrieval.manualSourceReceipt!,
    },
  });
  const outcome = await processRegisteredManualCandidate(store, "candidate-corpus:AZ", next, T1, first.id);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, []);
  assert.ok(outcome.candidate.candidate.changeSet?.added.some(({ key }) => key === `document:${validNew.id}`));
  assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `document:${mismatchedNew.id}` && fact.code === "MANUAL_MEMBER_INVALID"
  ));
  const promoted = outcome.promoted!.payload as CandidateCorpus;
  assert.ok(promoted.documents.some((document) => document.id === validNew.id));
  assert.ok(promoted.documents.some((document) => document.id === firstDocs[1]!.id));
  assert.ok(!promoted.documents.some((document) => document.id === mismatchedNew.id));
});

test("candidate-publication admission refuses a content hash that does not identify the normalized text", async () => {
  const input = packageFor("candidate-corpus:AZ");
  const payload = structuredClone(input.payload) as CandidateCorpus;
  payload.documents[0]!.text = "Different normalized words with the old content identity.";
  const candidate = manualProjectionCandidate({ ...input, payload });
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-corpus:AZ",
    candidate,
    T0,
  );
  assert.equal(outcome.promoted, null);
  assert.notEqual(outcome.candidate.receipt?.decision, "GOOD");
});

test("manual Reader proof is bound to the exact source, class, and scope", async () => {
  const candidate = manualProjectionCandidate(packageFor("candidate-profiles:AZ"));
  const mismatched = {
    ...candidate,
    id: `${candidate.id}-wrong-projection-proof`,
    sourceProjectionEvidence: sourceProjectionEvidence(
      candidate.sourceId,
      candidate.recordClass,
      "US-AZ:wrong-scope",
    ),
  };
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-profiles:AZ",
    mismatched,
    T0,
  );
  assert.equal(outcome.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(
    outcome.candidate.receipt?.checks.find((check) => check.check === "DEPENDENT_READ_MODEL_VALIDITY")?.code,
    "DEPENDENT_EVIDENCE_SCOPE_MISMATCH",
  );
  assert.equal(outcome.promoted, null);
});

test("store failure never opens a bundled ballot/profile/corpus seed", async () => {
  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const reads = await Promise.all([
    readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NH"), { store: brokenStore, bypassCache: true }),
    readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", "AZ"), { store: brokenStore, bypassCache: true }),
    readPromotedCivicData<CandidateCorpus>("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", "AZ"), { store: brokenStore, bypassCache: true }),
  ]);
  assert.ok(reads.every((read) => read.kind === "STORE_UNREACHABLE"));
  assert.equal(candidateReads, 0);


});

test("manual authorities have no clock and Admin reuses the canonical outcome projection", () => {
  const ids = new Set(["ballot-contests:NH", "candidate-profiles:AZ", "candidate-corpus:AZ"]);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.equal(contracts.length, 3);
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY"));
  assert.ok(contracts.every((contract) => !("cadence" in contract) && !("retry" in contract)));
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, T0, contracts);
  assert.ok(view.contracts.every((row) => row.cadence.clock === "MANUAL"));
  assert.ok(view.contracts.every((row) => row.cadence.nextDue.kind === "NOT_APPLICABLE"));
});

test("tracked writers and alternate Reader doors stay retired", () => {
  for (const path of [
    "scripts/acquire-az-sos-candidate-filings.mts",
    "scripts/ballot-az-pima-2026-update.mts",
    "scripts/fetch-candidate-corpus.mts",
    "scripts/fetch-measure-analyses.mts",
    "scripts/identity-az-2026.mts",
    "scripts/ship-candidate-field.mts",
    "scripts/wire-campaign-sites-0823.mts",
  ]) assert.equal(existsSync(join(ROOT, path)), false, path);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const command of ["acquire:az-sos-candidates", "ballot:az-pima-update", "candidates:fetch", "identity:az", "ship:candidate", "wire:0825", "wire:phones"]) {
    assert.equal(pkg.scripts[command], undefined, command);
  }

  for (const path of [
    "lib/ballot/candidate-targets.ts",
    "lib/ballot/uncontested.ts",
    "lib/questionnaire/candidacy-display.ts",
    "lib/ballot/candidate-cards.ts",
    "lib/ballot/candidate-sites.ts",
    "lib/candidates/positions.ts",
  ]) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.doesNotMatch(source, /readFile(?:Sync)?\s*\(/, `${path} reopened a tracked runtime authority`);
  }
  const promoter = readFileSync(join(ROOT, "scripts/promote-manual-civic-projection.mts"), "utf8");
  assert.doesNotMatch(promoter, /\b(?:writeFileSync|appendFileSync|execSync|spawnSync)\s*\(/);
  assert.match(promoter, /MANUAL_PROMOTION_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY/);
});


test("state candidate publications bind generated worker IDs and reject another state's explicit IDs", () => {
  const key = `ballot-candidacy:${"a".repeat(24)}`;
  const candidate = manualProjectionCandidate(candidateCorpusPackage([candidateDocument(key, URL, HASH_A, T0)], T0));
  assert.deepEqual(candidate.semantics.violations, []);
  assert.deepEqual(candidate.normalization.missingRequiredFields, []);
  assert.ok(candidate.identities.every(row => row.jurisdiction === "US-AZ"));
  const otherState = manualProjectionCandidate(candidateCorpusPackage([candidateDocument("ballot-nh-test:jane-doe", URL, HASH_A, T0)], T0));
  assert.ok(otherState.semantics.violations.length > 0);
});

function importedManualProjection(input: ManualProjectionPackage) {
  const payload = input.payload;
  const original = JSON.parse(readFileSync(new globalThis.URL("./fixtures/retained-venue-import.json", import.meta.url), "utf8")) as {
    record: CandidateVersionRecord; projection: PromotedProjection;
  };
  const built = manualProjectionCandidate(input);
  const civicRecords = rowKeyedCivicRecordsFor(built.recordClass, payload);
  const digest = canonicalCivicDataHash(payload);
  let candidate: RoutineCandidate = withStateRecordHashes({ ...built, readModel: payload, normalizedPayload: payload, civicRecords,
    retrieval: { ...original.record.candidate.retrieval, requestedUrl: trustedLkgImportUrl(input.contractId) },
    temporal: { ...original.record.candidate.temporal },
    normalization: { ...built.normalization, normalizedHash: digest, normalizedPayloadHash: digest,
      inputRecords: civicRecords.length, outputRecords: civicRecords.length, droppedRecords: 0 },
    semantics: { ...built.semantics, violations: [] }, excludedFacts: [],
    horizon: { ...built.horizon, returnedRecords: civicRecords.length },
  });
  const evidence = { ...original.record.candidate.bootstrapImport!, contractId: input.contractId,
    sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope,
    parserVersion: candidate.normalization.parserVersion, normalizedPayloadSha256: digest, readModelSha256: digest,
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate), validatorIds: trustedLkgValidatorIds(candidate) };
  candidate = { ...candidate, bootstrapImport: evidence, id: trustedLkgCandidateId(evidence),
    changeSet: candidateChangeSet(candidate, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT) };
  assert.equal(trustedLkgImportEvidenceIssue(candidate, null), null);
  const proof = { ...original.record.receipt!, candidateId: candidate.id, sourceId: candidate.sourceId,
    recordClass: candidate.recordClass, scope: candidate.scope };
  const record = { ...original.record, candidate, receipt: proof, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id };
  const projection = { ...original.projection, key: `${candidate.recordClass}:${candidate.scope}`, recordClass: candidate.recordClass,
    sourceId: candidate.sourceId, scope: candidate.scope, versionId: candidate.id, lastKnownGoodVersionId: candidate.id, payload, receipt: proof };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  return { store, record };
}

test("partial profile publications preserve every imported member and its original authority", async () => {
  const oldUrl = "https://previous.example.gov/candidate";
  const first = packageFor("candidate-profiles:AZ").payload as CandidateProfilesProjection;
  const payload: CandidateProfilesProjection = { cards: { ...first.cards, note: "Original held search notes",
    cards: Object.fromEntries(Array.from({ length: 47 }, (_, index) => [`ballot-az-test:held-${index}`, {
      photoUrl: index === 0 ? "/api/portraits/candidates/held-unbound" : null, photoSource: null, bio: `Held biography ${index}`, bioSourceUrl: oldUrl, bioSourceLabel: "Old official page",
      email: null, phone: null, phoneLabel: null, filedAddress: index === 0 ? "Private filing evidence" : null, filedAddressSource: null,
    }])), hunts: [{ key: "ballot-az-test:held-hunt", name: "Held person", note: "Official biography still unpublished", attemptedAt: T0 }] },
    links: { ...first.links, note: "Original link notes", links: {
      "ballot-az-test:held-0": { official: { url: oldUrl, verification: "Original verification", attemptedAt: T0 }, campaign: null },
    }, hunts: [{ key: "ballot-az-test:held-link-hunt", name: "Held person", note: "Campaign site not found", attemptedAt: T0 }] } };
  const { store, record } = importedManualProjection({ ...packageFor("candidate-profiles:AZ"), payload });
  const memberHashes = new Map(civicRecordsFor("CANDIDATE_PROFILE", payload).map(member => [member.key, canonicalCivicDataHash(member.record)]));
  for (const [index, at] of ["2026-09-10T12:01:00.000Z", "2026-09-10T12:02:00.000Z"].entries()) {
    const key = `ballot-az-test:verified-${index}`;
    const html = `<html><body>Verified biography ${index}</body></html>`;
    const input: ManualProjectionPackage = { ...packageFor("candidate-profiles:AZ", at),
      sourceReceipt: receipt(at, "CANDIDATE_CONTROLLED", createHash("sha256").update(html).digest("hex")),
      payload: { cards: { curatedAt: at, note: "", cards: { [key]: { ...payload.cards.cards["ballot-az-test:held-0"],
        bio: `Verified biography ${index}`, bioSourceUrl: URL } }, hunts: [] },
        links: { curatedAt: at, note: "", links: {}, hunts: [] } } };
    const prior = await readManualProjectionPrior("candidate-profiles:AZ", store, at);
    assert.ok(prior);
    if (index === 0) {
      assert.equal(prior.versionId, record.candidate.id);
      assert.equal(prior.sourceReceipt, undefined);
    }
    const candidate = manualProjectionCandidate(input, { prior });
    const held = candidate.readModel as CandidateProfilesProjection;
    assert.equal(Object.keys(held.cards.cards).length, 48 + index);
    const heldMembers = new Map(civicRecordsFor("CANDIDATE_PROFILE", held).map(member => [member.key, canonicalCivicDataHash(member.record)]));
    for (const [key, digest] of memberHashes) assert.equal(heldMembers.get(key), digest, key);
    assert.equal(held.cards.note, payload.cards.note);
    assert.equal(held.links.note, payload.links.note);
    assert.deepEqual(held.cards.hunts, payload.cards.hunts);
    assert.deepEqual(held.links.hunts, payload.links.hunts);
    assert.ok(!candidate.retrieval.manualSourceReceipt!.sources.some(source => source.finalUrl === oldUrl));
    assert.deepEqual(candidate.semantics.violations, []);
    if (index === 0) {
      const changed = { ...candidate, readModel: { ...held, cards: { ...held.cards, cards: { ...held.cards.cards,
        "ballot-az-test:held-1": { ...held.cards.cards["ballot-az-test:held-1"], bio: "Unverified replacement" },
      } } } };
      assert.match(manualPriorAuthorityIssue(changed, record) ?? "", /changed, duplicated, invented, or omitted/);
      assert.match(manualPriorAuthorityIssue(candidate, null) ?? "", /exact GOOD current base/);
    }
    const outcome = await processRegisteredManualCandidate(store, input.contractId, candidate, at, prior.versionId);
    assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
    assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
    assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
    assert.equal(outcome.candidate.receipt?.checks.find(check => check.check === "SOURCE_AUTHENTICITY")?.code,
      "CURRENT_SOURCES_AND_EXACT_PRIOR_AUTHORITY_VALID");
  }
});


test("a partial corpus publication keeps imported documents without inventing HTTP receipts", async () => {
  const old = candidateDocument("ballot-az-test:held-author", "https://previous.example.gov/publication", HASH_A, T0);
  const heldInput = candidateCorpusPackage([old], T0);
  const { store, record } = importedManualProjection(heldInput);
  const at = "2026-09-10T12:01:00.000Z";
  const fresh = candidateDocument("ballot-az-test:new-author", URL, HASH_B, at);
  const prior = await readManualProjectionPrior("candidate-corpus:AZ", store, at);
  assert.equal(prior?.versionId, record.candidate.id);
  const candidate = manualProjectionCandidate(candidateCorpusPackage([fresh], at), { prior });
  assert.deepEqual((candidate.readModel as CandidateCorpus).documents.find(row => row.id === old.id), old);
  assert.equal(candidate.retrieval.manualSourceReceipt?.sources.length, 1);
  assert.equal(candidate.retrieval.manualSourceReceipt?.sources[0]?.finalUrl, URL);
  assert.deepEqual(candidate.normalization.missingRequiredFields, []);
  assert.deepEqual(candidate.semantics.violations, []);
  const outcome = await processRegisteredManualCandidate(store, "candidate-corpus:AZ", candidate, at, prior!.versionId);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
  assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
});
