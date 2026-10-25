import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { drizzle } from "drizzle-orm/neon-http";
import { buildUnchangedConfirmation, serializeUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import { saveWorkerPublicationOutcome } from "../lib/civic-data/publication-flow.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories, memoryAggregateRepository } from "../lib/control-plane/repository/memory.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishClaim, type FactDb, type PublishInput } from "../lib/facts/publish.ts";
import { publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { invalidateReaderCache, purgeReaderCacheTags, readerCacheHeaders, readerCacheScopeForPublication, readerCacheTags, withBatchedReaderInvalidation } from "../lib/reader/cache.ts";
import { campaignDb as factDb } from "./helpers/campaign-money-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:tucson";
const BODY = `${PLACE}#example-council`;
const NOW = new Date("2026-10-18T12:00:00Z");
const clocks = factClocks(null);

test("purge credentials accept the deployed WTP and runner token names without a network request", async t => {
  const tokenKeys = ["NETLIFY_API_TOKEN", "NETLIFY_AUTH_TOKEN", "NETLIFY_TOKEN", "WTP_BLOBS_TOKEN", "NETLIFY_BLOBS_TOKEN"];
  const siteKeys = ["NETLIFY_SITE_ID", "NETLIFY_BLOBS_SITE_ID", "WTP_BLOBS_SITE_ID"];
  const keys = [...tokenKeys, ...siteKeys];
  const before = new Map(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const calls: { token: string | null; site: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    assert.equal(url, "https://api.netlify.com/api/v1/purge");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.cache_tags, ["reader-state:AZ"]);
    calls.push({ token: new Headers(options?.headers).get("Authorization"), site: body.site_id });
    return new Response(null, { status: 202 });
  });
  const clear = () => { for (const key of keys) delete process.env[key]; };
  for (const tokenKey of tokenKeys) {
    clear();
    process.env[tokenKey] = `test-${tokenKey}`;
    process.env.WTP_BLOBS_SITE_ID = "test-site";
    assert.deepEqual(await purgeReaderCacheTags(["reader-state:AZ"]), { purged: true });
    assert.deepEqual(calls.at(-1), { token: `Bearer test-${tokenKey}`, site: "test-site" });
  }
  for (const key of tokenKeys) process.env[key] = `test-${key}`;
  process.env.NETLIFY_SITE_ID = "preferred-site";
  for (const tokenKey of tokenKeys) {
    assert.deepEqual(await purgeReaderCacheTags(["reader-state:AZ"]), { purged: true });
    assert.deepEqual(calls.at(-1), { token: `Bearer test-${tokenKey}`, site: "preferred-site" });
    delete process.env[tokenKey];
  }
  const sent = calls.length;
  clear();
  assert.equal((await purgeReaderCacheTags(["reader-state:AZ"])).purged, false);
  assert.equal(calls.length, sent, "missing credentials do not send a request");
});

test("reader answers keep national people, state and place tags with a fifteen-minute stale-while-revalidate lifetime", () => {
  const headers = readerCacheHeaders({ states: ["az", "US-AZ", "AZ"], places: [PLACE, `${PLACE}#board`] });
  const tags = headers["Netlify-Cache-Tag"]!.split(",");
  assert.equal(tags.length, 4);
  assert.ok(tags.includes("reader-national-people"));
  assert.ok(!tags.includes("reader-national"));
  assert.ok(tags.includes("reader-state:AZ"));
  assert.ok(tags.includes("reader-settings"));
  assert.match(tags.find(tag => tag.startsWith("reader-place:"))!, /^reader-place:[a-f0-9]{64}$/);
  assert.equal(headers["Cache-Control"], "public, max-age=0, must-revalidate");
  assert.equal(headers["Netlify-CDN-Cache-Control"], "public, durable, max-age=900, stale-while-revalidate=900");
  assert.deepEqual(readerCacheTags({ states: ["TX", "CA", "TX"] }), ["reader-state:CA", "reader-state:TX"]);
});

test("publication tags follow state scopes and encoded body partitions", () => {
  for (const scope of ["US-AZ:reader-registry-runtime", "source:derived:family:AZ", `source:ical:body:${encodeURIComponent(BODY)}`]) {
    assert.deepEqual(readerCacheScopeForPublication(scope), { states: ["AZ"] }, scope);
  }
  assert.deepEqual(readerCacheScopeForPublication("US:current-congress-directory"), { nationalPeople: true });
  assert.deepEqual(readerCacheScopeForPublication("US:state-legislator-member-offices", {readModels:[{records:[{office:{state:"NJ"}}]}]}), {states:["NJ"]});
  assert.deepEqual(readerCacheScopeForPublication("US:state-legislator-member-offices", {readModels:[{records:[{officeholderId:"plural:ca:one",office:{state:null,address:"State Capitol"}}]}]}), {states:["CA"]});
  assert.deepEqual(readerCacheScopeForPublication("federal-supported"), {});
});

test("shared shelves purge only their actual current and removed geography; unknown scopes never mean every state", () => {
  assert.deepEqual(readerCacheScopeForPublication("unrecognized:publication"), {});
  assert.deepEqual(readerCacheScopeForPublication("US:meeting-source-wiring", {readModels:[
    {records:[{bodyId:BODY}]}, {records:[{ocdId:"ocd-division/country:us/state:nh"}]},
  ]}), {states:["AZ","NH"]});
  assert.deepEqual(readerCacheScopeForPublication("US:zcta-geography-overlaps", {readModels:[{scopes:[{groupings:[{stateFips:"33"},{stateFips:"34"}]}]}]}), {states:["NH","NJ"]});
  assert.deepEqual(readerCacheScopeForPublication("US:public-records", {readModels:[{records:[{ocdId:"ocd-division/country:us"}]}]}).states?.length, 56);
  assert.deepEqual(readerCacheScopeForPublication("US-ID:legiscan-votes:v1", {recordClass:"STATE_ROLL_CALL"}), {});
  assert.deepEqual(readerCacheScopeForPublication("source:derived:family:US-NH"), {states:["NH"]});
  assert.deepEqual(readerCacheScopeForPublication("usaspending:DE"), {states:["DE"]});
  assert.deepEqual(readerCacheScopeForPublication("openfema:NJ+US-NH:disasters"), {states:["NJ","NH"]});
  for (const scope of ["federal-register:rules", "senate-lda:filing:abc", "campaign-money:hourly"])
    assert.deepEqual(readerCacheScopeForPublication(scope), {});
});

test("a President-scope publication purges the tag carried by place pages in every state", async () => {
  const cleared: string[] = [];
  await invalidateReaderCache(readerCacheScopeForPublication("US:people:statewide-executive-sources:v1"), async tags => {
    cleared.push(...tags); return { purged: true };
  });
  assert.deepEqual(cleared, ["reader-national-people"]);
  for (const state of ["AZ", "NH", "NJ", "CA", "NY"]) {
    assert.ok(readerCacheHeaders({ states: [state] })["Netlify-Cache-Tag"]!.split(",").some(tag => cleared.includes(tag)), state);
  }
});

test("explicit global owner changes still invalidate place answers after removing the blanket national tag", async () => {
  await invalidateReaderCache({ national: true }, async tags => {
    assert.deepEqual(tags, ["reader-national", "reader-national-people"]);
    assert.ok(tags.some(tag => readerCacheHeaders({ states: ["NJ"] })["Netlify-Cache-Tag"]!.split(",").includes(tag)));
    return { purged: true };
  });
});

test("a plus scope purges only its states; FEMA maps to its own state", async () => {
  const purges: string[][] = [];
  const purge = async (tags: readonly string[]) => { purges.push([...tags]); return { purged: true }; };
  for (const scope of ["US-AZ+US-NH+US-NJ:meeting-body-crosswalk", "US-AZ%2BUS-NH%2BUS-NJ:reviewed-venue-resolutions"])
    await invalidateReaderCache(readerCacheScopeForPublication(scope), purge);
  await invalidateReaderCache(readerCacheScopeForPublication("openfema:NJ:disasters"), purge);
  assert.deepEqual(purges, [["reader-state:AZ", "reader-state:NH", "reader-state:NJ"], ["reader-state:AZ", "reader-state:NH", "reader-state:NJ"], ["reader-state:NJ"]]);
  const other = readerCacheHeaders({ states: ["CA"] })["Netlify-Cache-Tag"]!.split(",");
  assert.ok(!purges[0]!.some(tag => other.includes(tag)));
});

test("federal feed and roll-call publications send no reader purge", async () => {
  for (const scope of ["govinfo:national", "congress-api:national", "regulations-gov:national", "US:recent-federal-rollcalls", "US-AZ:people:govinfo:v1"]) {
    assert.deepEqual(readerCacheScopeForPublication(scope), {});
    await invalidateReaderCache(readerCacheScopeForPublication(scope), async () => { assert.fail(scope); });
  }
});

test("both Postgres nothing-changed paths purge nothing today and on tomorrow's scheduled check", async () => {
  const input = { sourceId: "fec-open-api", recordClass: "FEC_FUNDING" as const, scope: "federal-supported", parserVersion: "fec/1",
    pointerVersionId: "cv-saved", readModelHash: "a".repeat(64), basis: "READ_MODEL_RECOMPUTED" as const,
    retrieval: { requestedUrl: "https://api.open.fec.gov/v1/", finalUrl: "https://api.open.fec.gov/v1/", httpStatus: 200,
      rawHash: "b".repeat(64), retrievedAt: "2026-10-23T12:00:00.000Z" } };
  for (const day of ["2026-10-23", "2026-10-24"]) for (const alreadyConfirmed of [false, true]) {
    const at = `${day}T12:00:01.000Z`, newerAt = `${day}T13:00:01.000Z`;
    const check = { ...input, retrieval: { ...input.retrieval, retrievedAt: `${day}T12:00:00.000Z` } };
    const newer = buildUnchangedConfirmation({ ...check, retrieval: { ...check.retrieval, retrievedAt: `${day}T13:00:00.000Z` } }, "FEC_FUNDING:federal-supported", newerAt);
    assert.ok(newer.ok);
    const store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
    let calls = 0;
    Object.assign(store, { assertCandidateMutationAuthority: () => {}, cacheOptions: { purge: async () => { assert.fail("unchanged checks must not purge"); } },
      db: Object.assign(drizzle.mock(), { batch: async () => {
        if (calls++ === 0) return [[], alreadyConfirmed ? [] : [{ sequence: 5 }]];
        return [[{ sourceId: input.sourceId, currentVersionId: input.pointerVersionId, lastKnownGoodVersionId: input.pointerVersionId,
          latestConfirmation: serializeUnchangedConfirmation(newer.confirmation) }], [{ state: "PROMOTED", normalizedHash: input.readModelHash, imported: false }]];
      } }),
    });
    assert.deepEqual(await store.confirmUnchanged(check, at), { kind: "CONFIRMED", versionId: input.pointerVersionId, at: alreadyConfirmed ? newerAt : at });
    assert.equal(calls, alreadyConfirmed ? 2 : 1);
  }
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

test("bulk publications purge each tag once even when a later field fails", async () => {
  const purges: string[][] = [];
  const failed = new Error("A later source field failed");
  await assert.rejects(withBatchedReaderInvalidation(async collect => {
    await invalidateReaderCache({ states: ["AZ"] }, collect);
    await invalidateReaderCache({ states: ["AZ", "CA"] }, collect);
    throw failed;
  }, async tags => { purges.push([...tags]); return { purged: true }; }), error => error === failed);
  assert.deepEqual(purges, [["reader-state:AZ", "reader-state:CA"]]);
});

test("a changed retained publication outcome, including HELD, clears the body's state; unchanged or failed saves do not", async () => {
  type Item = Pick<WorkItem, "id" | "publicationOutcome"> & {
    autonomousPlan?: { jurisdiction: string; publication: { contractId: "comment-access"; bodyId: string } };
  };
  const workItems = memoryAggregateRepository<Item>("WorkItem");
  const item: Item = { id: "outcome-test", autonomousPlan: { jurisdiction: "CA", publication: { contractId: "comment-access", bodyId: BODY } } };
  const initial = (await workItems.put(item.id, item, NOW.toISOString())).persisted;
  const outcome: NonNullable<WorkItem["publicationOutcome"]> = { at: NOW.toISOString(), workerResultId: "worker:test", status: "PUBLISHED",
    code: "VERIFIED_RESULT_PUBLISHED", detail: "Verified facts are live", candidateId: null, versionId: null };
  const purges: string[][] = [];
  const purge = async (tags: readonly string[]) => {
    assert.ok((await workItems.mustRead(item.id)).value.publicationOutcome);
    purges.push([...tags]);
    return { purged: true };
  };
  const first = await saveWorkerPublicationOutcome({ workItems }, initial, outcome, NOW.toISOString(), { purge });
  const same = await saveWorkerPublicationOutcome({ workItems }, first, { ...outcome }, NOW.toISOString(), { purge });
  await saveWorkerPublicationOutcome({ workItems }, same, { ...outcome, status: "HELD", code: "SOURCE_CHANGED" }, NOW.toISOString(), { purge });
  await assert.rejects(saveWorkerPublicationOutcome({ workItems }, initial, outcome, NOW.toISOString(), { purge }));
  assert.deepEqual(purges, [["reader-state:AZ"], ["reader-state:AZ"]], "the exact body's state takes precedence over another job state");
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

test("only a changed live fact clears its state's answers after commit; confirmations and rolled-back claims do not", async t => {
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
  assert.deepEqual(purges, [["reader-state:AZ"]]);
  assert.ok("blank" in await publishClaim(tracked, { ...claim(), provenance: "NEWS",
    copy: { ...claim().copy, finalUrl: "https://news.example/" }, quote: "not on the page" }, clocks, NOW, { purge }));
  const failing: FactDb = { transaction: work => db.transaction(async query => { await work(query); throw new Error("commit failed"); }) };
  await assert.rejects(publishClaim(failing, claim(), clocks, NOW, { purge }), /commit failed/);
  assert.equal(purges.length, 1);
});

test("a departed roster member clears answers; an audited Box seat stays live for Sean", async t => {
  const db = await seeded();
  t.after(() => db.pg.close());
  const snapshot = { evidence: { artifactId: "test:roster", contentHash: `sha256-${"c".repeat(64)}`,
    text: "Example Council Alice Example Member Bob Example Member", acquiredByAttemptId: "test", canonicalUrl: "https://example.gov/council",
    retrievedAt: NOW.toISOString(), sourceId: "example.gov", methodRouteId: "test" },
  observedAt: NOW.toISOString(), httpStatus: 200, transport: "REACHABLE" as const, partial: false };
  let removedPurges = 0, pulledPurges = 0, totalPurges = 0;
  const purge = async (tags: readonly string[]) => {
    totalPurges++;
    assert.deepEqual(tags, ["reader-state:AZ"]);
    if ((await db.query("SELECT id FROM fact WHERE held_reason='NOT_ON_CURRENT_OFFICIAL_ROSTER'")).length) removedPurges++;
    if ((await db.query("SELECT id FROM fact WHERE status='pulled'")).length) pulledPurges++;
    return { purged: true };
  };
  const body = { id: BODY, name: "Example Council", state: "AZ", parentId: PLACE };
  await publishRosterFacts(db, { body, capture: snapshot, members: ["Alice Example", "Bob Example"].map(name => ({ recordId: name, fields: { name, office: "Member" } })),
    complete: true, producedBy: "test", purge }, clocks, NOW);
  assert.equal(totalPurges, 1, "all of the roster's committed fields share one tag purge");
  const removed = await publishRosterFacts(db, { body, capture: snapshot, members: [{ recordId: "Alice", fields: { name: "Alice Example", office: "Member" } }],
    complete: true, producedBy: "test", purge }, clocks, NOW);
  assert.equal(removed.departed, 1);
  assert.equal(removedPurges, 1);
  assert.equal(totalPurges, 2, "confirmations and departure share one tag purge");
  // A bare Box name raises a flag; only Sean can decide to remove the live seat.
  await db.query(`UPDATE fact SET produced_by='box', quote='Alice Example', value=jsonb_build_object('name', 'Alice Example')
    WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%'`, [BODY]);
  await db.query("DELETE FROM fact WHERE field LIKE 'office:%'");
  const report = await publishBoxFindings({ repos: createMemoryRepositories(), facts: db, vault: new MemoryEvidenceStore(),
    fetch: async () => { throw new Error("unexpected fetch"); }, store: new MemoryRoutineDataStore(), clocks, now: NOW.toISOString(), limit: 10, purge });
  assert.equal(report.seats.flagged, 1);
  assert.equal(pulledPurges, 0);
});

test("native campaign-money changes clear their state after commit; unchanged confirmations do not", async t => {
  const db = await factDb();
  t.after(() => db.pg.close());
  const resource = campaignFinanceSource("MN").resources[0];
  const [raw] = JSON.parse(readFileSync(new URL("./fixtures/campaign-finance/mn-native-excerpt.json", import.meta.url), "utf8"));
  const record = { ...campaignSourceRecord("MN", resource, raw, { url: resource.url, rawHash: "b".repeat(64), vaultKey: "test:mn",
    byteLength: 100, retrievedAt: NOW.toISOString(), publicationDate: null }),
    person: { id: "test-laurie-pryor", name: "Laurie Pryor", seat: "test-house-seat", sourceUrl: "https://www.house.mn.gov/" } };
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
  assert.equal(purges, 2);
});
