#!/usr/bin/env node
/**
 * Classify whether a production observation is still owed for this commit.
 *
 * The shared deploy predicate identifies software changes, but cancelling
 * observation also requires a complete served-to-candidate range and a fresh
 * canonical receipt for production. It does not classify CI cost: Build Check certifies every ordinary
 * push and every ready pull request, while draft PR state is handled by the
 * separate PR-event classifier.
 */

import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = gitFor(ROOT);

function arg(name) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function emit(file, line) {
  if (file) appendFileSync(file, `${line}\n`, "utf8");
}

function log(line) {
  console.log(`deploy-classify · ${line}`);
}

async function main() {
  const sha = arg("sha") ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD") ?? "";
  const output = process.env.GITHUB_OUTPUT;
  const summary = process.env.GITHUB_STEP_SUMMARY;

  let scope;
  try {
    const { observationScope } = await import("./deploy-observation-scope.mjs");
    const { fetchServedCommit, PRODUCTION_BASE_URL } = await import("./post-deploy-observer.mts");
    const { readIntegrityAuthority } = await import("./production-integrity-authority.mts");
    scope = await observationScope(ROOT, sha, {
      observe: () => fetchServedCommit(PRODUCTION_BASE_URL),
      readAuthority: readIntegrityAuthority,
      force: process.env.GITHUB_EVENT_NAME !== "push",
    });
  } catch (error) {
    log(`could not establish observation scope (${error?.name ?? "error"}) — observing fail-closed`);
    emit(output, "deploy=cannot-tell");
    return 0;
  }

  const verdict = scope.action === "skip" ? "cancel" : "build";
  log(`sha=${sha.slice(0, 7) || "-"} deploy=${verdict} observation=${scope.action}`);
  log(scope.reason);

  emit(output, `deploy=${verdict}`);
  emit(
    summary,
    [
      `### Deploy classification — \`${sha.slice(0, 7) || "unknown"}\``,
      "",
      `- **deploy** \`${verdict}\``,
      `- ${scope.reason}`,
      "",
    ].join("\n"),
  );
  return 0;
}

process.exitCode = await main();
