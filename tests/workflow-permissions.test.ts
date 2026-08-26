/**
 * **A WORKFLOW THAT PUSHES `main` DECLARES `contents: write`.**
 * (2026-08-26, found by re-dispatching Refresh after `R59`.)
 *
 * ## The defect this exists to stop coming back
 *
 * RULING 124 folded five refresh workflows into `refresh-daily.yml`. **All five
 * declared `contents: write`. The consolidated one declared nothing**, so its
 * token was read-only and `scripts/push-main.mjs` got HTTP 403 — *Write access
 * to repository not granted* — on all five of its retries, every single day.
 *
 * **Nobody saw it because the run never reached the Commit step.** Validate
 * failed first, on the F22 window guard and then on a stale generated artifact
 * behind it, so a defect at the LAST step sat behind two at an earlier one.
 *
 * That is the class this guard closes: **a consolidation that drops a
 * declaration every original carried.** A count of workflows would not have
 * caught it — `tests/push-main.test.ts` asserts how many workflows push and was
 * green throughout — because the number was right and one of them could not do
 * the thing the number said it did.
 *
 * ## Why it is derived from the workflow files rather than from a list
 *
 * RULING 147: the anchor is the thing itself. A hand-kept list of pushers would
 * agree with itself forever; this reads every workflow, asks which ones invoke
 * the push script, and holds exactly those to the declaration. A pusher added
 * tomorrow is covered by existing rather than by being remembered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, ".github", "workflows");

/** Every workflow file, read once. */
function workflows(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));
}

/**
 * Does this workflow push to `main`?
 *
 * Asked of what it RUNS rather than of a list: `scripts/push-main.mjs` is the
 * one door every pusher goes through (R48), so invoking it is the definition.
 */
function pushesMain(text: string): boolean {
  return /push-main\.mjs/.test(text);
}

/** Does it declare write access, at the top level or on the job? */
function declaresWrite(text: string): boolean {
  return /^\s*contents:\s*write\s*$/m.test(text);
}

test("every workflow that pushes main declares contents: write", () => {
  const all = workflows();

  // The floor (RULING 159). An empty directory, or a rename of the push
  // script, would leave this asserting nothing and reading green.
  assert.ok(all.length >= 5, `only ${all.length} workflow file(s) found — the sweep did not reach them`);

  const pushers = all.filter((w) => pushesMain(w.text));
  assert.ok(
    pushers.length >= 5,
    `only ${pushers.length} workflow(s) invoke push-main.mjs — either the script was renamed, ` +
      "in which case `pushesMain` is now blind, or the pushers are gone",
  );

  const missing = pushers.filter((w) => !declaresWrite(w.text)).map((w) => w.name);
  assert.deepEqual(
    missing,
    [],
    `these workflows push main with a read-only token and will 403 at the Commit step: ${missing.join(", ")}`,
  );
});

test("THE PLANT: the guard catches a pusher whose permissions block is gone", () => {
  /*
   * The instrument shown catching the real thing (RULING 110). The plant is the
   * defect exactly as it was: a workflow that runs the push script and declares
   * no write access.
   */
  const planted = [
    "name: A refresher",
    "on:",
    "  schedule:",
    "    - cron: '0 9 * * *'",
    "jobs:",
    "  refresh:",
    "    steps:",
    "      - run: node scripts/push-main.mjs",
  ].join("\n");
  assert.equal(pushesMain(planted), true, "the pusher test cannot see the push script");
  assert.equal(declaresWrite(planted), false, "the permissions test passed a workflow with none");

  // And the corrected form passes, so the guard is not simply refusing
  // everything.
  const fixed = planted.replace("jobs:", "permissions:\n  contents: write\n\njobs:");
  assert.equal(declaresWrite(fixed), true);
});

test("refresh-daily is the consolidated pusher and carries the declaration", () => {
  /*
   * Named directly, because it is the one that was broken and RULING 157 asks
   * the verification to exercise the derived case as well as the class. The
   * class assertion above is the independent half — it covers the four
   * workflows that never lost it.
   */
  const daily = workflows().find((w) => w.name === "refresh-daily.yml");
  assert.ok(daily, "refresh-daily.yml is gone");
  assert.equal(pushesMain(daily.text), true, "refresh-daily no longer pushes main");
  assert.equal(declaresWrite(daily.text), true, "refresh-daily lost contents: write again");
});
