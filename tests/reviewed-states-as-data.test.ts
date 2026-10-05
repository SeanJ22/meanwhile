import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  clearOperationalReferenceBundle,
  installedOperationalReferenceRegistries,
  installOperationalReferenceBundle,
  installRegistrationJurisdictionRegistries,
  operationalReferenceBundle,
  requiredJurisdictionRegistry,
} from "../lib/civic-data/operational-references.ts";
import { hasReviewedRegistry, reviewedRegistryStates } from "../lib/civic-data/reviewed-registry-states.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (state: string) => JSON.parse(readFileSync(join(ROOT, `data/states/${state}/jurisdictions/${state}.json`), "utf8")) as JurisdictionRegistry;
const SEEDS = { az: read("az"), nh: read("nh"), nj: read("nj") };

/** A fourth state's reference, added as data: the New Hampshire rows re-stated for Ohio. */
function fourth(): JurisdictionRegistry {
  const nh = structuredClone(SEEDS.nh);
  return { ...nh, stateCode: "OH", jurisdictions: nh.jurisdictions.map((j) => ({ ...j, stateCode: "OH" })) } as JurisdictionRegistry;
}

test("the three seed states are reviewed with no bundle installed", () => {
  clearOperationalReferenceBundle();
  assert.deepEqual([...reviewedRegistryStates()], ["az", "nh", "nj"]);
  assert.equal(hasReviewedRegistry("OH"), false);
});

test("a state the promoted bundle carries beyond the seeds becomes reviewed with no release", () => {
  clearOperationalReferenceBundle();
  installOperationalReferenceBundle(operationalReferenceBundle({ ...SEEDS, oh: fourth() } as never));
  assert.equal(hasReviewedRegistry("oh"), true);
  assert.equal(requiredJurisdictionRegistry("OH").stateCode, "OH");
  assert.deepEqual(Object.keys(installedOperationalReferenceRegistries()).sort(), ["az", "nh", "nj", "oh"], "the provider inputs read their tracked states from this");
  assert.throws(() => installRegistrationJurisdictionRegistries(new Map([["oh", fourth()]])), /REGISTRATION_REGISTRY_FOR_REVIEWED_STATE/);
  clearOperationalReferenceBundle();
  assert.equal(hasReviewedRegistry("oh"), false);
});

test("a bundle missing a seed state, or carrying a malformed extra, is refused", () => {
  clearOperationalReferenceBundle();
  assert.throws(() => installOperationalReferenceBundle(operationalReferenceBundle({ az: SEEDS.az, nh: SEEDS.nh } as never)), /OPERATIONAL_REFERENCE_BUNDLE_INVALID/);
  assert.throws(() => installOperationalReferenceBundle(operationalReferenceBundle({ ...SEEDS, oh: { ...fourth(), stateCode: "PA" } } as never)), /STATE_CODE_MISMATCH/);
  assert.equal(hasReviewedRegistry("oh"), false);
});
