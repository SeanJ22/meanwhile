import assert from "node:assert/strict";
import test from "node:test";

import { parseCensusZip } from "../lib/geo/census-geocoder.ts";

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
