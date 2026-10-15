import assert from "node:assert/strict";
import test from "node:test";

import type { CostEntry } from "../lib/control-plane/cost.ts";
import { walkMeetingsDiscoveryNeed, type DiscoveryOpen, type DiscoveryRuntime, type DiscoverySearch } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import {
  DISCOVERY_SEARCH_VENDOR,
  SEARCH_HOSTS,
  durableSearchBudget,
  makeDiscoverySearch,
  type SearchBudget,
} from "../lib/control-plane/discovery/search-runtime.ts";
import { SEARCH_REQUEST_LIFETIME_MS, type FetchLike } from "../lib/hunt/search.ts";
import { SEARCH_PRICES, hitStanding, plannedQueries, requestPrice } from "../lib/hunt/discovery-search.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { SEED_RECIPES, identityFor, knownRecipes } from "../lib/hunt/meetings-recipes.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const NOW = "2026-09-24T04:00:00.000Z";

function need(jurisdictionId: string, site: string, name: string, stateCode = "AZ"): MeetingsDiscoveryNeed {
  return { jurisdictionId, stateCode, name, govClass: "CITY_OR_TOWN", ownWebAddress: site, basis: "SOURCE_DISCOVERY_OWED", sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"] };
}

function fakeOpen(map: Readonly<Record<string, { status: number; body?: string }>>): { open: DiscoveryOpen; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    open: async ({ url }) => {
      seen.push(url);
      const r = map[url] ?? { status: 404, body: "not found" };
      const body = r.body ?? "";
      return { status: r.status, body, bytes: body.length, contentType: "text/html", location: null, transportError: null };
    },
  };
}

/** A search seam that answers from a table and records every call. */
function fakeSearch(table: Readonly<Record<string, readonly string[]>>, over: Partial<{ failExa: boolean; refuseBrave: boolean }> = {}): { search: DiscoverySearch; calls: { query: string; ownSiteDomain: string | null }[] } {
  const calls: { query: string; ownSiteDomain: string | null }[] = [];
  return {
    calls,
    search: async (input) => {
      calls.push(input);
      const urls = table[input.query] ?? [];
      return {
        hits: urls.map((url) => ({ url, title: url, provider: "brave" as const })),
        requests: [
          over.refuseBrave
            ? { provider: "brave", status: "BUDGET_REFUSED", error: "the cycle's search budget is spent", bytes: 0, hitCount: 0 }
            : { provider: "brave", status: "DELIVERED", error: null, bytes: 100, hitCount: urls.length },
          over.failExa
            ? { provider: "exa", status: "FAILED", error: "exa HTTP 500", bytes: 0, hitCount: 0 }
            : { provider: "exa", status: "DELIVERED", error: null, bytes: 50, hitCount: 0 },
        ],
      };
    },
  };
}

function runtime(open: DiscoveryOpen, search: DiscoverySearch | undefined, costs: CostEntry[], recipes = knownRecipes([])): DiscoveryRuntime {
  return {
    open,
    spaceOut: async () => {},
    vault: async () => ({ stored: true, where: "vault", why: "stored" }),
    now: () => NOW,
    budget: { spent: () => false },
    recipes,
    ...(search ? { search } : {}),
    recordCost: async (entry) => {
      costs.push(entry);
    },
  };
}

test("QUERIES: a saved method's templates first, then the defaults; unfilled slots never sent; own-site expressed as a flag", () => {
  const identity = identityFor(need("az:city:city-of-benson", "benson.gov", "CITY OF BENSON"), "https://benson.gov", 2026);
  const wp = SEED_RECIPES.find((r) => r.recipeId === "wordpress-events-calendar-list-ical")!;
  const custom = { ...wp, recipeId: "custom", queryTemplates: ["{bodyName} {superintendent} board", "{bodyName} council calendar {year}"] };
  const planned = plannedQueries([custom, wp], identity, 4);
  assert.deepEqual(planned.map((q) => [q.templateId, q.query, q.ownSiteOnly]), [
    ["custom#q1", "CITY OF BENSON council calendar 2026", false],
    ["wordpress-events-calendar-list-ical#q0", "CITY OF BENSON meetings calendar", true],
    ["own-site-meetings", "CITY OF BENSON meetings agendas minutes", true],
    ["publisher-portal", "CITY OF BENSON AZ meeting agendas", false],
  ]);
  assert.equal(planned.length, 4, "the half-filled {superintendent} query is never planned");
  assert.equal(plannedQueries([custom, wp], identity, 2).length, 2, "at most the limit");
});

test("POINTERS: official sources qualify by government links rather than a publisher host list", () => {
  assert.equal(hitStanding("https://www.benson.gov/meetings", "benson.gov"), "OWN_SITE");
  assert.equal(hitStanding("https://benson.gov/x", "benson.gov"), "OWN_SITE");
  assert.equal(hitStanding("https://bensonaz.legistar.com/Calendar.aspx", "benson.gov"), null, "a known vendor alone is not authority");
  assert.equal(hitStanding("https://bensonaz.legistar.com/Calendar.aspx", "benson.gov", { url: "https://benson.gov/meetings", html: '<a href="https://bensonaz.legistar.com/Calendar.aspx">Meetings</a>' }), "PUBLISHER");
  assert.equal(hitStanding("https://www.bensonnews.com/council-meeting", "benson.gov"), null, "someone else's page about the government is not its record");
  assert.equal(hitStanding("https://notbenson.gov/", "benson.gov"), "PUBLISHER", "official source qualification is separate from correct body identity");
  assert.equal(hitStanding("mailto:clerk@benson.gov", "benson.gov"), null);
});

test("PRICES: each provider's published per-request price carries its source and date; a lost request is UNMEASURED, never zero", () => {
  for (const p of Object.values(SEARCH_PRICES)) {
    assert.ok(p.usdPerRequest !== null && p.usdPerRequest > 0, p.provider);
    assert.match(p.source, /^https:\/\//);
    assert.match(p.readOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(requestPrice("brave", true).usd, 0.005);
  assert.equal(requestPrice("exa", true).usd, 0.007);
  assert.equal(requestPrice("exa", false).usd, null);
});

test("SEAM: own-site is Brave's site: and Exa's includeDomains; a refused request is never sent; a failed one is named", async () => {
  const sent: { url: string; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    sent.push({ url, body: init.body });
    if (url.startsWith("https://api.exa.ai")) return { ok: false, status: 500, text: async () => "upstream" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ web: { results: [{ url: "https://benson.gov/meetings", title: "Meetings" }] } }) };
  };
  const taken: string[] = [];
  const budget: SearchBudget = { take: async (host) => (taken.push(host), null), done: async () => {} };
  const search = makeDiscoverySearch({ braveKey: "b", exaKey: "e", budget, fetchImpl })!;
  const res = await search({ query: "CITY OF BENSON meetings", ownSiteDomain: "benson.gov" });
  assert.match(new URL(sent[0].url).searchParams.get("q") ?? "", /site:benson\.gov$/);
  assert.deepEqual(JSON.parse(sent[1].body ?? "{}").includeDomains, ["benson.gov"]);
  assert.deepEqual(res.requests.map((r) => [r.provider, r.status]), [["brave", "DELIVERED"], ["exa", "FAILED"]]);
  assert.deepEqual(res.hits.map((h) => h.url), ["https://benson.gov/meetings"]);
  assert.deepEqual(taken, [SEARCH_HOSTS.brave, SEARCH_HOSTS.exa]);

  const refusing: SearchBudget = { take: async () => "the cycle's 50-request search budget is spent", done: async () => {} };
  sent.length = 0;
  const none = await makeDiscoverySearch({ braveKey: "b", budget: refusing, fetchImpl })!({ query: "q", ownSiteDomain: null });
  assert.deepEqual(sent, [], "a refused request is never sent");
  assert.equal(none.requests[0].status, "BUDGET_REFUSED");
  assert.equal(makeDiscoverySearch({ budget, fetchImpl }), null, "no key, no seam");
});

test("BUDGET: the cycle's cap and the day's cap refuse by name; the day's cap holds across cycles in the durable ledger", async () => {
  for (const [label, repos] of await eachStore("wtp-search-budget-")) {
    let clock = Date.parse(NOW);
    const now = () => new Date((clock += 2_000)).toISOString();
    const cycle1 = durableSearchBudget({ repos, perCycle: 2, perDay: 3, admit: () => null, now });
    for (let i = 0; i < 2; i += 1) {
      assert.equal(await cycle1.take(SEARCH_HOSTS.brave), null, `${label}: request ${i + 1} admitted`);
      await cycle1.done(SEARCH_HOSTS.brave);
    }
    assert.match((await cycle1.take(SEARCH_HOSTS.brave)) ?? "", /cycle's 2-request search budget is spent/);

    const cycle2 = durableSearchBudget({ repos, perCycle: 5, perDay: 3, admit: () => null, now });
    assert.equal(await cycle2.take(SEARCH_HOSTS.exa), null, `${label}: the third request today is admitted`);
    await cycle2.done(SEARCH_HOSTS.exa);
    const refused = await cycle2.take(SEARCH_HOSTS.exa);
    assert.ok(refused !== null && /discovery-search|daily/i.test(refused), `${label}: the day's cap across both providers refuses, kept in the shared ledger: ${refused}`);
    const ledger = (await repos.budget.read()).value;
    assert.equal(ledger.vendors[DISCOVERY_SEARCH_VENDOR]?.dailyRequestCap, 3);

    const blackout = durableSearchBudget({ repos, perCycle: 5, perDay: 3, admit: () => "network/provider execution is disabled during the Saturday blackout", now });
    assert.match((await blackout.take(SEARCH_HOSTS.brave)) ?? "", /blackout/, `${label}: FleetSafety's refusal passes through`);
  }
});

test('abandoned search slots expire without raising caps or letting an old completion release the replacement', async()=>{
  for(const [label,repos] of await eachStore('wtp-search-expiry-')) {
    let clock=Date.parse(NOW);
    const now=()=>new Date(clock).toISOString();
    const old=durableSearchBudget({repos,perCycle:5,perDay:10,admit:()=>null,now});
    assert.equal(await old.take(SEARCH_HOSTS.brave),null,label);
    assert.equal(await old.take(SEARCH_HOSTS.exa),null,label);
    const next=durableSearchBudget({repos,perCycle:5,perDay:10,admit:()=>null,admitLifetimeHunt:()=>null,now});
    clock+=2_000;
    assert.notEqual(await next.take(SEARCH_HOSTS.brave),null,'live occupancy still refuses');
    clock+=SEARCH_REQUEST_LIFETIME_MS;
    assert.equal(await next.take(SEARCH_HOSTS.brave),null,'next admission reclaims expired occupancy');
    assert.equal(await next.lifetimeHunt.take(SEARCH_HOSTS.exa),null,'hunt search uses the same recovery');
    await old.done(SEARCH_HOSTS.brave);
    await old.done(SEARCH_HOSTS.exa);
    let ledger=(await repos.budget.read()).value;
    for(const host of Object.values(SEARCH_HOSTS)) {
      assert.equal(ledger.hostState[host].inFlight,1,'late completion cannot release replacement');
      assert.equal(ledger.hostState[host].requestsToday,2,'recovery does not erase request accounting');
      assert.equal(ledger.hosts[host].maxConcurrent,1,'limits unchanged');
    }
    assert.equal(ledger.vendors[DISCOVERY_SEARCH_VENDOR].dailyRequestCap,10);
    await next.done(SEARCH_HOSTS.brave);
    await next.lifetimeHunt.done(SEARCH_HOSTS.exa);
    ledger=(await repos.budget.read()).value;
    assert.ok(Object.values(SEARCH_HOSTS).every(host=>ledger.hostState[host].inFlight===0));
  }
});

test("original hunt paid search ignores only discretionary request counts and retains shared provider admission", async () => {
  for (const [label, repos] of await eachStore("wtp-search-lifetime-")) {
    let clock = Date.parse(NOW);
    const now = () => new Date((clock += 2_000)).toISOString();
    let huntAllowed = true;
    const budget = durableSearchBudget({ repos, perCycle: 1, perDay: 1,
      admit: () => "ordinary work is held", admitLifetimeHunt: () => huntAllowed ? null : "hunt provider held", now });
    assert.match((await budget.take(SEARCH_HOSTS.brave)) ?? "", /ordinary work is held/, label);
    assert.equal(await budget.lifetimeHunt.take(SEARCH_HOSTS.brave), null, label);
    await budget.lifetimeHunt.done(SEARCH_HOSTS.brave);
    assert.equal(await budget.lifetimeHunt.take(SEARCH_HOSTS.exa), null, `${label}: the second hunt request crosses both count caps`);
    await budget.lifetimeHunt.done(SEARCH_HOSTS.exa);
    assert.equal(budget.used(), 2);
    assert.match((await budget.take(SEARCH_HOSTS.brave)) ?? "", /cycle's 1-request/, label);
    assert.equal((await repos.budget.read()).value.vendors[DISCOVERY_SEARCH_VENDOR]?.dailyRequestCap, 1,
      `${label}: the persisted nonhunt policy is unchanged`);
    huntAllowed = false;
    assert.match((await budget.lifetimeHunt.take(SEARCH_HOSTS.brave)) ?? "", /hunt provider held/, label);
  }
});

test("REFUSED: a request the budget refused is recorded in the walk and never charged", async () => {
  const site = fakeOpen({ "https://x.gov/robots.txt": { status: 404 }, "https://x.gov/": { status: 200, body: "<html></html>" } });
  const costs: CostEntry[] = [];
  const walk = await walkMeetingsDiscoveryNeed(need("az:town:x", "x.gov", "TOWN OF X"), runtime(site.open, fakeSearch({}, { refuseBrave: true }).search, costs));
  assert.equal(walk.search[0].requests[0].status, "BUDGET_REFUSED");
  assert.equal(walk.search[0].requests[0].usd, null);
  assert.deepEqual(costs.map((c) => c.source), ["api.exa.ai", "api.exa.ai"], "only requests actually sent are charged");
});

test("SEAM WORST CASE: every provider at its timeout, plus the ledger's calls", () => {
  const budget: SearchBudget = { take: async () => null, done: async () => {} };
  const fetchImpl: FetchLike = async () => {
    throw new Error("never called");
  };
  assert.equal(makeDiscoverySearch({ braveKey: "b", exaKey: "e", budget, fetchImpl, timeoutMs: 8_000 })?.worstCaseMs, 18_000);
  assert.equal(makeDiscoverySearch({ braveKey: "b", budget, fetchImpl, timeoutMs: 8_000 })?.worstCaseMs, 10_000);
});

test("discovery search records hunt references on successful and failed charges, while an out-of-scope hold keeps free reads", async () => {
  const site = fakeOpen({ "https://x.gov/robots.txt": { status: 404 }, "https://x.gov/": { status: 200, body: "<title>Town of X</title>" } });
  const search = fakeSearch({}, { failExa: true });
  const costs: CostEntry[] = [];
  await walkMeetingsDiscoveryNeed(need("az:town:x", "x.gov", "TOWN OF X"), {
    ...runtime(site.open, search.search, costs), maxQueriesPerWalk: 1,
    searchScopeFor: () => ({ assignmentKeys: ["zcta:2020/85635", "county:2020/04003"], hold: null }),
  });
  assert.equal(costs.length, 2);
  assert.deepEqual(costs.map(c => c.assignmentKeys), Array(2).fill(["zcta:2020/85635", "county:2020/04003"]));
  assert.equal(costs.find(c => c.source === "api.exa.ai")?.cost.usd, null, "a failed unpriced request is still attributed");
  const outside = fakeSearch({});
  const noCosts: CostEntry[] = [];
  const before = site.seen.length;
  const held = await walkMeetingsDiscoveryNeed(need("az:town:x", "x.gov", "TOWN OF X"), {
    ...runtime(site.open, outside.search, noCosts),
    searchScopeFor: () => ({ assignmentKeys: [], hold: "Paid search waits for resolved hunt membership." }),
  });
  assert.equal(outside.calls.length, 0);
  assert.equal(noCosts.length, 0);
  assert.ok(site.seen.length > before, "free public-page discovery still runs");
  assert.match(held.note, /Paid search waits for resolved hunt membership/);
});
