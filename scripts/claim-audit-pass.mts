#!/usr/bin/env node
/**
 * Daily: re-measures each Proven label on today's fix map. Weekly: samples the
 * week's claimed wins and Proven labels and recomputes each from the fix map.
 * A rerun in the same week does nothing.
 *
 * `--controlled` feeds a false claim through the same checks against
 * in-memory records, writes nothing, and exits 0 only if it is caught.
 */
import { neon } from "@neondatabase/serverless";

import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { auditClaims, runClaimAuditWeek } from "../lib/control-plane/workers/claim-audit.ts";
import { recheckProvenFixes } from "../lib/control-plane/fix-standing.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createFixMapRepository } from "../lib/method/fix-map.ts";
import { memoryFixMap } from "../lib/method/fix-map-record.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const now = new Date().toISOString();

if (process.argv.includes("--controlled")) {
  // A fix the fix map shows working in 2 places, claimed as proven in 5: the check must call it wrong.
  const map = memoryFixMap();
  for (const [i, state] of ["WORKS", "WORKS", "FAILS"].entries()) {
    await map.put({ methodId: "controlled-method", placeId: `controlled-place-${i}`, state: state as "WORKS" | "FAILS", triedAt: now, attemptId: `controlled-${i}`, cause: null, updatedAt: now });
  }
  const config = { apiFallback: { enabled: false }, updatedAt: now, updates: [{
    id: `fix-status:controlled-method:proven:${now}`, what: "Proven: a controlled fix worked in 5 places, failed in 0 places.", at: now, label: "PROVEN",
    evidenceHref: null, before: null, after: null, shownAt: null, claim: { kind: "FIX_PROVEN", methodId: "controlled-method", works: 5, failed: 0 },
  }] } as unknown as AdminConfig;
  const pass = await auditClaims({ config, fixMap: map, now, synthetic: true });
  const caught = pass.checks.some((c) => c.verdict === "WRONG");
  console.log(`claim audit (controlled, nothing written): ${caught ? "the false claim was caught" : "the false claim was NOT caught"}: ${pass.checks.map((c) => `${c.verdict} — ${c.cause ?? c.recomputed}`).join(" | ")}`);
  process.exit(caught ? 0 : 1);
}

const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("claim audit: the control plane is not configured; nothing was checked");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });
const sql = neon(url);
const fixMap = createFixMapRepository(async (text, params) => (await sql.query(text, [...params])) as Record<string, unknown>[]);
const broke = await recheckProvenFixes(fixMap, repos, now).catch((error: unknown) => {
  console.error(`proven recheck: could not be done: ${error instanceof Error ? error.message : String(error)}`);
  return null;
});
if (broke !== null) console.log(`proven recheck: ${broke.length} proven fix${broke.length === 1 ? "" : "es"} no longer hold${broke.length === 1 ? "s" : ""} today`);
const out = await runClaimAuditWeek(repos, fixMap, now);
if (!out.ran || out.pass === null) {
  console.log("claim audit: this week is already checked, or there is no config row; nothing to do");
  process.exit(0);
}
if (out.pass.checks.length === 0) {
  console.error(`claim audit: the pass for the week of ${out.pass.week} checked 0 claims; nothing was measured`);
  process.exit(1);
}
const count = (v: string) => out.pass!.checks.filter((c) => c.verdict === v).length;
console.log(`claim audit: ${out.pass.checks.length} claims checked for the week of ${out.pass.week}; ${count("CONFIRMED")} confirmed, ${count("WRONG")} wrong, ${count("COULD_NOT_CHECK")} could not be checked` +
  (out.lessonErrors.length ? `; lessons not saved: ${out.lessonErrors.join("; ")}` : ""));
