/**
 * `pnpm watch:workflows` — **RULING 56: a scheduled job that fails tells
 * someone.** (NH Hunt 3, 2026-08-21.)
 *
 * ## The shape this closes
 *
 * `Refresh meetings snapshot` and `Intake tripwire` were failing intermittently
 * — sometimes daily, sometimes twice a day — into a page nobody watches. That
 * is the `D73` shape exactly: a data path degrading with every light green.
 * Measured over the 8 days to 2026-08-21, the meetings refresh failed 14 of 36
 * runs. Nothing anywhere said so.
 *
 * At the current corpus that is a small number of missed meetings, absorbed by
 * carry-forward. At national volume the same rate is tens of thousands, and
 * carry-forward is exactly the mechanism that would keep it looking healthy —
 * stale rows with their original `collectedAt`, honest per row, and nobody
 * counting. **A failure rate that is tolerable now is catastrophic later, and
 * the time to fix it is before the volume arrives.**
 *
 * ## What this does
 *
 * Reads each watched workflow's recent runs from the GitHub Actions API. Where
 * the two most recent COMPLETED runs are both failures, it opens a **Needs
 * Sean** tracker row naming the job, both run ids, and the failing step.
 *
 * ## Two consecutive, not one
 *
 * One failure is often a wall — a host refusing on a schedule, a runner losing
 * a connection — and a row per wall would bury the queue in noise until nobody
 * read it, which is the failure mode this is built against. Two consecutive is
 * the cheapest available evidence that the cause is ours rather than the
 * world's. It is a heuristic and it is stated as one rather than dressed as a
 * diagnosis: the row says what was observed, and the diagnosis is Sean's or a
 * later session's.
 *
 * ## Why it opens a row rather than closing one
 *
 * RULING 37 cuts both ways. Only Sean closes a Needs Sean row; **sessions and
 * tooling OPEN them**, because routing something to his attention is our job
 * and he does not have to notice that something needs him. A watcher that
 * resolved its own rows when a job went green again would be the light-green
 * problem rebuilt one layer up.
 *
 * ## Idempotence
 *
 * A row already open for a workflow is not opened again — otherwise a job
 * failing for a week is seven identical rows. The check is on the working
 * store, by the marker below, before anything is written.
 *
 * ## Proving it fires, without breaking production to do it
 *
 * `--asof=<iso>` hides every run created after that instant, so the detector
 * can be held against a window whose outcome is already known. The meetings
 * refresh failed five times consecutively between 2026-08-19T13:10Z and
 * 2026-08-20T13:12Z, so:
 *
 *     pnpm watch:workflows --asof=2026-08-20T14:00:00Z
 *
 * must find it. That is a better proof than an induced failure: the failure is
 * real, the runs are real, and nothing has to be broken and reverted to
 * demonstrate a detector. `tests/watch-workflows.test.ts` pins the decision
 * itself against fixed run lists so the rule is guarded without a network.
 *
 * Run:
 *   pnpm watch:workflows              # report only, writes nothing
 *   pnpm watch:workflows --open       # open Needs Sean rows for what it found
 *   pnpm watch:workflows --asof=<iso> # as the watcher would have seen it then
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completedRuns,
  failedTwiceConsecutively,
  failedTwiceInWindow,
  failureRate,
  runsOnOwnCadence,
  type WorkflowRun,
} from "../lib/ops/job-watch.ts";
import { failureTail } from "../lib/ops/job-watch-log.ts";
import {
  auditWorkflow,
  cronsInWorkflowYaml,
  scheduleStaleness,
  type ScheduleStaleness,
  deriveEnvelope,
  expectedSlots,
  observedDispatchDelays,
  type AuditEnvelope,
  type RunObservation,
  type SlotVerdict,
} from "../lib/ops/schedule-audit.ts";
import { loadSecrets, redactSecrets } from "../lib/ops/secret-redaction.ts";

/** The scheduled workflows that push `main`, plus the tripwire. */
const WATCHED = [
  /*
   * RULING 124 (2026-08-24): the ONE daily orchestrated refresh. Every source's
   * cron moved onto it, so if this is unwatched then nothing scheduled that
   * touches reader data is watched at all — a strictly worse position than the
   * five separate workflows it replaced. The five below keep their entries
   * because they keep their `workflow_dispatch`.
   */
  "refresh-daily.yml",
  "intake-tripwire.yml",
  "refresh-meetings-snapshot.yml",
  "refresh-dotgov-snapshot.yml",
  "refresh-fec-snapshot.yml",
  "refresh-legiscan-snapshot.yml",
  // NJ Hunt 3 item 2.3: the county filing IS the ballot, so it refreshes daily
  // and is watched like every other scheduled job that pushes main.
  "refresh-nj-filing.yml",
] as const;

/**
 * How a row announces which workflow it belongs to, so the idempotence check
 * is an exact string rather than a fuzzy title match.
 */
const MARKER = (workflow: string): string => `[job-watch:${workflow}]`;

const OPEN = process.argv.includes("--open");
const asofArg = process.argv.find((a) => a.startsWith("--asof="));
const AS_OF = asofArg ? new Date(asofArg.slice("--asof=".length)) : undefined;
if (AS_OF && Number.isNaN(AS_OF.getTime())) {
  console.error(`watch:workflows: --asof is not a date: ${asofArg}`);
  process.exit(2);
}

/**
 * **THE INSTANT THIS WATCHER AUDITED, AND IT IS NEVER THE WORD "NOW".**
 *
 * `job-watch.yml` is ITSELF one of the three delayed workflows. On 2026-08-27
 * it was created 534 minutes after its 15:40Z slot — so the report it produced
 * described a board eight hours and fifty-four minutes old while reading, to
 * anyone who found it, as a report about the present.
 *
 * Every schedule finding below therefore carries the SLOT IT AUDITED and this
 * stamp. A row saying "no run has appeared for the 09:11Z slot" is only true
 * relative to when somebody looked, and a row that does not say when somebody
 * looked is a row that will be wrong without ever changing.
 */
const AUDIT_AS_OF = AS_OF ?? new Date();
const AUDIT_AS_OF_ISO = AUDIT_AS_OF.toISOString();

/** How far back the schedule audit looks. Three daily slots per workflow. */
const AUDIT_WINDOW_DAYS = 3;
const AUDIT_FROM_ISO = new Date(
  AUDIT_AS_OF.getTime() - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
).toISOString();

type Run = WorkflowRun;

interface Finding {
  workflow: string;
  runs: Run[];
  failingStep: string;
  /**
   * The last lines the failing run actually printed, so a reader starts warm.
   * A run whose log could NOT be read says so here rather than reading as a
   * run that printed nothing (RULING 24).
   */
  failureTail: string;
  rate: { failures: number; completed: number };
  /** True when the pair is not at the head — it broke twice and recovered. */
  healed: boolean;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** The step that failed, so the row names it rather than only a run id. */
function failingStepOf(runId: number): string {
  try {
    const raw = gh([
      "run",
      "view",
      String(runId),
      "--json",
      "jobs",
      "--jq",
      '[.jobs[].steps[] | select(.conclusion=="failure") | .name] | join(", ")',
    ]).trim();
    return raw === "" ? "(no failing step named — the run died before a step reported)" : raw;
  } catch {
    // An operation that can return nothing is asked what it returned: this is
    // "could not read", which is not the same claim as "no step failed".
    return "(could not read the run's steps)";
  }
}

/**
 * Every secret value this machine knows, so a log tail cannot carry one into a
 * committed tracker row (RULING 127). On a CI runner `.env.local` does not
 * exist and GitHub has already masked its own registered secrets as `***`;
 * this is the second layer, for the local case where neither is true.
 */
const SECRETS = existsSync(join(process.cwd(), ".env.local")) ? loadSecrets(join(process.cwd(), ".env.local")) : [];

/**
 * The tail of what the failing run printed, so the row starts a reader warm.
 *
 * `--log-failed` is asked for first because it is the smaller and more
 * relevant payload; a run that died before any step reported has no failed
 * step, so `--log` is the fallback rather than the first choice.
 */
function failureTailOf(runId: number): string {
  const rendered = failureTail(runId, (id) => {
    const failed = gh(["run", "view", String(id), "--log-failed"]);
    return failed.trim() === "" ? gh(["run", "view", String(id), "--log"]) : failed;
  });
  return redactSecrets(rendered, SECRETS);
}

/**
 * Every run the API reported for a workflow, BEFORE the completed-only filter.
 *
 * The consecutive-failure rule reasons over completed runs only, and correctly
 * so. The SCHEDULE audit cannot: a run that is still in flight is exactly what
 * separates a slot that is pending from one that produced nothing, and dropping
 * it would turn a running job into an absence.
 */
const runsAsRead = new Map<string, RunObservation[]>();

function recentRuns(workflow: string, limit = 40): Run[] {
  const raw = gh([
    "run",
    "list",
    `--workflow=${workflow}`,
    "--limit",
    String(limit),
    "--json",
    // `event` is the trigger, and it is what separates a DRILL from a failure
    // on this job's own cadence. See `runsOnOwnCadence`.
    //
    // `startedAt`/`updatedAt` are here for the SCHEDULE audit, and `startedAt`
    // is the whole of the dispatch-versus-queue discrimination: every scheduled
    // run read on 2026-08-28 had `startedAt === createdAt`, so the famous
    // 637-minute wait was GitHub taking that long to CREATE the run, not a
    // runner shortage. No instrument in this repository had ever asked for it.
    "databaseId,conclusion,status,createdAt,event,startedAt,updatedAt",
  ]);
  const parsed = JSON.parse(raw) as RunObservation[];
  runsAsRead.set(workflow, parsed);
  return completedRuns(parsed as unknown as Run[], AS_OF);
}

function openRowsMentioning(marker: string): boolean {
  const store = join(process.cwd(), "docs", "tracker-working.csv");
  if (!existsSync(store)) return false;
  // Read as text and search the whole file. A CSV parse would be tidier and
  // would also be a second thing that can be wrong about whether a row exists.
  return readFileSync(store, "utf8").includes(marker);
}

const findings: Finding[] = [];
const unreadable: string[] = [];

/**
 * Workflows whose non-zero exit means "the thing I watch for HAPPENED", not
 * "I could not run". Their red runs still count and still open a row on two
 * consecutive; the label is what stops a reader misreading the rate.
 */
const ALARM_CHANNELS = new Set(["intake-tripwire.yml"]);


for (const workflow of WATCHED) {
  let runs: Run[];
  try {
    runs = recentRuns(workflow);
  } catch (error) {
    // A workflow this run COULD NOT READ is reported separately from one that
    // is failing. An unreachable API is not a healthy job.
    unreadable.push(`${workflow}: ${(error as Error).message.split("\n")[0]}`);
    continue;
  }

  const rate = failureRate(runs);
  /*
   * **A RED TRIPWIRE IS THE ALARM WORKING** (NH Hunt 4, 2026-08-21, item 7).
   *
   * `intake-tripwire.yml` runs `pnpm alarms`, which exits NON-ZERO when a sold
   * store has refused a write in the window. So a failed run there does not
   * mean the job is broken — it means the alarm FIRED, which is the whole
   * reason the job exists. Both of its two failures to 2026-08-21 are that:
   * one names a refused `search_log` insert at 00:28Z on 2026-08-21.
   *
   * Printing it in the same column as a refresh that could not build is a
   * category error, and it is the kind that makes a rate meaningless — a real
   * alarm and a broken job look identical in "2 of 8". The counting is
   * unchanged, because two consecutive alarms deserve a row exactly as much as
   * two consecutive breakages do; only the LABEL is added, so a reader knows
   * which kind of red they are looking at.
   */
  const alarmChannel = ALARM_CHANNELS.has(workflow);
  console.log(
    `  ${workflow.padEnd(34)} ${rate.failures} ${alarmChannel ? "alarm(s) raised" : "failure(s)"} of ${rate.completed} completed run(s)` +
      (alarmChannel && rate.failures > 0
        ? "\n" +
          "".padEnd(36) +
          "a red run here is the ALARM firing, not the job breaking — read the run log for what a store refused"
        : ""),
  );

  /*
   * THE HEAD FIRST, THEN THE WHOLE WINDOW (NJ Hunt 3 item 1c, 2026-08-22).
   *
   * `failedTwiceConsecutively` answers "is this job broken RIGHT NOW", which is
   * the more urgent question and stays the one asked first. But this watcher
   * runs once a day, and on 2026-08-22 the meetings refresh failed at 01:25 and
   * 01:30 and recovered at 01:51 — so the 15:40 reading saw two successes,
   * passed, and opened nothing. A double failure that heals between two daily
   * readings was invisible to a detector that only ever looked at the head.
   *
   * `failedTwiceInWindow` looks at all of it. A healed pair still earns a row,
   * because nobody found out why it broke and the next occurrence starts from
   * the same nothing. The row says WHICH kind it is; the marker keeps it to one
   * row per workflow either way.
   */
  /*
   * A DRILL IS NOT A FAILURE (2026-08-24, closing `JOB02`'s diagnosis).
   *
   * `JOB02` was raised by two runs five minutes apart that were both manual
   * dispatches carrying `WTP_INGEST_FORCE_JOB_FAILURE`, testing this very
   * watcher. It worked, and it cost a P1 row nobody could act on.
   *
   * The RATE above still counts every run, because the rate is a fact about
   * the workflow. Only the test that RAISES A ROW is narrowed, and the
   * number set aside is printed rather than clipped silently.
   */
  const cadence = runsOnOwnCadence(runs);
  if (cadence.dispatchedSetAside > 0) {
    console.log(
      "".padEnd(36) +
        `${cadence.dispatchedSetAside} of ${runs.length} run(s) were manual dispatches — counted in the ` +
        "rate, set aside for the consecutive test, because a drill is not this job's cadence",
    );
  }
  const atHead = failedTwiceConsecutively(cadence.kept);
  // Only scanned when the head is clean, so `healed` comes from the one
  // detector that computes it rather than from an `in` narrowing over a union.
  const inWindow = atHead ? null : failedTwiceInWindow(cadence.kept);
  const consecutive = atHead ?? inWindow;
  if (!consecutive) continue;

  findings.push({
    workflow,
    runs: [consecutive.newest, consecutive.previous],
    failingStep: failingStepOf(consecutive.newest.databaseId),
    failureTail: failureTailOf(consecutive.newest.databaseId),
    rate,
    healed: inWindow?.healed ?? false,
  });
}

console.log("");
if (unreadable.length > 0) {
  console.log(`  COULD NOT READ ${unreadable.length} workflow(s) — not a clean board:`);
  for (const u of unreadable) console.log(`    ${u}`);
  console.log("");
}

/* ========================================================================== */
/* THE TWO FINDING CLASSES THE CONSECUTIVE-FAILURE RULE CANNOT SEE            */
/* ========================================================================== */

/**
 * **A WORKFLOW THAT PRODUCES NO RUNS HAS NO FAILURES.**
 *
 * Everything above this line reasons over a LIST OF RUNS. So does
 * `scripts/jobs-status.mts`, and so does `scripts/read-alarms.mts`. On
 * 2026-08-28 none of the three crons had produced a run at all, and every one
 * of those instruments reported a clean board — not a wrong judgement, an
 * absence of one. And on 2026-08-27 all three fired 534 to 638 minutes late and
 * succeeded, so delay read as health too.
 *
 * These two classes start from the CRON instead: `lib/ops/schedule-audit.ts`
 * expands each schedule into the UTC slots it was due at and asks what each
 * slot produced.
 *
 * **THE EXISTING TWO-CONSECUTIVE RULE IS UNTOUCHED.** It works, it has caught
 * real failures, and nothing here narrows it. These sit beside it.
 *
 * **AND NEITHER CLASS EVER CLAIMS GITHUB DID NOT FIRE A CRON.** GitHub records
 * nothing for a schedule it has not dispatched, so a slot still in flight and a
 * slot that will never arrive are the same observation — the 638-minute run is
 * the proof, because at ten hours past its slot it looked exactly like an
 * absence and was not one. A finding here is a statement about what THIS
 * WATCHER OBSERVED against a STATED envelope, and it is worded that way in the
 * console and in the row.
 */
interface ScheduleFinding {
  workflow: string;
  cron: string;
  verdict: SlotVerdict;
  envelope: AuditEnvelope;
  marker: string;
}

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

/** Every workflow file carrying a cron, read from disk. Never typed here. */
function scheduledWorkflowFiles(): { file: string; cron: string }[] {
  const found: { file: string; cron: string }[] = [];
  if (!existsSync(WORKFLOW_DIR)) return found;
  for (const file of readdirSync(WORKFLOW_DIR)) {
    if (!file.endsWith(".yml")) continue;
    for (const cron of cronsInWorkflowYaml(readFileSync(join(WORKFLOW_DIR, file), "utf8"))) {
      found.push({ file, cron });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

const scheduleFindings: ScheduleFinding[] = [];
const scheduled = scheduledWorkflowFiles();

if (scheduled.length === 0) {
  // A zero-row read is a FAILED read, not a repository with no crons.
  unreadable.push(
    ".github/workflows: NO CRON FOUND in any workflow file — that is a failed read, not a schedule-free repo",
  );
} else {
  const loaded: { workflow: string; cron: string; runs: RunObservation[]; slots: string[] }[] = [];
  for (const { file, cron } of scheduled) {
    let runs = runsAsRead.get(file);
    if (!runs) {
      try {
        recentRuns(file);
        runs = runsAsRead.get(file);
      } catch (error) {
        unreadable.push(`${file} (schedule audit): ${(error as Error).message.split("\n")[0]}`);
        continue;
      }
    }
    if (!runs || runs.length === 0) {
      unreadable.push(`${file} (schedule audit): gh returned ZERO runs — a failed read, not a healthy schedule`);
      continue;
    }
    // `--asof` must hide the future from the audit exactly as it does from the
    // consecutive test, or a replay would read a slot as filled by a run the
    // watcher could not have seen.
    const visible = runs.filter((r) => new Date(r.createdAt) <= AUDIT_AS_OF);
    let slots: string[];
    try {
      slots = expectedSlots(cron, AUDIT_FROM_ISO, AUDIT_AS_OF_ISO);
    } catch (error) {
      unreadable.push(`${file} (schedule audit): ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    loaded.push({ workflow: file, cron, runs: visible, slots });
  }

  /*
   * ONE ENVELOPE ACROSS ALL THREE, because dispatch delay is a property of
   * GitHub's scheduler rather than of any one workflow — on 2026-08-27 it hit
   * all three within the same hours.
   */
  const envelope = deriveEnvelope(loaded.flatMap((l) => observedDispatchDelays(l.slots, l.runs)));

  console.log(`  SCHEDULE AUDIT · slots from ${AUDIT_FROM_ISO} to ${AUDIT_AS_OF_ISO}`);
  console.log(`    ${envelope.derivation}`);

  for (const { workflow, cron, runs, slots } of loaded) {
    const audit = auditWorkflow(workflow, cron, runs, AUDIT_FROM_ISO, AUDIT_AS_OF_ISO, envelope);
    /*
     * A SLOT FROM BEFORE THE WORKFLOW'S FIRST EVER RUN IS NOT A MISSED RUN.
     *
     * Found by running the audit over seven days on 2026-08-28: refresh-daily
     * reported silent slots on the 22nd, 23rd and 24th, and RULING 124 created
     * that workflow ON the 24th. Those slots are printed, because nothing is
     * dropped silently, and they do NOT open a row — three P1 rows about a
     * workflow that did not exist yet is how a queue stops being read.
     */
    const preHistory = audit.verdicts.filter(
      (v) => v.kind === "NO_RUN_BEYOND_ENVELOPE" && v.precedesFirstObservedRun,
    );
    const gaps = audit.verdicts.filter(
      (v) => v.kind === "NO_RUN_BEYOND_ENVELOPE" && !v.precedesFirstObservedRun,
    );
    const late = audit.verdicts.filter((v) => v.kind === "DISPATCH_DELAYED" || v.kind === "QUEUED");
    console.log(
      `    ${workflow.padEnd(30)} ${slots.length} slot(s): ${gaps.length} past the envelope, ${late.length} late, ` +
        `${preHistory.length} before this workflow's first ever run, ` +
        `${audit.verdicts.length - gaps.length - late.length - preHistory.length} otherwise accounted for`,
    );
    for (const v of preHistory) {
      console.log(
        `      ${v.slot} is earlier than the oldest run this workflow has produced — printed, not raised as a row.`,
      );
    }
    for (const v of [...gaps, ...late]) {
      console.log(`      ${v.kind}  ${v.slot}`);
      console.log(`        ${v.note}`);
      scheduleFindings.push({
        workflow,
        cron,
        verdict: v,
        envelope,
        marker:
          v.kind === "NO_RUN_BEYOND_ENVELOPE"
            ? `[job-watch:slot-gap:${workflow}@${v.slot}]`
            : `[job-watch:dispatch-delay:${workflow}@${v.slot}]`,
      });
    }
  }
  console.log("");
}

if (findings.length === 0 && scheduleFindings.length === 0) {
  console.log("  no workflow has failed twice consecutively, at the head or anywhere in the window read,");
  console.log("  and every audited slot is accounted for within the stated observation envelope.");
  process.exit(unreadable.length > 0 ? 2 : 0);
}

const rows: Record<string, string>[] = [];

/* ========================================================================== */
/* A SCHEDULE THAT STOPPED. (Session B closure, 2026-08-31.)                  */
/*                                                                            */
/* Every pass above grades runs that HAPPENED. None of them can see a workflow */
/* that produced no runs at all, which is what a stopped schedule looks like — */
/* and on 2026-08-31 an owner reading the Actions tab by eye diagnosed five    */
/* days of unrefreshed production data from exactly that silence. He was       */
/* reading five workflows whose crons had been deliberately consolidated into  */
/* refresh-daily.yml, which had run on schedule and succeeded every day since. */
/*                                                                            */
/* NOT_SCHEDULED and STALE both look like silence and are opposite facts. The  */
/* discriminator is the workflow file's own cron, read from disk.              */
/* ========================================================================== */

const staleness: ScheduleStaleness[] = [];
for (const workflow of WATCHED) {
  const file = join(WORKFLOW_DIR, workflow);
  const crons = existsSync(file) ? cronsInWorkflowYaml(readFileSync(file, "utf8")) : [];
  let lastRunAt: string | null = null;
  try {
    lastRunAt = recentRuns(workflow)[0]?.createdAt ?? null;
  } catch {
    /* Unreadable is already reported above; nothing is claimed here. */
    continue;
  }
  staleness.push(scheduleStaleness({ workflow, crons, lastRunAt, nowISO: AUDIT_AS_OF_ISO }));
}

console.log("\n  SCHEDULE STALENESS — a job that stopped produces no runs to grade");
for (const row of staleness) {
  console.log(`    ${row.workflow.padEnd(34)} ${row.state}`);
  if (row.state !== "FRESH") console.log(`${"".padEnd(38)}${row.detail}`);
}

for (const row of staleness.filter((r) => r.state === "STALE" || r.state === "NEVER_RAN")) {
  rows.push({
    Section: "repo-ops",
    Title: `${row.workflow}: scheduled, and it has stopped running`,
    "What this is":
      `${row.detail}\n\nTHIS IS THE ONLY REFRESH PATH THAT REACHES READERS. The shadow ` +
      "runner fetches and promotes nothing (W3.6), so a stopped legacy refresh is a live " +
      "freshness exposure on the product rather than an internal scheduling annoyance.\n\n" +
      "Diagnose in this order, recording each: does the file on the DEFAULT BRANCH still " +
      "carry a valid on-schedule trigger; did a commit change it or a workflow it calls; does a " +
      "new if-condition, concurrency group or path filter prevent run creation; does GitHub report " +
      "the schedule disabled; were runs created and cancelled, or never created at all. " +
      "A cron that was deliberately moved is NOT_SCHEDULED and never reaches this row.\n\n" +
      `${MARKER(row.workflow)}`,
    Priority: "P1",
    prefix: "JOB",
  });
  console.log(`    -> repo-ops incident row queued for ${row.workflow} (RULING 218).`);
}


if (findings.length > 0) console.log(`  ${findings.length} workflow(s) failed TWICE CONSECUTIVELY:\n`);

for (const f of findings) {
  const marker = MARKER(f.workflow);
  const ids = f.runs.map((r) => r.databaseId).join(" and ");
  console.log(`    ${f.workflow} — runs ${ids}`);
  console.log(`      failing step: ${f.failingStep}`);
  for (const line of f.failureTail.split("\n")) console.log(`      ${line}`);
  console.log(
    f.healed
      ? "      the pair is not at the head — it broke twice and has since recovered, and nobody found out why"
      : "      the pair is at the head — this job is failing right now",
  );

  if (openRowsMentioning(marker)) {
    console.log("      a row is already open for this workflow — not opening a second.\n");
    continue;
  }

  // RULING 218: a late or failed scheduled dispatch is an engineering/freshness
  // defect — an operational incident and WorkItem — never a Needs-Owner
  // escalation by itself. The row opens in the section that owns the work.
  rows.push({
    Section: "repo-ops",
    Title: f.healed
      ? `${f.workflow} failed twice in a row and recovered unexamined`
      : `${f.workflow} has failed twice in a row`,
    "What this is":
      (f.healed
        ? `The scheduled job ${f.workflow} failed on two CONSECUTIVE runs ` +
          `(${ids}), both at: ${f.failingStep}, and has since gone green on its ` +
          "own. It is not broken right now. Nobody found out why it broke, so " +
          "the next occurrence starts from the same nothing — which is why this " +
          "is a row rather than a shrug. This watcher runs once a day and used " +
          "to read only the two most recent runs, so a double failure that " +
          "healed in between was invisible to it (NJ Hunt 3 item 1c). "
        : `The scheduled job ${f.workflow} failed on its two most recent runs ` +
          `(${ids}), both at: ${f.failingStep}. `) +
      `Over its last ${f.rate.completed} ` +
      `completed runs it has failed ${f.rate.failures} time(s). Two consecutive ` +
      "failures is evidence the cause is ours rather than a host refusing on a " +
      "schedule — a wall would not usually repeat exactly. RULING 56 opens this " +
      `automatically so a degrading data path is not a page nobody watches. ` +
      // Sean, 2026-08-25: "night jobs keep tripping and nobody learns why".
      // A row naming the run id says WHERE to look; this says WHAT HAPPENED,
      // so the next diagnosis does not begin by fetching a log.
      `\n\nOPERATIONAL INCIDENT (RULING 218): this is engineering work, not an owner ` +
      `decision. The standing class incident is WorkItem incident-scheduled-run-failures ` +
      `in data/control-plane/incidents.` +
      `\n\nWHAT THE FAILING RUN PRINTED (run ${f.runs[0].databaseId}). ${f.failureTail}\n\n${marker}`,
    Priority: "P1",
    prefix: "JOB",
  });
  console.log("      -> repo-ops incident row queued (RULING 218).\n");
}

/* -------------------------------------------------------------------------- */
/* THE SCHEDULE ROWS                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The marker is keyed on WORKFLOW AND SLOT, not on workflow alone.
 *
 * The consecutive-failure marker is per workflow so a job failing for a week is
 * one row rather than seven identical ones — right, because each of those seven
 * says the same thing. A slot does not: "no run for the 09:11Z slot on the
 * 28th" and "no run for the 09:11Z slot on the 31st" are different facts about
 * different days' data, and collapsing them would let a second outage hide
 * behind the row opened for the first. The window is three days, so the count
 * is bounded by construction.
 */
for (const f of scheduleFindings) {
  const v = f.verdict;
  const gap = v.kind === "NO_RUN_BEYOND_ENVELOPE";

  if (openRowsMentioning(f.marker)) {
    console.log(`    a row is already open for ${f.workflow} at ${v.slot} — not opening a second.`);
    continue;
  }

  // RULING 218: dispatch-delay findings are operational incidents in the
  // section that owns the work, never Needs-Owner escalations by themselves.
  rows.push({
    Section: "repo-ops",
    Title: gap
      ? `${f.workflow}: no run observed for the ${v.slot} slot`
      : `${f.workflow}: the ${v.slot} slot ran ${v.dispatchDelayMinutes} min late`,
    "What this is":
      (gap
        ? `AUDITED SLOT: ${v.slot} (cron "${f.cron}"). AS OF: ${v.asOf}. ` +
          `No run had been observed for that slot ${v.minutesSinceSlot} minute(s) after it, which is longer ` +
          `than the ${v.envelopeMinutes}-minute observation envelope this audit used. ` +
          `\n\nTHIS IS A STATEMENT ABOUT WHAT THIS WATCHER SAW, NOT ABOUT WHAT GITHUB DID. GitHub creates no ` +
          `artifact for a schedule it has not dispatched, so a slot still in flight and a slot that will never ` +
          `arrive are the same observation from outside. Run 33110252070 appeared 637 minutes after its slot on ` +
          `2026-08-27, which is why "late" cannot be ruled out by waiting. What is owed here is a LOOK: the ` +
          `Actions tab for this workflow, and whether it was disabled for repository inactivity. `
        : `AUDITED SLOT: ${v.slot} (cron "${f.cron}"). AS OF: ${v.asOf}. ` +
          `Run ${v.runId} was created ${v.dispatchDelayMinutes} minute(s) after that slot and waited ` +
          `${v.queueMinutes} minute(s) to start, against a ${f.envelope.dispatchToleranceMinutes}-minute ` +
          `tolerance. Because the wait is BEFORE creation rather than after it, this is GitHub dispatch delay ` +
          `and not runner queueing — every scheduled run read on 2026-08-28 had startedAt equal to createdAt. ` +
          `\n\nWHY IT MATTERS EVEN THOUGH THE RUN WENT GREEN: a refresh that lands ten hours after its slot is a ` +
          `refresh whose data is a day old on arrival, and every failure-counting instrument in this repository ` +
          `reports it as healthy. ${v.outcome ? `What the run then did: ${v.outcome.kind} — ${v.outcome.why} ` : ""}`) +
      `\n\nENVELOPE USED: ${f.envelope.derivation}` +
      // job-watch is itself one of the delayed workflows; its own report can be
      // hours stale, so the row is stamped rather than implied to be current.
      `\n\nTHE STAMP IS NOT DECORATION. job-watch.yml is itself one of the delayed workflows — on 2026-08-27 it ` +
      `ran 534 minutes after its own slot, so its report described a board nearly nine hours old. Read every ` +
      `sentence above as true AS OF ${v.asOf}, not as of when you are reading it.` +
      `\n\nOPERATIONAL INCIDENT (RULING 218): GitHub scheduled workflows are not the ` +
      `freshness clock; a late dispatch is an engineering/freshness defect, never a ` +
      `Needs-Owner escalation by itself. The standing class incident is WorkItem ` +
      `incident-github-dispatch-delay in data/control-plane/incidents.` +
      `\n\n${f.marker}`,
    Priority: gap ? "P1" : "P2",
    prefix: "JOB",
  });
  console.log(`    -> repo-ops incident row queued for ${f.workflow} at ${v.slot} (RULING 218).`);
}

if (rows.length === 0) {
  console.log("  every finding already has an open row. Nothing written.");
  process.exit(0);
}

if (!OPEN) {
  console.log(`  ${rows.length} row(s) would be opened. Re-run with --open to write them.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "job-watch-"));
const file = join(dir, "rows.json");
writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");

// `tracker.mjs add` is the ONLY writer of the stores. Nothing here edits a CSV.
execFileSync("node", [join("scripts", "tracker.mjs"), "add", file, "--session=job-watch"], {
  stdio: "inherit",
});
