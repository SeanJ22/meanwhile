import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

import { classifyPullRequestCiTier } from "../lib/ops/pull-request-ci-tier.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "build-check.yml");

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, string>;
}

interface Job {
  readonly name: string;
  readonly if?: string;
  readonly needs?: string[];
  readonly steps: Step[];
}

interface BuildCheck {
  readonly on: {
    readonly pull_request: { readonly types: string[] };
    readonly push: { readonly branches: string[] };
    readonly workflow_dispatch: unknown;
  };
  readonly permissions: Record<string, string>;
  readonly jobs: Record<string, Job>;
}

function workflow(): BuildCheck {
  return parse(readFileSync(WORKFLOW, "utf8")) as BuildCheck;
}

const label = (step: Step): string => step.name ?? step.uses ?? "(unnamed)";

function named(job: Job, name: string): Step {
  const step = job.steps.find((candidate) => label(candidate) === name);
  assert.ok(step, `${name} is missing from Build Check`);
  return step;
}

test("draft/full classifier is fail-closed for the complete pull-request event matrix", () => {
  const rows = [
    { what: "draft opened", eventName: "pull_request", action: "opened", draft: true, tier: "draft" },
    { what: "draft synchronize", eventName: "pull_request", action: "synchronize", draft: true, tier: "draft" },
    { what: "draft reopened", eventName: "pull_request", action: "reopened", draft: true, tier: "draft" },
    { what: "ready opened", eventName: "pull_request", action: "opened", draft: false, tier: "full" },
    { what: "ready synchronize", eventName: "pull_request", action: "synchronize", draft: false, tier: "full" },
    { what: "ready reopened", eventName: "pull_request", action: "reopened", draft: false, tier: "full" },
    { what: "ready_for_review", eventName: "pull_request", action: "ready_for_review", draft: false, tier: "full" },
    { what: "ready_for_review with stale draft bit", eventName: "pull_request", action: "ready_for_review", draft: true, tier: "full" },
    { what: "unknown PR action", eventName: "pull_request", action: "edited", draft: true, tier: "full" },
    { what: "missing PR state", eventName: "pull_request", action: "synchronize", draft: null, tier: "full" },
    { what: "push to main", eventName: "push", action: null, draft: null, tier: "full" },
    { what: "manual release proof", eventName: "workflow_dispatch", action: null, draft: null, tier: "full" },
  ] as const;

  for (const row of rows) {
    assert.equal(classifyPullRequestCiTier(row).tier, row.tier, row.what);
  }
});

test("ready_for_review is an explicit trigger and the existing shipping triggers remain", () => {
  const buildCheck = workflow();
  assert.deepEqual(buildCheck.on.pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review"]);
  assert.deepEqual(buildCheck.on.push.branches, ["main"]);
  assert.ok(buildCheck.on.workflow_dispatch !== undefined, "manual shipping certification disappeared");
});

test("admission alone classifies draft/full before preflight", () => {
  for (const [jobId, job] of Object.entries(workflow().jobs).filter(([id]) => id === "admission")) {
    assert.equal(job.if, undefined, `${jobId} is job-gated, so a required context can disappear`);
    const classifier = job.steps.find((step) => step.id === "pr_tier");
    const preflight = job.steps.find((step) => step.id === "preflight");
    const tier = job.steps.find((step) => step.id === "tier");
    assert.ok(classifier && preflight && tier, `${jobId} lost classifier, preflight, or tier`);
    assert.ok(job.steps.indexOf(classifier) < job.steps.indexOf(preflight), `${jobId} classifies after preflight`);
    assert.equal(classifier.run, "node scripts/pr-ci-tier.mjs");
    assert.equal(classifier.if, "github.event_name == 'pull_request'", `${jobId} changed push/main execution`);
    assert.deepEqual(classifier.env, {
      WTP_EVENT_NAME: "${{ github.event_name }}",
      WTP_EVENT_ACTION: "${{ github.event.action }}",
      WTP_PR_DRAFT: "${{ github.event.pull_request.draft }}",
    });
    assert.match(preflight.if ?? "", /github\.event_name == 'pull_request'/, `${jobId} can reuse or cheap-skip the draft/ready preflight`);
    assert.match(tier.run ?? "", /steps\.pr_tier\.outputs\.tier/);
    assert.match(tier.run ?? "", /expensive=draft/);
    const fullAt = (tier.run ?? "").indexOf('steps.pr_tier.outputs.tier }}" = "full"');
    const certifiedAt = (tier.run ?? "").indexOf('steps.certified.outputs.certified }}" = "yes"');
    assert.ok(fullAt >= 0 && fullAt < certifiedAt, `${jobId} can reuse draft contexts after a PR becomes ready`);
    assert.doesNotMatch(tier.run ?? "", /steps\.cost|no-cheap/, `${jobId} retained the obsolete runtime-path cost tier`);
  }
});

test("draft runs install and every named deterministic gate", () => {
  const gates = workflow().jobs.verify;
  const install = named(gates, "Install");
  assert.match(install.if ?? "", /tier == 'draft'/, "the gates install no longer admits the draft tier");
  assert.match(install.if ?? "", /tier == 'yes'/, "the gates install no longer admits the full tier");
  assert.doesNotMatch(install.if ?? "", /no-preflight/, "a refused preflight still buys the dependency install");

  const deterministic = [
    "Lint",
    "Types (fresh checkout, no build)",
    "Governance ledger and its generated views",
    "Orchestration plans (RULING 190)",
    "Method knowledge store",
    "Canonical state holdings and residual paths",
    "Generated state manifests against committed observations",
  ];
  for (const name of deterministic) {
    const condition = named(gates, name).if ?? "";
    assert.match(condition, /always\(\)/, `${name} no longer reports after a sibling deterministic gate fails`);
    assert.match(condition, /tier == 'draft'/, `${name} is missing from draft certification`);
    assert.match(condition, /tier == 'yes'/, `${name} is missing from full certification`);
  }
});

test("draft cannot buy builds, browsers, the full suite, or shipping-only gates", () => {
  const buildCheck = workflow();
  const fullOnly = [
    "Build (the command netlify.toml gives Netlify)",
    "Bundle-scanning checks (need the build above)",
    "Trace census",
    "Keep the trace list",
    "Frozen holdings base for extraction proofs",
    "Reader closure proof ancestry",
    "Install the browser the suite needs",
    "Prove the browser is actually there",
    "Test",
    "Schema shipping gate (only when the schema contract moved)",
    "Release freeze (refuses a release on a DEGRADED production reading)",
  ];

  for (const name of fullOnly) {
    const step = Object.values(buildCheck.jobs).flatMap((job) => job.steps).find((candidate) => label(candidate) === name);
    assert.ok(step, `${name} disappeared rather than remaining a full-certification gate`);
    assert.match(step.if ?? "", /tier == 'yes'/, `${name} is no longer confined to full certification`);
    assert.doesNotMatch(step.if ?? "", /tier == 'draft'/, `${name} runs on draft pull requests`);
  }

  const browserCache = buildCheck.jobs.test.steps.find((step) => step.with?.path === "~/.cache/ms-playwright");
  assert.ok(browserCache, "the Playwright cache step disappeared");
  assert.match(browserCache.if ?? "", /tier == 'yes'/);
  assert.doesNotMatch(browserCache.if ?? "", /tier == 'draft'/);
});

test("required contexts, read-only permissions, and the exact-head rerun stay intact", () => {
  const buildCheck = workflow();
  const produced = [buildCheck.jobs.gates, buildCheck.jobs.build].flatMap((job) =>
    job.name.includes("${{ matrix.mode }}")
      ? ["standalone", "default"].map((mode) => job.name.replace("${{ matrix.mode }}", mode))
      : [job.name],
  );
  assert.deepEqual(produced.sort(), [...REQUIRED_CONTEXTS].sort());
  assert.equal(buildCheck.permissions.contents, "read");
  assert.equal(buildCheck.permissions.checks, "read");

  const ready = classifyPullRequestCiTier({
    eventName: "pull_request",
    action: "ready_for_review",
    draft: false,
  });
  assert.equal(ready.tier, "full", "the exact unchanged head could reuse draft certification after becoming ready");

  for (const [jobId, job] of Object.entries(buildCheck.jobs).filter(([id]) => id === "admission")) {
    const decision = named(job, "Decide whether the expensive tier runs").run ?? "";
    const fullAt = decision.indexOf('steps.pr_tier.outputs.tier }}" = "full"');
    const reuseAt = decision.indexOf('steps.certified.outputs.certified }}" = "yes"');
    assert.ok(fullAt >= 0 && reuseAt >= 0 && fullAt < reuseAt, `${jobId} reuses draft certification instead of fully certifying ready_for_review`);
  }
});
