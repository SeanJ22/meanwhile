import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  UNCHANGED_CONFIRMATION_PREFIX,
  UNCHANGED_CONFIRMATION_SOURCES_PREFIX,
  unchangedConfirmationShapeIssue,
} from "../lib/civic-data/unchanged-confirmation.ts";
import { declaredPhase } from "../lib/db/migration-phases.ts";

/*
 * 0029 widens exactly one rule: the event-insert trigger also accepts the
 * typed no-change receipt on the pointed version. These guards keep it that
 * narrow: every 0026 rule survives, the refusal the store keys on is unchanged,
 * and the receipt is bound to the same facts the store's guarded insert checks.
 */

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "lib", "db", "migrations");
const SQL_0026 = readFileSync(join(MIGRATIONS, "0026_lame_sunset_bain.sql"), "utf8");
const SQL_0029 = readFileSync(join(MIGRATIONS, "0029_unchanged_confirmation_receipts.sql"), "utf8");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}()`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = sql.indexOf("$pdc_event_insert$;", start);
  assert.ok(end > start, `${name} is closed`);
  return sql.slice(start, end);
}

const EVENT_RULE = "enforce_civic_data_candidate_event_insert";
const before = functionBody(SQL_0026, EVENT_RULE);
const after = functionBody(SQL_0029, EVENT_RULE);

/** The branch of `after` between one ELSIF opener and the next. */
function branch(prefix: string): string {
  const start = after.indexOf(`ELSIF left(NEW."detail", length('${prefix}')) = '${prefix}' THEN`);
  assert.ok(start >= 0, `a branch for ${prefix.trim()}`);
  const next = after.indexOf("ELSIF", start + 5);
  const elseAt = after.indexOf("      ELSE\n", start);
  const end = [next, elseAt].filter((at) => at > start).sort((a, b) => a - b)[0];
  return after.slice(start, end);
}

test("0029 replaces the event-insert rule and nothing else", () => {
  const statements = SQL_0029.replace(/--[^\n]*\n/g, "").trim();
  assert.equal((statements.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.doesNotMatch(statements, /\b(ALTER|DROP|CREATE TABLE|CREATE INDEX|CREATE TRIGGER|INSERT|UPDATE|DELETE)\b/);
  assert.equal(declaredPhase("0029_unchanged_confirmation_receipts")?.phase, "expand");
});

test("every 0026 event rule survives in 0029, line for line", () => {
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const kept = new Set(lines(after));
  // The one line 0029 rewrites: the readback test becomes the first branch of three.
  const rewritten = `IF left(NEW."detail", length('READER_PROJECTION_READBACK_V2 ')) <> 'READER_PROJECTION_READBACK_V2 ' THEN`;
  const missing = lines(before).filter((line) => line !== rewritten && !kept.has(line));
  assert.deepEqual(missing, []);
  assert.ok(lines(before).includes(rewritten), "0026 held the rewritten line");
});

test("an untyped repeat is refused with the message the store reads as 'not yet migrated'", () => {
  const refusal = "repeated PROMOTED event is not typed Reader evidence";
  const elseBranch = after.slice(after.lastIndexOf("      ELSE\n"));
  assert.match(elseBranch, new RegExp(`RAISE EXCEPTION 'candidate % ${refusal}'.*ERRCODE = '23514'`));
  const store = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  assert.ok(store.includes(`row.code === "23514"`) && store.includes(`"${refusal}"`), "the store keys STORE_REFUSED on exactly this refusal");
});

test("the receipt branch binds the same facts the store's guarded insert checks", () => {
  assert.equal(UNCHANGED_CONFIRMATION_PREFIX, "UNCHANGED_CONFIRMATION_V1 ");
  const receipt = branch(UNCHANGED_CONFIRMATION_PREFIX);
  for (const guard of [
    `confirmation->>'kind' IS DISTINCT FROM 'UNCHANGED_CONFIRMATION_V1'`,
    `confirmation->>'versionId' IS DISTINCT FROM candidate_row."id"`,
    `confirmation->>'readModelHash' IS DISTINCT FROM candidate_row."normalized_hash"`,
    `confirmation->>'pointerKey' IS DISTINCT FROM candidate_row."record_class" || ':' || candidate_row."scope"`,
    `candidate_row."candidate" ? 'bootstrapImport'`,
    `(confirmation->>'observedAt')::timestamptz IS DISTINCT FROM NEW."at"`,
    `(confirmation#>>'{retrieval,retrievedAt}')::timestamptz > NEW."at"`,
    `pointer."current_version_id" = candidate_row."id"`,
    `pointer."last_known_good_version_id" = candidate_row."id"`,
  ]) assert.ok(receipt.includes(guard), guard);
  // The bases the database admits are exactly the ones the receipt type names.
  const basisList = /coalesce\(confirmation->>'basis', ''\) NOT IN \(([^)]*)\)/.exec(receipt)?.[1] ?? "";
  const admitted = basisList.split(",").map((value) => value.trim().replace(/'/g, "")).sort();
  const shapeOk = (basis: string) => unchangedConfirmationShapeIssue({
    kind: "UNCHANGED_CONFIRMATION_V1", sourceId: "s", recordClass: "MEETING", scope: "x", pointerKey: "MEETING:x",
    versionId: "cv-1", readModelHash: "a".repeat(64), basis, parserVersion: "p",
    retrieval: { requestedUrl: "https://a", finalUrl: "https://a", httpStatus: 200, rawHash: "b".repeat(64), retrievedAt: "2026-09-24T00:00:00.000Z" },
    stamps: basis === "PUBLISHER_STAMPS_UNCHANGED" ? [{ key: "k", held: { m: "1" }, fetched: { m: "1" } }] : null,
    observedAt: "2026-09-24T00:00:01.000Z",
  }) === null;
  assert.deepEqual(admitted, ["CHANGE_SET_UNCHANGED", "PUBLISHER_STAMPS_UNCHANGED", "READ_MODEL_RECOMPUTED"]);
  for (const basis of admitted) assert.ok(shapeOk(basis), `${basis} is a basis the receipt type accepts`);
  assert.equal(shapeOk("GUESSED"), false);
  // Casts only after every value's shape is checked.
  const shapes = receipt.indexOf("Shapes first");
  assert.ok(shapes > 0 && receipt.indexOf("::timestamptz", shapes) > receipt.indexOf("THEN", receipt.indexOf("IF jsonb_typeof(confirmation)")));
});

test("the sources event is admitted only directly after its own receipt, at the receipt's instant", () => {
  assert.equal(UNCHANGED_CONFIRMATION_SOURCES_PREFIX, "UNCHANGED_CONFIRMATION_SOURCES_V1 ");
  const sources = branch(UNCHANGED_CONFIRMATION_SOURCES_PREFIX);
  for (const guard of [
    `left(prior_event."detail", length('UNCHANGED_CONFIRMATION_V1 ')) IS DISTINCT FROM 'UNCHANGED_CONFIRMATION_V1 '`,
    `prior_event."at" IS DISTINCT FROM NEW."at"`,
    `confirmation->>'versionId' IS DISTINCT FROM candidate_row."id"`,
    `jsonb_typeof(confirmation->'retainedSourceResponses') IS DISTINCT FROM 'array'`,
  ]) assert.ok(sources.includes(guard), guard);
});

test("R23: a derived version's receipt may omit its HTTP status only on its own derived route, in SQL and in TS alike", () => {
  const receipt = branch(UNCHANGED_CONFIRMATION_PREFIX);
  assert.ok(receipt.includes(`confirmation#>>'{retrieval,requestedUrl}' = 'derived:' || candidate_row."source_id" || ':' || candidate_row."scope"`), "the null status is bound to this candidate's own derived route");
  assert.ok(receipt.includes(`jsonb_typeof(confirmation#>'{retrieval,httpStatus}') = 'null'`));
  // A missing key must refuse too: the exception is wrapped so an unknown reads as false.
  assert.match(receipt, /OR NOT coalesce\(\s*jsonb_typeof\(confirmation#>'\{retrieval,httpStatus\}'\) = 'number'/);
  assert.ok(receipt.includes(`(jsonb_typeof(confirmation#>'{retrieval,httpStatus}') = 'number'\n            AND (confirmation#>>'{retrieval,httpStatus}')::numeric NOT BETWEEN 200 AND 299)`), "a status, when present, is still 2xx");
  const shape = (retrieval: Record<string, unknown>, scope = "US-AZ:derived") => unchangedConfirmationShapeIssue({
    kind: "UNCHANGED_CONFIRMATION_V1", sourceId: "derived-meeting-family", recordClass: "MEETING", scope, pointerKey: `MEETING:${scope}`,
    versionId: "cv-1", readModelHash: "a".repeat(64), basis: "READ_MODEL_RECOMPUTED", parserVersion: "p",
    retrieval: { rawHash: "b".repeat(64), retrievedAt: "2026-09-24T00:00:00.000Z", ...retrieval },
    stamps: null, observedAt: "2026-09-24T00:00:01.000Z",
  });
  assert.equal(shape({ requestedUrl: "derived:derived-meeting-family:US-AZ:derived", finalUrl: null, httpStatus: null }), null, "its own derived route");
  assert.equal(shape({ requestedUrl: "derived:derived-meeting-family:US-AZ:derived", finalUrl: "derived:derived-meeting-family:US-AZ:derived", httpStatus: null }), null);
  assert.notEqual(shape({ requestedUrl: "derived:derived-meeting-family:US-NH:derived", finalUrl: null, httpStatus: null }), null, "another scope's route");
  assert.notEqual(shape({ requestedUrl: "https://city.example.gov/cal.ics", finalUrl: null, httpStatus: null }), null, "a fetched route must name its status");
  assert.notEqual(shape({ requestedUrl: "derived:derived-meeting-family:US-AZ:derived", finalUrl: "https://elsewhere.example", httpStatus: null }), null, "no final URL of its own");
  assert.notEqual(shape({ requestedUrl: "https://a", finalUrl: "https://a", httpStatus: 404 }), null, "a non-2xx status");
  assert.equal(shape({ requestedUrl: "https://a", finalUrl: "https://a", httpStatus: 200 }), null);
});
