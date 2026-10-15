import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { censusPublisherSize, heldPublisherSize, publisherSizeForState, type PublisherSizeHolding, type PublisherSizeSource } from "../lib/sources/publisher-size.ts";
import { websiteRequestLimit, websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { fetchSource, runWithSourceFetch, SourceFetchDeferred } from "../lib/sources/fetch-source.ts";
import { fileSourceFetchStore } from "../lib/sources/fetch-source-state.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";

const source: PublisherSizeSource = { url: "https://census.gov/test-fixture", dataset: "TEST FIXTURE", sha256: "a".repeat(64),
  archiveSha256: "b".repeat(64), row: 1, sheet: "TEST FIXTURE" };
const row = { state: "NY", web_address: "https://town.gov", census_id_pid6: "000123",
  unit_name: "TEST FIXTURE TOWN", gov_type: "MUNICIPAL", unit_type_raw: "2 - MUNICIPAL", is_active: "Y",
  population: "9,999", population_year: "2021", enrollment: "", enrollment_year: "" };
function root(t: test.TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "s16-publisher-size-"));
  t.after(() => { assert.equal(dirname(resolve(path)), resolve(tmpdir())); rmSync(path, { recursive: true, force: true }); });
  return path;
}
function holding(root: string, state: string, rows: readonly PublisherSizeHolding[]) {
  const path = join(root, "data", "states", state, "reference", "publisher-sizes.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n"));
  return path;
}

test("held Census counts retain their real years, source and government identity", () => {
  const size = censusPublisherSize(row, source)!;
  assert.equal(size.population, 9999); assert.equal(size.populationYear, 2021);
  assert.equal(size.students, null); assert.equal(size.studentsYear, null);
  assert.equal(size.censusId, "000123"); assert.deepEqual(size.source, source);
  assert.equal(websiteRequestLimit(size), 10);
  assert.equal(websiteRequestLimit(censusPublisherSize({ ...row, population: "10000" }, source)), null);
  assert.equal(websiteRequestLimit(censusPublisherSize({ ...row, population: "unknown" }, source)), null);
  assert.equal(censusPublisherSize({ ...row, gov_type: "UNREAD TYPE" }, source), null);
  assert.equal(censusPublisherSize({ ...row, census_id_pid6: "" }, source), null);
});

test("independent schools use enrollment; dependent operations retain the parent publisher's kind", () => {
  const school = censusPublisherSize({ ...row, gov_type: "SCHOOL DISTRICT", population: "", enrollment: "4999", enrollment_year: "2020" }, source)!;
  assert.equal(school.kind, "school-district"); assert.equal(school.studentsYear, 2020);
  assert.equal(websiteRequestLimit(school), 10);
  assert.equal(websiteRequestLimit({ ...school, students: 5000 }), null);
  const state = censusPublisherSize({ ...row, gov_type: "DEPENDENT SCHOOL SYSTEM", unit_type_raw: "0 - STATE", population: "", enrollment: "2000" }, source)!;
  assert.equal(state.kind, "state"); assert.equal(websiteRequestLimit(state), null);
});

test("the requested state's publisher supplies size across www aliases; unrelated holdings stay unopened", t => {
  const path = root(t), size = censusPublisherSize(row, source)!;
  holding(path, "ny", [size]);
  const other = holding(path, "pa", []); writeFileSync(other, "NOT JSON");
  assert.equal(heldPublisherSize("NY", "http://town.gov/calendar", path)?.population, 9999);
  assert.equal(heldPublisherSize("pa", "https://town.gov", path), null);
  assert.equal(heldPublisherSize("ny", "https://www.town.gov", path)?.population, 9999);
  assert.equal(heldPublisherSize("ny", "https://meetings.town.gov", path), null);
  assert.equal(heldPublisherSize("ny", "https://census.gov", path), null);
  assert.equal(heldPublisherSize("../ny", "https://town.gov", path), null);
  assert.equal(heldPublisherSize("ny", "file:///town.gov", path), null);
});

test("www aliases merge only the same government and retain independent subdomains", t => {
  const path = root(t), size = censusPublisherSize(row, source)!;
  const supplement = { ...size, host: "www.town.gov", population: null, populationYear: null,
    students: 3000, studentsYear: 2020, source: { ...source, dataset: "TEST SUPPLEMENT" } };
  holding(path, "ny", [size, supplement]);
  for (const host of ["town.gov", "www.town.gov"]) {
    const merged = heldPublisherSize("ny", `https://${host}`, path)!;
    assert.equal(merged.population, 9999);
    assert.equal(merged.students, 3000);
    assert.equal(merged.sources.length, 2);
  }
  holding(path, "ny", [size, { ...supplement, censusId: "TEST-OTHER" },
    { ...size, host: "meetings.town.gov", censusId: "TEST-SUBDOMAIN", population: 20000 }]);
  assert.equal(heldPublisherSize("ny", "https://town.gov", path), null);
  assert.equal(heldPublisherSize("ny", "https://www.town.gov", path), null);
  assert.equal(heldPublisherSize("ny", "https://meetings.town.gov", path)?.population, 20000);
});

test("canonical fetch counts apex and www redirects together against the held small publisher's hourly limit", async t => {
  for (const heldHost of ["town.gov", "www.town.gov"]) {
    const path = root(t), size = censusPublisherSize(row, source)!;
    holding(path, "ny", [{ ...size, host: heldHost }]);
    let requests = 0, now = Date.parse("2026-10-15T12:00:00Z");
    const transport: typeof fetch = async input => {
      requests++;
      return String(input) === "https://town.gov/calendar"
        ? new Response(null, { status: 302, headers: { location: "https://www.town.gov/calendar" } })
        : new Response("calendar");
    };
    await runWithSourceFetch({ websiteSize: websiteSizeFromHoldings(["ny"], path), vault: new MemoryEvidenceStore(),
      runtime: { store: fileSourceFetchStore(path), transport, now: () => now } }, async () => {
      assert.equal(await (await fetchSource("https://town.gov/calendar")).text(), "calendar");
      for (let index = 0; index < 8; index++) await (await fetchSource(`https://${index % 2 ? "www." : ""}town.gov/page/${index}`)).body?.cancel();
      assert.equal(requests, 10);
      for (const host of ["town.gov", "www.town.gov"]) await assert.rejects(fetchSource(`https://${host}/next`), SourceFetchDeferred);
      assert.equal(requests, 10, `${heldHost} supplies the cap to both forms of its publisher hostname`);
      now += 3_600_000;
      await (await fetchSource("https://www.town.gov/next")).body?.cancel();
      assert.equal(requests, 11);
    });
  }
});

test("shared-host ambiguity stays unknown; counts merge only for the same PID6 publisher", t => {
  const path = root(t), size = censusPublisherSize(row, source)!;
  holding(path, "ny", [size, { ...size, censusId: "TEST-OTHER", population: 50 }]);
  assert.equal(heldPublisherSize("ny", "https://town.gov", path), null);
  const supplement = censusPublisherSize({ ...row, population: "", population_year: "", enrollment: "3000", enrollment_year: "2020" }, { ...source, dataset: "TEST SUPPLEMENT", row: 2 })!;
  holding(path, "ny", [size, supplement]);
  const merged = heldPublisherSize("ny", "https://town.gov", path)!;
  assert.equal(merged.population, 9999); assert.equal(merged.populationYear, 2021);
  assert.equal(merged.students, 3000); assert.equal(merged.studentsYear, 2020);
  assert.equal(merged.sources.length, 2); assert.equal(websiteRequestLimit(merged), 10);
  const dependent = censusPublisherSize({ ...row, census_id_pid6: "000456", gov_type: "DEPENDENT SCHOOL SYSTEM",
    population: "", population_year: "", enrollment: "3000", enrollment_year: "2020" }, source)!;
  holding(path, "ny", [size, dependent]);
  assert.equal(heldPublisherSize("ny", "https://town.gov", path), null, "a dependent operation's distinct PID6 never aliases its parent");
  holding(path, "ny", [size, { ...size, population: 20000 }]);
  assert.equal(heldPublisherSize("ny", "https://town.gov", path), null);
});

test("state streaming crosses UTF-8 chunk boundaries and supplies S8's synchronous callback", t => {
  const path = root(t), size = censusPublisherSize(row, source)!;
  const other = { ...size, host: "unrelated.gov", name: "TEST FIXTURE é".repeat(5000) };
  holding(path, "ny", [other, size]);
  const read = publisherSizeForState("ny", path);
  assert.equal(read("https://town.gov/meetings")?.population, 9999);
  assert.equal(read("https://town.gov/agenda")?.population, 9999);
  assert.equal(websiteRequestLimit(read("https://unrecorded.gov")), null);
  assert.equal(read("https://town.gov/agenda")?.population, 9999);
  const replacement = join(path, "data", "states", "ny", "reference", "publisher-sizes.jsonl");
  writeFileSync(`${replacement}.new`, JSON.stringify({ ...size, population: 8888 }));
  renameSync(`${replacement}.new`, replacement);
  assert.equal(read("https://town.gov/agenda")?.population, 8888);
});
