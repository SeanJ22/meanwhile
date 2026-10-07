import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

import { classifyPullRequestCiTier } from "../lib/ops/pull-request-ci-tier.ts";
import { REQUIRED_CONTEXTS, contextsProducedByWorkflow } from "../lib/ops/required-checks.ts";

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
    readonly schedule: { readonly cron: string }[];
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

test("draft/waiting/full classifier is fail-closed for the complete pull-request event matrix", () => {
  const rows = [
    { what: "draft opened", eventName: "pull_request", action: "opened", draft: true, tier: "draft" },
    { what: "draft synchronize", eventName: "pull_request", action: "synchronize", draft: true, tier: "draft" },
    { what: "draft reopened", eventName: "pull_request", action: "reopened", draft: true, tier: "draft" },
    { what: "draft labeled", eventName: "pull_request", action: "labeled", draft: true, labels: ["run-full-ci"], tier: "draft" },
    { what: "ready opened, auto-merge off", eventName: "pull_request", action: "opened", draft: false, tier: "waiting" },
    { what: "ready synchronize, auto-merge off", eventName: "pull_request", action: "synchronize", draft: false, autoMerge: false, tier: "waiting" },
    { what: "ready_for_review, auto-merge off", eventName: "pull_request", action: "ready_for_review", draft: false, tier: "waiting" },
    { what: "ready_for_review with stale draft bit", eventName: "pull_request", action: "ready_for_review", draft: true, tier: "waiting" },
    { what: "auto-merge turned on", eventName: "pull_request", action: "auto_merge_enabled", draft: false, autoMerge: true, tier: "full" },
    { what: "push to a PR with auto-merge on", eventName: "pull_request", action: "synchronize", draft: false, autoMerge: true, tier: "full" },
    { what: "run-full-ci label", eventName: "pull_request", action: "labeled", draft: false, labels: ["run-full-ci"], tier: "full" },
    { what: "engineer adapter", eventName: "pull_request", action: "synchronize", draft: false, labels: ["engineer-adapter"], tier: "full" },
    { what: "other label only", eventName: "pull_request", action: "labeled", draft: false, labels: ["docs"], tier: "waiting" },
    { what: "unknown PR action", eventName: "pull_request", action: "edited", draft: true, tier: "full" },
    { what: "missing PR state", eventName: "pull_request", action: "synchronize", draft: null, tier: "full" },
    { what: "push to main", eventName: "push", action: null, draft: null, tier: "full" },
    { what: "manual release proof", eventName: "workflow_dispatch", action: null, draft: null, tier: "full" },
    { what: "scheduled certification once a day", eventName: "schedule", action: null, draft: null, tier: "full" },
  ] as const;

  for (const row of rows) {
    assert.equal(classifyPullRequestCiTier(row).tier, row.tier, row.what);
  }
});

test("ready_for_review is an explicit trigger and the existing shipping triggers remain", () => {
  const buildCheck = workflow();
  assert.deepEqual(buildCheck.on.pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review", "labeled", "auto_merge_enabled"]);
  assert.deepEqual(buildCheck.on.push.branches, ["main"]);
  assert.ok(buildCheck.on.workflow_dispatch !== undefined, "manual shipping certification disappeared");
  assert.deepEqual(buildCheck.on.schedule, [{ cron: "17 9 * * *" }], "the daily full run on main is the safety net for affected-only PR tests");
});

test("a scheduled run is the full tier: no classifier, preflight, then yes", () => {
  const admission = workflow().jobs.admission;
  const decision = named(admission, "Decide whether the expensive tier runs").run ?? "";
  // Only a push selects main; every other non-pull-request event, the schedule
  // included, falls through to the full tier.
  assert.doesNotMatch(decision, /schedule/);
  assert.match(decision, /"\$\{\{ github\.event_name \}\}" = "push" \]; then\s+echo "expensive=main"/);
  assert.match(decision, /else\s+echo "expensive=yes"/);
  assert.equal(classifyPullRequestCiTier({ eventName: "schedule" }).tier, "full");
  const select = named(admission, "Select the tests this change can reach");
  assert.equal(select.if, "always() && steps.tier.outputs.expensive == 'yes'", "only the full tier plans tests; main runs none");
});

test("admission alone classifies draft/full before preflight", () => {
  for (const [jobId, job] of Object.entries(workflow().jobs).filter(([id]) => id === "admission")) {
    assert.equal(job.if, "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)", `${jobId} must skip drafts and run on every other event`);
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
      WTP_PR_AUTO_MERGE: "${{ github.event.pull_request.auto_merge != null }}",
      WTP_PR_LABELS: "${{ toJSON(github.event.pull_request.labels.*.name) }}",
    });
    assert.equal(preflight.if, undefined, `${jobId} suppresses deterministic preflight`);
    assert.match(tier.run ?? "", /steps\.pr_tier\.outputs\.tier/);
    assert.match(tier.run ?? "", /expensive=draft/);
    const fullAt = (tier.run ?? "").indexOf('steps.pr_tier.outputs.tier }}" = "full"');
    assert.ok(fullAt >= 0, `${jobId} lost the full tier`);
    assert.doesNotMatch(tier.run ?? "", /steps\.cost|no-cheap/, `${jobId} retained the obsolete runtime-path cost tier`);
  }
});

test("draft runs install, lint and types", () => {
  const gates = workflow().jobs.verify;
  const install = named(gates, "Install");
  for (const tier of ["draft", "waiting", "yes"]) {
    assert.match(install.if ?? "", new RegExp(`tier == '${tier}'`), `the verify install no longer admits the ${tier} tier`);
  }
  assert.doesNotMatch(install.if ?? "", /no-preflight|main/, "a refused preflight or a push to main still buys the verify install");
  assert.equal(gates.steps.filter((step) => step.run === "corepack pnpm install --frozen-lockfile").length, 1, "verify installs once for every check");

  for (const name of ["Lint", "Types (fresh checkout, no build)"]) {
    const condition = named(gates, name).if ?? "";
    assert.match(condition, /always()/, `${name} no longer reports after a sibling deterministic gate fails`);
    assert.match(condition, /tier == 'draft'/, `${name} is missing from draft certification`);
    assert.match(condition, /tier == 'yes'/, `${name} is missing from full certification`);
  }
});

test("draft cannot buy builds, browsers, the full suite, or shipping-only gates", () => {
  const buildCheck = workflow();
  const fullOnly = [
    "Build (the command netlify.toml gives Netlify)",
    "Bundle-scanning checks (need the build above)",
    "Fetch the frozen import commit a test reads",
    "Install the browser the suite needs",
    "Prove the browser is actually there",
    "Test",
    "Schema shipping gate (only when the schema contract moved)",
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

test("required contexts, read-only permissions, and ready-for-review tests stay intact", () => {
  const buildCheck = workflow();
  const produced = contextsProducedByWorkflow(readFileSync(WORKFLOW, "utf8"))
    .filter((name) => REQUIRED_CONTEXTS.includes(name));
  assert.deepEqual(produced.sort(), [...REQUIRED_CONTEXTS].sort());
  assert.equal(buildCheck.permissions.contents, "read");
  assert.equal(buildCheck.permissions.checks, "read");

  const ready = classifyPullRequestCiTier({
    eventName: "pull_request",
    action: "ready_for_review",
    draft: false,
  });
  assert.notEqual(ready.tier, "draft", "the exact unchanged head could reuse draft certification after becoming ready");
  const merging = classifyPullRequestCiTier({ eventName: "pull_request", action: "auto_merge_enabled", draft: false, autoMerge: true });
  assert.equal(merging.tier, "full", "turning auto-merge on must buy the full certification");

  for (const [jobId, job] of Object.entries(buildCheck.jobs).filter(([id]) => id === "admission")) {
    const decision = named(job, "Decide whether the expensive tier runs").run ?? "";
    const fullAt = decision.indexOf('steps.pr_tier.outputs.tier }}" = "full"');
    assert.ok(fullAt >= 0, `${jobId} lost ready-for-review full testing`);
  }
});
