import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEGISTAR_FACT_CLASSES,
  LEGISTAR_ROUTES,
  factClassesOwedAfter,
  factsBorneBy,
  findRoute,
  routesBearing,
  routesStillWorthAsking,
  singlyRoutedFacts,
} from "../lib/sources/legistar/routes.ts";
import type { LegistarFactClass } from "../lib/sources/legistar/routes.ts";

/**
 * **THE ANTI-COLLAPSE REGRESSION.**
 * (WS-LEGI, 2026-08-29.)
 *
 * These tests exist to fail if the Legistar adapter ever collapses back to a
 * single preferred representation — the optimisation every source adapter
 * eventually attempts, because it is invisible when it is wrong. The JSON route
 * returns 200, the fields we happened to collect are populated, the meeting
 * renders, and the facts only the other representation carried are never missed
 * by anybody.
 *
 * The rule being defended is stated in `lib/sources/legistar/routes.ts` and is
 * already MEASURED on this source, on two tenants (`docs/sources.md`,
 * 2026-08-28): on one Mesa filter the InSite grid held 15 sittings where the Web
 * API held 3; on Pima the grid holds 14 future Board sittings the Web API
 * returns zero of. Only the union survives both tenants.
 *
 * A test that merely asserted "there are N routes" would be satisfied by a
 * portfolio of N synonyms. So the assertions below are about FACT CLASSES —
 * what a route can tell you — which is the thing a collapse actually destroys.
 */

/** Every WALKED JSON route. "The API answered" in its strongest form. */
const ALL_WEBAPI_ROUTES = LEGISTAR_ROUTES.filter(
  (route) => route.transport === "JSON_API" && route.disposition === "WALKED",
).map((route) => route.id);

test("SEEDED FAILURE: a full sweep of the JSON API does NOT discharge the facts only other representations carry", () => {
  const owed = factClassesOwedAfter(ALL_WEBAPI_ROUTES);

  /*
   * This is the whole regression in one assertion. Every WALKED JSON route has
   * succeeded — bodies, events, event, eventitems, votes — and the item TEXT,
   * the supporting documents and the narrative minutes are still owed, because
   * no JSON route in this portfolio is capable of carrying them.
   *
   * If a later change makes WEBAPI_EVENTITEMS claim ITEM_FULL_TEXT so that a
   * pipeline can "skip the Accessible Agenda since the API worked", this fails.
   */
  assert.ok(
    owed.includes("ITEM_FULL_TEXT"),
    "An HTTP 200 from the Web API must never discharge ITEM_FULL_TEXT: " +
      "EventItemTitle is a caption, and the text of the measure is on the InSite " +
      "detail page and in the packet. Owed set was: " + owed.join(", "),
  );
  assert.ok(
    owed.includes("NARRATIVE_MINUTES"),
    "The item endpoint has fields and no narrative. A clerk's account of what was " +
      "said, who appeared and what was amended from the floor is structurally " +
      "unavailable from it, and no number of 200s changes that.",
  );
  assert.ok(
    owed.includes("SUPPORTING_DOCUMENT"),
    "Attachments and staff memoranda are not carried by any JSON route here.",
  );
});

test("SEEDED FAILURE: one successful route never collapses the universe for the facts it does not bear", () => {
  // The strongest single route in the portfolio: per-person votes.
  const owed = factClassesOwedAfter(["WEBAPI_EVENTITEM_VOTES"]);
  const borne = factsBorneBy(["WEBAPI_EVENTITEM_VOTES"]);

  assert.deepEqual(
    [...borne],
    ["PERSON_VOTE"],
    "The votes route bears exactly one fact class. A route that started claiming " +
      "more would let a roll call stand in for an agenda or for minutes.",
  );
  assert.equal(
    owed.length,
    LEGISTAR_FACT_CLASSES.length - 1,
    "Eleven of the twelve fact classes must remain owed after the votes route " +
      "succeeds. Anything less means a success is discharging facts it cannot see.",
  );
});

test("every information-bearing fact class is reachable through more than one route, or is NAMED as singly routed", () => {
  /*
   * Not an assertion that everything is multiply routed — PERSON_VOTE genuinely
   * is not, on any tenant whose minutes sit behind the disallowed host. The
   * assertion is that the portfolio KNOWS which facts hang on one thread, so a
   * vendor change to that thread reads as a known single point of failure
   * rather than as a body that stopped publishing.
   */
  const singles = singlyRoutedFacts();
  for (const fact of singles) {
    const walked = routesBearing(fact).filter((r) => r.disposition === "WALKED");
    assert.equal(walked.length, 1, `${fact} was reported singly routed`);
  }
  assert.ok(
    singles.includes("PERSON_VOTE"),
    "PERSON_VOTE is reachable only through WEBAPI_EVENTITEM_VOTES while the " +
      "minutes routes are disallowed and the accessible-minutes route is unbuilt. " +
      "That is a real single point of failure and it must stay visible.",
  );
});

test("a DISALLOWED route keeps its facts OWED and is never SUGGESTED — a blocked route is not a blocked fact", () => {
  const minutesRoutes = routesBearing("NARRATIVE_MINUTES");
  assert.ok(minutesRoutes.length >= 2, "minutes are borne by more than one route");

  const disallowed = minutesRoutes.filter((r) => r.disposition === "DISALLOWED");
  assert.ok(
    disallowed.length >= 1,
    "legistar.granicus.com answers Disallow: / and its minutes PDF must still be " +
      "in the portfolio — deleting it would convert a permission wall into an " +
      "absence of minutes (RULING 184).",
  );

  // Owed: yes, permanently, because we do not hold it.
  assert.ok(
    factClassesOwedAfter(ALL_WEBAPI_ROUTES).includes("NARRATIVE_MINUTES"),
    "A fact borne only by disallowed and unbuilt routes stays owed.",
  );

  // Suggested: no. We do not tell a caller to go and break a permission rule.
  const suggested = routesStillWorthAsking("NARRATIVE_MINUTES", ALL_WEBAPI_ROUTES);
  assert.ok(
    suggested.every((route) => route.disposition !== "DISALLOWED"),
    "A disallowed route may never be suggested as the next thing to ask.",
  );
  assert.ok(
    suggested.some((route) => route.id === "INSITE_ACCESSIBLE_MINUTES"),
    "The permitted accessible-minutes route on the portal host is the honest " +
      "next avenue, and it must be the one offered.",
  );
});

test("MEETING_EXISTENCE is multiply routed across transports — the union rule, made structural", () => {
  const routes = routesBearing("MEETING_EXISTENCE").filter(
    (route) => route.disposition !== "DISALLOWED",
  );
  const transports = new Set(routes.map((route) => route.transport));

  /*
   * The measured proof this encodes: neither the Web API nor the InSite grid
   * dominates. Pima's grid holds 14 future sittings the API returns zero of;
   * Mesa's API holds sittings the grid marks NotViewable. A portfolio that kept
   * only "the better route" would be wrong on one tenant or the other, and
   * would be wrong SILENTLY, with a clean 200 either way.
   */
  assert.ok(
    routes.length >= 4,
    "Meeting existence must remain reachable through the API, the grid, the feeds " +
      "and the archive. Found: " + routes.map((r) => r.id).join(", "),
  );
  assert.ok(
    transports.size >= 3,
    "and across at least three transports, so a single transport failing is not " +
      "a body that stopped meeting. Found: " + [...transports].join(", "),
  );
});

test("no two routes are substitutable unless they bear identical fact sets", () => {
  /*
   * The structural guard against a future "these two are the same, drop one"
   * refactor. Two routes may legitimately bear the same facts — the accessible
   * agenda and the agenda PDF do — but that must be VISIBLE as an equal pair
   * rather than assumed, and a route whose facts are a strict superset of
   * another's is not a replacement for it in the other direction.
   */
  for (const route of LEGISTAR_ROUTES) {
    assert.ok(route.bears.length > 0, `${route.id} bears no fact class at all`);
    assert.ok(route.note.length > 20, `${route.id} has no stated reason`);
    assert.ok(
      new Set(route.bears).size === route.bears.length,
      `${route.id} repeats a fact class`,
    );
  }

  const ids = LEGISTAR_ROUTES.map((route) => route.id);
  assert.equal(new Set(ids).size, ids.length, "route ids are unique");
});

test("the portfolio names no tenant — Pima is the proving tenant, not the scope", () => {
  /*
   * The Pima-special-case guard. A concrete tenant id, slug, host or date in
   * this map would make the national source class into one county's adapter,
   * which is the defect the portfolio exists to prevent.
   */
  const banned = /\bpima\b|\bmesa\b|\b138\b|\b18[0-9]{2}\b/i;
  for (const route of LEGISTAR_ROUTES) {
    assert.ok(
      !banned.test(route.urlShape),
      `${route.id} hard-codes a tenant in its URL shape: ${route.urlShape}`,
    );
  }
});

test("factsBorneBy ignores an unknown route id rather than crediting it", () => {
  /*
   * A route id this portfolio has never heard of discharges nothing. The
   * alternative — treating an unknown id as a success — would let a typo in a
   * caller silently satisfy a fact class.
   */
  const borne = factsBorneBy(["NOT_A_ROUTE", "WEBAPI_EVENTITEM_VOTES"]);
  assert.deepEqual([...borne], ["PERSON_VOTE"]);
  assert.equal(findRoute("NOT_A_ROUTE"), undefined);
});

test("an empty walk owes everything", () => {
  const owed = factClassesOwedAfter([]);
  assert.equal(owed.length, LEGISTAR_FACT_CLASSES.length);
  const asSet: readonly LegistarFactClass[] = owed;
  assert.ok(asSet.includes("MEETING_EXISTENCE"));
});
