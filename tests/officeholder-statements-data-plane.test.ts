import assert from "node:assert/strict";
import test from "node:test";

import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { candidateEnrichmentProvider, candidateEnrichmentUniversesFromHoldings, preloadCandidateEnrichmentAuthorities, type CandidateEnrichmentAuthorityHoldings } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { readOfficeholderStatementsProjection, refreshOfficeholderStatementsFromPromoted } from "../lib/corpus/data-plane.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

const ROOT = process.cwd();
const URL = "https://example.house.gov/issues";
const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";
const T2 = "2026-09-08T12:02:00.000Z";
const T3 = "2026-09-08T12:03:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function snapshot(
  hash: string,
  at: string,
  subjectId = "congress:T000001",
  url = URL,
): SourceSnapshot {
  return {
    id: `${subjectId}|${url}|${hash}`,
    subjectId,
    subjectName: "Taylor Test",
    kind: "OFFICIAL_PAGE",
    url,
    contentHash: hash,
    retrievedAt: at,
    httpStatus: 200,
    extraction: "ok",
    text: `A primary-source statement version identified by ${hash.slice(0, 8)}.`,
    title: "Issues",
  };
}

function receipt(rows: readonly SourceSnapshot[], at: string): ManualSourceSetReceipt {
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "owner-test",
    sources: rows.map((row) => ({
      requestedUrl: row.url,
      finalUrl: row.url,
      publisher: "Named officeholder primary publisher",
      sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: row.retrievedAt,
      httpStatus: 200,
      rawHash: row.contentHash,
      reviewedEvidence: "Exact response bytes and normalized snapshot reviewed together.",
    })),
  };
}

function statementPackage(rows: readonly SourceSnapshot[], at: string): ManualProjectionPackage {
  return {
    contractId: "officeholder-statements",
    version: at,
    sourceThrough: at,
    sourceReceipt: receipt(rows, at),
    payload: { snapshots: [...rows] } satisfies StatementCorpus,
  };
}

function ballotFixture(state: string) {
  const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Election authority", collectedAt: T0, verifiedAt: T0 };
  const contestId = `${state}-fixture-contest`;
  return {
    election: { id: "fixture-election", state: state.toUpperCase(), date: "2026-11-03", name: "General election" },
    contests: [{ id: contestId, electionId: "fixture-election", ocdId: `ocd-division/country:us/state:${state}`, divisionVintage: "fixture", title: "State Senate", type: "CANDIDACY" as const, voteFor: null, termYears: null, scopeNote: null, provenance }],
    candidacies: [{ id: `${state}-fixture-candidate`, contestId, familyName: "Example", givenName: "Avery", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance }],
    measures: [],
    absences: [],
  };
}

test("officeholder statements use the canonical candidate/event/promotion pointer with exact source-scoped proof", async () => {
  const store = new MemoryRoutineDataStore();
  const firstSnapshot = snapshot(HASH_A, T0);
  const candidate = manualProjectionCandidate(statementPackage([firstSnapshot], T0));
  assert.deepEqual(candidate.sourceProjectionEvidence, {
    kind: "SOURCE_PROJECTION_CONTRACT",
    sourceId: "officeholder-primary-publications",
    recordClass: "OFFICEHOLDER_STATEMENT",
    scope: "US:covered-officeholders:primary-publications",
  });

  const promoted = await processRegisteredManualCandidate(store, "officeholder-statements", candidate, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.candidate.receipt?.decision, "GOOD");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.deepEqual((await store.events(candidate.id)).map(({ state }) => state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);

  const read = await readOfficeholderStatementsProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, candidate.id);
  assert.deepEqual(read.value?.snapshots, [firstSnapshot]);
});

test("a new statement version reports the exact append while an invalid successor cannot erase LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const firstSnapshot = snapshot(HASH_A, T0);
  const first = manualProjectionCandidate(statementPackage([firstSnapshot], T0));
  await processRegisteredManualCandidate(store, "officeholder-statements", first, T0);

  const secondSnapshot = snapshot(HASH_B, T1);
  const second = manualProjectionCandidate(statementPackage([firstSnapshot, secondSnapshot], T1));
  const changed = await processRegisteredManualCandidate(store, "officeholder-statements", second, T1);
  assert.equal(changed.candidate.state, "PROMOTED");
  assert.deepEqual(changed.candidate.candidate.changeSet?.added.map(({ key }) => key), [`statement:${secondSnapshot.id}`]);
  assert.deepEqual(changed.candidate.candidate.changeSet?.changed, []);
  assert.deepEqual(changed.candidate.candidate.changeSet?.removed, []);

  const duplicatedSnapshot = snapshot(HASH_C, T2);
  const invalid = manualProjectionCandidate(statementPackage([duplicatedSnapshot, duplicatedSnapshot], T2), {
    prior: {
      versionId: second.id,
      payload: second.readModel as StatementCorpus,
      sourceReceipt: second.retrieval.manualSourceReceipt!,
    },
  });
  const held = await processRegisteredManualCandidate(store, "officeholder-statements", invalid, T2);
  assert.equal(held.promoted, null);
  assert.equal(held.candidate.state, "SEMANTIC_INVALID");
  assert.equal(
    (await store.readPromotion("OFFICEHOLDER_STATEMENT", "US:covered-officeholders:primary-publications"))?.versionId,
    second.id,
  );
  const read = await readOfficeholderStatementsProjection({ store, bypassCache: true, now: T2 });
  assert.equal(read.kind, "PROMOTED");
  assert.deepEqual(read.value?.snapshots, [firstSnapshot, secondSnapshot]);

  const unavailable = manualProjectionCandidate(statementPackage([], T3));
  const failed = await processRegisteredManualCandidate(store, "officeholder-statements", unavailable, T3);
  assert.equal(failed.candidate.state, "SOURCE_BLOCKED");
  assert.equal(failed.candidate.acquisitionSucceeded, false);
  assert.equal(failed.candidate.lastKnownGoodVersion, second.id);
  assert.deepEqual((await store.events(unavailable.id)).map(({ state }) => state), ["SOURCE_BLOCKED"]);
  assert.equal(
    (await store.readPromotion("OFFICEHOLDER_STATEMENT", "US:covered-officeholders:primary-publications"))?.versionId,
    second.id,
  );
});

test("one statement receipt mismatch is held alone while an unrelated exact publication version promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const firstUrl = "https://one.example.house.gov/issues";
  const secondUrl = "https://two.example.house.gov/issues";
  const firstRows = [
    snapshot(HASH_A, T0, "congress:T000001", firstUrl),
    snapshot(HASH_B, T0, "congress:C000002", secondUrl),
  ];
  const first = manualProjectionCandidate(statementPackage(firstRows, T0));
  await processRegisteredManualCandidate(store, "officeholder-statements", first, T0, null);

  const validNew = snapshot(HASH_C, T1, "congress:T000001", firstUrl);
  const mismatchedNew = snapshot(HASH_D, T1, "congress:C000002", secondUrl);
  const attemptedBase = statementPackage([validNew, mismatchedNew], T1);
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
      payload: first.readModel as StatementCorpus,
      sourceReceipt: first.retrieval.manualSourceReceipt!,
    },
  });
  const outcome = await processRegisteredManualCandidate(
    store,
    "officeholder-statements",
    next,
    T1,
    first.id,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, []);
  assert.ok(outcome.candidate.candidate.changeSet?.added.some(({ key }) => key === `statement:${validNew.id}`));
  assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `statement:${mismatchedNew.id}` && fact.code === "MANUAL_MEMBER_INVALID"
  ));
  const promoted = outcome.promoted!.payload as StatementCorpus;
  assert.ok(promoted.snapshots.some((row) => row.id === validNew.id));
  assert.ok(promoted.snapshots.some((row) => row.id === firstRows[1]!.id));
  assert.ok(!promoted.snapshots.some((row) => row.id === mismatchedNew.id));
});

test("store failure and an unseeded production store never reopen tracked statement history", async () => {
  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const failed = await readOfficeholderStatementsProjection({ store: brokenStore, bypassCache: true });
  assert.equal(failed.kind, "STORE_UNREACHABLE");
  assert.equal(candidateReads, 0);

  const mutableEnv = process.env as Record<string, string | undefined>;
  const priorNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const absent = await readOfficeholderStatementsProjection({ store: new MemoryRoutineDataStore(), bypassCache: true });
    assert.equal(absent.kind, "NOT_RECORDED");
    assert.equal(absent.value, null);
    await assert.rejects(
      refreshOfficeholderStatementsFromPromoted({ store: new MemoryRoutineDataStore(), bypassCache: true }),
      /without a canonical promoted projection/,
    );
  } finally {
    if (priorNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = priorNodeEnv;
  }
});

test("officeholder statement ownership is manual and visible in the existing Admin outcome projection", () => {
  const contract = requiredManualProductionContract("officeholder-statements");
  assert.ok(!("cadence" in contract) && !("retry" in contract));
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, T0, [contract]);
  assert.equal(view.source, "civic_data_candidates+civic_data_candidate_events+civic_data_promotions");
  assert.equal(view.contracts[0]?.cadence.clock, "MANUAL");
  assert.equal(view.contracts[0]?.cadence.nextDue.kind, "NOT_APPLICABLE");
});

test("standing candidate enrichment derives all three state denominators from promoted projections", async () => {
  await preloadCandidateEnrichmentAuthorities({ store: new MemoryRoutineDataStore(), bypassCache: true, now: T0 });
  const unavailable = candidateEnrichmentProvider().enumerate({ root: ROOT, nowIso: T0 });
  assert.equal(unavailable.obligations.length, 0);
  assert.match(unavailable.readFailure ?? "", /canonical projection is NOT_RECORDED/,
    "an answered empty canonical store must be explicit and must not reopen tracked hunt or bootstrap files");
  const authorities = {
    general: { kind: "ballot-contests", ballots: Object.fromEntries(["az", "nh", "nj"].map(state => {
      const ballot = ballotFixture(state);
      return [`${state.toUpperCase()}:${ballot.election.id}`, ballot];
    })) },
    failures: [],
    profiles: { cards: { curatedAt: T0, note: "Held empty", cards: {}, hunts: [] }, links: { curatedAt: T0, note: "Held empty", links: {}, hunts: [] } },
    corpus: { formatVersion: 1 as const, fetchedAt: T0, attempted: 0, documents: [], failures: [] },
  } as unknown as CandidateEnrichmentAuthorityHoldings;
  const { universes } = candidateEnrichmentUniversesFromHoldings(authorities, T0);
  for (const state of ["az", "nh", "nj"] as const) {
    assert.ok(universes[state].candidacies.length > 0, state);
    assert.ok(universes[state].derivedFrom.length > 0, state);
    assert.ok(universes[state].derivedFrom.every(({ path }) => path.startsWith("civic-data:") && !path.includes("/hunt/")), state);
  }

  const withoutAz = candidateEnrichmentUniversesFromHoldings({
    ...authorities,
    general: { ...authorities.general!, ballots: Object.fromEntries(Object.entries(authorities.general!.ballots).filter(([key]) => !key.startsWith("AZ:"))) },
    failures: ["Arizona ballot has no held contests."],
  }, T0);
  assert.equal(withoutAz.universes.az, undefined);
  assert.ok(withoutAz.universes.nh!.candidacies.length > 0, "NH survives planted AZ authority failure");
  assert.ok(withoutAz.universes.nj!.candidacies.length > 0, "NJ survives planted AZ authority failure");
  assert.match(withoutAz.failures.join("; "), /Arizona ballot/);
});

test("national ballots derive candidate inventory in every state and never infer an unknown election cycle",()=>{
  const provenance={sourceUrl:"https://elections.example.gov/candidates",sourceOrg:"Election authority",collectedAt:T0,verifiedAt:T0};
  const common={profiles:{cards:{curatedAt:T0,note:"Held empty",cards:{},hunts:[]},links:{curatedAt:T0,note:"Held empty",links:{},hunts:[]}},corpus:{formatVersion:1 as const,fetchedAt:T0,attempted:0,documents:[],failures:[]},failures:[]};
  const division="ocd-division/country:us/state:oh/county:alder";
  const ballot={election:{id:"fixture-election",state:"OH",name:"General election",date:"2026-11-03"},contests:[{id:"fixture-contest",electionId:"fixture-election",ocdId:division,divisionVintage:"fixture",title:"County Council",type:"CANDIDACY" as const,voteFor:null,termYears:null,scopeNote:null,provenance}],candidacies:[{id:"fixture-candidate",contestId:"fixture-contest",familyName:"Example",givenName:"Avery",partyLabel:null,slogan:null,incumbent:null,websiteUrl:null,provenance}],measures:[],absences:[]};
  const general={kind:"ballot-contests" as const,ballots:{"OH:fixture-election":ballot}};
  const read=candidateEnrichmentUniversesFromHoldings({...common,general},T0);
  assert.equal(read.universes.oh?.candidacies.length,1);
  assert.deepEqual(read.universes.oh!.candidacies[0].pilotIds,["fixture-candidate"]);
  assert.equal(read.universes.az,undefined);
  assert.deepEqual(read.failures,[]);
  const unknown=candidateEnrichmentUniversesFromHoldings({...common,general:{...general,ballots:{"OH:fixture-election":{...ballot,election:{...ballot.election,date:""}}}}},T0);
  assert.equal(unknown.universes.oh,undefined);
  assert.match(unknown.failures.join(" "),/election year is not held/);
});
