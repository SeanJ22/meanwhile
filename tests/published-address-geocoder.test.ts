import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  GEOCODE_ANSWER_HOLD_MS,
  agreeingMatch,
  geocodePublishedAddress,
  publishedAddressQuery,
  stateOfDivision,
  type GeocodeAttempt,
  type PublishedAddress,
  type RememberedAnswer,
} from "../scripts/lib/published-address-geocoder.ts";

/**
 * **AN OFFICIAL ADDRESS, PLACED BY THE CENSUS GEOCODER OR NOT AT ALL.** (2026-09-24.)
 *
 * The fallback for an address an official meeting source publishes that no
 * reviewed venue carries. Every answer below is a recorded response of the
 * Bureau's one-line geocoder; the fetch stand-in refuses any URL that was not
 * recorded, so each case also proves the exact query the function sends. The
 * division scope reads the product's real ZIP index.
 */

interface Recorded {
  readonly label: string;
  readonly requestedUrl: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly body: string;
}
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "census-geocoder", "published-address-responses.json"), "utf8"),
) as { responses: Recorded[] };
const recorded = (label: string): Recorded => fixture.responses.find((row) => row.label === label)!;

const MESA = { ocdId: "ocd-division/country:us/state:az/place:mesa" };
const PIMA = { ocdId: "ocd-division/country:us/state:az/county:pima" };
const TUCSON = { ocdId: "ocd-division/country:us/state:az/place:tucson" };
const WILMOT = { ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town" };

function recordedFetch() {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = fixture.responses.find((row) => row.requestedUrl === url);
    if (!hit) throw new Error(`no recorded answer for ${url}`);
    return new Response(hit.body, { status: hit.httpStatus, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

function harness(overrides: { now?: () => number } = {}) {
  const net = recordedFetch();
  const attempts: GeocodeAttempt[] = [];
  const lines: string[] = [];
  const memory = new Map<string, RememberedAnswer>();
  const options = {
    fetchImpl: net.impl,
    memory,
    spacingMs: 0,
    onAttempt: (attempt: GeocodeAttempt) => attempts.push(attempt),
    report: (line: string) => lines.push(line),
    ...overrides,
  };
  return { net, attempts, lines, memory, options };
}

const stated = (street: string, city: string | null, state: string | null, zip: string | null): PublishedAddress =>
  ({ street, city, state, zip });

test("a published address with one agreeing match in the sitting's division is placed, and the answer is evidence", async () => {
  const h = harness();
  const point = await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), MESA, h.options);
  const answer = recorded("census_geocode_20_e_main_mesa");

  assert.deepEqual(h.net.calls, [answer.requestedUrl]);
  assert.ok(point);
  assert.equal(point.lat, 33.415153);
  assert.equal(point.lng, -111.830942);
  assert.equal(point.matchedAddress, "20 E MAIN ST, MESA, AZ, 85201");
  assert.equal(point.reused, false);
  assert.equal(point.evidence?.httpStatus, 200);
  assert.equal(point.evidence?.rawHash, answer.rawHash);
  assert.equal(point.evidence?.rawHash, createHash("sha256").update(answer.body).digest("hex"));
  assert.equal(point.evidence?.body, answer.body);
  assert.deepEqual(h.attempts.map((a) => a.outcome), ["PLACED"]);
});

test("a New Hampshire town's library is placed inside its town", async () => {
  const h = harness();
  const point = await geocodePublishedAddress(stated("11 N Wilmot Rd", "Wilmot", "NH", "03287"), WILMOT, h.options);
  assert.ok(point);
  assert.equal(point.matchedAddress, "11 N WILMOT RD, WILMOT, NH, 03287");
  assert.equal(point.lat, 43.452032);
  assert.equal(point.lng, -71.912736);
});

test("the same street in a division its ZIP does not reach keeps the named gap", async () => {
  const h = harness();
  const point = await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), PIMA, h.options);
  assert.equal(point, null);
  assert.equal(h.attempts.length, 1);
  const [attempt] = h.attempts;
  assert.equal(attempt!.outcome, "REFUSED");
  assert.match(attempt!.outcome === "REFUSED" ? attempt!.reason : "", /ZIP 85201, which does not reach ocd-division\/country:us\/state:az\/county:pima/);
  assert.equal(attempt!.evidence.rawHash, recorded("census_geocode_20_e_main_mesa").rawHash, "a refused answer is evidence too");
});

test("zero matches keep the named gap", async () => {
  const h = harness();
  const point = await geocodePublishedAddress(stated("300 S Fire Central Pl", "Tucson", "AZ", null), TUCSON, h.options);
  assert.equal(point, null);
  assert.deepEqual(h.net.calls, [recorded("census_geocode_300_s_fire_central").requestedUrl]);
  assert.match(h.lines.join("\n"), /is not placed: no address match/);
});

test("several matches are never chosen between, even when one is in the division", async () => {
  const h = harness();
  // No city and no ZIP were printed: the division's state is the only word added.
  const point = await geocodePublishedAddress(stated("1 E Main St", null, null, null), MESA, h.options);
  assert.equal(point, null);
  assert.deepEqual(h.net.calls, [recorded("census_geocode_1_e_main_az_no_city").requestedUrl]);
  assert.match(h.lines.join("\n"), /3 address matches \(1 E MAIN ST, AVONDALE, AZ, 85323; 1 E MAIN ST, MESA, AZ, 85201; 1 E MAIN ST, SOLOMON, AZ, 85551\)/);
});

test("an answer stands for an hour: no second request, then one", async () => {
  let clock = Date.parse("2026-09-24T17:00:00Z");
  const h = harness({ now: () => clock });
  const address = stated("300 S Fire Central Pl", "Tucson", "AZ", null);

  assert.equal(await geocodePublishedAddress(address, TUCSON, h.options), null);
  clock += GEOCODE_ANSWER_HOLD_MS - 1;
  assert.equal(await geocodePublishedAddress(address, TUCSON, h.options), null);
  assert.equal(h.net.calls.length, 1, "asked once within the hour");
  assert.match(h.lines.at(-1)!, /not asked again until 2026-09-24T18:00:00\.000Z/);

  clock += 2;
  assert.equal(await geocodePublishedAddress(address, TUCSON, h.options), null);
  assert.equal(h.net.calls.length, 2, "asked again after the hour");

  // A placed answer is remembered too: a second sitting at the same address costs nothing.
  const placed = await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), MESA, h.options);
  const again = await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), MESA, h.options);
  assert.equal(h.net.calls.length, 3);
  assert.deepEqual(again, placed);
  assert.deepEqual(h.attempts.map((a) => a.outcome), ["REFUSED", "REFUSED", "PLACED"]);
});

test("coordinates the previous payload already placed are reused without a request", async () => {
  const h = harness();
  const point = await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), MESA, {
    ...h.options,
    previous: (address, jurisdiction) =>
      address.street === "20 E Main St" && jurisdiction.ocdId === MESA.ocdId
        ? { lat: 33.415153, lng: -111.830942, matchedAddress: "20 E MAIN ST, MESA, AZ, 85201" }
        : null,
  });
  assert.deepEqual(point, { lat: 33.415153, lng: -111.830942, matchedAddress: "20 E MAIN ST, MESA, AZ, 85201", evidence: null, reused: true });
  assert.equal(h.net.calls.length, 0);
  assert.equal(h.attempts.length, 0);
});

test("the Bureau's answer must agree with the printed city, ZIP and state", () => {
  const payload = JSON.parse(recorded("census_geocode_130_w_congress").body);
  const printed = (city: string | null, state: string | null, zip: string | null) =>
    agreeingMatch(payload, stated("130 W Congress St", city, state, zip), "AZ");

  assert.deepEqual(printed("Tucson", "AZ", "85701"), {
    ok: true, lat: 32.221616, lng: -110.974033, matchedAddress: "130 W CONGRESS ST, TUCSON, AZ, 85701", zip: "85701",
  });
  assert.deepEqual(printed("City of Tucson", null, null).ok, true, "a municipality's formal name is the same city");
  assert.deepEqual(printed("Mesa", "AZ", null), { ok: false, reason: "the match is in TUCSON, not the printed Mesa" });
  assert.deepEqual(printed("Tucson", "AZ", "85702"), { ok: false, reason: "the match is in ZIP 85701, not the printed 85702" });
  assert.deepEqual(printed("Tucson", "NM", null), { ok: false, reason: "the match is in AZ, not the printed NM" });
  assert.deepEqual(agreeingMatch(payload, stated("130 W Congress St", null, null, null), "NM"), {
    ok: false, reason: "the match is in AZ, not the division's NM",
  });
});

test("a failed request is refused, remembered, and carries no invented bytes", async () => {
  const h = harness();
  const unavailable = (async () => new Response("Service Unavailable", { status: 503 })) as typeof fetch;
  assert.equal(await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), MESA, { ...h.options, fetchImpl: unavailable }), null);
  assert.match(h.lines.at(-1)!, /the Bureau answered HTTP 503/);

  const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  assert.equal(await geocodePublishedAddress(stated("1 E Main St", "Mesa", "AZ", "85201"), MESA, { ...h.options, fetchImpl: down }), null);
  const last = h.attempts.at(-1)!;
  assert.equal(last.outcome, "REFUSED");
  assert.equal(last.evidence.httpStatus, 0);
  assert.equal(last.evidence.rawHash, "");
  assert.equal(last.evidence.body, "");
  assert.match(last.outcome === "REFUSED" ? last.reason : "", /the request failed \(fetch failed\)/);
  assert.equal(h.memory.size, 2, "both failures stand for the hour");
});

test("words that are not a street address, and a division with no state, send nothing", async () => {
  const h = harness();
  assert.equal(await geocodePublishedAddress(stated("Study Session", "Mesa", "AZ", null), MESA, h.options), null);
  assert.equal(await geocodePublishedAddress(stated("20 E Main St", "Mesa", "AZ", "85201"), { ocdId: "ocd-division/country:us" }, h.options), null);
  assert.equal(h.net.calls.length, 0);
  assert.equal(stateOfDivision(WILMOT.ocdId), "NH");
  assert.equal(stateOfDivision("ocd-division/country:us"), null);
  assert.equal(publishedAddressQuery(stated(" 240 N. Court Ave. ", null, null, null), "AZ"), "240 N. Court Ave., AZ");
  assert.equal(publishedAddressQuery(stated("20 East Main Street", "Mesa", "az", "85201"), "AZ"), "20 East Main Street, Mesa, AZ 85201");
});
