import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  PRODUCTION_INTEGRITY_LOG_KEY,
  SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
  type SoftwareReleaseReviewRecord,
} from "../lib/control-plane/software-release-review.ts";
import {
  appendProductionIntegrity,
  productionIntegrityHistory,
  readLatestProductionIntegrity,
  validIntegrityRecord,
} from "../lib/ops/production-integrity-data-plane.ts";
import {
  NEVER_CHECKED,
  evaluateReleaseFreeze,
  type IntegrityRecord,
} from "../lib/ops/production-integrity.ts";

const ROOT = join(import.meta.dirname, "..");
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const HELD: IntegrityRecord = {
  formatVersion: 1,
  deployedSha: SHA,
  mainSha: SHA,
  observed: "HELD",
  failureClass: null,
  detail: "HOLDS — exact post-deploy schema gate passed",
  observedAt: "2026-09-08T12:00:00.000Z",
  moment: "post-deploy",
  gateExit: 0,
};

const REFUSED: IntegrityRecord = {
  ...HELD,
  observed: "REFUSED",
  failureClass: "MIGRATION_NOT_APPLIED",
  detail: "REFUSED — one committed migration is not applied",
  observedAt: "2026-09-08T13:00:00.000Z",
  gateExit: 1,
};

test("post-deploy outcomes append to the existing release log and read back exactly", async () => {
  const repos = createMemoryRepositories();
  const heldReceipt = await appendProductionIntegrity(repos.softwareReleaseReviews, HELD, {
    runId: "run-1",
  });
  const held = await readLatestProductionIntegrity(repos.softwareReleaseReviews);
  assert.equal(held.kind, "HELD");
  assert.equal(held.kind === "HELD" ? held.receipt.id : null, heldReceipt.id);
  assert.deepEqual(held.record, HELD);

  const refusedReceipt = await appendProductionIntegrity(repos.softwareReleaseReviews, REFUSED, {
    runId: "run-2",
  });
  const latest = await readLatestProductionIntegrity(repos.softwareReleaseReviews);
  assert.equal(latest.kind, "HELD");
  assert.equal(latest.kind === "HELD" ? latest.receipt.id : null, refusedReceipt.id);
  assert.deepEqual(latest.record, REFUSED, "a refusal is durable and supersedes only by append order");

  const history = productionIntegrityHistory(await repos.softwareReleaseReviews.readAll());
  assert.deepEqual(history.map((row) => row.sourceRunId), ["run-2", "run-1"]);
  assert.deepEqual(await repos.softwareReleaseReviews.keys(), [PRODUCTION_INTEGRITY_LOG_KEY]);
});

test("release-review rows cannot contaminate the fixed post-deploy partition", async () => {
  const repos = createMemoryRepositories();
  const review: SoftwareReleaseReviewRecord = {
    formatVersion: SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
    id: `${SHA}:APPROVE:map:2026-09-08T11:00:00.000Z`,
    stagingSha: SHA,
    deployId: "deploy-1",
    section: "map",
    decision: "APPROVE",
    raisedStateChoice: null,
    feedback: null,
    actor: "session:owner",
    composedFrom: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    manifest: { prompt3Status: null, reviewState: null, stagingBoundary: null, reportedAt: null },
  };
  await repos.softwareReleaseReviews.append(SHA, review.id, review, review.createdAt);
  assert.equal((await readLatestProductionIntegrity(repos.softwareReleaseReviews)).kind, "NOT_RECORDED");
  await appendProductionIntegrity(repos.softwareReleaseReviews, HELD);
  assert.equal((await readLatestProductionIntegrity(repos.softwareReleaseReviews)).kind, "HELD");
});

test("missing, unreachable, and malformed authority fail closed without a tracked fallback", async () => {
  const empty = createMemoryRepositories();
  const missing = await readLatestProductionIntegrity(empty.softwareReleaseReviews);
  assert.equal(missing.kind, "NOT_RECORDED");
  assert.deepEqual(missing.record.deployedSha, null);

  const unreachable = await readLatestProductionIntegrity({
    read: async () => {
      throw new Error("store down");
    },
  });
  assert.equal(unreachable.kind, "STORE_UNREACHABLE");
  assert.equal(unreachable.record.observed, "COULD_NOT_TELL");

  const malformed = createMemoryRepositories();
  const bad: SoftwareReleaseReviewRecord = {
    ...({} as SoftwareReleaseReviewRecord),
    id: "bad",
    decision: "POST_DEPLOY_INTEGRITY",
  };
  await malformed.softwareReleaseReviews.append(PRODUCTION_INTEGRITY_LOG_KEY, "bad", bad, HELD.observedAt!);
  assert.equal((await readLatestProductionIntegrity(malformed.softwareReleaseReviews)).kind, "STORE_UNREACHABLE");
  assert.equal(validIntegrityRecord({ ...HELD, observed: "UNKNOWN" }), false);
});

test("the durable outcome preserves exact-head and fail-closed release-freeze semantics", () => {
  const healthy = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    changedPaths: ["lib/db/schema.ts"],
    production: {
      servedSha: SHA,
      how: "GET /api/build",
      readingAgeHours: 1,
      maxAgeHours: 24,
    },
  });
  assert.equal(healthy.frozen, false);

  const refused = evaluateReleaseFreeze({
    record: REFUSED,
    candidateSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    changedPaths: ["app/page.tsx"],
    production: { servedSha: SHA, how: "GET /api/build", readingAgeHours: 0, maxAgeHours: 24 },
  });
  assert.equal(refused.frozen, true);
  assert.equal(refused.state, "DEGRADED");

  const unreachable = evaluateReleaseFreeze({
    record: NEVER_CHECKED,
    candidateSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    changedPaths: ["lib/db/schema.ts"],
    production: { servedSha: SHA, how: "GET /api/build", readingAgeHours: null, maxAgeHours: 24 },
  });
  assert.equal(unreachable.frozen, true);
});

test("the executable workflow has no Git mutation or deploy/build feedback loop", () => {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "post-deploy-integrity.yml"), "utf8");
  const executable = workflow.replace(/^\s*#.*$/gm, "");
  assert.match(executable, /\n\s*push:\s*\n\s*branches: \[main\]/, "release observation still follows main software pushes");
  assert.match(executable, /workflow_dispatch:/, "an exact release can still be rechecked manually");
  assert.match(executable, /^\s*contents:\s*read\s*$/m);
  assert.doesNotMatch(executable, /^\s*contents:\s*write\s*$/m);
  assert.doesNotMatch(executable, /push-main\.mjs|git\s+(?:add|commit|push)|status:ledger/);
  assert.match(executable, /--expect=\$\{\{ inputs\.sha \|\| github\.sha \}\}/);
  assert.match(executable, /WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL/);
  assert.match(executable, /WTP_CONTROL_PLANE_DATABASE_URL_READONLY/);

  const observer = readFileSync(join(ROOT, "scripts", "post-deploy-observer.mts"), "utf8");
  assert.match(observer, /await observationScope\(ROOT, expected,/);
  assert.match(observer, /force: process\.env\.GITHUB_EVENT_NAME !== "push"/);
  assert.match(observer, /expectedSha: scope\.sha/);
  assert.match(observer, /scope\.action === "observe-served" \? \{\s*documentaryRange:/);
  assert.match(observer, /const sha = result\.servedSha as string/);
  assert.match(observer, /`--sha=\$\{sha\}`/);

  const recorder = readFileSync(join(ROOT, "scripts", "production-integrity.mts"), "utf8");
  assert.match(recorder, /appendProductionIntegrity/);
  assert.match(recorder, /readLatestProductionIntegrity/);
  assert.match(recorder, /TRACKED_PRODUCTION_INTEGRITY_WRITE_RETIRED/);

  const freeze = readFileSync(join(ROOT, "scripts", "release-freeze-gate.mts"), "utf8");
  assert.match(freeze, /import \{ readIntegrityAuthority \} from "\.\/production-integrity-authority\.mts"/);
  assert.match(freeze, /await readIntegrityAuthority\(\)/);
  const authority = readFileSync(join(ROOT, "scripts", "production-integrity-authority.mts"), "utf8");
  assert.match(authority, /readLatestProductionIntegrity/);
  assert.match(authority, /CONTROL_PLANE_INTEGRITY_READ_URL_VAR/);
  assert.match(authority, /skipBootstrap: true/);
  assert.doesNotMatch(authority, /appendProductionIntegrity|CONTROL_PLANE_INTEGRITY_WRITE_URL_VAR/);
  assert.match(
    readFileSync(join(ROOT, "lib", "ops", "production-integrity-data-plane.ts"), "utf8"),
    /WTP_CONTROL_PLANE_DATABASE_URL_READONLY/,
  );
  assert.doesNotMatch(freeze, /readRecord\(/, "the release gate cannot reopen tracked runtime truth");

  assert.equal(existsSync(join(ROOT, "scripts", "push-main.mjs")), false);
  assert.equal(existsSync(join(ROOT, "lib", "ops", "push-allowlist.ts")), false);
  const buildCheck = readFileSync(join(ROOT, ".github", "workflows", "build-check.yml"), "utf8");
  assert.doesNotMatch(buildCheck, /ci-cost|OPS_ONLY|no-cheap/);
  assert.match(workflow, /node scripts\/deploy-classify\.mjs/);
});
