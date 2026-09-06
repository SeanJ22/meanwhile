import assert from "node:assert/strict";
import test from "node:test";
import { softwareReleaseManifest } from "../lib/review/release-manifest.ts";

const identity = { sha: "a".repeat(40), branch: "test", context: "branch-deploy", deployId: "b".repeat(24), builtAt: "2026-09-06T00:00:00.000Z" };
const environment = {
  NODE_ENV: "production", WTP_BUILD_CONTEXT: "branch-deploy",
  DATABASE_URL: "postgres://owner:planted-secret@ep-stage-123.example/neondb",
  WTP_CONTROL_PLANE_DATABASE_URL: "postgres://owner:planted-secret@ep-cp-stage-123.example/neondb",
  WTP_BUILD_PRODUCTION_DATABASE_HOST: "ep-live-123.example",
  WTP_BUILD_STAGING_DATABASE_HOST: "ep-stage-123.example",
  WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST: "ep-cp-live-123.example",
  WTP_BUILD_STAGING_CONTROL_PLANE_HOST: "ep-cp-stage-123.example",
};
const now = "2026-09-06T00:00:01.000Z";

test("software manifest names the exact staging build and five review sections without civic approvals or secrets", () => {
  const manifest = softwareReleaseManifest(identity, environment, now);
  assert.equal(manifest.sha, identity.sha);
  assert.equal(manifest.stagingBoundary, "STABLE");
  assert.equal(manifest.prompt3Status, "STAGING_READY_FOR_OWNER_REVIEW");
  assert.equal(manifest.reviewState, "READY_FOR_REVIEW");
  assert.equal(manifest.prompt4MayBeginInSeparateSession, true);
  assert.equal(manifest.reviewSections.length, 5);
  assert.deepEqual(manifest.raisedState.candidates.map(row => row.id), ["A_SOFT_LIFT", "B_MATERIAL_LIFT", "C_DEEP_LIFT"]);
  assert.equal(manifest.raisedState.status, "AWAITING_OWNER_CHOICE");
  assert.deepEqual(manifest.lumen.examples.map(row => row.id), ["district", "school", "body", "meeting", "official"]);
  for (const example of manifest.lumen.examples) {
    assert.equal(new URL(example.dark).searchParams.get("theme"), "dark");
    assert.equal(new URL(example.light).searchParams.get("theme"), "light");
  }
  assert.doesNotMatch(JSON.stringify(manifest), /planted-secret|postgres:|DATABASE_URL|civicFindings|ownerApproval|adminDecisions/);
});

test("software manifest withdraws the boundary if either mutable store points at production or is unmeasured", () => {
  for (const variable of ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL"] as const) {
    for (const value of ["postgres://owner:secret@ep-live-123.example/neondb", "postgres://owner:secret@ep-cp-live-123.example/neondb", "", "malformed"]) {
      const manifest = softwareReleaseManifest(identity, { ...environment, [variable]: value }, now);
      assert.equal(manifest.stagingBoundary, "INVALID");
      assert.equal(manifest.prompt4MayBeginInSeparateSession, false);
      assert.equal(manifest.boundaryReason, "MUTABLE_RESOURCE_ISOLATION_UNPROVEN");
    }
  }
});

test("software manifest cannot call an unknown build or production deployment a stable staging boundary", () => {
  for (const change of [{ sha: "unknown" }, { branch: "main" }, { context: "production" }, { deployId: "unknown" }]) {
    const manifest = softwareReleaseManifest({ ...identity, ...change }, environment, now);
    assert.equal(manifest.stagingBoundary, "INVALID");
    assert.equal(manifest.boundaryReason, "BUILD_IDENTITY_UNPROVEN");
  }
});
