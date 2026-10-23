import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { fillVotingSitesAnswer } from "../lib/ballot/voting-sites-live.ts";
import { recordVotingLookupCount } from "../lib/ballot/voting-sites-counts.ts";
import { votingSitesResponse } from "../lib/ballot/voting-sites-stream.ts";
import { answerVotingSites } from "../lib/ballot/voting-answer.ts";
import { votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import type { VotingFallbackReason, VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import { GOOGLE_CIVIC_DOCS } from "../lib/sources/google-civic/targets.ts";

const empty: VotingSitesAnswer = { match: true, point: null, jurisdictions: [], outsideCoverage: true };
const place = { ...votingPlaceFromZip(["ocd-division/country:us/state:mi/county:ingham"]), precision: "ADDRESS" as const };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const options = { apiKey: "private-test-key", fetchImpl: (async (input: URL) =>
  new Response(fixture(input.pathname.endsWith("elections") ? "elections" : "mi-voterinfo"))) as unknown as typeof fetch };

test("an empty held answer gets live Google locations, hours, assignment and required Sources", async () => {
  const before = Date.now();
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, options);
  const after = Date.now();
  assert.equal(answer.outsideCoverage, false);
  assert.equal(answer.googleFallback?.requested, true);
  assert.equal(answer.jurisdictions[0].narrowing.kind, "EXACT");
  assert.match(JSON.stringify(answer), /FIRST PRESBYTERIAN CHURCH/);
  assert.match(JSON.stringify(answer), /7 am - 8 pm/);
  assert.ok(answer.jurisdictions[0].sources?.some(source => source.title === "Voting information powered by the Civic Information API"));
  assert.ok(answer.jurisdictions[0].sources?.some(source => source.title === "Election office" && source.url === "https://mvic.sos.state.mi.us/Voter/Index"));
  assert.equal(answer.electionOffices, undefined, "office fallback is shown only without sites");
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
  const expiresAt = Date.parse(answer.expiresAt!);
  assert.ok(expiresAt >= before + 24 * 60 * 60 * 1000);
  assert.ok(expiresAt <= after + 24 * 60 * 60 * 1000);
  assert.equal(answer.googleFallback?.reason, undefined);
});

test("every lookup is fresh, ZIPs never claim an assigned precinct, and a mismatched state is rejected", async () => {
  let requests = 0;
  const fresh = { ...options, fetchImpl: (async (input: URL) => { requests++; return options.fetchImpl(input); }) as unknown as typeof fetch };
  await fillVotingSitesAnswer(empty, "private reader street", place, fresh);
  const zip = await fillVotingSitesAnswer(empty, "48933", { ...place, precision: "ZIP" }, fresh);
  assert.equal(requests, 4, "neither the street nor its Google answer is cached");
  assert.equal(zip.jurisdictions[0].narrowing.kind, "REFUSED");
  assert.deepEqual(zip.jurisdictions[0].assignedSiteIds, []);
  const mismatch = await fillVotingSitesAnswer(empty, "private reader street", { ...place, states: ["TX"] }, options);
  assert.equal(mismatch.outsideCoverage, true);
  assert.equal(mismatch.jurisdictions.length, 0);
});

test("AZ, NH and NJ held answers win without any Google request", async () => {
  for (const state of ["AZ", "NH", "NJ"]) {
    const j = { ocdId: `ocd-division/country:us/state:${state.toLowerCase()}`, name: "Held election office", state,
      model: "VOTE_CENTER" as const, election: "2026 General", collectedAt: "2026-10-20", sourceOrg: "Held official office", sourceUrl: "https://official.example.gov/locations", refusal: null,
      sites: [{ id: `held-${state}`, name: "Held official site", address: "Public office", kind: "VOTE_CENTER" as const,
        room: null, lat: null, lng: null, election: "2026 General", serves: null, countyFips: "protocol" }] };
    const selected = { ...place, states: [state], divisionIds: [j.ocdId], countyFips: ["protocol"] };
    const held = await answerVotingSites({ generatedAt: "2026-10-20", jurisdictions: [j] }, selected);
    const answer = await fillVotingSitesAnswer(held, "private reader street", selected, { fetchImpl: async () => { throw new Error("Held official answer must win"); } });
    assert.strictEqual(answer, held);
    assert.equal(answer.jurisdictions[0].sites[0].id, `held-${state}`);
  }
});

test("provider errors cannot echo the private address or key into the answer", async () => {
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options,
    fetchImpl: async () => new Response("private reader street private-test-key", { status: 403 }) });
  assert.equal(answer.outsideCoverage, true);
  assert.equal(answer.googleFallback?.reason, "GOOGLE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
});

const noLocations = () => {
  const raw = JSON.parse(fixture("mi-voterinfo"));
  delete raw.pollingLocations; delete raw.earlyVoteSites; delete raw.dropOffLocations;
  return Response.json(raw);
};

for (const scenario of [
  { name: "a missing key", apiKey: "", reason: "KEY_MISSING", response: () => { assert.fail("a missing key must not make a request"); } },
  { name: "a network failure", reason: "GOOGLE_UNAVAILABLE", response: () => { throw new Error("private reader street private-test-key"); } },
  { name: "a provider timeout", reason: "GOOGLE_UNAVAILABLE", response: () => { throw new DOMException("private reader street private-test-key", "TimeoutError"); } },
  { name: "a provider outage", reason: "GOOGLE_UNAVAILABLE", response: () => new Response("private reader street private-test-key", { status: 503 }) },
  { name: "a rejected credential", reason: "GOOGLE_UNAVAILABLE", response: () => new Response("private reader street private-test-key", { status: 403 }) },
  { name: "an unreadable response", reason: "GOOGLE_UNAVAILABLE", response: () => new Response("private reader street private-test-key") },
  { name: "no sites in a successful response", reason: "NO_DATA", response: noLocations },
  { name: "an unresolved address", reason: "NO_DATA", response: () => new Response("private reader street private-test-key", { status: 400 }) },
  { name: "an address with no voter information", reason: "NO_DATA", response: () => new Response("private reader street private-test-key", { status: 404 }) },
] satisfies { name: string; apiKey?: string; reason: VotingFallbackReason; response: () => Response }[]) {
  test(`empty fallback diagnostics distinguish ${scenario.name} without returning private input`, async () => {
    let requests = 0;
    const answer = await fillVotingSitesAnswer(empty, "private reader street", place, {
      ...options, apiKey: scenario.apiKey ?? options.apiKey, sleep: async () => {},
      fetchImpl: (async (input: URL) => {
        requests++;
        return input.pathname.endsWith("elections") ? new Response(fixture("elections")) : scenario.response();
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(answer.googleFallback, { requested: true, available: false, reason: scenario.reason });
    assert.equal(answer.outsideCoverage, true);
    assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
    if (scenario.reason === "KEY_MISSING") assert.equal(requests, 0);
    if (scenario.name === "no sites in a successful response") {
      assert.ok(answer.electionOffices?.some(office => office.url), "office links survive a no-sites response");
    }
  });
}

test("a missing election catalog is an unavailable provider rather than no data for an address", async () => {
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options,
    fetchImpl: async () => new Response("", { status: 404 }) });
  assert.equal(answer.googleFallback?.reason, "GOOGLE_UNAVAILABLE");
});

test("a no-sites response leads with Google's local office, preserving live contacts and preferring its polling-place finder", async () => {
  const data = JSON.parse(fixture("mi-voterinfo"));
  delete data.pollingLocations; delete data.earlyVoteSites; delete data.dropOffLocations;
  data.state[0].local_jurisdiction.electionAdministrationBody.hours = "Monday–Friday, 8 am–5 pm";
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options, fetchImpl: googleFetch(JSON.stringify(data)) });
  assert.deepEqual(answer.electionOffices?.[0], {
    name: "LANSING CITY", address: "701 W JOLLY RD, LANSING, MI 48910", phone: "5174834133",
    email: "ROBIN.STITES@LANSINGMI.GOV", hours: "Monday–Friday, 8 am–5 pm", url: "https://mvic.sos.state.mi.us/Voter/Index",
    source: { publisher: "Google", title: "Voting information powered by the Civic Information API",
      url: GOOGLE_CIVIC_DOCS, checkedAt: answer.electionOffices![0].source.checkedAt },
  });
});

test("missing Google offices use only the requested state's FEC election office, without inventing address or hours", async () => {
  const data = JSON.parse(fixture("mi-voterinfo"));
  delete data.pollingLocations; delete data.earlyVoteSites; delete data.dropOffLocations; delete data.state;
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options, fetchImpl: googleFetch(JSON.stringify(data)) });
  assert.equal(answer.electionOffices?.length, 1);
  const office = answer.electionOffices![0];
  assert.match(office.name, /Michigan|Lansing, MI/);
  assert.ok(office.phone);
  assert.match(office.url!, /michigan.gov/);
  assert.match(office.source.url, /fec.gov/);
  assert.equal(office.address, undefined);
  assert.equal(office.hours, undefined);
});

test("anonymous counts atomically increment only day, ZIP and deduplicated divisions", async () => {
  const calls: { text: string; params: string[] }[] = [];
  const district = "ocd-division/country:us/state:mi/cd:7";
  await recordVotingLookupCount({ day: "2026-10-20", zip: "48933", districts: [district, district] }, async (text, params) => { calls.push({ text, params }); });
  assert.deepEqual(calls[0].params, ["2026-10-20", "48933", JSON.stringify([district])]);
  assert.match(calls[0].text, /ON CONFLICT/);
  assert.match(calls[0].text, /events = reader_event_totals.events \+ 1/);
  assert.doesNotMatch(calls[0].text, /reader_event_members|reader_event_batches|reader_hash|source|address/i);
  await assert.rejects(recordVotingLookupCount({ day: "2026-10-20", zip: "123 Private St", districts: [] }, async () => { assert.fail("invalid count must not be written"); }));
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("../lib/db/migrations/0034_reader_events.sql", import.meta.url), "utf8"));
    const query = async (text: string, params: string[]) => { await db.query(text, params); };
    const count = { day: "2026-10-20", zip: "48933", districts: [district, district] };
    await recordVotingLookupCount(count, query);
    await recordVotingLookupCount(count, query);
    const result = await db.query<{ events: number; users: number; zip: string; district: string }>("SELECT events::int, users::int, zip, district FROM reader_event_totals");
    assert.deepEqual(result.rows, [{ events: 2, users: 0, zip: "48933", district }]);
    assert.deepEqual((await db.query("SELECT * FROM reader_event_members")).rows, []);
    assert.deepEqual((await db.query("SELECT * FROM reader_event_batches")).rows, []);
  } finally { await db.close(); }
});

test("a slow result streams pending immediately and presents its eventual answer on the same request", async () => {
  let finish!: (answer: VotingSitesAnswer) => void;
  const response = await votingSitesResponse(new Promise(resolve => { finish = resolve; }), true);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const reader = response.body!.getReader();
  const initial = await reader.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(initial.value)), { pending: true });
  finish(empty);
  const final = await reader.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(final.value)), { answer: empty });
  assert.equal((await reader.read()).done, true);
});

test("JSON clients still receive a complete answer and a cancelled stream closes safely", async () => {
  const response = await votingSitesResponse(Promise.resolve(empty), false);
  assert.deepEqual(await response.json(), empty);
  let finish!: (answer: VotingSitesAnswer) => void;
  const streaming = await votingSitesResponse(new Promise(resolve => { finish = resolve; }), true);
  await streaming.body!.cancel();
  finish(empty);
});

const withoutPoints = () => {
  const data = JSON.parse(fixture("mi-voterinfo"));
  for (const field of ["pollingLocations", "earlyVoteSites", "dropOffLocations"]) for (const row of data[field] ?? []) { delete row.latitude; delete row.longitude; }
  return JSON.stringify(data);
};
const googleFetch = (voterinfo: string) => (async (input: URL) => new Response(input.pathname.endsWith("elections") ? fixture("elections") : voterinfo)) as unknown as typeof fetch;
const pinned = (answer: VotingSitesAnswer) => answer.jurisdictions.flatMap(j => j.sites).filter(site => site.lat !== null && site.lng !== null);
const siteCount = (answer: VotingSitesAnswer) => answer.jurisdictions.flatMap(j => j.sites).length;

test("the location Google sends becomes the pin, with no Census request", async () => {
  let census = 0;
  const data = JSON.parse(fixture("mi-voterinfo"));
  for (const field of ["pollingLocations", "earlyVoteSites", "dropOffLocations"]) for (const row of data[field] ?? []) { row.latitude ??= 42.7; row.longitude ??= -84.5; }
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options, fetchImpl: googleFetch(JSON.stringify(data)),
    censusFetchImpl: (async () => { census++; throw new Error("Census must not be asked"); }) as unknown as typeof fetch });
  assert.equal(census, 0);
  assert.ok(siteCount(answer) > 0);
  assert.equal(pinned(answer).length, siteCount(answer));
  assert.ok(pinned(answer).every(site => site.geocodeSource === "PUBLISHER"));
});

test("a site Google did not place is looked up by its own published address, never the reader's", async () => {
  const sent: string[] = [];
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options, fetchImpl: googleFetch(withoutPoints()),
    censusFetchImpl: (async (_url: URL, init: RequestInit) => {
      const file = (init.body as FormData).get("addressFile") as Blob;
      const rows = (await file.text()).split("\n");
      sent.push(...rows);
      return new Response(rows.map((row, i) => `"${i}","${row.slice(row.indexOf(",") + 1)}","Match","Exact","X","-84.55,42.73","1","L"`).join("\n"));
    }) as unknown as typeof fetch });
  assert.equal(sent.length, siteCount(answer), "one batch request covers every unplaced site");
  assert.doesNotMatch(sent.join("\n"), /private reader street|private-test-key/);
  assert.equal(pinned(answer).length, siteCount(answer));
  assert.ok(pinned(answer).every(site => site.geocodeSource === "CENSUS" && site.lat === 42.73 && site.lng === -84.55));
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
});

test("when Census cannot place a site it stays listed without a pin", async () => {
  const down = { ...options, fetchImpl: googleFetch(withoutPoints()), censusFetchImpl: (async () => new Response("private reader street", { status: 503 })) as unknown as typeof fetch };
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, down);
  assert.ok(siteCount(answer) > 0);
  assert.equal(pinned(answer).length, 0);
  assert.equal(answer.outsideCoverage, false);
  const partial = await fillVotingSitesAnswer(empty, "private reader street", place, { ...down,
    censusFetchImpl: (async () => new Response('"0","a","No_Match"\n"1","b","Match","Exact","c","-84.5,42.7","1","L"\n')) as unknown as typeof fetch });
  assert.equal(pinned(partial).length, 1);
});

test("a Google location outside the United States is not pinned", async () => {
  const data = JSON.parse(withoutPoints());
  for (const row of data.pollingLocations ?? []) { row.latitude = 0; row.longitude = 0; }
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, { ...options, fetchImpl: googleFetch(JSON.stringify(data)),
    censusFetchImpl: (async () => new Response("")) as unknown as typeof fetch });
  assert.equal(pinned(answer).length, 0);
});
