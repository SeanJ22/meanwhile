/**
 * **WHAT THE JOB WATCHER CANNOT SEE: A SLOT THAT PRODUCED NOTHING, AND A SLOT
 * THAT PRODUCED SOMETHING HOURS LATE.** (2026-08-28.)
 *
 * ## The gap, measured before it was written
 *
 * Three crons exist — `refresh-daily.yml` at `11 9 * * *`, `intake-tripwire.yml`
 * at `41 10 * * *`, `job-watch.yml` at `40 15 * * *`. Every instrument this
 * repository owns for watching them (`scripts/watch-workflows.mts`,
 * `scripts/jobs-status.mts`, `scripts/read-alarms.mts`) reasons over a LIST OF
 * RUNS. All three detect CONSECUTIVE FAILURES and nothing else.
 *
 * **A workflow that produces no runs has no failures.** So on 2026-08-28,
 * with no run recorded for any of the three, every one of those instruments
 * reported a clean board. Absence was not misjudged; it was never looked at.
 *
 * And on 2026-08-27 all three fired late by 638, 602 and 534 minutes. Every
 * instrument reported them green, correctly and uselessly: a refresh that lands
 * ten and a half hours after its slot is a refresh whose data is a day old on
 * arrival, and nothing anywhere said so.
 *
 * ## THE QUEUE WAS NOT THE CAUSE, AND THE MEASUREMENT SAYS SO
 *
 * Across all 22 scheduled runs read on 2026-08-28, `startedAt === createdAt`.
 * Queue wait is zero everywhere. Run 33110252070 — the famous 637-minute case —
 * was CREATED at 19:48:52Z for an 09:11Z slot and its job started at 19:48:55Z.
 * The delay is entirely between the slot and GitHub creating the run, which is
 * dispatch delay, not queueing. `DISPATCH_DELAYED` and `QUEUED` are separated
 * here because they have different causes and different remedies, and a single
 * "late" bucket would have sent the next session hunting a runner shortage that
 * does not exist.
 *
 * ## THE RULE THAT GOVERNS THIS WHOLE MODULE
 *
 * **"GitHub did not fire this cron" IS NOT PROVABLE AND IS NEVER EMITTED.**
 *
 * GitHub creates no artifact for a schedule it never dispatched. There is no
 * row, no id, no negative acknowledgement — nothing to read. So a slot GitHub
 * skipped and a slot GitHub has not gotten to yet are, to any observer outside
 * GitHub, **the same observation**: no run. The 638-minute delay is the proof
 * that they cannot be told apart by waiting: at ten hours past its slot that
 * run looked exactly like an absence, and it was not one.
 *
 * `NO_RUN_BEYOND_ENVELOPE` is therefore a claim about OUR OBSERVATION against a
 * STATED envelope — *we have not seen a run for this slot, and more time has
 * passed than the largest dispatch delay we have ever recorded* — and every
 * sentence this module produces is worded that way. That is the constitution's
 * own distinction: **"I have run out of ideas" is a claim about the session;
 * "this is not published" is a claim about a government** (RULING 170,
 * RULING 184). Here the government is GitHub, and the rule does not soften.
 *
 * The module is PURE. No network, no `gh`, no clock of its own — `nowISO` is
 * passed in. `scripts/schedule-audit.mts` does the talking;
 * `tests/schedule-audit.test.ts` holds the decisions against recorded runs.
 */

/* -------------------------------------------------------------------------- */
/* CRONS, READ FROM THE WORKFLOW FILES THEMSELVES                             */
/* -------------------------------------------------------------------------- */

/**
 * Every cron in one workflow file's text.
 *
 * **THE ANCHOR IS EXTERNAL, AND IT IS THE SAME REGEX
 * `tests/refresh-cadence.test.ts` ALREADY USES** (RULING 147). A cron retyped
 * into TypeScript as prose is a stamp checked against the thing it was stamped
 * from: the schedule would change in the YAML, this file would keep agreeing
 * with itself, and the audit would compute slots for a cron that no longer
 * exists. Nothing in this module ever names a cron value.
 */
export function cronsInWorkflowYaml(text: string): string[] {
  return [...text.matchAll(/^\s*- cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
}

/** A daily cron reduced to the UTC minute-of-day it fires at. */
export interface DailySlotSpec {
  readonly minute: number;
  readonly hour: number;
}

/**
 * A cron shape this module cannot expand into slots.
 *
 * **It throws rather than returning `[]`.** An empty slot list from an
 * unsupported shape is a denominator of zero wearing the costume of a healthy
 * schedule — the audit would report "0 of 0 slots, nothing wrong" about a
 * workflow it never understood. RULING 159's floor, one layer up: zero is a
 * result that must be earned.
 */
export class UnsupportedCronShapeError extends Error {
  /*
   * Fields DECLARED AND ASSIGNED, never parameter properties: the suite runs
   * under `node --test --experimental-strip-types`, which refuses a TS feature
   * that emits code. See `lib/ops/denominator-floor.ts` for the same note.
   */
  readonly cron: string;
  readonly why: string;

  constructor(cron: string, why: string) {
    super(
      `UNSUPPORTED CRON SHAPE: "${cron}" — ${why}. schedule-audit expands the daily ` +
        `"M H * * *" shape only, which is what all three of this repository's crons use. ` +
        `Refusing loudly rather than returning an empty slot list, because an empty ` +
        `denominator reads as a healthy schedule (RULING 159).`,
    );
    this.name = "UnsupportedCronShapeError";
    this.cron = cron;
    this.why = why;
  }
}

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"] as const;

/** Parse `"M H * * *"`. Any other shape throws a NAMED error. */
export function parseDailyCron(cron: string): DailySlotSpec {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new UnsupportedCronShapeError(cron, `it has ${fields.length} fields, not 5`);
  }
  for (let i = 2; i < 5; i += 1) {
    if (fields[i] !== "*") {
      throw new UnsupportedCronShapeError(
        cron,
        `its ${FIELD_NAMES[i]} field is "${fields[i]}" rather than "*", so it does not fire every day`,
      );
    }
  }
  const [minuteField, hourField] = fields;
  for (const [i, field] of [minuteField, hourField].entries()) {
    if (!/^\d{1,2}$/.test(field)) {
      throw new UnsupportedCronShapeError(
        cron,
        `its ${FIELD_NAMES[i]} field is "${field}" — a list, range or step, not a single number`,
      );
    }
  }
  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (minute > 59 || hour > 23) {
    throw new UnsupportedCronShapeError(cron, `${hour}:${minute} is not a time of day`);
  }
  return { minute, hour };
}

/**
 * Every UTC instant this cron was due to fire in `[fromISO, toISO]`, oldest
 * first, as ISO strings ending in `Z`.
 *
 * UTC throughout, with no local slice anywhere: the crons are UTC, the run
 * timestamps GitHub reports are UTC, and a slot list computed in a local zone
 * would be off by the offset for every reader who is not on UTC.
 */
export function expectedSlots(cron: string, fromISO: string, toISO: string): string[] {
  const { minute, hour } = parseDailyCron(cron);
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new UnsupportedCronShapeError(cron, `the window ${fromISO}..${toISO} is not a pair of instants`);
  }
  if (to.getTime() < from.getTime()) {
    throw new UnsupportedCronShapeError(cron, `the window ends (${toISO}) before it starts (${fromISO})`);
  }

  const slots: string[] = [];
  // Start a day early so a slot earlier in the day than `from`'s clock time is
  // still considered, and stop a day late for the mirror case.
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1, hour, minute, 0, 0),
  );
  const end = to.getTime();
  while (cursor.getTime() <= end + 24 * 60 * 60 * 1000) {
    const t = cursor.getTime();
    if (t >= from.getTime() && t <= end) slots.push(new Date(t).toISOString());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

/* -------------------------------------------------------------------------- */
/* WHAT A RUN LOOKS LIKE TO THIS MODULE                                        */
/* -------------------------------------------------------------------------- */

export interface StepObservation {
  readonly name: string;
  /** `success`, `failure`, `skipped`, `cancelled`, or `null` while running. */
  readonly conclusion: string | null;
}

/**
 * One run as `gh run list --json databaseId,status,conclusion,event,createdAt,startedAt,updatedAt`
 * reports it, plus the two things resolved per FAILING run only.
 */
export interface RunObservation {
  readonly databaseId: number;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  /**
   * From `gh run view <id> --json jobs`.
   *
   * **NOT from `--log-failed`**, which labels every line of these runs
   * `UNKNOWN STEP` and therefore cannot attribute a failure to a step at all.
   * Measured 2026-08-28 against runs 32955499285, 32833989579 and 32840268606:
   * every line, every run.
   */
  readonly steps?: readonly StepObservation[];
  /** The failing run's log tail, for the push-rejection discrimination below. */
  readonly failureText?: string;
}

/* -------------------------------------------------------------------------- */
/* THE ENVELOPE                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The smallest envelope this module will use, whatever the data says.
 *
 * **A STATED PARAMETER, NOT A MEASUREMENT, and the difference is the point.**
 * Derived purely from observed delay, a window that happened to contain no late
 * run would produce an envelope of zero — and every in-flight slot would
 * instantly become a reportable absence. The floor is what stops a quiet week
 * from turning the instrument into a false-alarm generator. It is declared
 * here, printed in every report, and it is not evidence.
 */
export const ENVELOPE_FLOOR_MINUTES = 60;

/**
 * How late a run may be created before the delay is itself a finding.
 *
 * Baseline lateness measured 2026-08-28 across all three crons and 22 scheduled
 * runs is 11–57 minutes; the 2026-08-27 event was 534–638. Sixty separates them
 * with the whole observed baseline underneath it. It is a threshold, stated as
 * one, and the report prints the delay so a reader never has only the verdict.
 */
export const DISPATCH_TOLERANCE_MINUTES = 60;

/**
 * How long a created run may wait before starting before that is a finding.
 *
 * Every scheduled run read on 2026-08-28 had `startedAt === createdAt` — queue
 * wait is zero everywhere, so this threshold is tight on purpose. If it ever
 * fires, the cause is genuinely different from a dispatch delay and must not be
 * reported in the same words.
 */
export const QUEUE_TOLERANCE_MINUTES = 5;

export interface AuditEnvelope {
  readonly dispatchToleranceMinutes: number;
  readonly queueToleranceMinutes: number;
  /**
   * How long past a slot we go on saying NOT YET rather than reporting the
   * silence. Never a claim that GitHub skipped anything.
   */
  readonly observationEnvelopeMinutes: number;
  /** True when a real observed delay set it, false when the floor stands alone. */
  readonly evidenceAnchored: boolean;
  /** One sentence, printed verbatim by every report that uses this envelope. */
  readonly derivation: string;
}

/**
 * Derive the envelope FROM THE DATA — the largest dispatch delay actually
 * observed in this read — floored at `ENVELOPE_FLOOR_MINUTES`.
 *
 * **THE ENVELOPE IS A FLOOR THAT GROWS, NEVER A CEILING, AND THE PROOF LANDED
 * WHILE THIS FILE WAS BEING WRITTEN.**
 *
 * At 20:25Z on 2026-08-28 the 09:11Z refresh-daily slot had produced nothing
 * for 674 minutes — already past 638, the largest delay this repository had
 * ever measured. Every reason to call it skipped was present. At **20:49:11Z**
 * run **33209856186** was created: **698.2 minutes** after its slot, queue wait
 * zero, and it completed `success` at 20:53:28Z. The slot was never skipped. It
 * was in flight for eleven and a half hours, and it moved the observed maximum
 * from 638 to 698 in the same afternoon.
 *
 * So a hard-coded envelope would have been WRONG TODAY, on this slot, and an
 * instrument that promoted "past the envelope" into "not triggered" would have
 * made a false claim about GitHub. `deriveEnvelope` is therefore recomputed
 * from the runs on every invocation, and the number it produces is the largest
 * delay SEEN SO FAR — never a bound on what GitHub can do.
 *
 * The envelope is deliberately GLOBAL across the workflows audited rather than
 * per workflow. Dispatch delay is a property of GitHub's scheduler, not of any
 * one workflow: on 2026-08-27 it hit all three at once. A per-workflow envelope
 * would let a workflow with a short history call a slot reportable while the
 * evidence from its two siblings said the delay was still running.
 */
export function deriveEnvelope(
  observedDelayMinutes: readonly number[],
  floorMinutes: number = ENVELOPE_FLOOR_MINUTES,
): AuditEnvelope {
  const finite = observedDelayMinutes.filter((d) => Number.isFinite(d) && d >= 0);
  const observedMax = finite.length > 0 ? Math.ceil(Math.max(...finite)) : null;
  const envelope = Math.max(floorMinutes, observedMax ?? 0);
  const evidenceAnchored = observedMax !== null && observedMax >= floorMinutes;
  const derivation =
    observedMax === null
      ? `envelope ${envelope} min = the STATED FLOOR alone. No dispatch delay was observed in this read, ` +
        `so nothing anchors it to evidence — treat a report built on it as weaker.`
      : evidenceAnchored
        ? `envelope ${envelope} min = the LARGEST DISPATCH DELAY OBSERVED SO FAR in this read (${observedMax} min) ` +
          `over ${finite.length} scheduled run(s); the stated floor of ${floorMinutes} min did not bind. ` +
          `THIS IS A FLOOR THAT GROWS, NOT A CEILING ON WHAT GITHUB CAN DO: on 2026-08-28 a slot sat silent past ` +
          `the then-maximum of 638 min and its run arrived anyway at 698 min (run 33209856186).`
        : `envelope ${envelope} min = the STATED FLOOR of ${floorMinutes} min, which is larger than the ` +
          `biggest delay observed in this read (${observedMax} min over ${finite.length} scheduled run(s)).`;
  return {
    dispatchToleranceMinutes: DISPATCH_TOLERANCE_MINUTES,
    queueToleranceMinutes: QUEUE_TOLERANCE_MINUTES,
    observationEnvelopeMinutes: envelope,
    evidenceAnchored,
    derivation,
  };
}

/* -------------------------------------------------------------------------- */
/* WHAT A RUN DID                                                              */
/* -------------------------------------------------------------------------- */

/**
 * **THE DISCRIMINATION THE EXISTING WATCHER LACKS.**
 *
 * `scripts/watch-workflows.mts` labels a failure with its failing STEP name.
 * Two entirely different defects both fail at the step named `Commit`:
 *
 *  - run 32833989579 (2026-08-25) — the refresh itself failed on data, the NJ
 *    clerk filing being stale against its one-day window;
 *  - run 32955499285 (2026-08-26) — every source ran, the gate passed, the
 *    commit was made, and the PUSH was rejected:
 *    `remote: error: GH006: Protected branch update failed`,
 *    `! [remote rejected] HEAD -> main (protected branch hook declined)`.
 *
 * The first is a fact about a government's website. The second is a fact about
 * our own repository permissions, it was repaired on 2026-08-26 by the SSH
 * deploy-key cutover, and NOTHING WAS WRONG WITH THE DATA — the run had already
 * done its work and could not put it anywhere. Reporting both as "failing step:
 * Commit" is a category error that sends the next session to the wrong half of
 * the system.
 *
 * `commit_refs` is here too: run 32840268606 (2026-08-25, intake-tripwire) was
 * rejected five times with `remote: fatal error in commit_refs`, a GitHub-side
 * fatal rather than a rejected fast-forward — tracker row NH171.
 */
export const PUSH_REJECTION_MARKERS =
  /GH006|protected branch hook declined|fatal error in commit_refs|Write access to repository not granted/i;

export type OutcomeKind =
  | "RAN_FAILED"
  | "RAN_PUSH_REJECTED"
  | "RAN_NOOP"
  | "RAN_LANDED"
  /** Success, but this workflow has no `Unchanged`/`Commit` steps to tell which. */
  | "RAN_SUCCEEDED_UNCLASSIFIED"
  /** Created, not finished. Neither a success nor a failure, and not either one. */
  | "RAN_IN_PROGRESS"
  /** Completed with `cancelled`, `skipped`, `timed_out`, `startup_failure`, … */
  | "RAN_OTHER";

export interface Outcome {
  readonly kind: OutcomeKind;
  /** Plain words, for the report line. */
  readonly why: string;
  /** Named from `--json jobs`, never from `--log-failed`. */
  readonly failingStep?: string;
  /** The push-rejection marker that matched, quoted. */
  readonly marker?: string;
}

/** The step whose name starts with `prefix`, or `undefined`. */
function stepStartingWith(
  run: RunObservation,
  prefix: string,
): StepObservation | undefined {
  return run.steps?.find((s) => s.name.startsWith(prefix));
}

/** Every step that concluded `failure`, in order, joined for the report. */
export function failingStepsOf(run: RunObservation): string {
  if (!run.steps) return "(steps were not read)";
  const failed = run.steps.filter((s) => s.conclusion === "failure").map((s) => s.name);
  // RULING 24: "could not read" and "nothing failed" are different sentences.
  return failed.length > 0
    ? failed.join(", ")
    : "(no step reported failure — the run died before a step concluded)";
}

/** What this run did, independent of when it was dispatched. */
export function outcomeOf(run: RunObservation): Outcome {
  if (run.status !== "completed") {
    return { kind: "RAN_IN_PROGRESS", why: `status is "${run.status}" — it has not concluded` };
  }

  if (run.conclusion === "failure") {
    const failingStep = failingStepsOf(run);
    const marker = run.failureText?.match(PUSH_REJECTION_MARKERS)?.[0];
    if (marker) {
      return {
        kind: "RAN_PUSH_REJECTED",
        why:
          `the run did its work and could not put it anywhere: its log carries "${marker}". ` +
          `This is a fact about our repository's write path, NOT about the data or the source it read.`,
        failingStep,
        marker,
      };
    }
    return {
      kind: "RAN_FAILED",
      why:
        run.failureText === undefined
          ? `failed at: ${failingStep}. No log text was read, so a push rejection cannot be ruled out — this is "not shown to be a push rejection", not "shown not to be one".`
          : `failed at: ${failingStep}, and its log carries no push-rejection marker`,
      failingStep,
    };
  }

  if (run.conclusion !== "success") {
    return { kind: "RAN_OTHER", why: `concluded "${run.conclusion}"` };
  }

  const unchanged = stepStartingWith(run, "Unchanged");
  const commit = stepStartingWith(run, "Commit");
  if (!unchanged || !commit) {
    return {
      kind: "RAN_SUCCEEDED_UNCLASSIFIED",
      why:
        `it succeeded, and this workflow has no ${!unchanged ? '"Unchanged"' : '"Commit"'} step, so ` +
        `landed-versus-no-op cannot be told apart from its step list. That is a limit of the ` +
        `observation, not a claim that nothing landed.`,
    };
  }
  if (unchanged.conclusion === "success") {
    return {
      kind: "RAN_NOOP",
      why: `it succeeded and the "${unchanged.name}" step RAN — a legitimate quiet day: zero commits, zero builds`,
    };
  }
  if (commit.conclusion === "success") {
    return {
      kind: "RAN_LANDED",
      why: `it succeeded, "${unchanged.name}" was skipped, and "${commit.name}" concluded success — data moved and reached main`,
    };
  }
  return {
    kind: "RAN_SUCCEEDED_UNCLASSIFIED",
    why:
      `it succeeded, but "${unchanged.name}" concluded "${unchanged.conclusion}" and "${commit.name}" ` +
      `concluded "${commit.conclusion}" — neither the quiet-day shape nor the landed shape`,
  };
}

/* -------------------------------------------------------------------------- */
/* THE SLOT VERDICT                                                            */
/* -------------------------------------------------------------------------- */

export type SlotVerdictKind =
  | "NOT_YET_CREATED"
  | "NO_RUN_BEYOND_ENVELOPE"
  | "DISPATCH_DELAYED"
  | "QUEUED"
  | OutcomeKind;

/** Every kind this module can emit. The test sweeps it for a forbidden verdict. */
export const SLOT_VERDICT_KINDS: readonly SlotVerdictKind[] = [
  "NOT_YET_CREATED",
  "NO_RUN_BEYOND_ENVELOPE",
  "DISPATCH_DELAYED",
  "QUEUED",
  "RAN_FAILED",
  "RAN_PUSH_REJECTED",
  "RAN_NOOP",
  "RAN_LANDED",
  "RAN_SUCCEEDED_UNCLASSIFIED",
  "RAN_IN_PROGRESS",
  "RAN_OTHER",
] as const;

/**
 * The sentence this module may never write, in every phrasing anyone would
 * reach for. `tests/schedule-audit.test.ts` runs every verdict's own words
 * through it — a rule guarded by a test rather than by a comment.
 */
export const UNPROVABLE_ABSENCE_CLAIM =
  /did ?n[o']?t fire|never fired|failed to fire|was not fired|didn't dispatch|did not dispatch|was not dispatched|never dispatched|github skipped|skipped (?:this|the) (?:slot|cron|schedule)|cron did not|no run was created by github|missed (?:its|the|this) (?:slot|cron|schedule)/i;

/** Does this text assert the one thing no observer outside GitHub can prove? */
export function statesUnprovableAbsence(text: string): boolean {
  return UNPROVABLE_ABSENCE_CLAIM.test(text);
}

export interface SlotVerdict {
  readonly kind: SlotVerdictKind;
  /** The UTC instant the cron was due, ISO. */
  readonly slot: string;
  /** The instant this verdict was reached — NEVER "now" at read time. */
  readonly asOf: string;
  readonly runId?: number;
  /** `createdAt - slot`, in minutes. GitHub's dispatch delay. */
  readonly dispatchDelayMinutes?: number;
  /** `startedAt - createdAt`, in minutes. Actual queue wait. */
  readonly queueMinutes?: number;
  /** Minutes from the slot to `asOf`, present only when no run was seen. */
  readonly minutesSinceSlot?: number;
  readonly envelopeMinutes: number;
  /** What the run did, carried even when the verdict is about its timing. */
  readonly outcome?: Outcome;
  readonly failingStep?: string;
  /**
   * **THIS SLOT IS EARLIER THAN THE OLDEST RUN THIS WORKFLOW HAS EVER
   * PRODUCED.** Found by running the audit over a seven-day window on
   * 2026-08-28: `refresh-daily.yml` reported three consecutive silent slots on
   * the 22nd, 23rd and 24th, and the reason is that RULING 124 created the
   * workflow ON the 24th. Those slots are not missed runs; they are dates
   * before the schedule existed.
   *
   * It is a QUALIFIER, not a separate verdict, because the observation really
   * is the same one — no run — and the honest report says so and then says what
   * else it knows. `scripts/watch-workflows.mts` declines to open a Needs Sean
   * row for a slot carrying this flag, which is the whole reason it exists:
   * three P1 rows about a workflow that did not exist yet would teach a reader
   * to skim the queue.
   *
   * The bound is the RUN LIST, never `git log` on the workflow file — per-file
   * history returns the tip date for every file in a shallow clone, with no
   * error, which is the trap `lib/ops/refresh-cadence.ts` was written around.
   */
  readonly precedesFirstObservedRun?: boolean;
  /** The whole sentence, as a report should print it. Absence is never asserted. */
  readonly note: string;
}

const MINUTE = 60_000;

function minutesBetween(fromISO: string, toISO: string): number {
  return (new Date(toISO).getTime() - new Date(fromISO).getTime()) / MINUTE;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A sentence about to be embedded inside another one: drop its full stop. */
const phrase = (s: string): string => s.replace(/\.$/, "");

/**
 * Classify ONE slot against the run it produced, or against no run at all.
 *
 * Precedence, and it is deliberate:
 *
 *  1. **No run** — the only two verdicts available are NOT YET and BEYOND THE
 *     ENVELOPE, and both are claims about our observation.
 *  2. **A queue wait** beats a dispatch delay, because a run that waited to
 *     start has a different cause and a different remedy from one GitHub was
 *     slow to create.
 *  3. **A dispatch delay** beats the outcome — but the outcome rides along in
 *     `outcome`, so a run that was 638 minutes late AND landed cleanly reports
 *     both facts. Nothing is dropped to fit one label.
 */
export interface ClassifyContext {
  /** `createdAt` of the oldest run this workflow has ever produced, if known. */
  readonly earliestObservedRunAt?: string;
  /** The oldest run's id, so the note can name its evidence. */
  readonly earliestObservedRunId?: number;
}

export function classify(
  slot: string,
  run: RunObservation | null,
  nowISO: string,
  envelope: AuditEnvelope,
  context: ClassifyContext = {},
): SlotVerdict {
  const envelopeMinutes = envelope.observationEnvelopeMinutes;

  if (!run) {
    const minutesSinceSlot = round1(minutesBetween(slot, nowISO));
    const within = minutesSinceSlot <= envelopeMinutes;
    const precedesFirstObservedRun =
      context.earliestObservedRunAt !== undefined && slot < context.earliestObservedRunAt;
    const preface = precedesFirstObservedRun
      ? `THIS SLOT PRECEDES THE OLDEST RUN THIS WORKFLOW HAS EVER PRODUCED` +
        `${context.earliestObservedRunId ? ` (run ${context.earliestObservedRunId}` : " ("}` +
        ` at ${context.earliestObservedRunAt}), so the likeliest reading is that the schedule did not exist yet ` +
        `rather than that a run was missed. Stated rather than assumed: the bound is the run list, not the ` +
        `workflow file's git history, which returns the tip date for every file in a shallow clone. `
      : "";
    return {
      kind: within ? "NOT_YET_CREATED" : "NO_RUN_BEYOND_ENVELOPE",
      slot,
      asOf: nowISO,
      minutesSinceSlot,
      envelopeMinutes,
      precedesFirstObservedRun,
      note:
        preface +
        (within
        ? `NO RUN OBSERVED YET for the ${slot} slot, ${minutesSinceSlot} min after it, which is still inside ` +
          `the ${envelopeMinutes}-min observation envelope. This slot is PENDING, not absent — a run created ` +
          `later still belongs to it, and one already has: run 33110252070 appeared 637 min after its slot.`
        : `NO RUN OBSERVED for the ${slot} slot as of ${nowISO}, ${minutesSinceSlot} min after it — longer ` +
          `than the ${envelopeMinutes}-min observation envelope this audit used. THIS IS A STATEMENT ABOUT WHAT ` +
          `WE HAVE SEEN, not about what GitHub did: GitHub records nothing for a schedule it has not dispatched, ` +
          `so a slot still in flight and a slot that will never arrive are the same observation. The envelope is ` +
          `the largest delay seen SO FAR, not a bound — on 2026-08-28 this exact slot passed the then-maximum of ` +
          `638 min and its run arrived at 698 min anyway (run 33209856186, queue wait 0, concluded success). ` +
          `What is owed here is a LOOK: the Actions tab for this workflow, and whether it was disabled for ` +
          `repository inactivity.`),
    };
  }

  const dispatchDelayMinutes = round1(minutesBetween(slot, run.createdAt));
  const queueMinutes = round1(minutesBetween(run.createdAt, run.startedAt));
  const outcome = outcomeOf(run);
  const base = {
    slot,
    asOf: nowISO,
    runId: run.databaseId,
    dispatchDelayMinutes,
    queueMinutes,
    envelopeMinutes,
    outcome,
    failingStep: outcome.failingStep,
  };

  if (queueMinutes > envelope.queueToleranceMinutes) {
    return {
      ...base,
      kind: "QUEUED",
      note:
        `Run ${run.databaseId} was created ${dispatchDelayMinutes} min after the ${slot} slot and then WAITED ` +
        `${queueMinutes} min to start, past the ${envelope.queueToleranceMinutes}-min queue tolerance. ` +
        `That is runner capacity, not GitHub's scheduler — a different cause from a dispatch delay. Then: ${phrase(outcome.why)}.`,
    };
  }

  if (dispatchDelayMinutes > envelope.dispatchToleranceMinutes) {
    return {
      ...base,
      kind: "DISPATCH_DELAYED",
      note:
        `Run ${run.databaseId} was created ${dispatchDelayMinutes} min after the ${slot} slot, past the ` +
        `${envelope.dispatchToleranceMinutes}-min tolerance, and started ${queueMinutes} min after it was ` +
        `created. The wait is BEFORE creation, so it is GitHub dispatch delay and not queueing. Then: ${phrase(outcome.why)}.`,
    };
  }

  return {
    ...base,
    kind: outcome.kind,
    note:
      `Run ${run.databaseId} for the ${slot} slot was created ${dispatchDelayMinutes} min after it ` +
      `(queue wait ${queueMinutes} min), and ${phrase(outcome.why)}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* MATCHING RUNS TO SLOTS                                                      */
/* -------------------------------------------------------------------------- */

export interface SlotAssignment {
  /** Slot ISO -> the scheduled run that belongs to it, or `null`. */
  readonly bySlot: ReadonlyMap<string, RunObservation | null>;
  /** Scheduled runs that fell outside every slot in the window. Never dropped. */
  readonly unassigned: readonly RunObservation[];
  /** Slots that drew more than one scheduled run — the RULING 78 duplicate shape. */
  readonly duplicated: readonly { slot: string; runIds: number[] }[];
}

/**
 * Assign each SCHEDULED run to the most recent slot at or before its creation.
 *
 * **Only `event === "schedule"` runs are matched.** A `workflow_dispatch` is a
 * person doing something deliberate and is not a cron firing; counting one as a
 * slot's run would let a hand dispatch conceal a slot that produced nothing.
 * `lib/ops/job-watch.ts` draws the same line for the consecutive-failure test,
 * for the same reason.
 *
 * The 638-minute case is why the rule is "latest slot at or before creation"
 * rather than "nearest slot": run 33110252070 was created 10h37m after its
 * 09:11Z slot, and the NEAREST slot to 19:48Z is the NEXT DAY'S. Nearest-match
 * would have credited a run to a slot that had not happened yet and reported
 * the slot it actually belonged to as silent.
 */
export function assignRunsToSlots(
  slots: readonly string[],
  runs: readonly RunObservation[],
): SlotAssignment {
  const bySlot = new Map<string, RunObservation | null>();
  for (const s of slots) bySlot.set(s, null);

  const ordered = [...slots].sort();
  const unassigned: RunObservation[] = [];
  const extras = new Map<string, number[]>();

  const scheduled = [...runs]
    .filter((r) => r.event === "schedule")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const run of scheduled) {
    const created = run.createdAt;
    let slot: string | undefined;
    for (const s of ordered) {
      if (s <= created) slot = s;
      else break;
    }
    if (!slot) {
      unassigned.push(run);
      continue;
    }
    if (bySlot.get(slot) === null) bySlot.set(slot, run);
    else extras.set(slot, [...(extras.get(slot) ?? [bySlot.get(slot)!.databaseId]), run.databaseId]);
  }

  return {
    bySlot,
    unassigned,
    duplicated: [...extras].map(([slot, runIds]) => ({ slot, runIds })),
  };
}

/* -------------------------------------------------------------------------- */
/* THE WHOLE AUDIT FOR ONE WORKFLOW                                            */
/* -------------------------------------------------------------------------- */

export interface WorkflowAudit {
  readonly workflow: string;
  readonly cron: string;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly verdicts: readonly SlotVerdict[];
  readonly unassignedRunIds: readonly number[];
  readonly duplicated: readonly { slot: string; runIds: number[] }[];
}

/** Every dispatch delay a set of runs shows against its slots, for the envelope. */
export function observedDispatchDelays(
  slots: readonly string[],
  runs: readonly RunObservation[],
): number[] {
  const { bySlot } = assignRunsToSlots(slots, runs);
  const delays: number[] = [];
  for (const [slot, run] of bySlot) {
    if (run) delays.push(minutesBetween(slot, run.createdAt));
  }
  return delays;
}

export function auditWorkflow(
  workflow: string,
  cron: string,
  runs: readonly RunObservation[],
  windowFrom: string,
  nowISO: string,
  envelope: AuditEnvelope,
): WorkflowAudit {
  const slots = expectedSlots(cron, windowFrom, nowISO);
  const { bySlot, unassigned, duplicated } = assignRunsToSlots(slots, runs);
  /*
   * The oldest run this workflow is KNOWN to have produced, over every run the
   * caller read — including the ones that fell before the window, which is
   * exactly why `unassigned` is kept rather than discarded.
   */
  const oldest = [...runs]
    .filter((r) => r.event === "schedule")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
  const context: ClassifyContext = oldest
    ? { earliestObservedRunAt: oldest.createdAt, earliestObservedRunId: oldest.databaseId }
    : {};
  const verdicts = slots.map((slot) => classify(slot, bySlot.get(slot) ?? null, nowISO, envelope, context));
  return {
    workflow,
    cron,
    windowFrom,
    windowTo: nowISO,
    verdicts,
    unassignedRunIds: unassigned.map((r) => r.databaseId),
    duplicated,
  };
}

/** Verdicts of one kind, for a caller that wants to raise on a class. */
export function verdictsOfKind(
  audit: WorkflowAudit,
  kind: SlotVerdictKind,
): SlotVerdict[] {
  return audit.verdicts.filter((v) => v.kind === kind);
}

/** A tally of every kind present, so a report always carries its denominator. */
export function tally(audit: WorkflowAudit): { kind: SlotVerdictKind; count: number }[] {
  const counts = new Map<SlotVerdictKind, number>();
  for (const v of audit.verdicts) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  return SLOT_VERDICT_KINDS.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k)! }));
}

/* ========================================================================== */
/* A SCHEDULE THAT STOPPED, AND THE THREE STATES A HUMAN CANNOT TELL APART    */
/* ========================================================================== */

/**
 * **WHY THIS EXISTS.** (Session B closure, 2026-08-31.)
 *
 * The owner opened the Actions tab, saw that five refresh workflows had
 * produced no run since 2026-08-26, and reported five days of unrefreshed
 * production civic data.
 *
 * The observation was exactly right and the conclusion was wrong, and NOTHING
 * IN THE REPOSITORY COULD TELL THE DIFFERENCE. Those five had their crons
 * deliberately consolidated into `refresh-daily.yml` on 2026-08-24 — that file
 * says so in its own header — and each kept its `workflow_dispatch` so a single
 * source could still be run by hand. A workflow with no cron produces no
 * scheduled runs forever, by design, and looks in the Actions list exactly like
 * one whose schedule broke.
 *
 * Three states, indistinguishable by eye:
 *
 * ```
 *   NOT_SCHEDULED  no cron. Silence is correct and permanent.
 *   FRESH          scheduled, and it has run within its window.
 *   STALE          scheduled, and it has NOT. This is the incident.
 * ```
 *
 * ## Why the window is twice the interval
 *
 * GitHub's scheduled dispatch is best-effort and late by design under load.
 * This repository's own `refresh-daily` runs landed between 38 minutes and 11
 * hours 38 minutes after their 09:11 UTC slot over the six days to 2026-08-30.
 * A window of one interval would fire on ordinary lateness, and a check that
 * cries wolf daily is a check that gets muted. Two intervals is the smallest
 * window ordinary lateness cannot reach: a daily job gets 48 hours, which no
 * observed delay here has approached, and a genuinely stopped schedule crosses
 * it within a day.
 */
export const STALENESS_WINDOW_MULTIPLE = 2;

export const SCHEDULE_STALENESS_STATES = [
  "NOT_SCHEDULED",
  "FRESH",
  "STALE",
  "NEVER_RAN",
] as const;
export type ScheduleStalenessState = (typeof SCHEDULE_STALENESS_STATES)[number];

export interface ScheduleStaleness {
  readonly workflow: string;
  readonly state: ScheduleStalenessState;
  /** The shortest interval this workflow's crons imply, in hours. */
  readonly intervalHours: number | null;
  readonly windowHours: number | null;
  readonly hoursSinceLastRun: number | null;
  readonly lastRunAt: string | null;
  /** One sentence a report can quote. Never a verdict on GitHub. */
  readonly detail: string;
}

/**
 * The shortest interval a set of daily-cron expressions implies, in hours.
 *
 * Only the daily form is understood, which is every cron this repository has.
 * An expression this cannot parse returns null and the workflow is reported as
 * unknown rather than silently given a made-up window — a guessed interval
 * would produce a guessed incident.
 */
export function shortestIntervalHours(crons: readonly string[]): number | null {
  if (crons.length === 0) return null;
  let slots = 0;
  for (const cron of crons) {
    try {
      parseDailyCron(cron);
      slots += 1;
    } catch {
      return null;
    }
  }
  return slots === 0 ? null : 24 / slots;
}

/**
 * Judge one workflow.
 *
 * `crons` must come from the workflow file ON THE DEFAULT BRANCH — that is the
 * only place GitHub reads schedules from, and reading a local working copy
 * would let an uncommitted edit change the verdict.
 */
export function scheduleStaleness(input: {
  readonly workflow: string;
  readonly crons: readonly string[];
  readonly lastRunAt: string | null;
  readonly nowISO: string;
}): ScheduleStaleness {
  const base = { workflow: input.workflow, lastRunAt: input.lastRunAt };
  const intervalHours = shortestIntervalHours(input.crons);

  if (intervalHours === null) {
    const why =
      input.crons.length === 0
        ? input.workflow +
          " carries no cron on the default branch, so it produces no scheduled runs and never" +
          " can be stale. Silence here is correct. If it USED to carry one, the schedule was" +
          " moved or removed deliberately, and the file that took it over is what to watch."
        : input.workflow +
          " carries a cron this auditor cannot parse (" +
          input.crons.join(", ") +
          "), so no window is derived. An unparsed schedule is reported as unknown rather than" +
          " given a guessed interval.";
    return {
      ...base,
      state: "NOT_SCHEDULED",
      intervalHours: null,
      windowHours: null,
      hoursSinceLastRun: null,
      detail: why,
    };
  }

  const windowHours = intervalHours * STALENESS_WINDOW_MULTIPLE;

  if (input.lastRunAt === null) {
    return {
      ...base,
      state: "NEVER_RAN",
      intervalHours,
      windowHours,
      hoursSinceLastRun: null,
      detail:
        input.workflow +
        " is scheduled every " +
        String(intervalHours) +
        "h and has produced NO run at all. A schedule that has never fired is not a young" +
        " schedule; it is one nothing has ever executed.",
    };
  }

  const since = (Date.parse(input.nowISO) - Date.parse(input.lastRunAt)) / 3_600_000;
  if (!Number.isFinite(since)) {
    return {
      ...base,
      state: "NOT_SCHEDULED",
      intervalHours,
      windowHours,
      hoursSinceLastRun: null,
      detail: input.workflow + " has an unreadable last-run timestamp, so nothing is claimed.",
    };
  }

  const stale = since > windowHours;
  return {
    ...base,
    state: stale ? "STALE" : "FRESH",
    intervalHours,
    windowHours,
    hoursSinceLastRun: since,
    detail: stale
      ? input.workflow +
        " is scheduled every " +
        String(intervalHours) +
        "h and last ran " +
        since.toFixed(1) +
        "h ago — past its " +
        String(windowHours) +
        "h window. Scheduled dispatch is best-effort and often late, which is why the window is" +
        " twice the interval; this is past even that. RULING 218 operational incident."
      : input.workflow +
        " last ran " +
        since.toFixed(1) +
        "h ago, inside its " +
        String(windowHours) +
        "h window.",
  };
}
