import test from "node:test";
import assert from "node:assert/strict";
import { censusPublisherSize, heldPublisherSize, publisherSizeForState, publisherSizeHoldings, type PublisherSizeHolding, type PublisherSizeSource } from "../lib/sources/publisher-size.ts";
import { websiteRequestLimit } from "../lib/control-plane/scheduler/host-supervision.ts";
import { factDb } from "./helpers/fact-db.ts";

const source: PublisherSizeSource = { url: "https://census.gov/test-fixture", dataset: "TEST FIXTURE", sha256: "a".repeat(64),
  archiveSha256: "b".repeat(64), row: 1, sheet: "TEST FIXTURE" };
const row = { state: "NY", web_address: "https://town.gov", census_id_pid6: "000123",
  unit_name: "TEST FIXTURE TOWN", gov_type: "MUNICIPAL", unit_type_raw: "2 - MUNICIPAL", is_active: "Y",
  population: "9,999", population_year: "2021", enrollment: "", enrollment_year: "" };
/** A fresh database holding exactly these rows, one handle per call so no state is shared between cases. */
async function holding(state: string, rows: readonly PublisherSizeHolding[]) {
  const db = await factDb();
  for (const [index, row] of rows.entries()) {
    await db.query("INSERT INTO publisher_size (state, dataset, source_row, host, release, holding) VALUES ($1, $2, $3, $4, 'test', $5::jsonb)",
      [state, row.source.dataset, index + 1, row.host, JSON.stringify(row)]);
  }
  return db.query;
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

test("the requested state's exact host alone supplies size; unrelated states stay unread", async () => {
  const size = censusPublisherSize(row, source)!;
  const query = await holding("ny", [size]);
  const read = await publisherSizeForState(query, "NY");
  assert.equal(read("http://town.gov/calendar")?.population, 9999);
  assert.equal((await publisherSizeForState(query, "pa"))("https://town.gov"), null);
  assert.equal(read("https://www.town.gov"), null);
  assert.equal(read("https://census.gov"), null);
  assert.equal((await publisherSizeForState(query, "../ny"))("https://town.gov"), null);
  assert.equal(read("file:///town.gov"), null);
  const reads: string[] = [];
  const spy: typeof query = (text, params) => { reads.push(String(params?.[0])); return query(text, params); };
  await publisherSizeForState(spy, "ny"); await publisherSizeForState(spy, "ny");
  assert.deepEqual(reads, ["ny"], "a state is read once per handle");
});

test("shared-host ambiguity stays unknown; counts merge only for the same PID6 publisher", async () => {
  const size = censusPublisherSize(row, source)!;
  const readOf = async (rows: readonly PublisherSizeHolding[]) => heldPublisherSize(await publisherSizeHoldings(await holding("ny", rows), "ny"), "https://town.gov");
  assert.equal(await readOf([size, { ...size, censusId: "TEST-OTHER", population: 50 }]), null);
  const supplement = censusPublisherSize({ ...row, population: "", population_year: "", enrollment: "3000", enrollment_year: "2020" }, { ...source, dataset: "TEST SUPPLEMENT", row: 2 })!;
  const merged = (await readOf([size, supplement]))!;
  assert.equal(merged.population, 9999); assert.equal(merged.populationYear, 2021);
  assert.equal(merged.students, 3000); assert.equal(merged.studentsYear, 2020);
  assert.equal(merged.sources.length, 2); assert.equal(websiteRequestLimit(merged), 10);
  const dependent = censusPublisherSize({ ...row, census_id_pid6: "000456", gov_type: "DEPENDENT SCHOOL SYSTEM",
    population: "", population_year: "", enrollment: "3000", enrollment_year: "2020" }, source)!;
  assert.equal(await readOf([size, dependent]), null, "a dependent operation's distinct PID6 never aliases its parent");
  assert.equal(await readOf([size, { ...size, population: 20000 }]), null);
});

test("without a database every publisher is unknown", async () => {
  assert.equal((await publisherSizeForState(null, "ny"))("https://town.gov"), null);
});
