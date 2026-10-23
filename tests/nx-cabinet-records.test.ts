import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { acquireCabinetRecords, acquireOpmHeadcounts, cabinetConfirmation, cabinetDepartment, currentOpmRelease, departmentBudget,
  departmentRegisterActions, opmHeadcountsFromParquet, spendingAgency, USA_AGENCIES_URL, OPM_EMPLOYMENT_URL, type CabinetPage } from "../lib/sources/white-house/cabinet-records.ts";
import type { Officeholder } from "../lib/officials/types.ts";

const root = new URL("./fixtures/nx-executive/cabinet/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, root));
const sources = JSON.parse(fixture("sources.json").toString()).sources as { file: string; url: string; retrievedAt: string; sha256: string }[];
function page(name: string): CabinetPage {
  const source = sources.find(row => row.file === name)!;
  const bytes = fixture(name);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  return { url: source.url, retrievedAt: source.retrievedAt, body: bytes.toString() };
}
const own = cabinetDepartment("Secretary of State")!;
const bessent = { id: "white-house:scott-bessent", name: "Scott Bessent", officeTitle: "Secretary of the Treasury", termStart: "2025-01-28", executive: {} } as Officeholder;

test("USAspending uses a source agency key and agency resources, never the whole-government total", () => {
  assert.deepEqual(spendingAgency(page("usa-agencies.json"), own), { code: "019", name: "Department of State" });
  const budget = departmentBudget(page("usa-state-budget.json"), "019")!;
  assert.equal(budget.amount, 95192566149.49);
  assert.equal(budget.fiscalYear, 2026); // The newer FY2027 row is explicitly null.
  assert.equal(budget.label, "Budgetary resources");
  assert.equal(budget.sourceUrl, page("usa-state-budget.json").url);
  assert.throws(() => departmentBudget(page("usa-state-budget.json"), "020"), /IDENTITY_INVALID/);
  const forged = { ...page("usa-state-budget.json"), body: JSON.stringify({ ...JSON.parse(page("usa-state-budget.json").body), toptier_code: "020" }) };
  assert.throws(() => departmentBudget(forged, "019"), /AGENCY_MISMATCH/);
});

test("Federal Register department records retain the issuing department and publication date", () => {
  const actions = departmentRegisterActions(page("fr-state.json"), own);
  assert.equal(actions.length, 3);
  assert.equal(actions[0].id, "federal-register:2026-21595");
  assert.equal(actions[0].date, "2026-10-22");
  assert.equal(actions[0].kind, "Notice");
  assert.equal(actions[0].evidenceSourceUrl, page("fr-state.json").url);
  assert.equal(departmentRegisterActions(page("fr-state.json"), own, "2026-10-21").length, 1);
  const bad = { ...page("fr-state.json"), url: page("fr-state.json").url.replace("state-department", "labor-department") };
  assert.throws(() => departmentRegisterActions(bad, own), /QUERY_AGENCY_MISMATCH/);
  const wrongRow = { ...page("fr-state.json"), body: page("fr-state.json").body.replaceAll('"slug":"state-department"', '"slug":"labor-department"').replaceAll('"slug": "state-department"', '"slug": "labor-department"').replaceAll('/agencies/state-department', '/agencies/labor-department') };
  assert.throws(() => departmentRegisterActions(wrongRow, own), /ROW_AGENCY_MISMATCH/);
});

test("Congress.gov partitioned nomination binds the person and office and reads confirmation instead of cloture", () => {
  const confirmation = cabinetConfirmation(page("congress-bessent.json"), bessent, page("congress-bessent-actions.json"))!;
  assert.equal(confirmation.date, "2025-01-27");
  assert.equal(confirmation.yeas, 68);
  assert.equal(confirmation.nays, 29);
  assert.equal(confirmation.sourceUrl, "https://www.congress.gov/nomination/119th-congress/11-1");
  assert.match(confirmation.quote, /^Confirmed by the Senate/);
  assert.throws(() => cabinetConfirmation(page("congress-bessent.json"), { name: "Marco Rubio", officeTitle: "Secretary of State" }), /PERSON_OFFICE_MISMATCH/);
  assert.throws(() => cabinetConfirmation(page("congress-bessent.json"), { ...bessent, officeTitle: "Deputy Secretary of the Treasury" }), /PERSON_OFFICE_MISMATCH/);
  const noConfirmation = JSON.parse(page("congress-bessent.json").body);
  noConfirmation.nomination.latestAction = { actionDate: "2025-01-25", text: "Cloture invoked in Senate by Yea-Nay Vote. 67 - 23." };
  assert.equal(cabinetConfirmation({ ...page("congress-bessent.json"), body: JSON.stringify(noConfirmation) }, bessent), null);
});

const rangeManifest = JSON.parse(fixture("opm-ranges.json").toString()) as { url: string; retrievedAt: string; byteLength: number; ranges: { start: number; end: number; file: string; sha256: string }[] };
function opmFile() {
  let bytesRead = 0;
  const ranges = rangeManifest.ranges.map(range => {
    const bytes = fixture(range.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), range.sha256);
    return { ...range, bytes };
  });
  return { get bytesRead() { return bytesRead; }, file: { byteLength: rangeManifest.byteLength, slice(start: number, end = rangeManifest.byteLength): ArrayBuffer {
    const out = new Uint8Array(end - start);
    let covered = 0;
    for (const range of ranges) {
      const a = Math.max(start, range.start), b = Math.min(end, range.end);
      if (a >= b) continue;
      out.set(range.bytes.subarray(a - range.start, b - range.start), a - start); covered += b - a;
    }
    assert.equal(covered, end - start, `Test attempted to read an unsaved OPM range: ${start}-${end}`);
    bytesRead += out.byteLength;
    return out.buffer;
  } } };
}

test("OPM chooses the latest published current snapshot independently of metadata list order", () => {
  const release = currentOpmRelease(page("opm-employment-files.json"));
  assert.equal(release.snapshot, "2026-08");
  assert.equal(release.version, 1);
  assert.equal(release.url, rangeManifest.url);
});

test("OPM actual ZSTD Parquet source ranges sum count across every page while projecting only agency columns", async () => {
  const input = opmFile(), release = currentOpmRelease(page("opm-employment-files.json"));
  const snapshot = await opmHeadcountsFromParquet(input.file, release);
  assert.equal(snapshot.counts["DEPARTMENT OF STATE"], 11252);
  assert.equal(snapshot.counts["DEPARTMENT OF DEFENSE"], 680072);
  assert.equal(snapshot.counts["OFFICE OF MANAGEMENT AND BUDGET"], 513);
  assert.equal(snapshot.counts["OFFICE OF THE U.S. TRADE REPRESENTATIVE"], 223);
  assert.equal(snapshot.counts["CENTRAL INTELLIGENCE AGENCY"], undefined);
  assert.equal(snapshot.snapshot, "2026-08");
  assert.ok(input.bytesRead < 1_400_000, `${input.bytesRead} bytes read from a 57.3MB source`);
});

test("OPM acquisition persists replayable exact byte ranges and refuses a truncated response", async () => {
  const input = opmFile(), captures: number[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": String(rangeManifest.byteLength) } });
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("Range")!)!;
    const start = Number(match[1]), end = Number(match[2]) + 1;
    return new Response(input.file.slice(start, end), { status: 206, headers: { "content-range": `bytes ${start}-${end - 1}/${rangeManifest.byteLength}` } });
  };
  const snapshot = await acquireOpmHeadcounts({ read: async url => { assert.equal(url, OPM_EMPLOYMENT_URL); return page("opm-employment-files.json"); }, fetchImpl,
    saveRange: async (_url, range) => { assert.equal(createHash("sha256").update(range.bytes).digest("hex"), range.sha256); captures.push(range.bytes.length); } });
  assert.equal(snapshot.counts["DEPARTMENT OF LABOR"], 11112);
  assert.ok(captures.length > 1);
  await assert.rejects(acquireOpmHeadcounts({ read: async () => page("opm-employment-files.json"), fetchImpl: async (_url, init) => init?.method === "HEAD"
    ? new Response(null, { headers: { "content-length": "100" } }) : new Response("incomplete", { status: 206, headers: { "content-range": "bytes 0-99/100" } }) }), /TRUNCATED/);
});

test("one failed source preserves independent Cabinet facts and never completes an uncovered intelligence headcount", async () => {
  const read = async (url: string) => {
    if (url === USA_AGENCIES_URL) return page("usa-agencies.json");
    if (url.includes("/agency/019/")) return { ...page("usa-state-budget.json"), url };
    if (url.includes("federalregister.gov")) return { ...page("fr-state.json"), url };
    throw new Error("Nomination source temporarily unavailable");
  };
  const records = await acquireCabinetRecords({ person: { ...bessent, name: "Marco Rubio", officeTitle: "Secretary of State" }, read,
    opm: { sourceUrl: rangeManifest.url, collectedAt: rangeManifest.retrievedAt, snapshot: "2026-08", counts: { "DEPARTMENT OF STATE": 11252 } } });
  assert.equal(records.department?.budget?.amount, 95192566149.49);
  assert.equal(records.department?.headcount?.count, 11252);
  assert.equal(records.department?.actions.length, 3);
  assert.equal(records.coverage.confirmation, false);
  assert.ok(records.gaps.some(gap => gap.includes("Nomination source temporarily unavailable")));
  assert.equal(cabinetDepartment("Secretary of War")?.registerSlug, "defense-department");
  assert.equal(cabinetDepartment("White House Chief of Staff"), null);
});
