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
import {
  CREDENTIAL_EVENTS_PATH,
  SESSION_REPORT_GATE_REFUSED,
  loadCredentialReports,
  sessionReportGateLines,
} from "../lib/ops/credential-report.ts";

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
 * That inversion came in with RULING 187 and survives its retirement: a session used to
 * name its own status, and a well-preserved early stop could therefore report a
 * label that read as success.
 *
 * **What RULING 189 removed is the fake measurement.** This command used to
 * require `--context-used` and classify from it — asking the model for a number
 * it cannot know, and then treating the guess as evidence. One session reported
 * ~4% while the interface showed roughly 47%.
 *
 * So there is no percentage here, and no proxy for one. The inputs are a
 * specific stop reason, whether the AUTHOR stopped the session, whether an
 * ACTUAL external condition prevented continuing, and the owed-work count —
 * which is derived below rather than asserted.
 */
const stopReason = argv[argv.indexOf("--stop-reason") + 1] ?? "";
const authorStop = argv.includes("--author-stop");
const externalStop = argv.includes("--external-stop");

// A removed flag is REFUSED rather than ignored. A session carrying the old
// invocation forward would otherwise be told nothing, and would go on believing
// its context estimate had been recorded and had meant something.
const REMOVED = ["--context-used", "--platform-limit", "--stopped-short"];
const stale = REMOVED.filter((r) => argv.includes(r));
if (stale.length) {
  console.error(`${stale.join(", ")} was removed by RULING 189 (2026-08-27).`);
  console.error("A session cannot measure its own context, so no status is derived from an");
  console.error("estimate of it. Pass --stop-reason, and --author-stop or --external-stop only");
  console.error("when one of those actually happened.");
  process.exit(2);
}

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
    "EARLY_HANDOFF",
  );
  owedAcrossAll += h.open.length + h.discoveredNotProcessed.length + h.recheckDue.length;
}

const verdict = classifySessionStop(
  {
    stopReason: stopReason || "not stated",
    executableOwedWorkRemaining: owedAcrossAll,
    authorStop,
    externalStop,
    statePersisted: true,
  },
  argv.includes("--claim") ? (argv[argv.indexOf("--claim") + 1] as SessionStatus) : undefined,
);
const sessionStatus = verdict.status;

// THE CREDENTIAL REPORT GATE — runs on BOTH the --status and close paths, before
// any handoff is printed. A credential created or rotated this session must be
// reported by name, provider, context, scope, actor and owner-copy location
// (lib/ops/credential-report.ts); a report lacking any of those refuses the
// session report outright, so the handoff below is not generated until the
// report is complete. `WTP_CREDENTIAL_EVENTS` overrides the file path (tests).
{
  const eventsPath = process.env.WTP_CREDENTIAL_EVENTS ?? CREDENTIAL_EVENTS_PATH;
  console.log("=".repeat(72));
  console.log("CREDENTIAL REPORTS (owner-copy-before-install)");
  console.log("=".repeat(72));
  const loaded = (() => {
    try {
      return loadCredentialReports(ROOT, eventsPath);
    } catch (e) {
      // A present file that cannot be read is never zero events.
      console.log(`credential reports: UNREADABLE — ${(e as Error).message}`);
      console.log(`${SESSION_REPORT_GATE_REFUSED} — the credential event log could not be read`);
      process.exit(1);
    }
  })();
  const gate = sessionReportGateLines(loaded, eventsPath);
  for (const line of gate.lines) console.log(line);
  console.log("");
  if (gate.refused) {
    console.log(`complete the deficient report in ${eventsPath} and re-run; no handoff is generated`);
    console.log("while the session report is refused.");
    process.exit(1);
  }
}

if (!statusOnly) {
  console.log("=".repeat(72));
  console.log("STOP ACCOUNTING (RULING 180, amended by RULING 189)");
  console.log("=".repeat(72));
  console.log(`stop_reason                     ${stopReason || "NOT STATED — this is a defect"}`);
  console.log(`executable_owed_work_remaining  ${owedAcrossAll}   (derived, not asserted)`);
  console.log(`author_stop                     ${authorStop}`);
  console.log(`external_stop                   ${externalStop}`);
  console.log("");
  console.log("No context percentage is recorded, and none is asked for: a session cannot");
  console.log("measure its own capacity, and a guess dressed as a measurement bought a status");
  console.log("that reads as success (RULING 189). Keep working while authorized executable");
  console.log("work remains.");
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
