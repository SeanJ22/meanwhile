import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { archiveCrc32 } from "../lib/sources/archive.ts";
import { acquireFederalMoney } from "../lib/federal-money/acquire.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import type { FederalMoneyCapture } from "../lib/federal-money/model.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/federal-money/${name}`, import.meta.url), "utf8");
const now = () => "2026-10-12T23:20:00.000Z";
const captured = (url: string, body: string): FederalMoneyCapture => ({ url, body, retrievedAt: now(), publicationDate: null });
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });
// Explicitly synthetic transport archives exercise source-native CSV shapes, not real government claims.
function zip(name: string, body: string): Uint8Array {
  const filename = Buffer.from(name), bytes = Buffer.from(body), crc = archiveCrc32(bytes);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + bytes.length, 16);
  return Buffer.concat([local, filename, bytes, central, filename, end]);
}
test("real OpenFEMA response retains county designation, publication date and official raw provenance", () => {
  const body = fixture("openfema-live.json"), capture = captured("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1", body);
  const [fact] = parseFederalMoney("openfema", capture, "AR");
  assert.equal(fact.sourceId, "ac5ae0bd-30cc-4973-9a9f-6a0b9901496e");
  assert.deepEqual(fact.geography, [{ type: "county", geoid: "05103" }]);
  assert.equal(fact.details.placeCode, "99103"); assert.equal(fact.geography.some(value => value.type === "place"), false);
  assert.equal(fact.provenance.publicationDate, "2026-09-15T00:00:00.000Z"); assert.equal(fact.provenance.official, true);
  assert.equal(fact.provenance.rawHash, createHash("sha256").update(body).digest("hex")); assert.equal(fact.joinStatus, "UNJOINED");
});
test("official Treasury documented response preserves separate modifications on one award", () => {
  const facts = parseFederalMoney("usaspending", captured("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", fixture("usaspending-official-example.json")), "VA");
  assert.equal(facts.length, 10); assert.equal(new Set(facts.map(value => value.id)).size, 10);
  assert.equal(facts[0].amount, 15639242.36); assert.equal(facts[0].period, "2012-06-20");
  assert.equal(facts[0].uei, null); assert.equal(facts[0].provenance.publicationDate, null);
  assert.ok(facts.every(value => value.kind === "CONTRACT" && value.joinStatus === "UNJOINED"));
});
test("GSA's redacted example retains its published UEI without turning address into governing authority", () => {
  const [fact] = parseFederalMoney("sam-gov-entities", captured("https://open.gsa.gov/api/entity-api/", fixture("sam-official-example.json")), "CA");
  assert.equal(fact.uei, "WB23FJYKNLM1"); assert.equal(fact.recipient, "9TH CIRCUIT COURT OF APPEALS");
  assert.equal(fact.state, "XX"); assert.deepEqual(fact.geography, []); assert.deepEqual(fact.bodyIds, []);
});
test("OpenFEMA state pagination resumes beyond the first thousand and accepts unchanged empty pass", async () => {
  const source = JSON.parse(fixture("openfema-live.json"));
  const first = await acquireFederalMoney("openfema", "AR", { now, fetch: async url => { const request = new URL(String(url)); assert.equal(request.searchParams.get("$filter"), "state eq 'AR'"); return json({ metadata: { count: 1001 }, DisasterDeclarationsSummaries: Array.from({ length: 1000 }, (_, i) => ({ ...source.DisasterDeclarationsSummaries[0], id: `synthetic-${i}` })) }); } });
  assert.equal(first.complete, false); assert.equal(first.continuation?.offset, 1000);
  const second = await acquireFederalMoney("openfema", "AR", { now, cursor: first.continuation, fetch: async url => { assert.equal(new URL(String(url)).searchParams.get("$skip"), "1000"); return json({ metadata: { count: 1001 }, DisasterDeclarationsSummaries: [{ ...source.DisasterDeclarationsSummaries[0], id: "synthetic-1000" }] }); } });
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
  const result = await acquireFederalMoney("federal-audit-clearinghouse", "AZ", { now, maxPages: 5, since: "2026-01-01", dataGovApiKey: key, fetch: async (url, init) => {
    const request = new URL(String(url)); calls.push(request.pathname); assert.ok(!request.href.includes(key)); assert.equal(new Headers(init?.headers).get("X-Api-Key"), key);
    if (request.pathname === "/general") { assert.equal(request.searchParams.get("auditee_state"), "eq.AZ"); return json([{ report_id: "SYNTHETIC-2025-1", auditee_state: "AZ", auditee_uei: "SYNTHETICUEI", auditee_name: "SYNTHETIC GOVERNMENT", audit_year: "2025", fac_accepted_date: "2026-01-06", total_amount_expended: 4000 }], 200, { "Content-Range": "0-0/1" }); }
    assert.equal(request.searchParams.get("report_id"), "in.(SYNTHETIC-2025-1)"); assert.equal(request.searchParams.has("auditee_state"), false);
    if (request.pathname === "/findings") return json([{ report_id: "SYNTHETIC-2025-1", auditee_uei: "SYNTHETICUEI", reference_number: "2025-001", award_reference: "AWARD-1", is_material_weakness: "Y", is_questioned_costs: "N", type_requirement: "A" }]);
    if (request.pathname === "/findings_text") return json([{ report_id: "SYNTHETIC-2025-1", auditee_uei: "SYNTHETICUEI", finding_ref_number: "2025-001", finding_text: "Synthetic finding transport test." }]);
    return json([]);
  } });
  assert.equal(result.complete, true); assert.deepEqual(calls, ["/general", "/findings", "/findings_text", "/corrective_action_plans", "/additional_ueis"]);
  assert.equal(result.facts.length, 3); assert.equal(result.facts[1].details.materialWeakness, true); assert.equal(result.facts[1].details.questionedCosts, false); assert.equal(result.facts[2].details.findingText, "Synthetic finding transport test.");
  assert.ok(JSON.stringify(result).includes(key) === false);
});
test("USAspending discovers source history and resumes annual extracts without transaction-search truncation", async () => {
  let requestCalls = 0;
  const first = await acquireFederalMoney("usaspending", "AZ", { now, fetch: async (url, init) => {
    requestCalls++;
    if (String(url).includes("spending_by_transaction")) { const request = JSON.parse(String(init?.body)); assert.equal(request.order, "asc"); assert.equal(request.filters.time_period, undefined); return json({ results: [{ "Action Date": "2008-07-17" }] }); }
    if (String(url).endsWith("/search/")) { const request = JSON.parse(String(init?.body)); assert.equal(request.limit, undefined); assert.deepEqual(request.spending_level, ["transactions"]); assert.equal(request.filters.time_period[0].start_date, "2008-01-01"); return json({ status_url: "https://api.usaspending.gov/api/v2/download/status?file_name=synthetic.zip", file_url: "https://files.usaspending.gov/generated_downloads/synthetic.zip" }); }
    return json({ status: "running" });
  } });
  assert.equal(first.complete, false); assert.equal(first.facts.length, 0); assert.equal(first.continuation?.year, 2008); assert.equal(requestCalls, 3);
  const csv = "assistance_transaction_unique_key,assistance_award_unique_key,assistance_type,recipient_uei,recipient_name,action_date,federal_action_obligation,primary_place_of_performance_state_code,primary_place_of_performance_county_code,primary_place_of_performance_congressional_district,last_modified_date\nSYNTHETIC-TX,SYNTHETIC-AWARD,04,SYNTHETICUEI,SYNTHETIC GOVERNMENT,2008-07-17,123.5,AZ,013,04,2026-10-10\n";
  const second = await acquireFederalMoney("usaspending", "AZ", { now, cursor: first.continuation, fetch: async url => String(url).includes("/status?") ? json({ status: "finished" }) : new Response(Buffer.from(zip("Assistance_Transactions.csv", csv))) });
  assert.equal(second.facts[0].sourceId, "SYNTHETIC-TX"); assert.equal(second.facts[0].kind, "GRANT"); assert.equal(second.facts[0].uei, "SYNTHETICUEI"); assert.deepEqual(second.facts[0].geography, [{ type: "county", geoid: "04013" }, { type: "congressional", geoid: "0404" }]); assert.equal(second.continuation?.year, 2009);
});
test("SAM public GET authenticates state and download requests and keeps saved evidence credential-free", async () => {
  let calls = 0; const body = JSON.stringify({ entityData: [JSON.parse(fixture("sam-official-example.json"))] });
  const result = await acquireFederalMoney("sam-gov-entities", "CA", { now, samGovApiKey: "synthetic-key", maxPages: 2, fetch: async (url, init) => {
    calls++; assert.equal(new Headers(init?.headers).get("X-Api-Key"), "synthetic-key"); assert.equal(init?.method ?? "GET", "GET");
    const request = new URL(String(url)); assert.equal(request.searchParams.get("api_key"), "synthetic-key"); assert.equal(request.searchParams.has("apiKey"), false);
    if (request.pathname.endsWith("download-entities")) { assert.equal(request.searchParams.get("token"), "synthetic-download-token"); return new Response(gzipSync(body)); }
    assert.equal(request.searchParams.get("physicalAddressProvinceOrStateCode"), "CA"); assert.equal(request.searchParams.get("format"), "json"); assert.equal(request.searchParams.has("size"), false); assert.equal(request.searchParams.get("samRegistered"), calls === 1 ? "Yes" : "No");
    return json({ downloadURL: "https://api.sam.gov/entity-information/v3/download-entities?token=synthetic-download-token&api_key=REPLACE_WITH_API_KEY" });
  } });
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
  await assert.rejects(acquireFederalMoney("usaspending", "AZ", { fetch: async () => json({}) }), /historical date query/);
});
test("loan face value stays separate from obligations and subsidy costs", () => {
  const csv = "assistance_transaction_unique_key,assistance_type,recipient_uei,action_date,federal_action_obligation,face_value_of_loan,original_loan_subsidy_cost\nSYNTHETIC-LOAN,07,SYNTHETICUEI,2026-01-01,-5,1000000,2500\n";
  const [fact] = parseFederalMoney("usaspending", captured("https://files.usaspending.gov/generated_downloads/synthetic.zip#Assistance.csv", csv), "AZ");
  assert.equal(fact.kind, "LOAN"); assert.equal(fact.amount, -5); assert.equal(fact.amountLabel, "Federal obligation"); assert.equal(fact.details.loanFaceValue, 1_000_000); assert.equal(fact.details.subsidyCost, 2500);
});
test("historic FAC rows keep native year/DBKEY identity and flags", () => {
  const general = "AUDITYEAR,DBKEY,STATE,AUDITEENAME,TOTFEDEXPEND,FACACCEPTEDDATE,MATERIALWEAKNESS\n2015,123,AZ,SYNTHETIC GOVERNMENT,50000,2016-03-02,Y\n";
  const [fact] = parseFederalMoney("federal-audit-clearinghouse", captured("https://app.fac.gov/dissemination/public-data/census/census-2015.zip#2015%2FELECAUDITHEADER.csv", general), "AZ");
  assert.equal(fact.sourceId, "2015:123"); assert.equal(fact.amount, 50000); assert.equal(fact.details.materialWeakness, true); assert.equal(fact.provenance.publicationDate, "2016-03-02T00:00:00.000Z");
});
