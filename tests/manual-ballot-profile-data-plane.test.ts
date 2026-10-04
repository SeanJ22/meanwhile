import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { CandidateCorpus, CandidateDocument } from "../lib/candidates/corpus.ts";
import { MEASURE_PROVISIONS } from "../lib/ballot/measure-provisions.ts";
import { measureRecordsForBallot, type MeasureRecord } from "../lib/ballot/measure-records.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import type { NhBallotProjection } from "../lib/civic-data/manual-projections.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  manualProjectionCandidate,
  type ManualProjectionContractId,
  type ManualProjectionPackage,
} from "../lib/civic-data/manual-projections.ts";
import {
  readAzBallotProjection,
  readCandidateCorpusProjection,
  readCandidateProfilesProjection,
  readNhBallotProjection,
} from "../lib/civic-data/manual-read-models.ts";
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
    contractId: "candidate-corpus",
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
  if (state === "NH") return { ballot };
  return {
    ballot,
    generalLineup: { contests: [{ contestId, nominees: [{ name: `Jane ${familyName}` }] }] },
    measureAnalyses: { analyses: [{ contestId: "measure:test", sourceUrl: URL }] },
    candidateFilings: { contests: [], candidacies: [] },
    identityRegistry: {
      generatedAt: T0,
      contests: [],
      candidates: [{ identityId: candidacyId }],
    },
    lineupReconciliation: {
      rows: [{ cardKey: candidacyId, canonicalCandidacyId: candidacyId, contestId, outcome: "MATCHED" }],
    },
  };
}

function packageFor(
  contractId: ManualProjectionContractId,
  at = T0,
  rawHash = HASH_A,
  familyName = "DOE",
): ManualProjectionPackage {
  if (contractId === "az-sos-ballot" || contractId === "nh-curated-ballot") {
    return {
      contractId,
      version: "2026-11-03",
      sourceThrough: at,
      sourceReceipt: receipt(at, "ELECTION_AUTHORITY", rawHash),
      payload: ballotPayload(contractId === "az-sos-ballot" ? "AZ" : "NH", familyName),
    } as unknown as ManualProjectionPackage;
  }
  if (contractId === "candidate-profiles") {
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

test("the four former tracked authorities promote through the canonical candidate/event/pointer plane", async () => {
  const store = new MemoryRoutineDataStore();
  for (const id of ["az-sos-ballot", "nh-curated-ballot", "candidate-profiles", "candidate-corpus"] as const) {
    const candidate = manualProjectionCandidate(packageFor(id));
    const outcome = await processRegisteredManualCandidate(store, id, candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.equal(outcome.candidate.receipt?.decision, "GOOD", id);
    assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify({ id, readback: outcome.readerReadback }));
    assert.deepEqual((await store.events(candidate.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  }

  const reads = await Promise.all([
    readAzBallotProjection({ store, bypassCache: true, now: T0 }),
    readNhBallotProjection({ store, bypassCache: true, now: T0 }),
    readCandidateProfilesProjection({ store, bypassCache: true, now: T0 }),
    readCandidateCorpusProjection({ store, bypassCache: true, now: T0 }),
  ]);
  assert.deepEqual(reads.map((read) => read.kind), ["PROMOTED", "PROMOTED", "PROMOTED", "PROMOTED"]);
});

test("measure records survive civic-data promotion and change without a software release", async () => {
  const store = new MemoryRoutineDataStore();
  const original = packageFor("nh-curated-ballot");
  const payload = structuredClone(original.payload) as NhBallotProjection;
  const contest = { ...payload.ballot.contests[0]!, id: "ballot-nh-test:measure", type: "MEASURE" as const };
  payload.ballot.contests.push(contest);
  const record: MeasureRecord = { contestId: contest.id, whatItDoes: "Creates a program.",
    yesMeans: null, noMeans: null, parts: [], sourceUrl: URL, sourceHash: HASH_A, writtenAt: T0 };
  for (const [at, whatItDoes] of [[T0, "Creates a program."], [T1, "Changes the program."]] as const) {
    const input = { ...original, sourceThrough: at, sourceReceipt: receipt(at, "ELECTION_AUTHORITY", HASH_A),
      payload: { ...payload, ballot: { ...payload.ballot, measureRecords: [{ ...record, whatItDoes }] } } };
    const candidate = manualProjectionCandidate(input);
    const published = await processRegisteredManualCandidate(store, "nh-curated-ballot", candidate, at);
    assert.equal(published.candidate.state, "PROMOTED");
    const read = await readNhBallotProjection({ store, now: at, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    assert.ok(read.value);
    assert.equal(summaryForContest(contest.id, measureRecordsForBallot(read.value.ballot))?.summary, whatItDoes);
    assert.ok(candidate.civicRecords?.some(row => row.key === `measure-record:${contest.id}`));
  }
});

test("a changed ballot yields an exact record delta; a bad successor is held and cannot erase LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(packageFor("nh-curated-ballot"));
  await processRegisteredManualCandidate(store, "nh-curated-ballot", first, T0);

  const changed = manualProjectionCandidate(packageFor("nh-curated-ballot", T1, HASH_B, "ROE"));
  const promoted = await processRegisteredManualCandidate(store, "nh-curated-ballot", changed, T1);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.deepEqual(promoted.candidate.candidate.changeSet?.changed.map((record) => record.key), ["candidacy:ballot-nh-test:office:jane-doe"]);

  const brokenPackage = structuredClone(packageFor("nh-curated-ballot", T2, "c".repeat(64), "BAD"));
  const brokenPayload = brokenPackage.payload as unknown as ReturnType<typeof ballotPayload>;
  brokenPayload.ballot.candidacies[0].contestId = "missing-contest";
  const broken = manualProjectionCandidate(brokenPackage);
  const refused = await processRegisteredManualCandidate(store, "nh-curated-ballot", broken, T2);
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal((await store.readPromotion("BALLOT_CANDIDACY", "US-NH:merrimack:2026-general"))?.versionId, changed.id);
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
  await processRegisteredManualCandidate(store, "candidate-corpus", first, T0, null);

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
  const outcome = await processRegisteredManualCandidate(store, "candidate-corpus", next, T1, first.id);
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
  const input = packageFor("candidate-corpus");
  const payload = structuredClone(input.payload) as CandidateCorpus;
  payload.documents[0]!.text = "Different normalized words with the old content identity.";
  const candidate = manualProjectionCandidate({ ...input, payload });
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-corpus",
    candidate,
    T0,
  );
  assert.equal(outcome.promoted, null);
  assert.notEqual(outcome.candidate.receipt?.decision, "GOOD");
});

test("manual Reader proof is bound to the exact source, class, and scope", async () => {
  const candidate = manualProjectionCandidate(packageFor("candidate-profiles"));
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
    "candidate-profiles",
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
    readAzBallotProjection({ store: brokenStore, bypassCache: true }),
    readNhBallotProjection({ store: brokenStore, bypassCache: true }),
    readCandidateProfilesProjection({ store: brokenStore, bypassCache: true }),
    readCandidateCorpusProjection({ store: brokenStore, bypassCache: true }),
  ]);
  assert.ok(reads.every((read) => read.kind === "STORE_UNREACHABLE"));
  assert.equal(candidateReads, 0);

  const citation = Object.getOwnPropertyDescriptor(MEASURE_PROVISIONS[0]!, "citesUrl");
  assert.equal(typeof citation?.get, "function", "route import must defer the canonical citation read until request time");
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnvironment["NODE_ENV"];
  mutableEnvironment["NODE_ENV"] = "production";
  try {
    assert.throws(
      () => MEASURE_PROVISIONS[0]!.citesUrl,
      /Arizona ballot projection is STORE_UNREACHABLE/,
      "a compile-safe provision must still fail closed instead of retaining a bundled citation after store failure",
    );
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnvironment["NODE_ENV"];
    else mutableEnvironment["NODE_ENV"] = previousNodeEnv;
  }
});

test("manual authorities have no clock and Admin reuses the canonical outcome projection", () => {
  const ids = new Set(["az-sos-ballot", "nh-curated-ballot", "candidate-profiles", "candidate-corpus"]);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.equal(contracts.length, 4);
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
  assert.equal(
    pkg.scripts["civic-data:promote-manual"],
    "node scripts/installed-runtime-command.mjs manual-promote",
  );

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
