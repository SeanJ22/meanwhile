import assert from "node:assert/strict";
import { test } from "node:test";

import {
  derivedRetrieval,
  planDerivedVersion,
  type AdapterBinding,
  type DerivedInputRef,
  type DerivedRowDecision,
  type RouteWithdrawnByPublisher,
} from "../lib/civic-data/derived-authority.ts";

/**
 * **A DERIVED VERSION IS RECOMPUTABLE FROM ITS INPUTS, AND ONLY A PUBLISHER
 * WITHDRAWS A ROW.** (NH330 Stage 2, piece 1, 2026-09-24.)
 *
 * The wiring store's row writer (piece 2) builds against this rule. The rows
 * here are wiring-shaped but the rule is generic: promoted with inputs,
 * attestation, adapter binding and the reader adapter's own verification; held
 * by name and never removed; removed only on ROUTE_WITHDRAWN_BY_PUBLISHER.
 */

interface WiringRow { readonly bodyId: string; readonly adapter: string; readonly url: string }

const evidence = (artifactId: string, retrievedAt = "2026-09-24T18:00:00.000Z") => ({
  kind: "VAULTED_EVIDENCE" as const, artifactId, contentHash: `sha256-${"a".repeat(64)}`, tier: "RAW" as const, retrievedAt,
});
const binding: AdapterBinding = { adapter: "schedulepage", closureDigest: "d1", config: { shapes: "notice-feed" } };
const verification = { adapter: "schedulepage", closureDigest: "d1", verifiedAt: "2026-09-24T18:05:00.000Z", sittings: 6, evidence: evidence("art-feed") };
const trustees: WiringRow = { bodyId: "nh:newbury#library-trustees", adapter: "schedulepage", url: "https://newburynhlibrary.net/feed/" };
const energy: WiringRow = { bodyId: "nh:newbury#energy-committee", adapter: "schedulepage", url: "https://www.newburyenergynh.org/" };

const promote = (key: string, row: WiringRow, over: Partial<Extract<DerivedRowDecision<WiringRow>, { disposition: "PROMOTE" }>> = {}): DerivedRowDecision<WiringRow> => ({
  disposition: "PROMOTE", key, row,
  attestation: { kind: "ROUTE_HINT", hintFingerprint: "hint-1" },
  binding, verification, inputs: [evidence("art-feed"), { kind: "DISCOVERY_ATTEMPT", attemptId: "att-1", recordId: "rec-1", recordedAt: "2026-09-24T18:01:00.000Z" }],
  ...over,
});

test("a promoted row carries its inputs, and an undecided row is carried byte-exactly", () => {
  const plan = planDerivedVersion([{ key: "energy", row: energy }], [promote("trustees", trustees)]);
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(plan.rows.map((r) => r.key), ["energy", "trustees"]);
  assert.equal(plan.rows[0]!.row, energy, "the very same row object, not a copy");
  assert.deepEqual(plan.promoted, ["trustees"]);
  assert.deepEqual(plan.carried, ["energy"]);
  assert.ok(plan.inputs.some((i) => i.kind === "VAULTED_EVIDENCE" && i.artifactId === "art-feed"));
});

test("a held row is never removed: absence, transport, robots and a challenge hold it by name", () => {
  const previous = [{ key: "trustees", row: trustees }, { key: "energy", row: energy }];
  for (const reason of ["WALK_ABSENT", "TRANSPORT_FAILED", "ROBOTS_REFUSED", "CHALLENGED"] as const) {
    const plan = planDerivedVersion(previous, [{ disposition: "HOLD", key: "trustees", reason, detail: "this pass", inputs: [] }]);
    assert.deepEqual(plan.rows.map((r) => r.key), ["energy", "trustees"], `${reason} keeps the row`);
    assert.deepEqual(plan.held, [{ key: "trustees", reason, detail: "this pass", carried: true }]);
    assert.deepEqual(plan.removed, []);
  }
  const fresh = planDerivedVersion([], [{ disposition: "HOLD", key: "chandler", reason: "NO_REVIEWED_BODY_IDENTITY", detail: "no crosswalk row", inputs: [] }]);
  assert.deepEqual(fresh.rows, [], "a held row that was never promoted is not invented");
  assert.equal(fresh.held[0]!.carried, false);
});

test("only the publisher withdraws a row, with vaulted evidence", () => {
  const gone: RouteWithdrawnByPublisher = { kind: "ROUTE_WITHDRAWN_BY_PUBLISHER", how: "ROUTE_GONE", httpStatus: 410, evidence: evidence("art-410") };
  const plan = planDerivedVersion([{ key: "trustees", row: trustees }], [{ disposition: "REMOVE", key: "trustees", removal: gone }]);
  assert.deepEqual(plan.rows, []);
  assert.deepEqual(plan.removed.map((r) => r.key), ["trustees"]);
  assert.ok(plan.inputs.some((i) => i.kind === "VAULTED_EVIDENCE" && i.artifactId === "art-410"), "the withdrawal's bytes are an input");

  const unknown = planDerivedVersion([], [{ disposition: "REMOVE", key: "never", removal: gone }]);
  assert.deepEqual(unknown.refusals.map((r) => r.code), ["REMOVE_OF_UNKNOWN_ROW"]);
});

test("a promotion without evidence, verified by another adapter, or producing nothing is refused by name", () => {
  const cases: [DerivedRowDecision<WiringRow>, string][] = [
    [promote("a", trustees, { inputs: [] }), "PROMOTE_WITHOUT_INPUTS"],
    [promote("b", trustees, { inputs: [{ kind: "COMMITTED_ROUTE_HINT", fingerprint: "hint-1" }] }), "PROMOTE_WITHOUT_VAULTED_EVIDENCE"],
    [promote("c", trustees, { verification: { ...verification, closureDigest: "d0" } }), "VERIFICATION_NOT_THIS_BINDING"],
    [promote("d", trustees, { verification: { ...verification, sittings: 0 } }), "VERIFICATION_PRODUCED_NOTHING"],
  ];
  for (const [decision, code] of cases) {
    const plan = planDerivedVersion([], [decision]);
    assert.deepEqual(plan.refusals.map((r) => r.code), [code]);
    assert.deepEqual(plan.rows, [], `${code} promotes nothing`);
  }
  const twice = planDerivedVersion([], [promote("x", trustees), promote("x", energy)]);
  assert.deepEqual(twice.refusals.map((r) => r.code), ["DUPLICATE_DECISION"]);
});

test("the same inputs give the same hash in any order, and the version is no fresher than its newest input", () => {
  const inputs: DerivedInputRef[] = [
    evidence("art-1", "2026-09-24T17:00:00.000Z"),
    { kind: "PROMOTED_VERSION", recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US:reader-registry-runtime-bindings", versionId: "cv-1", readModelSha256: "b".repeat(64), promotedAt: "2026-09-24T18:56:45.000Z" },
    { kind: "COMMITTED_ROUTE_HINT", fingerprint: "hint-1" },
  ];
  const a = derivedRetrieval(inputs);
  const b = derivedRetrieval([...inputs].reverse());
  assert.equal(a.rawHash, b.rawHash);
  assert.match(a.rawHash, /^[0-9a-f]{64}$/, "bare hex, the form SOURCE_AUTHENTICITY checks");
  assert.equal(a.retrievedAt, "2026-09-24T18:56:45.000Z");
  const changed = derivedRetrieval([...inputs.slice(0, 2), { kind: "COMMITTED_ROUTE_HINT", fingerprint: "hint-2" }]);
  assert.notEqual(changed.rawHash, a.rawHash, "a changed input changes the version");
  assert.equal(derivedRetrieval([{ kind: "CROSSWALK_VERSION", versionId: "x" }]).retrievedAt, null, "no timed input, no claimed time");
});
