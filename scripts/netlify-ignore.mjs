#!/usr/bin/env node
/**
 * THE DEPLOY FILTER. Netlify runs this before the build command.
 *
 * **Exit 0 CANCELS the build. Any non-zero exit lets it run.** That is
 * Netlify's convention and it is inverted from every other exit code in this
 * repo, so it is stated here rather than left to be remembered.
 *
 * The allowlist and its reasoning live in `lib/ops/deploy-paths.ts`, the one
 * implementation; this file is the adapter between Netlify's environment and
 * that predicate.
 *
 * ## EVERY FAILURE PATH BUILDS
 *
 * The predicate cannot load, git is unavailable, the clone is shallow, there is
 * no cached deploy to diff against — every one of those exits non-zero and the
 * build runs. A filter that cancelled on its own confusion would serve stale
 * data to readers with nothing going red; a wasted build is the cheap failure.
 *
 * Netlify supplies `CACHED_COMMIT_REF` (the commit of the last successful
 * deploy for this context), `COMMIT_REF`, `CONTEXT` and `BRANCH`.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BUILD = 1; // non-zero: let the build run
const CANCEL = 0; // zero: cancel the build

function log(line) {
  console.log(`netlify-ignore · ${line}`);
}

const git = gitFor(ROOT);

/**
 * The changed-file list, or `null` when it could not be computed.
 *
 * `null` is not "nothing changed". Keeping them apart is the whole reason this
 * returns a nullable rather than an empty array on failure.
 */
function changedPaths(cached, head) {
  if (!cached || !head) {
    log(`no ref pair (cached=${cached || "unset"} head=${head || "unset"}) — cannot diff`);
    return null;
  }
  if (cached === head) {
    log("cached ref equals head — a redeploy of the same commit; building");
    return null;
  }
  // A shallow clone will not have the cached commit. Fetch it rather than
  // guessing; if that fails, say so and build.
  if (git("cat-file", "-e", `${cached}^{commit}`) === null) {
    log(`cached commit ${cached.slice(0, 7)} is not in this clone — fetching it`);
    spawnSync("git", ["fetch", "--depth=100", "origin", cached], { cwd: ROOT, stdio: "ignore" });
    if (git("cat-file", "-e", `${cached}^{commit}`) === null) {
      log("still not present after fetch — cannot diff");
      return null;
    }
  }
  const out = git("diff", "--name-only", `${cached}..${head}`);
  if (out === null) {
    log("git diff failed — cannot diff");
    return null;
  }
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

async function main() {
  const context = process.env.CONTEXT || "production";
  const cached = process.env.CACHED_COMMIT_REF || "";
  const head = process.env.COMMIT_REF || git("rev-parse", "HEAD") || "";

  log(`context=${context} branch=${process.env.BRANCH || "?"} cached=${cached.slice(0, 7) || "-"} head=${head.slice(0, 7) || "-"}`);

  if (context === "deploy-preview") {
    // A preview builds only when its branch asks for one: the word "preview" as its own
    // segment of the branch name (e.g. "claude/s9-map-preview" or "preview/map"). The
    // repository is private and Netlify cannot expose a secret to builds, so the rule
    // reads only the branch name and never calls GitHub.
    const branch = process.env.HEAD || process.env.BRANCH || "";
    const preview = /(^|[/_-])preview($|[/_-])/i.test(branch);
    log(preview ? `BUILD — branch "${branch}" asks for a preview` : `CANCEL — branch "${branch}" does not ask for a preview`);
    process.exit(preview ? BUILD : CANCEL);
  }

  let classifyDeploy;
  try {
    ({ classifyDeploy } = await import("../lib/ops/deploy-paths.ts"));
  } catch (err) {
    log(`could not load the predicate (${err?.message ?? err}) — BUILDING`);
    if (process.argv.includes("--ci")) {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "build=yes\n");
      return;
    }
    process.exit(BUILD);
  }

  // Non-production contexts are decided without a diff: previews and branch
  // deploys do not build at all.
  if (context !== "production") {
    const d = classifyDeploy([], context);
    log(`${d.verdict.toUpperCase()} — ${d.reason}`);
    process.exit(d.verdict === "cancel" ? CANCEL : BUILD);
  }

  const changed = changedPaths(cached, head);
  const decision = classifyDeploy(changed, context);

  if (changed) {
    log(`${changed.length} changed path(s): ${decision.shipping.length} shipping, ${decision.nonShipping.length} non-shipping`);
    for (const p of decision.shipping.slice(0, 10)) log(`  SHIPPING     ${p}`);
    if (decision.shipping.length > 10) log(`  … and ${decision.shipping.length - 10} more shipping path(s)`);
    for (const p of decision.nonShipping.slice(0, 10)) log(`  non-shipping ${p}`);
    if (decision.nonShipping.length > 10) log(`  … and ${decision.nonShipping.length - 10} more non-shipping path(s)`);
  }

  log(`${decision.verdict.toUpperCase()} — ${decision.reason}`);
  if (process.argv.includes("--ci")) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build=${decision.verdict === "cancel" ? "no" : "yes"}\n`);
    return;
  }
  process.exit(decision.verdict === "cancel" ? CANCEL : BUILD);
}

await main();
