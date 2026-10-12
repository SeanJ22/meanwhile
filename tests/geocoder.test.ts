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
  houseNumberIn,
  sampleNumbersFor,
  locateStreetInZip,
  locateAddressInZip,
  lookupStreetInZip,
  parseCensusPoint,
  streetOnly,
} from "../lib/geo/census-geocoder.ts";

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

/** A recorded Census response for a matched address. */
const REAL_MATCH = {
  result: {
    addressMatches: [
      {
        matchedAddress: "808 GREEN POND RD, ROCKAWAY, NJ, 07866",
        addressComponents: { zip: "07866" }, coordinates: { x: -74.47412960913, y: 40.994137298987 },
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

  // A bare street name gets nothing back; this is why the sampling exists.
  assert.equal(parseCensusPoint(REAL_EMPTY), null);

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

test("D53: samples that agree give a midpoint; samples that scatter give nothing", () => {
  // The four recorded samples span 0.08 km.
  const tight = coherentMidpoint([
    { lat: 40.90273, lng: -74.51317 },
    { lat: 40.90337, lng: -74.5137 },
  ]);
  assert.ok(tight);
  assert.ok(tight.spreadKm < 0.2, `spread was ${tight.spreadKm}`);
  assert.ok(Math.abs(tight.lat - 40.90305) < 0.001);

  // The recorded samples span 5.64 km and cross a municipal line; a midpoint would decide which town's meetings the reader sees.
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
  for (const n of sampleNumbersFor(houseNumberIn("808 Green Pond Road"))) {
    assert.ok(
      asked.some((u) => u.includes(`address=${n} Green Pond Road`)),
      `sample ${n} was never asked for`,
    );
  }
  assert.deepEqual(
    sampleNumbersFor(houseNumberIn("808 Green Pond Road")),
    [800, 824, 874, 898],
    "the block ladder for 808 is its own hundred block, even side",
  );
});

test("the Vail defect: a high house number is placed, and is never itself sent", () => {
  // No number in a fixed low ladder matches a street whose range is 10701-10899.
  assert.equal(houseNumberIn("10723 South Bear Table Tank Drive"), 10723);
  const vail = sampleNumbersFor(10723);
  assert.deepEqual(vail, [10701, 10725, 10775, 10799]);
  assert.ok(!vail.includes(10723), "the reader's own house number was sent");

  // The Bureau indexes each side of a street as its own range, so an even-side street answers nothing to an odd number.
  const evenSide = sampleNumbersFor(13000);
  assert.deepEqual(evenSide, [13002, 13024, 13074, 13098]);
  assert.ok(!evenSide.includes(13000), "the reader's own house number was sent");
  for (const n of evenSide) assert.equal(n % 2, 0, `${n} broke parity`);
  for (const n of sampleNumbersFor(10723)) assert.equal(n % 2, 1, `${n} broke parity`);

  // No number typed is the path every existing reader is on. It does not move.
  assert.equal(houseNumberIn("Green Pond Road"), null);
  assert.deepEqual(sampleNumbersFor(null), [...SAMPLE_HOUSE_NUMBERS]);

  // The promise holds for EVERY input, not for most of them. A collision is
  // shifted by two so it stays on the reader's own side of the street.
  for (let house = 1; house <= 4000; house++) {
    const numbers = sampleNumbersFor(house);
    assert.ok(!numbers.includes(house), `house ${house} would have been sent`);
    assert.equal(numbers.length, 4, `house ${house} lost a sample`);
    for (const n of numbers) {
      assert.ok(n > 0, `house ${house} produced a non-positive sample ${n}`);
    }
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

test("D53/M80: the point is never stored, and the only server it touches is the proxy", () => {
  // Read as source: a cache, a log line or a stored write is one import away and would fail no other test here.
  // Comments are stripped first, because the module's own doc block names what it never touches.
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
    "search_log",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `the geocoder reaches for ${forbidden} — the point must stay on the device`,
    );
  }
  // Exactly one path on our own origin, and it is the proxy. Anything else
  // would be a second route nobody has proven writes nothing.
  const ourPaths = [...source.matchAll(/["'](\/api\/[a-z0-9/_-]*)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ourPaths)], ["/api/geocode"]);
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
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.51317, y: 40.90273 } }] },
      },
      "50 Academy St": {
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.5137, y: 40.90337 } }] },
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
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.50227, y: 40.9106 } }] },
      },
      "800 Green Pond Road": {
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.49598, y: 40.96108 } }] },
      },
    }),
  });
  assert.equal(scattered, null, "a 5.6 km street produced a single confident point");
});

test("the author's ruling: a crossing street is a question, not a refusal", async () => {
  // A street we cannot find and a street that runs across the map are different answers.
  const crossing = await lookupStreetInZip("Green Pond Road", "07866", {
    fetchImpl: stubFetch({
      "1 Green Pond Road": {
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.50227, y: 40.9106 } }] },
      },
      "800 Green Pond Road": {
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.49598, y: 40.96108 } }] },
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
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.51317, y: 40.90273 } }] },
      },
      "50 Academy St": {
        result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.5137, y: 40.90337 } }] },
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
          result: { addressMatches: [{ addressComponents: { zip: "07866" }, coordinates: { x: -74.49598, y: 40.96108 } }] },
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
    new URL("../components/address/address-prompt.tsx", import.meta.url),
    "utf8",
  );
  // The number lives in component state and goes to the geocoder. It must
  // not be written to the device store, logged, or sent to our own API —
  // the same rule the resolved point ships under.
  for (const forbidden of [
    "setStreet(houseNumber",
    "writeSessionAddress({ houseNumber",
    "houseNumber, streetLabel",
    "/api/log",
    "console.log(houseNumber",
    "localStorage",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `the address prompt reaches for ${forbidden} with the house number`,
    );
  }
  // And it is cleared once the request finishes, whatever the outcome (a `try`/`finally` block).
  assert.match(source, /finally \{[\s\S]{0,200}setHouseNumber\(""\)/);
});

test("M80: the geocode route writes NOTHING — no log, no store, no echo", async () => {
  const source = readFileSync(
    join(process.cwd(), "app", "api", "geocode", "route.ts"),
    "utf8",
  );

  // The source scan. Every write primitive this codebase has, and the
  // console: an address that reaches a log line is an address we kept,
  // whatever the transparency page says.
  for (const banned of [
    "logEvent",
    "insert",
    "drizzle",
    "getDb",
    "reactions",
    "search_log",
    "localStorage",
    "writeFile",
    "appendFile",
    "console.log",
    "console.error",
    "console.warn",
  ]) {
    assert.ok(
      !source.includes(banned),
      `the geocode route contains "${banned}" — this route must write nothing`,
    );
  }

  // GET would put a home address in a URL, and URLs reach access logs and
  // proxy caches that are not ours to promise about.
  assert.ok(!/export async function GET/.test(source), "the route must not accept GET");
  assert.ok(/export async function POST/.test(source));
  // Never cacheable: this response is per-reader by construction.
  assert.ok(/no-store/.test(source));
  assert.ok(
    !/cache-control["']?\s*:\s*["'][^"']*public/i.test(source),
    "a per-reader response must never be publicly cacheable",
  );

  // And the runtime proof: call it with a stubbed upstream and assert that
  // nothing anywhere observed the address. A source scan alone would pass a
  // route that wrote through an alias.
  const { POST } = await import("../app/api/geocode/route.ts");
  const observed: string[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args: unknown[]) => observed.push(`log:${String(args[0])}`);
  console.error = (...args: unknown[]) => observed.push(`error:${String(args[0])}`);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        result: { addressMatches: [{ addressComponents: { zip: "85701" }, coordinates: { x: -110.97, y: 32.22 } }] },
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const response = await POST(
      new Request("https://example.test/api/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "1 W Congress St, 85701" }),
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.match, true);
    assert.equal(body.lat, 32.22);
    assert.equal(body.lng, -110.97);
    // Nothing about the request is echoed back — not the address, not the
    // upstream status, not an error string.
    assert.deepEqual(Object.keys(body).sort(), ["lat", "lng", "match", "zip"]);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realError;
  }
  assert.deepEqual(observed, [], "the route logged something");
});

test("M80: a browser goes through the proxy; the server calls the Bureau direct", async () => {
  const source = readFileSync(
    join(process.cwd(), "lib", "geo", "census-geocoder.ts"),
    "utf8",
  );
  const { GEOCODE_PROXY_PATH } = await import("../lib/geo/census-geocoder.ts");
  assert.equal(GEOCODE_PROXY_PATH, "/api/geocode");
  // The branch on `window` keeps the browser path live: the Census geocoder sends no CORS header, and Node does not enforce CORS.
  assert.ok(source.includes('typeof window === "undefined"'));
  assert.ok(source.includes("GEOCODE_PROXY_PATH"));

  // The server path still reaches the Bureau directly — scripts and the
  // venue cache have no CORS to satisfy and no server to depend on.
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        result: { addressMatches: [{ addressComponents: { zip: "85701" }, coordinates: { x: -110.97, y: 32.22 } }] },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const point = await locateAddressInZip("1", "W Congress St", "85701", { fetchImpl });
  assert.ok(point);
  assert.equal(calls.length, 1);
  assert.ok(
    calls[0].startsWith(CENSUS_GEOCODER_URL),
    `server-side call went to ${calls[0]}`,
  );
});

test("M80: the address prompt discloses Census lookup and district-only visit storage", () => {
  const prompt = readFileSync(
    join(process.cwd(), "components", "address", "address-prompt.tsx"),
    "utf8",
  );

  const privacyParagraphs = [...prompt.matchAll(/<p className="address-prompt-promise">([\s\S]*?)<\/p>/g)]
    .map((match) => match[1].replace(/\s+/g, " "));
  const lookupDisclosure = privacyParagraphs.find((paragraph) => /Census Bureau/.test(paragraph));
  assert.ok(lookupDisclosure, "the prompt must disclose the Census address lookup");
  assert.match(lookupDisclosure, /house number.*check your districts.*Census Bureau/i);
  assert.match(lookupDisclosure, /Only the district result stays on this device for this visit/);
  for (const paragraph of privacyParagraphs) {
    assert.doesNotMatch(paragraph, /never (?:send it to us|store|log)/i);
  }
});


test("Census geocoding preserves ambiguity, rejects another ZIP, and supports US territories", async () => {
  assert.equal(parseCensusPoint({ result: { addressMatches: [...REAL_MATCH.result.addressMatches, ...REAL_MATCH.result.addressMatches] } }), null);
  for (const [x, y] of [[144.79, 13.44], [145.75, 15.18], [-170.70, -14.28]]) {
    assert.deepEqual(parseCensusPoint({ result: { addressMatches: [{ coordinates: { x, y } }] } }), { lat: y, lng: x });
  }
  const fetchImpl = (async () => new Response(JSON.stringify(REAL_MATCH))) as typeof fetch;
  assert.equal(await locateAddressInZip("1", "Green Pond Road", "07867", { fetchImpl }), null);
});
