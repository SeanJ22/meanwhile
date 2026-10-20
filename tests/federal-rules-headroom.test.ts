import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { normalizeFederalCapture } from "../lib/sources/congress/normalize.ts";
import { countFederalFacts, publishFederalPartition, readFederalSourceProjection, readLegacyFederalRule } from "../lib/sources/congress/publication.ts";
import { refreshFederalSource } from "../lib/sources/congress/refresh.ts";
import { readFederalRules } from "../lib/sources/congress/reader.ts";
import { readFederalRulesPage } from "../lib/sources/congress/rules-page.ts";
import { readRawCaptureText } from "../lib/civic-data/raw-capture-vault.ts";
import type { FederalCapture, FederalFact, FederalProjection, HeldFederalCapture } from "../lib/sources/congress/types.ts";
import type { FederalSourceId } from "../lib/sources/congress/targets.ts";

const NOW = "2026-10-20T00:00:00.000Z";
const document = (id: string) => ({ id, attributes: { title: `Official document ${id}`, postedDate: "2026-10-19", commentEndDate: "2026-10-22T23:59:59Z" } });
const capture = (rows = [document("A")]): FederalCapture => ({ source: "regulations-gov", kind: "rules", url: "https://api.regulations.gov/v4/documents",
  retrievedAt: NOW, body: JSON.stringify({ data: rows }) });

test("rule refresh replaces one native document and its evidence without reopening the country or double counting migrated rules", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), oldCapture = capture(), facts = normalizeFederalCapture(oldCapture);
  const counts = countFederalFacts(facts, new Set(facts.map(row => row.id)));
  await publishFederalPartition({ source: "regulations-gov", partition: "rules", captures: [oldCapture], records: facts, counts, store, vault, now: NOW });
  await publishFederalPartition({ source: "regulations-gov", partition: "national", captures: [oldCapture], records: [], counts, store, vault, now: NOW });
  const rows = [document("A"), document("B")];
  const run = () => refreshFederalSource({ source: "regulations-gov", store, vault, env: { DATA_GOV_API_KEY: "fixture" }, now: () => NOW, sleep: async () => {},
    fetchImpl: (async () => Response.json({ meta: { totalElements: 2, hasNextPage: false }, data: rows })) as typeof fetch });
  for (let pass = 0; pass < 2; pass++) {
    const result = await run();
    assert.equal(result.ok, true); assert.equal(result.counts.loaded, 2); assert.equal(result.counts.joined, 2);
    assert.equal((await readFederalRules({ store, now: NOW })).totalRules, 2);
  }
  for (const row of rows) {
    const held = await readFederalSourceProjection("regulations-gov", `rule:${row.id}`, { store, now: NOW });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind !== "PROMOTED") continue;
    assert.deepEqual(held.value.records.map(row => row.nativeId), [row.id]);
    const saved = (await store.readCandidate(held.metadata.versionId!))!.candidate.normalizedPayload as { captures: HeldFederalCapture[] };
    assert.equal(saved.captures.length, 1);
    assert.deepEqual(JSON.parse(await readRawCaptureText(vault, saved.captures[0].raw)), { data: [row] });
  }
  const marker = await readFederalSourceProjection("regulations-gov", "national", { store, now: NOW });
  assert.equal(marker.kind, "PROMOTED");
  if (marker.kind === "PROMOTED") { assert.deepEqual(marker.value.records, []); assert.equal(marker.value.counts?.loaded, 2); }
});

async function database() {
  const pg = new PGlite();
  await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
  const migration = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) if (/CREATE FUNCTION reader_payload_(value|node|members)\(/.test(statement)) await pg.exec(statement);
  let version = 0;
  async function publish(source: FederalSourceId, partition: string, records: FederalFact[]) {
    const scope = `${source}:${partition}`, id = `v${++version}`;
    const payload: FederalProjection = { formatVersion: 1, source, records };
    const encoded = partitionCivicPayload(payload);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, {id, sourceId: source, recordClass: "FEDERAL_CIVIC_RECORD", scope,
      readModel: payload, storedReadModel: encoded.value, at: NOW});
  }
  const returned: unknown[][] = [];
  const query: ReadOnlyQuery = async statements => {
    const out = [];
    for (const statement of statements) {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      returned.push(rows); out.push(rows);
    }
    return out;
  };
  return { pg, publish, query, returned };
}

test("national legacy and native rule publications filter, deduplicate and page before source text crosses the reader connection", async () => {
  const { pg, publish, query, returned } = await database();
  const fact = (id: string, fields: Partial<FederalFact> = {}): FederalFact => ({ ...normalizeFederalCapture(capture([document(id)]))[0], ...fields });
  try {
    const old = Array.from({ length: 250 }, (_, i) => fact(`OLD-${i}`, { closesAt: "2025-01-01", text: "other country history ".repeat(400) }));
    const current = Array.from({ length: 27 }, (_, i) => fact(`OPEN-${String(i).padStart(2, "0")}`, { closesAt: "2026-10-22", text: `page fact ${i} ` + "official public evidence ".repeat(200) }));
    const shared = fact("SHARED", { documentNumber: "2026-1234" });
    await publish("regulations-gov", "rules", [...old, ...current, shared]);
    await publish("regulations-gov", "rule:OPEN-02", [fact("OPEN-02", { withdrawn: true })]);
    await publish("regulations-gov", "rule:SHARED", [{ ...shared, withdrawn: true }]);
    await publish("federal-register", "rule:2026-1234", [fact("2026-1234", { source: "federal-register", documentNumber: "2026-1234", text: "withdrawn companion must remain suppressed" })]);
    const first = await readFederalRulesPage(query, NOW, 0, 20), second = await readFederalRulesPage(query, NOW, 20, 20);
    assert.equal(first.totalRules, 26); assert.equal(first.rules.length, 20); assert.equal(second.totalRules, 26); assert.equal(second.rules.length, 6);
    assert.deepEqual(first.coverage, { "regulations-gov": "PROMOTED", "federal-register": "PROMOTED" });
    assert.equal(new Set([...first.rules, ...second.rules].map(row => row.rule.nativeId)).size, 26);
    assert.ok(![...first.rules, ...second.rules].some(row => ["SHARED", "OPEN-02", "2026-1234"].includes(row.rule.nativeId)));
    assert.ok(!JSON.stringify(returned).includes("other country history"));
    assert.ok(!JSON.stringify(returned).includes("withdrawn companion"));
    assert.equal((await readFederalRulesPage(query, NOW, 500, 20)).totalRules, 26);
    returned.length = 0;
    installReaderDatabaseQuery(query);
    const legacy = await readLegacyFederalRule("regulations-gov", "OLD-2");
    assert.deepEqual(legacy.map(row => row.nativeId), ["OLD-2"]);
    assert.ok(!JSON.stringify(returned).includes("OLD-22"));
    const defaultPage = await readFederalRules({ now: NOW });
    assert.equal(defaultPage.rules.length, 20); assert.equal(defaultPage.totalRules, 26);
    assert.deepEqual((await readFederalRulesPage(query, "2026-10-23T03:59:59Z", 0, 20)).rules.length, 20, "date-only deadlines include the whole Eastern closing day");
    assert.equal((await readFederalRulesPage(query, "2026-10-23T04:00:00Z", 0, 20)).totalRules, 0);
    await pg.query("UPDATE civic_data_candidates SET state='REFUSED'");
    const invalid = await readFederalRulesPage(query, NOW, 0, 20);
    assert.equal(invalid.totalRules, 0); assert.ok(Object.values(invalid.coverage).every(kind => kind === "STORE_UNREACHABLE"));
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
