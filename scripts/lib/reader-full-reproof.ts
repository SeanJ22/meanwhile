import assert from "node:assert/strict";
import { createHash } from "node:crypto";

interface ListingWitnessGroup {
  sourceIds: readonly string[];
  reason: string;
  sourceListingCount: number;
  uniqueMeetingCount: null;
}

export function validateListingWitnessReadback(actual: readonly ListingWitnessGroup[] | undefined, expected: readonly ListingWitnessGroup[]): void {
  assert.ok(expected.length, "The canonical ambiguous-listing witness population is empty");
  assert.ok(expected.every((group) => group.sourceIds.length >= 2 && group.sourceIds.length === group.sourceListingCount && group.uniqueMeetingCount === null), "The canonical listing ambiguity is not proved");
  assert.deepEqual(actual, expected, "Every current canonical ambiguous listing group requires its exact rendered identity readback");
}

export function validateFullReproofComponentEvidence(evidence: {
  exactHead?: string;
  holdingsDigest?: string;
  sourceHashes?: readonly unknown[];
  cases?: readonly unknown[];
  failures?: readonly unknown[];
}, exactHead: string, holdingsDigest: string): void {
  assert.equal(evidence.exactHead, exactHead, "Full component evidence requires the current exact head");
  assert.equal(evidence.holdingsDigest, holdingsDigest, "Full component evidence requires the current holdings");
  assert.ok(Array.isArray(evidence.sourceHashes) && evidence.sourceHashes.length, "Full component evidence requires source bindings");
  assert.ok(Array.isArray(evidence.cases) && evidence.cases.length, "Full component evidence requires actual rendered cases");
  assert.deepEqual(evidence.failures, [], "Full component evidence contains failures or has no verdict");
}

/** Full reproof may not borrow an earlier build's in-situ browser witnesses. */
export function validateFullReproofWitnesses(options: {
  exactHead: string;
  buildId: string;
  witnesses: readonly { surface: string; component: string; exactHead: string; evidencePath: string; evidenceSha256: string }[];
  requirements: readonly { surface: string; component: string; importReach: boolean }[];
  readEvidence: (path: string) => Buffer;
}): void {
  assert.ok(options.buildId && options.witnesses.length, "Full reproof requires a build and full surface witnesses");
  const keys = new Set<string>();
  for (const witness of options.witnesses) {
    const key = `${witness.surface}#${witness.component}`;
    assert.ok(!keys.has(key), `Duplicate surface witness ${key}`);
    keys.add(key);
    assert.equal(witness.exactHead, options.exactHead, `${key}: stale witness head`);
    const bytes = options.readEvidence(witness.evidencePath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), witness.evidenceSha256, `${key}: wrong witness artifact`);
    const evidence = JSON.parse(bytes.toString("utf8"));
    assert.equal(evidence.exactHead, options.exactHead, `${key}: stale browser head`);
    assert.equal(evidence.buildId, options.buildId, `${key}: wrong browser build`);
  }
  for (const requirement of options.requirements.filter((row) => row.importReach)) {
    const key = `${requirement.surface}#${requirement.component}`;
    assert.ok(keys.has(key), `Full reproof lacks current surface witness ${key}`);
  }
}
