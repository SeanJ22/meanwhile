import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");

function workflows(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));
}

/** Does this workflow diagnose its own failure by reading its own run? */
function diagnosesItself(text: string): boolean {
  return /run:\s*corepack pnpm diagnose\b/.test(text) || /run:\s*pnpm diagnose\b/.test(text);
}

/** Does it grant the Actions read the diagnoser needs? */
function declaresActionsRead(text: string): boolean {
  return /^\s*actions:\s*read\s*$/m.test(text);
}

test("every workflow that runs `pnpm diagnose` grants actions: read", () => {
  const all = workflows();
  assert.ok(all.length > 0, "workflow discovery must not be empty");

  const diagnosers = all.filter((w) => diagnosesItself(w.text));
  assert.equal(diagnosers.length, 1, "only the post-deploy release observer should diagnose its Actions run");

  const blind = diagnosers.filter((w) => !declaresActionsRead(w.text)).map((w) => w.name);
  assert.deepEqual(
    blind,
    [],
    `these workflows diagnose themselves with a token that cannot read the run: ${blind.join(", ")}. ` +
      "GitHub returns HTTP 403 'Resource not accessible by integration' and the diagnoser prints " +
      "CANNOT RUN — so every failure in them dies unnamed. Add `actions: read` to the workflow's " +
      "`permissions:` block.",
  );
});

test("granting actions: read did not weaken anything else", () => {
  // `permissions:` is exact: every scope it does not list is `none`.
  for (const w of workflows()) {
    if (/push-main\.mjs/.test(w.text)) {
      assert.match(
        w.text,
        /^\s*contents:\s*write\s*$/m,
        `${w.name} pushes main and no longer declares contents: write`,
      );
    }
  }

  const buildCheck = workflows().find((w) => w.name === "build-check.yml")!;
  const permissions = (parse(buildCheck.text) as { permissions?: Record<string, string> }).permissions;
  // `checks: read` lets the tree-equivalence step read the required contexts at the candidate head.
  assert.deepEqual(
    permissions,
    // The final retry guard reads the current PR head/base/tier; no write scope.
    { contents: "read", checks: "read", "pull-requests": "read" },
    "build-check.yml deploys nothing and pushes nothing; its token stays read-only",
  );
  for (const [scope, level] of Object.entries(permissions ?? {})) {
    assert.equal(level, "read", `build-check.yml granted ${scope}: ${level} — it may only read`);
  }
});

test("THE PLANT: the guard catches a diagnoser with no Actions read", () => {
  const planted = [
    "name: A daily job",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  go:",
    "    steps:",
    "      - name: Name the cause",
    "        if: failure()",
    "        run: corepack pnpm diagnose",
  ].join("\n");
  assert.equal(diagnosesItself(planted), true, "the reader cannot see the diagnose step");
  assert.equal(declaresActionsRead(planted), false, "the guard passed a workflow with no Actions read");

  const fixed = planted.replace("  contents: write", "  contents: write\n  actions: read");
  assert.equal(declaresActionsRead(fixed), true);
  assert.match(fixed, /^\s*contents:\s*write\s*$/m, "the fix must not cost the write it already had");
});
