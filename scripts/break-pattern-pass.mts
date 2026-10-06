#!/usr/bin/env node
/**
 * **ONE BREAK-PATTERN PASS.** (DP-32.)
 *
 * Reads the fix list's history and writes a field-manual lesson for each door
 * or method that breaks in the same month across years, so the next fix is
 * ready first. Plain code, no model, no reader store. Daily is plenty.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/break-pattern-pass.mts
 * Exit 0 with a one-line summary; exit 1 when the control plane is not configured or the lesson write failed.
 */
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { runBreakPatternPass } from "../lib/method/break-patterns.ts";

const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("break patterns: the control plane is not configured; nothing was read");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });
const out = await runBreakPatternPass(repos, now);
if (out.error) {
  console.error(`break patterns: ${out.patterns} found, lessons not saved: ${out.error}`);
  process.exit(1);
}
console.log(`break patterns: ${out.patterns} found, ${out.written} lessons written`);
