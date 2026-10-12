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

/** Every WALKED JSON route. "The API answered" in its strongest form. */
const ALL_WEBAPI_ROUTES = LEGISTAR_ROUTES.filter(
  (route) => route.transport === "JSON_API" && route.disposition === "WALKED",
).map((route) => route.id);

test("SEEDED FAILURE: a full sweep of the JSON API does NOT discharge the facts only other representations carry", () => {
  const owed = factClassesOwedAfter(ALL_WEBAPI_ROUTES);

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
  // A singly routed fact must be named as such, so a vendor change reads as a known single point of failure.
  const singles = singlyRoutedFacts();
  for (const fact of singles) {
    const walked = routesBearing(fact).filter((r) => r.disposition === "WALKED");
    assert.equal(walked.length, 1, `${fact} was reported singly routed`);
  }
  assert.ok(!singles.includes("PERSON_VOTE"));
  assert.deepEqual(
    routesBearing("PERSON_VOTE").filter((r) => r.disposition === "WALKED").map((r) => r.id).sort(),
    ["INSITE_ACCESSIBLE_MINUTES", "WEBAPI_EVENTITEM_VOTES"],
  );
  assert.match(findRoute("INSITE_ACCESSIBLE_MINUTES")!.note, /not yet turned into per-member roll-call records/);
});

test("robots.txt is recorded on a route and never decides it: the vendor's minutes file keeps its facts OWED and IS suggested", () => {
  const minutesRoutes = routesBearing("NARRATIVE_MINUTES");
  assert.ok(minutesRoutes.length >= 2, "minutes are borne by more than one route");

  // The vendor's minutes file stays in the portfolio, its robots.txt reading kept as evidence.
  const vendorMinutes = findRoute("GRANICUS_MINUTES_PDF");
  assert.ok(vendorMinutes && minutesRoutes.includes(vendorMinutes), "the vendor's minutes PDF must still be in the portfolio");
  assert.match(vendorMinutes.note, /Disallow: \//, "the robots.txt reading is recorded on the route");
  assert.match(vendorMinutes.note, /owner decision of 2026-09-25/, "and says it no longer blocks");
  assert.equal(vendorMinutes.disposition, "REQUIRES_NEW_ADAPTER", "what it lacks is a reader, not permission");

  assert.ok(
    factClassesOwedAfter(ALL_WEBAPI_ROUTES).includes("NARRATIVE_MINUTES"),
    "A fact borne only by unbuilt and unwalked routes stays owed.",
  );

  // Suggested: every route that can carry it, whatever its robots.txt says.
  const suggested = routesStillWorthAsking("NARRATIVE_MINUTES", ALL_WEBAPI_ROUTES).map((route) => route.id);
  assert.ok(suggested.includes("INSITE_ACCESSIBLE_MINUTES"), "the portal's own minutes are offered");
  assert.ok(suggested.includes("GRANICUS_MINUTES_PDF"), "and so is the vendor's file, whatever its robots.txt says");
});

test("MEETING_EXISTENCE is multiply routed across transports — the union rule, made structural", () => {
  const routes = routesBearing("MEETING_EXISTENCE");
  const transports = new Set(routes.map((route) => route.transport));

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
  const banned = /\bpima\b|\bmesa\b|\b138\b|\b18[0-9]{2}\b/i;
  for (const route of LEGISTAR_ROUTES) {
    assert.ok(
      !banned.test(route.urlShape),
      `${route.id} hard-codes a tenant in its URL shape: ${route.urlShape}`,
    );
  }
});

test("factsBorneBy ignores an unknown route id rather than crediting it", () => {
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
