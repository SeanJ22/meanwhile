import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_URL,
  MAX_SPREAD_KM,
  SAMPLE_HOUSE_NUMBERS,
  censusGeocodeUrl,
  coherentMidpoint,
  locateStreetInZip,
  locateAddressInZip,
  lookupStreetInZip,
  parseCensusPoint,
  streetOnly,
} from "../lib/geo/census-geocoder.ts";

/**
 * D53 (2026-08-15) — the street becomes a point, or nothing.
 *
 * The author approved the Census Bureau's geocoder as this product's external
 * geocoding source. Wiring it turned up a fact worth pinning: **the Census
 * geocoder does not geocode street names**, only addresses. So this samples a
 * few house numbers and asks whether they agree about where the street is,
 * and refuses to answer when they do not.
 *
 * These guards hold the three things that make that honest rather than
 * plausible: no reader house number is ever sent, a scattered street produces
 * nothing rather than a confident wrong pin, and every failure mode lands on
 * `null` so the caller's fallback is one branch.
 *
 * No live calls — the recorded payloads below are real Census responses,
 * fetched 2026-08-15.
 */

/* ------------------------------------------------------------- the input --- */

test("D53: a house number the reader types anyway is stripped before sending", () => {
  assert.equal(streetOnly("808 Green Pond Road"), "Green Pond Road");
  assert.equal(streetOnly("  12A Elm St "), "Elm St");
  assert.equal(streetOnly("#7 Maple Ave"), "Maple Ave");
  // A street whose NAME starts with a number keeps it — "22nd St" is not a
  // house number, and eating it would send a street that does not exist.
  assert.equal(streetOnly("22ND ST"), "22ND ST");
  assert.equal(streetOnly("E 12TH ST"), "E 12TH ST");
});

test("D53: the URL is the federal endpoint, with the sampled number and the zip", () => {
  const url = censusGeocodeUrl("1 Academy St, 07866");
  assert.ok(url.startsWith(CENSUS_GEOCODER_URL));
  assert.match(url, /address=1\+Academy\+St%2C\+07866/);
  assert.match(url, new RegExp(`benchmark=${CENSUS_BENCHMARK}`));
  assert.match(url, /format=json/);
});

/* ------------------------------------------------------------ the parser --- */

/** A real Census response, fetched 2026-08-15 for "808 Green Pond Road, 07866". */
const REAL_MATCH = {
  result: {
    addressMatches: [
      {
        matchedAddress: "808 GREEN POND RD, ROCKAWAY, NJ, 07866",
        coordinates: { x: -74.47412960913, y: 40.994137298987 },
      },
    ],
  },
};

/** A real Census response for a bare street name — the finding, recorded. */
const REAL_EMPTY = { result: { addressMatches: [] } };

test("D53: a real match parses; a real miss is null, not a throw", () => {
  const point = parseCensusPoint(REAL_MATCH);
  assert.ok(point);
  assert.ok(Math.abs(point.lat - 40.9941) < 0.001);
  assert.ok(Math.abs(point.lng - -74.4741) < 0.001);

  // The recorded proof that a bare street name gets nothing back. This is
  // why the sampling exists at all; if the Bureau ever starts answering
  // street names, this test is where that shows up.
  assert.equal(parseCensusPoint(REAL_EMPTY), null);

  // Everything unexpected is null rather than an exception, because this
  // parses third-party JSON on the reader's device.
  for (const junk of [null, undefined, {}, { result: {} }, "nope", 42]) {
    assert.equal(parseCensusPoint(junk), null);
  }
  assert.equal(
    parseCensusPoint({ result: { addressMatches: [{ coordinates: { x: "a", y: "b" } }] } }),
    null,
  );
  // Outside the U.S. envelope: a parse gone wrong, not a place.
  assert.equal(
    parseCensusPoint({ result: { addressMatches: [{ coordinates: { x: 12, y: 5 } }] } }),
    null,
  );
});

/* --------------------------------------------------------- the coherence --- */

test("D53: samples that agree give a midpoint; samples that scatter give nothing", () => {
  // Academy St, 07866 — the four real samples span 0.08 km.
  const tight = coherentMidpoint([
    { lat: 40.90273, lng: -74.51317 },
    { lat: 40.90337, lng: -74.5137 },
  ]);
  assert.ok(tight);
  assert.ok(tight.spreadKm < 0.2, `spread was ${tight.spreadKm}`);
  assert.ok(Math.abs(tight.lat - 40.90305) < 0.001);

  // Green Pond Road, 07866 — the real samples span 5.64 km and cross a
  // municipal line. One point cannot mean anything here, and a midpoint
  // would sit on a road nobody asked about while quietly deciding which
  // town's meetings the reader sees.
  const scattered = coherentMidpoint([
    { lat: 40.9106, lng: -74.50227 },
    { lat: 40.91418, lng: -74.50085 },
    { lat: 40.92886, lng: -74.48683 },
    { lat: 40.9405, lng: -74.49246 },
    { lat: 40.96108, lng: -74.49598 },
  ]);
  assert.equal(scattered, null);

  assert.equal(coherentMidpoint([]), null);

  // A single sample is coherent with itself, which is correct: one matched
  // address on the street is still a real point on the street.
  const single = coherentMidpoint([{ lat: 31.94591, lng: -110.77451 }]);
  assert.ok(single && single.spreadKm === 0);
});

/* -------------------------------------------------------- the whole path --- */

function stubFetch(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL) => {
    // Decoded, and `+` back to a space: URLSearchParams writes spaces as `+`
    // and decodeURIComponent leaves those alone, so matching on the raw
    // string quietly hits nothing and every stub returns "no match".
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    const key = Object.keys(bodies).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? bodies[key] : REAL_EMPTY), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("D53: the lookup never sends a reader's number and stops at four samples", async () => {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    asked.push(decodeURIComponent(String(input)).replace(/\+/g, " "));
    return new Response(JSON.stringify(REAL_EMPTY), { status: 200 });
  }) as typeof fetch;

  await locateStreetInZip("808 Green Pond Road", "07866", { fetchImpl });

  assert.equal(
    asked.length,
    SAMPLE_HOUSE_NUMBERS.length,
    `asked ${asked.length} times for ${SAMPLE_HOUSE_NUMBERS.length} samples`,
  );
  for (const url of asked) {
    assert.ok(
      !url.includes("808"),
      `the reader's own house number reached the Census Bureau: ${url}`,
    );
    assert.ok(url.includes("07866"), "the zip is what scopes the lookup");
  }
  // The numbers sent are this module's, and they are stated.
  for (const n of SAMPLE_HOUSE_NUMBERS) {
    assert.ok(asked.some((u) => u.includes(`address=${n} Green Pond Road`)));
  }
});

test("D53: every failure mode returns null rather than an error state", async () => {
  const cases: Array<[string, typeof fetch]> = [
    [
      "no matches",
      (async () => new Response(JSON.stringify(REAL_EMPTY), { status: 200 })) as typeof fetch,
    ],
    ["a 500", (async () => new Response("boom", { status: 500 })) as typeof fetch],
    ["a 403", (async () => new Response("no", { status: 403 })) as typeof fetch],
    [
      "junk that is not JSON",
      (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    ],
    [
      "a refused connection",
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    ],
  ];

  for (const [name, fetchImpl] of cases) {
    assert.equal(
      await locateStreetInZip("Academy St", "07866", { fetchImpl }),
      null,
      `${name} did not return null`,
    );
  }

  // Bad input never reaches the network at all.
  let called = 0;
  const counting = (async () => {
    called++;
    return new Response(JSON.stringify(REAL_EMPTY), { status: 200 });
  }) as typeof fetch;
  assert.equal(await locateStreetInZip("St", "07866", { fetchImpl: counting }), null);
  assert.equal(await locateStreetInZip("Academy St", "7866", { fetchImpl: counting }), null);
  assert.equal(await locateStreetInZip("Academy St", "not a zip", { fetchImpl: counting }), null);
  assert.equal(called, 0, "a request went out for input that could not resolve");
});

test("D53: the point is never stored and never reaches our own server", () => {
  // Read as source, deliberately. The promise "we never store it, never send
  // it to us" is now printed under the street input, and the cheapest way for
  // it to become false is somebody adding a convenience: a localStorage
  // cache, a log line, a POST to our own API to "help the cascade". Each of
  // those is one import away and none would fail any other test here.
  // Comments stripped first. The module's own doc block promises it does not
  // touch localStorage, and a scan that reads prose would fail on the
  // promise — a loose pattern verifies nothing, in either direction.
  const source = readFileSync(
    join(import.meta.dirname, "..", "lib", "geo", "census-geocoder.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "logEvent",
    "/api/",
    "search_log",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `the geocoder reaches for ${forbidden} — the point must stay on the device`,
    );
  }
  // The only host it may talk to is the Bureau's.
  const hosts = [...source.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
  for (const host of hosts) {
    assert.ok(
      host === "geocoding.geo.census.gov" || host === "github.com",
      `the geocoder names ${host}`,
    );
  }
});

test("D53: a street whose samples agree resolves; one that scatters does not", async () => {
  const tight = await locateStreetInZip("Academy St", "07866", {
    fetchImpl: stubFetch({
      "1 Academy St": {
        result: { addressMatches: [{ coordinates: { x: -74.51317, y: 40.90273 } }] },
      },
      "50 Academy St": {
        result: { addressMatches: [{ coordinates: { x: -74.5137, y: 40.90337 } }] },
      },
    }),
  });
  assert.ok(tight);
  assert.equal(tight.samples, 2);
  assert.equal(tight.street, "Academy St");
  assert.ok(tight.spreadKm <= MAX_SPREAD_KM);

  const scattered = await locateStreetInZip("Green Pond Road", "07866", {
    fetchImpl: stubFetch({
      "1 Green Pond Road": {
        result: { addressMatches: [{ coordinates: { x: -74.50227, y: 40.9106 } }] },
      },
      "800 Green Pond Road": {
        result: { addressMatches: [{ coordinates: { x: -74.49598, y: 40.96108 } }] },
      },
    }),
  });
  assert.equal(scattered, null, "a 5.6 km street produced a single confident point");
});

test("the author's ruling: a crossing street is a question, not a refusal", async () => {
  // The same two responses D53's test uses. Under `lookupStreetInZip` they
  // stop collapsing into one null: a street we cannot find and a street that
  // runs across the map are different answers, and only one of them has a
  // question the reader can settle.
  const crossing = await lookupStreetInZip("Green Pond Road", "07866", {
    fetchImpl: stubFetch({
      "1 Green Pond Road": {
        result: { addressMatches: [{ coordinates: { x: -74.50227, y: 40.9106 } }] },
      },
      "800 Green Pond Road": {
        result: { addressMatches: [{ coordinates: { x: -74.49598, y: 40.96108 } }] },
      },
    }),
  });
  assert.equal(crossing.kind, "CROSSES");
  if (crossing.kind !== "CROSSES") return;
  assert.equal(crossing.street, "Green Pond Road");
  assert.ok(crossing.spreadKm > MAX_SPREAD_KM, `spread ${crossing.spreadKm}`);

  // A street that agrees still resolves to a point, unchanged.
  const tight = await lookupStreetInZip("Academy St", "07866", {
    fetchImpl: stubFetch({
      "1 Academy St": {
        result: { addressMatches: [{ coordinates: { x: -74.51317, y: 40.90273 } }] },
      },
      "50 Academy St": {
        result: { addressMatches: [{ coordinates: { x: -74.5137, y: 40.90337 } }] },
      },
    }),
  });
  assert.equal(tight.kind, "POINT");

  // Nothing found at all is still NOT_FOUND — the refusal remains where it
  // belongs, and a street with no matches must never produce the question.
  const missing = await lookupStreetInZip("Nowhere Ave", "07866", {
    fetchImpl: stubFetch({}),
  });
  assert.equal(missing.kind, "NOT_FOUND");
});

test("the answer resolves to the point, and the house number is never kept", async () => {
  let asked = "";
  const point = await locateAddressInZip("808", "Green Pond Road", "07866", {
    fetchImpl: (async (url: string) => {
      asked = String(url);
      return {
        ok: true,
        json: async () => ({
          result: { addressMatches: [{ coordinates: { x: -74.49598, y: 40.96108 } }] },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  });

  assert.ok(point);
  assert.equal(point.samples, 1, "one exact address is one request, not four");
  // The number went to the Bureau, which is the only place it may go.
  assert.match(
    decodeURIComponent(asked).replace(/\+/g, " "),
    /808 Green Pond Road, 07866/,
  );
  // And it is not in what comes back. `street` is what the card renders, and
  // a card must never become a household.
  assert.equal(point.street, "Green Pond Road");
  assert.ok(
    !JSON.stringify(point).includes("808"),
    "the house number survived into the returned point",
  );

  // No number, no request.
  let called = false;
  const nothing = await locateAddressInZip("", "Green Pond Road", "07866", {
    fetchImpl: (async () => {
      called = true;
      return { ok: false } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  assert.equal(nothing, null);
  assert.equal(called, false, "an empty house number still hit the network");
});

test("the house number never reaches the narrowing store or a log", () => {
  const source = readFileSync(
    new URL("../components/map/narrowing-prompt.tsx", import.meta.url),
    "utf8",
  );
  // The number lives in component state and goes to the geocoder. It must
  // not be written to the device store, logged, or sent to our own API —
  // the same rule the resolved point ships under.
  for (const forbidden of [
    "setStreet(houseNumber",
    "setDivisions(houseNumber",
    "/api/log",
    "console.log(houseNumber",
    "localStorage",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `the narrowing prompt reaches for ${forbidden} with the house number`,
    );
  }
  // And it is cleared once the request finishes, whatever the outcome.
  assert.match(source, /\.finally\([\s\S]{0,200}setHouseNumber\(""\)/);
});
