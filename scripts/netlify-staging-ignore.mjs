#!/usr/bin/env node
/**
 * The branch-deploy filter.
 *
 * **Exit 0 CANCELS the build. Any non-zero exit lets it run.** Netlify's
 * convention, inverted from every other exit code in this repo.
 *
 * Every branch deploy is cancelled except `staging` → {@link STAGING_RENDER_ORIGIN},
 * whose deploy is looked at. Netlify's own `allowed_branches` on the site is the
 * other layer; this file keeps working if that is ever widened by hand.
 *
 * `staging` builds unconditionally, with no path filter: promotion to `main`
 * requires the staging gate record for the exact SHA the staging host serves,
 * so a cancelled staging build would leave a stale head the gate must refuse.
 */

import { pathToFileURL } from "node:url";

import { hostOf, STAGING_RENDER_ORIGIN } from "../lib/ops/origins.ts";

/**
 * The one branch whose deploys are wanted. Everything else is cancelled.
 *
 * Derived, never typed: Netlify serves a branch deploy at
 * `<branch-name>.<suffix>`, so the branch name and the staging origin's
 * subdomain label are one fact, computed from {@link STAGING_RENDER_ORIGIN}.
 */
export const STAGING_BRANCH = hostOf(STAGING_RENDER_ORIGIN).split(".")[0];

const BUILD = 1; // non-zero: let the build run
const CANCEL = 0; // zero: cancel the build

function log(line) {
  console.log(`netlify-staging-ignore · ${line}`);
}

/**
 * The decision, as a pure function, so `tests/netlify-staging-ignore.test.ts`
 * can assert both branches without spawning a build.
 *
 * @param {string | undefined} branch the Netlify `BRANCH` environment variable
 * @returns {{ verdict: "build" | "cancel"; reason: string }}
 */
export function classifyBranchDeploy(branch) {
  const name = (branch ?? "").trim();
  if (name === "") {
    // Every failure path builds: a wasted build is the cheap failure.
    return { verdict: "build", reason: "BRANCH is unset — cannot tell which branch this is, so building" };
  }
  if (name === STAGING_BRANCH) {
    return {
      verdict: "build",
      reason: `branch is ${STAGING_BRANCH} — the integration branch serving ${hostOf(STAGING_RENDER_ORIGIN)}; builds unconditionally so the deployed SHA tracks the staging head`,
    };
  }
  return {
    verdict: "cancel",
    reason: `branch is ${name}, not ${STAGING_BRANCH} — RULING 124 item 1.1 stands for every branch but the integration branch`,
  };
}

function main() {
  const branch = process.env.BRANCH;
  const context = process.env.CONTEXT || "branch-deploy";
  const head = (process.env.COMMIT_REF || "").slice(0, 7) || "-";
  log(`context=${context} branch=${branch || "?"} head=${head}`);
  const decision = classifyBranchDeploy(branch);
  log(`${decision.verdict.toUpperCase()} — ${decision.reason}`);
  process.exit(decision.verdict === "cancel" ? CANCEL : BUILD);
}

// Importable for the test, executable for Netlify: run `main` only when this
// file IS the entry point, never when a test imports `classifyBranchDeploy`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
