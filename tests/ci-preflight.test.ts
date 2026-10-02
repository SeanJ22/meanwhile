import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parse } from "yaml";

import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";
import { GATES, PRECONDITIONS } from "../scripts/gates.mjs";
import {
  PREFLIGHT_CHECKS,
  civicDataReleaseFirewall,
  visibleTree,
} from "../scripts/preflight.mjs";

/* ========================================================================== */
/* RULING 279 — the cheap tier runs first, and a red one buys nothing more     */
/* ========================================================================== */

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

/** Anything that costs real runner time: a dependency install, a browser, a build. */
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

/* -------------------------------------------------------------------------- */
/* The shape of the change                                                     */
/* -------------------------------------------------------------------------- */

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
  const produced = [all.gates.name, ...["standalone", "default"].map((mode) => all.build.name?.replace("${{ matrix.mode }}", mode))];
  assert.deepEqual(produced.sort(), [...REQUIRED_CONTEXTS].sort());
  for (const id of Object.keys(all).filter((id) => id !== "gates")) assert.ok(all.gates.needs?.includes(id));
});

test("independent structural checks all report before the browser and full suite are bought", () => {
  const all = jobs();
  assert.deepEqual(all.verify.strategy?.matrix?.group, ["lint", "types", "governance"]);
  assert.equal(all.verify.strategy?.["fail-fast"], false);
  assert.ok(all.test.needs?.includes("verify"));
  assert.doesNotMatch(all.test.if ?? "", /always\(\)/);
  for (const name of ["Lint", "Types", "Canonical state holdings", "Generated state manifests"]) {
    const step = all.verify.steps.find((s) => label(s).startsWith(name));
    assert.ok(step, `${name} was lost`);
    assert.match(step.if ?? "", /always\(\)/);
  }
  for (const name of ["Install the browser the suite needs", "Prove the browser is actually there", "Test"]) {
    const step = all.test.steps.find((s) => label(s) === name);
    assert.ok(step, `${name} was lost`);
    assert.match(step.if ?? "", /success\(\)/);
    assert.match(step.if ?? "", /needs\.admission\.outputs\.tier == 'yes'/);
  }
});

/* -------------------------------------------------------------------------- */
/* The local door                                                              */
/* -------------------------------------------------------------------------- */

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
  assert.match(
    between,
    /NO GATE RUN RECORD/,
    "a refused run must not leave a gate-run record, or the status ledger renders it as a measurement of this tree",
  );
});

test("the preflight is declared as something the local door runs, not exempted from parity", () => {
  assert.ok(PRECONDITIONS.length > 0);
  const preflight = PRECONDITIONS.find((p) => p.id === "preflight");
  assert.ok(preflight, "the preflight is not declared");
  assert.equal(preflight.command, "node scripts/preflight.mjs", "the declared command must be the one CI runs, verbatim");
  assert.ok((preflight.why ?? "").length > 40, "a precondition with no stated reason is an exemption wearing a different name");
  // And it is NOT a gate: gates all run and all report; this one stops the run.
  assert.ok(!GATES.some((g) => g.id === "preflight"), "the preflight is in GATES, where every entry runs even after one fails");
});

/* -------------------------------------------------------------------------- */
/* The checks themselves                                                       */
/* -------------------------------------------------------------------------- */

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

/**
 * THE CLAIM THE WHOLE ORDERING RESTS ON, MADE EXECUTABLE.
 *
 * "This step runs before `pnpm install`" is only true while nothing it reaches
 * imports a package. One bare specifier anywhere in the closure — a `yaml`, a
 * `zod`, a test helper that pulls one in — and the CI step fails on a bare
 * checkout, which looks like the step being broken rather than the import being
 * new.
 *
 * ## Two things this guard could not see, and both cost a real run
 *
 * **It walked only STATIC imports.** `scripts/certified-tree.mjs` reaches its
 * `.ts` modules through `await import(…)`, so its whole closure was invisible here.
 *
 * **It watched one script.** All actual preinstall entries need this proof.
 *
 * Run 34160631768, 2026-09-07 — the first main-side run of the tree-equivalence
 * check — printed `the predicate would not load (Cannot find package 'yaml'
 * imported from lib/ops/required-checks.ts) — answering FULL`. It failed in the
 * safe direction and named its own cause, which is the design working; it also
 * meant the attestation could never fire on any head. A feature that is
 * permanently inert while reporting itself correctly is the failure this guard
 * exists to make loud, and it was silent because of the two gaps above.
 */

/** Every script CI runs before `pnpm install`, and why it is on the list. */
const BEFORE_INSTALL: ReadonlyArray<{ script: string; why: string }> = [
  {
    script: "scripts/preflight.mjs",
    why: "RULING 279's cheap tier — it answers from the tree before anything is bought",
  },
  {
    script: "scripts/pr-ci-tier.mjs",
    why: "the draft/full event classifier — it must answer before a draft installs anything",
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
      /*
       * COMMENTS COME OUT FIRST, and this is not tidiness.
       *
       * The static-import pattern spans lines so it can read a multi-line
       * import list, which means it will happily start at the word "export" in
       * a doc comment and run on until it finds a quoted string somewhere
       * below. This repository's modules carry long prose headers, so the
       * widened walk immediately produced a page of "packages" that were
       * sentences — `route-task.ts → this is not published`.
       *
       * The narrow walk never hit this because it only ever reached four
       * files. A guard that reports a defect per paragraph is a guard nobody
       * will keep.
       */
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[\s;])\/\/[^\n]*/g, "$1");
      const specs: string[] = [];
      /*
       * Static `import … from "x"` and `export … from "x"`.
       *
       * `[^;]*?` rather than an unbounded span: an import list may run over
       * several lines but carries no semicolon before its `from`, while an
       * exported function body carries plenty. Unbounded, the pattern started
       * at an `export` and ran on into a concatenated string, reporting
       * `refresh-report.ts -> " +` as a package. The narrow walk never hit
       * this because it only ever reached four files; widening the walk is
       * what made the sloppiness visible.
       */
      // `import type` / `export type` are erased by Node's type stripper and
      // therefore cannot create a bare-checkout runtime dependency. Following
      // them reports packages that the executable never asks Node to load.
      for (const m of src.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^;]*?from\s+"([^"]+)"/gm)) {
        specs.push(m[1]);
      }
      /* Bare side-effect import: `import "x"`. */
      for (const m of src.matchAll(/^\s*import\s+"([^"]+)"/gm)) specs.push(m[1]);
      /*
       * DYNAMIC `import("x")`. The gap that hid run 34160631768: an `.mjs`
       * adapter reaching a `.ts` module this way had its entire closure
       * unexamined.
       */
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
  /*
   * THE PLANT. The guard above is only worth anything if its new half works, so
   * the shape that hid the defect is shown being caught — a bare specifier
   * reachable ONLY through `await import(...)`.
   */
  const src = 'const x = await import("yaml");\n';
  const found: string[] = [];
  for (const m of src.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) found.push(m[1]);
  assert.deepEqual(found, ["yaml"], "the dynamic-import pattern no longer matches");
});

test("the preflight never stages, commits or otherwise mutates the tree", () => {
  const src = readFileSync(join(ROOT, "scripts", "preflight.mjs"), "utf8");
  /*
   * The INVOCATIONS, not the words. This check told the owner to run `git add`
   * himself, and an earlier version of this test read its own advice as the
   * defect — the same mistake the widened tracked-only guard made an hour before
   * it. A guard that cannot tell a sentence from a call teaches people to stop
   * writing sentences.
   */
  for (const forbidden of [/\bexecFileSync\(\s*"git"\s*,\s*\[\s*"(add|commit|stash|checkout|reset)"/, /\bexecSync\(\s*[`"']git (add|commit|stash|checkout|reset)/, /\bwriteFileSync\(/, /\brmSync\(/, /\bmkdirSync\(/, /\bappendFileSync\(/]) {
    assert.ok(
      !forbidden.test(src),
      `scripts/preflight.mjs matches ${forbidden}. A validator that repairs what it measures cannot report a failure.`,
    );
  }
  // And it does read git — a check that touched nothing would prove nothing.
  assert.match(src, /execFileSync\(\s*"git"/, "the preflight asks git nothing at all");
});
