/**
 * The discovery executor's search rung. A result is a pointer, followed only on the government's own domain or a
 * known meeting publisher, robots-first, and confirmed by content. Every request sent is charged at the published
 * price (a request lost in transport is unmeasured), the cycle and day caps refuse by name, and a route a search
 * found is saved as a method the next walk searches with first. Every test that writes runs on both stores.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { CostEntry } from "../lib/control-plane/cost.ts";
import {
  DiscoveryTimeSpent,
  runMeetingsDiscovery,
  walkMeetingsDiscoveryNeed,
  type DiscoveryOpen,
  type DiscoveryRuntime,
  type DiscoverySearch,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import {
  DISCOVERY_SEARCH_VENDOR,
  SEARCH_HOSTS,
  durableSearchBudget,
  makeDiscoverySearch,
  type SearchBudget,
} from "../lib/control-plane/discovery/search-runtime.ts";
import { SEARCH_REQUEST_LIFETIME_MS, type FetchLike } from "../lib/control-plane/scheduler/scout-search.ts";
import { SEARCH_PRICES, hitStanding, plannedQueries, requestPrice } from "../lib/hunt/discovery-search.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { SEED_RECIPES, identityFor, knownRecipes } from "../lib/hunt/meetings-recipes.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const NOW = "2026-09-24T04:00:00.000Z";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Council\r\nDTSTART:20261001T010000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

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

test("WALK: authorized search checks beyond connected feeds, follows source results, charges each request, and saves the method", async () => {
  for (const [label, repos] of await eachStore("wtp-search-walk-")) {
    const site = fakeOpen({
      "https://benson.gov/robots.txt": { status: 404 },
      "https://benson.gov/": { status: 200, body: "<html><a href='/parks'>Parks</a></html>" },
      "https://benson.gov/government/meetings": { status: 200, body: "<a href='/calendar/council.ics'>Subscribe</a>" },
      "https://benson.gov/calendar/council.ics": { status: 200, body: ICS },
    });
    const searches = fakeSearch({
      "CITY OF BENSON meetings agendas minutes": ["https://www.bensonnews.com/council", "https://benson.gov/government/meetings"],
    }, { failExa: true });
    const costs: CostEntry[] = [];
    const pass = await runMeetingsDiscovery(repos, {
      needs: [need("az:city:city-of-benson", "benson.gov", "CITY OF BENSON")],
      runtime: runtime(site.open, searches.search, costs),
      cycleIndex: 0,
      maxWalks: 5,
    });
    const walk = pass.walked[0];
    assert.equal(walk.outcome, "FOUND", label);
    assert.deepEqual(walk.found.map((f) => [f.basis, f.url]), [["SEARCH", "https://benson.gov/calendar/council.ics"]]);
    assert.equal(site.seen.some((u) => u.includes("bensonnews")), false, `${label}: someone else's page is never opened`);
    assert.deepEqual(searches.calls[0], { query: "CITY OF BENSON meetings agendas minutes", ownSiteDomain: "benson.gov" });

    assert.deepEqual(
      costs.map((c) => [c.role, c.source, c.cost.usd, c.jurisdiction, c.routeId]),
      [
        ["DISCOVERY_SEARCH", "api.search.brave.com", 0.005, "az:city:city-of-benson", "discovery-search:own-site-meetings"],
        ["DISCOVERY_SEARCH", "api.exa.ai", null, "az:city:city-of-benson", "discovery-search:own-site-meetings"],
      ],
      `${label}: one row per request sent; the lost Exa request is UNMEASURED, never zero`,
    );
    assert.equal(walk.search[0].requests[0].priceSource, SEARCH_PRICES.brave.source);
    assert.equal(walk.recipes.learned.length, 1);
    const learned = knownRecipes((await repos.fieldManual.list()).map((row) => row.value)).find((r) => r.recipeId === walk.recipes.learned[0].recipeId)!;
    assert.equal(learned.successes, 1, `${label}: the method is saved with its success`);
    assert.deepEqual(learned.queryTemplates, ["{bodyName} meetings agendas minutes"]);

    /* The next government's walk searches with the saved method first. */
    const next = fakeOpen({ "https://avondale.gov/robots.txt": { status: 404 }, "https://avondale.gov/": { status: 200, body: "<html></html>" } });
    const nextSearches = fakeSearch({});
    const nextPass = await runMeetingsDiscovery(repos, {
      needs: [need("az:city:city-of-avondale", "avondale.gov", "CITY OF AVONDALE")],
      runtime: runtime(next.open, nextSearches.search, [], knownRecipes((await repos.fieldManual.list()).map((row) => row.value))),
      cycleIndex: 0,
      maxWalks: 5,
    });
    assert.equal(nextSearches.calls[0].query, "CITY OF AVONDALE meetings agendas minutes", `${label}: the saved template, identity substituted`);
    assert.equal(nextPass.walked[0].search[0].recipeId, learned.recipeId, `${label}: the first query came from the saved method, not the default`);
    const afterMiss = knownRecipes((await repos.fieldManual.list()).map((row) => row.value)).find((r) => r.recipeId === learned.recipeId)!;
    assert.equal(afterMiss.failures, 1, `${label}: a saved method that found nothing here is recorded against it`);

    /* A working feed is still compared with a current search when authorized. */
    const found = fakeOpen({
      "https://gilbert.gov/robots.txt": { status: 404 },
      "https://gilbert.gov/": { status: 200, body: "<a href='/m.ics'>m</a>" },
      "https://gilbert.gov/m.ics": { status: 200, body: ICS },
    });
    const idle = fakeSearch({});
    const direct = await walkMeetingsDiscoveryNeed(need("az:town:gilbert", "gilbert.gov", "TOWN OF GILBERT"), runtime(found.open, idle.search, []));
    assert.equal(direct.outcome, "FOUND");
    assert.equal(idle.calls.length, 1, `${label}: a confirmed feed still gets a current-information search`);
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

test("TIME: a query starts only with time left for the seam's worst case; a walk cut short while following a result concludes nothing, and what it paid for is reported", async () => {
  /* Too little time for the seam's worst case: the query is not started, and nothing is charged. */
  const quiet = fakeOpen({ "https://quiet.gov/robots.txt": { status: 404 }, "https://quiet.gov/": { status: 200, body: "<html></html>" } });
  const unstarted = fakeSearch({});
  const unchargedCosts: CostEntry[] = [];
  await assert.rejects(
    walkMeetingsDiscoveryNeed(need("az:town:quiet", "quiet.gov", "TOWN OF QUIET"), {
      ...runtime(quiet.open, unstarted.search, unchargedCosts),
      budget: { spent: () => false, remainingMs: () => 10_000 },
    }),
    (error: unknown) => error instanceof DiscoveryTimeSpent && error.search.length === 0,
  );
  assert.deepEqual(unstarted.calls, [], "a seam that states no worst case is given 20 seconds, and 10 are not enough");
  assert.deepEqual(unchargedCosts, []);

  for (const [label, repos] of await eachStore("wtp-search-time-")) {
    /* The providers answer, and the time runs out while the result is followed. */
    let left = 60_000;
    const site = fakeOpen({
      "https://slowtown.gov/robots.txt": { status: 404 },
      "https://slowtown.gov/": { status: 200, body: "<html></html>" },
      "https://slowtown.gov/meetings": { status: 200, body: "<a href='/m.ics'>m</a>" },
    });
    const answered = fakeSearch({ "TOWN OF SLOWTOWN meetings agendas minutes": ["https://slowtown.gov/meetings"] });
    const spendingSearch: DiscoverySearch = Object.assign(
      async (input: Parameters<DiscoverySearch>[0]) => {
        const res = await answered.search(input);
        left = 0;
        return res;
      },
      { worstCaseMs: 5_000 },
    );
    const costs: CostEntry[] = [];
    const pass = await runMeetingsDiscovery(repos, {
      needs: [need("az:town:slowtown", "slowtown.gov", "TOWN OF SLOWTOWN")],
      runtime: { ...runtime(site.open, spendingSearch, costs), budget: { spent: () => left <= 0, remainingMs: () => left } },
      cycleIndex: 0,
      maxWalks: 5,
    });
    assert.deepEqual(answered.calls.map((c) => c.query), ["TOWN OF SLOWTOWN meetings agendas minutes"], `${label}: 60 seconds cover a stated 5-second worst case`);
    assert.deepEqual(pass.walked, [], `${label}: nothing is recorded as a reading`);
    assert.equal(pass.cutShort.length, 1);
    assert.deepEqual(
      pass.cutShort[0].search.map((q) => [q.query, q.requests.map((r) => r.provider), q.followed]),
      [["TOWN OF SLOWTOWN meetings agendas minutes", ["brave", "exa"], []]],
      `${label}: the query it paid for is reported with the cut walk; the result it never requested is not "followed"`,
    );
    assert.deepEqual(costs.map((c) => c.source), ["api.search.brave.com", "api.exa.ai"], `${label}: both requests sent were charged`);
    assert.equal(site.seen.includes("https://slowtown.gov/meetings"), false, `${label}: no request once the time was spent`);
    assert.deepEqual(await repos.discoveryAttempts.readRecent("az:town:slowtown", 5), []);
  }
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
