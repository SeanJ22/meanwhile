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
 * A derived version is recomputable from its inputs. Rows are promoted with inputs, attestation, adapter binding and
 * the reader adapter's own verification; held by name and never removed; removed only on
 * ROUTE_WITHDRAWN_BY_PUBLISHER.
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

test("a held row is never removed: absence, transport, an access control and a walk's pre-2026-09-25 robots skip hold it by name", () => {
  const previous = [{ key: "trustees", row: trustees }, { key: "energy", row: energy }];
  /* ROBOTS_REFUSED names only a route an older walk recorded; robots.txt holds nothing now. */
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

/**
 * A page returning "not found" is not the only reason to suspend or correct a connection; wrong attribution,
 * conflicting evidence, or a changed calendar also trigger review, and previously verified records survive temporary
 * outages.
 */
test("C16: a trigger suspends a promoted row, which stays marked until a later review restores it", () => {
  const previous = [{ key: "trustees", row: trustees }];
  const at = "2026-09-25T02:00:00.000Z";
  for (const trigger of ["ROUTE_GONE", "WRONG_ATTRIBUTION", "CONFLICTING_EVIDENCE", "CALENDAR_CHANGED", "CROSSWALK_WITHDRAWN"] as const) {
    const plan = planDerivedVersion(previous, [{ disposition: "SUSPEND", key: "trustees", trigger, detail: "seen this pass", at, evidence: [evidence("art-trigger")] }]);
    assert.deepEqual(plan.refusals, []);
    assert.equal(plan.rows.length, 1, `${trigger} keeps the row, so its verified records are preserved`);
    assert.equal(plan.rows[0]!.row, trustees);
    assert.deepEqual(plan.rows[0]!.suspension, { trigger, detail: "seen this pass", since: at, evidence: [evidence("art-trigger")] });
    assert.deepEqual(plan.suspended, [{ key: "trustees", trigger, since: at, newly: true }]);
    assert.ok(plan.inputs.some((i) => i.kind === "VAULTED_EVIDENCE" && i.artifactId === "art-trigger"), "the trigger's evidence is an input");
  }

  const suspendedBefore = planDerivedVersion(previous, [{ disposition: "SUSPEND", key: "trustees", trigger: "WRONG_ATTRIBUTION", detail: "d", at, evidence: [evidence("art-trigger")] }]).rows;
  const held = planDerivedVersion(suspendedBefore, [{ disposition: "HOLD", key: "trustees", reason: "TRANSPORT_FAILED", detail: "timeout", inputs: [] }]);
  assert.equal(held.rows[0]!.suspension?.trigger, "WRONG_ATTRIBUTION", "an outage neither restores nor removes a suspended row");
  assert.deepEqual(held.suspended, [{ key: "trustees", trigger: "WRONG_ATTRIBUTION", since: at, newly: false }]);
  const again = planDerivedVersion(suspendedBefore, [{ disposition: "SUSPEND", key: "trustees", trigger: "ROUTE_GONE", detail: "later", at: "2026-09-26T00:00:00.000Z", evidence: [evidence("art-later")] }]);
  assert.equal(again.rows[0]!.suspension?.since, at, "the first suspension stands, so the review it waits for does not move");

  const unreviewed = planDerivedVersion(suspendedBefore, [promote("trustees", trustees, { reviewedAt: "2026-09-24T23:00:00.000Z" })]);
  assert.deepEqual(unreviewed.refusals.map((r) => r.code), ["PROMOTE_OF_SUSPENDED_WITHOUT_REVIEW"]);
  assert.deepEqual(planDerivedVersion(suspendedBefore, [promote("trustees", trustees)]).refusals.map((r) => r.code), ["PROMOTE_OF_SUSPENDED_WITHOUT_REVIEW"]);
  const reviewed = planDerivedVersion(suspendedBefore, [promote("trustees", trustees, { reviewedAt: "2026-09-25T03:00:00.000Z" })]);
  assert.deepEqual(reviewed.refusals, []);
  assert.equal(reviewed.rows[0]!.suspension, undefined, "a review after the suspension restores the row");
  assert.deepEqual(reviewed.suspended, []);

  assert.deepEqual(planDerivedVersion([], [{ disposition: "SUSPEND", key: "new", trigger: "ROUTE_GONE", detail: "d", at, evidence: [evidence("x")] }]).refusals.map((r) => r.code), ["SUSPEND_OF_UNKNOWN_ROW"]);
  assert.deepEqual(planDerivedVersion(previous, [{ disposition: "SUSPEND", key: "trustees", trigger: "ROUTE_GONE", detail: "d", at, evidence: [] }]).refusals.map((r) => r.code), ["SUSPEND_WITHOUT_EVIDENCE"]);
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
