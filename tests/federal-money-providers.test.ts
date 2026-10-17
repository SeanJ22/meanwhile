import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync, gzipSync } from "node:zlib";
import { archiveCrc32 } from "../lib/sources/archive.ts";
import { acquireFederalMoney as acquireNative, type FederalMoneyAcquireOptions } from "../lib/federal-money/acquire.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { federalCsvRecords, federalJsonRecords } from "../lib/federal-money/streams.ts";
import type { FederalMoneyCapture, FederalMoneySource } from "../lib/federal-money/model.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/federal-money/${name}`, import.meta.url), "utf8");
const now = () => "2026-10-12T23:20:00.000Z";
const captured = (url: string, body: string): FederalMoneyCapture => { const rawHash = createHash("sha256").update(body).digest("hex"); return { url, rawHash, vaultKey: `project/meanwhile/source/federal-money/${rawHash}`, byteLength: Buffer.byteLength(body), format: /^[\s\uFEFF]*[\[{]/.test(body) ? "json" : "csv", retrievedAt: now(), publicationDate: null }; };
let cacheRoot: string;
let evidenceStore: MemoryEvidenceStore;
beforeEach(async () => { cacheRoot = await mkdtemp(join(tmpdir(), "federal-provider-")); evidenceStore = new MemoryEvidenceStore(); });
afterEach(async () => { await rm(cacheRoot, { recursive: true, force: true }); });
const acquireFederalMoney = (source: FederalMoneySource, state: string, options: FederalMoneyAcquireOptions = {}) => acquireNative(source, state, { cacheRoot, evidenceStore, ...options });
const parsed = (source: FederalMoneySource, url: string, body: string, state: string) => parseFederalMoney(source, captured(url, body), state, body);
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });
function zipEntries(entries: readonly { name: string; body: string }[]): Uint8Array {
  const localParts: Buffer[] = [], centralParts: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const filename = Buffer.from(entry.name), bytes = Buffer.from(entry.body), compressed = deflateRawSync(bytes), crc = archiveCrc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    localParts.push(local, filename, compressed); centralParts.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(centralParts), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}
const zip = (name: string, body: string) => zipEntries([{ name, body }]);
async function* bytes(text: string, size = 1): AsyncGenerator<Buffer> { const data = Buffer.from(text); for (let at = 0; at < data.length; at += size) yield data.subarray(at, at + size); }
function streamed(data: Uint8Array): Response { let at = 0; const response = new Response(new ReadableStream({ pull(controller) { if (at >= data.length) { controller.close(); return; } controller.enqueue(data.subarray(at, at + 257)); at += 257; } })); response.text = async () => { throw new Error("Whole body text is forbidden."); }; response.arrayBuffer = async () => { throw new Error("Whole body bytes are forbidden."); }; return response; }
test("real OpenFEMA response retains county designation, publication date and official raw provenance", () => {
  const body = fixture("openfema-live.json"), capture = captured("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1", body);
  const [fact] = parseFederalMoney("openfema", capture, "AR", body);
  assert.equal(fact.sourceId, "ac5ae0bd-30cc-4973-9a9f-6a0b9901496e");
  assert.deepEqual(fact.geography, [{ type: "county", geoid: "05103" }]);
  assert.equal(fact.details.placeCode, "99103"); assert.equal(fact.geography.some(value => value.type === "place"), false);
  assert.equal(fact.provenance.publicationDate, "2026-09-15T00:00:00.000Z"); assert.equal(fact.provenance.official, true);
  assert.equal(fact.provenance.rawHash, createHash("sha256").update(body).digest("hex")); assert.equal(fact.joinStatus, "UNJOINED");
});
test("official Treasury documented response preserves separate modifications on one award", () => {
  const facts = parsed("usaspending", "https://api.usaspending.gov/api/v2/search/spending_by_transaction/", fixture("usaspending-official-example.json"), "VA");
  assert.equal(facts.length, 10); assert.equal(new Set(facts.map(value => value.id)).size, 10);
  assert.equal(facts[0].amount, 15639242.36); assert.equal(facts[0].period, "2012-06-20");
  assert.equal(facts[0].uei, null); assert.equal(facts[0].provenance.publicationDate, null);
  assert.ok(facts.every(value => value.kind === "CONTRACT" && value.joinStatus === "UNJOINED"));
});
test("GSA's redacted example retains its published UEI without turning address into governing authority", () => {
  const [fact] = parsed("sam-gov-entities", "https://open.gsa.gov/api/entity-api/", fixture("sam-official-example.json"), "CA");
  assert.equal(fact.uei, "WB23FJYKNLM1"); assert.equal(fact.recipient, "9TH CIRCUIT COURT OF APPEALS");
  assert.equal(fact.state, "XX"); assert.deepEqual(fact.geography, []); assert.deepEqual(fact.bodyIds, []);
});
test("OpenFEMA state pagination resumes beyond the first bounded page and accepts unchanged empty pass", async () => {
  const source = JSON.parse(fixture("openfema-live.json"));
  const first = await acquireFederalMoney("openfema", "AR", { now, fetch: async url => { const request = new URL(String(url)); assert.equal(request.searchParams.get("$filter"), "state eq 'AR'"); return json({ metadata: { count: 501 }, DisasterDeclarationsSummaries: Array.from({ length: 500 }, (_, i) => ({ ...source.DisasterDeclarationsSummaries[0], id: `synthetic-${i}` })) }); } });
  assert.equal(first.complete, false); assert.equal(first.continuation?.offset, 500);
  const second = await acquireFederalMoney("openfema", "AR", { now, cursor: first.continuation, fetch: async url => { assert.equal(new URL(String(url)).searchParams.get("$skip"), "500"); return json({ metadata: { count: 501 }, DisasterDeclarationsSummaries: [{ ...source.DisasterDeclarationsSummaries[0], id: "synthetic-500" }] }); } });
  assert.equal(second.complete, true); assert.equal(second.facts.length, 1);
  const empty = await acquireFederalMoney("openfema", "AR", { fetch: async () => json({ metadata: { count: 0 }, DisasterDeclarationsSummaries: [] }) });
  assert.equal(empty.complete, true); assert.equal(empty.facts.length, 0);
});
test("provider Retry-After and transient errors back off without applying local-government request caps", async () => {
  const waits: number[] = []; let calls = 0;
  const result = await acquireFederalMoney("openfema", "AR", { now, sleep: async milliseconds => { waits.push(milliseconds); }, fetch: async () => ++calls === 1 ? json({}, 429, { "Retry-After": "7" }) : calls === 2 ? json({}, 503) : json({ metadata: { count: 0 }, DisasterDeclarationsSummaries: [] }) });
  assert.equal(result.complete, true); assert.deepEqual(waits, [7000, 2000]);
});
test("FAC batches child findings by native report_id and preserves text, flags and UEI", async () => {
  const calls: string[] = [], key = "synthetic-secret-test-only";
  const options: FederalMoneyAcquireOptions = { now, since: "2026-01-01", dataGovApiKey: key, fetch: async (url, init) => {
    const request = new URL(String(url)); calls.push(request.pathname); assert.ok(!request.href.includes(key)); assert.equal(new Headers(init?.headers).get("X-Api-Key"), key);
    if (request.pathname === "/general") { assert.equal(request.searchParams.get("auditee_state"), "eq.AZ"); return json([{ report_id: "SYNTHETIC-2025-1", auditee_state: "AZ", auditee_uei: "SYNTHETICUEI", auditee_name: "SYNTHETIC GOVERNMENT", audit_year: "2025", fac_accepted_date: "2026-01-06", total_amount_expended: 4000 }], 200, { "Content-Range": "0-0/1" }); }
    assert.equal(request.searchParams.get("report_id"), "in.(SYNTHETIC-2025-1)"); assert.equal(request.searchParams.has("auditee_state"), false);
    if (request.pathname === "/findings") return json([{ report_id: "SYNTHETIC-2025-1", auditee_uei: "SYNTHETICUEI", reference_number: "2025-001", award_reference: "AWARD-1", is_material_weakness: "Y", is_questioned_costs: "N", type_requirement: "A" }]);
    if (request.pathname === "/findings_text") return json([{ report_id: "SYNTHETIC-2025-1", auditee_uei: "SYNTHETICUEI", finding_ref_number: "2025-001", finding_text: "Synthetic finding transport test." }]);
    return json([]);
  } };
  const pages = []; let cursor = null;
  do { const value = await acquireFederalMoney("federal-audit-clearinghouse", "AZ", { ...options, cursor }); pages.push(value); cursor = value.continuation ?? null; } while (cursor);
  const result = { ...pages.at(-1)!, facts: pages.flatMap(value => value.facts) };
  assert.equal(result.complete, true); assert.deepEqual(calls, ["/general", "/findings", "/findings_text", "/corrective_action_plans", "/additional_ueis"]);
  assert.equal(result.facts.length, 3); assert.equal(result.facts[1].details.materialWeakness, true); assert.equal(result.facts[1].details.questionedCosts, false); assert.equal(result.facts[2].details.findingText, "Synthetic finding transport test.");
  assert.ok(JSON.stringify(result).includes(key) === false);
});
test("USAspending uses full custom bulk history and resumes annual extracts without search limits", async () => {
  let requestCalls = 0;
  const first = await acquireFederalMoney("usaspending", "AZ", { now, fetch: async (url, init) => {
    requestCalls++;
    if (String(url).endsWith("/bulk_download/awards/")) { const request = JSON.parse(String(init?.body)); assert.equal(request.limit, undefined); assert.equal(request.filters.date_type, "action_date"); assert.deepEqual(request.filters.prime_award_types, ["02", "03", "04", "05"]); assert.equal(request.filters.date_range.start_date, "2000-10-01"); return json({ status_url: "https://api.usaspending.gov/api/v2/download/status?file_name=synthetic.zip", file_url: "https://files.usaspending.gov/generated_downloads/synthetic.zip" }); }
    return json({ status: "running" });
  } });
  assert.equal(first.complete, false); assert.equal(first.facts.length, 0); assert.equal(first.continuation?.year, 2000); assert.equal(requestCalls, 2);
  const csv = "assistance_transaction_unique_key,assistance_award_unique_key,assistance_type,recipient_uei,recipient_name,action_date,federal_action_obligation,primary_place_of_performance_state_code,primary_place_of_performance_county_code,primary_place_of_performance_congressional_district,last_modified_date\nSYNTHETIC-TX,SYNTHETIC-AWARD,04,SYNTHETICUEI,SYNTHETIC GOVERNMENT,2008-07-17,123.5,AZ,013,04,2026-10-10\n";
  const second = await acquireFederalMoney("usaspending", "AZ", { now, cursor: first.continuation, fetch: async url => String(url).includes("/status?") ? json({ status: "finished" }) : new Response(Buffer.from(zip("Assistance_Transactions.csv", csv))) });
  assert.equal(second.facts[0].sourceId, "SYNTHETIC-TX"); assert.equal(second.facts[0].kind, "GRANT"); assert.equal(second.facts[0].uei, "SYNTHETICUEI"); assert.deepEqual(second.facts[0].geography, [{ type: "county", geoid: "04013" }, { type: "congressional", geoid: "0404" }]); assert.equal(second.continuation?.year, 2001);
});
test("SAM public GET authenticates state and download requests and keeps saved evidence credential-free", async () => {
  let calls = 0; const body = JSON.stringify({ entityData: [JSON.parse(fixture("sam-official-example.json"))] });
  const options: FederalMoneyAcquireOptions = { now, samGovApiKey: "synthetic-key", fetch: async (url, init) => {
    calls++; assert.equal(new Headers(init?.headers).get("X-Api-Key"), "synthetic-key"); assert.equal(init?.method ?? "GET", "GET");
    const request = new URL(String(url)); assert.equal(request.searchParams.get("api_key"), "synthetic-key"); assert.equal(request.searchParams.has("apiKey"), false);
    if (request.pathname.endsWith("download-entities")) { assert.equal(request.searchParams.get("token"), "synthetic-download-token"); return new Response(gzipSync(body)); }
    assert.equal(request.searchParams.get("physicalAddressProvinceOrStateCode"), "CA"); assert.equal(request.searchParams.get("format"), "json"); assert.equal(request.searchParams.has("size"), false); assert.equal(request.searchParams.get("samRegistered"), calls === 1 ? "Yes" : "No");
    return json({ downloadURL: "https://api.sam.gov/entity-information/v3/download-entities?token=synthetic-download-token&api_key=REPLACE_WITH_API_KEY" });
  } };
  const first = await acquireFederalMoney("sam-gov-entities", "CA", options);
  const result = await acquireFederalMoney("sam-gov-entities", "CA", { ...options, cursor: first.continuation });
  assert.equal(result.complete, true); assert.equal(calls, 4); assert.equal(result.facts[0].uei, "WB23FJYKNLM1"); assert.equal(JSON.stringify(result).includes("synthetic-download-token"), false); assert.equal(JSON.stringify(result).includes("synthetic-key"), false);
  assert.ok(result.captures.every(value => !new URL(value.url).searchParams.has("api_key") && !new URL(value.url).searchParams.has("token")));
});
test("SAM echoed keys and download tokens fail without entering saved evidence or error messages", async () => {
  const key = "synthetic-private-key";
  const entityData = [JSON.parse(fixture("sam-official-example.json"))];
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "CA", { samGovApiKey: key, fetch: async () => json({ entityData, links: { selfLink: `https://api.sam.gov/entity-information/v3/entities?api_key=${key}` } }) }), error => error instanceof Error && error.message.includes("echoed a private credential") && !error.message.includes(key));
  const token = "synthetic-private-token";
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "CA", { samGovApiKey: key, fetch: async url => String(url).includes("download-entities") ? json({ entityData, links: { selfLink: `https://api.sam.gov/entity-information/v3/download-entities?token=${token}` } }) : json({ downloadURL: `https://api.sam.gov/entity-information/v3/download-entities?token=${token}` }) }), error => error instanceof Error && error.message.includes("echoed a private credential") && !error.message.includes(token));
});
test("malformed successful responses become source outages and never claim an empty successful check", async () => {
  await assert.rejects(acquireFederalMoney("openfema", "AZ", { fetch: async () => json({ error: "transport fixture" }) }), /declaration array is missing/);
  await assert.rejects(acquireFederalMoney("usaspending", "AZ", { fetch: async () => json({}) }), /transaction extract links/);
});
test("loan face value stays separate from obligations and subsidy costs", () => {
  const csv = "assistance_transaction_unique_key,assistance_type,recipient_uei,action_date,federal_action_obligation,face_value_of_loan,original_loan_subsidy_cost\nSYNTHETIC-LOAN,07,SYNTHETICUEI,2026-01-01,-5,1000000,2500\n";
  const [fact] = parsed("usaspending", "https://files.usaspending.gov/generated_downloads/synthetic.zip#Assistance.csv", csv, "AZ");
  assert.equal(fact.kind, "LOAN"); assert.equal(fact.amount, -5); assert.equal(fact.amountLabel, "Federal obligation"); assert.equal(fact.details.loanFaceValue, 1_000_000); assert.equal(fact.details.subsidyCost, 2500);
});
test("historic FAC rows keep native year/DBKEY identity and flags", () => {
  const general = "AUDITYEAR,DBKEY,STATE,AUDITEENAME,TOTFEDEXPEND,FACACCEPTEDDATE,MATERIALWEAKNESS\n2015,123,AZ,SYNTHETIC GOVERNMENT,50000,2016-03-02,Y\n";
  const [fact] = parsed("federal-audit-clearinghouse", "https://app.fac.gov/dissemination/public-data/census/census-2015.zip#2015%2FELECAUDITHEADER.csv", general, "AZ");
  assert.equal(fact.sourceId, "2015:123"); assert.equal(fact.amount, 50000); assert.equal(fact.details.materialWeakness, true); assert.equal(fact.provenance.publicationDate, "2016-03-02T00:00:00.000Z");
});

test("CSV and JSON records survive byte boundaries, escaped quotes and embedded newlines", async () => {
  const csv = 'id,text\r\n1,"é line\nnext ""quoted"""\r\n2,last';
  const records = []; for await (const row of federalCsvRecords(bytes(csv))) records.push(row);
  assert.deepEqual(records, ['id,text\r\n', '1,"é line\nnext ""quoted"""\r\n', '2,last']);
  const values = [{ id: 1, text: 'é "nested" } [', nested: { list: [1, 2] } }, { id: 2, text: "last" }];
  const envelope = { rows: 0, found: false, value: undefined as Record<string, unknown> | undefined }, selected = [];
  for await (const row of federalJsonRecords(bytes(JSON.stringify({ totalRecords: 2, entityData: values, links: {} })), "entityData", envelope)) selected.push(JSON.parse(row));
  assert.deepEqual(selected, values); assert.equal(envelope.rows, 2); assert.equal(envelope.value?.totalRecords, 2);
});
test("source streams preserve UTF-8 BOM bytes and refuse malformed or truncated UTF-8", async () => {
  const csv = '\uFEFFid,text\r\n1,"é"\r\n', records = [];
  for await (const row of federalCsvRecords(bytes(csv))) records.push(row);
  assert.equal(records.join(""), csv);
  const envelope = { rows: 0, found: false }, values = [];
  for await (const row of federalJsonRecords(bytes('\uFEFF{"entityData":[{"text":"é"}]}'), "entityData", envelope)) values.push(JSON.parse(row));
  assert.deepEqual(values, [{ text: "é" }]);
  async function* invalid(input: readonly number[]) { for (const byte of input) yield Uint8Array.of(byte); }
  for (const input of [[0x61, 0x2c, 0xff, 0x0a], [0x61, 0x2c, 0xc3]]) await assert.rejects(async () => { for await (const row of federalCsvRecords(invalid(input))) void row; }, /not valid UTF-8/);
  await assert.rejects(async () => { for await (const row of federalJsonRecords(invalid([0x5b, 0x7b, 0x22, 0xff]), "entityData", { rows: 0, found: false })) void row; }, /not valid UTF-8/);
});
test("USAspending bounded pages resume from vaulted references after temporary processing files are removed", async () => {
  const header = "assistance_transaction_unique_key,assistance_type,recipient_uei,action_date,federal_action_obligation,primary_place_of_performance_state_code,primary_place_of_performance_county_code\n";
  const archive = zip("Assistance_Transactions.csv", header + Array.from({ length: 1203 }, (_, i) => `TX-${i},04,ABC123DEF456,2026-01-01,5,CA,001\n`).join(""));
  let downloads = 0;
  const first = await acquireFederalMoney("usaspending", "CA", { now, cursor: { source: "usaspending", phase: "download", year: 2026, fileUrl: "https://files.usaspending.gov/full.zip", statusUrl: "https://api.usaspending.gov/status" }, fetch: async url => String(url).endsWith("/status") ? json({ status: "finished" }) : (downloads++, streamed(archive)) });
  await rm(cacheRoot, { recursive: true, force: true });
  const second = await acquireFederalMoney("usaspending", "CA", { now, cursor: first.continuation, fetch: async () => { throw new Error("A resumed chunk must reuse saved evidence."); } });
  const third = await acquireFederalMoney("usaspending", "CA", { now, cursor: second.continuation, fetch: async () => { throw new Error("A resumed chunk must reuse saved evidence."); } });
  assert.deepEqual([first, second, third].map(page => page.facts.length), [500, 500, 203]); assert.equal(downloads, 1);
  assert.equal(third.continuation?.location, "recipient"); assert.ok(first.captures[0].archiveId); assert.equal("body" in first.captures[0], false);
  const raw = await evidenceStore.get(JSON.parse(Buffer.from((await evidenceStore.get(first.captures[0].archiveId!))!.bytes).toString()).vaultKey);
  assert.deepEqual(Buffer.from(raw!.bytes), Buffer.from(archive));
});
test("one national FAC archive download supplies independent states and retains unmatched child rows", async () => {
  const archive = zipEntries([
    { name: "2015/ELECAUDITHEADER.csv", body: "AUDITYEAR,DBKEY,STATE,AUDITEENAME\n2015,1,AZ,Synthetic Arizona\n2015,2,CA,Synthetic California\n" },
    { name: "2015/ELECAUDITFINDINGS.csv", body: "AUDITYEAR,DBKEY,FINDINGSREFNUMS,QCOSTS\n2015,1,2015-001,Y\n2015,2,2015-002,N\n2015,3,2015-003,Y\n" },
  ]); let downloads = 0;
  const options: FederalMoneyAcquireOptions = { now, cursor: { source: "federal-audit-clearinghouse", phase: "historic", year: 2015 }, fetch: async url => String(url).endsWith("/historic/") ? new Response('<a href="https://app.fac.gov/census-2015.zip">2015</a>') : (downloads++, streamed(archive)) };
  const az = await acquireFederalMoney("federal-audit-clearinghouse", "AZ", options);
  await rm(cacheRoot, { recursive: true, force: true });
  const ca = await acquireFederalMoney("federal-audit-clearinghouse", "CA", options);
  assert.equal(downloads, 1); assert.equal(az.facts[0].state, "AZ"); assert.equal(ca.facts[0].state, "CA");
  const azNext = await acquireFederalMoney("federal-audit-clearinghouse", "AZ", { ...options, cursor: az.continuation });
  assert.equal(azNext.complete, true); assert.equal(azNext.facts[0].identifiers.reportId, "2015:1");
  const unknown = await acquireFederalMoney("federal-audit-clearinghouse", "ZZ", options); assert.equal(unknown.facts[0].identifiers.reportId, "2015:3"); assert.equal(downloads, 1);
});
test("SAM gzip JSON streams in bounded pages and rejects incomplete counts before persisting source bytes", async () => {
  const sample = JSON.parse(fixture("sam-official-example.json")), entityData = Array.from({ length: 1001 }, (_, i) => ({ ...sample, entityRegistration: { ...sample.entityRegistration, ueiSAM: `SYNTH${i}` } }));
  const first = await acquireFederalMoney("sam-gov-entities", "CA", { now, samGovApiKey: "private-key", fetch: async () => streamed(gzipSync(JSON.stringify({ totalRecords: 1001, entityData }))) });
  await rm(cacheRoot, { recursive: true, force: true });
  const second = await acquireFederalMoney("sam-gov-entities", "CA", { now, cursor: first.continuation, fetch: async () => { throw new Error("No repeat extract."); } });
  const third = await acquireFederalMoney("sam-gov-entities", "CA", { now, cursor: second.continuation, fetch: async () => { throw new Error("No repeat extract."); } });
  assert.deepEqual([first, second, third].map(page => page.facts.length), [500, 500, 1]);
  const separate = new MemoryEvidenceStore();
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "AZ", { now, evidenceStore: separate, samGovApiKey: "private-key", fetch: async () => streamed(gzipSync(JSON.stringify({ totalRecords: 1002, entityData }))) }), /row count did not reconcile/);
  assert.deepEqual(await separate.list("project/meanwhile/source/federal-money/"), []);
});
test("an interrupted CSV worker resumes its saved byte checkpoint without redownloading or revaulting completed chunks", async () => {
  const header = "assistance_transaction_unique_key,assistance_type,action_date,federal_action_obligation,primary_place_of_performance_state_code,primary_place_of_performance_county_code\n";
  const archive = zip("Assistance_Transactions.csv", header + Array.from({ length: 1203 }, (_, i) => `TX-${i},04,2026-01-01,5,CA,001\n`).join(""));
  const abort = new AbortController(), originalPut = evidenceStore.put.bind(evidenceStore); let captures = 0, downloads = 0;
  evidenceStore.put = async (key, bytes, meta) => { await originalPut(key, bytes, meta); if (meta.contentType === "text/csv" && ++captures === 1) abort.abort(new Error("Synthetic worker deadline")); };
  const cursor = { source: "usaspending" as const, phase: "download", year: 2026, fileUrl: "https://files.usaspending.gov/resume.zip", statusUrl: "https://api.usaspending.gov/status" };
  const fetcher: typeof fetch = async url => String(url).endsWith("/status") ? json({ status: "finished" }) : (downloads++, streamed(archive));
  await assert.rejects(acquireFederalMoney("usaspending", "CA", { now, cursor, signal: abort.signal, fetch: fetcher }), /Synthetic worker deadline/);
  const result = await acquireFederalMoney("usaspending", "CA", { now, cursor, fetch: fetcher });
  assert.equal(result.facts.length, 500); assert.equal(downloads, 1); assert.equal(captures, 3);
  const ids = [result.facts, (await acquireFederalMoney("usaspending", "CA", { now, cursor: result.continuation, fetch: fetcher })).facts].flat().map(row => row.id);
  assert.equal(new Set(ids).size, 1000);
});

test("USAspending daily checks filter publication changes across all action years", async () => {
  let body: Record<string, unknown> = {};
  const result = await acquireFederalMoney("usaspending", "CA", { now, since: "2026-10-11T01:20:00Z", fetch: async (url, init) => {
    if (String(url).includes("/bulk_download/awards/")) { body = JSON.parse(String(init?.body)); return json({ status_url: "https://api.usaspending.gov/status", file_url: "https://files.usaspending.gov/changed.zip" }); }
    return json({ status: "running" });
  } });
  assert.deepEqual(body.filters, { agencies: [{ type: "awarding", tier: "toptier", name: "all" }], prime_award_types: ["02", "03", "04", "05"], place_of_performance_locations: [{ country: "USA", state: "CA" }], date_type: "last_modified_date", date_range: { start_date: "2026-10-11", end_date: "2026-10-12" } });
  assert.equal(result.continuation?.since, "2026-10-11T01:20:00Z");
});
test("live custom bulk rows retain current source type, county FIPS, current district and publication date", () => {
  const control = JSON.parse(fixture("usaspending-bulk-request-live-2026-10-15.json"));
  const facts = parsed("usaspending", `${control.file_url}#Assistance_Transactions.csv`, fixture("usaspending-bulk-rows-live-2026-10-15.csv"), "WY");
  assert.equal(facts.length, 3); assert.equal(facts[0].kind, "GRANT"); assert.equal(facts[0].uei, "F4QXBFCNV9D3");
  assert.equal(facts[0].amount, 18656.51); assert.equal(facts[0].provenance.publicationDate, "2025-01-13T16:18:38.735Z");
  assert.deepEqual(facts[0].geography, [{ type: "congressional", geoid: "5600" }]);
  assert.deepEqual(facts[1].geography, [{ type: "county", geoid: "56003" }, { type: "congressional", geoid: "5600" }]);
});
test("live custom contracts and loans preserve current types, county reach and separate loan face value", () => {
  const [contract] = parsed("usaspending", "https://files.usaspending.gov/generated_downloads/live.zip#Contracts.csv", fixture("usaspending-bulk-contracts-rows-live-2026-10-15.csv"), "WY");
  assert.equal(contract.kind, "CONTRACT"); assert.equal(contract.sourceId, "9700_9700_SPE3SU25F5N0R_0_SPE30021DR747_0"); assert.equal(contract.amount, 2941.3);
  assert.deepEqual(contract.geography, [{ type: "county", geoid: "56021" }, { type: "congressional", geoid: "5600" }]);
  const [loan] = parsed("usaspending", "https://files.usaspending.gov/generated_downloads/live.zip#Assistance.csv", fixture("usaspending-bulk-loans-rows-live-2026-10-15.csv"), "WY");
  assert.equal(loan.kind, "LOAN"); assert.equal(loan.amount, 0); assert.equal(loan.details.loanFaceValue, 350000); assert.equal(loan.details.subsidyCost, 0);
  assert.deepEqual(loan.geography, [{ type: "county", geoid: "56019" }, { type: "congressional", geoid: "5600" }]);
});
test("live FAC general reports and each child table retain published fields and publication dates", () => {
  const [general] = parsed("federal-audit-clearinghouse", "https://api.fac.gov/general", fixture("fac-general-live-2026-10-15.json"), "CA");
  assert.equal(general.sourceId, "2026-03-GSAFAC-0000428231"); assert.equal(general.amount, 87149136); assert.equal(general.provenance.publicationDate, "2026-10-09T00:00:00.000Z"); assert.equal(general.details.lowRiskAuditee, true);
  const [finding] = parsed("federal-audit-clearinghouse", "https://api.fac.gov/findings", fixture("fac-findings-live-2026-10-15.json"), "CA");
  assert.equal(finding.details.significantDeficiency, true); assert.equal(finding.provenance.publicationDate, "2026-10-13T00:00:00.000Z");
  const [text] = parsed("federal-audit-clearinghouse", "https://api.fac.gov/findings_text", fixture("fac-findings-text-live-2026-10-15.json"), "CA");
  const [plan] = parsed("federal-audit-clearinghouse", "https://api.fac.gov/corrective_action_plans", fixture("fac-corrective-plans-live-2026-10-15.json"), "CA");
  assert.match(String(text.details.findingText), /Single Audit Process/); assert.match(String(plan.details.plannedAction), /formal process/);
  assert.equal(text.identifiers.reportId, finding.identifiers.reportId); assert.equal(plan.identifiers.findingReference, finding.identifiers.findingReference);
  const [additional] = parsed("federal-audit-clearinghouse", "https://api.fac.gov/additional_ueis", fixture("fac-additional-ueis-live-2026-10-15.json"), "CA");
  assert.equal(additional.uei, "D8MBRZJDGXV8"); assert.equal(additional.identifiers.reportId, "2026-05-GSAFAC-0000427768");
});
test("live historic FAC native finding identifiers retain separate requirements sharing a reported reference", () => {
  const url = "https://app.fac.gov/dissemination/public-data/census/csv/census-2015.zip";
  const [general] = parsed("federal-audit-clearinghouse", `${url}#2015/ELECAUDITHEADER.csv`, fixture("fac-historic-2015-general-live-2026-10-15.csv"), "OK");
  assert.equal(general.sourceId, "2015:100000"); assert.equal(general.amount, 2110965); assert.equal(general.provenance.publicationDate, "2016-02-18T00:00:00.000Z");
  const findings = parsed("federal-audit-clearinghouse", `${url}#2015/ELECAUDITFINDINGS.csv`, fixture("fac-historic-2015-findings-live-2026-10-15.csv"), "ZZ");
  assert.equal(findings.length, 6); assert.equal(new Set(findings.map(row => row.id)).size, 6);
  const shared = findings.filter(row => row.identifiers.reportId === "2015:135702");
  assert.deepEqual(shared.map(row => row.identifiers.findingReference), ["2015-001", "2015-001"]);
  assert.deepEqual(shared.map(row => row.identifiers.sourceRowId), ["838591", "762403"]);
  assert.deepEqual(shared.map(row => row.details.requirement), ["B", "A"]);
});
test("FAC keeps current reports with missing or invalid states in the unresolved state partition", async () => {
  const result = await acquireFederalMoney("federal-audit-clearinghouse", "ZZ", { now, since: "2026-10-01", dataGovApiKey: "synthetic-key", fetch: async url => {
    const request = new URL(String(url)); assert.equal(request.pathname, "/general"); assert.equal(request.searchParams.has("auditee_state"), false);
    assert.match(request.searchParams.get("or")!, /^\(auditee_state\.is\.null,auditee_state\.not\.in\.\(/); assert.ok(request.searchParams.get("or")!.includes("CA"));
    return json([{ report_id: "SYNTHETIC-INVALID-STATE", auditee_state: "XX", audit_year: "2025" }, { report_id: "SYNTHETIC-MISSING-STATE", auditee_state: null, audit_year: "2025" }]);
  } });
  assert.deepEqual(result.facts.map(row => row.state), ["ZZ", "ZZ"]); assert.deepEqual(result.facts.map(row => row.details.reportedState), ["XX", null]);
  assert.deepEqual(result.continuation?.reportIds, ["SYNTHETIC-INVALID-STATE", "SYNTHETIC-MISSING-STATE"]);
});
test("Treasury current district identifiers join current cards while original district stays attributed", () => {
  const csv = "assistance_transaction_unique_key,assistance_type_code,action_date,prime_award_transaction_place_of_performance_state_fips_code,prime_award_transaction_place_of_performance_cd_original,prime_award_transaction_place_of_performance_cd_current\nSYNTHETIC-REDISTRICTED,04,2015-01-01,06,CA-14,CA-15\n";
  const [fact] = parsed("usaspending", "https://files.usaspending.gov/generated_downloads/fixture.zip#Assistance.csv", csv, "CA");
  assert.deepEqual(fact.geography, [{ type: "congressional", geoid: "0615" }]); assert.equal(fact.details.originalCongressionalDistrict, "CA-14");
  const [unmapped] = parsed("usaspending", "https://files.usaspending.gov/generated_downloads/fixture.zip#Assistance.csv", csv.replace("CA-15", ""), "CA");
  assert.deepEqual(unmapped.geography, []); assert.equal(unmapped.details.originalCongressionalDistrict, "CA-14");
});
