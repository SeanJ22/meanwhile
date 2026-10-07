import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parse } from "yaml";

import { REQUIRED_CONTEXTS, contextsProducedByWorkflow } from "../lib/ops/required-checks.ts";
import { GATES, PRECONDITIONS } from "../scripts/gates.mjs";
import {
  PREFLIGHT_CHECKS,
  civicDataReleaseFirewall,
  visibleTree,
} from "../scripts/preflight.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "build-check.yml");

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
}

interface Job { name?: string; if?: string; needs?: string[]; steps: Step[]; strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown[]> } }

function jobs(): Record<string, Job> {
  const parsed = parse(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, Job>;
  };
  return Object.fromEntries(Object.entries(parsed.jobs).map(([k, v]) => [k, { ...v, steps: v.steps ?? [] }]));
}

const label = (s: Step) => s.name ?? s.uses ?? "(unnamed)";

const EXPENSIVE = /install|playwright|browser|build|pnpm test\b/i;

test("the certified suite executes owner-facing TSX projection contracts", () => {
  assert.match(
    readFileSync(join(ROOT, "scripts", "ci-tests.mjs"), "utf8"),
    /tests\/\*\*\/\*\.test\.tsx/,
    "the Admin runtime-outcome render test is outside pnpm test",
  );
  const loader = readFileSync(join(ROOT, "scripts", "test-alias-loader.mjs"), "utf8");
  assert.match(loader, /url\.endsWith\("\.tsx"\)/);
  assert.match(loader, /transpileModule/);
});

test("one admission runs the bare preflight before dependency installation", () => {
  const all = jobs();
  assert.deepEqual(Object.entries(all).filter(([, job]) => job.steps.some((s) => s.id === "preflight")).map(([id]) => id), ["admission"]);
  const steps = all.admission.steps;
  const at = steps.findIndex((s) => s.id === "preflight");
  assert.match(steps[at].run ?? "", /^node scripts\/preflight\.mjs$/);
  assert.deepEqual(steps.slice(0, at).filter((s) => EXPENSIVE.test(label(s))).map(label), []);
  assert.ok(!steps.slice(0, at).some((s) => /corepack|pnpm install/i.test(s.run ?? "")));
});

test("one admission decides the tier and all consuming jobs depend on it", () => {
  const all = jobs();
  assert.deepEqual(Object.entries(all).filter(([, job]) => job.steps.some((s) => s.id === "tier")).map(([id]) => id), ["admission"]);
  const decision = all.admission.steps.find((s) => s.id === "tier");
  for (const part of ["pr_tier.outputs.tier", "preflight.outcome"]) {
    assert.ok(decision?.run?.includes(`steps.${part}`));
  }
  assert.doesNotMatch(decision?.run ?? "", /steps\.cost|no-cheap/);
  for (const id of ["verify", "test", "build", "gates"]) assert.ok(all[id].needs?.includes("admission"));
  for (const id of ["verify", "test"]) {
    assert.match(all[id].if ?? "", /needs\.admission\.outputs\.tier == 'yes'/);
    assert.doesNotMatch(all[id].if ?? "", /always\(\)/);
  }
  for (const step of all.build.steps.filter((s) => EXPENSIVE.test(label(s)))) {
    assert.match(step.if ?? "", /needs\.admission\.outputs\.tier == 'yes'|== 'draft'|== 'no-preflight'/);
  }
});

test("a refused admission makes required build and final contexts fail loudly", () => {
  const all = jobs();
  // Required contexts report on every non-draft event; a draft buys no Actions.
  assert.equal(all.build.if, "always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false)");
  assert.equal(all.gates.if, "always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false)");
  assert.equal(all.build.steps.find((s) => s.name === "Require successful admission")?.run, 'test "$ADMISSION_RESULT" = success');
  assert.deepEqual(all.gates.needs, ["admission", "verify", "test", "build"]);
  const verdict = all.gates.steps.find((s) => s.run === "node scripts/ci-verdict.mjs");
  assert.ok(verdict);
  assert.equal(verdict.if, undefined, "reducer must run even for a refused admission");
});

test("the existing required contexts remain and auxiliary jobs feed the final verdict", () => {
  const all = jobs();
  const source = readFileSync(WORKFLOW, "utf8");
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const produced = contextsProducedByWorkflow(source, event).filter((name) => /^(?:build|gates) \(/.test(name));
    assert.deepEqual(produced.sort(), [...REQUIRED_CONTEXTS].sort(), event);
  }
  for (const id of Object.keys(all).filter((id) => id !== "gates")) assert.ok(all.gates.needs?.includes(id));
});

test("independent structural checks all report, from one install, before the browser and tests are bought", () => {
  const all = jobs();
  // One job, one install: each check still reports when an earlier one fails.
  assert.equal(all.verify.name, "verify (lint · types · governance)");
  assert.equal(all.verify.strategy, undefined, "verify is one job; a matrix buys one install per check");
  assert.equal(all.verify.steps.filter((s) => s.run === "corepack pnpm install --frozen-lockfile").length, 1);
  assert.ok(all.test.needs?.includes("verify"));
  assert.doesNotMatch(all.test.if ?? "", /always\(\)/);
  assert.match(all.test.if ?? "", /needs\.admission\.outputs\.tier == 'yes' && needs\.verify\.result == 'success'/,
    "tests must wait for the structural checks");
  // An empty dynamic matrix must never be expanded: the job is skipped first.
  assert.match(all.test.if ?? "", /needs\.admission\.outputs\.test_legs != ''/);
  assert.match(all.test.if ?? "", /needs\.admission\.outputs\.test_legs != '\[\]'/);
  assert.match(all.test.if ?? "", /test_plan == 'affected' \|\| needs\.admission\.outputs\.test_plan == 'full'/);
  assert.doesNotMatch(all.test.if ?? "", /'main'/, "a push to main runs no tests; the scheduled run does");
  for (const name of ["Lint", "Types"]) {
    const step = all.verify.steps.find((s) => label(s).startsWith(name));
    assert.ok(step, `${name} was lost`);
    assert.match(step.if ?? "", /always\(\)/);
    assert.match(step.if ?? "", /steps\.install\.outcome == 'success'/);
  }
  for (const name of ["Install the browser the suite needs", "Prove the browser is actually there", "Test"]) {
    const step = all.test.steps.find((s) => label(s) === name);
    assert.ok(step, `${name} was lost`);
    assert.match(step.if ?? "", /success\(\)/);
    assert.match(step.if ?? "", /needs\.admission\.outputs\.tier == 'yes'/);
  }
});

test("admission installs nothing: every admission step runs on bare Node", () => {
  const steps = jobs().admission.steps;
  assert.deepEqual(steps.filter((s) => /corepack|pnpm/.test(s.run ?? "") || /actions\/cache/.test(s.uses ?? "")).map(label), []);
  const scripts = steps.flatMap((s) => [...(s.run ?? "").matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]));
  assert.deepEqual(scripts.sort(), [
    "scripts/ci-affected-tests.mjs",
    "scripts/ci-selection-summary.mjs",
    "scripts/netlify-ignore.mjs",
    "scripts/pr-ci-tier.mjs",
    "scripts/preflight.mjs",
  ], "a new admission script runs before any install: add its import closure to BEFORE_INSTALL below");
});

test("the local door runs the preflight before the gate loop, and refuses rather than continuing", () => {
  const src = readFileSync(join(ROOT, "scripts", "gates.mjs"), "utf8");
  const preflightAt = src.indexOf("runPreflight()");
  const loopAt = src.indexOf("for (const gate of GATES)");
  assert.ok(preflightAt > 0, "scripts/gates.mjs never runs the preflight");
  assert.ok(loopAt > 0);
  assert.ok(preflightAt < loopAt, "the gate loop starts before the preflight runs");
  const between = src.slice(preflightAt, loopAt);
  assert.match(between, /process\.exitCode = 1/, "a red preflight does not fail the local door");
  assert.match(between, /return;/, "a red preflight does not stop the local door running the expensive tier");
});

test("the preflight is declared as something the local door runs, not exempted from parity", () => {
  assert.ok(PRECONDITIONS.length > 0);
  const preflight = PRECONDITIONS.find((p) => p.id === "preflight");
  assert.ok(preflight, "the preflight is not declared");
  assert.equal(preflight.command, "node scripts/preflight.mjs", "the declared command must be the one CI runs, verbatim");
  assert.ok((preflight.why ?? "").length > 40, "a precondition with no stated reason is an exemption wearing a different name");
  assert.ok(!GATES.some((g) => g.id === "preflight"), "the preflight is in GATES, where every entry runs even after one fails");
});

test("the preflight checks are cheap, named, and both report", () => {
  assert.ok(PREFLIGHT_CHECKS.length >= 2);
  for (const check of PREFLIGHT_CHECKS) {
    assert.match(check.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(check.what.length > 30, `${check.id} does not say what it is for`);
    assert.equal(typeof check.run, "function");
  }
});

test("visible-tree passes on a tree whose files are all tracked, and names the ones that are not", () => {
  const clean = visibleTree({ cwd: ROOT });
  // This repository's own checkout during a test run has no untracked files
  // unless the session left some — and if it did, that IS the finding.
  assert.equal(typeof clean.ok, "boolean");
  assert.ok(clean.says.length > 20);
  if (!clean.ok) assert.match(clean.detail ?? "", /Stage them/);

  // A directory git does not know is not a repository: the check says so rather
  // than reporting a clean tree it never read.
  const nowhere = visibleTree({ cwd: join(ROOT, "node_modules", ".bin") });
  assert.equal(typeof nowhere.ok, "boolean");
});

test("the preflight firewall supplies both production contract registries instead of failing as an instrument", () => {
  const outcome = civicDataReleaseFirewall({ cwd: ROOT });
  assert.doesNotMatch(
    outcome.says,
    /could not read its denominator/,
    `the preflight firewall threw instead of auditing the tree: ${outcome.says}`,
  );
  if (!outcome.ok) {
    assert.match(outcome.says, /release-coupling finding/);
    assert.ok((outcome.detail ?? "").length > 0, "a real firewall refusal must name its findings");
  }
});

const BEFORE_INSTALL: ReadonlyArray<{ script: string; why: string }> = [
  {
    script: "scripts/preflight.mjs",
    why: "the cheap tier — it answers from the tree before anything is bought",
  },
  {
    script: "scripts/pr-ci-tier.mjs",
    why: "the draft/full event classifier — it must answer before a draft installs anything",
  },
  {
    script: "scripts/ci-affected-tests.mjs",
    why: "the affected-test selector — admission installs nothing, so it plans the tests on bare Node",
  },
  {
    script: "scripts/netlify-ignore.mjs",
    why: "the build-impact classifier — admission installs nothing",
  },
];

test("production observation classification runs only after its frozen dependency install", () => {
  const raw = readFileSync(join(ROOT, ".github/workflows/post-deploy-integrity.yml"), "utf8");
  const steps = (parse(raw) as { jobs: { observe: { steps: { run?: string; if?: string }[] } } }).jobs.observe.steps;
  const classifier = steps.findIndex((step) => step.run?.includes("scripts/deploy-classify.mjs"));
  const install = steps.findIndex((step) => step.run?.includes("corepack pnpm install --frozen-lockfile"));
  assert.ok(install >= 0 && classifier > install, "the canonical reader needs installed dependencies");
  assert.equal(steps[install].if, undefined, "installation cannot be skipped before classification");
});

for (const { script, why } of BEFORE_INSTALL) {
  test(`nothing ${script} imports needs node_modules`, () => {
    const seen = new Set<string>();
    const bare: string[] = [];
    const visit = (from: string): void => {
      if (seen.has(from)) return;
      seen.add(from);
      let raw: string;
      try {
        raw = readFileSync(from, "utf8");
      } catch {
        bare.push(`${from} → (unreadable; an import that does not resolve is not a proof)`);
        return;
      }
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[\s;])\/\/[^\n]*/g, "$1");
      const specs: string[] = [];
      // `import type` / `export type` are erased by Node's type stripper and
      // therefore cannot create a bare-checkout runtime dependency. Following
      // them reports packages that the executable never asks Node to load.
      for (const m of src.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^;]*?from\s+"([^"]+)"/gm)) {
        specs.push(m[1]);
      }
      for (const m of src.matchAll(/^\s*import\s+"([^"]+)"/gm)) specs.push(m[1]);
      for (const m of src.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) specs.push(m[1]);

      for (const spec of specs) {
        if (spec.startsWith("node:")) continue;
        if (!spec.startsWith(".")) {
          bare.push(`${from} → ${spec}`);
          continue;
        }
        visit(join(dirname(from), spec));
      }
    };
    visit(join(ROOT, script));

    assert.ok(
      seen.size >= 2,
      `the walk only reached ${seen.size} file(s) from ${script}; it is not following the imports`,
    );
    assert.deepEqual(
      bare,
      [],
      `${script}'s import closure reaches a package:\n  ${bare.join("\n  ")}\n\n` +
        `CI runs it on a bare checkout before \`pnpm install\` — ${why} — so a package here fails\n` +
        "the step on every head. It fails SAFE, which is worse than loud: the step keeps reporting\n" +
        "correctly while the thing it decides can never happen (run 34160631768).",
    );
  });
}

test("the closure walk actually follows a dynamic import", () => {
  const src = 'const x = await import("yaml");\n';
  const found: string[] = [];
  for (const m of src.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) found.push(m[1]);
  assert.deepEqual(found, ["yaml"], "the dynamic-import pattern no longer matches");
});

test("the preflight never stages, commits or otherwise mutates the tree", () => {
  const src = readFileSync(join(ROOT, "scripts", "preflight.mjs"), "utf8");
  for (const forbidden of [/\bexecFileSync\(\s*"git"\s*,\s*\[\s*"(add|commit|stash|checkout|reset)"/, /\bexecSync\(\s*[`"']git (add|commit|stash|checkout|reset)/, /\bwriteFileSync\(/, /\brmSync\(/, /\bmkdirSync\(/, /\bappendFileSync\(/]) {
    assert.ok(
      !forbidden.test(src),
      `scripts/preflight.mjs matches ${forbidden}. A validator that repairs what it measures cannot report a failure.`,
    );
  }
  assert.match(src, /execFileSync\(\s*"git"/, "the preflight asks git nothing at all");
});
