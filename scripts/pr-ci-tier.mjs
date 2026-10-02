#!/usr/bin/env node
/**
 * Bare-Node adapter for the draft/full pull-request CI classifier.
 *
 * This runs before dependency installation. The predicate is dependency-free,
 * and any unreadable input or import failure selects the full tier.
 */

import { appendFileSync } from "node:fs";

function draftValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function labelsValue(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

function emit(line) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`, "utf8");
  }
}

async function main() {
  let decision = {
    tier: "full",
    reason: "the classifier could not be loaded, so CI fails closed",
  };

  try {
    const { classifyPullRequestCiTier } = await import("../lib/ops/pull-request-ci-tier.ts");
    decision = classifyPullRequestCiTier({
      eventName: process.env.WTP_EVENT_NAME,
      action: process.env.WTP_EVENT_ACTION,
      draft: draftValue(process.env.WTP_PR_DRAFT),
      autoMerge: draftValue(process.env.WTP_PR_AUTO_MERGE),
      labels: labelsValue(process.env.WTP_PR_LABELS),
    });
  } catch (error) {
    console.log(`pr-ci-tier · ${decision.reason}: ${error?.message ?? error}`);
  }

  emit(`tier=${decision.tier}`);
  console.log(`pr-ci-tier · ${decision.tier.toUpperCase()} — ${decision.reason}`);
}

await main();
