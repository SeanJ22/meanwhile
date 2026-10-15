import assert from "node:assert/strict";
import test from "node:test";
import { makeHuntSearch, SEARCH_HOSTS, SEARCH_PRICE_USD, type FetchLike, type SearchBudget, type SearchCharge } from "../lib/hunt/search.ts";

const OPEN: SearchBudget = { take: async () => null, done: async () => {} };

function fakeFetch(answers: { brave?: unknown; exa?: unknown; braveStatus?: number }) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) as Record<string, unknown> : null });
    const brave = url.includes("search.brave.com");
    const status = brave ? answers.braveStatus ?? 200 : 200;
    const body = brave ? answers.brave : answers.exa;
    return { ok: status < 400, status, text: async () => JSON.stringify(body ?? {}) };
  };
  return { fetchImpl, calls };
}

const braveHit = { grounding: { generic: [{ url: "https://www.nogalesaz.gov/311/Mayor-and-Council", title: "Mayor and Council",
  snippets: ["Jorge Maldonado Mayor", "Hector Bojorquez Vice-Mayor"] }] } };
const exaHit = { results: [{ url: "https://www.nogalesaz.gov/311/Mayor-and-Council", title: "Mayor and Council",
  highlights: ["| Jorge Maldonado Mayor | Hector Bojorquez Vice-Mayor |"] }], costDollars: { total: 0.007 } };

test("Brave LLM Context answers first and Exa is never called for that query", async () => {
  const { fetchImpl, calls } = fakeFetch({ brave: braveHit, exa: exaHit });
  const charges: SearchCharge[] = [];
  const search = makeHuntSearch({ braveKey: "b", exaKey: "e", budget: OPEN, fetchImpl, onCharge: async c => { charges.push(c); } })!;
  const out = await search({ query: "Nogales city council members" });
  assert.equal(out.provider, "brave");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/res\/v1\/llm\/context\?/);
  assert.match(out.hits[0]!.text ?? "", /Jorge Maldonado/, "page text comes back with the result");
  assert.deepEqual(charges.map(c => [c.provider, c.usd]), [["brave", SEARCH_PRICE_USD.brave]]);
});

test("Exa search with highlights runs only when Brave misses, and its own charge is recorded", async () => {
  const { fetchImpl, calls } = fakeFetch({ brave: { grounding: { generic: [] } }, exa: exaHit });
  const charges: SearchCharge[] = [];
  const search = makeHuntSearch({ braveKey: "b", exaKey: "e", budget: OPEN, fetchImpl, onCharge: async c => { charges.push(c); } })!;
  const out = await search({ query: "Nogales city council members", fresh: true });
  assert.equal(out.provider, "exa");
  assert.equal(calls.length, 2);
  const body = calls[1]!.body!;
  assert.deepEqual(body.contents, { highlights: { maxCharacters: 1200, query: "Nogales city council members" }, maxAgeHours: 0 });
  assert.match(out.hits[0]!.text ?? "", /Hector Bojorquez/);
  assert.deepEqual(charges.map(c => c.provider), ["brave", "exa"], "every request is priced");
});

test("a Brave failure falls to Exa once; deep search goes to Exa alone", async () => {
  const failed = fakeFetch({ braveStatus: 500, exa: exaHit });
  const search = makeHuntSearch({ braveKey: "b", exaKey: "e", budget: OPEN, fetchImpl: failed.fetchImpl })!;
  assert.equal((await search({ query: "q" })).provider, "exa");
  const deep = fakeFetch({ brave: braveHit, exa: exaHit });
  const deepSearch = makeHuntSearch({ braveKey: "b", exaKey: "e", budget: OPEN, fetchImpl: deep.fetchImpl })!;
  await deepSearch({ query: "q", deep: true });
  assert.equal(deep.calls.length, 1);
  assert.equal(deep.calls[0]!.body!.type, "deep");
});

test("a request the paid-search budget refuses is never sent", async () => {
  const { fetchImpl, calls } = fakeFetch({ brave: braveHit, exa: exaHit });
  const refused: SearchBudget = { take: async () => "the day's search cap is reached", done: async () => { throw new Error("nothing was taken"); } };
  const out = await makeHuntSearch({ braveKey: "b", exaKey: "e", budget: refused, fetchImpl })!({ query: "q" });
  assert.equal(calls.length, 0);
  assert.equal(out.provider, null);
  assert.ok(out.errors.some(e => /not sent/.test(e)));
});

test("no key, no search", () => {
  assert.equal(makeHuntSearch({ budget: OPEN }), null);
  assert.deepEqual(SEARCH_HOSTS, { brave: "api.search.brave.com", exa: "api.exa.ai" });
});
