/**
 * **A JOB THAT DIAGNOSES ITSELF NEEDS PERMISSION TO READ ITSELF.**
 * (2026-08-28, found in intake tripwire run 33211710028.)
 *
 * ## The defect, measured
 *
 * `scripts/diagnose-failure.mts` is the last step of eight workflows: on the
 * failure path it reads the job's own Actions log and names the failure class,
 * so `Error: Process completed with exit code 1` is never the whole story.
 *
 * In run 33211710028 it printed this instead:
 *
 * ```
 * gh: Resource not accessible by integration (HTTP 403)
 * failed to get run: HTTP 403: Resource not accessible by integration
 *   (https://api.github.com/repos/SeanJ22/We-The-People/actions/runs/33211710028)
 * diagnose: CANNOT RUN — the run log could not be read
 * ```
 *
 * The workflow declared `permissions: contents: write` and nothing else.
 * **Declaring `permissions:` at all switches the token from the repository
 * default to EXACTLY what is listed** — so every scope not named becomes
 * `none`, `actions` included, and the Actions API refuses the read. The
 * diagnoser behaved correctly: it printed CANNOT RUN and exited 0 rather than
 * turning a red run into a differently-red one. It simply could never work.
 *
 * `job-watch.yml` already carried `actions: read` — it reads other workflows'
 * run history, so somebody hit this once and fixed the one workflow rather than
 * the class. This is the class.
 *
 * ## The rule
 *
 * Derived from what each workflow RUNS, not from a list (RULING 147). A
 * workflow added tomorrow that ends with `pnpm diagnose` is covered by
 * existing. Nothing here widens any other scope: `actions: read` is the minimum
 * the Actions API needs for `GET /actions/runs/{id}` and its logs.
 */

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
  assert.equal(all.length, 2, `expected the two release/CI workflow files, found ${all.length}`);

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
  /*
   * The direction of the change, pinned. `permissions:` is exact — everything
   * unlisted is `none` — so the failure mode of an edit here is a scope
   * QUIETLY REMOVED, not one added. Every pusher must still declare
   * `contents: write`; `build-check.yml` must still be read-only.
   */
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
  /*
   * `checks: read` joined this on 2026-09-07 (RULING 281). The tree-equivalence
   * step asks what the required contexts reported at the candidate head, and
   * that endpoint needs it — with `contents: read` alone GitHub answers 403,
   * `scripts/certified-tree.mjs` reads that as CANNOT_TELL and takes the full
   * proof. Safe, and permanently useless, because a token that cannot see a
   * certification looks exactly like a head that did not qualify.
   *
   * THE ASSERTION STAYS EXACT, and that is the point of it. The property this
   * guards is that `build-check.yml` stays READ-ONLY: it deploys nothing and
   * pushes nothing, so no `write` scope may ever appear here. An exact map is
   * what makes adding one a diff somebody has to defend rather than a line
   * nobody notices.
   */
  assert.deepEqual(
    permissions,
    { contents: "read", checks: "read" },
    "build-check.yml deploys nothing and pushes nothing; its token stays read-only",
  );
  for (const [scope, level] of Object.entries(permissions ?? {})) {
    assert.equal(level, "read", `build-check.yml granted ${scope}: ${level} — it may only read`);
  }
});

test("THE PLANT: the guard catches a diagnoser with no Actions read", () => {
  // The defect exactly as run 33211710028 carried it.
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
