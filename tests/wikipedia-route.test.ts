import assert from "node:assert/strict";
import test from "node:test";

import { wikipediaRoute } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { checkYield } from "../lib/control-plane/scheduler/route-executor.ts";
import type { CanonicalCandidacy } from "../lib/hunt/candidate-universe.ts";

/** Only the four fields the route builder reads; the rest of the shape is irrelevant here. */
const CANDIDACY = {
  givenName: "Katie",
  familyName: "Hobbs",
  officeTitle: "Governor",
  stateCode: "AZ",
} as unknown as CanonicalCandidacy;

test("the Wikipedia route is a live deterministic HTTP GET on the permitted Wikimedia REST host", () => {
  const route = wikipediaRoute(CANDIDACY);
  assert.equal(route.routeId, "candidate-wikipedia-api", "the durable route id is preserved");
  assert.equal(route.executorClass, "DETERMINISTIC", "a documented public API replays deterministically");
  assert.equal(route.open.kind, "HTTP_GET", "the route is now machine-executable");
  if (route.open.kind !== "HTTP_GET") return;

  assert.match(
    route.open.url,
    /^https:\/\/api\.wikimedia\.org\/core\/v1\/wikipedia\/en\/search\/page\?q=/,
    "it opens the Wikimedia REST search endpoint whose robots.txt permits /core/v1/",
  );
  assert.ok(!route.open.url.includes("/w/api.php"), "it never composes the robots-disallowed search API path");
  assert.match(route.open.url, /q=Katie%20Hobbs%20Governor%20AZ/, "the query carries the person and the office");

  const ua = route.open.headers?.["user-agent"] ?? "";
  assert.ok(ua.length > 0, "Wikimedia throttles a missing User-Agent to the lowest rate-limit tier");
  assert.match(ua, /https?:\/\/|@/, "the User-Agent carries a contact, as the Wikimedia API policy requires");
});

test("the Wikipedia route's yield contract makes an empty search a FAILED extraction", () => {
  const route = wikipediaRoute(CANDIDACY);
  assert.ok(route.yieldContract, "the route declares what a genuine search response looks like");
  if (!route.yieldContract) return;

  const found = checkYield(route.yieldContract, JSON.stringify({ pages: [{ id: 1, title: "Katie Hobbs" }] }));
  assert.equal(found.satisfied, true, "a populated pages array is a yield");
  assert.equal(found.rows, 1);

  const empty = checkYield(route.yieldContract, JSON.stringify({ pages: [] }));
  assert.equal(empty.satisfied, false, "zero rows is a failed extraction, never an empty document");

  const wrongShape = checkYield(route.yieldContract, JSON.stringify({ error: "nope" }));
  assert.equal(wrongShape.satisfied, false, "a response missing the pages array is not this route's record");
});
