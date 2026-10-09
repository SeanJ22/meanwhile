import assert from "node:assert/strict";
import test from "node:test";
import { integrityCheckoutIssue } from "../lib/ops/production-integrity.ts";

test("integrity binds the clean checked tree to the receipt's exact commit", () => {
  const sha = "a".repeat(40);
  assert.equal(integrityCheckoutIssue(sha, sha, ""), null);
  assert.ok(integrityCheckoutIssue(sha, "b".repeat(40), ""));
  assert.ok(integrityCheckoutIssue(sha, sha, " M lib/db/migrations/0010.sql"));
  assert.ok(integrityCheckoutIssue(sha, sha, null));
});
import { NEVER_CHECKED, assessIntegrity, sameCommit, type IntegrityRecord } from "../lib/ops/production-integrity.ts";
import { validIntegrityRecord } from "../lib/ops/production-integrity-data-plane.ts";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HELD: IntegrityRecord = {
  formatVersion: 1,
  deployedSha: SHA_A,
  mainSha: SHA_A,
  observed: "HELD",
  failureClass: null,
  detail: "HOLDS — 23 of 23 committed migration(s) applied",
  observedAt: "2026-08-28T12:00:00.000Z",
  moment: "post-deploy",
  gateExit: 0,
};

const REFUSED: IntegrityRecord = {
  ...HELD,
  observed: "REFUSED",
  failureClass: "MIGRATION_NOT_APPLIED",
  detail: "REFUSED — 2 EXPAND migration(s) are committed and NOT applied to production",
  gateExit: 1,
};

const NO_CREDENTIAL: IntegrityRecord = {
  ...HELD,
  observed: "COULD_NOT_TELL",
  failureClass: "CREDENTIAL_ABSENT",
  detail: "db:gate: COULD NOT TELL — WTP_PRODUCTION_DATABASE_URL_READONLY is not set",
  gateExit: 2,
};

test("NC1: GitHub green plus a red post-deploy reading is DEGRADED, never CURRENT", () => {
  const a = assessIntegrity(REFUSED, SHA_A);
  assert.equal(a.state, "DEGRADED");
  assert.equal(a.failureClass, "MIGRATION_NOT_APPLIED");
  assert.match(a.reason, /REFUSED/);

  // And it is not rescued by asking about the very commit it was taken against.
  assert.notEqual(assessIntegrity(REFUSED, null).state, "CURRENT");
});

test("NC5: an absent credential is CREDENTIAL_MISSING and never CURRENT", () => {
  const a = assessIntegrity(NO_CREDENTIAL, SHA_A);
  assert.equal(a.state, "CREDENTIAL_MISSING");
  assert.notEqual(a.state, "CURRENT");
  assert.match(a.reason, /not a passing check/);

});

test("NC5b: a never-checked repository is UNKNOWN, and UNKNOWN is not a pass", () => {
  assert.equal(NEVER_CHECKED.observed, "COULD_NOT_TELL");
  const a = assessIntegrity(NEVER_CHECKED, SHA_A);
  assert.equal(a.state, "UNKNOWN");
});

test("NC7: a green reading about an earlier SHA is STALE_HEALTHY, never CURRENT", () => {
  const a = assessIntegrity(HELD, SHA_B);
  assert.equal(a.state, "STALE_HEALTHY");
  assert.equal(a.observedSha, SHA_A);
  assert.equal(a.aboutSha, SHA_B);
  assert.match(a.reason, /not an answer about this one/);

});

test("NC7b: HELD with no recorded commit holds for nothing", () => {
  const a = assessIntegrity({ ...HELD, deployedSha: null }, SHA_A);
  assert.equal(a.state, "UNKNOWN");
  assert.match(a.reason, /nothing it can be said to hold FOR/);
});

test("an abbreviated recorded SHA and the full served one are the SAME commit", () => {
  // An abbreviated recorded sha against the full served sha must not read as PRODUCTION_MOVED.
  const abbreviated = SHA_A.slice(0, 8);
  assert.equal(sameCommit(abbreviated, SHA_A), true);
  assert.equal(sameCommit(SHA_A, SHA_B), false);
  assert.equal(sameCommit("713252", SHA_A), false, "below git's own abbreviation floor, refuse to match");
  assert.equal(sameCommit(null, SHA_A), false, "an absent sha matches nothing");

});

test("the canonical durable record validator accepts exact readings and rejects vacuous ones", () => {
  assert.equal(validIntegrityRecord(HELD), true);
  assert.equal(validIntegrityRecord(REFUSED), true);
  assert.equal(validIntegrityRecord({ ...HELD, deployedSha: "not-a-sha" }), false);
  assert.equal(validIntegrityRecord({ ...HELD, observedAt: null }), true, "NEVER_CHECKED remains a valid in-memory state");
});

test("an unparseable or future-shaped record reads as UNKNOWN rather than throwing or passing", () => {
  const future = { ...HELD, formatVersion: 99 } as unknown as IntegrityRecord;
  assert.equal(validIntegrityRecord(future), false);
  assert.equal(assessIntegrity(NEVER_CHECKED, SHA_A).state, "UNKNOWN");
});
