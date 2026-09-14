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
  duplicateImplementations,
  visibleTree,
} from "../scripts/preflight.mjs";

/* ========================================================================== */
/* RULING 279 — the cheap tier runs first, and a red one buys nothing more     */
/* ========================================================================== */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "build-check.yml");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  readonly scripts?: Readonly<Record<string, string>>;
};

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
}

function jobs(): Record<string, { name?: string; steps: Step[] }> {
  const parsed = parse(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { name?: string; steps?: Step[] }>;
  };
  return Object.fromEntries(Object.entries(parsed.jobs).map(([k, v]) => [k, { name: v.name, steps: v.steps ?? [] }]));
}

const label = (s: Step) => s.name ?? s.uses ?? "(unnamed)";

/** Anything that costs real runner time: a dependency install, a browser, a build. */
const EXPENSIVE = /install|playwright|browser|build|pnpm test\b/i;

test("the certified suite executes owner-facing TSX projection contracts", () => {
  assert.match(
    PACKAGE.scripts?.test ?? "",
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

test("every required job runs the preflight before it buys anything", () => {
  for (const [id, job] of Object.entries(jobs())) {
    const at = job.steps.findIndex((s) => s.id === "preflight");
    assert.ok(at >= 0, `job ${id} does not run the preflight at all`);
    assert.match(job.steps[at].run ?? "", /node scripts\/preflight\.mjs/);

    // Nothing expensive may precede it. Checkout, setup-node and the classifier
    // are the only things that legitimately come first.
    const before = job.steps.slice(0, at).map(label);
    const spent = before.filter((n) => EXPENSIVE.test(n));
    assert.deepEqual(
      spent,
      [],
      `job ${id} spends on ${JSON.stringify(spent)} before the preflight has said anything. ` +
        "The whole point is that the cheap answer arrives before the expensive one is bought.",
    );
  }
});

test("the preflight needs no dependency install — it runs on the bare checkout", () => {
  for (const [id, job] of Object.entries(jobs())) {
    const at = job.steps.findIndex((s) => s.id === "preflight");
    const before = job.steps.slice(0, at).map((s) => `${label(s)} ${s.run ?? ""}`);
    assert.ok(
      !before.some((s) => /corepack|pnpm install/i.test(s)),
      `job ${id} enables corepack or installs before the preflight, so the preflight is not cheap in that job`,
    );
    // And it is invoked with bare `node`, not through a package manager.
    const step = job.steps[at];
    assert.match(step.run ?? "", /^\s*node scripts\/preflight\.mjs\s*$/);
  }
});

test("one step decides whether the expensive tier runs, and every expensive step asks it", () => {
  for (const [id, job] of Object.entries(jobs())) {
    const decision = job.steps.find((s) => s.id === "tier");
    assert.ok(decision, `job ${id} has no tier decision`);
    // One table. The decision reads only PR state, exact-tree reuse, and the
    // preflight; the retired runtime-path cost classifier cannot waive CI.
    assert.match(decision.run ?? "", /steps\.pr_tier\.outputs\.tier/);
    assert.match(decision.run ?? "", /steps\.certified\.outputs\.certified/);
    assert.doesNotMatch(decision.run ?? "", /steps\.cost|no-cheap/);
    assert.match(decision.run ?? "", /steps\.preflight\.outcome/);

    /*
     * A step is held back from a red preflight in one of two ways, and both
     * count. GitHub ANDs an implicit `success()` into any `if` that names no
     * status function, and into a step with no `if` at all — so a step that
     * asks nothing is already skipped once the preflight has failed. What is
     * NOT safe is `always()` without the tier condition: that runs regardless.
     */
    const unguarded = job.steps
      .filter((s) => s.id !== "preflight" && s.id !== "tier")
      .filter((s) => EXPENSIVE.test(label(s)))
      .filter((s) => {
        const cond = s.if ?? "";
        if (cond.includes("steps.tier.outputs.expensive")) return false;
        return /always\(\)/.test(cond) || cond === "" ? /always\(\)/.test(cond) : false;
      })
      .map(label);
    assert.deepEqual(
      unguarded,
      [],
      `job ${id} runs ${JSON.stringify(unguarded)} without asking the tier decision, so a red preflight would still buy it.`,
    );
  }
});

test("a red preflight makes every required job fail loudly, and skips nothing into looking green", () => {
  for (const [id, job] of Object.entries(jobs())) {
    const red = job.steps.filter((s) => (s.if ?? "").includes("'no-preflight'"));
    assert.equal(red.length, 1, `job ${id} has ${red.length} step(s) for the red-preflight path; it needs exactly one`);
    assert.match(red[0].run ?? "", /exit 1/, `job ${id}'s red-preflight step does not fail the job`);
    assert.match(
      red[0].if ?? "",
      /always\(\)/,
      `job ${id}'s red-preflight step is not always() — a failed earlier step would skip it and the job would end in nothing but skips`,
    );
  }
});

test("the three required contexts are exactly what the workflow still produces", () => {
  const produced = Object.values(jobs()).flatMap((j) => {
    const n = j.name ?? "";
    return n.includes("${{ matrix.mode }}")
      ? ["standalone", "default"].map((m) => n.replace("${{ matrix.mode }}", m))
      : [n];
  });
  for (const required of REQUIRED_CONTEXTS) {
    assert.ok(produced.includes(required), `branch protection requires ${required} and the workflow no longer produces it`);
  }
  assert.equal(produced.length, REQUIRED_CONTEXTS.length, `the workflow produces ${JSON.stringify(produced)}`);
});

/* -------------------------------------------------------------------------- */
/* CIE-5 — the gates job runs cheap before expensive                           */
/* -------------------------------------------------------------------------- */

test("the gates job runs the cheap checks before it fetches a browser or runs the suite", () => {
  const steps = jobs().gates.steps.map(label);
  const at = (needle: string) => steps.findIndex((s) => s.includes(needle));

  const browser = at("Install the browser");
  const suite = at("Test");
  assert.ok(browser > 0 && suite > 0);

  for (const cheap of ["Lint", "Types", "Governance", "Orchestration", "Method", "Canonical state holdings", "Generated state manifests"]) {
    const i = at(cheap);
    assert.ok(i >= 0, `the gates job no longer runs ${cheap}`);
    assert.ok(
      i < browser && i < suite,
      `${cheap} runs at step ${i}, after the browser (${browser}) or the suite (${suite}). ` +
        "scripts/gates.mjs orders the cheap checks first for a measured reason; CI is supposed to match it.",
    );
  }
});

test("the browser and the suite are bought only on a head whose cheap tier is green", () => {
  const gates = jobs().gates.steps;
  for (const name of ["Install the browser the suite needs", "Prove the browser is actually there", "Test"]) {
    const step = gates.find((s) => label(s) === name);
    assert.ok(step, `the gates job no longer has ${name}`);
    assert.match(
      step.if ?? "",
      /success\(\)/,
      `${name} runs on always(), so a failed lint or type check still buys it. ` +
        "RULING 279: the expensive tier is not bought on a head the cheap tier already refused.",
    );
  }
  // And the cheap tier keeps always() among itself, so all of it still reports.
  for (const name of ["Lint", "Types (fresh checkout, no build)", "Governance ledger and its generated views"]) {
    const step = gates.find((s) => label(s) === name);
    assert.match(
      step?.if ?? "",
      /always\(\)/,
      `${name} lost always(); every cheap check must still report even after one of them fails (RULING 155)`,
    );
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

test("the duplicate check reuses the one census and agrees with the suite's baseline", () => {
  const outcome = duplicateImplementations({ cwd: ROOT });
  assert.equal(outcome.ok, true, `preflight disagrees with tests/duplicate-implementations.json: ${outcome.says}`);
  assert.match(outcome.says, /duplicate group/);
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
 * `.ts` modules through `await import(…)`, exactly as `scripts/deploy-classify.mjs`
 * does, so its whole closure was invisible here.
 *
 * **It watched one script.** Four now run before the install.
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
    script: "scripts/deploy-classify.mjs",
    why: "RULING 278's classifier — it decides how much the rest of the job may spend",
  },
  {
    script: "scripts/pr-ci-tier.mjs",
    why: "the draft/full event classifier — it must answer before a draft installs anything",
  },
  {
    script: "scripts/certified-tree.mjs",
    why: "RULING 281's tree-equivalence adapter — it decides whether the expensive tier runs at all",
  },
];

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
