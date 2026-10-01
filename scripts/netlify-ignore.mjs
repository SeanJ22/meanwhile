#!/usr/bin/env node
/**
 * THE DEPLOY FILTER. Netlify runs this before the build command.
 *
 * **Exit 0 CANCELS the build. Any non-zero exit lets it run.** That is
 * Netlify's convention and it is inverted from every other exit code in this
 * repo, so it is stated here rather than left to be remembered.
 *
 * Sean's instruction of 2026-08-24 — RULING 124. The reasoning, the measured
 * before-and-after, and the allowlist itself all live in
 * `lib/ops/deploy-paths.ts`, which is the ONE implementation (RULING 103);
 * this file is the adapter between Netlify's environment and that predicate.
 *
 * ## EVERY FAILURE PATH BUILDS
 *
 * The predicate cannot load, git is unavailable, the clone is shallow, there is
 * no cached deploy to diff against — every one of those exits non-zero and the
 * build runs. A filter that cancelled on its own confusion would serve stale
 * data to readers with nothing going red, and RULING 24 is explicit that a
 * check which cannot reach its subject must never print like a passing one.
 * A wasted build is the cheap failure and it is the only one this can produce.
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

/* `git` is `gitFor(ROOT)` from ./git-lite.mjs — one copy (RULING 103). */
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
    const pr = process.env.REVIEW_ID;
    if (!/^\d+$/.test(pr ?? "")) {
      log("CANCEL — no pull request number for preview label lookup");
      process.exit(CANCEL);
    }
    try {
      const headers = { Accept: "application/vnd.github+json" };
      // The repository is private, so this lookup needs a token. WTP_GITHUB_READ_TOKEN is the
      // read-only token the site already holds; it must be exposed to the Builds scope.
      const token = process.env.WTP_GITHUB_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`https://api.github.com/repos/SeanJ22/meanwhile/issues/${pr}/labels`, {
        headers, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const labels = await response.json();
      const preview = Array.isArray(labels) && labels.some(label => label.name === "preview");
      log(preview ? "BUILD — PR has preview label" : "CANCEL — PR has no preview label");
      process.exit(preview ? BUILD : CANCEL);
    } catch (error) {
      log(`CANCEL — preview label could not be verified (${error.message})`);
      process.exit(CANCEL);
    }
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
