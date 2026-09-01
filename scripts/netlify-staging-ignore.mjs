#!/usr/bin/env node
/**
 * THE BRANCH-DEPLOY FILTER — ITEM I (Session C final, 2026-09-01).
 *
 * **Exit 0 CANCELS the build. Any non-zero exit lets it run.** Netlify's
 * convention, inverted from every other exit code in this repo, which is why
 * it is stated at both ends of every file that depends on it.
 *
 * ## What this replaces, and why the replacement is narrow
 *
 * `netlify.toml` carried `[context.branch-deploy] ignore = "exit 0"` — RULING
 * 124, item 1.1, 2026-08-24. That is an unconditional cancel: EVERY branch
 * deploy of this repository was cancelled before it built. The reasoning was
 * sound at the time and is quoted here so it is not lost: a branch deploy of
 * this repo was never looked at by anyone, and `.github/workflows/
 * build-check.yml` already runs the literal build command on every pull
 * request with a log readable without a Netlify login.
 *
 * ITEM I changes exactly one thing about that world: there is now a branch
 * whose deploy IS looked at, by the owner, at a real hostname —
 * `staging` → {@link STAGING_RENDER_ORIGIN}. Nothing else about RULING 124's
 * finding has changed, so nothing else about the filter changes. Every other
 * branch is still cancelled, by name, right here.
 *
 * **This is the second of two layers, and neither is sufficient alone.**
 * Netlify's own `allowed_branches` is set to `["main", "staging"]` on the site,
 * which is what actually stops a session branch from ever reaching a deploy.
 * This file is the half that lives in the repository, where it can be read,
 * diffed and reviewed without a Netlify login — and it is the half that keeps
 * working if `allowed_branches` is ever widened by hand in the dashboard.
 *
 * ## Why `staging` builds UNCONDITIONALLY — no path filter
 *
 * The production context runs `scripts/netlify-ignore.mjs`, which cancels a
 * build whose changed paths are all non-shipping (docs, paperwork). That is
 * right for production and WRONG for staging, and the reason is the promotion
 * rule rather than a preference.
 *
 * R-C10 promotes `staging` → `main` only when the staging gate record for THAT
 * EXACT SHA is green, and the gate record is keyed to the SHA the staging host
 * actually SERVES. If the path filter cancelled a staging build, the staging
 * head would move while the deployed SHA stayed behind, `deployedSha ===
 * stagingHead` would be false, and promotion would be refused — correctly, but
 * for a reason that is an artifact of this filter rather than a fact about the
 * code. A cancelled staging build does not save a wasted deploy; it
 * manufactures a stale head that the promotion gate then has to refuse.
 *
 * So: on `staging`, every push builds. That is the cheap failure.
 */

import { pathToFileURL } from "node:url";

import { hostOf, STAGING_RENDER_ORIGIN } from "../lib/ops/origins.ts";

/**
 * The one branch whose deploys are wanted. Everything else is cancelled.
 *
 * **DERIVED, never typed.** Measured on the Netlify API on 2026-09-01:
 * `branch_deploy_custom_domain` is a SUFFIX, not a per-branch map. Setting it
 * to the STAGING host made Netlify create a wildcard DNS record one level
 * BELOW it; setting it to the APEX made it create the apex wildcard instead.
 * So a branch deploy is served at
 * `<branch-name>.<suffix>` and NOTHING maps an arbitrary branch to an
 * arbitrary subdomain. Probed the same day:
 * an unused `<branch>.<apex>/api/build` resolves, presents a valid
 * certificate off the apex wildcard, and returns 404 — Netlify
 * answering "no branch deploy by that name".
 *
 * **The branch name and the subdomain label are therefore ONE FACT.** Writing
 * them down twice is how they come to disagree, which is the entire argument
 * of `lib/ops/origins.ts`. So the branch name is computed from the committed
 * origin: whatever label {@link STAGING_RENDER_ORIGIN} carries IS the branch
 * that must exist. Point the origin somewhere else and this follows it.
 */
export const STAGING_BRANCH = hostOf(STAGING_RENDER_ORIGIN).split(".")[0];

const BUILD = 1; // non-zero: let the build run
const CANCEL = 0; // zero: cancel the build

function log(line) {
  console.log(`netlify-staging-ignore · ${line}`);
}

/**
 * The decision, as a pure function, so `tests/netlify-staging-ignore.test.ts`
 * can assert both branches without spawning a build (RULING 103 — one
 * implementation of one comparison).
 *
 * @param {string | undefined} branch the Netlify `BRANCH` environment variable
 * @returns {{ verdict: "build" | "cancel"; reason: string }}
 */
export function classifyBranchDeploy(branch) {
  const name = (branch ?? "").trim();
  if (name === "") {
    // Every failure path builds. A filter that cancelled on its own confusion
    // would leave the owner testing a head that is not the head, and RULING 24
    // is explicit that a check which cannot reach its subject must never print
    // like a passing one. A wasted build is the cheap failure.
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
// (An env-var opt-out would be a flag a build could get wrong; this cannot be.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
