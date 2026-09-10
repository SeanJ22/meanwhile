/**
 * READ-ONLY, NON-AUTHORITATIVE MapTiler diagnostic.
 *
 * The standing owner-snapshot child performs the production collection and
 * publishes its outcome directly to the canonical control plane. This command
 * is retained only so an operator can ask the same provider question at a
 * terminal. It prints the answer and exits: it writes no file, publishes no
 * snapshot, changes no authority, and is never called by GitHub Actions.
 */

import { collectMapTilerUsage } from "../lib/control-plane/maptiler/collector.ts";
import { projectPanel } from "../lib/control-plane/maptiler/usage.ts";

export const MAPTILER_USAGE_DIAGNOSTIC_ROLE = "READ_ONLY_NON_AUTHORITATIVE" as const;

function log(line: string): void {
  console.log(`maptiler:usage · ${line}`);
}

async function main(): Promise<void> {
  const snapshot = await collectMapTilerUsage();
  const panel = projectPanel({ snapshot });

  log(`${MAPTILER_USAGE_DIAGNOSTIC_ROLE} · ${panel.says}`);
  if (panel.latestAttemptSays) log(panel.latestAttemptSays);
  for (const row of panel.byKey) {
    log(`  key ${row.label}: ${row.requests.toLocaleString("en-US")} request(s) · ${row.expectation}`);
  }
  for (const row of panel.byService) {
    log(`  service ${row.service}: ${row.requests.toLocaleString("en-US")} request(s)`);
  }
  log(`  Reader-event comparison: ${panel.actors?.says ?? "unknown"}`);
  if (panel.burn) log(`  burn: ${panel.burn.says}`);
  for (const need of panel.needsOwner) log(`  NEEDS OWNER: ${need}`);

  if (panel.readingState === "UNKNOWN") process.exitCode = 1;
}

await main();
