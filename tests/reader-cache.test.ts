import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishClaim, type FactDb, type PublishInput } from "../lib/facts/publish.ts";
import { publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { invalidateReaderCache, readerCacheHeaders, readerCacheScopeForPublication, readerCacheTags } from "../lib/reader/cache.ts";
import { factDb } from "./helpers/fact-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:tucson";
const BODY = `${PLACE}#example-council`;
const NOW = new Date("2026-10-18T12:00:00Z");
const clocks = factClocks(null);

test("reader answers carry state, place and national tags with a strict one-minute edge lifetime", () => {
  const headers = readerCacheHeaders({ states: ["az", "US-AZ", "AZ"], places: [PLACE, `${PLACE}#board`] });
  const tags = headers["Netlify-Cache-Tag"]!.split(",");
  assert.equal(tags.length, 4);
  assert.ok(tags.includes("reader-national"));
  assert.ok(tags.includes("reader-state:AZ"));
  assert.ok(tags.includes("reader-settings"));
  assert.match(tags.find(tag => tag.startsWith("reader-place:"))!, /^reader-place:[a-f0-9]{64}$/);
  assert.equal(headers["Cache-Control"], "public, max-age=0, must-revalidate");
  assert.equal(headers["Netlify-CDN-Cache-Control"], "public, durable, max-age=60, must-revalidate");
  assert.deepEqual(readerCacheTags({ states: ["TX", "CA", "TX"] }), ["reader-state:CA", "reader-state:TX"]);
});

test("publication tags follow state scopes and encoded body partitions; national sources clear every answer", () => {
  for (const scope of ["US-AZ:reader-registry-runtime", "source:derived:family:AZ", `source:ical:body:${encodeURIComponent(BODY)}`]) {
    assert.deepEqual(readerCacheScopeForPublication(scope), { states: ["AZ"] }, scope);
  }
  assert.deepEqual(readerCacheScopeForPublication("US:state-legislator-member-offices"), { national: true });
  assert.deepEqual(readerCacheScopeForPublication("federal-supported"), { national: true });
});

test("purge refusal and transport failure stay visible without reversing publication", async t => {
  const messages: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
  assert.deepEqual(await invalidateReaderCache({ states: ["AZ"] }, async tags => {
    assert.deepEqual(tags, ["reader-state:AZ"]);
    return { purged: false, detail: "purge HTTP 429" };
  }), { purged: false, detail: "purge HTTP 429" });
  assert.deepEqual(await invalidateReaderCache({ national: true }, async () => { throw new Error("offline"); }), { purged: false, detail: "offline" });
  assert.equal(messages.length, 2);
  assert.match(String(messages[0]![0]), /after publication/);
});

async function seeded() {
  const db = await factDb();
  await db.query("INSERT INTO entity (id, kind, name, state) VALUES ($1, 'place', 'Tucson', 'AZ')", [PLACE]);
  await db.query("INSERT INTO entity (id, kind, name, state, parent_id) VALUES ($1, 'body', 'Example Council', 'AZ', $2)", [BODY, PLACE]);
  await db.query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, $2)", [BODY, PLACE]);
  await db.query("INSERT INTO entity_host (entity_id, host) VALUES ($1, 'example.gov')", [BODY]);
  await db.query("INSERT INTO entity (id, kind, name, state) VALUES ('person:test', 'person', 'Alice Example', 'AZ')");
  await db.query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key)
    VALUES ('https://example.gov/council', 'https://example.gov/council', $1, 200, $2, 'fixture')`, [NOW.toISOString(), "a".repeat(64)]);
  return db;
}

const claim = (): PublishInput => ({
  entity: { id: "person:test", fullName: "Alice Example", stateName: null, hosts: ["example.gov"], externalIds: [] },
  field: "phone", fieldKind: "contact", value: "520-555-0100", valueText: "520-555-0100", quote: "Alice Example 520-555-0100",
  provenance: "OFFICIAL", producedBy: "test", costUsd: 0,
  copy: { id: 1, finalUrl: "https://example.gov/council", text: "Alice Example 520-555-0100", fetchedAt: NOW, isArchive: false },
});

test("a live fact and unchanged confirmation clear their state's answers only after commit; refused and rolled-back claims do not", async t => {
  const db = await seeded();
  t.after(() => db.pg.close());
  let committed = false;
  const tracked: FactDb = { transaction: async work => {
    committed = false;
    const outcome = await db.transaction(work);
    committed = true;
    return outcome;
  } };
  const purges: string[][] = [];
  const purge = async (tags: readonly string[]) => {
    assert.equal(committed, true);
    assert.equal((await db.query("SELECT status FROM fact WHERE entity_id = 'person:test'"))[0]!.status, "live");
    purges.push([...tags]);
    return { purged: true };
  };
  assert.equal((await publishClaim(tracked, claim(), clocks, NOW, { purge }) as { decision: string }).decision, "PUBLISH");
  assert.equal((await publishClaim(tracked, claim(), clocks, NOW, { purge }) as { decision: string }).decision, "CONFIRM");
  assert.deepEqual(purges, [["reader-state:AZ"], ["reader-state:AZ"]]);
  assert.ok("blank" in await publishClaim(tracked, { ...claim(), quote: "not on the page" }, clocks, NOW, { purge }));
  const failing: FactDb = { transaction: work => db.transaction(async query => { await work(query); throw new Error("commit failed"); }) };
  await assert.rejects(publishClaim(failing, claim(), clocks, NOW, { purge }), /commit failed/);
  assert.equal(purges.length, 2);
});

test("a departed roster member and a pulled Box seat clear answers after their live fact comes down", async t => {
  const db = await seeded();
  t.after(() => db.pg.close());
  const snapshot = { evidence: { artifactId: "test:roster", contentHash: `sha256-${"c".repeat(64)}`,
    text: "Example Council Alice Example Member Bob Example Member", acquiredByAttemptId: "test", canonicalUrl: "https://example.gov/council",
    retrievedAt: NOW.toISOString(), sourceId: "example.gov", methodRouteId: "test" },
  observedAt: NOW.toISOString(), httpStatus: 200, transport: "REACHABLE" as const, partial: false };
  let removedPurges = 0, pulledPurges = 0;
  const purge = async (tags: readonly string[]) => {
    assert.deepEqual(tags, ["reader-state:AZ"]);
    if ((await db.query("SELECT id FROM fact WHERE held_reason='NOT_ON_CURRENT_OFFICIAL_ROSTER'")).length) removedPurges++;
    if ((await db.query("SELECT id FROM fact WHERE status='pulled'")).length) pulledPurges++;
    return { purged: true };
  };
  const body = { id: BODY, name: "Example Council", state: "AZ", parentId: PLACE };
  await publishRosterFacts(db, { body, capture: snapshot, members: ["Alice Example", "Bob Example"].map(name => ({ recordId: name, fields: { name, office: "Member" } })),
    complete: true, producedBy: "test", purge }, clocks, NOW);
  const removed = await publishRosterFacts(db, { body, capture: snapshot, members: [{ recordId: "Alice", fields: { name: "Alice Example", office: "Member" } }],
    complete: true, producedBy: "test", purge }, clocks, NOW);
  assert.equal(removed.departed, 1);
  assert.equal(removedPurges, 1);
  // A bare Box name lacks the words establishing a council seat and must disappear from the cached roster.
  await db.query(`UPDATE fact SET produced_by='box', quote='Alice Example', value=jsonb_build_object('name', 'Alice Example')
    WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%'`, [BODY]);
  await db.query("DELETE FROM fact WHERE field LIKE 'office:%'");
  const report = await publishBoxFindings({ repos: createMemoryRepositories(), facts: db, vault: new MemoryEvidenceStore(),
    fetch: async () => { throw new Error("unexpected fetch"); }, store: new MemoryRoutineDataStore(), clocks, now: NOW.toISOString(), limit: 10, purge });
  assert.equal(report.seats.pulled, 1);
  assert.equal(pulledPurges, 1);
});

test("native campaign-money writes, replacements and confirmations clear their state after commit", async t => {
  const db = await factDb();
  t.after(() => db.pg.close());
  const resource = campaignFinanceSource("MN").resources[0];
  const [raw] = JSON.parse(readFileSync(new URL("./fixtures/campaign-finance/mn-native-excerpt.json", import.meta.url), "utf8"));
  const record = campaignSourceRecord("MN", resource, raw, { url: resource.url, rawHash: "b".repeat(64), vaultKey: "test:mn",
    byteLength: 100, retrievedAt: NOW.toISOString(), publicationDate: null });
  let purges = 0;
  const purge = async (tags: readonly string[]) => {
    assert.deepEqual(tags, ["reader-state:MN"]);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM fact WHERE status='live'"))[0]!.n), 1);
    purges++;
    return { purged: true };
  };
  assert.deepEqual(await fileCampaignMoneyFacts(db, "MN", [record], NOW.toISOString(), { purge }), { written: 1, confirmed: 0 });
  assert.deepEqual(await fileCampaignMoneyFacts(db, "MN", [record], NOW.toISOString(), { purge }), { written: 0, confirmed: 1 });
  assert.deepEqual(await fileCampaignMoneyFacts(db, "MN", [{ ...record, title: "Updated report" }], NOW.toISOString(), { purge }), { written: 1, confirmed: 0 });
  assert.equal(purges, 3);
});
