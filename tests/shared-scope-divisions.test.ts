import assert from "node:assert/strict";
import test from "node:test";
import { withSharedScopeDivisions } from "../lib/control-plane/expansion/scope-divisions.ts";

test("local scopes include shared ancestors without including other counties or states", () => {
  const city = "ocd-division/country:us/state:az/place:sierra_vista";
  const entry = withSharedScopeDivisions({ ids: [city], partial: [city], samples: 19 });
  assert.deepEqual(entry.ids, ["ocd-division/country:us", "ocd-division/country:us/state:az", city]);
  assert.deepEqual(entry.partial, [city]);
  assert.equal(entry.samples, 19);
  assert.deepEqual(withSharedScopeDivisions(entry), entry, "repeated joins reuse identical identities");
});

test("a representative second state works without ZIP-specific logic and cross-state uncertainty remains visible", () => {
  const nh = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
  assert.deepEqual(withSharedScopeDivisions({ ids: [nh], partial: [], samples: 8 }).ids, ["ocd-division/country:us", "ocd-division/country:us/state:nh", nh]);
  const cross = withSharedScopeDivisions({ ids: [nh, "ocd-division/country:us/state:vt/place:example"], partial: [nh], samples: 8 });
  assert.ok(cross.partial.includes("ocd-division/country:us/state:nh"));
  assert.ok(cross.partial.includes("ocd-division/country:us/state:vt"));
  assert.deepEqual(withSharedScopeDivisions({ ids: [], partial: [], samples: 0 }).ids, []);
});
