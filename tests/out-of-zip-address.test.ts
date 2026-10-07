// `locateAddressInZip` puts the ZIP into the geocoder query, so an address one ZIP over fails exactly like a
// bad address; the reply's own ZIP is what tells them apart.

import assert from "node:assert/strict";
import test from "node:test";

import { parseCensusZip, zipThisAddressResolvesTo } from "../lib/geo/census-geocoder.ts";

/** A Census reply shaped as the service returns one. */
function reply(zip: string | null) {
  return {
    result: {
      addressMatches:
        zip === null
          ? []
          : [
              {
                coordinates: { x: -110.97, y: 32.22 },
                addressComponents: { zip, state: "AZ", city: "TUCSON" },
              },
            ],
    },
  };
}

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

test("SEEDED BAL-38: the matched ZIP was in the response and was being dropped", () => {
  assert.equal(parseCensusZip(reply("85641")), "85641");
  assert.equal(parseCensusZip(reply(null)), null, "no match, no zip");
});

test("BAL-38: a malformed or absent zip is null, never a guess", () => {
  assert.equal(parseCensusZip({ result: { addressMatches: [{ addressComponents: {} }] } }), null);
  assert.equal(parseCensusZip({ result: { addressMatches: [{ addressComponents: { zip: "857" } }] } }), null);
  assert.equal(parseCensusZip(null), null);
  assert.equal(parseCensusZip("nonsense"), null);
});

test("SEEDED BAL-38: an address in the NEXT zip over is reported, not swallowed", async () => {
  const seen: string[] = [];
  const zip = await zipThisAddressResolvesTo("13005", "E Colossal Cave Rd", "85701", {
    fetchImpl: (async (url: string, init?: RequestInit) => {
      seen.push(String(init?.body ?? url));
      return ok(reply("85641"));
    }) as unknown as typeof fetch,
  });
  assert.equal(zip, "85641");
  assert.ok(
    seen.some((s) => !s.includes("85701")),
    "the re-ask must be UNCONSTRAINED — putting the stated zip back in the query is what made " +
      "the out-of-zip case indistinguishable from a bad address",
  );
});

test("SEEDED BAL-38: the SAME zip is not a redirect and offers nothing", async () => {
  // A constrained lookup that failed for another reason must not offer the ZIP the reader is already on.
  const zip = await zipThisAddressResolvesTo("1", "Nowhere St", "85701", {
    fetchImpl: (async () => ok(reply("85701"))) as unknown as typeof fetch,
  });
  assert.equal(zip, null);
});

test("BAL-38: no match, a bad response, or a throw all yield null", async () => {
  const impl = (body: unknown, okFlag = true) =>
    (async () => ({ ok: okFlag, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

  assert.equal(
    await zipThisAddressResolvesTo("1", "Nowhere St", "85701", { fetchImpl: impl(reply(null)) }),
    null,
  );
  assert.equal(
    await zipThisAddressResolvesTo("1", "Nowhere St", "85701", { fetchImpl: impl({}, false) }),
    null,
  );
  assert.equal(
    await zipThisAddressResolvesTo("1", "Nowhere St", "85701", {
      fetchImpl: (async () => {
        throw new Error("network");
      }) as unknown as typeof fetch,
    }),
    null,
    "a suggestion the reader cannot act on is worse than the honest failure it replaced",
  );
});

test("BAL-38: a street with no house number is not re-asked", async () => {
  /* A street-only lookup samples several points and has no single address to
     re-ask about; guessing one would geocode something the reader never typed. */
  let called = false;
  const zip = await zipThisAddressResolvesTo("", "E Colossal Cave Rd", "85701", {
    fetchImpl: (async () => {
      called = true;
      return ok(reply("85641"));
    }) as unknown as typeof fetch,
  });
  assert.equal(zip, null);
  assert.equal(called, false, "and nothing left this product on that path");
});
