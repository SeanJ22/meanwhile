import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { declaredMigrationCatalog } from "../lib/db/migration-catalog.ts";
import { declaredPhase } from "../lib/db/migration-phases.ts";

const root=resolve(import.meta.dirname,"..");
const setupSql=readFileSync(resolve(root,"lib/db/migrations/0030_publication_search_index.sql"),"utf8");
const backfillSql=readFileSync(resolve(root,"lib/db/migrations/0031_publication_search_backfill.sql"),"utf8");
const activationSql=readFileSync(resolve(root,"lib/db/migrations/0032_publication_search_activation.sql"),"utf8");
const sql=[setupSql,backfillSql,activationSql].join("\n");
const config=readFileSync(resolve(root,"drizzle.config.ts"),"utf8");
const schema=readFileSync(resolve(root,"lib/db/admin-publication-search-schema.ts"),"utf8");

test("Admin index is an additive separate schema with declared catalog objects",()=>{
  assert.equal(declaredPhase("0030_publication_search_index")?.phase,"expand");
  assert.equal(declaredPhase("0031_publication_search_backfill")?.phase,"expand");
  assert.equal(declaredPhase("0032_publication_search_activation")?.phase,"expand");
  assert.match(config,/admin-publication-search-schema\.ts/);
  assert.match(schema,/civicDataCandidates\.id/);
  const setup=declaredMigrationCatalog(setupSql);
  const backfill=declaredMigrationCatalog(backfillSql);
  const activation=declaredMigrationCatalog(activationSql);
  assert.ok(setup.tables.has("civic_data_publication_search"));
  assert.ok(setup.tables.has("civic_data_publication_search_chunks"));
  assert.ok(setup.tables.has("civic_data_publication_search_readiness"));
  assert.ok(backfill.indexes.includes("civic_data_publication_search_chunk_trgm_idx"));
  assert.ok(setup.functions.includes("index_civic_publication_candidate"));
  assert.ok(activation.triggers.some(row=>row.name==="civic_data_publication_search_from_promoted_event"&&row.constraint));
  assert.ok(activation.triggers.some(row=>row.name==="civic_data_publication_search_immutable"));
  assert.ok(activation.triggers.some(row=>row.name==="civic_data_publication_search_chunks_immutable"));
  assert.ok(activation.triggers.some(row=>row.name==="civic_data_publication_search_readiness_immutable"));
});

test("historical and future rows derive from first GOOD/PROMOTED candidate evidence",()=>{
  assert.match(sql,/CREATE CONSTRAINT TRIGGER civic_data_publication_search_from_promoted_event[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql,/NEW\."sequence" = first_sequence/);
  assert.match(sql,/source_row\."state" <> 'PROMOTED'/);
  assert.match(sql,/source_row\."validation_receipt"->>'decision' IS DISTINCT FROM 'GOOD'/);
  assert.match(sql,/WITH source AS MATERIALIZED/);
  assert.match(sql,/jsonb_typeof\(c\."candidate"->'civicRecords'\) = 'array'/);
  assert.match(sql,/jsonb_build_object\('key','legacy-document','record',c\."candidate"->'readModel'\)/);
  assert.match(sql,/CREATE TRIGGER civic_data_publication_search_immutable BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql,/CREATE TRIGGER civic_data_publication_search_chunks_immutable BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql,/pg_trigger_depth\(\) > 1/);
  assert.doesNotMatch(sql,/UPDATE "civic_data_candidates"|DELETE FROM "civic_data_candidates"/);
  assert.doesNotMatch(sql,/record_class" IN \(/i,"population cannot be narrowed to a chosen class list");
});

test("bounded chunks retain the full source text and the event lock is taken only after the long build",()=>{
  assert.match(schema,/civic_data_publication_search_chunks/);
  assert.match(schema,/foreignKey\(\{ columns: \[table\.versionId, table\.recordKey\]/);
  assert.match(sql,/publication_search_full_text\("version_id","record_key","record"\)/);
  assert.match(setupSql,/CREATE OR REPLACE FUNCTION publication_search_chunks_from_text/);
  assert.match(setupSql,/raw_start \+ 16384/);
  assert.match(setupSql,/raw_start \+ 15872/);
  assert.match(setupSql,/get_byte\(bytes, safe_start\) BETWEEN 128 AND 191/);
  assert.match(setupSql,/get_byte\(bytes, safe_end\) BETWEEN 128 AND 191/);
  assert.match(sql,/publication_search_chunks_from_text\(full_texts\.full_text\)/);
  assert.match(sql,/CREATE INDEX "civic_data_publication_search_chunk_trgm_idx"[\s\S]*CREATE CONSTRAINT TRIGGER civic_data_publication_search_from_promoted_event[\s\S]*publication_search_catchup/);
  assert.doesNotMatch(backfillSql,/REFERENCES "public"\."civic_data_candidates"|CREATE CONSTRAINT TRIGGER/);
  assert.doesNotMatch(setupSql,/WITH source AS MATERIALIZED|CREATE CONSTRAINT TRIGGER/);
  assert.match(sql,/NOT EXISTS \(SELECT 1 FROM "civic_data_publication_search" p WHERE p\."version_id" = c\."id"\)/);
  assert.doesNotMatch(schema,/searchText:/);
  assert.match(sql,/IF candidate IS NULL OR char_length\(candidate\) > 2048 THEN RETURN NULL/);
  assert.match(sql,/RETURN left\(nullif\(btrim\(candidate\), ''\), 300\)/);
});

test("backfill certifies exact chunks before a final READY marker can be committed",()=>{
  assert.match(backfillSql,/mismatched_chunks[\s\S]*actual\."search_chunk" IS DISTINCT FROM chunks\.search_chunk/);
  assert.match(backfillSql,/VALUES \('publication-history',2,'BACKFILLED',now\(\),measured_parents,measured_chunks\)/);
  assert.match(activationSql,/"schema_version" = 2 AND "status" = 'BACKFILLED'/);
  assert.match(activationSql,/publication_search_catchup[\s\S]*catch-up lacks a chunk/);
  assert.match(activationSql,/UPDATE "civic_data_publication_search_readiness" SET "status" = 'READY'/);
  assert.doesNotMatch(setupSql,/status.*READY|status.*BACKFILLED/);
});
