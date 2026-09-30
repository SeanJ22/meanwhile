import assert from "node:assert/strict";
import test from "node:test";

import { readerJurisdictionLabel } from "../lib/meetings/query.ts";

test("an id-shaped jurisdiction reads as the name it spells", () => {
  assert.equal(readerJurisdictionLabel("az:county:county-of-cochise"), "Cochise County, AZ");
  assert.equal(readerJurisdictionLabel("nj:township:township-of-rockaway"), "Rockaway Township, NJ");
  assert.equal(
    readerJurisdictionLabel("ocd-division/country:us/state:az/county:cochise"),
    "Cochise County, AZ",
  );
  assert.equal(
    readerJurisdictionLabel("ocd-division/country:us/state:az/place:sierra_vista"),
    "Sierra Vista, AZ",
  );
});

test("a jurisdiction that is already a name is left alone", () => {
  assert.equal(readerJurisdictionLabel("Pima County, AZ"), "Pima County, AZ");
  assert.equal(readerJurisdictionLabel("Tucson, AZ"), "Tucson, AZ");
  assert.equal(readerJurisdictionLabel("AZ"), "AZ");
});
