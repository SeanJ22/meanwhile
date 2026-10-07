/** GitHub Actions certifies software, not runtime events. */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const BUILD_PATH = join(ROOT, ".github", "workflows", "build-check.yml");
const POST_DEPLOY_PATH = join(ROOT, ".github", "workflows", "post-deploy-integrity.yml");

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
}

interface Workflow {
  readonly on: Record<string, unknown>;
  readonly jobs: Record<string, { readonly name: string; readonly steps: readonly Step[] }>;
}

const workflow = (path: string): Workflow => parse(readFileSync(path, "utf8")) as Workflow;

test("Build Check has no transitional path-cost or OPS_ONLY tier", () => {
  const source = readFileSync(BUILD_PATH, "utf8");
  assert.doesNotMatch(source, /ci-cost|classifyCommitCost|OPS_ONLY|CHEAP_PATH_PROOFS|no-cheap|Cheap attestation/);
  assert.equal(existsSync(join(ROOT, "scripts", "ci-cost.mjs")), false);
  assert.doesNotMatch(readFileSync(join(ROOT, "lib", "ops", "deploy-paths.ts"), "utf8"), /classifyCommitCost|OPS_ONLY_ARTIFACTS|CHEAP_PATH_PROOFS/);
});

test("admission runs preflight and defaults non-draft work to full tests", () => {
  for (const [jobId, job] of Object.entries(workflow(BUILD_PATH).jobs).filter(([id]) => id === "admission")) {
    const tier = job.steps.find((step) => step.id === "tier");
    const preflight = job.steps.find((step) => step.id === "preflight");
    assert.ok(tier && preflight, `${jobId} lost the tier or preflight step`);
    assert.equal(preflight.if, undefined, `${jobId} suppresses deterministic preflight`);
    assert.match(tier.run ?? "", /steps\.pr_tier\.outputs\.tier.*full/);
    assert.match(tier.run ?? "", /else[\s\S]+echo "expensive=yes"/, `${jobId} does not default to the full tier`);
    assert.doesNotMatch(tier.run ?? "", /path|cost|cheap/i, `${jobId} retained a path-cost decision`);
  }
});

test("push/main/manual/scheduled triggers remain and no workflow hides behind a path filter", () => {
  const build = workflow(BUILD_PATH);
  assert.deepEqual(build.on.push, { branches: ["main"] });
  assert.ok("workflow_dispatch" in build.on);
  assert.deepEqual(build.on.schedule, [{ cron: "17 9 * * *" }]);
  for (const path of [BUILD_PATH, POST_DEPLOY_PATH]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /^\s*paths(?:-ignore)?:/m);
  }
});

test("post-deploy classifies complete software observation after installing its canonical reader", () => {
  const source = readFileSync(POST_DEPLOY_PATH, "utf8");
  const classifyAt = source.indexOf("node scripts/deploy-classify.mjs");
  const installAt = source.indexOf("corepack pnpm install --frozen-lockfile");
  assert.ok(installAt > 0 && classifyAt > installAt);
  assert.match(source, /WTP_CONTROL_PLANE_DATABASE_URL_READONLY/);
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /filter: blob:none/);
  assert.doesNotMatch(source, /scripts\/ci-cost|classifyCommitCost|OPS_ONLY/);
  assert.match(source, /steps\.deploy\.outputs\.deploy != 'cancel'/);
  assert.match(source, /contents:\s*read/);
  assert.doesNotMatch(source.replace(/^\s*#.*$/gm, ""), /contents:\s*write|git\s+(?:add|commit|push)|push-main\.mjs/);
});
