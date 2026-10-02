import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  TEST_LEGS,
  codeView,
  decide,
  moduleReferences,
  selectTests,
} from "../scripts/ci-affected-tests.mjs";
import { discoverTests } from "../scripts/ci-tests.mjs";
import { DYNAMIC_MATRIX_LEGS } from "../lib/ops/required-checks.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(import.meta.dirname, "..");

/** A synthetic repository: tracked paths and their text. */
function repo(files: Record<string, string>) {
  const tracked = Object.keys(files).sort();
  const tests = tracked.filter((path) => /^tests\/.+\.test\.tsx?$/.test(path));
  return (changed: string[]) => selectTests({
    changed,
    tracked,
    tests,
    readText: (path: string) => {
      if (!(path in files)) throw new Error(`absent ${path}`);
      return files[path];
    },
  });
}

const BASE = {
  "lib/a.ts": 'export const a = 1;\n',
  "lib/b.ts": 'import { a } from "./a.ts";\nexport const b = a + 1;\n',
  "lib/c.ts": 'export const c = 3;\n',
  "lib/alias.ts": 'import { c } from "@/lib/c";\nexport const viaAlias = c;\n',
  "tests/b.test.ts": 'import test from "node:test";\nimport { b } from "../lib/b.ts";\ntest("b", () => {});\n',
  "tests/c.test.ts": 'import test from "node:test";\nimport { c } from "../lib/c.ts";\ntest("c", () => {});\n',
  "tests/alias.test.ts": 'import test from "node:test";\nimport { viaAlias } from "../lib/alias.ts";\ntest("alias", () => {});\n',
  "docs/notes.md": "# Notes\n",
  "data/table.json": "{}\n",
  "package.json": "{}\n",
};

test("a changed lib file selects every test that reaches it through its imports, and no other", () => {
  const decision = repo(BASE)(["lib/a.ts"]);
  assert.equal(decision.plan, "affected");
  assert.deepEqual(decision.files, ["tests/b.test.ts"], "lib/a.ts reaches tests/b.test.ts only through lib/b.ts");
  assert.equal(decision.needsBrowser, false);
});

test("the tsconfig @/ alias and extensionless specifiers are followed", () => {
  assert.deepEqual(repo(BASE)(["lib/c.ts"]).files, ["tests/alias.test.ts", "tests/c.test.ts"]);
});

test("a changed test file selects itself", () => {
  const decision = repo(BASE)(["tests/c.test.ts"]);
  assert.equal(decision.plan, "affected");
  assert.deepEqual(decision.files, ["tests/c.test.ts"]);
});

test("documentation under docs/ alone selects no tests", () => {
  const decision = repo(BASE)(["docs/notes.md"]);
  assert.equal(decision.plan, "none");
  assert.deepEqual(decision.files, []);
});

test("a document a test reads by name selects that test", () => {
  const files = { ...BASE, "tests/doc.test.ts": 'import { readFileSync } from "node:fs";\nreadFileSync("docs/notes.md", "utf8");\n' };
  assert.deepEqual(repo(files)(["docs/notes.md"]).files, ["tests/doc.test.ts"]);
});

test("data, package.json, configuration, workflows, CSS and unknown files select the full suite", () => {
  for (const path of ["data/table.json", "package.json", "pnpm-lock.yaml", "tsconfig.json", "next.config.ts",
    ".github/workflows/build-check.yml", "public/logo.svg", "app/globals.css", "tests/fixtures/page.html",
    "README.md", "lib/data.json", "eslint.config.mjs"]) {
    const decision = repo(BASE)(["lib/a.ts", path]);
    assert.equal(decision.plan, "full", path);
    assert.equal(decision.needsBrowser, true, `${path}: the full suite keeps today's browser install`);
  }
});

test("the test runner, its loader and this selector always select the full suite", () => {
  for (const path of ["scripts/ci-tests.mjs", "scripts/register-test-loader.mjs", "scripts/test-alias-loader.mjs", "scripts/ci-affected-tests.mjs"]) {
    assert.equal(repo(BASE)([path]).plan, "full", path);
  }
});

test("an import that does not resolve inside any test's closure selects the full suite", () => {
  const files = { ...BASE, "lib/b.ts": 'import { a } from "./a.ts";\nimport { gone } from "./gone.ts";\nexport const b = a + gone;\n' };
  const decision = repo(files)(["lib/c.ts"]);
  assert.equal(decision.plan, "full");
  assert.match(decision.reasons.join(" "), /lib\/b\.ts imports \.\/gone\.ts/);
});

test("an import written inside a fixture string or a comment is not an import", () => {
  const files = {
    ...BASE,
    "tests/fixture.test.ts": [
      '// import { x } from "./not-real.ts";',
      "/* import y from './also-not-real.ts'; */",
      'const source = `import { z } from "./generated.ts";\\nawait import("./dyn.ts");`;',
      "const pattern = /import\\(\"\\.\\/regex\\.ts\"\\)/;",
      'import { c } from "../lib/c.ts";',
    ].join("\n"),
  };
  const decision = repo(files)(["lib/c.ts"]);
  assert.equal(decision.plan, "affected", decision.reasons.join(" "));
  assert.ok(decision.files.includes("tests/fixture.test.ts"));
  assert.deepEqual(moduleReferences(files["tests/fixture.test.ts"]).specs, ["../lib/c.ts"]);
});

test("the code view keeps positions and blanks only comments, strings and templates", () => {
  const source = 'const a = "x/y"; // note\nconst b = `t${a}t`;\n';
  const view = codeView(source);
  assert.equal(view.length, source.length);
  assert.equal(view, 'const a = "   ";        \nconst b = ` ${a} `;\n');
  assert.equal(codeView(source, { keepStrings: true }), 'const a = "x/y";        \nconst b = `t${a}t`;\n');
});

test("type-only imports carry no runtime dependency", () => {
  const files = { ...BASE, "tests/types.test.ts": 'import type { a } from "../lib/a.ts";\nexport type { b } from "../lib/b.ts";\n' };
  assert.ok(!repo(files)(["lib/a.ts"]).files.includes("tests/types.test.ts"));
});

test("a literal dynamic import, a spawned script and a source read by name are followed", () => {
  const files = {
    ...BASE,
    "scripts/tool.mjs": 'export const tool = 1;\n',
    "tests/dynamic.test.ts": 'const { a } = await import("../lib/a.ts");\n',
    "tests/spawn.test.ts": 'import { spawnSync } from "node:child_process";\nspawnSync(process.execPath, ["scripts/tool.mjs"]);\n',
    "tests/reads.test.ts": 'import { join } from "node:path";\nconst path = join(ROOT, "scripts", "tool.mjs");\n',
    "tests/helper-url.test.ts": 'const url = (path) => path;\nawait import(url("lib/c.ts"));\n',
  };
  const select = repo(files);
  assert.ok(select(["lib/a.ts"]).files.includes("tests/dynamic.test.ts"));
  assert.deepEqual(select(["scripts/tool.mjs"]).files, ["tests/reads.test.ts", "tests/spawn.test.ts"]);
  assert.ok(select(["lib/c.ts"]).files.includes("tests/helper-url.test.ts"), "a computed import naming a tracked file loads it");
});

test("a computed import that names nothing makes its module depend on all code", () => {
  const files = {
    ...BASE,
    "lib/loader.ts": 'export async function load(name: string) { return import(`./plugins/${name}.ts`); }\n',
    "tests/loader.test.ts": 'import { load } from "../lib/loader.ts";\n',
  };
  const decision = repo(files)(["lib/c.ts"]);
  assert.ok(decision.files.includes("tests/loader.test.ts"));
  assert.ok(!repo(files)(["docs/notes.md"]).files.includes("tests/loader.test.ts"), "documentation is not code");
});

test("a test that sweeps source trees runs on every code change", () => {
  const files = {
    ...BASE,
    "tests/sweep.test.ts": 'import { readdirSync } from "node:fs";\nfor (const f of readdirSync("lib")) {}\n',
    "tests/helpers/walk.ts": 'import { globSync } from "node:fs";\nexport const all = () => globSync("lib/**");\n',
    "tests/walks.test.ts": 'import { all } from "./helpers/walk.ts";\n',
  };
  const decision = repo(files)(["lib/c.ts"]);
  assert.ok(decision.files.includes("tests/sweep.test.ts"));
  assert.ok(decision.files.includes("tests/walks.test.ts"), "a sweeping test helper selects its tests");
  assert.equal(repo(files)(["docs/notes.md"]).plan, "none");
});

test("needs_browser follows a selected test's imports to Playwright", () => {
  const files = {
    ...BASE,
    "lib/browser.ts": 'import { chromium } from "playwright";\nimport { c } from "./c.ts";\nexport const launch = () => chromium;\n',
    "tests/browser.test.ts": 'import { launch } from "../lib/browser.ts";\n',
  };
  assert.equal(repo(files)(["lib/c.ts"]).needsBrowser, true);
  assert.equal(repo(files)(["lib/a.ts"]).needsBrowser, false);
});

test("an empty diff selects nothing; a malformed one or too many files selects everything", () => {
  assert.equal(repo(BASE)([]).plan, "none");
  assert.equal(selectTests({ changed: null as unknown as string[], tracked: [], tests: [], readText: () => "" }).plan, "full");
  const many = Array.from({ length: 401 }, (_, index) => `lib/generated-${index}.ts`);
  assert.equal(repo(BASE)(many).plan, "full");
});

test("the schedule, dispatch and a missing base run the whole suite; main and other tiers run none", () => {
  assert.equal(decide({ root: ROOT, tier: "yes", eventName: "schedule", base: undefined }).plan, "full");
  assert.equal(decide({ root: ROOT, tier: "main", eventName: "push", base: undefined }).plan, "none");
  assert.equal(decide({ root: ROOT, tier: "yes", eventName: "workflow_dispatch", base: undefined }).plan, "full");
  assert.equal(decide({ root: ROOT, tier: "yes", eventName: "pull_request", base: undefined }).plan, "full");
  assert.equal(decide({ root: ROOT, tier: "yes", eventName: "pull_request", base: "f".repeat(40) }).plan, "full", "an unknown base commit fails closed");
  for (const tier of ["waiting", "draft", "no-preflight", ""]) assert.equal(decide({ root: ROOT, tier, eventName: "pull_request", base: undefined }).plan, "none");
});

test("every leg the selector can emit is a test context the required-checks reader knows", () => {
  const emitted = [...TEST_LEGS.affected, ...TEST_LEGS.full, ...TEST_LEGS.none].sort();
  assert.deepEqual(emitted, [...DYNAMIC_MATRIX_LEGS["${{ fromJSON(needs.admission.outputs.test_legs) }}"]].sort());
  assert.deepEqual(TEST_LEGS.full, ["1/4", "2/4", "3/4", "4/4"], "the whole suite keeps its four shards");
});

test("the real repository: every test's imports resolve, and a lib change selects its own test", () => {
  const tracked = filesThatWouldBeCommitted({ cwd: ROOT });
  const decision = selectTests({
    changed: ["lib/ops/required-contexts.ts"],
    tracked,
    tests: discoverTests(ROOT),
    readText: (path: string) => readFileSync(join(ROOT, path), "utf8"),
  });
  assert.equal(decision.plan, "affected", decision.reasons.join(" "));
  assert.ok(decision.files.includes("tests/required-checks.test.ts"));
  assert.ok(decision.files.length < discoverTests(ROOT).length, "a leaf change must not select the whole suite");
});
