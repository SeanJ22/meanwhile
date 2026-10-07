import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { declaredPhase } from "../lib/db/migration-phases.ts";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATION_PATH = join(ROOT, "lib", "db", "migrations", "0026_lame_sunset_bain.sql");
const SNAPSHOT_PATH = join(ROOT, "lib", "db", "migrations", "meta", "0026_snapshot.json");
const SCHEMA_PATH = join(ROOT, "lib", "db", "schema.ts");

test("0027 preserves the complete history firewall while resolving each trigger row separately", () => {
  const original = readFileSync(MIGRATION_PATH, "utf8");
  const functionSql = original.split("--> statement-breakpoint").find((statement) =>
    statement.includes("CREATE OR REPLACE FUNCTION assert_civic_data_candidate_history_integrity()"));
  assert.ok(functionSql);
  const broken = `checked_candidate_id := CASE WHEN TG_TABLE_NAME = 'civic_data_candidates' THEN NEW."id" ELSE NEW."candidate_id" END;`;
  const fixed = `IF TG_TABLE_NAME = 'civic_data_candidates' THEN
    checked_candidate_id := NEW."id";
  ELSE
    checked_candidate_id := NEW."candidate_id";
  END IF;`;
  assert.equal(functionSql.split(broken).length, 2);
  const repair = readFileSync(join(ROOT, "lib/db/migrations/0027_pdc_candidate_history_shape.sql"), "utf8")
    .replace(/^--[^\n]*\n/gm, "").trim();
  assert.equal(repair, functionSql.replace(broken, fixed).trim(), "the forward migration must retain every original assertion and change no data");
  assert.equal(declaredPhase("0027_pdc_candidate_history_shape")?.phase, "expand");
});

const FIREWALLS = [
  ["noncontiguous event history", /min\("sequence"\)[\s\S]*max\("sequence"\)[\s\S]*count\(\*\)/],
  ["backward event clock", /lag\("at"\) OVER \(PARTITION BY "candidate_id" ORDER BY "sequence"\)/],
  ["invalid or future operational clock", /durable operational, validation, or promotion clock is invalid or materially in the future/],
  ["row/latest-event disagreement", /latest_event\."state" IS DISTINCT FROM candidate\."state"/],
  ["invalid candidate LKG reference", /candidate\."last_known_good_version_id"[\s\S]*base\."state" <> 'PROMOTED'/],
  ["pointer payload drift", /promotion\."payload" IS DISTINCT FROM candidate\."candidate"->'readModel'/],
  ["pointer receipt drift", /promotion\."validation_receipt" IS DISTINCT FROM candidate\."validation_receipt"/],
  ["pointer without atomic event", /promoted_event\."at" = promotion\."promoted_at"[\s\S]*first_promoted\."sequence"/],
  ["orphan event", /civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk/],
  ["cross-contract candidate LKG", /civic_data_candidates_lkg_candidate_fk/],
  ["cross-contract current pointer", /civic_data_promotions_current_candidate_fk/],
  ["cross-contract LKG pointer", /civic_data_promotions_lkg_candidate_fk/],
  ["zero or negative event sequence", /civic_data_candidate_events_positive_sequence/],
  ["unknown event state", /civic_data_candidate_events_state_known/],
  ["unknown candidate state", /civic_data_candidates_state_known/],
  ["candidate envelope/scalar drift", /civic_data_candidates_envelope_identity_coherent/],
  ["candidate receipt/disposition drift", /civic_data_candidates_disposition_receipt_coherent/],
  ["pointer key drift", /civic_data_promotions_key_coherent/],
  ["current/LKG divergence", /civic_data_promotions_lkg_is_current/],
  ["pointer receipt identity drift", /civic_data_promotions_receipt_identity_coherent/],
  ["noncontiguous future insert", /CREATE TRIGGER civic_data_candidate_events_insert_integrity/],
  ["disposition event/receipt clock mismatch", /disposition event clock does not equal its validation receipt/],
  ["event rewrite or erasure", /CREATE TRIGGER civic_data_candidate_events_append_only/],
  ["candidate evidence rewrite or erasure", /CREATE TRIGGER civic_data_candidates_immutable_evidence/],
  ["candidate state without matching event", /CREATE CONSTRAINT TRIGGER civic_data_candidates_history_matches_row/],
  ["candidate row/receipt clock mismatch", /terminal\/validation row is not bound to its exact disposition event clock/],
  ["legacy clock exception requires exact re-attestation ancestry", /legacy_reattested_predecessor_ids[\s\S]*TRUSTED_LKG_REATTESTATION[\s\S]*predecessorCandidateRecordSha256/],
  ["new disposition clocks require canonical UTC", /enforce_civic_data_candidate_event_insert[\s\S]*validation receipt clock is not canonical UTC[\s\S]*\$pdc_event_insert\$/],
  [
    "historical repeated promotion is typed Reader evidence",
    /FOR repeated_event IN[\s\S]*READER_PROJECTION_READBACK_V2[\s\S]*repeated PROMOTED event is not typed Reader evidence/,
  ],
  [
    "historical Reader evidence retains exact candidate and projection identity",
    /repeated_evidence->>'versionId' IS DISTINCT FROM repeated_event\."candidate_id"[\s\S]*pointer\."promoted_at" >= repeated_event\."at"/,
  ],
  [
    "legacy aggregate retirement is one exact historical exception",
    /PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT[\s\S]*replacementPartitionCount[\s\S]*absentPartitionCount[\s\S]*<> 124[\s\S]*unique terminal authority-transfer receipt/,
  ],
  [
    "legacy retirement receipt scalars keep their exact JSON types",
    /jsonb_each\(repeated_evidence\) scalar[\s\S]*legacyPointerSha256[\s\S]*jsonb_typeof\(scalar\."value"\) IS DISTINCT FROM 'string'[\s\S]*legacyHistoryEventCount[\s\S]*jsonb_typeof\(scalar\."value"\) IS DISTINCT FROM 'number'/,
  ],
  [
    "legacy retirement clock is canonical millisecond UTC",
    /repeated_evidence->>'retiredAt'[\s\S]*\[0-9\]\{3\}Z\$/,
  ],
  [
    "replacement history manifest has typed scalar members",
    /jsonb_typeof\(witness->'scope'\) IS DISTINCT FROM 'string'[\s\S]*jsonb_typeof\(witness->'historyLastSequence'\) IS DISTINCT FROM 'number'/,
  ],
  [
    "replacement history manifest names every current permanent authority",
    /jsonb_array_elements\(repeated_evidence->'replacementHistoryWitnesses'\) witness[\s\S]*JOIN "civic_data_promotions" permanent[\s\S]*permanent\."current_version_id" = witness->>'versionId'[\s\S]*permanent\."last_known_good_version_id" = witness->>'versionId'[\s\S]*\) <> 83/,
  ],
  ["event state without matching candidate", /CREATE CONSTRAINT TRIGGER civic_data_candidate_events_match_candidate/],
  ["promotion deletion, identity rewrite, or backdate", /CREATE TRIGGER civic_data_promotions_no_delete_or_rewrite/],
  ["promotion not bound to exact candidate proof", /CREATE CONSTRAINT TRIGGER civic_data_promotions_exact_candidate_proof/],
  [
    "obsolete aggregate authority survives cutover",
    /\$pdc_authority_transfer\$[\s\S]*"key" = 'MEETING:supported-bodies'[\s\S]*"record_class" = 'MEETING'[\s\S]*"scope" = 'supported-bodies'/,
  ],
  [
    "obsolete aggregate history lacks a unique durable retirement receipt",
    /\$pdc_authority_transfer\$[\s\S]*obsolete aggregate history has no unique retirement receipt/,
  ],
] as const satisfies readonly (readonly [string, RegExp])[];

const PREFLIGHT_DDL_PARITY = {
  civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk:
    /LEFT JOIN "civic_data_candidates" candidate ON candidate\."id" = event\."candidate_id"[\s\S]*candidate\."id" IS NULL/,
  civic_data_candidates_lkg_candidate_fk:
    /LEFT JOIN "civic_data_candidates" base[\s\S]*candidate\."last_known_good_version_id" IS NOT NULL/,
  civic_data_promotions_current_candidate_fk:
    /LEFT JOIN "civic_data_candidates" candidate[\s\S]*promotion\."current_version_id"/,
  civic_data_promotions_lkg_candidate_fk:
    /promotion\."current_version_id" IS DISTINCT FROM promotion\."last_known_good_version_id"/,
  civic_data_candidate_events_positive_sequence: /event\."sequence" <= 0/,
  civic_data_candidate_events_state_known: /event\."state" NOT IN \('FETCHED',[\s\S]*'PROMOTED'\)/,
  civic_data_candidate_events_detail_nonempty: /length\(btrim\(event\."detail"\)\) <= 0/,
  civic_data_candidates_state_known: /candidate\."state" NOT IN \('FETCHED',[\s\S]*'PROMOTED'\)/,
  civic_data_candidates_promotion_fields_coherent:
    /candidate\."state" = 'PROMOTED'[\s\S]*candidate\."promoted_version_id" IS NOT DISTINCT FROM candidate\."id"[\s\S]*candidate\."state" <> 'PROMOTED'/,
  civic_data_candidates_envelope_identity_coherent:
    /jsonb_typeof\(candidate\."candidate"\)[\s\S]*candidate\."candidate"->'identities'[\s\S]*candidate\."identity"/,
  civic_data_candidates_disposition_receipt_coherent:
    /candidate\."validation_receipt"->'contractVersion'[\s\S]*jsonb_path_query_first\(candidate\."validation_receipt"/,
  civic_data_promotions_key_coherent:
    /promotion\."key" <> promotion\."record_class" \|\| ':' \|\| promotion\."scope"/,
  civic_data_promotions_lkg_is_current:
    /promotion\."current_version_id" <> promotion\."last_known_good_version_id"/,
  civic_data_promotions_receipt_identity_coherent:
    /jsonb_typeof\(promotion\."validation_receipt"\)[\s\S]*promotion\."validation_receipt"->'contractVersion'[\s\S]*promotion\."promoted_at"/,
} as const satisfies Readonly<Record<string, RegExp>>;

function missingFirewalls(sql: string): string[] {
  return FIREWALLS.flatMap(([name, pattern]) => pattern.test(sql) ? [] : [name]);
}

test("PDC 0026 refuses every planted durable-corruption class and never repairs data in place", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  assert.deepEqual(missingFirewalls(migration), []);
  assert.ok(
    migration.indexOf("DO $pdc_preflight$") < migration.indexOf("CREATE UNIQUE INDEX"),
    "the read-only corruption census must run before any 0026 DDL",
  );
  const integrityPreflightEnd = migration.indexOf("$pdc_preflight$;--> statement-breakpoint");
  const cutoverPreflight = migration.indexOf("DO $pdc_authority_transfer$");
  const firstDdl = migration.indexOf("CREATE UNIQUE INDEX");
  assert.ok(
    integrityPreflightEnd >= 0 && integrityPreflightEnd < cutoverPreflight && cutoverPreflight < firstDdl,
    "the aggregate-authority refusal must be a separate second pre-DDL block after the reusable integrity census",
  );
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|DELETE\s+FROM)\s+"civic_data_(?:candidates|candidate_events|promotions)"/i,
    "a contract migration may refuse corrupt production rows, never silently repair or erase them",
  );
  assert.equal(
    migration.match(/validation receipt clock is not canonical UTC/g)?.length,
    3,
    "the immediate event door and both deferred disposition branches must reject new legacy clock shapes",
  );
  assert.deepEqual(declaredPhase("0026_lame_sunset_bain"), {
    phase: "contract",
    why:
      "Adds fail-closed civic-data identity, state, pointer/LKG and append-only event constraints. " +
      "Existing rows are scanned and nonconforming writes begin failing, so the conforming PDC " +
      "store code must be serving and the read-only integrity census must pass before application.",
  });

  // A generated-schema refresh must not silently drop a handwritten trigger or preflight predicate.
  for (const [name, pattern] of FIREWALLS) {
    const planted = migration.replace(pattern, "/* PLANTED_FIREWALL_REMOVAL */");
    assert.ok(missingFirewalls(planted).includes(name), `${name}: planted firewall loss was not detected`);
  }
});

test("PDC 0026 keeps generated schema metadata aligned with the database-level identity constraints", () => {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as {
    readonly tables: Readonly<Record<string, {
      readonly foreignKeys: Readonly<Record<string, unknown>>;
      readonly checkConstraints: Readonly<Record<string, unknown>>;
    }>>;
  };
  const candidates = snapshot.tables["public.civic_data_candidates"];
  const events = snapshot.tables["public.civic_data_candidate_events"];
  const promotions = snapshot.tables["public.civic_data_promotions"];
  assert.ok(candidates && events && promotions, "0026 snapshot omits a canonical civic-data table");
  assert.ok("civic_data_candidates_lkg_candidate_fk" in candidates.foreignKeys);
  assert.ok("civic_data_candidates_disposition_receipt_coherent" in candidates.checkConstraints);
  assert.ok("civic_data_candidates_envelope_identity_coherent" in candidates.checkConstraints);
  assert.ok("civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk" in events.foreignKeys);
  assert.ok("civic_data_candidate_events_positive_sequence" in events.checkConstraints);
  assert.ok("civic_data_promotions_current_candidate_fk" in promotions.foreignKeys);
  assert.ok("civic_data_promotions_lkg_candidate_fk" in promotions.foreignKeys);
  assert.ok("civic_data_promotions_receipt_identity_coherent" in promotions.checkConstraints);
  for (const name of [
    "civic_data_candidates_lkg_candidate_fk",
    "civic_data_candidates_disposition_receipt_coherent",
    "civic_data_candidates_envelope_identity_coherent",
    "civic_data_promotions_current_candidate_fk",
    "civic_data_promotions_lkg_candidate_fk",
    "civic_data_promotions_receipt_identity_coherent",
  ]) assert.match(schema, new RegExp(name));
});

test("PDC 0026 database triggers preserve legal state order, immutable evidence, and current Reader binding", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(migration, /prior_event\."state" = 'FETCHED'[\s\S]*NEW\."state" IN \('NORMALIZED'/);
  assert.match(migration, /prior_event\."state" = 'NORMALIZED'[\s\S]*NEW\."state" IN \('VALIDATED'/);
  assert.match(migration, /prior_event\."state" = 'VALIDATED'[\s\S]*NEW\."state" IN \('PROMOTED'/);
  assert.match(migration, /prior_event\."state" = 'PROMOTED' AND NEW\."state" = 'PROMOTED'/);
  assert.match(migration, /READER_PROJECTION_READBACK_V2/);
  assert.match(migration, /pointer\."current_version_id" = candidate_row\."id"/);
  assert.match(migration, /pointer\."last_known_good_version_id" = candidate_row\."id"/);
  assert.match(
    migration,
    /FOR repeated_event IN[\s\S]*READER_PROJECTION_READBACK_V2[\s\S]*PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT/,
    "preexisting repeated PROMOTED history must satisfy the same typed rule plus the one exact PDC retirement exception",
  );
  assert.match(migration, /replacementPartitionCount'\)::integer \+[\s\S]*absentPartitionCount'\)::integer <> 124/);
  assert.match(
    migration,
    /legacyHistoryEventCount', ''\) !~ '\^\(\[4-9\]\|\[1-9\]\[0-9\]\+\)\$'/,
    "the retained legacy witness must include FETCHED through PROMOTED",
  );
  assert.match(migration, /NEW\."at" IS DISTINCT FROM receipt_at/);
  assert.match(migration, /NEW\."at" > clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.doesNotMatch(
    migration,
    /candidate_row\."retrieved_at" > clock_timestamp\(\) \+ interval '5 minutes'/,
    "a malformed future acquisition must remain durable refusal evidence rather than vanish at insert",
  );
  assert.doesNotMatch(
    migration,
    /first_event\."at" < candidate(?:_row)?\."retrieved_at"/,
    "the local attempt event may precede the untrusted acquisition instant that it refuses",
  );
  for (const immutable of [
    "id", "source_id", "record_class", "scope", "acquisition_succeeded", "raw_hash",
    "normalized_hash", "retrieved_at", "source_through", "parser_version", "identity", "candidate",
  ]) assert.match(migration, new RegExp(`NEW\\.\"${immutable}\"`), `${immutable} is not protected as immutable evidence`);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/g);
});

test("PDC 0026 preflight has exact predicate coverage for every validating ADD constraint", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const preflightEnd = migration.indexOf("END\n$pdc_preflight$");
  assert.ok(preflightEnd > 0, "0026 preflight boundary is missing");
  const preflight = migration.slice(0, preflightEnd);
  const addedConstraints = [...migration.matchAll(/ADD CONSTRAINT "([^"]+)"/g)]
    .map((match) => match[1]!)
    .sort();
  assert.deepEqual(
    Object.keys(PREFLIGHT_DDL_PARITY).sort(),
    addedConstraints,
    "every validating ADD constraint must have a named pre-DDL historical-row predicate",
  );
  for (const [constraint, predicate] of Object.entries(PREFLIGHT_DDL_PARITY)) {
    assert.match(preflight, predicate, `${constraint} has no matching historical-row preflight predicate`);
  }
  assert.match(
    preflight,
    /GROUP BY "id", "source_id", "record_class", "scope" HAVING count\(\*\) > 1/,
    "the unique composite identity index also requires an exact preflight predicate",
  );
});
