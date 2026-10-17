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
import { CampaignFinanceSpool } from "../lib/funding/state-spool.ts";
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
  assert.equal(row.filerId, String(raw.cpfId));
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
async function* heldRows(options: Awaited<ReturnType<typeof context>>, usps = "WA") {
  const scope = campaignFinanceNativeScope(usps);
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
      yield* await readCampaignFinancePage(options.artifacts, await readFederalMoneyJson<CampaignFinancePageRef>(options.artifacts, key), usps);
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
          for (const row of page.records) { count++; assert.ok(row.filerId); assert.ok(row.filerName); assert.ok(row.amounts.length); }
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


test("Vermont's public POST index expands each published year and maps native transaction roles", async () => {
  const options = await context();
  const source = campaignFinanceSource("VT").resources[0];
  const rows = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/vt-native-contributions.json", import.meta.url), "utf8"));
  try {
    const resources = [];
    for await (const entry of campaignFinanceResources("VT", { ...options, fetch: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { pageNumber: 1, pageSize: 500 });
      return new Response(JSON.stringify({ data: { items: [
        { year: "2024,2025", transactionTypeCode: "TCON" }, { year: "2024,2025", transactionTypeCode: "TEXP" },
      ] } }));
    } })) resources.push(entry);
    assert.equal(resources.length, 4);
    assert.equal(new Set(resources.map(entry => entry.id)).size, 4);
    assert.deepEqual(resources[0].body, { type: "CSV", filingYear: "2024", transactionTypeCode: "TCON" });
    for (const raw of rows) {
      const row = campaignSourceRecord("VT", source, { ...raw, "Contributor Address Line 1": "Private home" }, { ...capture, url: source.url });
      assert.equal(row.nativeId, raw["Transaction Id"]);
      assert.equal(row.filerId, raw["Filing Entity Id"]);
      assert.equal(row.candidateName, raw["Registration Type"] === "Candidate" ? raw["Filing Entity Name"] : null);
      assert.equal(row.provenance.publicationDate, raw["Report Filed Date"]);
      assert.equal(row.filingUrl, "https://campaignfinance.vermont.gov/");
      assert.equal(row.organizationName, raw["Contributor Type"] === "Business/Group/Organization" ? raw["Contributor Last Name"] : null);
      assert.doesNotMatch(JSON.stringify(row), /Private home/);
    }
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("native joins retain cover-only rows and quarantine malformed cover details", async () => {
  const options = await context();
  const source = campaignFinanceSource("CA").resources.find(row => row.id === "calaccess-summary")!;
  const original = (await readFile(new URL("./fixtures/campaign-finance/ca-native-cover.tsv", import.meta.url), "utf8")).trimEnd().split("\n");
  const malformed = original[1] + "\textra field";
  const unmatched = original[1].replace(/^578036/, "999999");
  const archive = zip([
    { name: "CalAccess/DATA/CVR_CAMPAIGN_DISCLOSURE_CD.TSV", data: Buffer.from([original[0], malformed, unmatched].join("\n") + "\n") },
    { name: "CalAccess/DATA/SMRY_CD.TSV", data: await readFile(new URL("./fixtures/campaign-finance/ca-native-summary.tsv", import.meta.url)) },
  ], "2026-10-16");
  try {
    const rows = [];
    for await (const page of acquireCampaignFinanceResource("CA", source, { ...options, fetch: async () => new Response(archive) })) rows.push(...page.records);
    assert.equal(rows.length, 3);
    const covered = rows.filter(row => row.amounts.length);
    assert.equal(covered.length, 2);
    assert.ok(covered.every(row => row.filerName === null && row.issues.some(issue => issue.includes("unexpected number"))));
    const coverOnly = rows.find(row => !row.amounts.length)!;
    assert.match(coverOnly.issues.join(" "), /no matching filing/);
    assert.ok(coverOnly.unjoinedReason);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});

test("compact disk rows preserve every normalized field across source observations", async () => {
  const options = await context();
  try {
    for (const state of ["WA", "VT"]) {
      const source = campaignFinanceSource(state).resources[0];
      const raw = state === "WA" ? fixture : JSON.parse(await readFile(new URL("./fixtures/campaign-finance/vt-native-contributions.json", import.meta.url), "utf8"));
      const spool = new CampaignFinanceSpool(options.directory, state, source);
      const encoded = [];
      for (const [index, value] of raw.entries()) {
        const row = campaignSourceRecord(state, source, value, { ...capture, url: source.url, vaultKey: "test/" + capture.rawHash, retrievedAt: index ? "2026-10-17T01:00:00Z" : now }, index);
        encoded.push({ row, text: await spool.encode(row) });
      }
      for (const { row, text } of encoded.reverse()) assert.deepEqual(await spool.decode(row.id.split(":").at(-1)!, text), row);
    }
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("Maryland bulk publications expand primitive year lists and stream past their source preamble", async () => {
  const options = await context();
  try {
    const resources = [];
    for await (const entry of campaignFinanceResources("MD", { ...options, fetch: async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {});
      return new Response(JSON.stringify({ data: { filingYears: ["2026", "2025"] } }));
    } })) resources.push(entry);
    assert.equal(resources.length, 4);
    assert.equal(resources[0].body?.filingYear, "2026");
    assert.equal(resources[1].body?.filingYear, "2025");
    const bytes = await readFile(new URL("./fixtures/campaign-finance/md-native-contributions.csv", import.meta.url));
    let count = 0;
    for await (const page of acquireCampaignFinanceResource("MD", resources[0], { ...options, fetch: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).transactionTypeCode, "TCON");
      return new Response(bytes, { headers: { "content-type": "text/csv" } });
    } })) {
      count += page.records.length;
      for (const row of page.records) {
        assert.ok(row.filerId && row.filerName && row.period && row.amounts.length);
        assert.equal(row.provenance.publicationDate, null);
        assert.equal(row.filingUrl, "https://campaignfinance.maryland.gov/");
        assert.equal(row.candidateName, null);
        assert.equal(row.nativeId, null);
      }
    }
    assert.equal(count, 2);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("D.C. native epoch dates and publication-scoped IDs reach a government artifact without merging stale object IDs", async () => {
  const options = await context();
  const source = campaignFinanceSource("DC").resources[0];
  const saved = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/dc-native-contributions.json", import.meta.url), "utf8"));
  let rows = saved.features;
  try {
    const fetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({ ...saved, features: rows }));
    await publishCampaignFinanceResource("DC", source, { ...options, fetch });
    const scope = campaignFinanceNativeScope("DC");
    const state = await options.store.readPromotion<CampaignFinancePublication>("CURATED_READER_RECORD", scope);
    assert.equal(state?.payload.kind, "campaign-finance-source-state");
    if (state?.payload.kind !== "campaign-finance-source-state") throw new Error("D.C. state publication is missing.");
    const held = state.payload.records[0];
    assert.equal(held.count, 2);
    const placeKey = await new FederalMoneyIndex(options.artifacts, `${scope}:places`).get(held.places, "ocd-division/country:us/district:dc");
    assert.ok(placeKey);
    const first = campaignSourceRecord("DC", source, rows[0], { ...capture, url: source.url });
    assert.equal(first.transactionDate, new Date(rows[0].attributes.DATEOFRECEIPT).toISOString());
    assert.equal(first.provenance.publicationDate, new Date(rows[0].attributes.GIS_LAST_MOD_DTTM).toISOString());
    assert.equal(first.filerId, null);
    assert.ok(first.unjoinedReason);
    rows = rows.slice(0, 1);
    await publishCampaignFinanceResource("DC", source, { ...options, fetch, now: () => "2026-10-17T01:00:00.000Z" });
    const updated = await options.store.readPromotion<CampaignFinancePublication>("CURATED_READER_RECORD", scope);
    assert.equal(updated?.payload.records[0].count, 1);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("South Carolina keeps source-native candidate IDs and advances its query date without duplicating raw download heads", async () => {
  const options = await context();
  const source = campaignFinanceSource("SC").resources[0];
  const raw = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/sc-native-contributions.json", import.meta.url), "utf8"));
  let at = now;
  const dates: string[] = [];
  try {
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).contributionDateMax);
      return new Headers(init?.headers).has("if-none-match") ? new Response(null, { status: 304 })
        : new Response(JSON.stringify(raw), { headers: { etag: "unchanged-source-rows" } });
    };
    for (const day of [now, "2026-10-18T00:00:00.000Z"]) {
      at = day;
      let count = 0;
      for await (const page of acquireCampaignFinanceResource("SC", source, { ...options, fetch, now: () => at })) {
        for (const row of page.records) {
          count++;
          const original = raw.find((value: { contributionId: number }) => String(value.contributionId) === row.nativeId)!;
          assert.equal(row.filerId, String(original.candidateId));
          assert.equal(row.candidateName, original.candidateName.trim());
          assert.equal(row.organizationName, original.group === "Yes" ? original.contributorName.trim() : null);
          assert.equal(row.provenance.retrievedAt, now);
        }
      }
      assert.equal(count, 2);
    }
    assert.deepEqual(dates, ["2026-10-17", "2026-10-18"]);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("Utah expands every published year, keeps unfiled documents without amounts and accepts the source's explicit empty publication", async () => {
  const options = await context();
  const source = campaignFinanceSource("UT").resources[0];
  const bytes = await readFile(new URL("./fixtures/campaign-finance/ut-native-transactions.csv", import.meta.url));
  try {
    let resources = 0;
    for await (const entry of campaignFinanceResources("UT", { ...options, fetch: async () => new Response('<select id="ReportYear"><option value="2026">2026</option><option value="2025">2025</option></select>') })) {
      resources++;
      assert.match(entry.url, /ReportYear=202[56]&EntityType=/);
    }
    assert.equal(resources, campaignFinanceSource("UT").resources.length * 2);
    const rows = [];
    for await (const page of acquireCampaignFinanceResource("UT", source, { ...options, fetch: async () => new Response(bytes) })) rows.push(...page.records);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].filingState, "FILED");
    assert.equal(rows[0].amounts[0].amount, 250);
    assert.equal(rows[0].period, "2026 – Convention");
    assert.equal(rows[1].filingState, "UNFILED");
    assert.equal(rows[1].amounts.length, 0);
    assert.ok(rows[1].issues.some(issue => issue.includes("not marked")));
    let complete = false;
    for await (const page of acquireCampaignFinanceResource("UT", { ...source, id: "empty-source-year" }, { ...options, fetch: async () => new Response(source.emptyResponse) })) {
      assert.equal(page.records.length, 0);
      complete ||= page.complete;
    }
    assert.equal(complete, true);
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("Kentucky bulk exports follow its native election-date list and preserve organization classes", async () => {
  const options = await context();
  const rows = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/ky-native-contributions.json", import.meta.url), "utf8"));
  const source = campaignFinanceSource("KY").resources[0];
  try {
    const resources = [];
    for await (const entry of campaignFinanceResources("KY", { ...options, fetch: async () => new Response(JSON.stringify(["11/3/2026", "5/21/1983"])) })) resources.push(entry);
    assert.equal(resources.length, 2);
    assert.equal(new URL(resources[0].url).searchParams.get("ElectionDate"), "11/3/2026");
    assert.equal(new URL(resources[1].url).searchParams.get("ElectionDate"), "5/21/1983");
    for (const raw of rows) {
      const row = campaignSourceRecord("KY", source, raw, { ...capture, url: resources[0].url });
      assert.equal(row.nativeId, null);
      assert.equal(row.candidateName, [raw["Recipient First Name"], raw["Recipient Last Name"]].map(value => value.trim()).filter(Boolean).join(" "));
      assert.equal(row.organizationName, raw["Contribution Type"] === "KYPAC" ? raw["From Organization Name"].trim() : null);
      assert.equal(row.period, raw["Election Date"]);
      assert.equal(row.amounts.length, 1);
    }
    const expenses = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/sc-native-expenditures.json", import.meta.url), "utf8"));
    const expenseSource = campaignFinanceSource("SC").resources.find(row => row.id === "ethics-candidate-expenditures")!;
    for (const raw of expenses) {
      const row = campaignSourceRecord("SC", expenseSource, raw, { ...capture, url: expenseSource.url });
      assert.equal(row.nativeId, String(raw.expId));
      assert.equal(row.filerId, String(raw.candidateFilerId));
      assert.equal(row.organizationName, null);
      assert.equal(row.period, raw.expDate);
      assert.equal(row.amounts[0].amount, raw.amount);
    }
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("idless source snapshots retain identical rows and stable identities when capture bytes or row order change", async () => {
  const options = await context();
  const source = campaignFinanceSource("MD").resources[0];
  const lines = (await readFile(new URL("./fixtures/campaign-finance/md-native-contributions.csv", import.meta.url), "utf8")).trimEnd().split("\n");
  let text = [lines[0], lines[1], lines[2], lines[2], lines[3]].join("\n") + "\n";
  try {
    await publishCampaignFinanceResource("MD", source, { ...options, fetch: async () => new Response(text) });
    const first = [];
    for await (const row of heldRows(options, "MD")) first.push(row);
    assert.equal(first.length, 3);
    assert.equal(new Set(first.map(row => row.id)).size, 3);
    text = ["Publication rechecked", lines[1], lines[3], lines[2], lines[2]].join("\n") + "\n";
    await publishCampaignFinanceResource("MD", source, { ...options, now: () => "2026-10-17T02:00:00.000Z", fetch: async () => new Response(text) });
    const after = [];
    for await (const row of heldRows(options, "MD")) after.push(row);
    assert.deepEqual(after.map(row => row.id).sort(), first.map(row => row.id).sort());
    assert.ok(after.every(row => row.provenance.retrievedAt === now));
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});


test("Virginia joins separate official CSV files once per pass and a corrected cover invalidates an unchanged transaction capture", async () => {
  const options = await context();
  const source = campaignFinanceSource("VA").resources.find(row => row.id === "elect-schedule-a")!;
  let cover = await readFile(new URL("./fixtures/campaign-finance/va-native-reports.csv", import.meta.url));
  const filings = await readFile(new URL("./fixtures/campaign-finance/va-native-contributions.csv", import.meta.url));
  let edition = 1, coverDownloads = 0, at = now;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const lookup = String(input).endsWith("Report.csv");
    const etag = lookup ? `cover-${edition}` : "filings";
    if (new Headers(init?.headers).get("if-none-match") === etag) return new Response(null, { status: 304 });
    if (lookup) coverDownloads++;
    return new Response(lookup ? cover : filings, { headers: { etag } });
  };
  try {
    let firstFiler = "";
    for (const pass of [1, 2]) {
      const rows = [];
      for await (const page of acquireCampaignFinanceResource("VA", source, { ...options, fetch, runId: `pass-${pass}`, publicationId: `pass-${pass}`,
        ...(pass === 2 ? { acceptedPublicationId: "pass-1" } : {}), now: () => at })) rows.push(...page.records);
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.filerId && row.filerName && row.period && row.provenance.lookup));
      assert.ok(rows.every(row => row.provenance.lookup!.url.endsWith("Report.csv")));
      if (pass === 1) {
        firstFiler = rows[0].filerName!;
        cover = Buffer.from(cover.toString("latin1").replaceAll(firstFiler, firstFiler + " Updated"), "latin1");
        edition++; at = "2026-10-17T01:00:00.000Z";
      } else {
        assert.equal(rows[0].filerName, firstFiler + " Updated");
        assert.equal(rows[0].provenance.retrievedAt, now);
        assert.equal(rows[0].provenance.lookup!.retrievedAt, at);
      }
      for await (const _page of acquireCampaignFinanceResource("VA", { ...source, id: `${source.id}-second-consumer` }, { ...options, fetch, runId: `pass-${pass}` })) {}
      assert.equal(coverDownloads, pass);
    }
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});

test("Virginia discovers monthly file links and records one failed index without abandoning other months", async () => {
  const options = await context();
  let failed = 0;
  const found = [];
  try {
    for await (const resource of campaignFinanceResources("VA", { ...options, onFailure: async () => { failed++; }, fetch: async input => {
      const url = String(input);
      if (url.endsWith("/2026_09/")) return new Response("Unavailable", { status: 404 });
      if (url.endsWith("/CF/")) return new Response('<a href="2026_09/">September</a><a href="2026_10/">October</a>');
      return new Response(["Report", ..."ABCDEFGHI".split("").map(letter => `Schedule${letter}`)].map(name => `<a href="${name}.csv">${name}</a>`).join(""));
    } })) found.push(resource);
    assert.equal(found.length, 10);
    assert.equal(failed, 10);
    assert.ok(found.every(resource => resource.url.includes("/2026_10/") && resource.url.endsWith(".csv")));
  } finally { await rm(options.directory, { recursive: true, force: true }); }
});
