import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { newFieldManualEntry, normalizeEntry, readFieldManualRows } from "../lib/control-plane/field-manual.ts";
import { routeParse } from "../lib/control-plane/workers/model-parser.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scoutFieldManualProjection, scoutFieldManualQuery } from "../lib/control-plane/scheduler/field-manual-scout.ts";

const NOW = "2026-10-20T00:00:00.000Z";
test("manual SQL transfers the job's own place history and finite worked-place evidence, preserving reusable procedures", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    const transferred: unknown[] = [];
    const sql: Sql = { query: async (text, params) => { const rows = (await pg.query(text, params ? [...params] : [])).rows; transferred.push(rows); return rows; } };
    const repo = pgFieldManualRepository(sql);
    const entry = normalizeEntry(newFieldManualEntry("bounded-read", "method", { role: "SHARED", kind: "METHOD", title: "Reusable procedure", summary: "GET {door}/events",
      platforms: ["legistar"], outcome: "YIELDED", observedAt: NOW, bodyIds: ["own", ...Array.from({ length: 3_000 }, (_, n) => `country-${n}`)],
      placeResults: [{ place: "body:own", outcome: "YIELDED", observedAt: NOW }, ...Array.from({ length: 3_000 }, (_, n) => ({ place: `body:country-${n}`, outcome: "YIELDED" as const, observedAt: NOW }))],
      payload: { procedure: "GET {door}/events", outcomes: [{ jurisdiction: "body:own", rows: 1 }, ...Array.from({ length: 3_000 }, (_, n) => ({ jurisdiction: `body:country-${n}`, detail: "UNRELATED_COUNTRY_HISTORY" }))] } }));
    await repo.put(entry.id, entry, NOW); transferred.length = 0;
    const rows = await repo.slice({ role: "SCOUT", bodyIds: ["own"] });
    assert.equal(rows.length, 1);
    const held = rows[0].value;
    assert.deepEqual(held.bodyIds, ["own"]);
    assert.equal(held.placeResults?.length, 1);
    assert.equal(held.scopeEvidence?.here, "WORKS");
    assert.equal(held.scopeEvidence?.places.length, 3);
    assert.deepEqual((held.payload as { outcomes: unknown[] }).outcomes, [{ jurisdiction: "body:own", rows: 1 }]);
    assert.equal((held.payload as { procedure: string }).procedure, "GET {door}/events");
    assert.equal(JSON.stringify(transferred).includes("UNRELATED_COUNTRY_HISTORY"), false);
    assert.ok(JSON.stringify(transferred).length < 4_096);
  } finally { await pg.close(); }
});

test("parser routing folds every publisher observation into tier counters and preserves the current publisher's override", async () => {
  const repos = createMemoryRepositories();
  for (let n = 0; n < 400; n += 1) {
    const entry = normalizeEntry(newFieldManualEntry("parse-history", `other-${n}`, { role: "PARSER", kind: "PARSE_OUTCOME", title: "haiku failed", summary: "failed", outcome: "FAILED", states: ["az"], observedAt: NOW,
      payload: { host: `other-${n}.gov`, recordClass: "meetings", tier: "haiku" } }));
    await repos.fieldManual.put(entry.id, entry, NOW);
  }
  repos.fieldManual.slice = async () => { throw Error("country manual array forbidden"); };
  const read = await readFieldManualRows(repos, { role: "PARSER", state: "az", recordClass: "meetings", parserHost: "own.gov" });
  assert.equal(read.error, undefined);
  assert.equal(read.store.parserEvidence?.tiers.haiku.count, 400);
  assert.equal(read.store.entries.length, 0);
  assert.equal(routeParse(read.store, { host: "own.gov", recordClass: "meetings" }).tier, "sonnet");
  const own = normalizeEntry(newFieldManualEntry("parse-history", "own", { role: "PARSER", kind: "PARSE_OUTCOME", title: "haiku worked here", summary: "worked", outcome: "YIELDED", states: ["az"], observedAt: NOW,
    payload: { host: "own.gov", recordClass: "meetings", tier: "haiku" } }));
  await repos.fieldManual.put(own.id, own, NOW);
  const next = await readFieldManualRows(repos, { role: "PARSER", state: "az", recordClass: "meetings", parserHost: "own.gov" });
  assert.equal(next.store.parserEvidence?.tiers.haiku.count, 401);
  assert.equal(next.store.entries.length, 0);
  assert.equal(routeParse(next.store, { host: "own.gov", recordClass: "meetings" }).tier, "haiku");
});

test("bounded Scout context retains the blank's related procedure ahead of any number of unrelated local notes", async () => {
  const repos = createMemoryRepositories(), place = "ocd-division/country:us/state:az/place:own";
  for (let n = 0; n < 100; n += 1) {
    const entry = normalizeEntry(newFieldManualEntry("local-notes", String(n), { role: "SCOUT", kind: "LESSON", title: `Local note ${n}`, summary: "another field", outcome: "YIELDED",
      ocdIds: [place], states: ["az"], recordClasses: ["campaign_finance_filing"] }));
    await repos.fieldManual.put(entry.id, entry, NOW);
  }
  const useful = normalizeEntry(newFieldManualEntry("related-procedure", "meetings", { role: "SHARED", kind: "METHOD", title: "Find this calendar", summary: "Read the official calendar", outcome: "YIELDED",
    states: ["nh"], platforms: ["legistar"], recordClasses: ["meetings-discovery"], payload: { procedure: "GET {door}/calendar" } }));
  await repos.fieldManual.put(useful.id, useful, NOW);
  const options = { subjectId: place, divisions: [place], recordClasses: ["meetings"] };
  const read = await readFieldManualRows(repos, scoutFieldManualQuery(options));
  assert.equal(read.error, undefined);
  assert.equal(read.store.entries.length, 40);
  assert.ok(read.store.entries.some(entry => entry.id === useful.id));
  assert.equal(scoutFieldManualProjection(read, options).entryIds[0], useful.id);
});
