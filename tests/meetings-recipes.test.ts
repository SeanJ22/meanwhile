import assert from "node:assert/strict";
import test from "node:test";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import {
  RECIPE_KIND,
  SEED_RECIPES,
  failureStands,
  identityFor,
  isNavigationLink,
  recipeFailureHoldDays,
  knownRecipes,
  recipeCandidates,
  recipeEntry,
  recipesFor,
  recordRecipeOutcome,
  substitute,
  type MeetingsRecipe,
} from "../lib/hunt/meetings-recipes.ts";

const NOW = "2026-09-24T02:00:00.000Z";
const LATER = "2026-09-24T03:00:00.000Z";
const WP_HOME = `<html><head><link rel="stylesheet" href="/wp-content/plugins/the-events-calendar/src/resources/css/tribe-events.css"></head>
  <body><a href="/events/">Events</a><a href="/parks">Parks</a></body></html>`;

function need(jurisdictionId: string, site: string, stateCode = "AZ", govClass = "CITY_OR_TOWN", name = jurisdictionId.toUpperCase()): MeetingsDiscoveryNeed {
  return { jurisdictionId, stateCode, name, govClass, ownWebAddress: site, basis: "SOURCE_DISCOVERY_OWED", sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"] };
}

const WP = SEED_RECIPES.find((r) => r.recipeId === "wordpress-events-calendar-list-ical")!;

function recipe(over: Partial<MeetingsRecipe>): MeetingsRecipe {
  return { ...WP, ...over };
}

test("SUBSTITUTION: a template is filled from the government's identity; a missing slot leaves the query unsent", () => {
  const santaFe = identityFor(need("nm:district:santa-fe-public-schools", "https://www.sfps.k12.nm.us", "NM", "SCHOOL_DISTRICT", "Santa Fe Public Schools"), "https://www.sfps.k12.nm.us", 2026);
  assert.deepEqual(santaFe, { bodyName: "Santa Fe Public Schools", city: "Santa Fe Public Schools", state: "NM", domain: "sfps.k12.nm.us", year: "2026" });
  assert.equal(substitute("{bodyName} community meetings {year} site:{domain}", santaFe), "Santa Fe Public Schools community meetings 2026 site:sfps.k12.nm.us");
  assert.equal(substitute("{bodyName} {superintendent}", santaFe), null, "a half-filled query is never sent");
  assert.equal(identityFor(need("az:city:city-of-benson", "benson.gov", "AZ", "CITY_OR_TOWN", "CITY OF BENSON"), "https://benson.gov", 2026).city, "BENSON");
});

test("RETRIEVAL: by body class and state; state-specific before portable, then successes, then recency", () => {
  const portable = recipe({ recipeId: "portable", state: null, successes: 9 });
  const here = recipe({ recipeId: "here", state: "az", successes: 1 });
  const elsewhere = recipe({ recipeId: "elsewhere", state: "nm", successes: 50 });
  const schoolsOnly = recipe({ recipeId: "schools", state: null, bodyClass: "SCHOOL_DISTRICT", successes: 99 });
  const newer = recipe({ recipeId: "newer", state: null, successes: 9, lastSuccess: { at: "2026-09-20T00:00:00Z", jurisdictionId: "x", url: "u", conditions: "c" } });
  assert.deepEqual(
    recipesFor([portable, here, elsewhere, schoolsOnly, newer], { bodyClass: "CITY_OR_TOWN", state: "AZ" }).map((r) => r.recipeId),
    ["here", "newer", "portable"],
    "a recipe proven only in New Mexico, or only for school districts, does not apply to an Arizona city",
  );
});

test("PROPOSALS: a recipe proposes only when the homepage shows its precondition, and not while a failure of it stands here", () => {
  const benson = need("az:city:city-of-benson", "benson.gov");
  const shown = recipeCandidates({ recipes: [WP], need: benson, origin: "https://benson.gov", homepageHtml: WP_HOME, nowIso: NOW });
  assert.deepEqual(shown.candidates, [{ recipeId: WP.recipeId, extractorId: "ical", url: "https://benson.gov/events/list/?ical=1", label: null }]);
  const absent = recipeCandidates({ recipes: [WP], need: benson, origin: "https://benson.gov", homepageHtml: "<html>no plugin</html>", nowIso: NOW });
  assert.deepEqual(absent.candidates, []);

  const failed = recordRecipeOutcome(WP, {
    succeeded: false,
    note: { at: "2026-09-23T00:00:00.000Z", jurisdictionId: benson.jurisdictionId, url: "https://benson.gov/events/list/?ical=1", conditions: "c", limit: "content check: not a calendar" },
  });
  assert.equal(failureStands(failed, benson.jurisdictionId, NOW)?.limit, "content check: not a calendar");
  const held = recipeCandidates({ recipes: [failed], need: benson, origin: "https://benson.gov", homepageHtml: WP_HOME, nowIso: NOW });
  assert.deepEqual(held.candidates, []);
  assert.match(held.skipped[0].why, /failed here .* not paid for again/);
  assert.equal(failureStands(failed, benson.jurisdictionId, "2026-09-26T01:00:00.000Z"), null, "after the hold, the method is tried again");
});

test("ONE FAILED ROUTE IS NOT PROOF: a first failure holds 3 days, each consecutive one doubles it up to 30, and a success clears it", () => {
  const at = (day: number) => new Date(Date.parse("2026-09-01T00:00:00.000Z") + day * 86_400_000).toISOString();
  const fail = (r: MeetingsRecipe, day: number) =>
    recordRecipeOutcome(r, { succeeded: false, note: { at: at(day), jurisdictionId: "az:city:x", url: "u", conditions: "c", limit: "l" } });
  let r = fail(WP, 0);
  assert.equal(r.failedFor[0].streak, 1);
  assert.equal(recipeFailureHoldDays(r.failedFor[0]), 3);
  assert.notEqual(failureStands(r, "az:city:x", at(2.9)), null, "held for the first 3 days");
  assert.equal(failureStands(r, "az:city:x", at(3.1)), null, "and tried again after");
  const holds = [3];
  for (let i = 1; i <= 5; i += 1) {
    r = fail(r, i * 40);
    holds.push(recipeFailureHoldDays(r.failedFor[0]));
  }
  assert.deepEqual(holds, [3, 6, 12, 24, 30, 30], "doubling with each consecutive failure, capped at 30");
  assert.equal(recipeFailureHoldDays({}), 3, "a failure recorded before the count existed reads as a first failure");
  r = recordRecipeOutcome(r, { succeeded: true, note: { at: at(300), jurisdictionId: "az:city:x", url: "u", conditions: "c" } });
  assert.equal(r.failedFor.some((f) => f.jurisdictionId === "az:city:x"), false, "a success clears it");
  assert.equal(fail(r, 301).failedFor[0].streak, 1, "so the next failure starts over");
});

test("A LINK STEP FOLLOWS NAVIGATION, NOT NEWS: a headline that names the council, or anything under a news section, is never followed", () => {
  const OP = SEED_RECIPES.find((x) => x.recipeId === "official-page-events-linked-committee-page")!;
  const home = [
    `<a href="/government/mayor-and-council">Mayor and Council</a>`,
    `<a href="/government/departments/city-clerks-office/city-council-meetings">City Council Meetings</a>`,
    `<a href="/news-center/chandler-city-council-appoints-deryck-lavelle-city-attorney">Chandler City Council Appoints Deryck Lavelle City Attorney</a>`,
    `<a href="/press/council-approves-budget">Council budget</a>`,
  ].join(" ");
  const chandler = need("az:city:city-of-chandler", "https://www.chandleraz.gov");
  const got = recipeCandidates({ recipes: [OP], need: chandler, origin: "https://www.chandleraz.gov", homepageHtml: home, nowIso: NOW });
  assert.deepEqual(got.candidates.map((c) => c.url), [
    "https://www.chandleraz.gov/government/mayor-and-council",
    "https://www.chandleraz.gov/government/departments/city-clerks-office/city-council-meetings",
  ]);
  assert.equal(isNavigationLink({ url: "https://x.gov/board", text: "Board of Education" }), true);
  assert.equal(isNavigationLink({ url: "https://x.gov/a", text: "one two three four five six seven" }), false, "a label past six words is a headline");
  assert.equal(isNavigationLink({ url: "https://x.gov/blog/council", text: "Council" }), false);
});

test("OUTCOMES: counts move, a success clears the government's standing failure, and the failure memory is bounded", () => {
  let r = WP;
  for (let i = 0; i < 250; i += 1) {
    r = recordRecipeOutcome(r, { succeeded: false, note: { at: NOW, jurisdictionId: `j${i}`, url: "u", conditions: "c", limit: "l" } });
  }
  assert.equal(r.failures, 250);
  assert.equal(r.failedFor.length, 200, "the list is bounded; the count is exact");
  r = recordRecipeOutcome(r, { succeeded: true, note: { at: LATER, jurisdictionId: "j249", url: "u", conditions: "c" } });
  assert.equal(r.successes, 1);
  assert.equal(r.failedFor.some((f) => f.jurisdictionId === "j249"), false);
  const entry = recipeEntry(r, LATER);
  assert.equal(entry.kind, RECIPE_KIND);
  assert.equal(entry.outcome, "YIELDED");
  assert.deepEqual(knownRecipes([entry]).find((x) => x.recipeId === WP.recipeId)?.successes, 1, "a stored seed keeps the runner's counts");
  assert.equal(knownRecipes([]).length, SEED_RECIPES.length, "the seeds are known before anything is stored");
});

test("A CORRECTED SEED REACHES THE RUNNER: a stored seed keeps its counts and failure memory and takes the code's method; a learned recipe is the stored one", () => {
  const failure = { at: NOW, jurisdictionId: "az:city:city-of-benson", url: "https://benson.gov/events/list/?ical=1", conditions: "c", limit: "l" };
  /* The runner saved the seed as it stood that day, with its own counts. */
  const asSaved = recordRecipeOutcome(
    recipe({ title: "the method as it stood", precondition: "old-marker", navigation: [{ kind: "path", template: "/old-events/?ical=1" }] }),
    { succeeded: false, note: failure },
  );
  const learned = recipe({ recipeId: "search-x-ical-az-city_or_town", navigation: [{ kind: "path", template: "/learned" }], successes: 3 });
  const known = knownRecipes([recipeEntry(asSaved, NOW), recipeEntry(learned, NOW)]);
  const wp = known.find((r) => r.recipeId === WP.recipeId)!;
  assert.deepEqual(wp.navigation, WP.navigation, "the method is the code's");
  assert.equal(wp.precondition, WP.precondition);
  assert.equal(wp.title, WP.title);
  assert.equal(wp.failures, 1, "the runner's counts are kept");
  assert.deepEqual(wp.failedFor, [{ ...failure, streak: 1 }], "and its failure memory, so a standing failure is still not paid for twice");
  assert.deepEqual(
    known.find((r) => r.recipeId === learned.recipeId)?.navigation,
    [{ kind: "path", template: "/learned" }],
    "a learned recipe has no seed: the store is its method",
  );
  assert.equal(known.length, SEED_RECIPES.length + 1);
});
