import assert from "node:assert/strict";
import test from "node:test";

import { prlCardSource } from "../lib/officials/card-sources.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "../lib/sources/prl/types.ts";

test("PRL's measurements are credited to PRL in the card's Sources, with the date read", () => {
  const source = prlCardSource({ attribution: PRL_RHETORIC_ATTRIBUTION, sourceUrl: "https://americaspoliticalpulse.com/elites/data", readAt: "2026-08-19T10:00:00Z" });
  assert.equal(source.provenance.sourceOrg, PRL_RHETORIC_ATTRIBUTION.text);
  assert.equal(source.provenance.sourceUrl, "https://americaspoliticalpulse.com/elites/data");
  assert.equal(source.provenance.collectedAt, "2026-08-19");
  assert.match(source.what, /Polarization Research Lab/);
  assert.doesNotMatch(source.what, /score|rank|rating|grade/i);
});
