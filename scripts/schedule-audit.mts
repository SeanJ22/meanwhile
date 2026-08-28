#!/usr/bin/env tsx
/**
 * `pnpm schedule:audit` — **WHAT EVERY OTHER INSTRUMENT IN THIS REPOSITORY IS
 * BLIND TO: A SLOT THAT PRODUCED NOTHING, AND A SLOT THAT PRODUCED SOMETHING
 * TEN HOURS LATE.** (2026-08-28.)
 *
 * `scripts/watch-workflows.mts`, `scripts/jobs-status.mts` and
 * `scripts/read-alarms.mts` all reason over a LIST OF RUNS and all detect
 * consecutive failures. A workflow that produced no runs has no failures, so
 * absence reads as health; a workflow that ran 638 minutes late succeeded, so
 * delay reads as health too. On 2026-08-28 all three crons had no run at all
 * and every instrument reported a clean board.
 *
 * This one starts from the CRON rather than from the runs. It expands each
 * workflow's schedule into the UTC slots it was due to fire at, matches the
 * scheduled runs onto those slots, and reports every slot with a denominator.
 *
 * ## IT REPORTS. IT DOES NOT GATE.
 *
 * Exit 0 on findings, deliberately. The one claim it could gate on —
 * `NO_RUN_BEYOND_ENVELOPE` — is a statement about what WE have observed, not
 * about what GitHub did (see `lib/ops/schedule-audit.ts`), and a red build
 * asserting an unprovable absence is exactly the false claim the constitution
 * refuses. It exits non-zero only when it could not READ, which is a fact about
 * this script.
 *
 * ## A ZERO-ROW READ IS A FAILED READ
 *
 * `gh` returning nothing is not a healthy schedule. Every count here goes
 * through `lib/ops/denominator-floor.ts` (RULING 159), and a workflow whose run
 * list came back empty is named as a WALL rather than printed as clean.
 *
 * ## THE STEP NAME COMES FROM `--json jobs`, NEVER `--log-failed`
 *
 * Measured 2026-08-28 on runs 32955499285, 32833989579 and 32840268606:
 * `--log-failed` labels EVERY line of these runs `UNKNOWN STEP`, so it cannot
 * attribute a failure to a step at all. `gh run view <id> --json jobs` carries
 * the real per-step conclusions. The log is still fetched — but only for its
 * TEXT, which is what separates a data failure from a push rejection.
 *
 * Run:
 *   pnpm schedule:audit                 # the last 7 days of slots
 *   pnpm schedule:audit --days=14
 *   pnpm schedule:audit --asof=<iso>    # as the audit would have read it then
 *   pnpm schedule:audit --json          # the whole audit, for another tool
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { failureTail } from "../lib/ops/job-watch-log.ts";
import { loadSecrets, redactSecrets } from "../lib/ops/secret-redaction.ts";
import {
  auditWorkflow,
  cronsInWorkflowYaml,
  deriveEnvelope,
  expectedSlots,
  observedDispatchDelays,
  tally,
  type RunObservation,
  type StepObservation,
  type WorkflowAudit,
} from "../lib/ops/schedule-audit.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const daysArg = argv.find((a) => a.startsWith("--days="))?.slice("--days=".length);
const asofArg = argv.find((a) => a.startsWith("--asof="))?.slice("--asof=".length);

const DAYS = daysArg ? Number(daysArg) : 7;
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error(`schedule:audit — --days=${daysArg} is not a positive number of days`);
  process.exit(2);
}

const NOW = asofArg ? new Date(asofArg) : new Date();
if (Number.isNaN(NOW.getTime())) {
  console.error(`schedule:audit — --asof=${asofArg} is not an instant`);
  process.exit(2);
}
const NOW_ISO = NOW.toISOString();
const FROM_ISO = new Date(NOW.getTime() - DAYS * 24 * 60 * 60 * 1000).toISOString();

/* -------------------------------------------------------------------------- */
/* READING gh                                                                  */
/* -------------------------------------------------------------------------- */

/** Every wall this run hit, named. A wall is never rendered as an emptiness. */
const walls: string[] = [];

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const SECRETS = existsSync(join(ROOT, ".env.local")) ? loadSecrets(join(ROOT, ".env.local")) : [];

/**
 * `gh run list` for one workflow.
 *
 * `startedAt` is in the field list because the whole dispatch-versus-queue
 * discrimination lives in `startedAt - createdAt`, and no existing instrument
 * in this repository asks for it.
 */
function runList(workflow: string): RunObservation[] | null {
  let raw: string;
  try {
    raw = gh([
      "run",
      "list",
      `--workflow=${workflow}`,
      "--limit",
      "100",
      "--json",
      "databaseId,status,conclusion,event,createdAt,startedAt,updatedAt",
    ]);
  } catch (error) {
    walls.push(`${workflow}: gh run list refused — ${(error as Error).message.split("\n")[0]}`);
    return null;
  }
  let parsed: RunObservation[];
  try {
    parsed = JSON.parse(raw) as RunObservation[];
  } catch {
    walls.push(`${workflow}: gh returned ${raw.length} byte(s) that are not JSON`);
    return null;
  }
  if (parsed.length === 0) {
    // RULING 159 / RULING 43: a zero-row read is a FAILED read, not an empty
    // document, and it must never print as a workflow with nothing wrong.
    walls.push(
      `${workflow}: gh run list returned ZERO runs. That is a failed read, not a healthy schedule — ` +
        `this workflow is NOT reported as clean below.`,
    );
    return null;
  }
  return parsed;
}

/** Per-step conclusions, for failures and for the landed/no-op discrimination. */
function stepsOf(runId: number): readonly StepObservation[] | undefined {
  try {
    const raw = gh(["run", "view", String(runId), "--json", "jobs"]);
    const parsed = JSON.parse(raw) as { jobs?: { steps?: StepObservation[] }[] };
    const steps = (parsed.jobs ?? []).flatMap((j) => j.steps ?? []);
    if (steps.length === 0) {
      walls.push(`run ${runId}: gh run view --json jobs carried no steps`);
      return undefined;
    }
    return steps;
  } catch (error) {
    walls.push(`run ${runId}: could not read its steps — ${(error as Error).message.split("\n")[0]}`);
    return undefined;
  }
}

/** The failing run's log text, redacted. Fetched for FAILURES ONLY. */
function failureTextOf(runId: number): string {
  return redactSecrets(
    failureTail(runId, (id) => {
      const failed = gh(["run", "view", String(id), "--log-failed"]);
      return failed.trim() === "" ? gh(["run", "view", String(id), "--log"]) : failed;
    }),
    SECRETS,
  );
}

/* -------------------------------------------------------------------------- */
/* THE SCHEDULED WORKFLOWS — READ FROM THE FILES, NEVER TYPED HERE             */
/* -------------------------------------------------------------------------- */

interface Scheduled {
  file: string;
  cron: string;
}

function scheduledWorkflows(): Scheduled[] {
  const found: Scheduled[] = [];
  for (const file of readdirSync(WORKFLOWS)) {
    if (!file.endsWith(".yml")) continue;
    const crons = cronsInWorkflowYaml(readFileSync(join(WORKFLOWS, file), "utf8"));
    for (const cron of crons) found.push({ file, cron });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

const scheduled = scheduledWorkflows();

console.log(`schedule:audit · slots from ${FROM_ISO} to ${NOW_ISO} (${DAYS} day window)`);
console.log(
  `  ${scheduled.length} scheduled workflow(s), read from .github/workflows — the cron values are never typed into TypeScript\n`,
);

if (scheduled.length === 0) {
  console.error(
    "schedule:audit · NO SCHEDULED WORKFLOW FOUND. That is a failed read of .github/workflows, not a repository with no crons — refusing to report a clean board over an empty population (RULING 159).",
  );
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* PASS ONE — READ EVERY WORKFLOW, THEN DERIVE THE ENVELOPE FROM WHAT WE SAW   */
/* -------------------------------------------------------------------------- */

interface Loaded {
  workflow: string;
  cron: string;
  runs: RunObservation[];
  slots: string[];
}

const loaded: Loaded[] = [];
for (const { file, cron } of scheduled) {
  const runs = runList(file);
  if (!runs) continue;
  let slots: string[];
  try {
    slots = expectedSlots(cron, FROM_ISO, NOW_ISO);
  } catch (error) {
    walls.push(`${file}: ${(error as Error).message}`);
    continue;
  }
  loaded.push({ workflow: file, cron, runs, slots });
}

/*
 * THE ENVELOPE IS GLOBAL ACROSS THE THREE WORKFLOWS, ON PURPOSE.
 *
 * Dispatch delay is a property of GitHub's scheduler and not of any one
 * workflow: on 2026-08-27 it hit refresh-daily, intake-tripwire and job-watch
 * within the same hours, at 638, 602 and 534 minutes. A per-workflow envelope
 * would let the workflow with the shortest history call a slot reportable while
 * the evidence sitting in its two siblings said the delay was still running.
 */
const allDelays = loaded.flatMap((l) => observedDispatchDelays(l.slots, l.runs));
const envelope = deriveEnvelope(allDelays);

console.log("  ENVELOPE");
console.log(`    ${envelope.derivation}`);
console.log(
  `    dispatch tolerance ${envelope.dispatchToleranceMinutes} min · queue tolerance ${envelope.queueToleranceMinutes} min · evidence-anchored: ${envelope.evidenceAnchored ? "yes" : "NO"}`,
);
console.log(
  "    A slot past the envelope is a statement about WHAT WE HAVE OBSERVED. GitHub records nothing for a\n" +
    "    schedule it has not dispatched, so a slot still in flight and a slot that will never arrive are the\n" +
    "    SAME OBSERVATION. This audit never claims a cron did not fire.\n",
);

/* -------------------------------------------------------------------------- */
/* PASS TWO — CLASSIFY, RESOLVING STEPS AND LOG TEXT ONLY WHERE NEEDED         */
/* -------------------------------------------------------------------------- */

const audits: WorkflowAudit[] = [];

for (const { workflow, cron, runs, slots } of loaded) {
  /*
   * Enriching only the runs that a slot actually claims, and fetching the LOG
   * only for failures. A log fetch is the expensive call and there is no reason
   * to pay it for a run that succeeded — the landed/no-op discrimination needs
   * the step list, which is cheap, and nothing else.
   */
  const claimed = new Set(
    runs
      .filter((r) => r.event === "schedule")
      .filter((r) => slots.some((s) => s <= r.createdAt))
      .map((r) => r.databaseId),
  );

  const enriched: RunObservation[] = runs.map((r) => {
    if (!claimed.has(r.databaseId)) return r;
    const steps = stepsOf(r.databaseId);
    const failureText = r.conclusion === "failure" ? failureTextOf(r.databaseId) : undefined;
    return { ...r, steps, failureText };
  });

  audits.push(auditWorkflow(workflow, cron, enriched, FROM_ISO, NOW_ISO, envelope));
}

/* -------------------------------------------------------------------------- */
/* THE REPORT                                                                  */
/* -------------------------------------------------------------------------- */

if (asJson) {
  console.log(JSON.stringify({ from: FROM_ISO, to: NOW_ISO, envelope, audits, walls }, null, 2));
  process.exit(walls.length > 0 ? 2 : 0);
}

let reportableSlots = 0;
let delayedSlots = 0;

for (const audit of audits) {
  const slotCount = audit.verdicts.length;
  console.log(`  ${audit.workflow}  cron "${audit.cron}"`);

  if (slotCount === 0) {
    console.log(
      `    NO SLOT IN WINDOW — the ${DAYS}-day window contains no firing of this cron. Nothing is asserted about it.\n`,
    );
    continue;
  }

  for (const { kind, count } of tally(audit)) {
    // Every count carries its denominator, always (RULING 159).
    console.log(`    ${floorLine(floored(kind, `${audit.workflow} slots`, slotCount, count))}`);
  }

  for (const v of audit.verdicts) {
    const flag =
      v.precedesFirstObservedRun
        ? " ." // earlier than this workflow's first ever run — printed, not raised
        : v.kind === "NO_RUN_BEYOND_ENVELOPE" || v.kind === "RAN_FAILED" || v.kind === "RAN_PUSH_REJECTED"
        ? "!!"
        : v.kind === "DISPATCH_DELAYED" || v.kind === "QUEUED" || v.kind === "NOT_YET_CREATED"
          ? " ?"
          : "  ";
    console.log(`    ${flag} ${v.slot}  ${v.kind}`);
    console.log(`         ${v.note}`);
    if (v.outcome && v.kind !== v.outcome.kind) {
      console.log(`         AND WHAT IT DID: ${v.outcome.kind} — ${v.outcome.why}`);
    }
    if (v.failingStep) console.log(`         failing step (from --json jobs): ${v.failingStep}`);
    if (v.kind === "NO_RUN_BEYOND_ENVELOPE" && !v.precedesFirstObservedRun) reportableSlots += 1;
    if (v.kind === "DISPATCH_DELAYED" || v.kind === "QUEUED") delayedSlots += 1;
  }

  if (audit.duplicated.length > 0) {
    for (const d of audit.duplicated) {
      console.log(`    !! ${d.slot} drew MORE THAN ONE scheduled run: ${d.runIds.join(", ")} (the RULING 78 shape)`);
    }
  }
  if (audit.unassignedRunIds.length > 0) {
    console.log(
      `       ${audit.unassignedRunIds.length} scheduled run(s) fell before the first slot in this window and are not counted: ${audit.unassignedRunIds.join(", ")}`,
    );
  }
  console.log("");
}

const totalSlots = audits.reduce((n, a) => n + a.verdicts.length, 0);
console.log(
  `  ${floorLine(floored("slots past the observation envelope", "the whole audit", totalSlots, reportableSlots, totalSlots === 0 ? `the ${DAYS}-day window contains no firing of any cron read` : undefined))}`,
);
console.log(
  `  ${floorLine(floored("slots whose run was created late", "the whole audit", totalSlots, delayedSlots, totalSlots === 0 ? `the ${DAYS}-day window contains no firing of any cron read` : undefined))}`,
);

if (walls.length > 0) {
  console.log(`\n  ${walls.length} WALL(S) — this board is NOT clean, and these are not absences:`);
  for (const w of walls) console.log(`    ${w}`);
  console.log(
    "\n  A workflow behind a wall above is reported nowhere else in this run. It is not green; it is unread.",
  );
  process.exit(2);
}

/*
 * EXIT 0 EVEN WITH FINDINGS. This reports; it does not gate. The only claim it
 * could gate on is one it is forbidden to make.
 */
process.exit(0);
