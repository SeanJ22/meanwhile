/**
 * The Marginalia route's held answers are POINTER leads (a URL and what the index called it), and an empty answer is
 * a named no-hit, never a failure.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { marginaliaLeads, normalizeMarginaliaSearch } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { TANG_WILLIAMS, fixture, subject } from "./helpers/campaign-sites.ts";

test("a held Marginalia answer normalizes to POINTER rows — URL, title, format, rank — and never the index's licensed text", () => {
  const n = normalizeMarginaliaSearch(fixture("marginalia-tang-williams-lily.json"));
  const held = JSON.parse(fixture("marginalia-tang-williams-lily.json")) as { results: { url: string }[] };
  assert.equal(n.rows.length, held.results.length);
  assert.deepEqual(Object.keys(n.rows[0]!).sort(), ["format", "kind", "rank", "title", "url"]);
  assert.ok(n.rows.every((row) => row.kind === "POINTER"));
  assert.ok(n.rows.some((row) => row.url === "https://www.lilytangwilliams.com/congress/endorsements/"));
});

test("an empty answer is a NAMED NO-HIT, not a failed normalization and never a statement about the candidate", () => {
  /* The documented control: an impossible term answers a licence and an empty results array. */
  const empty = JSON.stringify({ license: "CC-BY-NC-SA 4.0", page: 1, pages: 0, query: "zzqxv impossible term", results: [] });
  const n = normalizeMarginaliaSearch(empty);
  assert.equal(n.rows.length, 0);
  assert.match(n.noHit ?? "", /^NO_HIT:/);
  assert.throws(() => normalizeMarginaliaSearch(JSON.stringify({ results: [] })), /MARGINALIA_ANSWER_UNDOCUMENTED/, "an answer without its licence is not the documented answer");
});

test("a pointer is a lead only when its host or its index title names the candidate; every other hit is refused with a type", () => {
  const lily = marginaliaLeads({ subjectId: TANG_WILLIAMS, artifactId: "ar", attemptId: "at", retrievedAt: "2026-09-24T12:00:00.000Z", body: fixture("marginalia-tang-williams-lily.json") }, subject(TANG_WILLIAMS));
  assert.ok(lily.leads.length >= 1 && lily.leads.every((l) => new URL(l.url).hostname.endsWith("lilytangwilliams.com")));
  assert.ok(lily.refused.every((r) => r.refusal.code.length > 0));
  assert.equal(lily.noHit, false);
  const althoff = marginaliaLeads({ subjectId: "nj:x", artifactId: "ar2", attemptId: "at2", retrievedAt: "2026-09-25T01:35:59.350Z", body: fixture("marginalia-althoff-marilyn.json") },
    { ...subject(TANG_WILLIAMS), candidacyId: "nj:x", givenName: "Marilyn", familyName: "ALTHOFF", officeTitle: "Member of the Borough Council", ocdId: "ocd-division/country:us/state:nj/place:mendham", stateCode: "NJ" });
  assert.equal(althoff.leads.length, 0);
  assert.deepEqual(althoff.refused.map((r) => r.refusal.code).sort(), ["AGGREGATOR", "NOT_A_PAGE"]);
});
