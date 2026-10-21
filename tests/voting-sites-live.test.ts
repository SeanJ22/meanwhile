import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fillVotingSitesAnswer } from "../lib/ballot/voting-sites-live.ts";
import { recordVotingLookupCount } from "../lib/ballot/voting-sites-counts.ts";
import { votingSitesResponse } from "../lib/ballot/voting-sites-stream.ts";
import { answerVotingSites } from "../lib/ballot/voting-answer.ts";
import { votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import type { VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";

const empty: VotingSitesAnswer = { match: true, point: null, jurisdictions: [], outsideCoverage: true, pollingPlaceLinks: [] };
const place = { ...votingPlaceFromZip(["ocd-division/country:us/state:mi/county:ingham"]), precision: "ADDRESS" as const };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const options = { apiKey: "private-test-key", fetchImpl: (async (input: URL) =>
  new Response(fixture(input.pathname.endsWith("elections") ? "elections" : "mi-voterinfo"))) as unknown as typeof fetch };

test("an empty held answer gets live Google locations, hours, assignment and required Sources", async () => {
  const before = Date.now();
  const answer = await fillVotingSitesAnswer(empty, "private reader street", place, options);
  assert.equal(answer.outsideCoverage, false);
  assert.equal(answer.googleFallback?.requested, true);
  assert.equal(answer.jurisdictions[0].narrowing.kind, "EXACT");
  assert.match(JSON.stringify(answer), /FIRST PRESBYTERIAN CHURCH/);
  assert.match(JSON.stringify(answer), /7 am - 8 pm/);
  assert.ok(answer.jurisdictions[0].sources?.some(source => source.title === "Voting information powered by the Civic Information API"));
  assert.ok(answer.jurisdictions[0].sources?.some(source => source.title === "Election office" && source.url.includes("lansingmi.gov")));
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
  assert.ok(Date.parse(answer.expiresAt!) <= before + 24 * 60 * 60 * 1000 + 50);
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
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key/);
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
