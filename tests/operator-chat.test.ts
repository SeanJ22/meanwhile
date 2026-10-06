import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { CHAT_PAGE } from "@/lib/control-plane/operator-chat/surface.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";
import {
  AUTHORITY_CLASSES,
  REFUSAL_WORDS,
  authorityPermits,
  type ActionDefinition,
  type ActionOutcome,
  type ActionRequest,
} from "@/lib/control-plane/gateway/contract.ts";
import { ZERO_COST, type Attempt } from "@/lib/control-plane/attempt.ts";
import { createRouteTask } from "@/lib/control-plane/route-task.ts";
import { createWorkItem, type WorkItem } from "@/lib/control-plane/work-item.ts";
import { held, measured, type Held, type OwnerDecisionIntent, type OwnerSnapshot, type RunnerHeartbeat } from "@/lib/control-plane/owner-surface.ts";
import type { FleetSafetySnapshot } from "@/lib/control-plane/fleet-safety.ts";
import { FLEET_SAFETY_BOUNDS } from "@/lib/control-plane/fleet-safety.ts";
import type { ResearchIntent, ResearchState } from "@/lib/control-plane/scheduler/research-policy.ts";

import {
  CHAT_CALLER,
  CHAT_TOPICS,
  TOPIC_DEFINITIONS,
  everyQuestion,
  topicDefinition,
  type ChatTopic,
} from "@/lib/control-plane/operator-chat/contract.ts";
import {
  actionMatch,
  actionVocabulary,
  classify,
  normalizeQuestion,
  prohibitionOf,
  subjectOf,
  topicOf,
  topicRulesAreComplete,
} from "@/lib/control-plane/operator-chat/router.ts";
import { holding, requiredReads, type EnvironmentIdentities, type OperatorContext } from "@/lib/control-plane/operator-chat/context.ts";
import { NO_PULL_REQUEST_RECORD, answerFor } from "@/lib/control-plane/operator-chat/read-models.ts";
import { chatActionRequest, proposeAction, type GatewayBinding } from "@/lib/control-plane/operator-chat/actions.ts";
import { STORE_WOULD_NOT_OPEN } from "@/lib/control-plane/operator-chat/read-context.ts";
import { readsFor, respondToOperator } from "@/lib/control-plane/operator-chat/turn.ts";
import { everyControl, operatorChatGateway } from "@/lib/control-plane/operator-chat/gateway-binding.ts";
import { actionDefinitions } from "@/lib/control-plane/gateway/registry.ts";
import { POST } from "@/app/api/admin/chat/route.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

/**
 * **ADM-C7 — the contextual operator chat, proven without a model.**
 * (2026-09-06, the Operator Control Room brief.)
 *
 * The brief's load-bearing rule for this surface is a prohibition: *do not
 * invoke a model merely to answer an exact database/status question when a
 * typed deterministic query exists.* Everything below is what obeying it buys —
 * a classifier and a query set that are pure functions, so the console's
 * answers can be asserted exactly rather than sampled.
 *
 * The four acceptance clauses are proven by name:
 *
 *   1  a deterministic status question              — "the seven questions"
 *   2  a contextual cross-domain explanation        — "blocking the Fleet"
 *   3  one permitted typed action through chat      — "propose, confirm, submit"
 *   4  the SAME receipt semantics as the UI control — "the receipt is the
 *      gateway's" plus the source-text guard that no receipt is built here
 *
 * And the five refusals the brief names are each proven to refuse: arbitrary
 * shell, arbitrary SQL, bypassing action authority, merging or deploying by
 * prose, and activating promotion by prose.
 */

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-09-06T18:00:00.000Z";

/* ========================================================================== */
/* FIXTURES — one world, built once, read by every query                      */
/* ========================================================================== */

function attempt(overrides: Partial<Attempt> & Pick<Attempt, "id" | "workItemId" | "startedAt">): Attempt {
  return {
    routeTaskId: "rt-0000000000000000000000",
    leaseId: "ls-0000000000000000000000",
    worker: { role: "ACQUIRER", provider: "deterministic", version: "1", instance: "test" },
    endedAt: null,
    outcome: null,
    abortReason: null,
    artifactIds: [],
    cost: ZERO_COST,
    methodVersion: 1,
    policyVersion: "test",
    ...overrides,
  };
}

const ITEM_OPEN: WorkItem = createWorkItem({
  project: "freshness",
  subject: "state:az",
  obligation: "refresh the Pima meeting calendar",
  why: "the reader is shown a calendar",
  now: "2026-09-01T00:00:00.000Z",
});
const ITEM_BLOCKED: WorkItem = {
  ...createWorkItem({
    project: "freshness",
    subject: "state:nj",
    obligation: "acquire the county clerk filings",
    why: "the ballot needs them",
    now: "2026-09-01T00:00:00.000Z",
  }),
  state: "BLOCKED",
};
const ITEM_OWNER: WorkItem = {
  ...createWorkItem({
    project: "freshness",
    subject: "state:il",
    obligation: "decide whether to open the meeting-times class",
    why: "no machine may decide it",
    now: "2026-09-01T00:00:00.000Z",
  }),
  state: "AWAITING_OWNER",
};

const SAFETY: FleetSafetySnapshot = {
  formatVersion: 1,
  status: "ACTIVE",
  bounds: FLEET_SAFETY_BOUNDS,
  cycle: {
    startedAt: "2026-09-06T17:30:00.000Z",
    modelUsd: 0.44,
    requests: 3,
    payloadBytes: 1024,
    dispatches: 2,
    elapsedMs: 60_000,
  },
  operationalNight: { active: false, start: "2026-09-06T01:00:00.000Z", end: "2026-09-06T13:00:00.000Z", startsOnSaturday: false, modelUsd: 0.44 },
  rolling24Hours: { modelUsd: 0.44, asOf: NOW },
  stoppedBecause: ["CYCLE_DEFERRED: the cycle's dispatch budget was spent before this route"],
  deferred: [{ work: "wi-abc", code: "REFUSED_BY_HOST", why: "the host answered 403" }],
  providerCircuits: [],
  lastSuccessfulActivity: "2026-09-06T17:45:00.000Z",
};

const HEARTBEAT: RunnerHeartbeat = {
  formatVersion: 1,
  beatAt: "2026-09-06T17:50:00.000Z",
  lastCycleStartedAt: "2026-09-06T17:30:00.000Z",
  lastCycleFinishedAt: "2026-09-06T17:49:00.000Z",
  nextCycleDueAt: "2026-09-06T18:30:00.000Z",
  lastCycleOk: true,
  testedSha: "c".repeat(40),
  host: "test-runner",
  codeIdentity: {
    formatVersion: 1,
    readAt: "2026-09-06T17:50:00.000Z",
    rawMainSha: "a".repeat(40),
    rawMainRef: "origin/main",
    rawMainFetched: true,
    effectiveExecutableSha: "b".repeat(40),
    nonShippingAbove: [],
    executable: null,
    runnerTestedSha: "c".repeat(40),
    verdict: "RUNNER_BEHIND_EXECUTABLE",
    detail: "The runner tested a commit below the newest executable change on the integration branch.",
    walkBound: 64,
    walkExhausted: false,
  },
};

function ownerCard(rowId: string, kind: "DECISION" | "ACKNOWLEDGE" | "BLOCKED_WHILE") {
  return {
    rowId,
    title: `Row ${rowId}`,
    whatIsNeeded: "pick one of the two",
    whyNoMachineCanDecide: "it is a judgement about scope",
    options: [{ option: "Yes", consequence: "it opens" }],
    blockedDescendants: null,
    openedOn: "2026-08-20T00:00:00.000Z",
    ageDays: 17,
    priority: "P1",
    verifiability: "NOT_MACHINE_VERIFIABLE" as const,
    kind,
  };
}

const NOTHING: Held<never> = { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } };

const SNAPSHOT: OwnerSnapshot = {
  formatVersion: 1,
  publishedAt: "2026-09-06T17:51:00.000Z",
  publishedFromSha: "c".repeat(40),
  publisher: "pilot-runner",
  pilotGreen: false,
  contracts: [],
  decisionCards: [ownerCard("R-1", "DECISION"), ownerCard("R-2", "DECISION"), ownerCard("R-3", "ACKNOWLEDGE")],
  obligationsByState: [{ state: "AZ", count: measured(4, 12, "obligations owed in Arizona", "the registry") }],
  obligationsByProvider: [{ provider: "legistar-insite", count: measured(3, 9, "obligations owed to this provider", "the registry") }],
  freshnessDebtRows: held(measured(7, 40, "refresh obligations past their due time", "every registered refresh obligation")),
  incidents: [{ cause: "REFUSED_BY_HOST", target: "pima.legistar.com", obligationsAffected: 3, oldestHours: 577 }],
  costByRole: [],
  costByModel: [],
  cacheHitRateByCaller: [],
  deterministicShare: NOTHING,
  costPerVerifiedRecord: NOTHING,
  zipRows: NOTHING,
  intakeFolder: NOTHING,
  intakeItemsFound: NOTHING,
  intakeItemsProcessed: NOTHING,
  intakeUnidentifiable: NOTHING,
};

const ENVIRONMENTS: EnvironmentIdentities = {
  production: {
    name: "production",
    sha: "d".repeat(40),
    deployId: "1".repeat(24),
    branch: "main",
    context: "production",
    observedAt: NOW,
    source: "the build identity production reports about itself",
    detail: null,
    reviewState: null,
    reviewStatus: null,
  },
  staging: {
    name: "staging",
    sha: "e".repeat(40),
    deployId: null,
    branch: "test",
    context: "branch-deploy",
    observedAt: NOW,
    source: "the release manifest staging publishes about its own build",
    detail: null,
    reviewState: "AWAITING_OWNER_CHOICE",
    reviewStatus: "READY_FOR_REVIEW",
  },
};

function fullContext(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    nowIso: NOW,
    from: "/admin/chat",
    stateVersion: SNAPSHOT.publishedAt,
    snapshot: { kind: "HELD", value: SNAPSHOT },
    heartbeat: { kind: "HELD", value: HEARTBEAT },
    digests: { kind: "HELD", value: [{ formatVersion: 1, digestId: "d1", writtenAt: "2026-09-06T17:49:30.000Z", headline: "One cycle, CYCLE_DEFERRED once.", lines: ["raw line"], cycleOk: true, testedSha: "c".repeat(40) }] },
    decisions: { kind: "HELD", value: [] },
    intents: { kind: "HELD", value: [] as readonly ResearchIntent[] },
    fleet: {
      kind: "HELD",
      value: {
        workItems: [ITEM_OPEN, ITEM_BLOCKED, ITEM_OWNER],
        routeTasks: [createRouteTask({ workItemId: ITEM_OPEN.id, routeId: "r1", routeLabel: "Legistar /EventDates", target: "pima.legistar.com", inherited: true, now: "2026-09-01T00:00:00.000Z" })],
        attempts: [
          attempt({ id: "at-open", workItemId: ITEM_OPEN.id, startedAt: "2026-09-06T17:40:00.000Z" }),
          attempt({ id: "at-done", workItemId: ITEM_OPEN.id, startedAt: "2026-09-06T17:35:00.000Z", endedAt: "2026-09-06T17:36:00.000Z", outcome: "COMPLETED" }),
          attempt({
            id: "at-failed",
            workItemId: ITEM_BLOCKED.id,
            startedAt: "2026-09-06T17:38:00.000Z",
            endedAt: "2026-09-06T17:39:00.000Z",
            outcome: "ABORTED",
            abortReason: "REFUSED_BY_HOST: the host answered 403 to every route",
          }),
        ],
      },
    },
    research: { kind: "HELD", value: { fleetSafety: SAFETY } as unknown as ResearchState },
    environments: { kind: "HELD", value: ENVIRONMENTS },
    ...overrides,
  };
}



/* ========================================================================== */
/* THE ROUTER                                                                 */
/* ========================================================================== */

test("the eight questions (the brief's seven and BR-31's spend question) each route to their own topic, and the set is closed", () => {
  assert.ok(topicRulesAreComplete(), "every declared topic has a matching rule and no rule names an undeclared topic");
  assert.equal(TOPIC_DEFINITIONS.length, CHAT_TOPICS.length, "every topic carries a definition");

  // The denominator, stated: eight questions, each routed to its own topic.
  const routed = TOPIC_DEFINITIONS.map((t) => ({ asks: t.asks, got: topicOf(t.asks), want: t.topic }));
  const wrong = routed.filter((r) => r.got !== r.want);
  assert.deepEqual(wrong, [], "each canonical question must route to its own topic");
  assert.equal(new Set(routed.map((r) => r.got)).size, 8, "eight distinct topics");
});

test("the owner's own phrasings route, not only the canonical ones", () => {
  const cases: readonly [string, ChatTopic][] = [
    ["what is blocking the fleet right now?", "FLEET_BLOCKERS"],
    ["why has the fleet stopped?", "FLEET_BLOCKERS"],
    ["what changed since the last cycle", "SINCE_LAST_CYCLE"],
    ["which sources are overdue", "OVERDUE_SOURCES"],
    ["how much freshness debt is there", "OVERDUE_SOURCES"],
    ["show me the latest failed acquisition", "LATEST_FAILED_ACQUISITION"],
    ["what was the last failed attempt", "LATEST_FAILED_ACQUISITION"],
    ["what is waiting on me", "WAITING_ON_YOU"],
    ["what needs my decision", "WAITING_ON_YOU"],
    ["compare production, main, and staging", "COMPARE_ENVIRONMENTS"],
    ["which code is running where — production and staging", "COMPARE_ENVIRONMENTS"],
    ["why is this PR not integrated?", "INTEGRATION_STATUS"],
    ["why is pr 293 not merged?", "INTEGRATION_STATUS"],
    ["is this release safe?", "INTEGRATION_STATUS"],
  ];
  for (const [asked, want] of cases) {
    assert.equal(topicOf(asked), want, `"${asked}"`);
  }
});

test("the four prohibitions refuse an instruction and let the matching QUESTION through", () => {
  const refused: readonly [string, string][] = [
    ["run pnpm gates for me", "ARBITRARY_COMMAND"],
    ["execute this shell command", "ARBITRARY_COMMAND"],
    ["ssh -i key runner@host", "ARBITRARY_COMMAND"],
    ["select id from cp_attempts where outcome is null", "ARBITRARY_QUERY"],
    ["run this sql", "ARBITRARY_QUERY"],
    ["drop table cp_attempts", "ARBITRARY_QUERY"],
    ["merge pr 293", "SHIP_BY_PROSE"],
    ["deploy to production", "SHIP_BY_PROSE"],
    ["can you merge this?", "SHIP_BY_PROSE"],
    ["push it to main", "SHIP_BY_PROSE"],
  ];
  for (const [asked, code] of refused) {
    const hit = prohibitionOf(asked);
    assert.ok(hit !== null, `"${asked}" must be refused`);
    assert.equal(hit.code, code, `"${asked}"`);
  }

  // The questions that carry the same words and are legitimate status questions.
  const allowed = [
    "why is this PR not merged?",
    "why is pr 293 not integrated?",
    "is this release safe?",
    "what is the release review status",
    "which sources are blocked",
    "what is blocking the fleet",
    "when did production last deploy code that changed",
  ];
  for (const asked of allowed) {
    assert.equal(prohibitionOf(asked), null, `"${asked}" must not be refused`);
  }
});

test("a prohibition wins over every other route, so no phrasing reaches a capability by wording", () => {
  // Both halves matter: the topic words are present AND the instruction is present.
  const routed = classify("deploy to production and tell me what is blocking the fleet", []);
  assert.equal(routed.kind, "PROHIBITED");
  assert.equal(routed.kind === "PROHIBITED" ? routed.code : null, "SHIP_BY_PROSE");
});

test("the subject is extracted without reading a work-item id as a commit", () => {
  assert.deepEqual(subjectOf("retry wi-4f2a9c1b3d5e"), { kind: "WORK_ITEM", value: "wi-4f2a9c1b3d5e" });
  assert.deepEqual(subjectOf("look at rt-4f2a9c1b3d5e"), { kind: "ROUTE_TASK", value: "rt-4f2a9c1b3d5e" });
  assert.deepEqual(subjectOf("attempt at-4f2a9c1b3d5e failed"), { kind: "ATTEMPT", value: "at-4f2a9c1b3d5e" });
  assert.deepEqual(subjectOf("why is PR 293 not integrated"), { kind: "PULL_REQUEST", value: "293" });
  assert.deepEqual(subjectOf("why is #293 not integrated"), { kind: "PULL_REQUEST", value: "293" });
  assert.deepEqual(subjectOf("compare 5d73a490 with production"), { kind: "COMMIT", value: "5d73a490" });
  assert.equal(subjectOf("what is waiting on me"), null);
  assert.equal(normalizeQuestion("What IS  blocking, the Fleet?"), "what is blocking the fleet");
});

/* ========================================================================== */
/* ACTIONS COME FROM THE GATEWAY'S REGISTRY, NEVER FROM A LIST KEPT HERE      */
/* ========================================================================== */

function definition(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    type: "fleet.retry-work-item",
    label: "Retry this work item",
    does: "Puts one eligible work item back in the queue for the next cycle to pick up.",
    doesNot: "It does not run anything now, and it does not touch what a reader sees.",
    authority: "REVERSIBLE_NONPRODUCTION",
    subjectKind: "work item",
    requiresStateVersion: true,
    refusals: ["STALE_STATE", "ALREADY_DONE", "INVALID_INPUT"],
    ...overrides,
  };
}

const CODEX_REVIEW = definition({
  type: "agent.codex.review-pull-request",
  label: "Ask Codex to review a pull request",
  does: "Opens a bounded review job for one pull request and records what it asked for.",
  doesNot: "It does not merge anything and it cannot change code.",
  authority: "PROPOSE_ONLY",
  subjectKind: "pull request",
  requiresStateVersion: false,
  refusals: ["NOT_SUPPORTED_YET", "DOWNSTREAM_REFUSED"],
});

test("an action is matched from the gateway's own registry, so a registry change changes what chat offers", () => {
  const registry = [definition(), CODEX_REVIEW];

  assert.equal(actionMatch("retry this eligible work item wi-4f2a9c1b3d5e", registry)?.actionType, "fleet.retry-work-item");
  assert.equal(actionMatch("ask codex to review this exact PR 293", registry)?.actionType, "agent.codex.review-pull-request");

  // The same words against an EMPTY registry name nothing. There is no private list.
  assert.equal(actionMatch("retry this eligible work item", []), null);
  assert.equal(classify("retry this eligible work item wi-4f2a9c1b3d5e", []).kind, "NONE");

  // A vocabulary that shares one word is not a match.
  assert.equal(actionMatch("retry", registry), null);

  // Two definitions the words fit equally well: refuse rather than pick.
  const twin = [definition({ type: "fleet.retry-work-item" }), definition({ type: "queue.retry-work-item" })];
  assert.equal(actionMatch("retry this work item", twin), null, "a tie must not be resolved by guessing");
});

test("the vocabulary an action is known by comes from its own type and label", () => {
  const words = actionVocabulary(CODEX_REVIEW);
  for (const word of ["agent", "codex", "review", "pull", "request", "ask"]) {
    assert.ok(words.has(word), `expected the vocabulary to carry "${word}"`);
  }
});

/* ========================================================================== */
/* ACCEPTANCE 1 — A DETERMINISTIC STATUS QUESTION                             */
/* ========================================================================== */

test("acceptance 1: a status question is answered from the records, with a denominator, and without a model", () => {
  const answer = answerFor("OVERDUE_SOURCES", fullContext(), "which sources are overdue", null);
  assert.equal(answer.usedModel, false);
  assert.ok(answer.denominator.held, "the answer carries a number");
  assert.equal(answer.denominator.value.measured.value, 7);
  assert.equal(answer.denominator.value.measured.denominator, 40);
  assert.ok(answer.denominator.value.measured.contract.length > 20, "the number carries its interpretation");
  assert.ok(answer.denominator.value.measured.denominatorSource.length > 10, "the denominator says where it came from");
  assert.ok(answer.sources.length > 0, "the answer names what it read");
  assert.match(answer.sources[0].says, /snapshot/i);
  assert.match(answer.says.join(" "), /legistar insite/i, "the provider is named");
  // The incident cause reaches the face as words, never as the constant.
  const face = answer.says.join(" ");
  assert.match(face, /the source refused the request/i);
  assert.doesNotMatch(face, /REFUSED_BY_HOST/, "no machine constant leads");
  assert.match(face, /3 weeks/, "577 hours is rendered as an age a person reads");
  assert.doesNotMatch(face, /577/, "nobody reads 577 hours as three weeks");
});

test("every answer carries usedModel false, a needs-you line, and a source or a named gap", () => {
  const ctx = fullContext();
  for (const topic of CHAT_TOPICS) {
    const answer = answerFor(topic, ctx, topicDefinition(topic).asks.toLowerCase(), null);
    assert.equal(answer.usedModel, false, topic);
    assert.equal(typeof answer.needsYou.needed, "boolean", topic);
    assert.ok(answer.says.length > 0, `${topic} says something`);
    assert.ok(answer.sources.length > 0 || answer.gaps.length > 0, `${topic} names a source or a gap`);
    assert.equal(answer.understoodAs, topicDefinition(topic).asks, topic);
  }
});

/* ========================================================================== */
/* ACCEPTANCE 2 — A CONTEXTUAL CROSS-DOMAIN EXPLANATION                       */
/* ========================================================================== */

test("acceptance 2: 'what is blocking the Fleet' crosses four domains in one answer", () => {
  const answer = answerFor("FLEET_BLOCKERS", fullContext(), "what is blocking the fleet", null);
  const face = answer.says.join(" ");

  // The runner's standing (heartbeat + intents + safety).
  assert.match(face, /the runner is/i);
  // The safety record's stop reason, in words.
  assert.match(face, /budget/i);
  assert.doesNotMatch(face, /CYCLE_DEFERRED/, "the stop code does not lead");
  // The named deferral, in words.
  assert.match(face, /the source refused the request/i);
  // The work on record.
  assert.match(face, /held up/i);
  // The published snapshot's incidents.
  assert.match(face, /incident/i);

  assert.ok(answer.denominator.held);
  assert.equal(answer.denominator.value.measured.value, 2, "two of the three work items are held up");
  assert.equal(answer.denominator.value.measured.denominator, 3);

  // Four distinct records named.
  assert.ok(answer.sources.length >= 4, `expected four sources, saw ${answer.sources.length}`);
  assert.equal(answer.needsYou.needed, true, "a work item awaiting the owner needs him");
  assert.ok((answer.needsYou.action ?? "").length > 5, "and says what to do");

  // Fleet blockers name only active provider backoff while keeping eligible retry history available
  (() => {
  const circuits = [
    { provider: "eligible-provider", condition: "billing disabled", firstObservedAt: NOW,
      workDeferred: ["earlier-work"], eligibleAt: NOW, failureClass: "HARD" as const, consecutiveFailures: 2 },
    { provider: "waiting-provider", condition: "payment required", firstObservedAt: NOW,
      workDeferred: ["later-work"], eligibleAt: new Date(Date.parse(NOW) + 60_000).toISOString(), failureClass: "HARD" as const },
  ];
  const ctx = fullContext();
  const research = ctx.research;
  assert.equal(research?.kind, "HELD");
  if (!research || research.kind !== "HELD") throw new Error("fixture");
  const answer = answerFor("FLEET_BLOCKERS", fullContext({ research: { kind: "HELD", value: {
    ...research.value, fleetSafety: { ...SAFETY, providerCircuits: circuits },
  } } }), "what is blocking the fleet", null);
  const paragraph = answer.says.filter(line => line.includes("paused after refusing work")).join(" ");
  assert.match(paragraph, /1 provider is/);
  assert.match(paragraph, /waiting-provider/);
  assert.doesNotMatch(paragraph, /eligible-provider/);
  assert.match(answer.says.join(" "), /eligible to retry: eligible-provider after billing disabled/);
  assert.ok(answer.detail.some(line => line.includes("eligible-provider") && line.includes("billing disabled")));
})();
});

test("a reading that failed becomes a named gap, and never a zero", () => {
  const ctx = fullContext({ fleet: { kind: "STORE_UNREACHABLE", detail: "Reading the fleet failed (TypeError). We could not ask." } });
  const answer = answerFor("FLEET_BLOCKERS", ctx, "what is blocking the fleet", null);
  assert.equal(answer.denominator.held, false, "no number is stated when the population could not be read");
  assert.ok(answer.gaps.some((g) => g.whose === "UNKNOWABLE_NOW"), "the gap says the store could not be asked");
  assert.doesNotMatch(answer.says.join(" "), /\b0 of\b/, "nothing is reported as zero");
});

test("a reading this question never asked for is a named gap that says so, not an absence finding", () => {
  const partial: OperatorContext = { nowIso: NOW, from: "/admin/chat", stateVersion: null };
  const gap = holding(partial.snapshot, "the published control-centre snapshot");
  assert.equal(gap.held, false);
  assert.equal(gap.held === false ? gap.gap.whose : null, "OURS");
  assert.match(gap.held === false ? gap.gap.says : "", /did not read/);
});

test("an attempt that is still running is not counted as a failure", () => {
  const answer = answerFor("LATEST_FAILED_ACQUISITION", fullContext(), "show me the latest failed acquisition", null);
  assert.ok(answer.denominator.held);
  // Three attempts on record; only the ACQUIRER roles are in the population, and
  // exactly one of them ENDED without completing. The open one is not a failure.
  assert.equal(answer.denominator.value.measured.value, 1);
  assert.equal(answer.denominator.value.measured.denominator, 3);
  assert.match(answer.says.join(" "), /the source refused the request/i);
  assert.doesNotMatch(answer.says.join(" "), /REFUSED_BY_HOST/);
});

test("a decision already recorded leaves the waiting count at once", () => {
  const decided: OwnerDecisionIntent = {
    formatVersion: 1,
    intentId: "R-1:2026-09-06T17:00:00.000Z",
    subjectId: "R-1",
    chosenOption: "Yes",
    consequenceShown: "it opens",
    decidedAt: "2026-09-06T17:00:00.000Z",
    state: "PENDING_CANONICALIZATION",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: "adm_test",
  };
  const before = answerFor("WAITING_ON_YOU", fullContext(), "what is waiting on me", null);
  assert.ok(before.denominator.held);
  assert.equal(before.denominator.value.measured.value, 2, "two forks are waiting");
  assert.equal(before.needsYou.needed, true);

  const after = answerFor("WAITING_ON_YOU", fullContext({ decisions: { kind: "HELD", value: [decided] } }), "what is waiting on me", null);
  assert.ok(after.denominator.held);
  assert.equal(after.denominator.value.measured.value, 1, "the answered one has left");
  assert.equal(after.denominator.value.measured.denominator, 3, "the denominator is still every published card");
});

test("comparing the environments counts five identities and names each one it could not read", () => {
  const full = answerFor("COMPARE_ENVIRONMENTS", fullContext(), "compare production main and staging", null);
  assert.ok(full.denominator.held);
  assert.equal(full.denominator.value.measured.denominator, 5);
  assert.equal(full.denominator.value.measured.value, 5, "production, staging, main, the executable head and the runner");
  assert.match(full.says.join(" "), /production is running/i);
  assert.match(full.says.join(" "), /staging is running/i);

  const blind = answerFor(
    "COMPARE_ENVIRONMENTS",
    fullContext({ environments: { kind: "STORE_UNREACHABLE", detail: "Reading the environments failed. We could not ask." } }),
    "compare production main and staging",
    null,
  );
  assert.ok(blind.denominator.held);
  assert.equal(blind.denominator.value.measured.value, 3, "only the three from the heartbeat could be read");
  assert.ok(blind.gaps.length > 0);
});

test("the integration question never invents a pull request status, and names the missing seam", () => {
  const answer = answerFor("INTEGRATION_STATUS", fullContext(), "why is pr 293 not integrated", "293");
  assert.ok(
    answer.gaps.some((g) => g.says === NO_PULL_REQUEST_RECORD.says),
    "the answer always carries the named gap about pull requests",
  );
  assert.match(answer.says.join(" "), /holds no record of 293 as a pull request/i);
  assert.match(answer.says.join(" "), /staging is showing/i);
  assert.ok(answer.denominator.held);
  assert.equal(answer.denominator.value.measured.denominator, 3);
});

/* ========================================================================== */
/* ACCEPTANCE 3 & 4 — ONE PERMITTED TYPED ACTION, AND THE GATEWAY'S RECEIPT   */
/* ========================================================================== */

function receiptFor(request: ActionRequest, label: string): ActionOutcome {
  return {
    ok: true,
    replayed: false,
    receipt: {
      formatVersion: 1,
      receiptId: `${request.type}:${request.idempotencyKey}`,
      idempotencyKey: request.idempotencyKey,
      type: request.type,
      label,
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "work item",
      subject: request.subject,
      inputDigest: "digest",
      caller: request.caller,
      actorRef: request.actorRef,
      stateVersion: request.stateVersion,
      codeSha: null,
      startedAt: NOW,
      completedAt: NOW,
      outcome: "QUEUED",
      says: "The work item is back in the queue for the next cycle.",
      refusal: null,
      openedWork: [],
      readBackAt: "/admin",
      undo: null,
    },
  };
}

function binding(registry: readonly ActionDefinition[]): { gateway: GatewayBinding; submitted: ActionRequest[]; outcomes: ActionOutcome[] } {
  const submitted: ActionRequest[] = [];
  const outcomes: ActionOutcome[] = [];
  return {
    submitted,
    outcomes,
    gateway: {
      registry,
      submit: async (request) => {
        submitted.push(request);
        const named = registry.find((d) => d.type === request.type);
        const outcome = receiptFor(request, named === undefined ? request.type : named.label);
        outcomes.push(outcome);
        return { ok: true, outcome };
      },
    },
  };
}

test("acceptance 3: a permitted typed action is PROPOSED and nothing is submitted until it is confirmed", async () => {
  const bound = binding([definition()]);
  const ctx = fullContext();
  const asked = "retry this eligible work item wi-4f2a9c1b3d5e";

  const proposed = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, ctx, { text: asked, from: "/admin/chat" });
  assert.equal(proposed.kind, "PROPOSED");
  assert.deepEqual(bound.submitted, [], "a message alone submits nothing");
  if (proposed.kind !== "PROPOSED") return;

  const request = proposed.proposal.request;
  assert.equal(request.type, "fleet.retry-work-item");
  assert.equal(request.subject, "wi-4f2a9c1b3d5e");
  assert.equal(request.caller, CHAT_CALLER);
  assert.equal(request.actorRef, "adm_test");
  assert.equal(request.stateVersion, SNAPSHOT.publishedAt, "the proposal quotes the console's published instant");
  assert.equal(proposed.proposal.confirmToken, request.idempotencyKey);
  assert.equal(proposed.proposal.willDo, definition().does);
  assert.equal(proposed.proposal.willNotDo, definition().doesNot);

  // The request is exactly what the shared builder produces, so a UI control
  // calling the same builder with the same inputs submits the same action.
  assert.deepEqual(
    request,
    chatActionRequest({
      definition: definition(),
      subject: "wi-4f2a9c1b3d5e",
      words: asked,
      stateVersion: SNAPSHOT.publishedAt,
      actorRef: "adm_test",
      proposedAt: NOW,
    }),
  );

  const confirmed = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, ctx, {
    text: asked,
    from: "/admin/chat",
    confirm: { token: proposed.proposal.confirmToken, proposedAt: NOW },
  });
  assert.equal(confirmed.kind, "SUBMITTED");
  assert.equal(bound.submitted.length, 1, "exactly one submission");
  assert.deepEqual(bound.submitted[0], request, "the confirmed request is the proposed request, field for field");
});

test("acceptance 4: the receipt is the gateway's own object, returned unedited", async () => {
  const bound = binding([definition()]);
  const asked = "retry this eligible work item wi-4f2a9c1b3d5e";
  const turn = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: asked,
    from: "/admin/chat",
    confirm: { token: chatActionRequest({ definition: definition(), subject: "wi-4f2a9c1b3d5e", words: asked, stateVersion: SNAPSHOT.publishedAt, actorRef: "adm_test", proposedAt: NOW }).idempotencyKey, proposedAt: NOW },
  });
  assert.equal(turn.kind, "SUBMITTED");
  if (turn.kind !== "SUBMITTED") return;
  // Reference equality: the chat did not copy, reshape or re-word the receipt.
  assert.equal(turn.outcome, bound.outcomes[0], "the outcome the chat returns IS the gateway's outcome");
  assert.equal(turn.outcome.receipt, bound.outcomes[0].receipt);
});

test("confirming one proposal twice is one action; asking again later is a new one", async () => {
  const bound = binding([definition()]);
  const asked = "retry this eligible work item wi-4f2a9c1b3d5e";
  const key = (proposedAt: string) =>
    chatActionRequest({ definition: definition(), subject: "wi-4f2a9c1b3d5e", words: asked, stateVersion: SNAPSHOT.publishedAt, actorRef: "adm_test", proposedAt }).idempotencyKey;

  for (let i = 0; i < 2; i += 1) {
    await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
      text: asked,
      from: "/admin/chat",
      confirm: { token: key(NOW), proposedAt: NOW },
    });
  }
  assert.equal(bound.submitted[0].idempotencyKey, bound.submitted[1].idempotencyKey, "one proposal, one key, whatever the gateway then does about it");

  const later = "2026-09-06T19:00:00.000Z";
  await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: asked,
    from: "/admin/chat",
    confirm: { token: key(later), proposedAt: later },
  });
  assert.notEqual(bound.submitted[2].idempotencyKey, bound.submitted[0].idempotencyKey, "a later ask is a new action");
});

test("a confirmation whose token does not match what the console proposed submits nothing", async () => {
  const bound = binding([definition()]);
  const turn = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: "retry this eligible work item wi-4f2a9c1b3d5e",
    from: "/admin/chat",
    confirm: { token: "not-the-key-this-console-issued", proposedAt: NOW },
  });
  assert.equal(turn.kind, "REFUSED");
  assert.deepEqual(bound.submitted, [], "nothing reached the gateway");
});

/* ========================================================================== */
/* THE REFUSALS THE BRIEF NAMES                                               */
/* ========================================================================== */

test("chat may not bypass action authority: an owner-gated action is refused in the gateway's own words", async () => {
  const gated = definition({
    type: "owner.choose-raised-state",
    label: "Choose the raised state variant",
    authority: "OWNER_DECISION_REQUIRED",
    requiresStateVersion: false,
  });
  assert.equal(authorityPermits(CHAT_CALLER, "OWNER_DECISION_REQUIRED"), false, "the ladder is the authority, not this test");

  const bound = binding([gated]);
  const turn = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: "choose the raised state variant for wi-4f2a9c1b3d5e",
    from: "/admin/chat",
  });
  assert.equal(turn.kind, "REFUSED");
  assert.equal(turn.kind === "REFUSED" ? turn.says.includes(REFUSAL_WORDS.AUTHORITY_MISMATCH) : false, true, "the sentence is the gateway's");
  assert.deepEqual(bound.submitted, []);

  const outcome = proposeAction({
    definition: gated,
    subject: "wi-1",
    words: "choose the raised state variant",
    context: fullContext(),
    actorRef: "adm_test",
    proposedAt: NOW,
  });
  assert.equal(outcome.ok, false);

  /*
   * And the prose form of the same thing is no longer refused a step earlier:
   * promotion is automatic under rulings section 3, so "open a record class" is
   * not one of the things chat may never do.
   */
  const byProse = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: "open a record class for meeting times",
    from: "/admin/chat",
  });
  // Rulings section 3 (Sean, 2026-09-29): verified facts publish automatically, so chat has no promotion refusal to give.
  assert.notEqual(byProse.kind, "PROHIBITED");
});

test("a PROHIBITED action is refused, and every authority class is decided by the shared ladder", async () => {
  const forbidden = definition({ type: "runner.shell", label: "Run a shell command", authority: "PROHIBITED", requiresStateVersion: false });
  const bound = binding([forbidden]);
  const turn = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), {
    text: "shell command runner wi-4f2a9c1b3d5e",
    from: "/admin/chat",
  });
  assert.equal(turn.kind, "REFUSED");
  assert.deepEqual(bound.submitted, []);

  // Nothing here keeps its own opinion about who may do what.
  for (const authority of AUTHORITY_CLASSES) {
    const permitted = authorityPermits(CHAT_CALLER, authority);
    assert.equal(permitted, authority !== "OWNER_DECISION_REQUIRED" && authority !== "PROHIBITED", authority);
  }
});

test("arbitrary commands, queries and release requests never reach the gateway or read a record", async () => {
  const bound = binding([definition(), CODEX_REVIEW]);
  const messages: readonly [string, string][] = [
    ["run pnpm gates", "ARBITRARY_COMMAND"],
    ["delete from cp_attempts where id is null", "ARBITRARY_QUERY"],
    ["merge pr 293 now", "SHIP_BY_PROSE"],
  ];
  for (const [text, code] of messages) {
    assert.deepEqual(readsFor(text, bound.gateway.registry), [], `"${text}" opens no store`);
    const turn = await respondToOperator({ gateway: bound.gateway, actorRef: "adm_test" }, fullContext(), { text, from: "/admin/chat" });
    assert.equal(turn.kind, "PROHIBITED", `"${text}"`);
    assert.equal(turn.kind === "PROHIBITED" ? turn.code : null, code);
  }
  assert.deepEqual(bound.submitted, [], "nothing reached the gateway");
});

test("with no door supplied nothing is addressable, and the console offers no control of its own", async () => {
  assert.equal(operatorChatGateway(null), null, "no door, no binding");
  const turn = await respondToOperator({ gateway: null, actorRef: "adm_test" }, fullContext(), {
    text: "try this work again wi-4f2a9c1b3d5e",
    from: "/admin/chat",
  });
  assert.equal(turn.kind, "UNROUTED");
  assert.ok(turn.kind === "UNROUTED" && turn.canAnswer.length === everyQuestion().length);
});

test("the chat's controls ARE the gateway's registry, matched by the words the gateway itself uses", async () => {
  const door = async () => ({ ok: true as const, outcome: receiptFor(chatActionRequest({ definition: definition(), subject: "s", words: "w", stateVersion: null, actorRef: "a", proposedAt: NOW }), "x") });
  const bound = operatorChatGateway(door);
  assert.ok(bound !== null);
  assert.deepEqual([...bound.registry], [...actionDefinitions()], "the registry is the gateway's, not a list kept in the chat");
  assert.ok(bound.registry.length >= 5, `expected the gateway to declare several controls, saw ${bound.registry.length}`);

  /*
   * What the page OFFERS is the registry filtered by the gateway's own
   * authority ladder: a control the chat may never invoke is not something the
   * owner should be told he can ask for. The registry declares at least one of
   * each, so this is a real filter and not a no-op.
   */
  const offered = everyControl();
  const allowed = actionDefinitions().filter((d) => authorityPermits(CHAT_CALLER, d.authority));
  assert.deepEqual([...offered], allowed.map((d) => d.label));
  assert.ok(offered.length < actionDefinitions().length, "some declared controls are out of the chat's reach");

  /*
   * The registry as it stands, matched by ordinary words. These are the
   * gateway's OWN labels and types — nothing in the chat names an action — so
   * this is also the proof that a control added there becomes askable here.
   */
  const cases: readonly [string, string][] = [
    ["try this work again wi-4f2a9c1b3d5e", "fleet.retryWorkItem"],
    ["retry this eligible work item wi-4f2a9c1b3d5e", "fleet.retryWorkItem"],
    ["pause the runner", "runner.pause"],
    ["resume the runner", "runner.resume"],
    ["run a cycle now", "runner.runCycleNow"],
    ["deploy the fleet here", "fleet.deployHere"],
    ["read this back now", "fleet.requestReadback"],
    ["add this to the queue", "queue.add"],
  ];
  for (const [asked, want] of cases) {
    const routed = classify(asked, bound.registry);
    assert.equal(routed.kind, "ACTION", `"${asked}" should name a control`);
    assert.equal(routed.kind === "ACTION" ? routed.actionType : null, want, `"${asked}"`);
  }
});

test("'deploy the fleet' is a control and 'deploy to production' is not", () => {
  assert.equal(prohibitionOf("deploy the fleet here"), null, "sending workers to a place is a control, not shipping software");
  assert.equal(prohibitionOf("deploy fleet to arizona"), null);
  assert.equal(prohibitionOf("deploy to production")?.code, "SHIP_BY_PROSE");
  assert.equal(prohibitionOf("deploy the build")?.code, "SHIP_BY_PROSE");
});

test("the gateway's registry declares no way to delegate work to an agent, so the chat offers none", () => {
  /*
   * The brief asks for "Ask Codex to review this exact PR", "Have Claude
   * investigate this bounded defect" and "Ask both independently whether this
   * release is safe". The Agent Bridge exists (lib/control-plane/agents/) and
   * the gateway registry does not declare an action that opens a job on it.
   * The chat therefore cannot ask for one — and must not, because minting an
   * action name here would be the second privileged path §3.5 forbids. The
   * day the registry declares one, it becomes askable with no edit to the chat,
   * which is what the case above proves.
   */
  const agentish = actionDefinitions().filter((d) => /agent|codex|claude|delegate|investigate/i.test(`${d.type} ${d.label}`));
  assert.deepEqual(agentish, [], "if this fails the registry now declares agent work and the chat already reaches it");
  const routed = classify("ask codex to review this exact PR 293", actionDefinitions());
  assert.equal(routed.kind, "NONE", "nothing is invented to fill the gap");
});

test("a question the console does not answer says so and lists what it does answer", async () => {
  const turn = await respondToOperator({ gateway: null, actorRef: "adm_test" }, fullContext(), {
    text: "what is the weather in Tucson",
    from: "/admin/chat",
  });
  assert.equal(turn.kind, "UNROUTED");
  assert.ok(turn.kind === "UNROUTED" && turn.says.includes("does not guess"));
});

test("only the records a question needs are read", () => {
  assert.deepEqual([...requiredReads("OVERDUE_SOURCES")], ["snapshot"]);
  assert.ok(requiredReads("COMPARE_ENVIRONMENTS").includes("environments"));
  assert.ok(!requiredReads("WAITING_ON_YOU").includes("environments"), "answering the owner queue never reaches another origin");
  assert.deepEqual(readsFor("what is the weather in Tucson", []), []);
  // A proposal quotes the console's pulse revision — the same value the gateway
  // compares against — and needs nothing else.
  assert.deepEqual([...readsFor("try this work again wi-4f2a9c1b3d5e", actionDefinitions())], ["pulse"]);
});

/* ========================================================================== */
/* SOURCE-TEXT GUARDS — the two claims that must be true of the FILES         */
/* ========================================================================== */

const CHAT_LIB = join(ROOT, "lib", "control-plane", "operator-chat");
const CHAT_FILES = [
  ...readdirSync(CHAT_LIB).map((f) => join(CHAT_LIB, f)),
  join(ROOT, "app", "api", "admin", "chat", "route.ts"),
  join(ROOT, "app", "(admin)", "_mw", "admin-v6", "chat-view.tsx"),
];

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

test("the chat builds no receipt of its own — that is what makes the receipt semantics the gateway's", () => {
  assert.ok(CHAT_FILES.length >= 10, `expected the sweep to reach the chat's files, saw ${CHAT_FILES.length}`);
  const offenders: string[] = [];
  for (const file of CHAT_FILES) {
    const code = withoutComments(readFileSync(file, "utf8"));
    // A receipt is CONSTRUCTED by writing its two required identity fields.
    if (/receiptId\s*:/.test(code) || /\breceiptIdFor\s*\(/.test(code) || /formatVersion:\s*1\s*,[\s\S]{0,200}receiptId/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "the chat must never mint a receipt; the gateway writes every one");
});

test("the chat calls no model, names no credential, and reaches no provider", () => {
  const offenders: string[] = [];
  for (const file of CHAT_FILES) {
    const code = withoutComments(readFileSync(file, "utf8"));
    for (const shape of [/anthropic/i, /ModelTransport/, /WTP_WORKERS/, /api\.anthropic/, /messages\.create/, /openai/i]) {
      if (shape.test(code)) offenders.push(`${file} :: ${shape}`);
    }
  }
  assert.deepEqual(offenders, [], "a deterministic console must not carry a provider call");
});

test("the chat runs no command and builds no SQL", () => {
  const offenders: string[] = [];
  for (const file of CHAT_FILES) {
    const code = withoutComments(readFileSync(file, "utf8"));
    for (const shape of [/child_process/, /execFileSync|execSync|spawnSync/, /\bsql`/, /\bpool\.query\b/, /createPgRepositories/]) {
      if (shape.test(code)) offenders.push(`${file} :: ${shape}`);
    }
  }
  assert.deepEqual(offenders, [], "the chat reads through the console's seam and runs nothing");
});

test("no environment variable's name can reach the browser through the chat", () => {
  const offenders: string[] = [];
  for (const file of CHAT_FILES) {
    const code = withoutComments(readFileSync(file, "utf8"));
    if (/WTP_[A-Z_]+/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "a variable's name belongs in a server log, never in a body a browser reads");

  /*
   * And the one sentence that would have carried one: `openControlPlane`'s own
   * detail names the variable by design, so the chat answers with a sentence of
   * its own instead of forwarding it.
   */
  assert.doesNotMatch(STORE_WOULD_NOT_OPEN, /WTP_|DATABASE_URL/);
  assert.ok(STORE_WOULD_NOT_OPEN.length > 60, "and it still says what happened");
});

test("a confirmed action goes through the console's one door, not a second caller of it", () => {
  const route = readFileSync(join(ROOT, "app", "api", "admin", "chat", "route.ts"), "utf8");
  assert.match(route, /from "@\/app\/api\/admin\/action\/route\.ts"/, "the chat forwards to the action route itself");
  assert.doesNotMatch(
    withoutComments(route),
    /from "@\/lib\/control-plane\/gateway\/gateway\.ts"/,
    "the chat does not call submit() beside that route with its own copy of the wiring",
  );
  // And it declares the lower authority rather than riding the owner's session.
  assert.match(route, /caller: action\.caller/);
});

test("the route refuses the public host, a foreign origin and a missing session before it reads anything", () => {
  const route = readFileSync(join(ROOT, "app", "api", "admin", "chat", "route.ts"), "utf8");
  const host = route.indexOf("isAdminHostRequest");
  const origin = route.indexOf("originAllowed");
  const session = route.indexOf("verifySession");
  const read = route.indexOf("readOperatorContext");
  assert.ok(host > 0 && origin > host && session > origin && read > session, "host → origin → session → read, in that order");
});

/* ========================================================================== */
/* THE ROUTE                                                                  */
/* ========================================================================== */

function request(host: string, init: { headers?: Record<string, string>; body?: string } = {}): NextRequest {
  return new NextRequest(`https://${host}/api/admin/chat`, {
    method: "POST",
    headers: { host, "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body ?? JSON.stringify({ text: "what is waiting on me" }),
  });
}

test("both new paths are inside the admin boundary: invisible publicly, signed in privately", async () => {
  for (const path of [CHAT_PAGE, "/api/admin/chat"]) {
    const publicly = await middleware(new NextRequest(`https://${PUBLIC_HOST}${path}`, { headers: { host: PUBLIC_HOST } }));
    assert.equal(publicly.status, 404, `${path} on the public host`);
  }
  const page = await middleware(new NextRequest(`https://${ADMIN_HOST}${CHAT_PAGE}`, { headers: { host: ADMIN_HOST } }));
  assert.equal(page.status, 307, "an unauthenticated page request redirects to the login");
  assert.match(page.headers.get("location") ?? "", /\/admin\/login/);
});

test("the chat route is invisible on the public host and refuses a foreign origin and a missing session", async () => {
  await withAdminSessionKey(async () => {
    assert.equal((await POST(request(PUBLIC_HOST, { headers: { origin: ADMIN_ORIGIN, cookie: await adminSessionCookie() } }))).status, 404);
    assert.equal((await POST(request(ADMIN_HOST, { headers: { origin: PUBLIC_SITE_ORIGIN, cookie: await adminSessionCookie() } }))).status, 403);
    assert.equal((await POST(request(ADMIN_HOST, { headers: { origin: ADMIN_ORIGIN } }))).status, 401);

    // A refusal comes back as a SENTENCE the page prints, never a machine code.
    const refused = await POST(request(ADMIN_HOST, { headers: { origin: ADMIN_ORIGIN } }));
    const body = (await refused.json()) as { says?: string };
    assert.ok((body.says ?? "").length > 20, "the refusal is a sentence");
    assert.doesNotMatch(body.says ?? "", /[A-Z]{3,}_[A-Z]{3,}/, "no machine constant in the refusal");
  });
});

test("a message the console refuses outright never opens the control plane", async () => {
  await withAdminSessionKey(async () => {
    const response = await POST(
      request(ADMIN_HOST, {
        headers: { origin: ADMIN_ORIGIN, cookie: await adminSessionCookie() },
        body: JSON.stringify({ text: "run pnpm gates" }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { turn: { kind: string; code?: string }; storeRefusedBecause: string | null };
    assert.equal(body.turn.kind, "PROHIBITED");
    assert.equal(body.turn.code, "ARBITRARY_COMMAND");
    assert.equal(body.storeRefusedBecause, null, "the store was never opened, so there is nothing to report about it");
  });
});
