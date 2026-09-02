/**
 * **THE RESEARCH VIEW'S SEEDED FAILURES.** (Level 1 activation, 2026-09-01.)
 *
 * Each of these is a defect that would be invisible in normal use:
 *
 *   1  an admin route on the public host must 404, and an unauthenticated
 *      request on the admin host must be refused before any data is read
 *   2  the intent route must refuse a cross-origin post and an unknown action,
 *      and must say NOT RECORDED when the control plane cannot open
 *   3  a stored flag asserting the lane is active must be IGNORED — the
 *      verdict is derived from the heartbeat, the state, the intents and the
 *      spend, and nothing else
 *   4  a historical success is not a live lane: a successful Scout result
 *      beside a dead runner still derives INACTIVE
 *   5  every number the page emits carries a denominator and a contract
 *   6  the credential never travels: name and configured flag only
 *
 * Positive controls sit beside every detector that could look at nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { POST } from "@/app/api/admin/research/route.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, hostOf } from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  SESSION_LIFETIME_SECONDS,
  signSession,
} from "@/lib/control-plane/admin-auth.ts";
import type { ReadOutcome } from "@/lib/control-plane/admin-data.ts";
import type { CostEntry } from "@/lib/control-plane/cost.ts";
import {
  HEARTBEAT_LATE_MINUTES,
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type RunnerHeartbeat,
} from "@/lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { CONTROL_PLANE_URL_VAR } from "@/lib/control-plane/repository/pg-store.ts";
import {
  INTENTS_SHOWN,
  SCOUT_RESULTS_SHOWN,
  appendResearchIntent,
  buildResearchIntent,
  buildResearchView,
  countClaimsOf,
  parseResearchIntentAction,
  readResearchIntents,
  readResearchState,
  readScoutEvidenceCount,
  readScoutResults,
  readScoutSpend,
  renderedNumbersOf,
  type ResearchViewInput,
} from "@/lib/control-plane/research-view.ts";
import {
  RESEARCH_BOUNDS,
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_ACTIONS,
  RESEARCH_INTENT_LOG_KEY,
  RESEARCH_STATE_ID,
  WORKER_CREDENTIAL_VAR,
  type ResearchIntent,
  type ResearchState,
} from "@/lib/control-plane/scheduler/research-policy.ts";
import type { ScoutResult } from "@/lib/control-plane/scheduler/scout-result.ts";

const ROOT = process.cwd();
const ADMIN_HOST = hostOf(ADMIN_ORIGIN);
const PUBLIC_HOST = hostOf(PUBLIC_SITE_ORIGIN);
const SESSION_KEY = "test-session-key-that-is-long-enough-to-sign-with";

/* ------------------------------------------------------------------ fixtures */

const NOW = "2026-09-01T12:00:00.000Z";
const FRESH = "2026-09-01T11:55:00.000Z";
/** Five hours before NOW: past HEARTBEAT_LATE_MINUTES by any reading. */
const STALE = "2026-09-01T07:00:00.000Z";

function heartbeat(beatAt: string): RunnerHeartbeat {
  return {
    formatVersion: 1,
    beatAt,
    lastCycleStartedAt: beatAt,
    lastCycleFinishedAt: beatAt,
    nextCycleDueAt: null,
    lastCycleOk: true,
    testedSha: "abc1234",
    host: "test-host",
  };
}

function state(over: Record<string, unknown> = {}): ResearchState {
  return {
    formatVersion: RESEARCH_FORMAT_VERSION,
    beatAt: FRESH,
    cycleStartedAt: FRESH,
    cycleFinishedAt: null,
    testedSha: "abc1234",
    host: "test-host",
    modelLaneEnabled: true,
    modelLaneDisabledReason: null,
    pausedByOwner: false,
    pauseIntentId: null,
    workerCredential: {
      name: WORKER_CREDENTIAL_VAR,
      configured: true,
      provider: "model-provider",
      context: "standing runner",
    },
    model: "scout-model-fixture",
    bounds: RESEARCH_BOUNDS,
    spend: { windowUsd: 1.5, measuredAttempts: 3, unmeasuredAttempts: 0, asOf: FRESH },
    queue: {
      registeredUnits: 40,
      modelClassUnits: 12,
      modelClassDue: 5,
      modelClassDispatchedThisCycle: 2,
      modelClassDeferredForCeiling: 0,
      modelClassDeferredForCycleMax: 3,
      modelClassDeferredForLane: 0,
      deterministicDue: 20,
      deterministicDispatchedThisCycle: 9,
    },
    running: [{ attemptId: "att-run-1", obligationId: "obl-1", startedAt: FRESH }],
    runtimeConditions: [],
    methodCandidates: { proposed: 4, validated: 2, admitted: 1, rejected: 1 },
    ...over,
  } as unknown as ResearchState;
}

function scoutResult(over: Partial<ScoutResult> = {}): ScoutResult {
  return {
    formatVersion: 1,
    attemptId: "att-1",
    obligationId: "obl-1",
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    subjectId: "ocd-division/country:us/state:az/place:tucson",
    routeId: null,
    recordClass: "meeting-agenda",
    providerId: null,
    reason: "no deterministic route opens this representation",
    outcome: "EVIDENCE_FOUND",
    stoppedBy: "MODEL",
    rungs: [],
    distinctEvidenceRungs: 1,
    candidates: [],
    findings: [{ summary: "agenda pointer", artifactIds: ["art-1"], kind: "POINTER" }],
    nextRungs: [],
    unverified: [],
    narrative: "found a pointer",
    worker: { provider: "model-provider", model: "scout-model-fixture", modelReported: null },
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      turns: 3,
      toolCalls: 2,
    },
    usd: 0.02,
    elapsedMs: 12_000,
    artifactIds: ["art-1"],
    methodCandidateIds: [],
    refusal: null,
    startedAt: FRESH,
    recordedAt: FRESH,
    ...over,
  };
}

function costEntry(over: Partial<CostEntry> & { readonly attemptId: string }): CostEntry {
  return {
    workItemId: "wi-1",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction: null,
    project: "level-1",
    role: "SCOUT",
    cost: {
      inputTokens: null,
      outputTokens: null,
      usd: 0.5,
      durationMs: null,
      bytesFetched: null,
      requestCount: null,
    },
    recordedAt: FRESH,
    ...over,
  };
}

function heldOut<T>(value: T): ReadOutcome<T> {
  return { kind: "HELD", value };
}
function notRecorded<T>(): ReadOutcome<T> {
  return { kind: "NOT_RECORDED", detail: "The control plane is reachable and holds no such record yet." };
}
function unreachableOut<T>(): ReadOutcome<T> {
  return { kind: "STORE_UNREACHABLE", detail: "Reading it failed (TestError). We could not ask." };
}

function healthyInput(over: Partial<ResearchViewInput> = {}): ResearchViewInput {
  return {
    nowIso: NOW,
    heartbeat: heldOut(heartbeat(FRESH)),
    state: heldOut(state()),
    intents: heldOut<readonly ResearchIntent[]>([]),
    results: heldOut({ total: 1, latest: [scoutResult()] }),
    spend: heldOut({ windowUsd: 1.5, measured: 3, unmeasured: 0, windowHours: 24, asOf: NOW }),
    evidence: heldOut({ distinctArtifacts: 1, citations: 1, attempts: 1, attemptsWithEvidence: 1 }),
    ...over,
  };
}

/* ------------------------------------------------------------ requests */

function request(host: string, path: string): NextRequest {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

function post(host: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${host}/api/admin/research`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

async function sessionCookie(): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const value = await signSession(
    { sid: "adm_test-session", iat, exp: iat + SESSION_LIFETIME_SECONDS },
    SESSION_KEY,
  );
  return `${ADMIN_SESSION_COOKIE}=${value}`;
}

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

function withSessionKey<T>(fn: () => Promise<T>): Promise<T> {
  return withEnv(ADMIN_SESSION_KEY_VAR, SESSION_KEY, fn);
}

/* ================================================================== *
 * SEEDED FAILURE 1 — host and session boundaries, through the real middleware
 * ================================================================== */

test("SEEDED: /admin/research and /api/admin/research return 404 on the PUBLIC host", async () => {
  for (const path of ["/admin/research", "/api/admin/research", "/admin/research?attempt=x"]) {
    const response = await middleware(request(PUBLIC_HOST, path));
    assert.equal(response.status, 404, `${path} on the public host must be 404, not ${response.status}`);
  }
  const posted = await middleware(post(PUBLIC_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN }));
  assert.equal(posted.status, 404, "a POST on the public host is 404 too");
});

test("SEEDED: an unauthenticated /admin/research request on the ADMIN host redirects to the login", async () => {
  const response = await middleware(request(ADMIN_HOST, "/admin/research"));
  assert.equal(response.status, 307);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/admin\/login/);
  assert.match(location, /why=/);
});

test("SEEDED: an unauthenticated /api/admin/research request on the ADMIN host is 401", async () => {
  const response = await middleware(post(ADMIN_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN }));
  assert.equal(response.status, 401);
});

/* ================================================================== *
 * SEEDED FAILURE 2 — the intent route's own refusals, in sequence
 * ================================================================== */

test("the handler re-verifies the host: a public-host request is 404 even with everything else valid", async () => {
  await withSessionKey(async () => {
    const cookie = await sessionCookie();
    const response = await POST(post(PUBLIC_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN, cookie }));
    assert.equal(response.status, 404);
  });
});

test("SEEDED: a missing or cross-site Origin is refused with 403", async () => {
  await withSessionKey(async () => {
    const cookie = await sessionCookie();
    const missing = await POST(post(ADMIN_HOST, "action=PAUSE", { cookie }));
    assert.equal(missing.status, 403, "a MISSING Origin is refused, not allowed");
    const cross = await POST(post(ADMIN_HOST, "action=PAUSE", { origin: PUBLIC_SITE_ORIGIN, cookie }));
    assert.equal(cross.status, 403, "the public origin may not post an intent");
  });
});

test("the handler re-verifies the session: no cookie is 401 inside the handler too", async () => {
  await withSessionKey(async () => {
    const response = await POST(post(ADMIN_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN }));
    assert.equal(response.status, 401);
  });
});

test("SEEDED: an unknown or missing action is 400 and names the allowed actions", async () => {
  await withSessionKey(async () => {
    const cookie = await sessionCookie();
    for (const body of ["action=DELETE_EVERYTHING", "action=pause", "action=", ""]) {
      const response = await POST(post(ADMIN_HOST, body, { origin: ADMIN_ORIGIN, cookie }));
      assert.equal(response.status, 400, `${JSON.stringify(body)} must be 400, not ${response.status}`);
      const payload = (await response.json()) as { error: string };
      for (const action of RESEARCH_INTENT_ACTIONS) assert.match(payload.error, new RegExp(action));
    }
  });
});

test("POSITIVE CONTROL and SEEDED: a valid action passes validation, and a control plane that cannot open is 503 NOT RECORDED", async () => {
  // With the control-plane variable unset the handler cannot reach a store, so
  // the ONLY status past validation is 503. That both proves the 400 above was
  // the action's fault and proves a failed open is never a redirect.
  await withSessionKey(() =>
    withEnv(CONTROL_PLANE_URL_VAR, undefined, async () => {
      const cookie = await sessionCookie();
      for (const action of RESEARCH_INTENT_ACTIONS) {
        const response = await POST(post(ADMIN_HOST, `action=${action}`, { origin: ADMIN_ORIGIN, cookie }));
        assert.equal(response.status, 503, `${action} must reach the open and be told NOT RECORDED`);
        const payload = (await response.json()) as { error: string; detail: string };
        assert.equal(payload.error, "not recorded");
        assert.match(payload.detail, new RegExp(CONTROL_PLANE_URL_VAR));
        assert.doesNotMatch(payload.detail, /postgres:\/\//, "no connection string may leak");
      }
    }),
  );
});

test("the route's security sequence is the decision route's, in order", () => {
  const source = readFileSync(join(ROOT, "app", "api", "admin", "research", "route.ts"), "utf8");
  const order = [
    "isAdminHostRequest(",
    "originAllowed(",
    "verifySession(",
    "parseResearchIntentAction(",
    "openControlPlane(",
    "appendResearchIntent(",
    "NextResponse.redirect(",
  ].map((needle) => {
    // The LAST occurrence is the call; the first may be the import line.
    const at = source.lastIndexOf(needle);
    assert.ok(at >= 0, `${needle} is not called in the route`);
    return at;
  });
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], `step ${i} runs out of sequence`);
  }
  assert.match(source, /export const runtime = "nodejs"/);
  assert.doesNotMatch(source, /export (async )?function GET/, "POST only");
});

test("parseResearchIntentAction accepts exactly the intent actions", () => {
  for (const action of RESEARCH_INTENT_ACTIONS) {
    assert.equal(parseResearchIntentAction(action), action);
    assert.equal(parseResearchIntentAction(`  ${action} `), action);
  }
  for (const bad of ["pause", "", null, undefined, 3, "PAUSE; DROP", ["PAUSE"]]) {
    assert.equal(parseResearchIntentAction(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

/* ================================================================== *
 * THE ACCEPTED INTENT, AS APPENDED
 * ================================================================== */

test("an accepted intent carries actor, adminSessionRef, requestedAt and action, and lands under the log key", async () => {
  const repos = createMemoryRepositories();
  const intent = buildResearchIntent("PAUSE", NOW, "adm_test-session");
  assert.deepEqual(intent, {
    formatVersion: RESEARCH_FORMAT_VERSION,
    kind: "INTENT",
    intentId: `PAUSE:${NOW}`,
    action: "PAUSE",
    requestedAt: NOW,
    actor: "owner (admin session)",
    adminSessionRef: "adm_test-session",
    note: null,
  });

  const wrote = await appendResearchIntent(repos, intent, NOW);
  assert.deepEqual(wrote, { ok: true, appended: true });
  const log = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
  assert.deepEqual(log, [intent]);

  // A retried append of the identical record is a no-op success, never a duplicate.
  const again = await appendResearchIntent(repos, intent, NOW);
  assert.deepEqual(again, { ok: true, appended: false });
  assert.equal((await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length, 1);
});

test("POSITIVE CONTROL: the append path refuses a record carrying a reader-level field", async () => {
  const repos = createMemoryRepositories();
  const poisoned = { ...buildResearchIntent("RESUME", NOW, "adm_x"), email: "someone@example.com" };
  const wrote = await appendResearchIntent(repos, poisoned as never, NOW);
  assert.equal(wrote.ok, false);
  if (!wrote.ok) assert.match(wrote.detail, /email/);
  assert.deepEqual(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY), []);
});

/* ================================================================== *
 * SEEDED FAILURE 3 — a stored flag is IGNORED; the verdict is derived
 * ================================================================== */

test("POSITIVE CONTROL: a fresh heartbeat, current state, no pause and permitted spend derive ACTIVE", () => {
  const view = buildResearchView(healthyInput());
  assert.equal(view.verdict, "ACTIVE");
  assert.deepEqual(view.reasons, []);
  assert.equal(view.runner.state, "ALIVE");
  assert.equal(view.pauseAction, "PAUSE");
});

test("SEEDED: a state asserting active with a STALE heartbeat derives INACTIVE naming the heartbeat", () => {
  const asserted = state({ active: true, verdict: "ACTIVE", alive: true });
  const view = buildResearchView(
    healthyInput({ heartbeat: heldOut(heartbeat(STALE)), state: heldOut(asserted) }),
  );
  assert.equal(view.verdict, "INACTIVE");
  assert.match(view.reasons.join("\n"), /heartbeat/);
  assert.match(view.reasons.join("\n"), new RegExp(`past the ${HEARTBEAT_LATE_MINUTES}-minute tolerance`));
  const beat = view.reading.conditions.find((c) => /heartbeat/.test(c.name));
  assert.ok(beat && beat.ok === false && beat.required === true);
});

test("SEEDED: a state asserting active whose OWN beat is stale derives INACTIVE naming the state age", () => {
  const view = buildResearchView(
    healthyInput({ state: heldOut(state({ active: true, verdict: "ACTIVE", beatAt: STALE })) }),
  );
  assert.equal(view.verdict, "INACTIVE");
  assert.match(view.reasons.join("\n"), /research state is \d+ minute\(s\) old/);
});

test("the view module never reads a stored flag off the state — checked in source, with a positive control", () => {
  const source = readFileSync(join(ROOT, "lib", "control-plane", "research-view.ts"), "utf8");
  assert.ok(source.length > 1000, "the source read collapsed");
  const readsAFlag = /\b(?:state|input\.state|row|value)\??\.(?:active|verdict|alive)\b/;
  assert.equal(readsAFlag.test("const x = state?.active;"), true, "positive control: the detector fires");
  assert.equal(readsAFlag.test("if (state.verdict === 'ACTIVE')"), true, "positive control: the detector fires");
  assert.equal(readsAFlag.test(source), false, "research-view.ts reads a stored flag off the state");
});

/* ================================================================== *
 * SEEDED FAILURE 4 — a historical success is not a live lane
 * ================================================================== */

test("SEEDED: a successful ScoutResult beside a dead runner derives INACTIVE, and the result is still shown", () => {
  const view = buildResearchView(
    healthyInput({
      heartbeat: notRecorded(),
      results: heldOut({ total: 1, latest: [scoutResult({ outcome: "EVIDENCE_FOUND" })] }),
    }),
  );
  assert.equal(view.verdict, "INACTIVE");
  assert.match(view.reasons.join("\n"), /no runner heartbeat is recorded/);
  assert.equal(view.runner.state, "NEVER_BEAT");
  // Show everything we find: the historical result renders regardless.
  assert.ok(view.results.held);
  if (view.results.held) {
    assert.equal(view.results.value.rows.length, 1);
    assert.equal(view.results.value.rows[0].outcome, "EVIDENCE_FOUND");
    assert.equal(view.results.value.rows[0].attemptId, "att-1");
    assert.equal(view.results.value.rows[0].workItemId, "wi-1");
  }
});

test("SEEDED: an UNREADABLE intent log can never derive ACTIVE — the store is named", () => {
  const view = buildResearchView(healthyInput({ intents: unreachableOut() }));
  // The raw derivation, fed an empty log, would have said ACTIVE. The view refuses that.
  assert.equal(view.reading.verdict, "ACTIVE");
  assert.equal(view.verdict, "INACTIVE");
  assert.match(view.reasons.join("\n"), /control plane could not answer a required input/);
  assert.match(view.reasons.join("\n"), /research intents: Reading it failed/);
  assert.ok(!view.intents.held);
});

test("a paused lane shows RESUME; a pause then a resume shows PAUSE; the state's own pause flag counts too", () => {
  const pause = buildResearchIntent("PAUSE", "2026-09-01T10:00:00.000Z", "adm_a");
  const resume = buildResearchIntent("RESUME", "2026-09-01T11:00:00.000Z", "adm_a");
  const honored: ResearchIntent = {
    formatVersion: RESEARCH_FORMAT_VERSION,
    kind: "HONORED",
    intentId: `honored:${pause.intentId}`,
    honors: pause.intentId,
    action: "PAUSE",
    honoredAt: "2026-09-01T10:05:00.000Z",
    honoredBy: "pilot-runner",
    detail: "model lane paused",
  };

  const paused = buildResearchView(healthyInput({ intents: heldOut([pause, honored]) }));
  assert.equal(paused.verdict, "INACTIVE");
  assert.match(paused.reasons.join("\n"), new RegExp(`paused by owner intent ${pause.intentId}`));
  assert.equal(paused.pauseAction, "RESUME");
  assert.ok(paused.intents.held);
  if (paused.intents.held) {
    assert.equal(paused.intents.value.rows.length, 1);
    assert.equal(paused.intents.value.rows[0].status, "HONORED");
    assert.equal(paused.intents.value.rows[0].honoredBy, "pilot-runner");
    assert.equal(paused.intents.value.rows[0].actor, "owner (admin session)");
  }

  const resumed = buildResearchView(healthyInput({ intents: heldOut([pause, honored, resume]) }));
  assert.equal(resumed.verdict, "ACTIVE");
  assert.equal(resumed.pauseAction, "PAUSE");
  if (resumed.intents.held) {
    assert.deepEqual(
      resumed.intents.value.rows.map((r) => [r.action, r.status]),
      [["RESUME", "PENDING"], ["PAUSE", "HONORED"]],
      "newest first, each with honored or pending",
    );
  }

  const stateSaysPaused = buildResearchView(
    healthyInput({ state: heldOut(state({ pausedByOwner: true, pauseIntentId: "PAUSE:x" })) }),
  );
  assert.equal(stateSaysPaused.pauseAction, "RESUME");
  assert.equal(stateSaysPaused.verdict, "INACTIVE");
});

/* ================================================================== *
 * SEEDED FAILURE 5 — every number carries a denominator and a contract
 * ================================================================== */

test("SEEDED: every number the page emits carries a denominator and a contract, and stated N equals rendered rows", () => {
  const view = buildResearchView(healthyInput());
  const numbers = renderedNumbersOf(view);
  assert.ok(numbers.length >= 18, `only ${numbers.length} number(s) collected — the collector lost a panel`);
  const audit = auditRenderedNumbers(numbers);
  assert.equal(audit.ok, true, audit.detail);
  assert.equal(audit.checked, numbers.length);
  for (const n of numbers) assert.ok(n.contract && n.contract.trim().length > 20, `${n.label} has a thin contract`);

  const claims = countClaimsOf(view);
  assert.ok(claims.length >= 3);
  assert.equal(checkStatedEqualsRendered(claims).ok, true);

  // Positive control: the audit refuses a bare number.
  assert.equal(auditRenderedNumbers([{ label: "x", value: 1, denominator: null, contract: "c" }]).ok, false);
});

test("spend at or over the ceiling renders as a number over its ceiling; the lane stays ACTIVE and says it is cap-deferred", () => {
  // The cap controls how much work RUNS; it never changes whether the lane is
  // live. Deferred work is owed with its next-due, and the page must say so
  // even though there is no failing condition to list.
  const view = buildResearchView(
    healthyInput({ spend: heldOut({ windowUsd: 26.5, measured: 9, unmeasured: 0, windowHours: 24, asOf: NOW }) }),
  );
  assert.equal(view.verdict, "ACTIVE");
  assert.equal(view.reading.capDeferred, true);
  assert.ok(view.spend.capDeferredNote, "a cap-deferred lane names it beside the spend");
  assert.match(view.spend.capDeferredNote ?? "", /ceiling is reached/);
  assert.match(view.spend.capDeferredNote ?? "", /deferred with its next-due, never dropped/);
  // Positive control: under the cap there is nothing to say.
  assert.equal(buildResearchView(healthyInput()).spend.capDeferredNote, null);
  assert.ok(view.spend.windowUsd.held, "an over-ceiling spend is a fact, not a gap");
  if (view.spend.windowUsd.held) {
    assert.equal(view.spend.windowUsd.value.value, 26.5);
    assert.equal(view.spend.windowUsd.value.denominator, RESEARCH_BOUNDS.dailyCeilingUsd);
  }
  assert.equal(auditRenderedNumbers(renderedNumbersOf(view)).ok, true);
});

test("an unmeasured window is a named gap, never zero; a count the denominator cannot hold is withheld and named", () => {
  const view = buildResearchView(
    healthyInput({
      spend: heldOut({ windowUsd: null, measured: 0, unmeasured: 2, windowHours: 24, asOf: NOW }),
      state: heldOut(state({ queue: { ...state().queue, modelClassDue: 50, modelClassUnits: 12 } })),
    }),
  );
  assert.equal(view.spend.windowUsd.held, false);
  if (!view.spend.windowUsd.held) assert.match(view.spend.windowUsd.gap.says, /UNMEASURED/);
  assert.equal(view.verdict, "DEGRADED");
  assert.ok(view.queue.held);
  if (view.queue.held) {
    assert.equal(view.queue.value.due.held, false, "50 due of 12 units is withheld");
    if (!view.queue.value.due.held) assert.match(view.queue.value.due.gap.says, /cannot both be true/);
  }
  assert.equal(auditRenderedNumbers(renderedNumbersOf(view)).ok, true);
});

test("no state recorded: every state-derived panel is OUR named gap and the verdict is INACTIVE", () => {
  const view = buildResearchView(healthyInput({ state: notRecorded(), results: heldOut({ total: 0, latest: [] }), evidence: heldOut({ distinctArtifacts: 0, citations: 0, attempts: 0, attemptsWithEvidence: 0 }) }));
  assert.equal(view.verdict, "INACTIVE");
  assert.match(view.reasons.join("\n"), /never reported/);
  for (const panel of [view.cycle, view.workerCredential, view.concurrency, view.queue, view.running, view.methodCandidates]) {
    assert.equal(panel.held, false);
    if (!panel.held) assert.equal(panel.gap.whose, "OURS");
  }
  assert.equal(view.evidence.held, false);
  assert.equal(view.boundsSource, "RESEARCH_BOUNDS (no state recorded)");
  assert.equal(auditRenderedNumbers(renderedNumbersOf(view)).ok, true);
});

/* ================================================================== *
 * SEEDED FAILURE 6 — the credential never travels
 * ================================================================== */

test("SEEDED: the view carries the worker credential's NAME and configured flag, and nothing else from that record", () => {
  const sentinel = "sk-live-SENTINEL-NEVER-RENDERED";
  const leaky = state({
    workerCredential: {
      name: WORKER_CREDENTIAL_VAR,
      configured: true,
      provider: "model-provider",
      context: "standing runner",
      value: sentinel,
      apiKey: sentinel,
    },
  });
  const view = buildResearchView(healthyInput({ state: heldOut(leaky) }));
  assert.ok(view.workerCredential.held);
  if (view.workerCredential.held) {
    assert.deepEqual(Object.keys(view.workerCredential.value).sort(), ["configured", "context", "name", "provider"]);
    assert.equal(view.workerCredential.value.name, WORKER_CREDENTIAL_VAR);
    assert.equal(view.workerCredential.value.configured, true);
  }
  assert.doesNotMatch(JSON.stringify(view), /SENTINEL/);
  // Positive control: the sentinel IS in the input, so its absence from the view is a finding.
  assert.match(JSON.stringify(leaky), /SENTINEL/);
});

test("the page reads no environment and posts both intents to the research route", () => {
  const source = readFileSync(join(ROOT, "app", "(admin)", "admin", "research", "page.tsx"), "utf8");
  assert.ok(source.length > 1000, "the page source read collapsed");
  assert.doesNotMatch(source, /process\.env/);
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const revalidate = 0/);
  assert.match(source, /auditRenderedNumbers\(/);
  assert.match(source, /checkStatedEqualsRendered\(/);
  assert.match(source, /name="action"/);
  assert.match(source, /value="RUN_CYCLE_NOW"/);
  assert.match(source, /value=\{view\.pauseAction\}/);
  assert.match(source, /"\/api\/admin\/research"/);
  assert.match(source, /Research — Level 1/);
  // The control centre links here.
  const centre = readFileSync(join(ROOT, "app", "(admin)", "admin", "page.tsx"), "utf8");
  assert.match(centre, /href="\/admin\/research"/);
});

/* ================================================================== *
 * THE READS, AGAINST THE IN-MEMORY DOUBLE
 * ================================================================== */

test("readScoutResults lists newest first, capped, and reports the total; evidence is the union of artifact ids", async () => {
  const repos = createMemoryRepositories();
  const total = SCOUT_RESULTS_SHOWN + 5;
  for (let i = 0; i < total; i += 1) {
    const recordedAt = `2026-09-01T${String(i).padStart(2, "0")}:00:00.000Z`;
    const r = scoutResult({
      attemptId: `att-${i}`,
      obligationId: `obl-${i % 3}`,
      artifactIds: ["art-shared", `art-${i}`],
      recordedAt,
    });
    await repos.scoutResults.append(r.obligationId, r.attemptId, r, recordedAt);
  }
  const read = await readScoutResults(repos);
  assert.equal(read.kind, "HELD");
  if (read.kind === "HELD") {
    assert.equal(read.value.total, total);
    assert.equal(read.value.latest.length, SCOUT_RESULTS_SHOWN);
    assert.equal(read.value.latest[0].attemptId, `att-${total - 1}`, "newest first");
    assert.equal(read.value.latest.at(-1)?.attemptId, `att-${total - SCOUT_RESULTS_SHOWN}`);
  }
  const evidence = await readScoutEvidenceCount(repos);
  assert.equal(evidence.kind, "HELD");
  if (evidence.kind === "HELD") {
    assert.deepEqual(evidence.value, {
      distinctArtifacts: total + 1,
      citations: total * 2,
      attempts: total,
      attemptsWithEvidence: total,
    });
  }

  const view = buildResearchView(healthyInput({ results: read, evidence }));
  assert.ok(view.results.held && view.evidence.held);
  if (view.results.held) {
    assert.equal(view.results.value.shown.value, SCOUT_RESULTS_SHOWN);
    assert.equal(view.results.value.shown.denominator, total);
  }
  if (view.evidence.held) {
    assert.equal(view.evidence.value.distinctArtifacts.value, total + 1);
    assert.equal(view.evidence.value.distinctArtifacts.denominator, total * 2);
  }
  assert.equal(checkStatedEqualsRendered(countClaimsOf(view)).ok, true);
});

test("readScoutSpend sums MEASURED Scout usd in the window only, and counts the unmeasured beside it", async () => {
  const repos = createMemoryRepositories();
  const entries: CostEntry[] = [
    costEntry({ attemptId: "in-window-measured" }),
    costEntry({
      attemptId: "in-window-unmeasured",
      cost: { inputTokens: null, outputTokens: null, usd: null, durationMs: null, bytesFetched: null, requestCount: null },
    }),
    costEntry({ attemptId: "outside-window", recordedAt: "2026-08-30T00:00:00.000Z", cost: { ...costEntry({ attemptId: "x" }).cost, usd: 9 } }),
    costEntry({ attemptId: "not-a-scout", role: "ACQUIRER", cost: { ...costEntry({ attemptId: "x" }).cost, usd: 3 } }),
  ];
  for (const e of entries) await repos.costs.append(e.workItemId, e.attemptId, e, e.recordedAt);
  const spend = await readScoutSpend(repos, NOW);
  assert.equal(spend.kind, "HELD");
  if (spend.kind === "HELD") {
    assert.equal(spend.value.windowUsd, 0.5);
    assert.equal(spend.value.measured, 1);
    assert.equal(spend.value.unmeasured, 1);
    assert.equal(spend.value.windowHours, RESEARCH_BOUNDS.windowHours);
  }
  const view = buildResearchView(healthyInput({ spend }));
  assert.equal(view.verdict, "DEGRADED", "one unmeasured Attempt is a named soft condition");
  assert.match(view.reasons.join("\n"), /1 Scout Attempt\(s\) in the window reported no usd/);
  if (view.spend.measuredAttempts.held) assert.equal(view.spend.measuredAttempts.value.denominator, 2);
});

test("readResearchState and readResearchIntents: NOT_RECORDED / HELD, never an empty stand-in for a failed read", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await readResearchState(repos)).kind, "NOT_RECORDED");
  await repos.researchState.put(RESEARCH_STATE_ID, state(), NOW);
  const held = await readResearchState(repos);
  assert.equal(held.kind, "HELD");

  const empty = await readResearchIntents(repos);
  assert.deepEqual(empty, { kind: "HELD", value: [] });
  const intent = buildResearchIntent("RUN_CYCLE_NOW", NOW, "adm_x");
  await appendResearchIntent(repos, intent, NOW);
  const one = await readResearchIntents(repos);
  assert.equal(one.kind, "HELD");
  if (one.kind === "HELD") assert.deepEqual(one.value, [intent]);

  const view = buildResearchView(healthyInput({ state: held, intents: one }));
  assert.equal(view.verdict, "ACTIVE", "a pending RUN_CYCLE_NOW does not pause anything");
  assert.ok(view.intents.held);
  if (view.intents.held) {
    assert.equal(view.intents.value.rows[0].status, "PENDING");
    assert.equal(view.intents.value.shown.denominator, 1);
    assert.ok(view.intents.value.shown.value <= INTENTS_SHOWN);
  }

  // A throwing store is STORE_UNREACHABLE, by name — not HELD [] and not NOT_RECORDED.
  const broken = {
    ...repos,
    researchIntents: { ...repos.researchIntents, read: async () => { throw new Error("boom"); } },
    researchState: { ...repos.researchState, read: async () => { throw new Error("boom"); } },
  };
  assert.equal((await readResearchIntents(broken)).kind, "STORE_UNREACHABLE");
  assert.equal((await readResearchState(broken)).kind, "STORE_UNREACHABLE");
});
