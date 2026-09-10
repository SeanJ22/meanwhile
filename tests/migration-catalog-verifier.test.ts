import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  declaredMigrationCatalog,
  declaredMigrationCatalogCount,
} from "../lib/db/migration-catalog.ts";
import {
  appliedMigrationReceiptCensus,
  hasExactAppliedMigrationReceipt,
  type AppliedMigrations,
} from "../lib/db/applied-migrations.ts";

test("0026 catalog proof names every constraint, function, trigger, and index it installs", () => {
  const sql = readFileSync("lib/db/migrations/0026_lame_sunset_bain.sql", "utf8");
  const declared = declaredMigrationCatalog(sql);
  assert.equal(declared.tables.size, 0);
  assert.deepEqual(declared.indexes, ["civic_data_candidates_identity_idx"]);
  assert.deepEqual(declared.constraints.map(({ name }) => name), [
    "civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk",
    "civic_data_candidates_lkg_candidate_fk",
    "civic_data_promotions_current_candidate_fk",
    "civic_data_promotions_lkg_candidate_fk",
    "civic_data_candidate_events_positive_sequence",
    "civic_data_candidate_events_state_known",
    "civic_data_candidate_events_detail_nonempty",
    "civic_data_candidates_state_known",
    "civic_data_candidates_promotion_fields_coherent",
    "civic_data_candidates_envelope_identity_coherent",
    "civic_data_candidates_disposition_receipt_coherent",
    "civic_data_promotions_key_coherent",
    "civic_data_promotions_lkg_is_current",
    "civic_data_promotions_receipt_identity_coherent",
  ]);
  assert.deepEqual(declared.functions, [
    "enforce_civic_data_candidate_event_insert",
    "refuse_civic_data_candidate_event_mutation",
    "enforce_civic_data_candidate_mutation",
    "assert_civic_data_candidate_history_integrity",
    "enforce_civic_data_promotion_mutation",
    "assert_civic_data_promotion_integrity",
  ]);
  assert.deepEqual(declared.triggers, [
    { constraint: false, name: "civic_data_candidate_events_insert_integrity", table: "civic_data_candidate_events" },
    { constraint: false, name: "civic_data_candidate_events_append_only", table: "civic_data_candidate_events" },
    { constraint: false, name: "civic_data_candidates_immutable_evidence", table: "civic_data_candidates" },
    { constraint: true, name: "civic_data_candidates_history_matches_row", table: "civic_data_candidates" },
    { constraint: true, name: "civic_data_candidate_events_match_candidate", table: "civic_data_candidate_events" },
    { constraint: false, name: "civic_data_promotions_no_delete_or_rewrite", table: "civic_data_promotions" },
    { constraint: true, name: "civic_data_promotions_exact_candidate_proof", table: "civic_data_promotions" },
  ]);
  assert.equal(declaredMigrationCatalogCount(declared), 28);
});

test("catalog parser fails closed on duplicate declarations", () => {
  assert.throws(
    () => declaredMigrationCatalog('CREATE INDEX "same" ON "a" ("id"); CREATE INDEX "same" ON "b" ("id");'),
    /MIGRATION_CATALOG_DUPLICATE_INDEX/,
  );
});

test("exact migration receipt refuses missing hashes and duplicate physical rows", () => {
  const when = 1788910000000;
  const hash = "a".repeat(64);
  const exact: AppliedMigrations = {
    ok: true,
    appliedWhen: [when],
    appliedHashes: [{ when, hash }],
  };
  assert.deepEqual(appliedMigrationReceiptCensus(exact, when), { rowCount: 1, hashes: [hash] });
  assert.equal(hasExactAppliedMigrationReceipt(exact, when, hash), true);

  assert.equal(hasExactAppliedMigrationReceipt({
    ok: true,
    appliedWhen: [when],
    appliedHashes: [],
  }, when, hash), false, "a physical row with a missing/unusable hash must fail closed");

  assert.equal(hasExactAppliedMigrationReceipt({
    ok: true,
    appliedWhen: [when, when],
    appliedHashes: [{ when, hash }],
  }, when, hash), false, "an extra physical row must not disappear because its hash was unusable");

  assert.equal(hasExactAppliedMigrationReceipt({ ok: false, why: "unreadable" }, when, hash), false);
});
