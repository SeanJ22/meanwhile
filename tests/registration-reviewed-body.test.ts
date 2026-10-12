import assert from "node:assert/strict";
import test from "node:test";

import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import type { LoadedReference } from "../lib/registration/reference.ts";

const reference: LoadedReference = {
  sha256: "test",
  generatedAt: "2026-09-23",
  reference: {
    formatVersion: 1,
    state: "xx",
    divisions: [
      ["ocd-division/country:us/state:xx", "state", "99", "Example State"],
      ["ocd-division/country:us/state:xx/county:one", "county", "99001", "One County"],
      ["ocd-division/country:us/state:xx/county:two", "county", "99003", "Two County"],
    ],
    governments: [["123456", "xx:county:one", "ONE COUNTY", "COUNTY", 1, "CENSUS_CODE", 2]],
  },
};

const first = { id: "ocd-division/country:us/state:xx/county:one#governing", ocdId: "ocd-division/country:us/state:xx/county:one", bodyClass: "GOVERNING", censusId: "123456" };
const alternate = { id: "ocd-division/country:us/state:xx/county:two#governing", ocdId: "ocd-division/country:us/state:xx/county:two", bodyClass: "GOVERNING", censusId: "123456" };

test("reviewed body bridge requires native government identity and keeps established body IDs", () => {
  assert.deepEqual(reviewedBodyForGovernment(reference, "xx:county:one", [first]), {
    bodyId: first.id, ocdId: first.ocdId, publishingOrg: "One County",
  });
  assert.equal(reviewedBodyForGovernment(reference, "xx:county:missing", [first]), null);
  assert.equal(reviewedBodyForGovernment(reference, "xx:county:one", [{ ...first, censusId: "987654" }]), null);
  assert.equal(reviewedBodyForGovernment(reference, "xx:county:one", [{ ...first, bodyClass: "ADVISORY" }]), null);
  assert.equal(reviewedBodyForGovernment(reference, "xx:county:one", [first, alternate]), null, "two candidate bodies must be held");
});
