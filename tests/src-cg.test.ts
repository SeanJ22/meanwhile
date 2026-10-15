import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { feedDoorDrafts } from "../lib/doors/seed-feeds.ts";
import { federalClient, federalPages, regulationPages } from "../lib/sources/congress/acquire.ts";
import { normalizeFederalCapture } from "../lib/sources/congress/normalize.ts";
import { countFederalFacts, federalCandidate, publishFederalPartition, readFederalSourceProjection } from "../lib/sources/congress/publication.ts";
import { federalAskEvidence, isOpenFederalRule, readFederalMember, readFederalRules } from "../lib/sources/congress/reader.ts";
import { federalApiTimestamp, refreshFederalSource } from "../lib/sources/congress/refresh.ts";
import { FEDERAL_SOURCE_IDS, FEDERAL_SOURCES, type FederalSourceId } from "../lib/sources/congress/targets.ts";
import type { FederalCapture, HeldFederalCapture } from "../lib/sources/congress/types.ts";
import { holdRawCapture, readRawCaptureText } from "../lib/civic-data/raw-capture-vault.ts";
import { federalCalendarDate, federalDeadlineDate } from "../lib/sources/congress/presentation.ts";

const vault = new MemoryEvidenceStore();

const NOW = "2026-10-12T18:00:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/src-cg/${name}`, import.meta.url), "utf8");
function capture(source: FederalSourceId, kind: FederalCapture["kind"], file: string, context?: FederalCapture["context"]): FederalCapture {
  return { source, kind, body: fixture(file), url: `${FEDERAL_SOURCES[source].url}fixture/${file}`, retrievedAt: NOW, ...(context ? { context } : {}) };
}
const bill = () => capture("congress-api", "bill", "congress-bill.json");

test("Congress.gov and govinfo cursor timestamps use the seconds-only format their live APIs require", () => {
  assert.equal(federalApiTimestamp("2026-10-12T01:09:29.113Z"), "2026-10-12T01:09:29Z");
});

test("resumed Congress and govinfo backfills catch updates from their original first page, even on a later day", async t => {
  t.mock.method(console, "log", () => {});
  const through = "2026-10-10T12:00:00.000Z";
  for (const source of ["congress-api", "govinfo"] as const) {
    const store = new MemoryRoutineDataStore();
    const c = source === "congress-api" ? capture(source, "members", "congress-api-live.json") : capture(source, "govinfo-summary", "govinfo-collection.json");
    const url = source === "congress-api" ? "https://api.congress.gov/v3/member?limit=1&currentMember=true" : "https://api.govinfo.gov/collections/BILLS/1993-01-01T00:00:00Z?pageSize=100&offsetMark=next";
    const cursor = source === "congress-api" ? `bootstrap:${JSON.stringify({ url, index: 1, through })}` : `govinfoPage:${JSON.stringify({ url, through })}`;
    await publishFederalPartition({ vault, source, partition: "national", captures: [c], records: [], cursor, store, now: through });
    const root = JSON.parse(c.body);
    // Controlled completed-page envelopes keep the source's member record unchanged.
    const response = source === "congress-api" ? { ...root, pagination: { count: root.members.length } } : { ...root, packages: [], count: 0, nextPage: null };
    const result = await refreshFederalSource({ vault, source, store, env: { CONGRESS_API_KEY: "fixture", DATA_GOV_API_KEY: "fixture" },
      fetchImpl: (async () => Response.json(response)) as typeof fetch, sleep: async () => {}, now: () => NOW });
    assert.equal(result.ok, true);
    const held = await readFederalSourceProjection(source, "national", { store, now: NOW });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind === "PROMOTED") assert.equal(held.value.cursor, source === "congress-api" ? `updates:${through}` : "2026-10-10T11:59:59.000Z");
  }
});

test("fresh real responses from all five source APIs preserve their native records and publication fields", () => {
  const sources: [FederalSourceId, FederalCapture["kind"], string, string][] = [
    ["congress-api", "members", "congress-api-live.json", "members"], ["govinfo", "govinfo-summary", "govinfo-live.json", "packages"],
    ["regulations-gov", "rules", "regulations-gov-live.json", "data"], ["federal-register", "rules", "federal-register-live.json", "results"], ["senate-lda", "contributions", "senate-lda-live.json", "results"],
  ];
  for (const [source, kind, file, field] of sources) {
    const c = capture(source, kind, file), data = JSON.parse(c.body);
    if (source === "govinfo") { assert.ok(data.packages.every((row: { packageId: string }) => row.packageId.startsWith("BILLS-"))); continue; }
    const facts = normalizeFederalCapture(c);
    assert.ok(facts.length >= data[field].length); assert.ok(facts.every(row => row.nativeId && row.official && row.publisher));
    assert.ok(facts.every(row => row.publishedAt === null || Number.isFinite(Date.parse(row.publishedAt))));
  }
});

test("SRC-CG has one national contract and correctly keyed door per publisher", () => {
  for (const source of FEDERAL_SOURCE_IDS) {
    const contract = requiredRoutineContract(source), door = feedDoorDrafts().find(row => row.doorId === `feed:${source}`)!;
    assert.equal(contract.sourceId, source); assert.equal(contract.fanOut, true);
    assert.equal(contract.cadence.defaultEveryMs, FEDERAL_SOURCES[source].everyMs);
    assert.equal(door.config?.keyRef ?? null, FEDERAL_SOURCES[source].key);
    assert.ok(contract.readerProjection?.consumers.includes("Ask"));
  }
});

test("real Congress and govinfo samples publish, reach member cards, and become attributed Ask evidence", async () => {
  const store = new MemoryRoutineDataStore();
  const captures = [bill(), capture("congress-api", "committees", "congress-committees.json", { billId: "117:hr:21" }), capture("congress-api", "text-versions", "congress-text.json", { billId: "117:hr:21" })];
  const records = captures.flatMap(normalizeFederalCapture);
  await publishFederalPartition({ vault, source: "congress-api", partition: "congress:C001078", captures, records, store, now: NOW });
  const text = capture("govinfo", "bill-text", "govinfo-bill-text.txt", { packageId: "BILLS-117hr21ih", billId: "117:hr:21", publishedAt: "2021-01-04" });
  await publishFederalPartition({ vault, source: "govinfo", partition: "bill:117:hr:21", captures: [text], records: normalizeFederalCapture(text), store, now: NOW });
  const reader = await readFederalMember("congress:C001078", { store, now: NOW });
  assert.equal(reader.totalBills, 1); assert.match(reader.bills[0].title, /FedRAMP/);
  assert.equal(reader.referrals.length, 2); assert.ok(reader.texts.some(row => row.source === "govinfo" && row.sourceUrl.startsWith("https://www.govinfo.gov/")));
  assert.ok(reader.sources.every(row => row.provenance.sourceUrl && row.provenance.collectedAt));
  const ask = await federalAskEvidence("congress:C001078", "What does the FedRAMP bill text say?", { store, now: NOW });
  assert.equal(ask.denominators.sponsoredBillsHeld, 1);
  assert.ok(ask.records.some(row => row.kind === "SOURCE_PASSAGE" && row.text.includes("cloud")));
  assert.ok(ask.records.every(row => row.sourceUrl && row.sourceOrg && row.retrievedAt));
  const numbered = await federalAskEvidence("congress:C001078", "What does H.R. 21 say?", { store, now: NOW });
  assert.ok(numbered.records.some(row => row.kind === "SOURCE_PASSAGE" && row.text.includes("cloud")));
  assert.equal((await readFederalMember("congress:X000001", { store, now: NOW })).totalBills, 0);
});

test("the saved official LDA page retains all reports and contributions without donor names in its reader facts", async () => {
  const source = capture("senate-lda", "contributions", "lda-list.json"), root = JSON.parse(source.body);
  const records = normalizeFederalCapture(source);
  assert.equal(records.length, root.results.reduce((sum: number, row: { contribution_items: unknown[] }) => sum + Math.max(1, row.contribution_items.length), 0));
  assert.ok(records.some(row => row.amount === "1000.00"));
  assert.ok(records.every(row => !row.bioguideId), "The LDA source publishes no Bioguide IDs; a join also needs the promoted federal roster.");
  assert.ok(!JSON.stringify(records).includes("HANCOCK, SHAY MICHAEL"));
  const counts = countFederalFacts(records, new Set());
  assert.equal(counts.unjoined, counts.loaded);
  const store = new MemoryRoutineDataStore();
  await publishFederalPartition({ vault, source: "senate-lda", partition: "filing:sample", captures: [source], records, store, now: NOW, counts });
  const held = await readFederalSourceProjection("senate-lda", "filing:sample", { store, now: NOW });
  assert.equal(held.kind, "PROMOTED");
  if (held.kind === "PROMOTED") assert.equal(held.value.records.length, records.length);
});

test("publication refuses a changed amount or title that saved official bytes do not support", async () => {
  const c = bill(), records = normalizeFederalCapture(c), store = new MemoryRoutineDataStore();
  const candidate = federalCandidate({ source: "congress-api", partition: "congress:C001078", captures: [{ ...c, raw: await holdRawCapture(vault, c.source, c.body, "application/json") }], now: NOW,
    projection: { formatVersion: 1, source: "congress-api", records: records.map(row => ({ ...row, title: "Invented title" })) } });
  const outcome = await processRegisteredFanOutCandidate(store, "congress-api", candidate, NOW);
  assert.equal(outcome.promoted, null); assert.equal(outcome.candidate.receipt?.decision, "FAIL");
});

test("national LDA acquisition keeps every real filing and item without replicating a whole page in each filing", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), page = JSON.parse(fixture("lda-list.json"));
  // Only the pagination envelope is controlled; each government filing is unchanged.
  const body = JSON.stringify({ ...page, count: page.results.length, next: null });
  const expected = normalizeFederalCapture({ ...capture("senate-lda", "contributions", "lda-list.json"), body });
  let requests = 0;
  const result = await refreshFederalSource({ vault, source: "senate-lda", store, env: { LDA_API_KEY: "fixture" },
    fetchImpl: (async () => { requests++; return new Response(body); }) as typeof fetch, sleep: async () => {}, now: () => NOW });
  assert.equal(result.ok, true); assert.equal(requests, 1);
  assert.equal(result.counts.loaded, expected.length); assert.equal(result.counts.unjoined, expected.length);
  for (const filing of page.results) {
    const held = await readFederalSourceProjection("senate-lda", `filing:${filing.filing_uuid}`, { store, now: NOW });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind !== "PROMOTED") continue;
    assert.equal(held.value.records.length, expected.filter(row => row.filingId === filing.filing_uuid).length);
    const candidate = await store.readCandidate(held.metadata.versionId!);
    const saved = candidate!.candidate.normalizedPayload as { captures: HeldFederalCapture[] };
    assert.equal("body" in saved.captures[0], false);
    assert.deepEqual(JSON.parse(await readRawCaptureText(vault, saved.captures[0].raw)).results, [filing]);
  }
});

test("a UTC closing instant keeps the agency's actual deadline date", () => {
  assert.equal(federalCalendarDate("2026-10-13T01:00:00Z"), "2026-10-12", "national queries must still include periods closing tonight in Eastern time");
  const c = capture("regulations-gov", "rules", "regulations-gov-live.json"), row = normalizeFederalCapture(c)[0];
  assert.equal(federalDeadlineDate({ ...row, closesAt: "2026-10-13T03:59:59Z" }), "2026-10-12");
  assert.equal(federalDeadlineDate({ ...row, closesAt: "2026-12-02T04:59:59Z" }), "2026-12-01");
  const nextEdition = { ...row, publishedAt: "2026-10-13", opensAt: "2026-10-12", closesAt: "2026-10-14", acceptsComments: true, withdrawn: false };
  assert.equal(isOpenFederalRule(nextEdition, "2026-10-13T01:00:00Z"), false, "tomorrow's edition is still future metadata in Eastern time");
  assert.equal(isOpenFederalRule(nextEdition, "2026-10-13T04:00:00Z"), true);
});

test("a failed operational door write cannot turn successful source acquisition into an outage or duplicate receipt", async t => {
  const lines: string[] = [], operational: string[] = [];
  t.mock.method(console, "log", (value: string) => { lines.push(value); });
  t.mock.method(console, "error", (value: string) => { operational.push(value); });
  const page = JSON.parse(fixture("lda-list.json"));
  const result = await refreshFederalSource({ vault, source: "senate-lda", store: new MemoryRoutineDataStore(), env: { LDA_API_KEY: "fixture" },
    fetchImpl: (async () => Response.json({ ...page, count: page.results.length, next: null })) as typeof fetch,
    now: () => NOW, sleep: async () => {}, doorOutcome: async () => { throw new Error("Operational door store unavailable"); } });
  assert.equal(result.ok, true); assert.ok(result.counts.loaded > 0);
  assert.equal(lines.filter(line => line.startsWith("RCD_RECEIPT=")).length, 1);
  assert.ok(operational.some(line => line.includes("doorOutcomeFailure")));
});

test("an unrelated contact question never opens the new national source holdings", async () => {
  const store = new MemoryRoutineDataStore();
  store.readPromotion = async () => { throw new Error("An unrelated source was opened"); };
  const result = await federalAskEvidence("congress:C001078", "What is their office phone number?", { store, now: NOW });
  assert.deepEqual(result.records, []); assert.deepEqual(result.gaps, []);
});

test("a federal candidate holds vault references, not source bytes, and a later partial page re-verifies held facts from the vault", async () => {
  const store = new MemoryRoutineDataStore(), own = new MemoryEvidenceStore();
  const captures = [bill(), capture("congress-api", "committees", "congress-committees.json", { billId: "117:hr:21" })];
  const first = await publishFederalPartition({ vault: own, source: "congress-api", partition: "bill:117:hr:21", captures, records: captures.flatMap(normalizeFederalCapture), store, now: NOW });
  const saved = first.candidate.normalizedPayload as { captures: HeldFederalCapture[] };
  assert.equal(saved.captures.length, 2);
  for (const [index, held] of saved.captures.entries()) {
    assert.equal("body" in held, false); assert.equal(held.url, captures[index].url); assert.equal(held.retrievedAt, NOW);
    assert.equal(await readRawCaptureText(own, held.raw), captures[index].body);
    assert.equal(held.raw.byteLength, Buffer.byteLength(captures[index].body));
  }
  assert.ok(!JSON.stringify(first.candidate).includes(captures[1].body.slice(0, 200)));
  const nextAt = "2026-10-12T19:00:00.000Z", detail = { ...captures[0], retrievedAt: nextAt };
  const second = await publishFederalPartition({ vault: own, source: "congress-api", partition: "bill:117:hr:21", captures: [detail], records: normalizeFederalCapture(detail), store, now: nextAt });
  assert.ok(second.outcome.promoted ?? second.outcome.confirmed);
  const kept = (second.candidate.normalizedPayload as { captures: HeldFederalCapture[] }).captures;
  assert.deepEqual(kept.map(row => row.raw), [saved.captures[0].raw, saved.captures[1].raw]);
  assert.equal((await own.list("project/freshness/source/congress-api/raw/")).length, 2, "identical bytes are stored once");
  await assert.rejects(publishFederalPartition({ vault: new MemoryEvidenceStore(), source: "congress-api", partition: "bill:117:hr:21", captures: [detail],
    records: normalizeFederalCapture(detail), store, now: nextAt }), /RAW_CAPTURE_MISSING_OR_CORRUPT/);
});

test("unchanged provider checks succeed, and later outages preserve facts and record the actual door reason", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), c = bill(), facts = normalizeFederalCapture(c);
  const first = await publishFederalPartition({ vault, source: "congress-api", partition: "congress:C001078", captures: [c], records: facts, store, now: NOW });
  const nextAt = "2026-10-12T19:00:00.000Z", nextCapture = { ...c, retrievedAt: nextAt };
  const second = await publishFederalPartition({ vault, source: "congress-api", partition: "congress:C001078", captures: [nextCapture], records: normalizeFederalCapture(nextCapture), store, now: nextAt });
  assert.equal(second.outcome.confirmed?.versionId, first.outcome.promoted?.versionId);
  const doors: { ok: boolean; reason?: string }[] = [];
  const result = await refreshFederalSource({ vault, source: "congress-api", store, now: () => nextAt, env: { CONGRESS_API_KEY: "fixture" },
    fetchImpl: (async () => { throw new Error("Workspace proxy refused connection"); }) as typeof fetch,
    doorOutcome: async (ok, _at, reason) => { doors.push({ ok, reason }); } });
  assert.equal(result.ok, false); assert.match(doors[0].reason!, /proxy refused/);
  const held = await readFederalSourceProjection("congress-api", "congress:C001078", { store, now: nextAt });
  assert.equal(held.kind, "PROMOTED");
});

test("real federal rule metadata is held and controlled deadlines and withdrawals govern all states and Ask", async () => {
  const c = capture("federal-register", "rules", "federal-register.json");
  assert.equal(normalizeFederalCapture(c).length, JSON.parse(c.body).results.length);
  // Controlled dates are transport edge cases, separate from the committed real publisher sample.
  const root = JSON.parse(c.body); const real = root.results.find((row: { type: string }) => row.type === "Proposed Rule");
  const modified: FederalCapture = { ...c, body: JSON.stringify({ results: [{ ...real, publication_date: "2026-10-10", comments_close_on: "2026-10-14", comment_url: "https://www.regulations.gov/commenton/fixture" }] }) };
  const store = new MemoryRoutineDataStore(), facts = normalizeFederalCapture(modified);
  await publishFederalPartition({ vault, source: "federal-register", partition: "rules", captures: [modified], records: facts, store, now: NOW });
  assert.equal((await readFederalRules({ store, now: NOW })).rules.length, 1);
  assert.equal((await readFederalRules({ store, now: "2026-10-15T12:00:00Z" })).rules.length, 0);
  assert.equal(isOpenFederalRule({ ...facts[0], withdrawn: true }, NOW), false);
  const ask = await federalAskEvidence(null, "Which federal rules have comment deadlines?", { store, now: NOW });
  assert.match(ask.records[0].text, /2026-10-14/); assert.match(ask.records[0].text, /commenton/);
});

test("pagination follows every official page, refuses foreign next links, and honors Retry-After", async () => {
  const calls: string[] = [], waits: number[] = []; let count = 0;
  const client = federalClient({ source: "senate-lda", env: { LDA_API_KEY: "fixture" }, now: () => NOW, sleep: async ms => { waits.push(ms); },
    fetchImpl: (async input => { calls.push(String(input)); count++;
      if (count === 1) return new Response("busy", { status: 429, headers: { "Retry-After": "9" } });
      return Response.json({ count: 2, results: [{ filing_uuid: String(count) }], next: count === 2 ? "https://lda.gov/api/v1/contributions/?page=2" : null });
    }) as typeof fetch });
  let pages = 0; for await (const _page of federalPages(client, "senate-lda", "https://lda.gov/api/v1/contributions/", "contributions")) pages++;
  assert.equal(pages, 2); assert.equal(calls.length, 3); assert.ok(waits.includes(9000));
  await assert.rejects(client.get("https://unrelated.example/contributions/", "contributions"), /outside/);
});

test("Regulations.gov partitions national results rather than silently stopping at 5,000 documents", async () => {
  const urls: string[] = [];
  const client = federalClient({ source: "regulations-gov", env: { DATA_GOV_API_KEY: "fixture" }, now: () => NOW, sleep: async () => {},
    fetchImpl: (async input => { const u = new URL(String(input)); urls.push(u.href);
      const entire = u.searchParams.get("filter[postedDate][ge]") === "2026-10-10" && u.searchParams.get("filter[postedDate][le]") === "2026-10-12";
      return Response.json({ meta: { totalElements: entire ? 6000 : 1, hasNextPage: false }, data: [{ id: u.searchParams.get("filter[postedDate][ge]"), attributes: { title: "Transport fixture" } }] });
    }) as typeof fetch });
  let pages = 0; for await (const _page of regulationPages(client, "2026-10-12", "2026-10-10", "2026-10-12")) pages++;
  assert.equal(pages, 2); assert.equal(urls.length, 3);
});

test("Congress acquisition runs through its real bill samples and persists state counts and incremental cursors", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), detail = JSON.parse(fixture("congress-bill.json")), routes: string[] = [];
  // Controlled pagination envelopes carry the exact bill data in the publisher's committed sample.
  const fetchImpl = (async input => {
    const url = new URL(String(input)); routes.push(url.pathname);
    if (url.pathname === "/v3/member") return Response.json({ members: [{ bioguideId: "C001078", name: detail.bill.sponsors[0].fullName, state: "VA", updateDate: NOW }], pagination: { count: 1 } });
    if (url.pathname.endsWith("sponsored-legislation")) return Response.json({ sponsoredLegislation: [{ ...detail.bill, latestTitle: detail.bill.title }], pagination: { count: 1 } });
    if (url.pathname.endsWith("/committees")) return new Response(fixture("congress-committees.json"));
    if (url.pathname.endsWith("/text")) return new Response(fixture("congress-text.json"));
    if (url.pathname === "/v3/bill") {
      for (const key of ["fromDateTime", "toDateTime"]) assert.match(url.searchParams.get(key)!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      return Response.json({ bills: [], pagination: { count: 0 } });
    }
    return new Response(fixture("congress-bill.json"));
  }) as typeof fetch;
  const result = await refreshFederalSource({ vault, source: "congress-api", store, env: { CONGRESS_API_KEY: "test-key" }, fetchImpl, sleep: async () => {}, now: () => NOW, memberState: async id => id === "C001078" ? "VA" : null });
  assert.equal(result.ok, true); assert.ok(routes.includes("/v3/member/C001078/sponsored-legislation"));
  assert.ok(result.counts.byState.VA.loaded > 0); assert.equal(result.counts.loaded, result.counts.joined + result.counts.unjoined);
  const reader = await readFederalMember("congress:C001078", { store, now: NOW }); assert.equal(reader.referrals.length, 2);
  const marker = await readFederalSourceProjection("congress-api", "national", { store, now: NOW });
  assert.equal(marker.kind, "PROMOTED"); if (marker.kind === "PROMOTED") assert.match(marker.value.cursor!, /^updates:/);
  const second = await refreshFederalSource({ vault, source: "congress-api", store, env: { CONGRESS_API_KEY: "test-key" }, fetchImpl, sleep: async () => {}, now: () => "2026-10-12T19:00:00Z", memberState: async () => "VA" });
  assert.equal(second.ok, true); assert.equal(second.counts.loaded, result.counts.loaded);
  assert.equal(routes.filter(route => route === "/v3/member").length, 2, "member changes are checked independently of bill updates");
  assert.equal(routes.filter(route => route.endsWith("sponsored-legislation")).length, 1, "completed histories are not fetched again");
});
