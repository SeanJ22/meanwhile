import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { declaredMigrationCatalog } from "../lib/db/migration-catalog.ts";
import { declaredPhase } from "../lib/db/migration-phases.ts";

const root=resolve(import.meta.dirname,"..");
const sql=readFileSync(resolve(root,"lib/db/migrations/0030_publication_search_index.sql"),"utf8");
const config=readFileSync(resolve(root,"drizzle.config.ts"),"utf8");
const schema=readFileSync(resolve(root,"lib/db/admin-publication-search-schema.ts"),"utf8");

test("Admin index is an additive separate schema with declared catalog objects",()=>{
  assert.equal(declaredPhase("0030_publication_search_index")?.phase,"expand");
  assert.match(config,/admin-publication-search-schema\.ts/);
  assert.match(schema,/civicDataCandidates\.id/);
  const catalog=declaredMigrationCatalog(sql);
  assert.ok(catalog.tables.has("civic_data_publication_search"));
  assert.ok(catalog.indexes.includes("civic_data_publication_search_text_trgm_idx"));
  assert.ok(catalog.functions.includes("index_civic_publication_candidate"));
  assert.ok(catalog.triggers.some(row=>row.name==="civic_data_publication_search_from_promoted_event"&&row.constraint));
  assert.ok(catalog.triggers.some(row=>row.name==="civic_data_publication_search_immutable"));
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
  assert.match(sql,/pg_trigger_depth\(\) > 1/);
  assert.doesNotMatch(sql,/UPDATE "civic_data_candidates"|DELETE FROM "civic_data_candidates"/);
  assert.doesNotMatch(sql,/record_class" IN \(/i,"population cannot be narrowed to a chosen class list");
});
