import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { manualPayloadScope, scopedManualContractScope } from "../lib/civic-data/scoped-manual-contracts.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { FederalMoneyIndex, readFederalMoneyJson } from "../lib/federal-money/edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { acquireCampaignFinanceResource } from "../lib/funding/state-acquisition.ts";
import { publishCampaignFinanceResource } from "../lib/funding/state-publication.ts";
import { readCampaignFinancePage, type CampaignFinancePageRef } from "../lib/funding/state-pages.ts";
import { readCampaignFinancePublication, type CampaignFinanceFiler, type CampaignFinancePublication } from "../lib/funding/state-projection.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { CAMPAIGN_FINANCE_SOURCES, campaignFinanceNativeScope, campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { campaignFinanceResources } from "../lib/funding/state-resource-index.ts";
import { zip } from "../scripts/xlsx.mjs";

const now = "2026-10-17T00:00:00.000Z";
beforeEach(context => { if ("mock" in context) context.mock.method(Date, "now", () => Date.parse("2026-10-17T03:00:00.000Z")); });
const resource = campaignFinanceSource("WA").resources[0];
const fixture = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/wa-native-excerpt.json", import.meta.url), "utf8"));
const capture = { storage: "CHUNK" as const, url: resource.url, rawHash: "a".repeat(64), vaultKey: "test", byteLength: 10, retrievedAt: now, publicationDate: null };

test("all 56 jurisdictions have one official source and curated filings split exactly once by state", () => {
  assert.equal(CAMPAIGN_FINANCE_SOURCES.length, 56);
  assert.deepEqual(new Set(CAMPAIGN_FINANCE_SOURCES.map(row => row.state)), new Set(US_JURISDICTIONS.map(row => row.usps)));
  const sourceRows = US_JURISDICTIONS.flatMap(state => ["a", "b"].map(id => ({ id: `${state.usps}:${id}`, ocdId: `ocd-division/country:us/${state.prefix}:${state.slug}/place:${id}` })));
  const published: string[] = [];
  for (const state of US_JURISDICTIONS) {
    const scope = `US-${state.usps}:campaign-finance`;
    const records = sourceRows.filter(row => scopedManualContractScope("campaign-finance", row.ocdId) === scope);
    assert.equal(manualPayloadScope("campaign-finance", "unused", { records }), scope);
    assert.equal(records.length, 2);
    published.push(...records.map(row => row.id));
  }
  assert.equal(published.length, sourceRows.length);
  assert.equal(new Set(published).size, sourceRows.length);
  assert.deepEqual(published.sort(), sourceRows.map(row => row.id).sort());
  assert.throws(() => manualPayloadScope("campaign-finance", "unused", { records: [sourceRows[0], sourceRows[2]] }), /crosses/);
});

test("native source mapping keeps unmatched rows, zero amounts and source dates without donor/contact data", () => {
  const row = campaignSourceRecord("WA", resource, { ...fixture[0], contributions_amount: "0", donor_name: "Private donor", treasurer_address: "Private home" }, capture);
  assert.equal(row.amounts.find(value => value.label === "Contributions")?.amount, 0);
  assert.equal(row.provenance.publicationDate, fixture[0].updated_at);
  assert.equal(row.provenance.sourcePublicationDate, null);
  assert.equal(row.unjoinedReason !== null, true);
  assert.doesNotMatch(JSON.stringify(row), /Private donor|Private home/);
  const invalid = campaignSourceRecord("WA", resource, { ...fixture[0], contributions_amount: "not a number" }, capture);
  assert.deepEqual(invalid.invalidAmounts, ["Contributions"]);
  assert.ok(invalid.issues.length);
});

test("the saved Massachusetts report log retains filed amounts and dates without inferring a candidate role", async () => {
  const source = campaignFinanceSource("MA").resources.find(row => row.id === "ocpf-report-log")!;
  const [raw] = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/ma-native-excerpt.json", import.meta.url), "utf8"));
  const row = campaignSourceRecord("MA", source, raw, { ...capture, url: source.url });
  assert.equal(row.nativeId, String(raw.reportId));
  assert.equal(row.committeeId, String(raw.cpfId));
  assert.equal(row.candidateName, null);
  assert.equal(row.provenance.publicationDate, raw.dateFiled);
  assert.equal(row.amounts.find(value => value.label === "Report receipts")?.amount, 500);
  assert.equal(row.filingUrl, raw.reportLink);
});

test("Connecticut periods retain both filed dates and organization names require the source's committee classification", async () => {
  const source = campaignFinanceSource("CT").resources.find(row => row.id === "ecris-receipts-parties-pacs")!;
  const rows = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/ct-native-receipts.json", import.meta.url), "utf8"));
  for (const raw of rows) {
    const row = campaignSourceRecord("CT", source, { ...raw, "Street Address": "Private home", "Contributor First Name": "Private person" }, { ...capture, url: source.url });
    assert.equal(row.period, `${raw["Period Start"]} – ${raw["Period End"]}`);
    assert.equal(row.provenance.publicationDate, raw["File To State"]);
    assert.equal(row.organizationName, raw["Receipt Type"] === "Contributions from Other Committees" ? raw["Contributor Name"] : null);
    assert.doesNotMatch(JSON.stringify(row), /Private home|Private person/);
  }
});

async function context() {
  const directory = await mkdtemp(join(tmpdir(), "campaign-finance-test-"));
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), artifacts = new LocalFileArtifactStore(join(directory, "artifacts"));
  return { directory, store, vault, artifacts, signal: new AbortController().signal, now: () => now };
}
async function* heldRows(options: Awaited<ReturnType<typeof context>>) {
  const scope = campaignFinanceNativeScope("WA");
  const state = await options.store.readPromotion<CampaignFinancePublication>("CURATED_READER_RECORD", scope);
  assert.equal(state?.payload.kind, "campaign-finance-source-state");
  if (state?.payload.kind !== "campaign-finance-source-state") return;
  const groups = new FederalMoneyIndex(options.artifacts, `${scope}:groups`);
  let after = "", exclusive = false;
  for (;;) {
    const entry = await groups.next(state.payload.records[0].groups, after, exclusive);
    if (!entry) return;
    const government = await readFederalMoneyJson<CampaignFinanceFiler>(options.artifacts, entry.value);
    const pages = new FederalMoneyIndex(options.artifacts, `${scope}:filer:${government.id}:pages`);
    for (let index = 0; index < government.pageCount; index++) {
      const key = await pages.get(government.pages, String(index).padStart(12, "0"));
      assert.ok(key);
      yield* await readCampaignFinancePage(options.artifacts, await readFederalMoneyJson<CampaignFinancePageRef>(options.artifacts, key), "WA");
    }
    after = entry.key; exclusive = true;
  }
}

test("real source sample reaches typed readback and corrupt updates preserve independently verified amounts and omitted rows", async () => {
  const options = await context();
  let rows = fixture, at = now;
  const sourceFetch: typeof fetch = async () => new Response(JSON.stringify(rows), { headers: { etag: at } });
  try {
    const first = await publishCampaignFinanceResource("WA", resource, { ...options, fetch: sourceFetch, now: () => at });
    assert.equal(first.outcome.candidate.state, "PROMOTED");
    assert.equal(first.records, 2);
    const before = [];
    for await (const row of heldRows(options)) before.push(row);
    assert.equal(before.length, 2);
    at = "2026-10-17T01:00:00.000Z";
    rows = [{ ...fixture[0], contributions_amount: "broken", expenditures_amount: "123.45" }];
    await publishCampaignFinanceResource("WA", resource, { ...options, fetch: sourceFetch, now: () => at });
    const after = [];
    for await (const row of heldRows(options)) after.push(row);
    assert.equal(after.length, 2);
    const amended = after.find(row => row.nativeId === String(fixture[0].id))!;
    const original = before.find(row => row.id === amended.id)!;
    assert.equal(amended.amounts.find(value => value.label === "Contributions")?.amount, original.amounts.find(value => value.label === "Contributions")?.amount);
    assert.deepEqual(amended.amounts.find(value => value.label === "Contributions")?.provenance, original.provenance);
    assert.equal(amended.amounts.find(value => value.label === "Expenditures")?.amount, 123.45);
    assert.equal(amended.provenance.retrievedAt, at);
    const read = await readCampaignFinancePublication("WA", undefined, { store: options.store, now: at, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    await assert.rejects(readCampaignFinancePublication("WA", campaignFinanceNativeScope("CA"), { store: options.store }), /another state/);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});

test("an API with mixed 304 and changed pages replays the whole native resource with original capture dates", async () => {
  const options = await context();
  let pass = 0, calls = 0;
  const sourceFetch: typeof fetch = async (input, init) => {
    calls++;
    const offset = Number(new URL(String(input)).searchParams.get("$offset"));
    if (pass && offset === 0) {
      assert.equal(new Headers(init?.headers).get("if-none-match"), "first");
      return new Response(null, { status: 304 });
    }
    const rows = offset ? [{ ...fixture[0], id: "tail", contributions_amount: pass ? "25" : "20" }]
      : Array.from({ length: 500 }, (_, index) => ({ ...fixture[0], id: String(index) }));
    return new Response(JSON.stringify(rows), { headers: { etag: offset ? `tail-${pass}` : "first" } });
  };
  try {
    let count = 0;
    for await (const page of acquireCampaignFinanceResource("WA", { ...resource, pageSize: 500 }, { ...options, fetch: sourceFetch })) count += page.records.length;
    assert.equal(count, 501);
    pass++;
    const later = "2026-10-17T01:00:00.000Z";
    count = 0;
    for await (const page of acquireCampaignFinanceResource("WA", { ...resource, pageSize: 500 }, { ...options, fetch: sourceFetch, now: () => later })) {
      count += page.records.length;
      if (page.unchanged) { assert.equal(page.observedAt, now); assert.equal(page.sourceCheck.checkedAt, later); }
    }
    assert.equal(count, 501);
    assert.equal(calls, 4);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});

test("real California and Pennsylvania native cover joins stream independently and an archive shared by profiles downloads once", async () => {
  for (const [state, cover, filing, coverName, filingName, id] of [
    ["CA", "ca-native-cover.tsv", "ca-native-summary.tsv", "CalAccess/DATA/CVR_CAMPAIGN_DISCLOSURE_CD.TSV", "CalAccess/DATA/SMRY_CD.TSV", "calaccess-summary"],
    ["PA", "pa-native-filer.csv", "pa-native-contributions.csv", "filer_2026.txt", "contrib_2026.txt", "dos-contrib"],
  ]) {
    const options = await context();
    const configured = campaignFinanceSource(state).resources.find(row => row.id === id)!;
    const archive = zip([{ name: coverName, data: await readFile(new URL(`./fixtures/campaign-finance/${cover}`, import.meta.url)) },
      { name: filingName, data: await readFile(new URL(`./fixtures/campaign-finance/${filing}`, import.meta.url)) }], "2026-10-16");
    let calls = 0;
    const sourceFetch: typeof fetch = async () => { calls++; return new Response(archive); };
    try {
      for (const copy of [configured, { ...configured, id: `${configured.id}-other-table` }]) {
        let count = 0;
        for await (const page of acquireCampaignFinanceResource(state, copy, { ...options, fetch: sourceFetch, runId: "shared-archive-pass" })) {
          for (const row of page.records) { count++; assert.ok(row.committeeId); assert.ok(row.committeeName); assert.ok(row.amounts.length); }
        }
        assert.equal(count, 2);
      }
      assert.equal(calls, 1);
    } finally { await rm(options.directory, { recursive: true, force: true }); }
  }
});

test("a parsed page left by an interrupted publication is replayed despite unchanged bytes and an older byte date", async () => {
  const options = await context();
  const sourceFetch: typeof fetch = async (_input, init) => new Headers(init?.headers).has("if-none-match")
    ? new Response(null, { status: 304 }) : new Response(JSON.stringify(fixture), { headers: { etag: "original" } });
  try {
    let count = 0;
    for await (const page of acquireCampaignFinanceResource("WA", resource, { ...options, fetch: sourceFetch, publicationId: "interrupted" })) count += page.records.length;
    assert.equal(count, 2);
    count = 0;
    for await (const page of acquireCampaignFinanceResource("WA", resource, { ...options, fetch: sourceFetch, acceptedPublicationId: "prior-completed-pass", publicationId: "retry" })) count += page.records.length;
    assert.equal(count, 2);
    count = 0;
    for await (const page of acquireCampaignFinanceResource("WA", resource, { ...options, fetch: sourceFetch, acceptedPublicationId: "retry", publicationId: "next-completed-pass" })) count += page.records.length;
    assert.equal(count, 0);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});

test("bulk indexes follow the publisher's public form pagination and reject an empty declared table", async () => {
  const options = await context();
  let calls = 0;
  const sourceFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("DataDownload.aspx")) throw new Error("The download index requested an unrelated route.");
    const page = init?.body ? Number(new URLSearchParams(String(init.body)).get("__EVENTARGUMENT")?.split("$")[1]) : 1;
    calls++;
    const types = ["ContributionData", "ExpenditureData", "LoanData"];
    return new Response(`<input type="hidden" name="__VIEWSTATE" value="public-state"><a href="javascript:__doPostBack('_ctl0$Content$dlstDownloadFiles','Page$2')">2</a>` +
      types.map(type => `<a href="/PublicSite/Docs/BulkDataDownloads/${page === 1 ? 2026 : 2025}_${type}.csv.zip">Download</a>`).join(""));
  };
  try {
    let count = 0;
    for await (const entry of campaignFinanceResources("CO", { ...options, fetch: sourceFetch })) { count++; assert.match(entry.url, /202[56]_/); }
    assert.equal(count, 6);
    assert.equal(calls, 6);
    const missing = { ...resource, kind: "ZIP" as const, filePattern: "^absent.csv$" };
    const archive = zip([{ name: "other.csv", data: Buffer.from("id\n1\n") }], "2026-10-16");
    await assert.rejects(async () => { for await (const _page of acquireCampaignFinanceResource("WA", missing, { ...options, fetch: async () => new Response(archive) })) { /* Consume through the archive's source table check. */ } }, /no declared native filing table/);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});
