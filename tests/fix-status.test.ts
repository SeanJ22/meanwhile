import test from "node:test";
import assert from "node:assert/strict";
import { proofFromStatistics, readFixProofBar, FIX_PROOF_PLACES } from "../lib/method/fix-status.ts";
import { methodStatistics, type FixMapRow } from "../lib/method/fix-map.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { withSetting } from "../lib/control-plane/settings.ts";

const at = "2026-10-05T12:00:00Z";
const row = (n: number, state: FixMapRow["state"] = "WORKS"): FixMapRow => ({ methodId: "calendar", placeId: `ocd-division/country:us/state:${n % 2 ? "aa" : "bb"}/county:${n}`,
  state, triedAt: at, updatedAt: at, attemptId: `attempt-${n}`, cause: state === "FAILS" ? "No calendar found" : null });

test("proof uses distinct places and spread, and a settings change immediately changes the measured label", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(i));
  assert.equal(proofFromStatistics(methodStatistics(rows)).status, "PROVEN");
  const raised = withSetting(defaultAdminConfig(at), { id: "bar", key: FIX_PROOF_PLACES, after: 6, at, why: "" });
  assert.equal(proofFromStatistics(methodStatistics(rows), readFixProofBar(raised)).status, "TESTING");
  assert.equal(proofFromStatistics(methodStatistics([row(0), row(0), row(0), row(0), row(0)])).status, "TESTING");
  assert.equal(proofFromStatistics(methodStatistics(rows.map(r => ({ ...r, placeId: r.placeId.replace(/state:[^/]+\/county:[^/]+/, "state:aa/county:one") + "/place:" + r.attemptId })))).status, "TESTING");
});

test("mostly working can prove out, failed places stay visible, and untried places do not inflate the denominator", () => {
  const rows = Array.from({ length: 42 }, (_, i) => row(i, i < 40 ? "WORKS" : "FAILS"));
  const measured = proofFromStatistics(methodStatistics([...rows, row(100, "UNTRIED")]));
  assert.equal(measured.status, "PROVEN");
  assert.equal(measured.successShare, 40 / 42);
  assert.equal(measured.tried - measured.works, 2);
  assert.equal(proofFromStatistics(methodStatistics([...Array.from({ length: 5 }, (_, i) => row(i)), row(5, "FAILS")])).status, "TESTING");
  assert.throws(() => methodStatistics([row(0), { ...row(1), methodId: "different" }]), /one method/);
});

test("a kind found in multiple states must work in multiple states; held geography supports other place-id formats", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...row(i), placeId: `place-${i}` }));
  const held = { ...methodStatistics(rows), districts: 2, states: 1 };
  assert.equal(proofFromStatistics(held).status, "PROVEN");
  assert.equal(proofFromStatistics(held, undefined, true, true).status, "TESTING");
  assert.equal(proofFromStatistics(methodStatistics(rows)).status, "TESTING", "missing geography does not establish spread");
});
