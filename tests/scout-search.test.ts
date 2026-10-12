/**
 * The compliant search seam: pointers only, both providers, inert without a key.
 * Every request shape is asserted against a fake fetch — no live calls.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SEARCH_HOSTS } from "../lib/control-plane/discovery/search-runtime.ts";
import { makeScoutSearch, braveSearch, exaSearch, SCOUT_SEARCH_HOSTS, type FetchLike, type ScoutSearchBudget } from "../lib/control-plane/scheduler/scout-search.ts";

/** A budget that admits everything — for the tests about request shape, not spend. */
const OPEN_BUDGET: ScoutSearchBudget = { take: async () => null, done: async () => {} };

interface SeenCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch that returns a scripted body per URL substring and records every call. */
function fakeFetch(script: { match: string; status?: number; body: unknown }[]): { fetchImpl: FetchLike; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const hit = script.find((s) => url.includes(s.match));
    const status = hit?.status ?? (hit ? 200 : 404);
    const text = typeof hit?.body === "string" ? hit.body : JSON.stringify(hit?.body ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetchImpl, calls };
}

const BRAVE_BODY = { web: { results: [
  { title: "Rogers for County Attorney", url: "https://rogersforcountyattorney.com/", description: "should be ignored" },
  { title: "News", url: "https://www.concordmonitor.com/x" },
] } };
const EXA_BODY = { results: [
  { title: "Rogers for County Attorney", url: "https://rogersforcountyattorney.com/" }, // dup of brave -> deduped
  { title: "Ballotpedia", url: "https://ballotpedia.org/Sarah_Rogers" },
] };

test("makeScoutSearch is null when neither key is set — the tool stays inert", () => {
  assert.equal(makeScoutSearch({ budget: OPEN_BUDGET }), null);
  assert.equal(makeScoutSearch({ braveKey: "  ", exaKey: "", budget: OPEN_BUDGET }), null);
  assert.notEqual(makeScoutSearch({ braveKey: "k", budget: OPEN_BUDGET }), null);
  assert.notEqual(makeScoutSearch({ exaKey: "k", budget: OPEN_BUDGET }), null);
});

test("Brave request: correct endpoint, X-Subscription-Token header, count; returns url+title pointers", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api.search.brave.com", body: BRAVE_BODY }]);
  const out = await braveSearch("q", "brave-key", fetchImpl, 5000, 5);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://api.search.brave.com/res/v1/web/search"), "the API host, not the disallowed search.brave.com web UI");
  assert.ok(calls[0].url.includes("count=5"));
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers["X-Subscription-Token"], "brave-key");
  assert.deepEqual(out.hits.map((h) => h.url), ["https://rogersforcountyattorney.com/", "https://www.concordmonitor.com/x"]);
  assert.ok(out.hits.every((h) => h.provider === "brave"));
});

test("Exa request: POST, Bearer auth, type fast, numResults, with source text and no synthesis", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api.exa.ai", body: EXA_BODY }]);
  const out = await exaSearch("q", "exa-key", fetchImpl, 5000, 5, ["*.gov", "*.us"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.exa.ai/search");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer exa-key");
  const body = JSON.parse(calls[0].body ?? "{}");
  assert.equal(body.type, "fast", "a URL, not reasoning");
  assert.equal(body.numResults, 5);
  assert.deepEqual(body.includeDomains, ["*.gov", "*.us"]);
  assert.deepEqual(body.contents, {text:{maxCharacters:6000}});
  assert.ok(!("outputSchema" in body), "NO outputSchema — no synthesis");
  assert.ok(!calls[0].url.includes("/answer"), "not the /answer endpoint");
  assert.deepEqual(out.hits.map((h) => h.url), ["https://rogersforcountyattorney.com/", "https://ballotpedia.org/Sarah_Rogers"]);
});

test("combined: both providers queried, results deduped by URL, errors named without failing the call", async () => {
  const { fetchImpl } = fakeFetch([
    { match: "api.search.brave.com", body: BRAVE_BODY },
    { match: "api.exa.ai", body: EXA_BODY },
  ]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl, budget: OPEN_BUDGET });
  assert.notEqual(search, null);
  const res = await search!({ query: "Sarah Rogers for Merrimack County Attorney" });
  assert.deepEqual([...res.providersUsed].sort(), ["brave", "exa"]);
  const urls = res.hits.map((h) => h.url);
  assert.equal(new Set(urls.map((u) => u.toLowerCase())).size, urls.length, "no duplicate URL across providers");
  assert.ok(urls.includes("https://rogersforcountyattorney.com/"));
  assert.ok(urls.includes("https://ballotpedia.org/Sarah_Rogers"));
  assert.equal(res.errors.length, 0);
});

test("combined: one provider erroring is named, the other's hits still return", async () => {
  const { fetchImpl } = fakeFetch([
    { match: "api.search.brave.com", status: 429, body: "rate limited" },
    { match: "api.exa.ai", body: EXA_BODY },
  ]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl, budget: OPEN_BUDGET });
  const res = await search!({ query: "q" });
  assert.deepEqual(res.providersUsed, ["exa"]);
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].startsWith("brave:") && res.errors[0].includes("429"));
  assert.ok(res.hits.length > 0, "exa's hits still return");
});

test("an empty query returns an empty result without calling any provider", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api", body: {} }]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl, budget: OPEN_BUDGET });
  const res = await search!({ query: "   " });
  assert.equal(res.hits.length, 0);
  assert.equal(calls.length, 0);
});

/* Every provider request is admitted against the owner's switch and budget first. */
test("every paid provider request is admitted by the budget first; a refused provider sends nothing and is named", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { match: "api.search.brave.com", body: BRAVE_BODY },
    { match: "api.exa.ai", body: EXA_BODY },
  ]);
  const taken: string[] = [];
  const released: string[] = [];
  const budget: ScoutSearchBudget = {
    take: async (host) => {
      taken.push(host);
      return host === SCOUT_SEARCH_HOSTS.exa ? "the cycle's 50-request search budget is spent" : null;
    },
    done: async (host) => { released.push(host); },
  };
  const res = await makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl, budget })!({ query: "q" });
  assert.deepEqual(taken, [SCOUT_SEARCH_HOSTS.brave, SCOUT_SEARCH_HOSTS.exa], "one admission per provider, in turn");
  assert.equal(calls.length, 1, "the refused provider was never called");
  assert.ok(calls[0].url.includes("api.search.brave.com"));
  assert.equal(res.requestCount, 1, "only the request sent is counted");
  assert.deepEqual(res.providersUsed, ["brave"]);
  assert.ok(res.errors.some((e) => e.startsWith("exa: not sent,") && e.includes("search budget is spent")));
  assert.deepEqual(released, [SCOUT_SEARCH_HOSTS.brave], "the slot taken is returned; none is returned that was not taken");
});

test("a budget that cannot be read sends no paid request at all", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api", body: {} }]);
  const unreadable: ScoutSearchBudget = { take: async () => { throw new Error("budget ledger unreadable"); }, done: async () => {} };
  const res = await makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl, budget: unreadable })!({ query: "q" });
  assert.equal(calls.length, 0);
  assert.equal(res.requestCount, 0);
  assert.equal(res.errors.length, 2);
  assert.ok(res.errors.every((e) => e.includes("the paid-search budget could not be read (budget ledger unreadable)")));
});

test('one failed budget release does not strand the other provider or discard returned source data', async()=>{
  const released:string[]=[];
  const {fetchImpl}=fakeFetch([{match:'api.search.brave.com',body:BRAVE_BODY},{match:'api.exa.ai',body:EXA_BODY}]);
  const result=await makeScoutSearch({braveKey:'b',exaKey:'e',fetchImpl,budget:{take:async()=>null,done:async host=>{
    released.push(host);if(host===SCOUT_SEARCH_HOSTS.brave)throw Error('temporary persistence failure');
  }}})!({query:'q'});
  assert.deepEqual(released,[SCOUT_SEARCH_HOSTS.brave,SCOUT_SEARCH_HOSTS.exa]);
  assert.equal(result.requestCount,2);
  assert.ok(result.hits.length>0);
  assert.ok(result.errors.some(error=>error.includes('budget slot release failed')));
});

test('two successful providers release their shared budget row without overlapping writes',async()=>{
  const occupied=new Set<string>();let writing=false;
  const {fetchImpl}=fakeFetch([{match:'api.search.brave.com',body:BRAVE_BODY},{match:'api.exa.ai',body:EXA_BODY}]);
  const result=await makeScoutSearch({braveKey:'b',exaKey:'e',fetchImpl,budget:{
    take:async host=>{occupied.add(host);return null;},done:async host=>{
      if(writing)throw Error('shared budget row is locked');
      writing=true;await new Promise(resolve=>setImmediate(resolve));occupied.delete(host);writing=false;
    },
  }})!({query:'q'});
  assert.deepEqual(result.providersUsed,['brave','exa']);assert.deepEqual(result.errors,[]);
  assert.equal(occupied.size,0,'neither successful provider strands its slot');
});

test("the Scout search is admitted under the same hosts as the discovery walk's search, so one per-day cap binds both", () => {
  assert.deepEqual({ ...SCOUT_SEARCH_HOSTS }, { ...SEARCH_HOSTS });
});
