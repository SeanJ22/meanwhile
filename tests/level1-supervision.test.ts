/**
 * **THE ACTIVE VERDICT REQUIRES A PROVEN PARENT RELAUNCH.** (Work Item 3.2,
 * 2026-09-02. RULING 246.)
 *
 * `deriveLevel1` used to answer ACTIVE from a heartbeat, a fresh state, no
 * pause, the lane on, the credential named and the cap permitting — without
 * ever asking whether anything would bring the runner back if it died. A
 * historical Scout success is not a live lane, and a live lane nothing
 * relaunches is one kill from dead. Each test plants one way the proof can
 * be missing or stale and asserts DEGRADED with the reason named.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readRelaunchTriggerVerification } from "../lib/control-plane/scheduler/host-supervision.ts";

import {
  RESEARCH_BOUNDS,
  SUPERVISION_PROOF_MAX_AGE_DAYS,
  deriveLevel1,
  type HostSupervision,
  type ResearchState,
} from "../lib/control-plane/scheduler/research-policy.ts";

const NOW = "2026-09-02T16:00:00.000Z";

function supervision(over: Partial<HostSupervision> = {}, proofOver: Partial<NonNullable<HostSupervision["proof"]>> = {}): HostSupervision {
  return {
    host: "NH305",
    checkedAt: NOW,
    measurable: true,
    notMeasurableReason: null,
    relaunchTrigger: { present: true, detail: "Repetition trigger present on the live task" },
    proof: {
      measuredAt: "2026-09-02T15:36:25.000Z",
      killedPid: 20240,
      relaunchedPid: 12900,
      secondsToRelaunch: 274,
      relaunchTriggerPresent: true,
      taskStateAfter: "Running",
      lastTaskResult: "0x00000000",
      verdict: "RELAUNCHED",
      ...proofOver,
    },
    proofPath: "data/ops/runner-relaunch-proof.json",
    ...over,
  };
}

function state(hostSupervision: HostSupervision | null | undefined, extra: Record<string, unknown> = {}): ResearchState {
  return {
    formatVersion: 1,
    beatAt: NOW,
    cycleStartedAt: NOW,
    cycleFinishedAt: NOW,
    testedSha: "abc",
    host: "NH305",
    modelLaneEnabled: true,
    modelLaneDisabledReason: null,
    pausedByOwner: false,
    pauseIntentId: null,
    workerCredential: { name: "WTP_WORKERS_ANTHROPIC_API_KEY", configured: true, provider: "anthropic", context: "test" },
    model: "claude-opus-5",
    bounds: RESEARCH_BOUNDS,
    spend: { windowUsd: 1, measuredAttempts: 1, unmeasuredAttempts: 0, asOf: NOW },
    queue: { registeredUnits: 1, modelClassUnits: 1, modelClassDue: 1, modelClassDispatchedThisCycle: 1, modelClassDeferredForCeiling: 0, modelClassDeferredForCycleMax: 0, modelClassDeferredForLane: 0, deterministicDue: 0, deterministicDispatchedThisCycle: 0 },
    running: [],
    runtimeConditions: [],
    methodCandidates: null,
    ...(hostSupervision === undefined ? {} : { hostSupervision }),
    ...extra,
  } as unknown as ResearchState;
}

const heartbeat = { formatVersion: 1, beatAt: NOW, lastCycleStartedAt: NOW, lastCycleFinishedAt: NOW, nextCycleDueAt: null, lastCycleOk: true, testedSha: "abc", host: "NH305" };

function derive(s: ResearchState) {
  return deriveLevel1({ nowIso: NOW, heartbeat, state: s, intents: [], spendWindowUsd: 1, spendUnmeasuredAttempts: 0 });
}

const condition = (r: ReturnType<typeof derive>) => r.conditions.find((c) => c.name.startsWith("host supervision"))!;

test("POSITIVE CONTROL: a fresh RELAUNCHED proof with the trigger live, and everything else met, derives ACTIVE", () => {
  const r = derive(state(supervision()));
  assert.equal(r.verdict, "ACTIVE", r.reasons.join("; "));
  assert.equal(condition(r).ok, true);
  assert.equal(condition(r).required, false, "supervision is a SOFT condition: its absence degrades, never inactivates");
  assert.match(condition(r).reason, /pid 20240 killed, pid 12900 back in 274s/);
});

test("SEEDED: no supervision reading on the state derives DEGRADED naming the unproven relaunch", () => {
  for (const s of [state(undefined), state(null)]) {
    const r = derive(s);
    assert.equal(r.verdict, "DEGRADED");
    assert.match(condition(r).reason, /has not been proven/);
    assert.ok(r.reasons.some((x) => /host supervision proven/.test(x)));
  }
});

test("SEEDED: a proof file absent on the host derives DEGRADED naming the path and the command", () => {
  const r = derive(state(supervision({ proof: null })));
  assert.equal(r.verdict, "DEGRADED");
  assert.match(condition(r).reason, /no relaunch proof at data\/ops\/runner-relaunch-proof\.json/);
  assert.match(condition(r).reason, /prove-relaunch/);
});

test("SEEDED: a STALE proof — older than the tolerance — derives DEGRADED naming its age", () => {
  assert.equal(SUPERVISION_PROOF_MAX_AGE_DAYS, 30);
  const old = new Date(Date.parse(NOW) - (SUPERVISION_PROOF_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
  const r = derive(state(supervision({}, { measuredAt: old })));
  assert.equal(r.verdict, "DEGRADED");
  assert.match(condition(r).reason, new RegExp(`${SUPERVISION_PROOF_MAX_AGE_DAYS + 1} day\\(s\\) old, past the ${SUPERVISION_PROOF_MAX_AGE_DAYS}-day tolerance`));
  /* At the edge of the tolerance it still counts; a proof dated in the future does not. */
  const edge = new Date(Date.parse(NOW) - (SUPERVISION_PROOF_MAX_AGE_DAYS - 1) * 86_400_000).toISOString();
  assert.equal(derive(state(supervision({}, { measuredAt: edge }))).verdict, "ACTIVE");
  assert.equal(derive(state(supervision({}, { measuredAt: "2026-10-01T00:00:00.000Z" }))).verdict, "DEGRADED");
});

test("SEEDED: a NOT_RELAUNCHED proof derives DEGRADED naming the verdict", () => {
  const r = derive(state(supervision({}, { verdict: "NOT_RELAUNCHED", relaunchedPid: null, secondsToRelaunch: null })));
  assert.equal(r.verdict, "DEGRADED");
  assert.match(condition(r).reason, /NOT_RELAUNCHED/);
  assert.match(condition(r).reason, /killed pid 20240, nothing came back/);
});

test("SEEDED: a RELAUNCHED proof whose live trigger has since gone derives DEGRADED naming the trigger", () => {
  const r = derive(state(supervision({ relaunchTrigger: { present: false, detail: "no Repetition trigger on the live task" } })));
  assert.equal(r.verdict, "DEGRADED");
  assert.match(condition(r).reason, /no longer carries the relaunch trigger/);
});

test("SEEDED: a host that cannot be asked derives DEGRADED naming the host, never ACTIVE by default", () => {
  const r = derive(state(supervision({ measurable: false, notMeasurableReason: "NOT_MEASURABLE_ON_THIS_HOST (linux)", relaunchTrigger: { present: null, detail: "not asked" }, proof: null })));
  assert.equal(r.verdict, "DEGRADED");
  assert.match(condition(r).reason, /cannot be asked/);
  assert.match(condition(r).reason, /NOT_MEASURABLE_ON_THIS_HOST/);
});

test("SEEDED: a stored ACTIVE flag is still ignored — a state asserting active with no proof reads DEGRADED", () => {
  const r = derive(state(undefined, { active: true, verdict: "ACTIVE", supervised: true }));
  assert.equal(r.verdict, "DEGRADED");
});

const verifiedTask = {
  facts: { taskPresent: true, state: "Running", relaunchTriggerPresent: true },
  verdict: "VERIFIED", stableLauncherVerified: true, processIdentityVerified: true,
};
const readTrigger = (value: unknown, status: number | null = 0) =>
  readRelaunchTriggerVerification({ stdout: JSON.stringify(value), status });

test("current nested task verification proves the live trigger while the relaunch proof remains independently required", () => {
  const reading = readTrigger(verifiedTask);
  assert.equal(reading.present, true);
  assert.match(reading.detail, /taskPresent true, state Running, relaunchTriggerPresent true/);
  assert.equal(derive(state(supervision({ relaunchTrigger: reading }))).verdict, "ACTIVE");
  assert.equal(derive(state(supervision({ relaunchTrigger: reading, proof: null }))).verdict, "DEGRADED");
  assert.equal(derive(state(supervision({ relaunchTrigger: reading }, { verdict: "NOT_RELAUNCHED" }))).verdict, "DEGRADED");
});

test("refused or failed trigger verification cannot certify supervision or disable model admission", () => {
  for (const reading of [
    readTrigger({ ...verifiedTask, verdict: "REFUSED" }),
    readTrigger({ ...verifiedTask, stableLauncherVerified: false }),
    readTrigger({ ...verifiedTask, processIdentityVerified: false }),
    readTrigger(verifiedTask, 1), readTrigger(verifiedTask, null),
    readRelaunchTriggerVerification({ stdout: JSON.stringify(verifiedTask), status: 0, failedToRun: true }),
  ]) {
    assert.equal(reading.present, null);
    const current = state(supervision({ relaunchTrigger: reading }));
    const derived = derive(current);
    assert.equal(derived.verdict, "DEGRADED");
    assert.equal(current.modelLaneEnabled, true);
    assert.equal(condition(derived).required, false);
    assert.match(condition(derived).reason, /live supervision could not be verified/);
    assert.doesNotMatch(condition(derived).reason, /no longer carries/);
  }
});

test("missing malformed and legacy flat task results remain unknown rather than asserting an absent trigger", () => {
  for (const value of [null, {}, [], verifiedTask.facts, { ...verifiedTask, facts: null },
    ...[{}, { ...verifiedTask.facts, taskPresent: "true" }, { ...verifiedTask.facts, relaunchTriggerPresent: null },
      { ...verifiedTask.facts, relaunchTriggerPresent: "true" }, { ...verifiedTask.facts, state: undefined },
      { ...verifiedTask.facts, state: "unrecognized" }, { ...verifiedTask.facts, state: "Unknown" }].map(facts => ({ ...verifiedTask, facts })),
  ]) assert.equal(readTrigger(value).present, null);
  for (const stdout of ["", "No task information", "{malformed}"]) {
    assert.equal(readRelaunchTriggerVerification({ stdout, status: 0 }).present, null);
  }
});

test("explicit task trigger absence or disabled task stays false in a verified envelope", () => {
  for (const facts of [{ ...verifiedTask.facts, relaunchTriggerPresent: false },
    { ...verifiedTask.facts, taskPresent: false }, { ...verifiedTask.facts, state: "Disabled" }]) {
    const reading = readTrigger({ ...verifiedTask, facts });
    assert.equal(reading.present, false);
    assert.equal(derive(state(supervision({ relaunchTrigger: reading }))).verdict, "DEGRADED");
  }
});
