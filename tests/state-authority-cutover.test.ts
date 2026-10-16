import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";
import { pendingStateAuthorityRetirements, partitionHeldStateAuthorities, partitionHeldStateAuthority, retireRepartitionedAuthorities } from "../lib/civic-data/state-authority-cutover.ts";
import { publishedCandidateMetadata } from "../lib/civic-data/store.ts";
import { promotionProofIssue, readPromotedCivicData, type CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { latestUnchangedConfirmation, serializeUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import { sourceProjectionEvidence, VALIDATION_CHECKS, type CandidateVersionRecord, type RoutineCandidate, type RoutineRecordClass, type PromotedProjection, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { phaseFromSql } from "../lib/db/migration-phases.ts";

const AT = "2026-10-01T00:00:00.000Z", CHECKED = "2026-10-04T00:00:00.000Z";
const URL = "https://elections.example.gov/candidates";
const profileScope = "US-AZ+US-NH+US-NJ:2026-supported-candidates";
const path = (name: string) => new globalThis.URL(`../lib/db/migrations/${name}.sql`, import.meta.url);

type Row = Record<string, unknown>;

function source(recordClass: RoutineRecordClass, scope: string, payload: unknown, states: readonly string[]): CandidateVersionRecord {
  const records = civicRecordsFor(recordClass, payload), hash = canonicalCivicDataHash(payload), id = `source-${recordClass}-${canonicalCivicDataHash(scope).slice(0, 8)}`;
  const candidate: RoutineCandidate = { id, sourceId: "fixture-election-authorities", recordClass, scope,
    retrieval: { succeeded: true, requestedUrl: URL, finalUrl: URL, httpStatus: 200, retrievedAt: AT, rawHash: "a".repeat(64),
      manualSourceReceipt: { contractVersion: 1, reviewedBy: "fixture", reviewedAt: AT, sources: [{ requestedUrl: URL, finalUrl: URL, httpStatus: 200,
        retrievedAt: AT, rawHash: "a".repeat(64), sourceClass: "ELECTION_AUTHORITY", publisher: "Fixture election office", reviewedEvidence: "Saved fixture candidate list." }] } },
    normalization: { succeeded: true, parserVersion: "fixture/1", schemaVersion: "1", normalizedHash: hash,
      normalizedPayloadHash: hash, inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: states.map(state => ({ subjectId: `ballot-${state.toLowerCase()}:candidate`, jurisdiction: `US-${state}`, identifiers: { state }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: AT, staleAtRetrieval: false }, semantics: { factKind: "fixture", violations: [] },
    horizon: { kind: "BOUNDED", query: "saved fixture", returnedRecords: records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence("fixture-election-authorities", recordClass, scope), dependentChecks: [],
    readModel: payload, normalizedPayload: payload, civicRecords: records, excludedFacts: [] };
  const receipt: ValidationReceipt = { contractVersion: 2, candidateId: id, sourceId: candidate.sourceId, recordClass, scope,
    validatedAt: AT, decision: "GOOD", excludedFacts: [], checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "FIXTURE_HELD", detail: "Preserved fixture evidence." })) };
  return { candidate, state: "PROMOTED", acquisitionSucceeded: true, receipt, promotedVersion: id, lastKnownGoodVersion: id, failureCode: null, failureDetail: null };
}

async function database() {
  const db = new PGlite();
  for (const name of ["0025_typical_fixer", "0026_lame_sunset_bain", "0027_pdc_candidate_history_shape", "0029_unchanged_confirmation_receipts", "0031_civic_payload_parts"]) await db.exec(await readFile(path(name), "utf8"));
  const river = await readFile(path("0036_ne01"), "utf8");
  for (const statement of river.split("--> statement-breakpoint").filter(s => s.includes("CREATE FUNCTION"))) await db.exec(statement);
  const migration = await readFile(path("BL-30_candidate_scopes"), "utf8");
  assert.equal(phaseFromSql(migration).phase, "expand");
  assert.ok(migration.length < 40_000, "schema operations must not embed captured publication data");
  await db.exec(migration);
  return db;
}

async function save(db: PGlite, row: CandidateVersionRecord, encoded = false) {
  const c = row.candidate, plan = encoded ? partitionCivicPayload(c, ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal", "bootstrapImport"]) : { value: c, parts: [] };
  const stored = plan.value as RoutineCandidate;
  await db.transaction(async tx => {
    for (const part of plan.parts) await tx.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await tx.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES($1,$2,$3,$4,'PROMOTED',true,$5,$6,$7,$8,$9,$10,$11,$12,$1,$1)`,
    [c.id, c.sourceId, c.recordClass, c.scope, c.retrieval.rawHash, c.normalization.normalizedHash, c.retrieval.retrievedAt, c.temporal.sourceThrough, c.normalization.parserVersion, stored.identities, stored, row.receipt]);
    for (const [index, state] of ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].entries()) await tx.query(
      "INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,'Held source fixture')", [c.id, index + 1, state, AT]);
    await tx.query(`INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8) ON CONFLICT(record_class,scope) DO UPDATE SET current_version_id=excluded.current_version_id,
        last_known_good_version_id=excluded.last_known_good_version_id,promoted_at=excluded.promoted_at,payload=excluded.payload,validation_receipt=excluded.validation_receipt`, [`${c.recordClass}:${c.scope}`, c.sourceId, c.recordClass, c.scope, c.id, AT, stored.readModel, row.receipt]);
    const detail = serializeUnchangedConfirmation({ kind: "UNCHANGED_CONFIRMATION_V1", sourceId: c.sourceId, recordClass: c.recordClass, scope: c.scope,
      pointerKey: `${c.recordClass}:${c.scope}`, versionId: c.id, readModelHash: c.normalization.normalizedHash!, basis: "CHANGE_SET_UNCHANGED", parserVersion: c.normalization.parserVersion,
      retrieval: { requestedUrl: URL, finalUrl: URL, httpStatus: 200, retrievedAt: CHECKED, rawHash: "b".repeat(64) }, stamps: null, observedAt: CHECKED });
    await tx.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,5,'PROMOTED',$2,$3)", [c.id, CHECKED, detail]);
  });
}

function readStore(db: PGlite): CivicDataReadStore {
  return {
    async readPromotion<T>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
      const p = (await db.query<Row>("SELECT * FROM civic_data_promotions WHERE record_class=$1 AND scope=$2", [recordClass, scope])).rows[0];
      if (!p) return null;
      const events = (await db.query<{ sequence: number; detail: string }>("SELECT sequence,detail FROM civic_data_candidate_events WHERE candidate_id=$1 ORDER BY sequence", [p.current_version_id])).rows;
      return { key: String(p.key), sourceId: String(p.source_id), recordClass, scope, versionId: String(p.current_version_id), lastKnownGoodVersionId: String(p.last_known_good_version_id),
        promotedAt: (p.promoted_at as Date).toISOString(), payload: p.payload as T, receipt: p.validation_receipt as ValidationReceipt,
        latestConfirmation: latestUnchangedConfirmation(events, String(p.current_version_id)) ?? undefined };
    },
    async readPublishedCandidateMetadata(id) {
      const row = await this.readCandidate(id);
      return row ? publishedCandidateMetadata(row) : null;
    },
    async readCandidate(id) {
      const c = (await db.query<Row>("SELECT * FROM civic_data_candidates WHERE id=$1", [id])).rows[0];
      return c ? { candidate: c.candidate as RoutineCandidate, state: "PROMOTED", acquisitionSucceeded: true, receipt: c.validation_receipt as ValidationReceipt,
        promotedVersion: String(c.promoted_version_id), lastKnownGoodVersion: String(c.last_known_good_version_id), failureCode: null, failureDetail: null } : null;
    },
  };
}

test("state child partitions encoded held publications, preserves source checks, replays safely and retires only complete counterparts", async () => {
  const priorRole = process.env.WTP_DB_ROLE; process.env.WTP_DB_ROLE = "local";
  const db = await database();
  try {
    const note = "Saved biography. ".repeat(2500), keys = ["ballot-az:candidate", "ballot-nh:candidate", "ballot-nj:candidate"];
    const cards = Object.fromEntries(keys.map((key, index) => [key, { name: `Candidate ${index}`, bio: note, photoUrl: `/candidates/${index}.jpg`, incumbent: index === 0, sourceUrl: URL }]));
    const hunt = { key: "unscoped-hunt:Alice Example", name: "Alice Example", note: "Saved failed search.", attemptedAt: AT };
    const payload = { cards: { curatedAt: AT, note: "", cards, hunts: [] }, links: { curatedAt: AT, note: "", links: {}, hunts: [hunt] } };
    const original = source("CANDIDATE_PROFILE", profileScope, payload, ["AZ", "NH", "NJ"]);
    await save(db, original, true);
    const filing = { id: "ballot-nh:alice", givenName: "ALICE", familyName: "EXAMPLE, JR.", provenance: { sourceUrl: URL } };
    const measure = { id: "measure-nh:1", questionText: "Saved official measure.", provenance: { sourceUrl: URL, verifiedAt: AT } };
    const analysis = { contestId: "measure-nh:1", text: "Saved analysis.", analysisUrl: URL, retrievedAt: AT };
    const oldBallot = source("BALLOT_CANDIDACY", "US-NH:merrimack:2026-general", {
      ballot: { contests: [], candidacies: [filing], measures: [measure] }, measureAnalyses: { analyses: [analysis] },
    }, ["NH"]);
    await save(db, oldBallot);
    const sent: { text: string; bytes: number }[] = [];
    let publication: readonly unknown[] = [];
    const query = async (text: string, params: readonly unknown[]) => { sent.push({ text, bytes: Buffer.byteLength(JSON.stringify(params)) }); if (text.includes("partition_publish")) publication = params; return (await db.query<Row>(text, [...params])).rows; };
    const pending = await pendingStateAuthorityRetirements({ query });
    assert.deepEqual(pending.filter(row => row.recordClass === "CANDIDATE_PROFILE"), [{ recordClass: "CANDIDATE_PROFILE", scope: profileScope, versionId: original.candidate.id, states: ["AZ", "NH", "NJ"] }]);
    const az = await partitionHeldStateAuthorities("AZ", { query });
    assert.equal(az.length, 1);
    const read = await readPromotedCivicData<typeof payload>("CANDIDATE_PROFILE", "US-AZ:candidate-profiles", { store: readStore(db), now: CHECKED, bypassCache: true });
    assert.equal(read.kind, "PROMOTED", read.kind === "PROMOTED" ? "" : JSON.stringify(read));
    if (read.kind !== "PROMOTED") return;
    assert.deepEqual(read.value.cards.cards, { [keys[0]]: cards[keys[0]] });
    assert.equal(read.metadata.retrievedAt, CHECKED);
    assert.equal(promotionProofIssue("CANDIDATE_PROFILE", "US-AZ:candidate-profiles", read.projection, (await readStore(db).readCandidate(az[0].versionId))!), null);
    assert.ok(sent.find(row => row.text.includes("partition_publish"))!.bytes < note.length / 2, "publication sends state references instead of repeating the biography");
    assert.deepEqual(await partitionHeldStateAuthorities("AZ", { query }), az);
    const template = String(publication[3]);
    await assert.rejects(db.query("SELECT civic_authority_partition_publish($1,$2,$3,$4::jsonb)", ["candidate-profiles", "NH", original.candidate.id, template]), /changed held evidence/);
    await assert.rejects(db.query("SELECT civic_authority_partition_publish($1,$2,$3,$4::jsonb)", ["candidate-profiles", "NH", "wrong-origin", template]), /origin changed/);
    assert.equal(await retireRepartitionedAuthorities("AZ", { query }), 0);
    await assert.rejects(db.query("DELETE FROM civic_data_promotions WHERE scope=$1", [profileScope]), /DELETE is forbidden/);
    await partitionHeldStateAuthorities("NH", { query });
    const nh = await readPromotedCivicData<typeof payload>("CANDIDATE_PROFILE", "US-NH:candidate-profiles", { store: readStore(db), now: CHECKED, bypassCache: true });
    assert.equal(nh.kind, "PROMOTED");
    if (nh.kind === "PROMOTED") assert.deepEqual(nh.value.links.hunts, [hunt], "a unique official given/family name keeps an unscoped hunt in its state");
    await partitionHeldStateAuthorities("NJ", { query });
    assert.equal(await retireRepartitionedAuthorities("NJ", { query }), 1);
    assert.equal((await pendingStateAuthorityRetirements({ query })).length, 1, "the old ballot remains until its measures and analyses are preserved");
    const currentBallot = { election: { state: "NH" }, contests: [], candidacies: [], filingCandidacies: [filing], measures: [] as unknown[], measureAnalyses: { analyses: [analysis] } };
    await save(db, source("BALLOT_CANDIDACY", "US-NH:state-election-ballots", { kind: "ballot-contests", ballots: { nh: currentBallot } }, ["NH"]));
    assert.equal(await retireRepartitionedAuthorities("NH", { query }), 0, "matching candidate IDs cannot hide a missing measure");
    const complete = source("BALLOT_CANDIDACY", "US-NH:state-election-ballots", { kind: "ballot-contests", ballots: { nh: { ...currentBallot, measures: [measure] } } }, ["NH"]);
    const successorId = `${complete.candidate.id}-complete`;
    await save(db, { ...complete, candidate: { ...complete.candidate, id: successorId }, receipt: { ...complete.receipt!, candidateId: successorId }, promotedVersion: successorId, lastKnownGoodVersion: successorId });
    assert.equal(await retireRepartitionedAuthorities("NH", { query }), 1, "earlier filing candidates remain valid preserved counterparts");
    assert.deepEqual(await pendingStateAuthorityRetirements({ query }), []);
    assert.equal((await db.query("SELECT id FROM civic_data_candidates WHERE id=$1", [original.candidate.id])).rows.length, 1);
    await assert.rejects(db.query("DELETE FROM civic_data_candidates WHERE id=$1", [original.candidate.id]), /immutable evidence/);
    await assert.rejects(db.query("DELETE FROM civic_data_promotions WHERE scope='US-AZ:candidate-profiles'"), /DELETE is forbidden/);
  } finally { await db.close(); if (priorRole === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = priorRole; }
});

test("state cutover refuses a mismatched child before querying production", async () => {
  const priorRole = process.env.WTP_DB_ROLE; process.env.WTP_DB_ROLE = "production";
  let reads = 0;
  await assert.rejects(partitionHeldStateAuthority("candidate-profiles", "AZ", { query: async () => { reads++; return []; } }), /STATE_AUTHORITY_PARTITION_REFUSED/);
  assert.equal(reads, 0);
  if (priorRole === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = priorRole;
});
