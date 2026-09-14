#!/usr/bin/env node
/**
 * Classify whether one commit could have produced a production deploy.
 *
 * This adapter exists only for the software-release boundary shared with
 * Netlify. It does not classify CI cost: Build Check certifies every ordinary
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

function changedPaths(sha) {
  const output = git("show", "--name-only", "--format=", sha);
  if (output === null) return null;
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function main() {
  const sha = arg("sha") ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD") ?? "";
  const output = process.env.GITHUB_OUTPUT;
  const summary = process.env.GITHUB_STEP_SUMMARY;

  let classifyDeploy;
  try {
    ({ classifyDeploy } = await import("../lib/ops/deploy-paths.ts"));
  } catch (error) {
    log(`could not load the deploy predicate (${error?.message ?? error}) — observing fail-closed`);
    emit(output, "deploy=cannot-tell");
    return 0;
  }

  const changed = sha ? changedPaths(sha) : null;
  const decision = classifyDeploy(changed);
  log(`sha=${sha.slice(0, 7) || "-"} deploy=${decision.verdict}`);
  log(decision.reason);
  for (const path of decision.shipping.slice(0, 10)) log(`  shipping ${path}`);
  for (const path of decision.nonShipping.slice(0, 10)) log(`  non-shipping ${path}`);

  emit(output, `deploy=${decision.verdict}`);
  emit(
    summary,
    [
      `### Deploy classification — \`${sha.slice(0, 7) || "unknown"}\``,
      "",
      `- **deploy** \`${decision.verdict}\``,
      `- ${decision.reason}`,
      "",
    ].join("\n"),
  );
  return 0;
}

process.exitCode = await main();
