import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { publishStateBucket, type StateBucketSource } from "../lib/civic-data/state-bucket-publication.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { decodeStateCandidate } from "../lib/civic-data/state-publication.ts";
import { RUNTIME_AUTHORITY_ENV } from "../lib/civic-data/runtime-authority.ts";
import { VALIDATION_CHECKS, type CandidateEvent, type RoutineCandidate, type ValidationReceipt } from "../lib/civic-data/types.ts";

const NOW = "2026-10-01T12:00:00.000Z", SCOPE = "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions";
function source(): StateBucketSource {
  const url = "https://elections.example.gov/az/locations";
  const built = votingSitesCandidate({ state: "AZ", current: { generatedAt: "2026-10-01", jurisdictions: [{
    ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County", state: "AZ", model: "VOTE_CENTER",
    election: "2026 General", sourceOrg: "Example County Elections", sourceUrl: url, collectedAt: "2026-10-01", refusal: null,
    sites: Array.from({ length: 250 }, (_, index) => ({ id: `site-${index}`, name: `Official center ${index}`,
      address: `${index} Main Street, Exampleville, AZ 85000`, room: null, lat: 32.2, lng: -110.9,
      kind: "ELECTION_DAY" as const, election: "2026 General", serves: null })),
  }] }, prior: null, failures: [], successfulAuthorityReads: 1, requestedUrl: url, finalUrl: url, retrievedAt: NOW,
  acquisition: [{ url, contentType: "text/html", vaultKey: "held/official-voting-sites", rawHash: "a".repeat(64), byteLength: 1000 }] });
  const candidate = { ...built, id: "national-origin", scope: SCOPE, sourceProjectionEvidence: { ...built.sourceProjectionEvidence, scope: SCOPE } };
  const receipt: ValidationReceipt = { contractVersion: 2, decision: "GOOD", candidateId: candidate.id,
    sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: SCOPE, validatedAt: NOW, excludedFacts: [],
    checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "VERIFIED", detail: "Verified official records." })) };
  const events = ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].map((state, index) =>
    ({ candidateId: candidate.id, sequence: index + 1, state, at: NOW, detail: `Official source ${state}.` })) as CandidateEvent[];
  events.push({ candidateId: candidate.id, sequence: 5, state: "PROMOTED", at: NOW,
    detail: "UNCHANGED_CONFIRMATION_V1 " + JSON.stringify({ kind: "UNCHANGED_CONFIRMATION_V1", sourceId: candidate.sourceId,
      recordClass: candidate.recordClass, scope: SCOPE, versionId: candidate.id, pointerKey: `${candidate.recordClass}:${SCOPE}`,
      readModelHash: candidate.normalization.normalizedHash, basis: "READ_MODEL_RECOMPUTED", parserVersion: candidate.normalization.parserVersion,
      retrieval: candidate.retrieval, observedAt: NOW }) });
  events.push({ candidateId: candidate.id, sequence: 6, state: "PROMOTED", at: NOW,
    detail: "UNCHANGED_CONFIRMATION_SOURCES_V1 " + JSON.stringify({ versionId: candidate.id, observedAt: NOW, retainedSourceResponses: [] }) });
  const { projection: _projection, ...normalizedMetadata } = candidate.normalizedPayload as Record<string, unknown>;
  return { family: "voting-sites", state: "AZ", inputHash: "a".repeat(64), originId: candidate.id,
    originScope: SCOPE, originReadModelHash: candidate.normalization.normalizedHash!, promotedAt: NOW,
    candidate, receipt, payload: candidate.readModel, normalizedMetadata, events };
}

async function database(input: StateBucketSource) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,
    acquisition_succeeded boolean,raw_hash text,normalized_hash text,retrieved_at timestamptz,source_through text,parser_version text,
    identity jsonb,candidate jsonb,validation_receipt jsonb,promoted_version_id text,last_known_good_version_id text,failure_code text,failure_detail text);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,scope text,current_version_id text,
      last_known_good_version_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidate_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),candidate_id text,sequence integer,state text,at timestamptz,detail text,UNIQUE(candidate_id,sequence));
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb NOT NULL);`);
  const durability = await readFile(new URL("../lib/db/migrations/0026_lame_sunset_bain.sql", import.meta.url), "utf8");
  await db.exec(durability.slice(durability.indexOf('CREATE UNIQUE INDEX "civic_data_candidates_identity_idx"')));
  for (const file of ["0027_pdc_candidate_history_shape.sql", "0029_unchanged_confirmation_receipts.sql"])
    await db.exec(await readFile(new URL(`../lib/db/migrations/${file}`, import.meta.url), "utf8"));
  const candidate = input.candidate;
  await db.exec("BEGIN");
  await db.query(`INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,'PROMOTED',true,$5,$6,$7,$8,$9,$10,$11,$12,$1,$1,null,null)`,
    [candidate.id, candidate.sourceId, candidate.recordClass, candidate.scope, candidate.retrieval.rawHash,
      candidate.normalization.normalizedHash, candidate.retrieval.retrievedAt, candidate.temporal.sourceThrough,
      candidate.normalization.parserVersion, JSON.stringify(candidate.identities), JSON.stringify(candidate), JSON.stringify(input.receipt)]);
  await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)",
    [`${candidate.recordClass}:${candidate.scope}`, candidate.sourceId, candidate.recordClass, candidate.scope, candidate.id,
      input.promotedAt, JSON.stringify(input.payload), JSON.stringify(input.receipt)]);
  for (const event of input.events) await db.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,$5)",
    [candidate.id, event.sequence, event.state, event.at, event.detail]);
  await db.exec("COMMIT");
  const queries: string[] = [];
  const query = async (sql: string, params: readonly unknown[]) => { queries.push(sql); return (await db.query<Record<string, unknown>>(sql, [...params])).rows; };
  return { db, query, queries };
}

function staging(t: test.TestContext): void {
  const env: Record<string, string | undefined> = { ...Object.fromEntries(Object.values(RUNTIME_AUTHORITY_ENV).map(key => [key, undefined])),
    WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control", WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40),
    WTP_SANCTIONED_WRITE: undefined };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const assign = (values: Record<string, string | undefined>) => { for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } };
  assign(env); t.after(() => assign(saved));
}

test("state restore preserves exact source facts and clocks through the real integrity triggers; identical input writes zero", async t => {
  staging(t);
  const input = source(), { db, query, queries } = await database(input);
  try {
    const result = await publishStateBucket(input, query);
    assert.equal(result.status, "PUBLISHED");
    const rows = await db.query<{ candidate: unknown; payload: unknown; at: string }>(`SELECT c.candidate,p.payload,p.promoted_at AS at
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.scope='US-AZ:voting-sites'`);
    assert.equal(rows.rows.length, 1);
    const parts = new CivicPayloadParts({ existing: async () => [], write: async () => assert.fail("readback cannot write"),
      read: async hashes => (await db.query<{ hash: string; payload: unknown }>("SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", [hashes])).rows });
    const candidate = decodeStateCandidate(await parts.load(rows.rows[0].candidate)) as RoutineCandidate;
    assert.deepEqual(candidate.readModel, input.payload);
    assert.equal((candidate.normalizedPayload as { projection: unknown }).projection, candidate.readModel);
    assert.equal(canonicalCivicDataHash(candidate.readModel), candidate.normalization.normalizedHash);
    const history = (await db.query<{ at: string; detail: string }>("SELECT at,detail FROM civic_data_candidate_events WHERE candidate_id=$1 ORDER BY sequence", [result.versionId])).rows;
    assert.equal(history.length, 6);
    const confirmation = JSON.parse(history[4].detail.slice("UNCHANGED_CONFIRMATION_V1 ".length));
    assert.equal(confirmation.versionId, result.versionId);
    assert.equal(confirmation.scope, "US-AZ:voting-sites");
    assert.equal(confirmation.readModelHash, candidate.normalization.normalizedHash);
    assert.match(history[0].detail, /^STATE_BUCKET_RESTORE_V1 /);
    assert.ok(history.every(event => new Date(event.at).toISOString() === NOW));
    queries.length = 0;
    assert.equal((await publishStateBucket(input, query)).status, "UNCHANGED");
    assert.equal(queries.length, 2);
    assert.ok(queries.every(sql => /^SELECT/.test(sql)));
    assert.ok(queries.every(sql => !/SELECT (?:c\\.candidate|p\\.payload)/.test(sql)), "no prior state graph is hydrated");
  } finally { await db.close(); }
});

test("state restore only replaces its own changed partition and preserves a normal publisher's pointer", async t => {
  staging(t);
  const input = source(), { db, query } = await database(input);
  try {
    const initial = await publishStateBucket(input, query);
    const changed = { ...input, inputHash: "b".repeat(64), payload: { ...input.payload as object, generatedAt: "2026-10-02" } };
    const next = await publishStateBucket(changed, query);
    assert.equal(next.status, "PUBLISHED");
    assert.notEqual(next.versionId, initial.versionId);
    let currentReads = 0;
    const raced = await publishStateBucket({ ...input, inputHash: "c".repeat(64) }, async (sql, params) => {
      if (sql.includes("STATE_BUCKET_CURRENT") && currentReads++ === 0) return [{ version_id: initial.versionId,
        detail: 'STATE_BUCKET_RESTORE_V1 ' + JSON.stringify({ inputHash: input.inputHash, scope: "US-AZ:voting-sites", recordClass: "VOTING_SITE" }) }];
      return query(sql, params);
    });
    assert.equal(raced.status, "CURRENT");
    assert.equal(raced.versionId, next.versionId, "the SQL compare-and-set protects a concurrent publication");
    const guarded = async (sql: string, params: readonly unknown[]) => sql.includes("STATE_BUCKET_CURRENT")
      ? [{ version_id: "normal-publisher", detail: "Fetched current official candidate records." }]
      : query(sql, params);
    assert.equal((await publishStateBucket(input, guarded)).status, "CURRENT");
    assert.equal((await db.query<{ current_version_id: string }>("SELECT current_version_id FROM civic_data_promotions WHERE scope='US-AZ:voting-sites'")).rows[0].current_version_id, next.versionId);
  } finally { await db.close(); }
});

test("state restore refuses stale or mismatched origin proof before writing any parts", async t => {
  staging(t);
  const input = source(), { db, query, queries } = await database(input);
  try {
    await assert.rejects(publishStateBucket({ ...input, originReadModelHash: "f".repeat(64) }, query), /ORIGIN_NOT_CURRENT_GOOD/);
    await assert.rejects(publishStateBucket({ ...input, receipt: { ...input.receipt, sourceId: "other" } }, query), /ORIGIN_INVALID/);
    await assert.rejects(publishStateBucket(input, async (sql, params) => sql.includes("STATE_BUCKET_ORIGIN_GUARD") ? [] : query(sql, params)), /ORIGIN_NOT_CURRENT_GOOD/);
    assert.ok(queries.every(sql => /^SELECT/.test(sql)));
    assert.ok(queries.every(sql => !/p\.payload|c\.candidate\s*(?:#>>|->)/.test(sql)), "child guards use immutable scalar origin metadata");
    await assert.rejects(db.query("UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{readModel}', '{}'::jsonb) WHERE id=$1", [input.originId]), /immutable|payload|mismatch/i);
    await assert.rejects(db.query("UPDATE civic_data_promotions SET payload='{}'::jsonb WHERE current_version_id=$1", [input.originId]), /payload|mismatch|distinct, non-backdated/i);
    assert.equal((await publishStateBucket(input, query)).status, "PUBLISHED");
  } finally { await db.close(); }
});
