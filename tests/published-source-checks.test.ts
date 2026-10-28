import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { readPublishedSourceChecks, recordPublishedSourceCheck, type RecordPublishedSourceCheck } from "../lib/civic-data/source-checks.ts";
import { votingSourceCheckOverlay } from "../lib/ballot/voting-source-checks.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const sourceUrl = "https://elections.example.gov/locations.csv", jurisdiction = "ocd-division/country:us/state:az/county:example";
const key = `${jurisdiction}|${sourceUrl}`, hash = "a".repeat(64), at = "2026-10-26T12:00:00.000Z";
const check: RecordPublishedSourceCheck = { sourceId: "voting-sites", recordClass: "VOTING_SITE", scope: "US-AZ:voting-sites",
  pointerVersionId: "v1", sourceKey: key, rawHash: hash, parserVersion: "official-voting-sites/4", checkedAt: at,
  sourceUrls: [sourceUrl], jurisdictionIds: [jurisdiction] };

test("a keyed source check follows the same source hash across unrelated promotions and refuses a changed source, parser or pointer", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,
      acquisition_succeeded boolean,parser_version text,candidate jsonb,raw_hash text);
      CREATE TABLE civic_data_promotions(record_class text,scope text,source_id text,current_version_id text,last_known_good_version_id text,payload jsonb);`);
    await db.exec("CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
    for (const sql of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint")
      .filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node)\(/.test(sql))) await db.exec(sql);
    await db.exec(readFileSync(new URL("../lib/db/migrations/DB-05_source_checks.sql", import.meta.url), "utf8"));
    const query = async (text: string, params: readonly unknown[]) => (await db.query<Record<string, unknown>>(text, [...params])).rows;
    await db.query("INSERT INTO civic_data_candidates VALUES('v1',$1,$2,$3,'PROMOTED',true,$4,$5::jsonb,$6)",
      [check.sourceId, check.recordClass, check.scope, check.parserVersion, JSON.stringify({ retrieval: { rawHashBasis: "SOURCE_CONTENT_V1" } }), "c".repeat(64)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,'v1','v1',$4::jsonb)",
      [check.recordClass, check.scope, check.sourceId, JSON.stringify({ sourceManifestVersion: 1, sourceHashes: { [key]: hash } })]);
    assert.equal(await recordPublishedSourceCheck(query, { ...check, pointerVersionId: "old" }), false);
    assert.equal(await recordPublishedSourceCheck(query, { ...check, rawHash: "b".repeat(64) }), false);
    assert.equal(await recordPublishedSourceCheck(query, check), true);
    const selected: unknown[][] = [];
    const read = async (keys = [key]) => readPublishedSourceChecks(async (text, params) => {
      selected.push([...params]); return query(text, params);
    }, check.recordClass, check.scope, keys);
    assert.equal((await read())[0]!.checkedAt, at);
    assert.deepEqual(selected.at(-1)?.[2], [key], "only the requested source key is read");
    const rootPart = "1".repeat(64), hashesPart = "2".repeat(64);
    await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2::jsonb),($3,$4::jsonb)", [rootPart,
      JSON.stringify({ kind: "object", value: { sourceManifestVersion: 1, sourceHashes: { $civicPayloadPart: hashesPart } } }),
      hashesPart, JSON.stringify({ kind: "object", value: { [key]: hash } })]);
    await db.query("UPDATE civic_data_promotions SET payload=$1::jsonb", [JSON.stringify({ $civicPayloadPart: rootPart })]);
    assert.equal((await read())[0]!.checkedAt, at, "large encoded package and hash-map parts keep the same exact source guard");
    assert.equal(await recordPublishedSourceCheck(query, check), true);
    assert.deepEqual(await read(["another-source"]), []);
    await db.query("INSERT INTO civic_data_candidates SELECT 'v2',source_id,record_class,scope,state,acquisition_succeeded,parser_version,candidate,raw_hash FROM civic_data_candidates WHERE id='v1'");
    await db.query("UPDATE civic_data_promotions SET current_version_id='v2',last_known_good_version_id='v2'");
    assert.equal((await read())[0]!.checkedAt, at, "another source's publication does not erase a valid check");
    assert.equal(await recordPublishedSourceCheck(query, check), false, "an old pointer cannot write a check after publication moves");
    await db.query("UPDATE civic_data_promotions SET payload=$1::jsonb", [JSON.stringify({ sourceManifestVersion: 1, sourceHashes: { [key]: "b".repeat(64) } })]);
    assert.deepEqual(await read(), [], "a changed source/configuration cannot inherit the previous check");
    assert.equal(await recordPublishedSourceCheck(query, { ...check, pointerVersionId: "v2", rawHash: "b".repeat(64) }), true);
    const page = { ...check, pointerVersionId: "v2", sourceKey: "own-page", rawHash: "d".repeat(64), sourceHash: "c".repeat(64) };
    assert.equal(await recordPublishedSourceCheck(query, page), true, "an exact page hash can be bound to a complete source-head hash");
    assert.equal((await read([page.sourceKey]))[0]!.rawHash, page.rawHash);
    assert.equal(await recordPublishedSourceCheck(query, { ...page, sourceHash: "e".repeat(64) }), false);
    await db.query("UPDATE civic_data_candidates SET raw_hash=$1 WHERE id='v2'", ["e".repeat(64)]);
    assert.deepEqual(await read([page.sourceKey]), [], "a page check never crosses a different complete source head");
    await db.query("UPDATE civic_data_candidates SET parser_version='new-parser' WHERE id='v2'");
    assert.deepEqual(await read(), [], "a changed parser cannot inherit the previous check");
  } finally { await db.close(); }
});

test("Sources shows only the checked source and jurisdiction without changing source evidence or whole-state freshness", () => {
  const old = "2026-10-25T12:00:00.000Z";
  const row = (ocdId: string) => ({ ocdId, state: "AZ", name: "County", model: "UNKNOWN" as const, election: null,
    sites: [], sourceOrg: "County clerk", sourceUrl, collectedAt: old.slice(0, 10), sources: [{ publisher: "County clerk", url: sourceUrl, checkedAt: old }], refusal: null });
  const file: VotingSitesFile = { generatedAt: old.slice(0, 10), sourceManifestVersion: 1, sourceHashes: { [key]: hash },
    jurisdictions: [row(jurisdiction), row("ocd-division/country:us/state:az/county:other")] };
  const next = votingSourceCheckOverlay(file, [check]);
  assert.equal(next.jurisdictions[0]!.sources![0]!.checkedAt, at);
  assert.equal(next.jurisdictions[1]!.sources![0]!.checkedAt, old, "the same URL in another unconfirmed jurisdiction stays unchanged");
  assert.equal(next.generatedAt, file.generatedAt);
  assert.equal(next.jurisdictions[0]!.collectedAt, file.jurisdictions[0]!.collectedAt);
  assert.equal(file.jurisdictions[0]!.sources![0]!.checkedAt, old, "the saved source evidence is immutable");
  assert.strictEqual(votingSourceCheckOverlay({ ...file, sourceHashes: { [key]: "b".repeat(64) } }, [check]).jurisdictions, file.jurisdictions);
});
