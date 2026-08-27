/**
 * `pnpm workstream:close` — the GENERATED handoff.
 *
 * RULING 180: the repository generates the handoff, not the model. Everything
 * printed here is derived from canonical state. There is no path by which a
 * session narrates the remainder, and **no "the rest", no omitted tail** — if
 * the open list is long, that is the truth about the work.
 *
 * `--status` prints the same thing without the close-out framing, which is what
 * `pnpm workstream:status` runs.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import {
  generateHandoff,
  validateWorkstream,
  type Workstream,
} from "../lib/workstate/workstream.ts";
import { classifySessionStop, type SessionStatus } from "../lib/workstate/types.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WS_DIR = join(ROOT, "data", "workstate");
const METHOD = join(ROOT, "data", "method", "knowledge.json");
const TODAY = process.env.WTP_TODAY ?? "2026-08-26";

const argv = process.argv.slice(2);
const statusOnly = argv.includes("--status");
const full = argv.includes("--full");
/**
 * The stop ACCOUNTING is the input. The session STATUS is derived from it.
 *
 * That inversion is RULING 187, and it is the whole of the amendment: a session
 * used to name its own status, and a well-preserved early stop could therefore
 * report a label that read as success. Now the session supplies measured
 * numbers and the state decides what they mean — and a status the numbers do
 * not support is refused by name.
 *
 * `--context-used` is REQUIRED unless the run is complete. Where the
 * environment exposes usage directly, that reading is passed here rather than
 * inferred.
 */
const num = (name: string, fallback: number): number => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const contextUsed = num("context-used", Number.NaN);
const stopReason = argv[argv.indexOf("--stop-reason") + 1] ?? "";
const externalStop = argv.includes("--external-stop");
const platformSignalledLimit = argv.includes("--platform-limit");

const methodVersion = existsSync(METHOD)
  ? (JSON.parse(readFileSync(METHOD, "utf8")) as { version: number }).version
  : 0;

if (!existsSync(WS_DIR)) {
  console.log("no workstreams — nothing to hand off");
  process.exit(0);
}

const files = readdirSync(WS_DIR).filter((f) => f.endsWith(".json") && f !== "migration-summary.json");

// RULING 159 — a close-out that found no workstreams in a directory that exists
// is a broken read, not a clean desk. It must fail loudly rather than print an
// empty, reassuring handoff.
floored(
  "workstream:close workstreams",
  "data/workstate/*.json",
  readdirSync(WS_DIR).length,
  files.length,
);

let anyIssue = 0;

// The owed count is DERIVED across every workstream, not asserted. A session
// cannot understate what it is leaving behind in order to look complete.
let owedAcrossAll = 0;
for (const f of files) {
  const w = JSON.parse(readFileSync(join(WS_DIR, f), "utf8")) as Workstream;
  const h = generateHandoff(
    w,
    { today: TODAY, methodVersion, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
    "EARLY_HANDOFF_WITH_CAPACITY",
  );
  owedAcrossAll += h.open.length + h.discoveredNotProcessed.length + h.recheckDue.length;
}

const verdict = classifySessionStop(
  {
    contextUsedPercent: Number.isFinite(contextUsed) ? contextUsed : 0,
    contextRemainingPercent: Number.isFinite(contextUsed) ? 100 - contextUsed : 100,
    stopReason: stopReason || "not stated",
    executableOwedWorkRemaining: owedAcrossAll,
    externalStop,
    platformSignalledLimit,
    statePersisted: true,
    productiveUntilBoundary: !argv.includes("--stopped-short"),
  },
  argv.includes("--claim") ? (argv[argv.indexOf("--claim") + 1] as SessionStatus) : undefined,
);
const sessionStatus = verdict.status;

if (!statusOnly) {
  console.log("=".repeat(72));
  console.log("STOP ACCOUNTING (RULING 187)");
  console.log("=".repeat(72));
  console.log(
    `context_used_percent            ${Number.isFinite(contextUsed) ? contextUsed : "NOT MEASURED — pass --context-used"}`,
  );
  console.log(
    `context_remaining_percent       ${Number.isFinite(contextUsed) ? 100 - contextUsed : "unknown"}`,
  );
  console.log(`stop_reason                     ${stopReason || "NOT STATED — this is a defect"}`);
  console.log(`executable_owed_work_remaining  ${owedAcrossAll}   (derived, not asserted)`);
  console.log(`external_stop                   ${externalStop}`);
  console.log("");
  console.log(`SESSION STATUS: ${sessionStatus}`);
  console.log(`  because: ${verdict.reason}`);
  if (verdict.refused) {
    console.log(`  REFUSED CLAIM: the session claimed ${verdict.refused}; the state does not support it`);
  }
  console.log("");
}

for (const f of files) {
  const w = JSON.parse(readFileSync(join(WS_DIR, f), "utf8")) as Workstream;
  const now = { today: TODAY, methodVersion, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION };
  const issues = validateWorkstream(w, now);
  const h = generateHandoff(w, now, sessionStatus);

  console.log("=".repeat(72));
  console.log(statusOnly ? `WORKSTREAM STATUS — ${w.id}` : `SESSION CLOSE-OUT — ${w.id}`);
  console.log("=".repeat(72));
  if (!statusOnly) console.log(`SESSION STATUS:    ${h.session}`);
  console.log(`WORKSTREAM STATUS: ${h.workstream}`);
  console.log(`GRAPH STATUS:      ${h.graph}`);
  console.log("");
  console.log(`METHOD VERSION AT CLOSE:          ${h.methodVersion}`);
  console.log(`ROUTES INHERITED:                 ${h.routesInherited}`);
  console.log(`NEW ROUTES LEARNED THIS SESSION:  ${h.routesLearned}`);
  console.log("");
  console.log("EXACT RESUME CURSOR:");
  console.log(`  ${h.resumeCursor ?? "*** NONE — an OPEN workstream with no cursor is a defect ***"}`);
  console.log("");
  console.log(
    `CANDIDATES: ${h.candidates.candidates} lead(s) | ` +
      `${h.candidates.verified} verified | ${h.candidates.promoted} PROMOTED BODIES | ` +
      `${h.candidates.duplicates} duplicate | ${h.candidates.rejected} rejected | ` +
      `${h.candidates.needsClassification} unclassified`,
  );
  console.log(`  coverage numerator is ${h.candidates.coverageNumerator} — leads never count toward it`);
  console.log("");

  const section = (name: string, xs: readonly string[]) => {
    console.log(`${name} (${xs.length}):`);
    if (xs.length === 0) {
      console.log("  none");
      return;
    }
    // Long lists are TRUNCATED FOR DISPLAY ONLY, and the omission is stated
    // with its exact number. The canonical list is on disk in full — a handoff
    // that silently clipped its tail would be the silent-trim shape this
    // repository names most often.
    const show = full ? xs : xs.slice(0, 12);
    for (const x of show) console.log(`  ${x}`);
    if (!full && xs.length > show.length) {
      console.log(`  ... ${xs.length - show.length} more — run with --full, or read data/workstate/${f}`);
    }
  };

  section("OPEN", h.open);
  section(
    "BLOCKED",
    h.blocked.map((b) => `${b.id}: ${b.reason}`),
  );
  section("DISCOVERED NOT YET PROCESSED", h.discoveredNotProcessed);
  section("RECHECK DUE", h.recheckDue);
  section("PERMISSION UNRESOLVED (CANNOT_TELL — neither allowed nor disallowed)", h.permissionUnresolved);
  console.log("");
  console.log(`WHY THIS IS NOT COMPLETE (${h.blockedBy.length}):`);
  for (const b of h.blockedBy) console.log(`  - ${b}`);
  console.log("");
  if (issues.length) {
    anyIssue += issues.length;
    console.log(`WORK-STATE VALIDATION FAILURES (${issues.length}):`);
    for (const i of issues.slice(0, 20)) console.log(`  ${i.id} ${i.rule}: ${i.detail}`);
    if (issues.length > 20) console.log(`  ... and ${issues.length - 20} more`);
    console.log("");
  }
}

if (anyIssue > 0) {
  console.error(`workstream close FAILED — ${anyIssue} work-state validation problem(s)`);
  process.exit(1);
}
