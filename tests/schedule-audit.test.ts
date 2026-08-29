/**
 * **THE DETECTOR FOR ABSENCE AND DELAY, HELD AGAINST RECORDED RUNS.**
 * (2026-08-28.)
 *
 * Every fixture under `tests/fixtures/schedule-audit/` is a real `gh` payload
 * for a real run of this repository's own crons, recorded on 2026-08-28. There
 * are **no live calls here** — repo law, and doubly so for a watcher, because a
 * watcher whose own logic is only ever exercised in production is the shape it
 * exists to catch (`lib/ops/job-watch.ts` says the same about itself).
 *
 * ONE fixture is derived rather than recorded — `steps-derived-quiet-day.json`
 * — and it says so in its own `_provenance` field, with the reason: no run of
 * `refresh-daily.yml` has ever taken the quiet path, so there is nothing to
 * record. The test below asserts that provenance exists rather than letting a
 * constructed shape pass as a measured one.
 *
 * The cron values are read from `.github/workflows/*.yml` at test time, by the
 * same regex `tests/refresh-cadence.test.ts` uses. Nothing here retypes one.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CATCH_UP_MAX_DAYS,
  catchUpSlots,
  dueDecisions,
  maxScheduledBuildsPerMonth,
  utcDay,
} from "../lib/ops/refresh-cadence.ts";
import {
  DISPATCH_TOLERANCE_MINUTES,
  ENVELOPE_FLOOR_MINUTES,
  SLOT_VERDICT_KINDS,
  UnsupportedCronShapeError,
  assignRunsToSlots,
  auditWorkflow,
  classify,
  cronsInWorkflowYaml,
  deriveEnvelope,
  expectedSlots,
  failingStepsOf,
  observedDispatchDelays,
  outcomeOf,
  parseDailyCron,
  statesUnprovableAbsence,
  type RunObservation,
  type SlotVerdict,
  type StepObservation,
} from "../lib/ops/schedule-audit.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "schedule-audit");
const WORKFLOWS = join(ROOT, ".github", "workflows");

const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
const readText = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const RUNS = {
  "refresh-daily.yml": readJson<RunObservation[]>("runs-refresh-daily.json"),
  "job-watch.yml": readJson<RunObservation[]>("runs-job-watch.json"),
  "intake-tripwire.yml": readJson<RunObservation[]>("runs-intake-tripwire.json"),
};

const STEPS = {
  landed: readJson<StepObservation[]>("steps-33110252070.json"),
  pushRejected: readJson<StepObservation[]>("steps-32955499285.json"),
  dataFailed: readJson<StepObservation[]>("steps-32833989579.json"),
  tripwirePushFailed: readJson<StepObservation[]>("steps-32840268606.json"),
  quietDay: readJson<{ _provenance: string[]; steps: StepObservation[] }>("steps-derived-quiet-day.json"),
};

const FAILURE_TEXT = {
  gh006: readText("failure-text-32955499285.txt"),
  data: readText("failure-text-32833989579.txt"),
  commitRefs: readText("failure-text-32840268606.txt"),
};

/** The cron for one workflow, read from the workflow file. Never typed here. */
function cronOf(file: string): string {
  const crons = cronsInWorkflowYaml(readFileSync(join(WORKFLOWS, file), "utf8"));
  assert.equal(crons.length, 1, `${file} does not hold exactly one cron`);
  return crons[0];
}

const runById = (workflow: keyof typeof RUNS, id: number): RunObservation => {
  const found = RUNS[workflow].find((r) => r.databaseId === id);
  assert.ok(found, `run ${id} is not in the recorded ${workflow} fixture`);
  return found;
};

/** The envelope the real 2026-08-27 event produces: anchored on 638 minutes. */
const ENVELOPE = deriveEnvelope([638, 602, 534, 44, 24]);

/* -------------------------------------------------------------------------- */
/* THE CRON IS READ, NOT RETYPED                                               */
/* -------------------------------------------------------------------------- */

test("the crons come out of the workflow files, and there are three of them", () => {
  const found: string[] = [];
  for (const file of readdirSync(WORKFLOWS)) {
    if (!file.endsWith(".yml")) continue;
    if (cronsInWorkflowYaml(readFileSync(join(WORKFLOWS, file), "utf8")).length > 0) found.push(file);
  }
  assert.deepEqual(
    found.sort(),
    ["intake-tripwire.yml", "job-watch.yml", "refresh-daily.yml"],
    "the audit's population of scheduled workflows changed",
  );
});

test("no cron value is written into the audit's TypeScript", () => {
  // RULING 147: the anchor must stay external. A cron retyped here would let
  // the schedule change in YAML while this module went on agreeing with itself.
  const source = readFileSync(join(ROOT, "lib", "ops", "schedule-audit.ts"), "utf8");
  for (const file of ["refresh-daily.yml", "intake-tripwire.yml", "job-watch.yml"]) {
    const cron = cronOf(file);
    assert.equal(
      source.includes(`"${cron}"`),
      false,
      `lib/ops/schedule-audit.ts contains the literal cron ${cron} from ${file}`,
    );
  }
});

test("a daily cron parses to its UTC minute of the day", () => {
  assert.deepEqual(parseDailyCron(cronOf("refresh-daily.yml")), { minute: 11, hour: 9 });
  assert.deepEqual(parseDailyCron(cronOf("intake-tripwire.yml")), { minute: 41, hour: 10 });
  assert.deepEqual(parseDailyCron(cronOf("job-watch.yml")), { minute: 40, hour: 15 });
});

test("an unsupported cron shape THROWS A NAMED ERROR rather than returning no slots", () => {
  // An empty slot list is a denominator of zero wearing the costume of a
  // healthy schedule (RULING 159).
  for (const cron of ["11 9 * * 1", "*/15 * * * *", "0,30 9 * * *", "11 9 1 * *", "11 9 * *"]) {
    assert.throws(
      () => expectedSlots(cron, "2026-08-21T00:00:00Z", "2026-08-28T00:00:00Z"),
      UnsupportedCronShapeError,
      `${cron} was expanded rather than refused`,
    );
  }
  assert.throws(() => parseDailyCron("99 9 * * *"), UnsupportedCronShapeError);
});

test("expectedSlots lists one UTC instant a day, inside the window and no wider", () => {
  const slots = expectedSlots(cronOf("refresh-daily.yml"), "2026-08-21T00:00:00Z", "2026-08-28T20:34:00Z");
  assert.deepEqual(slots, [
    "2026-08-21T09:11:00.000Z",
    "2026-08-22T09:11:00.000Z",
    "2026-08-23T09:11:00.000Z",
    "2026-08-24T09:11:00.000Z",
    "2026-08-25T09:11:00.000Z",
    "2026-08-26T09:11:00.000Z",
    "2026-08-27T09:11:00.000Z",
    "2026-08-28T09:11:00.000Z",
  ]);

  // The 15:40 slot on the last day has NOT happened yet at 09:00, and must not
  // be invented — a slot that has not come round is not a slot that produced
  // nothing.
  const jw = expectedSlots(cronOf("job-watch.yml"), "2026-08-27T00:00:00Z", "2026-08-28T09:00:00Z");
  assert.deepEqual(jw, ["2026-08-27T15:40:00.000Z"]);
});

/* -------------------------------------------------------------------------- */
/* THE ENVELOPE                                                                */
/* -------------------------------------------------------------------------- */

test("the envelope is derived from the largest observed delay, and says so", () => {
  const e = deriveEnvelope([638, 602, 534, 44, 24]);
  assert.equal(e.observationEnvelopeMinutes, 638);
  assert.equal(e.evidenceAnchored, true);
  assert.match(e.derivation, /LARGEST DISPATCH DELAY OBSERVED/);
  assert.match(e.derivation, /638/);
});

test("a quiet window falls back to the STATED FLOOR and says the floor is not evidence", () => {
  const e = deriveEnvelope([11, 13, 17]);
  assert.equal(e.observationEnvelopeMinutes, ENVELOPE_FLOOR_MINUTES);
  assert.equal(e.evidenceAnchored, false);
  assert.match(e.derivation, /STATED FLOOR/);

  const none = deriveEnvelope([]);
  assert.equal(none.observationEnvelopeMinutes, ENVELOPE_FLOOR_MINUTES);
  assert.equal(none.evidenceAnchored, false);
  assert.match(none.derivation, /nothing anchors it to evidence/);
});

test("the observed delays come out of the recorded runs, and the 2026-08-27 event is in them", () => {
  const slots = expectedSlots(cronOf("refresh-daily.yml"), "2026-08-21T00:00:00Z", "2026-08-28T20:34:00Z");
  const delays = observedDispatchDelays(slots, RUNS["refresh-daily.yml"]);
  // 09:11Z slot, run created 19:48:52Z: 637.9 minutes. Rounded up, 638.
  assert.ok(
    delays.some((d) => Math.ceil(d) === 638),
    `the 638-minute delay is not in ${JSON.stringify(delays)}`,
  );
});

/* -------------------------------------------------------------------------- */
/* THE TWO ABSENCE STATES ARE DIFFERENT STATES                                 */
/* -------------------------------------------------------------------------- */

test("NOT_YET_CREATED and NO_RUN_BEYOND_ENVELOPE are DIFFERENT STATES for the same missing run", () => {
  const slot = "2026-08-28T09:11:00.000Z";

  const pending = classify(slot, null, "2026-08-28T14:00:00.000Z", ENVELOPE);
  const beyond = classify(slot, null, "2026-08-28T20:34:00.000Z", ENVELOPE);

  assert.equal(pending.kind, "NOT_YET_CREATED");
  assert.equal(beyond.kind, "NO_RUN_BEYOND_ENVELOPE");
  assert.notEqual(pending.kind, beyond.kind);

  // Same slot, same absence of a run, same classifier. Only the elapsed time
  // and the STATED envelope separate them — which is the whole point: the
  // observation is identical and the two verdicts are claims of different
  // strength about US, not about GitHub.
  assert.equal(pending.runId, undefined);
  assert.equal(beyond.runId, undefined);
  assert.ok(pending.minutesSinceSlot! < pending.envelopeMinutes);
  assert.ok(beyond.minutesSinceSlot! > beyond.envelopeMinutes);
});

test("a pending slot names the 638-minute run as the reason it is still pending", () => {
  const v = classify("2026-08-28T09:11:00.000Z", null, "2026-08-28T14:00:00.000Z", ENVELOPE);
  assert.match(v.note, /PENDING, not absent/);
  assert.match(v.note, /33110252070/);
});

test("a slot past the envelope states the ENVELOPE and the as-of, and blames nobody", () => {
  const v = classify("2026-08-28T09:11:00.000Z", null, "2026-08-28T20:34:00.000Z", ENVELOPE);
  assert.match(v.note, /NO RUN OBSERVED/);
  assert.match(v.note, /STATEMENT ABOUT WHAT WE HAVE SEEN/);
  assert.match(v.note, /638/);
  assert.equal(v.asOf, "2026-08-28T20:34:00.000Z");
});

/* -------------------------------------------------------------------------- */
/* THE RULE: "GITHUB DID NOT FIRE THIS CRON" IS NEVER EMITTED                  */
/* -------------------------------------------------------------------------- */

test("no verdict KIND is a did-not-fire verdict", () => {
  for (const kind of SLOT_VERDICT_KINDS) {
    assert.equal(
      statesUnprovableAbsence(kind),
      false,
      `the verdict kind ${kind} asserts something no observer outside GitHub can prove`,
    );
    assert.doesNotMatch(kind, /SKIP|MISS|NOT_FIRED|NEVER/i, `${kind} reads as a claim about GitHub`);
  }
});

test("no verdict SENTENCE ever says a cron did not fire — swept over every fixture", () => {
  const now = "2026-08-28T20:34:00.000Z";
  const sentences: string[] = [];

  for (const [workflow, runs] of Object.entries(RUNS)) {
    const audit = auditWorkflow(
      workflow,
      cronOf(workflow),
      runs,
      "2026-08-21T00:00:00Z",
      now,
      ENVELOPE,
    );
    for (const v of audit.verdicts) {
      sentences.push(v.note);
      if (v.outcome) sentences.push(v.outcome.why);
    }
  }

  // Both absence verdicts must be represented, or this sweep proves nothing
  // about the sentences that matter most (RULING 159's floor, on a test).
  assert.ok(sentences.length > 15, `only ${sentences.length} verdict sentences were swept`);
  assert.ok(sentences.some((s) => /NO RUN OBSERVED for/.test(s)), "no beyond-envelope sentence was produced");

  for (const s of sentences) {
    assert.equal(statesUnprovableAbsence(s), false, `a verdict asserted an unprovable absence: ${s}`);
  }
});

test("the forbidden-claim detector actually catches the phrasings it is meant to", () => {
  // A guard that matches nothing passes every sweep. Prove it bites first.
  for (const phrasing of [
    "GitHub did not fire this cron",
    "the schedule never fired",
    "the cron didn't fire on 2026-08-28",
    "GitHub skipped this slot",
    "the run was not dispatched",
    "refresh-daily missed its slot",
  ]) {
    assert.equal(statesUnprovableAbsence(phrasing), true, `not caught: ${phrasing}`);
  }
  assert.equal(statesUnprovableAbsence("NO RUN OBSERVED for the 2026-08-28T09:11:00Z slot"), false);
});

/* -------------------------------------------------------------------------- */
/* RAN_FAILED AND RAN_PUSH_REJECTED ARE DIFFERENT STATES                       */
/* -------------------------------------------------------------------------- */

test("the two failures the existing watcher CONFLATES are told apart", () => {
  // Both of these fail at a step named "Commit". `scripts/watch-workflows.mts`
  // labels both `failing step: Commit` and stops there.
  const pushRejected: RunObservation = {
    ...runById("refresh-daily.yml", 32955499285),
    steps: STEPS.pushRejected,
    failureText: FAILURE_TEXT.gh006,
  };
  const dataFailed: RunObservation = {
    ...runById("refresh-daily.yml", 32833989579),
    steps: STEPS.dataFailed,
    failureText: FAILURE_TEXT.data,
  };

  const a = outcomeOf(pushRejected);
  const b = outcomeOf(dataFailed);

  assert.equal(a.kind, "RAN_PUSH_REJECTED");
  assert.equal(b.kind, "RAN_FAILED");
  assert.notEqual(a.kind, b.kind);

  // The tail carries both `protected branch hook declined` and `GH006`; the
  // marker reported is whichever the log shows first, and either is the proof.
  assert.match(a.marker!, /GH006|protected branch hook declined/);
  assert.match(FAILURE_TEXT.gh006, /GH006: Protected branch update failed/);
  assert.match(a.why, /NOT about the data/);
  assert.equal(failingStepsOf(pushRejected), "Commit");
  // The step name is IDENTICAL. Only the log text separates them.
  assert.equal(failingStepsOf(dataFailed), "Refresh every due source");
  assert.equal(b.marker, undefined);
});

test("the GitHub-side commit_refs fatal is a push rejection too (NH171)", () => {
  const run: RunObservation = {
    ...runById("intake-tripwire.yml", 32840268606),
    steps: STEPS.tripwirePushFailed,
    failureText: FAILURE_TEXT.commitRefs,
  };
  const o = outcomeOf(run);
  assert.equal(o.kind, "RAN_PUSH_REJECTED");
  assert.match(o.marker!, /fatal error in commit_refs/);
});

test("a failure whose log was not read says the discrimination COULD NOT be made", () => {
  // RULING 24: "not shown to be a push rejection" is not "shown not to be one".
  const o = outcomeOf({
    ...runById("refresh-daily.yml", 32955499285),
    steps: STEPS.pushRejected,
    failureText: undefined,
  });
  assert.equal(o.kind, "RAN_FAILED");
  assert.match(o.why, /cannot be ruled out/);
});

/* -------------------------------------------------------------------------- */
/* RAN_LANDED, RAN_NOOP, AND THE HONEST "CANNOT TELL"                          */
/* -------------------------------------------------------------------------- */

test("a landed refresh and a legitimate quiet day are DIFFERENT STATES", () => {
  const landed = outcomeOf({ ...runById("refresh-daily.yml", 33110252070), steps: STEPS.landed });
  const quiet = outcomeOf({ ...runById("refresh-daily.yml", 33110252070), steps: STEPS.quietDay.steps });

  assert.equal(landed.kind, "RAN_LANDED");
  assert.equal(quiet.kind, "RAN_NOOP");
  assert.notEqual(landed.kind, quiet.kind);
  assert.match(quiet.why, /zero commits, zero builds/);
});

test("the derived quiet-day fixture declares that it is derived", () => {
  // A fixture that lies about its origin is worse than no fixture.
  assert.ok(Array.isArray(STEPS.quietDay._provenance));
  assert.match(STEPS.quietDay._provenance.join(" "), /DERIVED, NOT RECORDED/);
  assert.match(STEPS.quietDay._provenance.join(" "), /33110252070/);
});

test("a workflow with no Unchanged step says it CANNOT TELL, never that it landed", () => {
  const o = outcomeOf({
    ...runById("job-watch.yml", 33130124147),
    steps: [
      { name: "Set up job", conclusion: "success" },
      { name: "Watch the scheduled jobs", conclusion: "success" },
      { name: "Commit any row it opened", conclusion: "success" },
    ],
  });
  assert.equal(o.kind, "RAN_SUCCEEDED_UNCLASSIFIED");
  assert.match(o.why, /limit of the\s+observation|limit of the observation/);
});

test("an in-flight run is neither a success nor a failure", () => {
  const o = outcomeOf({
    databaseId: 1,
    event: "schedule",
    status: "in_progress",
    conclusion: null,
    createdAt: "2026-08-28T09:11:00Z",
    startedAt: "2026-08-28T09:11:00Z",
    updatedAt: "2026-08-28T09:12:00Z",
  });
  assert.equal(o.kind, "RAN_IN_PROGRESS");
});

/* -------------------------------------------------------------------------- */
/* DISPATCH DELAY IS NOT QUEUEING                                              */
/* -------------------------------------------------------------------------- */

test("the 2026-08-27 refresh is DISPATCH_DELAYED, and its queue wait is zero", () => {
  const run: RunObservation = { ...runById("refresh-daily.yml", 33110252070), steps: STEPS.landed };
  const v = classify("2026-08-27T09:11:00.000Z", run, "2026-08-28T20:34:00.000Z", ENVELOPE);

  assert.equal(v.kind, "DISPATCH_DELAYED");
  assert.equal(Math.ceil(v.dispatchDelayMinutes!), 638);
  assert.equal(v.queueMinutes, 0, "startedAt === createdAt on every scheduled run read on 2026-08-28");
  assert.match(v.note, /BEFORE creation/);

  // NOTHING IS DROPPED TO FIT ONE LABEL: the run was late AND it landed, and
  // the verdict carries both.
  assert.equal(v.outcome!.kind, "RAN_LANDED");
});

test("QUEUED is a different verdict with a different cause", () => {
  const queued: RunObservation = {
    databaseId: 999,
    event: "schedule",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-27T09:12:00Z",
    startedAt: "2026-08-27T10:30:00Z",
    updatedAt: "2026-08-27T10:40:00Z",
    steps: STEPS.landed,
  };
  const v = classify("2026-08-27T09:11:00.000Z", queued, "2026-08-27T11:00:00.000Z", ENVELOPE);
  assert.equal(v.kind, "QUEUED");
  assert.equal(v.queueMinutes, 78);
  assert.match(v.note, /runner capacity, not GitHub's scheduler/);
});

test("the ordinary 11-to-57-minute lateness is NOT a finding", () => {
  // Every scheduled run before 2026-08-27 sits in this band. A tolerance that
  // fired on them would bury the queue in noise until nobody read it.
  const run: RunObservation = { ...runById("refresh-daily.yml", 32955499285), steps: STEPS.pushRejected, failureText: FAILURE_TEXT.gh006 };
  const v = classify("2026-08-26T09:11:00.000Z", run, "2026-08-28T20:34:00.000Z", ENVELOPE);
  assert.ok(v.dispatchDelayMinutes! < DISPATCH_TOLERANCE_MINUTES, `${v.dispatchDelayMinutes} min is not under tolerance`);
  assert.equal(v.kind, "RAN_PUSH_REJECTED", "an on-time run reports what it DID, not its timing");
});

/* -------------------------------------------------------------------------- */
/* MATCHING RUNS TO SLOTS                                                      */
/* -------------------------------------------------------------------------- */

test("a run created ten hours late belongs to ITS OWN slot, not the next day's", () => {
  const slots = expectedSlots(cronOf("refresh-daily.yml"), "2026-08-26T00:00:00Z", "2026-08-28T20:34:00Z");
  const { bySlot } = assignRunsToSlots(slots, RUNS["refresh-daily.yml"]);
  assert.equal(bySlot.get("2026-08-27T09:11:00.000Z")?.databaseId, 33110252070);
  assert.equal(bySlot.get("2026-08-28T09:11:00.000Z"), null, "the late run was credited to the wrong slot");
});

test("a workflow_dispatch never fills a slot", () => {
  // 32949636142, 32950685105, 32951929034 are all dispatches on 2026-08-26,
  // and the 09:11Z slot's run that day is the SCHEDULED 32955499285.
  const slots = expectedSlots(cronOf("refresh-daily.yml"), "2026-08-26T00:00:00Z", "2026-08-26T23:59:00Z");
  const { bySlot } = assignRunsToSlots(slots, RUNS["refresh-daily.yml"]);
  assert.equal(bySlot.get("2026-08-26T09:11:00.000Z")?.databaseId, 32955499285);
});

test("scheduled runs older than every slot are reported, never silently dropped", () => {
  const slots = expectedSlots(cronOf("intake-tripwire.yml"), "2026-08-27T00:00:00Z", "2026-08-28T20:34:00Z");
  const { unassigned } = assignRunsToSlots(slots, RUNS["intake-tripwire.yml"]);
  assert.ok(unassigned.length > 0, "the tripwire fixture reaches back to 2026-08-15; none fell outside the window");
});

/* -------------------------------------------------------------------------- */
/* THE WHOLE AUDIT, OVER THE REAL WINDOW                                       */
/* -------------------------------------------------------------------------- */

/**
 * **THE RULE, PROVEN BY THE DATA ITSELF, FIFTEEN MINUTES APART.**
 *
 * `runs-refresh-daily.json` was recorded at 2026-08-28T20:34Z. At that instant
 * the 09:11Z slot had produced nothing for 683 minutes and this audit said so —
 * `NO_RUN_BEYOND_ENVELOPE`, a claim about our observation.
 *
 * `runs-refresh-daily-late-arrival.json` was recorded at 20:49Z, while this
 * work was still being written. Run 33209856186 had appeared: created at
 * 20:49:11Z, **698 minutes after its slot**. The slot was never skipped. It was
 * in flight for eleven and a half hours.
 *
 * That is the whole reason `NO_RUN_BEYOND_ENVELOPE` may never be worded as
 * "GitHub did not fire this cron". Same slot, same classifier, two reads a
 * quarter of an hour apart, and the verdict moves — because the verdict was
 * always about US.
 */
test("a slot past the envelope FLIPS when the run finally arrives — it was never an absence", () => {
  const cron = cronOf("refresh-daily.yml");
  const slot = "2026-08-28T09:11:00.000Z";
  const inFlight = readJson<RunObservation[]>("runs-refresh-daily-late-arrival.json");
  const completed = readJson<RunObservation[]>("runs-refresh-daily-late-arrival-completed.json");

  const last = (runs: RunObservation[], now: string): SlotVerdict =>
    auditWorkflow("refresh-daily.yml", cron, runs, slot, now, ENVELOPE).verdicts.at(-1)!;

  // 20:34Z — 683 min of silence, past the 638-min envelope of the moment.
  const before = last(RUNS["refresh-daily.yml"], "2026-08-28T20:34:00.000Z");
  assert.equal(before.kind, "NO_RUN_BEYOND_ENVELOPE");
  assert.equal(before.runId, undefined);

  // 20:50Z — run 33209856186 exists, created 20:49:11Z, and is still running.
  const arriving = last(inFlight, "2026-08-28T20:50:00.000Z");
  assert.equal(arriving.kind, "DISPATCH_DELAYED");
  assert.equal(arriving.runId, 33209856186);
  assert.equal(Math.round(arriving.dispatchDelayMinutes!), 698);
  assert.equal(arriving.queueMinutes, 0, "the wait was entirely before creation");
  assert.equal(arriving.outcome!.kind, "RAN_IN_PROGRESS");

  // 20:55Z — it concluded success and landed a commit.
  const done = last(completed, "2026-08-28T20:55:00.000Z");
  assert.equal(done.kind, "DISPATCH_DELAYED");
  assert.equal(done.runId, 33209856186);

  // THE VERDICT MOVED WITHOUT THE SLOT MOVING. Same slot, same classifier,
  // three reads across twenty-one minutes. That is only coherent because
  // NO_RUN_BEYOND_ENVELOPE was always a claim about US.
  assert.notEqual(before.kind, arriving.kind);
});

test("the envelope is a floor that GROWS — the previous maximum is never a ceiling", () => {
  const cron = cronOf("refresh-daily.yml");
  const completed = readJson<RunObservation[]>("runs-refresh-daily-late-arrival-completed.json");
  const slots = expectedSlots(cron, "2026-08-21T00:00:00Z", "2026-08-28T20:55:00Z");

  // The envelope derived BEFORE this run existed was 638 minutes, and this
  // run's slot passed it while still in flight. Had 638 been hard-coded, the
  // instrument would have made a false claim about GitHub today.
  assert.equal(ENVELOPE.observationEnvelopeMinutes, 638);

  const grown = deriveEnvelope(observedDispatchDelays(slots, completed));
  assert.equal(grown.observationEnvelopeMinutes, 699, "the new observed maximum is 698.2 min, ceiled to 699");
  assert.ok(
    grown.observationEnvelopeMinutes > ENVELOPE.observationEnvelopeMinutes,
    "the envelope did not grow to admit the run that actually arrived",
  );
  assert.match(grown.derivation, /FLOOR THAT GROWS, NOT A CEILING/);
});

test("a slot before the workflow's FIRST EVER RUN is qualified, not reported as a missed run", () => {
  // Found by running the audit over seven days on 2026-08-28: refresh-daily.yml
  // reported silent slots on the 22nd, 23rd and 24th. RULING 124 created that
  // workflow ON the 24th. Three P1 rows about a workflow that did not exist yet
  // would teach a reader to skim the queue.
  const audit = auditWorkflow(
    "refresh-daily.yml",
    cronOf("refresh-daily.yml"),
    RUNS["refresh-daily.yml"],
    "2026-08-21T00:00:00Z",
    "2026-08-28T20:34:00.000Z",
    ENVELOPE,
  );

  const early = audit.verdicts.filter((v) => v.slot < "2026-08-25T09:11:00.000Z");
  assert.equal(early.length, 4, "the 21st through the 24th");
  for (const v of early) {
    assert.equal(v.kind, "NO_RUN_BEYOND_ENVELOPE");
    assert.equal(v.precedesFirstObservedRun, true, `${v.slot} was not qualified`);
    assert.match(v.note, /PRECEDES THE OLDEST RUN THIS WORKFLOW HAS EVER PRODUCED/);
    // Still not a claim about GitHub.
    assert.equal(statesUnprovableAbsence(v.note), false);
  }

  // The 2026-08-28 slot is AFTER the first run, so it is a real finding.
  const real = audit.verdicts.at(-1)!;
  assert.equal(real.kind, "NO_RUN_BEYOND_ENVELOPE");
  assert.equal(real.precedesFirstObservedRun, false);
});

test("the 2026-08-28 board: one workflow past the envelope, two still pending", () => {
  const now = "2026-08-28T20:34:00.000Z";
  const from = "2026-08-28T00:00:00.000Z";

  const kinds = (workflow: keyof typeof RUNS): string[] =>
    auditWorkflow(workflow, cronOf(workflow), RUNS[workflow], from, now, ENVELOPE).verdicts.map((v) => v.kind);

  // 09:11Z slot, 683 min ago, envelope 638 -> reportable.
  assert.deepEqual(kinds("refresh-daily.yml"), ["NO_RUN_BEYOND_ENVELOPE"]);
  // 10:41Z slot, 593 min ago -> still inside the envelope. NOT an absence.
  assert.deepEqual(kinds("intake-tripwire.yml"), ["NOT_YET_CREATED"]);
  // 15:40Z slot, 294 min ago -> still inside the envelope.
  assert.deepEqual(kinds("job-watch.yml"), ["NOT_YET_CREATED"]);
});

test("2026-08-27 was late for all three at once — one upstream event, not three defects", () => {
  const now = "2026-08-28T00:45:00.000Z";
  const from = "2026-08-27T00:00:00.000Z";

  const delays: Record<string, number> = {};
  for (const workflow of Object.keys(RUNS) as (keyof typeof RUNS)[]) {
    const audit = auditWorkflow(workflow, cronOf(workflow), RUNS[workflow], from, now, ENVELOPE);
    const delayed = audit.verdicts.filter((v) => v.kind === "DISPATCH_DELAYED");
    assert.equal(delayed.length, 1, `${workflow} did not report exactly one delayed slot`);
    delays[workflow] = Math.round(delayed[0].dispatchDelayMinutes!);
  }

  assert.equal(delays["refresh-daily.yml"], 638);
  assert.equal(delays["intake-tripwire.yml"], 602);
  assert.equal(delays["job-watch.yml"], 534);
});

/* -------------------------------------------------------------------------- */
/* CATCH-UP — THE ACTUAL RELIABILITY REPAIR                                    */
/* -------------------------------------------------------------------------- */

/**
 * **THESE LIVE HERE, NOT IN `tests/refresh-cadence.test.ts`, ON PURPOSE.**
 *
 * That file's job is the CRON SHAPE — exactly three scheduled workflows and
 * exactly one cron each, which is the duplicate-run shape RULING 78 removed.
 * Catch-up exists precisely so that shape does not have to change: a second
 * offset cron would recover a skipped day and would need a later-dated ruling
 * to do it, while unioning the uncovered days inside the run that is already
 * happening recovers the same days with no governance change at all. Putting
 * these assertions in the file that guards the cron count would blur the two.
 */

const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const ids = (ds: readonly { source: { id: string }; due: boolean }[]): string[] =>
  ds.filter((d) => d.due).map((d) => d.source.id);

test("with no last-landed date, catch-up claims nothing — today alone", () => {
  // No state is not permission to invent state.
  assert.deepEqual(catchUpSlots(null, day("2026-09-02")).map(utcDay), ["2026-09-02"]);
  assert.deepEqual(catchUpSlots(undefined, day("2026-09-02")).map(utcDay), ["2026-09-02"]);
  assert.deepEqual(catchUpSlots(new Date("not a date"), day("2026-09-02")).map(utcDay), ["2026-09-02"]);
});

test("a landed refresh today or later means there is nothing to recover", () => {
  assert.deepEqual(catchUpSlots(day("2026-09-02"), day("2026-09-02")).map(utcDay), ["2026-09-02"]);
  assert.deepEqual(catchUpSlots(day("2026-09-05"), day("2026-09-02")).map(utcDay), ["2026-09-02"]);
});

test("the window is every uncovered day, oldest first, with TODAY always last", () => {
  assert.deepEqual(catchUpSlots(day("2026-08-30"), day("2026-09-02")).map(utcDay), [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
  ]);
});

test("the window is CAPPED, and the cap keeps a quiet fortnight off a daily cadence", () => {
  const days = catchUpSlots(day("2026-07-01"), day("2026-09-02"));
  assert.equal(days.length, CATCH_UP_MAX_DAYS);
  assert.equal(utcDay(days.at(-1)!), "2026-09-02");
  assert.equal(utcDay(days[0]), "2026-08-26");
});

test("A SKIPPED MONDAY IS RECOVERED — the fourteen-day gap this repair exists for", () => {
  // 2026-08-31 is a Monday. fec and legiscan are Monday-only, so a slot that
  // produces no run on that day would otherwise mean no federal committee data
  // and no state roll-call data until 2026-09-07.
  const wednesday = day("2026-09-02");

  // Today's cadence alone: neither weekly source runs.
  assert.deepEqual(ids(dueDecisions(null, wednesday)), ["meetings", "nj-filing"]);

  // With Monday uncovered, both come back.
  const caught = dueDecisions(day("2026-08-30"), wednesday);
  assert.deepEqual(ids(caught), ["meetings", "nj-filing", "fec", "legiscan", "dotgov"]);

  const fec = caught.find((d) => d.source.id === "fec")!;
  assert.equal(fec.due, true);
  assert.equal(fec.dueToday, false, "it is a Wednesday — it is NOT due today, and the report must not say it is");
  assert.deepEqual(fec.recoveredFrom, ["2026-08-31"], "the row must name the Monday it is recovering");

  // dotgov is monthly and 2026-09-01 is the 1st, so the same window recovers it.
  const dotgov = caught.find((d) => d.source.id === "dotgov")!;
  assert.deepEqual(dotgov.recoveredFrom, ["2026-09-01"]);
});

test("a single skipped day unions that day's sources into the next run", () => {
  // Monday 2026-08-31 skipped, Tuesday 2026-09-01 runs.
  const tuesday = day("2026-09-01");
  assert.deepEqual(ids(dueDecisions(null, tuesday)), ["meetings", "nj-filing", "dotgov"]);
  assert.deepEqual(ids(dueDecisions(day("2026-08-30"), tuesday)), [
    "meetings",
    "nj-filing",
    "fec",
    "legiscan",
    "dotgov",
  ]);
});

test("a source due TODAY is never reported as a catch-up", () => {
  const monday = day("2026-08-31");
  const d = dueDecisions(day("2026-08-29"), monday).find((x) => x.source.id === "fec")!;
  assert.equal(d.dueToday, true);
  assert.deepEqual(d.recoveredFrom, [], "today's own cadence is not a recovery");
});

test("catch-up never DROPS today, however far back the window reaches", () => {
  for (const iso of ["2026-08-31", "2026-09-01", "2026-09-02", "2026-11-04"]) {
    const days = catchUpSlots(day("2026-07-01"), day(iso));
    assert.equal(utcDay(days.at(-1)!), iso, `${iso} fell out of its own catch-up window`);
  }
});

test("the union is a UNION — it never runs a source no day asked for", () => {
  // 2026-11-04 is the Wednesday after the election, when every elevation has
  // expired and no source is due. A catch-up across that week must stay empty
  // except for the Monday.
  assert.deepEqual(ids(dueDecisions(day("2026-11-03"), day("2026-11-04"))), []);
  assert.deepEqual(ids(dueDecisions(day("2026-11-08"), day("2026-11-10"))), [
    "meetings",
    "nj-filing",
    "fec",
    "legiscan",
  ]);
});

test("catch-up does not raise the build ceiling", () => {
  // It adds source calls inside a run that is already happening. It adds no
  // runs, and the workflow still commits at most once.
  assert.equal(maxScheduledBuildsPerMonth(), 30);
});

test("every audited slot carries a denominator's worth of verdicts, and every verdict a note", () => {
  const audit = auditWorkflow(
    "refresh-daily.yml",
    cronOf("refresh-daily.yml"),
    RUNS["refresh-daily.yml"],
    "2026-08-21T00:00:00Z",
    "2026-08-28T20:34:00.000Z",
    ENVELOPE,
  );
  assert.equal(audit.verdicts.length, 8, "eight daily slots in an eight-day window");
  for (const v of audit.verdicts) {
    assert.ok(v.note.length > 40, `a verdict for ${v.slot} carries no sentence`);
    assert.equal(v.asOf, "2026-08-28T20:34:00.000Z", "a verdict is stamped with as-of, never with now");
    assert.ok(SLOT_VERDICT_KINDS.includes(v.kind));
  }
});
