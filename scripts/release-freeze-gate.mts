/**
 * `pnpm release:freeze` — the gate a frozen release cannot get past. NH273.
 *
 * This is the enforcement half. `scripts/production-integrity.mts` records what
 * production said; this refuses the next production-changing release while that
 * record is DEGRADED.
 *
 * IT LIVES IN THE `gates` JOB, and that placement is the design.
 * `.github/workflows/build-check.yml`'s `gates` job is the required context
 * branch protection names, it already runs on every pull request and on every
 * push to `main`, and it is where `pnpm gates` and the schema shipping gate
 * already live. A tenth workflow would be a second shipping verdict — and a
 * `deployment_status` one would be worse than that, because
 * `gh api repos/:owner/:repo/deployments` returns 0 for this repository and
 * such a workflow would never fire at all.
 *
 * SCOPED, so paperwork is not punished for the database's condition. The freeze
 * reaches only changes that could alter what production serves, and
 * `classifyDeploy` — the same predicate `scripts/netlify-ignore.mjs` gives
 * Netlify — is the authority on that. A docs-only close-out follows ordinary
 * shipping law and is never treated as a production release.
 *
 * THERE IS NO SKIP FLAG. An escape hatch on a gate is how a gate stops meaning
 * anything, and this one exists because three green checks once said nothing
 * false while production served a schema the deployed code did not have.
 *
 *   --paths=a,b,c   state the changed-path list explicitly
 *   --sha=<commit>  the commit whose release is being considered
 *
 * Exit codes:
 *   0  permitted (with the integrity state always printed, green or not)
 *   1  FROZEN
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { evaluateReleaseFreeze, explainFreeze } from "../lib/ops/production-integrity.ts";
// `git` comes from the reader beside it rather than being written out again —
// RULING 103. The two copies were identical, and this mechanism turns on the
// difference between "the answer is no" and "there was no answer".
import { git, readRecord } from "./production-integrity.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * The changed-path list, or `null`.
 *
 * `null` means the list could not be computed, and it is deliberately NOT an
 * empty list: an empty list is a real measurement and `null` is the absence of
 * one. Both `classifyDeploy` and `touchesSchemaContract` read `null` as the
 * cautious answer, so a gate that cannot see what changed refuses rather than
 * waves through.
 */
function changedPaths(): { paths: readonly string[] | null; how: string } {
  const stated = arg("paths");
  if (stated !== undefined) {
    return { paths: stated.split(",").map((p) => p.trim()).filter(Boolean), how: "stated on the command line" };
  }

  const event = process.env.GITHUB_EVENT_NAME;
  if (event === "pull_request" || event === "push") {
    const base = event === "pull_request" ? "origin/main" : "HEAD~1";
    const diff = git("diff", "--name-only", `${base}...HEAD`) ?? git("diff", "--name-only", base, "HEAD");
    if (diff !== null) {
      return { paths: diff.split("\n").filter(Boolean), how: `git diff against ${base}` };
    }
    return { paths: null, how: "the diff could not be read on this checkout" };
  }

  const diff = git("diff", "--name-only", "origin/main...HEAD");
  const status = git("status", "--porcelain");
  if (diff === null && status === null) {
    return { paths: null, how: "neither the branch diff nor the working tree could be read" };
  }
  const fromStatus = (status ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p));
  const all = new Set([...(diff ?? "").split("\n").filter(Boolean), ...fromStatus]);
  return { paths: [...all], how: "origin/main...HEAD plus the working tree" };
}

function main(): void {
  const record = readRecord();
  const { paths, how } = changedPaths();
  const candidateSha = arg("sha") ?? git("rev-parse", "HEAD");

  const verdict = evaluateReleaseFreeze({ record, candidateSha, changedPaths: paths });

  console.log("RELEASE FREEZE GATE (NH273)");
  console.log(`  candidate      ${candidateSha ?? "UNKNOWN"}`);

  // RULING 159: the changed-path count is FLOORED, and the floor reports the
  // split rather than a bare total — how many of the paths are production-
  // bearing is the number the freeze actually turns on. A commit that genuinely
  // touched nothing states that as its reason; a list that could not be READ is
  // a different answer entirely and is printed as one.
  if (paths === null) {
    console.log(`  changed paths  COULD NOT BE READ (${how})`);
  } else {
    const split = classifyDeploy(paths);
    const count = floored(
      "changed paths that are production-bearing",
      how,
      paths.length,
      split.shipping.length,
      paths.length === 0 ? "the commit changed no files at all" : undefined,
    );
    console.log(
      count.outcome === "MEASURED"
        ? `  changed paths  ${count.matched} of ${count.denominator} are production-bearing (${how})`
        : `  changed paths  COULD NOT ASSERT — ${count.reason}`,
    );
  }
  console.log(`  last reading   ${record.observed}${record.failureClass ? ` (${record.failureClass})` : ""}`);
  console.log(`                 taken ${record.observedAt ?? "never"} against ${record.deployedSha ?? "no commit"}`);
  console.log("");
  console.log(explainFreeze(verdict));

  if (verdict.frozen) {
    console.log("");
    console.log("There is no skip flag. Clear the freeze by fixing production and re-reading it:");
    console.log("  pnpm integrity:check --write");
    process.exit(1);
  }
  process.exit(0);
}

main();
