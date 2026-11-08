import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/election-results/route.ts";
import { readNationalElectionResults } from "../lib/reader/election-results.ts";
import { summarizeCongressResults, updateCongressResults } from "../lib/election-results/summary.ts";
import type { ElectionResult } from "../lib/election-results/types.ts";
import { installElectionResultFeedStore } from "../lib/election-results/feed-store.ts";
import type { StateResultFeed } from "../lib/election-results/feed-types.ts";
import { electionFeedFixture } from "./helpers/election-feed-fixture.ts";

const at = "2026-11-08T02:00:00.000Z";
const race: ElectionResult = { sourceId: "ballotpedia", sourceName: "Ballotpedia", sourceUrl: "https://ballotpedia.org/Synthetic_Arizona_race",
  sourceRaceId: "Synthetic_Arizona_race", state: "AZ", office: "us_house", officeName: "U.S. House Arizona", electionDate: "2026-11-03",
  status: "called", seatsFlipped: 1, incumbentsLost: 1, candidates: [{ name: "Synthetic winner", party: "D", won: true }],
  checkedAt: at, quote: "Synthetic source quote", creditedSources: [] };

test("the actual map GET reads one published blob and sees the next job without any database work", async context => {
  const copy = electionFeedFixture(context);
  let results = updateCongressResults(undefined, [race]);
  const save = async (checkedAt: string) => copy.store.writeNation(summarizeCongressResults(Object.values(results), checkedAt));
  await save(at);
  const first = await GET(new Request("https://preview.example/api/election-results")), value = await first.json();
  assert.equal(first.status, 200);
  assert.equal(value.states.AZ.us_house.seatsFlipped, 1);
  assert.equal(value.states.AZ.us_house.seatsNow.D, 1);
  assert.deepEqual(copy.reads, ["nation.json"]);
  assert.equal(copy.databaseReads(), 0);
  assert.doesNotMatch(first.headers.get("Netlify-CDN-Cache-Control")!, /durable|stale/i);
  const nextAt = "2026-11-08T08:00:00.000Z";
  results = updateCongressResults(results, [{ ...race, sourceRaceId: "second-race", checkedAt: nextAt }]);
  await save(nextAt);
  const next = await (await GET(new Request("https://preview.example/api/election-results"))).json();
  assert.deepEqual(copy.reads, ["nation.json", "nation.json"]);
  assert.equal(copy.databaseReads(), 0);
  assert.equal(next.states.AZ.us_house.seatsFlipped, 2);
  assert.equal(next.checkedAt, nextAt);
});

test("an unpopulated summary differs from a failed read", async context => {
  const copy = electionFeedFixture(context);
  assert.equal(await readNationalElectionResults(copy.store), null);
  installElectionResultFeedStore({ ...copy.store, readNation: async () => { throw new Error("Synthetic blob read failure"); } });
  const response = await GET(new Request("https://preview.example/api/election-results"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).available, false);
  assert.equal(copy.databaseReads(), 0, "a failed blob read has no database fallback");
});

test("state GET and POST return only the selected contest's result IDs and aliases plus summaries from one blob", async context => {
  const copy = electionFeedFixture(context);
  const state = "ocd-division/country:us/state:az", nation = "ocd-division/country:us";
  const feed: StateResultFeed = { formatVersion: 1, state: "AZ", ballotVersion: "served-version", checkedAt: at, fingerprint: "synthetic-fingerprint",
    facts: { "contest-a": { status: "called" }, "contest-alias": { status: "called" }, "candidate-a": { votes: 120 },
      "candidate-alias": { votes: 120 }, "measure-a": { yesVotes: 80 }, "other-contest": { status: "counting" },
      "other-candidate": { votes: 12 }, [state]: { governor: { name: "Synthetic governor" } },
      [nation]: { chambers: [] }, [`${nation}#election_summary:us_house`]: { chambers: [] } },
    contestIds: { "contest-a": ["contest-alias", "candidate-a", "candidate-alias", "measure-a"], "other-contest": ["other-candidate"] } };
  await copy.store.writeState("AZ", feed);
  const get = await GET(new Request("https://preview.example/api/election-results?state=AZ&contests=contest-a"));
  const value = await get.json();
  assert.equal(get.status, 200);
  assert.deepEqual(Object.keys(value.facts).sort(), ["contest-a", "contest-alias", "candidate-a", "candidate-alias", "measure-a", state, nation,
    `${nation}#election_summary:us_house`].sort());
  assert.deepEqual(value.contestIds, { "contest-a": feed.contestIds!["contest-a"] });
  assert.deepEqual(copy.reads, ["states/AZ.json"], "state and national summaries share this one published state blob");
  const post = await POST(new Request("https://preview.example/api/election-results", { method: "POST", body: JSON.stringify({ state: "AZ", contests: ["contest-a"] }) }));
  assert.deepEqual(await post.json(), value);
  assert.equal(post.headers.get("Cache-Control"), "no-store");
  assert.equal(copy.databaseReads(), 0);
  const unknown = await (await GET(new Request("https://preview.example/api/election-results?state=AZ&contests=constructor"))).json();
  assert.equal(unknown.available, true);
  assert.equal(unknown.facts["other-contest"], undefined);
});

test("invalid selections never read a blob or database", async context => {
  const copy = electionFeedFixture(context);
  assert.equal((await GET(new Request("https://preview.example/api/election-results?state=../secrets"))).status, 400);
  assert.equal((await POST(new Request("https://preview.example/api/election-results", { method: "POST", body: JSON.stringify({ state: "AZ", contests: [123] }) }))).status, 400);
  assert.deepEqual(copy.reads, []);
  assert.equal(copy.databaseReads(), 0);
});
