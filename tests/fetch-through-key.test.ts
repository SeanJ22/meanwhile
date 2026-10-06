import test from "node:test";
import assert from "node:assert/strict";
import { fetchThroughKey, composeFinanceDetail } from "../lib/ask/fetch-through-key.ts";
import type { EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
const subject: EvidenceSubject = { kind: "PERSON", id: "held-person", name: "Held Member" };
const summary: EvidenceRecord = { kind: "FINANCE_SUMMARY", id: "fec:H00000001", subjectId: subject.id,
  canonicalSubjectId: "H00000001", text: "This campaign has raised $20,000 in the 2025–26 election cycle.",
  sourceUrl: "https://www.fec.gov/data/candidate/H00000001/", sourceOrg: "Federal Election Commission",
  fecDetailSource: { committeeId: "C00000001", cycle: 2026 } };
const question = "List every PAC that gave to Held Member this year";
const row = (id: string, entity = "PAC") => ({ sub_id: id, committee_id: "C00000001", entity_type: entity,
  contributor_name: entity === "IND" ? "PRIVATE DONOR" : `Filed PAC ${id}`, contribution_receipt_amount: 50.25,
  contribution_receipt_date: "2026-09-01", line_number: "11C", contributor_city: "PRIVATE CITY",
  contributor_street_1: "PRIVATE ADDRESS", pdf_url: `https://docquery.fec.gov/pdf/${id}.pdf` });

test("detail uses the registered credential transport and complete keyset pages, returning source-bound public rows only", async () => {
  const started = Date.now();
  let calls = 0;
  const result = await fetchThroughKey({ question, subject, records: [summary], deadlineMs: Date.now() + 2000,
    now: new Date("2026-10-05T23:00:00Z"), apiOptions: { env: { FEC_API_KEY: "fixture-secret" },
      fetchImpl: async (url, init) => {
        calls++; const address = new URL(String(url));
        assert.equal(address.origin, "https://api.open.fec.gov"); assert.equal(address.searchParams.get("api_key"), "fixture-secret");
        assert.equal(address.searchParams.get("committee_id"), "C00000001"); assert.equal(address.searchParams.get("min_date"), "2026-01-01");
        assert.equal(init?.redirect, "error");
        if (calls === 1) return Response.json({ results: [row("1"), row("2", "IND")], pagination: { count: 3, last_indexes: { last_index: "2", last_contribution_receipt_amount: 50.25 } } });
        assert.equal(address.searchParams.get("last_index"), "2");
        return Response.json({ results: [row("3")], pagination: { count: 3 } });
      } } });
  assert.equal(result?.status, "COMPLETE"); assert.equal(calls, 2); assert.equal(result.records.length, 2);
  const serialized = JSON.stringify(result);
  for (const hidden of ["fixture-secret", "api_key", "PRIVATE", "street_1", "city"]) assert.ok(!serialized.includes(hidden), hidden);
  assert.equal(result.records[0]?.sourceUrl, "https://docquery.fec.gov/pdf/1.pdf");
  assert.equal(composeFinanceDetail(result).citedUrls.length, 3);
  assert.ok(result.records.every(row => Date.parse(row.retrievedAt!) >= started && Date.parse(row.retrievedAt!) <= Date.now()), "receipt dates come from the actual API read, not the question calendar");
});

test("a slow detail read falls back within the request deadline and keeps the stored source without a false complete list", async () => {
  const started = Date.now();
  const result = await fetchThroughKey({ question, subject, records: [summary], deadlineMs: started + 60,
    apiOptions: { env: { FEC_API_KEY: "fixture-secret" }, fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("provider timeout fixture-secret")), { once: true });
    }) } });
  assert.ok(Date.now() - started < 500); assert.equal(result?.status, "UNAVAILABLE");
  assert.ok(composeFinanceDetail(result!).answer.includes(summary.text));
  assert.deepEqual(composeFinanceDetail(result!).citedUrls, [summary.sourceUrl]);
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
});

test("missing identity, ordinary totals and a changing publisher denominator never become every-PAC completeness", async () => {
  let calls = 0;
  const readApi = async () => { calls++; return { status: 200, sourceUrl: "https://api.open.fec.gov/v1/schedules/schedule_a/", requests: 1, bytes: 100,
    text: JSON.stringify({ results: [row(String(calls))], pagination: { count: calls === 1 ? 3 : 4, last_indexes: { last_index: String(calls), last_contribution_receipt_amount: 50.25 } } }) }; };
  assert.equal(await fetchThroughKey({ question: "How much did Held Member raise?", subject, records: [summary], deadlineMs: Date.now() + 1000, readApi }), null);
  assert.equal(await fetchThroughKey({ question, subject, records: [{ ...summary, fecDetailSource: undefined }], deadlineMs: Date.now() + 1000, readApi }), null);
  assert.equal(calls, 0);
  const result = await fetchThroughKey({ question, subject, records: [summary], deadlineMs: Date.now() + 1000, readApi });
  assert.equal(result?.status, "PARTIAL"); assert.equal(result?.records.length, 1); assert.equal(calls, 2);
});


test("FEC's large numeric filing IDs retain their exact source digits and incomplete classifications remain partial", async () => {
  const raw = JSON.stringify({ results: [row("large")], pagination: { count: 1 } }).replace('"sub_id":"large"', '"sub_id":4021420181409336200');
  const result = await fetchThroughKey({ question, subject, records: [summary], deadlineMs: Date.now() + 1000,
    readApi: async () => ({ sourceUrl: "https://api.open.fec.gov/v1/schedules/schedule_a/", status: 200, text: raw, requests: 1, bytes: raw.length }) });
  assert.equal(result?.status, "COMPLETE"); assert.equal(result.records[0].id, "fec-detail:C00000001:4021420181409336200");
  const unknown = { ...row("unknown", "COM"), contributor: null };
  const partial = await fetchThroughKey({ question, subject, records: [summary], deadlineMs: Date.now() + 1000,
    readApi: async () => ({ sourceUrl: "https://api.open.fec.gov/v1/schedules/schedule_a/", status: 200,
      text: JSON.stringify({ results: [row("known"), unknown], pagination: { count: 2 } }), requests: 1, bytes: 100 }) });
  assert.equal(partial?.status, "PARTIAL"); assert.equal(partial.records.length, 1);
});

test("large numeric FEC keyset cursors retain their original digits on the next registered request", async () => {
  const cursor="20260901987654321";let calls=0;
  const result=await fetchThroughKey({question,subject,records:[summary],deadlineMs:Date.now()+1000,
    readApi:async (_tool,request)=>{
      calls++;
      if(calls===2) {
        assert.ok(request && typeof request === "object" && "params" in request);
        const params = request.params as Record<string, unknown>;
        assert.equal(params.last_index,cursor,"no rounded cursor can be sent to the source");
      }
      const results=JSON.stringify([row(String(calls))]);
      const raw=calls===1 ? `{"results":${results},"pagination":{"count":2,"last_indexes":{"last_index":${cursor},"last_contribution_receipt_amount":50.25}}}` :
        `{"results":${results},"pagination":{"count":2}}`;
      return {sourceUrl:"https://api.open.fec.gov/v1/schedules/schedule_a/",status:200,text:raw,requests:1,bytes:raw.length};
    }});
  assert.equal(calls,2);assert.equal(result?.status,"COMPLETE");assert.equal(result?.records.length,2);
});
