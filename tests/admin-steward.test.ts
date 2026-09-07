import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AUTHORITY_CLASSES,
  REFUSAL_CODES,
  authorityPermits,
} from "../lib/control-plane/gateway/contract.ts";
import type { CodeIdentity } from "../lib/control-plane/code-identity.ts";
import { isCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import { plainCode, plainText } from "../lib/control-plane/plain-words.ts";
import type {
  ReviewRecordKind,
  SoftwareReleaseReviewRecord,
} from "../lib/control-plane/software-release-review.ts";
import {
  BLOCKER_CLASSES,
  QUEUE_STATES,
  RELEASE_EXECUTION_SEAM,
  RELEASE_STAGES,
  SOFTWARE_RELEASE_EXECUTION,
  STEWARD_ACTIONS,
  UNSUPPORTED_CONTROLS,
  buildStewardModel,
  countClaimsOf,
  farthestReached,
  renderedNumbersOf,
  shortId,
  type StewardInput,
  type StewardQueueItem,
} from "../lib/control-plane/steward.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

/**
 * **THE INTEGRATION STEWARD PANEL — ADM-C2 and §11.**
 *
 * The seeded failures, and each one is seeded because it is the failure that
 * would look fine:
 *
 *  1. **A commit that is not main's head reads as UNMERGED.** It is not. A
 *     deployed site cannot run a git ancestry check, so "main's head is a
 *     different commit" and "this commit is not in main" are different claims
 *     and only the first is available. Reporting the second is exactly the
 *     "never label a staging decision Implemented on main" law running
 *     backwards, and it would tell the owner work was lost that was not.
 *
 *  2. **A build the owner approved reads as LIVE.** §9A.18 forbids labelling an
 *     implementation live without production evidence. The only production
 *     evidence this page has is the build stamp of the deploy serving it.
 *
 *  3. **A store that could not be read reads as an empty queue.** Zero builds
 *     waiting and "the record could not be read" render identically unless the
 *     model carries the difference, and the first is the one an owner acts on.
 *
 *  4. **Every red item becomes an introduced blocker.** §3.9 forbids it by
 *     name. A review row records the owner's judgement, not the defect's
 *     origin, so the class is a named gap.
 *
 *  5. **A control that is not supported gets a button anyway.** Four of the six
 *     ADM-C2 controls have nothing canonical to call. A button that appends a
 *     row and changes nothing is worse than no button.
 *
 * The page itself is read as SOURCE TEXT: a `.tsx` cannot be imported under
 * `node --test`, so the render laws are asserted against the file the way every
 * other admin-surface guard in this repository does it.
 */

const ROOT = join(import.meta.dirname, "..");
const PAGE = readFileSync(join(ROOT, "app", "(admin)", "admin", "steward", "page.tsx"), "utf8");
const MODULE = readFileSync(join(ROOT, "lib", "control-plane", "steward.ts"), "utf8");

/* ------------------------------------------------------------- fixtures */

const SHA_A = "aaaaaaaa1111111111111111111111111111aaaa";
const SHA_B = "bbbbbbbb2222222222222222222222222222bbbb";
const SHA_C = "cccccccc3333333333333333333333333333cccc";

function row(over: {
  readonly sha: string;
  readonly decision: ReviewRecordKind;
  readonly createdAt: string;
  readonly section?: string | null;
  readonly deployId?: string | null;
}): SoftwareReleaseReviewRecord {
  return {
    formatVersion: 1,
    id: `${over.sha}:${over.decision}:${over.section ?? "-"}:${over.createdAt}`,
    stagingSha: over.sha,
    deployId: over.deployId ?? null,
    section: over.section ?? null,
    decision: over.decision,
    raisedStateChoice: null,
    feedback: null,
    actor: "session:adm_test",
    composedFrom: null,
    createdAt: over.createdAt,
    manifest: { prompt3Status: null, reviewState: null, stagingBoundary: null, reportedAt: null },
  };
}

function identity(over: Partial<CodeIdentity> = {}): CodeIdentity {
  return {
    formatVersion: 1,
    readAt: "2026-09-06T12:00:00.000Z",
    rawMainSha: SHA_C,
    rawMainRef: "origin/main",
    rawMainFetched: true,
    effectiveExecutableSha: SHA_C,
    nonShippingAbove: [],
    executable: null,
    runnerTestedSha: SHA_C,
    verdict: "CONSISTENT",
    detail: "raw main cccccccc; executable head cccccccc; runner tested cccccccc; CONSISTENT",
    walkBound: 64,
    walkExhausted: false,
    ...over,
  };
}

function input(over: Partial<StewardInput> = {}): StewardInput {
  return {
    nowIso: "2026-09-06T13:00:00.000Z",
    deployedSha: null,
    codeIdentity: null,
    identityDetail: null,
    reviewRows: [],
    reviewDetail: null,
    ...over,
  };
}

function itemFor(model: ReturnType<typeof buildStewardModel>, sha: string): StewardQueueItem {
  const found = model.queue.find((i) => i.stagingSha === sha);
  assert.ok(found, `expected a queue item for ${shortId(sha)}`);
  return found;
}

/* --------------------------------------------------------- the empty log */

test("with no runner reading, the walk above the executable head is a gap and never a zero", () => {
  // A zero here would say "nothing sits above the newest code change", which is
  // a finding. No walk happened, so no finding was made.
  const model = buildStewardModel(input());
  assert.equal(model.identity.nonShippingAbove.held, false);
  if (!model.identity.nonShippingAbove.held) {
    assert.match(model.identity.nonShippingAbove.gap.says, /runner/i);
  }
  assert.ok(auditRenderedNumbers(renderedNumbersOf(model)).ok, "a gap is never smuggled in as a rendered number");
});

test("an empty review log is an empty queue and says so, with nothing invented", () => {
  const model = buildStewardModel(input());
  assert.equal(model.queueReadable, true);
  assert.equal(model.queue.length, 0);
  assert.equal(model.queueDepth.value, 0);
  assert.equal(model.queueDepth.denominator, 0);
  assert.equal(model.current, null);
  assert.equal(model.next, null);
  assert.equal(model.latestReceipt.held, false);
  assert.match(model.waitingSays, /No build is waiting/);
});

test("SEEDED: a store that could not be read never renders as a queue of zero", () => {
  const model = buildStewardModel(
    input({ reviewRows: null, reviewDetail: "Reading the release review log failed (TypeError). We could not ask." }),
  );
  assert.equal(model.queueReadable, false);
  assert.equal(model.queue.length, 0);
  // The difference the owner must be able to see: the model carries WHY, and
  // the waiting sentence refuses to claim nothing is waiting.
  assert.match(model.queueSays ?? "", /could not/i);
  assert.doesNotMatch(model.waitingSays, /No build is waiting/);
  assert.equal(model.latestReceipt.held, false);
});

/* ------------------------------------------------------------- the order */

test("the queue is the order the builds were first recorded in, oldest first", () => {
  const rows = [
    row({ sha: SHA_B, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-05T10:00:00.000Z" }),
    row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T09:00:00.000Z" }),
    row({ sha: SHA_C, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-06T11:00:00.000Z" }),
    row({ sha: SHA_A, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-04T09:30:00.000Z" }),
  ];
  const model = buildStewardModel(input({ reviewRows: rows }));
  assert.deepEqual(
    model.queue.map((i) => i.stagingSha),
    [SHA_A, SHA_B, SHA_C],
  );
  assert.deepEqual(
    model.queue.map((i) => i.position),
    [1, 2, 3],
  );
  assert.equal(model.queue[0].dependsOn, null);
  assert.equal(model.queue[1].dependsOn, SHA_A);
  assert.equal(model.queue[2].dependsOn, SHA_B);
  assert.match(model.queue[0].dependencySays, /Nothing is ahead/);
  // The newest recorded build is what the identity block calls "the test site".
  assert.deepEqual(model.identity.staging, { held: true, value: SHA_C });
});

/* -------------------------------------------------------------- the state */

test("a build nobody has decided about is waiting on the owner, and says what to do", () => {
  const model = buildStewardModel(
    input({ reviewRows: [row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T09:00:00.000Z" })] }),
  );
  const item = itemFor(model, SHA_A);
  assert.equal(item.state, "AWAITING_YOUR_REVIEW");
  assert.equal(item.ownerActionRequired, true);
  assert.match(item.ownerAction ?? "", /release review/i);
  assert.equal(item.responsible, "You");
  assert.equal(item.blocker.blocked, true);
  assert.deepEqual(item.blocker.klass, { held: true, value: "OWNER_GATED" });
  assert.equal(model.needsYou.value, 1);
  assert.equal(model.needsYou.denominator, 1);
});

test("SEEDED: a build the owner sent back is blocked, but its blocker class is a named gap (§3.9)", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [
        row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T09:00:00.000Z" }),
        row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" }),
      ],
    }),
  );
  const item = itemFor(model, SHA_A);
  assert.equal(item.state, "CHANGES_REQUESTED");
  assert.equal(item.blocker.blocked, true);
  // NOT "INTRODUCED". The row says what the owner decided, never where the
  // defect came from — turning every red item into an introduced release
  // blocker is what §3.9 forbids by name.
  assert.equal(item.blocker.klass.held, false);
  if (!item.blocker.klass.held) {
    assert.equal(item.blocker.klass.gap.whose, "UNKNOWABLE_NOW");
    assert.match(item.blocker.klass.gap.says, /would fill this/);
  }
  assert.equal(item.ownerActionRequired, false);
});

test("a build discarded on every section is discarded; nothing further is claimed about it", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [
        row({ sha: SHA_A, decision: "DISCARD", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_A, decision: "DISCARD", section: "raised-state", createdAt: "2026-09-04T10:01:00.000Z" }),
      ],
    }),
  );
  assert.equal(itemFor(model, SHA_A).state, "DISCARDED");
  assert.equal(model.queueDepth.value, 0, "a discarded build is not still waiting on somebody");
});

test("an owner-approved build waits at the shipping door, and the console says the door is elsewhere", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [
        row({ sha: SHA_A, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_A, decision: "OWNER_APPROVED_FOR_PRODUCTION", createdAt: "2026-09-04T11:00:00.000Z" }),
      ],
    }),
  );
  const item = itemFor(model, SHA_A);
  assert.equal(item.state, "APPROVED_FOR_PRODUCTION");
  assert.equal(item.ownerActionRequired, false);
  assert.match(item.nextStep, /on the machine/);
  assert.match(model.waitingSays, /shipping door/);
});

test("a build that is main's head reads as on main; one that is the executable head does too", () => {
  const rows = [
    row({ sha: SHA_A, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" }),
    row({ sha: SHA_B, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-05T10:00:00.000Z" }),
  ];
  // PRDY-1: main has moved to SHA_C with an observer-only commit, and the
  // executable head is still SHA_B. A build at the executable head is on main.
  const model = buildStewardModel(
    input({
      reviewRows: rows,
      codeIdentity: identity({
        rawMainSha: SHA_C,
        effectiveExecutableSha: SHA_B,
        runnerTestedSha: SHA_B,
        nonShippingAbove: [{ sha: SHA_C, klass: "OBSERVER_ONLY", reason: "records an observation", changedPathCount: 1 } as never],
      }),
    }),
  );
  assert.equal(itemFor(model, SHA_B).state, "ON_MAIN");
  assert.equal(itemFor(model, SHA_A).state, "AWAITING_YOUR_REVIEW");
  assert.equal(model.identity.nonShippingAbove.held, true);
  if (model.identity.nonShippingAbove.held) {
    assert.equal(model.identity.nonShippingAbove.value.value, 1);
    assert.equal(model.identity.nonShippingAbove.value.denominator, 64, "the walk's own bound is the denominator");
  }
  assert.match(model.identity.verdictSays, /current/);
});

test("the commit production was built from reads as live, and that outranks the decision on it", () => {
  const model = buildStewardModel(
    input({
      deployedSha: SHA_A,
      reviewRows: [row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" })],
    }),
  );
  const item = itemFor(model, SHA_A);
  assert.equal(item.state, "LIVE_IN_PRODUCTION", "what the code has reached outranks what was thought of it");
  assert.equal(item.deployResult.held, true);
  assert.equal(item.farthest.key, "DEPLOYED_TO_PRODUCTION");
});

/* ---------------------------------------------------------- the lifecycle */

test("SEEDED: a commit that is not main's head is NEVER reported unmerged", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [row({ sha: SHA_A, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" })],
      codeIdentity: identity({ rawMainSha: SHA_C, effectiveExecutableSha: SHA_C, runnerTestedSha: SHA_C }),
    }),
  );
  const item = itemFor(model, SHA_A);
  const merged = item.lifecycle.find((s) => s.key === "MERGED_TO_MAIN");
  assert.ok(merged);
  assert.equal(merged.state, "CANNOT_TELL", "NOT_REACHED here would be a claim git alone can settle");
  assert.match(merged.says, /ancestry/);
  assert.equal(item.mergeResult.held, false);
  if (!item.mergeResult.held) assert.equal(item.mergeResult.gap.whose, "UNKNOWABLE_NOW");
});

test("SEEDED: an approved build is never labelled live without a production commit that matches", () => {
  const model = buildStewardModel(
    input({
      deployedSha: SHA_C,
      reviewRows: [
        row({ sha: SHA_A, decision: "APPROVE", section: "map-movement", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_A, decision: "OWNER_APPROVED_FOR_PRODUCTION", createdAt: "2026-09-04T11:00:00.000Z" }),
      ],
    }),
  );
  const item = itemFor(model, SHA_A);
  assert.notEqual(item.state, "LIVE_IN_PRODUCTION");
  const deployed = item.lifecycle.find((s) => s.key === "DEPLOYED_TO_PRODUCTION");
  assert.ok(deployed);
  assert.equal(deployed.state, "CANNOT_TELL");
  // The farthest TRUTHFUL state is the build on the test site — the decision is
  // recorded and the build exists, and nothing past that is evidenced.
  assert.equal(item.farthest.key, "IMPLEMENTED_IN_STAGING");
  assert.doesNotMatch(item.farthest.label, /production|live|main/i);
  assert.equal(item.lifecycle.find((s) => s.key === "DECIDED")?.state, "REACHED");
});

test("the production check is always unanswerable from here, and names what would answer it", () => {
  const model = buildStewardModel(
    input({ deployedSha: SHA_A, reviewRows: [row({ sha: SHA_A, decision: "APPROVE", createdAt: "2026-09-04T10:00:00.000Z" })] }),
  );
  const verified = itemFor(model, SHA_A).lifecycle.find((s) => s.key === "VERIFIED_ON_PRODUCTION");
  assert.ok(verified);
  assert.equal(verified.state, "CANNOT_TELL");
  assert.match(verified.says, /control plane/);
});

test("every stage key appears exactly once, in the declared order", () => {
  const model = buildStewardModel(
    input({ reviewRows: [row({ sha: SHA_A, decision: "APPROVE", createdAt: "2026-09-04T10:00:00.000Z" })] }),
  );
  assert.deepEqual(
    itemFor(model, SHA_A).lifecycle.map((s) => s.key),
    [...RELEASE_STAGES],
  );
});

test("farthestReached returns the last stage actually reached, never a hopeful one", () => {
  const stages = [
    { key: "DECIDED" as const, label: "You decided", state: "REACHED" as const, says: "x" },
    { key: "IMPLEMENTED_IN_STAGING" as const, label: "Built on the test site", state: "REACHED" as const, says: "x" },
    { key: "MERGED_TO_MAIN" as const, label: "Merged into main", state: "CANNOT_TELL" as const, says: "x" },
    { key: "DEPLOYED_TO_PRODUCTION" as const, label: "Deployed to production", state: "CANNOT_TELL" as const, says: "x" },
    { key: "VERIFIED_ON_PRODUCTION" as const, label: "Checked on production", state: "CANNOT_TELL" as const, says: "x" },
  ];
  assert.equal(farthestReached(stages).key, "IMPLEMENTED_IN_STAGING");
});

/* ------------------------------------------------------- counts and gates */

test("times sent back is counted against every decision recorded on the build", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [
        row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "one", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "two", createdAt: "2026-09-04T10:01:00.000Z" }),
        row({ sha: SHA_A, decision: "APPROVE", section: "three", createdAt: "2026-09-04T10:02:00.000Z" }),
        row({ sha: SHA_A, decision: "APPROVE", section: "four", createdAt: "2026-09-04T10:03:00.000Z" }),
        row({ sha: SHA_A, decision: "APPROVE", section: "five", createdAt: "2026-09-04T10:04:00.000Z" }),
        row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T09:00:00.000Z" }),
      ],
    }),
  );
  const item = itemFor(model, SHA_A);
  assert.equal(item.retries.value, 2);
  assert.equal(item.retries.denominator, 5, "console notes are not decisions");
  assert.equal(item.decisionCount, 5);
  assert.equal(item.rowCount, 6);
});

test("the required checks are the committed contract, never a second list", () => {
  const model = buildStewardModel(input());
  assert.deepEqual([...model.requiredChecks], [...REQUIRED_CONTEXTS]);
  const item = buildStewardModel(
    input({ reviewRows: [row({ sha: SHA_A, decision: "APPROVE", createdAt: "2026-09-04T10:00:00.000Z" })] }),
  ).queue[0];
  assert.deepEqual([...item.requiredChecks], [...REQUIRED_CONTEXTS]);
  // What they SAID about this commit is a named gap, not a green tick.
  assert.equal(item.gateState.held, false);
  if (!item.gateState.held) assert.match(item.gateState.gap.says, /would fill this/);
});

test("the receipt is the newest state-changing row, and a console note is not one", () => {
  const model = buildStewardModel(
    input({
      reviewRows: [
        row({ sha: SHA_A, decision: "APPROVE", section: "one", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T23:00:00.000Z" }),
      ],
    }),
  );
  const receipt = itemFor(model, SHA_A).receipt;
  assert.equal(receipt.held, true);
  if (receipt.held) {
    assert.equal(receipt.value.kind, "APPROVE");
    assert.equal(receipt.value.at, "2026-09-04T10:00:00.000Z");
    assert.equal(receipt.value.actorRef, "session:adm_test");
  }
  assert.equal(model.latestReceipt.held, true);
});

test("a build with only console notes has no receipt, and the gap says why", () => {
  const model = buildStewardModel(
    input({ reviewRows: [row({ sha: SHA_A, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-04T09:00:00.000Z" })] }),
  );
  const receipt = itemFor(model, SHA_A).receipt;
  assert.equal(receipt.held, false);
  if (!receipt.held) assert.match(receipt.gap.says, /No decision has been recorded/);
});

/* ------------------------------------------------------- the number audit */

test("every number this model offers carries a denominator and an interpretation", () => {
  const model = buildStewardModel(
    input({
      deployedSha: SHA_C,
      codeIdentity: identity(),
      reviewRows: [
        row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "one", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_B, decision: "APPROVE", section: "one", createdAt: "2026-09-05T10:00:00.000Z" }),
      ],
    }),
  );
  const audit = auditRenderedNumbers(renderedNumbersOf(model));
  assert.ok(audit.ok, audit.detail);
  assert.ok(audit.checked >= 5, `expected the model to declare its numbers, saw ${audit.checked}`);
  const counts = checkStatedEqualsRendered([
    ...countClaimsOf(model),
    { label: "candidate cards drawn", stated: model.queueDepth.denominator, rendered: model.queue.length },
  ]);
  assert.ok(counts.ok, counts.detail);
});

test("ADM-C2: every field the read model was asked for is present, or is a named gap", () => {
  const model = buildStewardModel(
    input({
      deployedSha: SHA_C,
      codeIdentity: identity(),
      reviewRows: [row({ sha: SHA_A, decision: "APPROVE", section: "one", createdAt: "2026-09-04T10:00:00.000Z" })],
    }),
  );
  // The four commits.
  for (const [name, h] of [
    ["raw main", model.identity.rawMain],
    ["executable main", model.identity.executableMain],
    ["production", model.identity.production],
    ["test site", model.identity.staging],
  ] as const) {
    assert.ok(h.held || h.gap.says.trim() !== "", `${name} is neither held nor a named gap`);
  }
  const item = itemFor(model, SHA_A);
  // The per-item fields, each answered rather than absent.
  assert.ok((QUEUE_STATES as readonly string[]).includes(item.state));
  assert.ok(item.nextStep.trim() !== "", "action / next step");
  assert.ok(item.dependencySays.trim() !== "", "dependency relationship");
  assert.ok(item.blocker.says.trim() !== "", "blocker");
  assert.ok(item.requiredChecks.length > 0, "required gate state");
  assert.ok(item.gateState.held || item.gateState.gap.says.trim() !== "", "gate state");
  assert.ok(item.mergeResult.held || item.mergeResult.gap.says.trim() !== "", "merge result");
  assert.ok(item.deployResult.held || item.deployResult.gap.says.trim() !== "", "deploy result");
  assert.equal(typeof item.retries.value, "number", "retry count");
  assert.ok(item.responsible.trim() !== "", "responsible agent");
  assert.equal(typeof item.ownerActionRequired, "boolean", "owner action required");
  assert.ok(item.receipt.held || item.receipt.gap.says.trim() !== "", "final durable receipt");
  assert.equal(item.decisions.value, item.decisionCount);
  assert.equal(item.decisions.denominator, item.rowCount);
});

/* ------------------------------------------------------------- the controls */

test("every offered control is a well-formed gateway action the owner may invoke", () => {
  assert.ok(STEWARD_ACTIONS.length > 0);
  for (const action of STEWARD_ACTIONS) {
    assert.ok((AUTHORITY_CLASSES as readonly string[]).includes(action.authority), `${action.type}: unknown authority`);
    assert.notEqual(action.authority, "PROHIBITED");
    assert.ok(authorityPermits("OWNER_SESSION", action.authority), `${action.type}: the owner cannot invoke it`);
    for (const refusal of action.refusals) {
      assert.ok((REFUSAL_CODES as readonly string[]).includes(refusal), `${action.type}: unknown refusal ${refusal}`);
    }
    assert.ok(action.label.trim() !== "" && action.does.trim() !== "" && action.doesNot.trim() !== "");
    assert.ok(action.executesThrough.trim() !== "", `${action.type}: no canonical path named`);
    assert.ok(action.readBackAt.startsWith("/admin"), `${action.type}: the result must be readable on the console`);
    assert.ok(action.readBackLabel.trim() !== "", `${action.type}: a path may not lead on the face`);
    assert.doesNotMatch(action.readBackLabel, /^\//, `${action.type}: the read-back label is a path, not a name`);
  }
});

test("no offered control ships anything, so the release-execution verdict still stands", () => {
  // The day one of these becomes GOVERNED_INTEGRATION is the day §11's verdict
  // has to be re-argued rather than quietly left behind.
  for (const action of STEWARD_ACTIONS) {
    assert.notEqual(
      action.authority,
      "GOVERNED_INTEGRATION",
      `${action.type} claims to ship. SOFTWARE_RELEASE_EXECUTION is still READY_FOR_NEXT_PASS, so either the seam exists now or the claim is false.`,
    );
  }
  assert.equal(SOFTWARE_RELEASE_EXECUTION, "READY_FOR_NEXT_PASS");
  assert.match(RELEASE_EXECUTION_SEAM.missingSeam, /runner/i);
  assert.match(RELEASE_EXECUTION_SEAM.preserves, /exact-head/);
});

test("an agent caller may not record an owner decision", () => {
  const decision = STEWARD_ACTIONS.find((a) => a.authority === "OWNER_DECISION_REQUIRED");
  assert.ok(decision, "the owner decision control must exist");
  assert.equal(authorityPermits("AGENT", decision.authority), false);
  assert.equal(authorityPermits("ANONYMOUS", decision.authority), false);
  assert.equal(decision.requiresStateVersion, true, "a decision on a build that moved is the exact-commit defect");
});

test("SEEDED: the four controls with no canonical seam are refused by name, each with the seam", () => {
  const asked = UNSUPPORTED_CONTROLS.map((c) => c.asked);
  for (const wanted of ["reprioritise an eligible queued item", "retry", "pause", "resume"]) {
    assert.ok(asked.includes(wanted), `ADM-C2 asked for "${wanted}" and the console does not account for it`);
  }
  for (const control of UNSUPPORTED_CONTROLS) {
    assert.ok((REFUSAL_CODES as readonly string[]).includes(control.refusal));
    assert.equal(control.refusal, "NOT_SUPPORTED_YET");
    assert.ok(control.missingSeam.length > 40, `${control.label}: the missing seam must be specific`);
    assert.ok(control.says.trim() !== "");
  }
  // And none of them is quietly also in the registry.
  const offered = new Set(STEWARD_ACTIONS.map((a) => a.label));
  for (const control of UNSUPPORTED_CONTROLS) assert.ok(!offered.has(control.label));
});

/* ----------------------------------------------------------- the language */

test("every vocabulary constant this console renders becomes ordinary words", () => {
  for (const code of [...QUEUE_STATES, ...BLOCKER_CLASSES, SOFTWARE_RELEASE_EXECUTION]) {
    const words = plainCode(code);
    assert.doesNotMatch(words, /_/, `${code} still shows an underscore as ${words}`);
    assert.doesNotMatch(words, /\b[A-Z]{2,}\b/, `${code} still shows a machine constant as ${words}`);
    assert.notEqual(words, code);
  }
});

test("no sentence the model produces carries a machine constant or the word our", () => {
  const model = buildStewardModel(
    input({
      deployedSha: SHA_C,
      codeIdentity: identity(),
      reviewRows: [
        row({ sha: SHA_A, decision: "NEEDS_CHANGES", section: "one", createdAt: "2026-09-04T10:00:00.000Z" }),
        row({ sha: SHA_B, decision: "MANIFEST_OBSERVED", createdAt: "2026-09-05T10:00:00.000Z" }),
      ],
    }),
  );
  const sentences: string[] = [
    model.waitingSays,
    model.identity.verdictSays,
    ...UNSUPPORTED_CONTROLS.flatMap((c) => [c.says, c.label]),
    ...STEWARD_ACTIONS.flatMap((a) => [a.label, a.does, a.doesNot]),
    RELEASE_EXECUTION_SEAM.says,
  ];
  for (const item of model.queue) {
    sentences.push(item.nextStep, item.dependencySays, item.blocker.says, item.responsible);
    if (item.ownerAction) sentences.push(item.ownerAction);
    for (const stage of item.lifecycle) sentences.push(stage.says, stage.label);
    if (!item.gateState.held) sentences.push(item.gateState.gap.says);
    if (!item.mergeResult.held) sentences.push(item.mergeResult.gap.says);
    if (!item.deployResult.held) sentences.push(item.deployResult.gap.says);
    if (!item.blocker.klass.held) sentences.push(item.blocker.klass.gap.says);
  }
  for (const sentence of sentences) {
    assert.equal(plainText(sentence), sentence, `a machine constant reached the face: ${sentence}`);
    // RULING: the product has one user, so nothing owner-facing says "our".
    assert.doesNotMatch(sentence, /\bour\b/i, `owner-facing copy says "our": ${sentence}`);
  }
});

/* --------------------------------------------------------- the module law */

test("the read model is pure: no store, clock, environment, filesystem or network", () => {
  for (const forbidden of ["node:fs", "node:child_process", "process.env", "fetch(", "new Date(", "Date.now("]) {
    assert.ok(!MODULE.includes(forbidden), `lib/control-plane/steward.ts reaches for ${forbidden}`);
  }
  // The prefix-tolerant commit comparison is imported, never re-derived
  // (RULING 103): a second copy is free to disagree with the freeze gate.
  assert.match(MODULE, /import \{ sameCommit \} from "\.\.\/ops\/production-integrity\.ts"/);
  assert.match(MODULE, /import \{ REQUIRED_CONTEXTS \} from "\.\.\/ops\/required-checks\.ts"/);
});

/* ------------------------------------------------------------- the page */

test("the page is uncached and reads the model rather than deriving one", () => {
  assert.match(PAGE, /export const dynamic = "force-dynamic"/);
  assert.match(PAGE, /export const revalidate = 0/);
  assert.match(PAGE, /buildStewardModel\(/);
  assert.match(PAGE, /from "@\/lib\/control-plane\/steward\.ts"/);
});

test("SEEDED: the page has no way to merge, deploy or bypass the shipping door", () => {
  // §3.8 and §11. A form that posted anywhere but the console's own routes, or
  // any direct reach at GitHub or Netlify, would be the second Steward.
  for (const forbidden of ["api.github.com", "api.netlify.com", "githubusercontent", "gh pr merge", "handoff --ship"]) {
    assert.ok(!PAGE.includes(forbidden), `the page reaches for ${forbidden}`);
  }
  // The only <form> on the page is the shared hidden fix-queue form, rendered
  // by QueueForm — the page declares no form of its own.
  assert.ok(!/<form[\s>]/.test(PAGE), "the page declares its own form; the shared QueueForm is the only one allowed");
  assert.match(PAGE, /<QueueForm returnTo=\{HERE\} \/>/);
});

test("the page must not fork the exact-commit review writer", () => {
  assert.ok(
    !PAGE.includes("release-review/write"),
    "the exact-commit rule lives in the release-review writer; a second caller of it here would be a second implementation of the rule",
  );
  assert.match(PAGE, /href=\{`\$\{RELEASE_REVIEW_PATH\}`\}|href=\{RELEASE_REVIEW_PATH\}/);
});

test("the page renders machine constants through the one translation layer", () => {
  assert.match(PAGE, /<Code raw=\{item\.state\}/);
  assert.ok(!/>\{item\.state\}</.test(PAGE), "a queue state is rendered raw");
  assert.ok(!/>\{action\.authority\}</.test(PAGE), "an authority class is rendered raw");
  assert.match(PAGE, /<Code raw=\{action\.authority\}/);
  assert.match(PAGE, /<Code raw=\{control\.refusal\}/);
});

test("the page states its list counts from the lists themselves, never from a typed word", () => {
  // Stated N equals rendered rows. A hardcoded "Two things" is a claim that
  // stops being true the moment a control is added or removed.
  assert.match(PAGE, /\{STEWARD_ACTIONS\.length\}/);
  assert.match(PAGE, /\{UNSUPPORTED_CONTROLS\.length\}/);
  assert.ok(!/\b(Two|Three|Four|Five|Six) (things|more controls)\b/.test(PAGE));
  assert.match(PAGE, /checkStatedEqualsRendered\(\[/);
  assert.match(PAGE, /auditRenderedNumbers\(renderedNumbersOf\(model\)\)/);
});

test("the page reads only the build stamp from the environment, and never names it on the face", () => {
  const envReads = [...PAGE.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(envReads)], ["WTP_BUILD_COMMIT"]);
  // The name reaches the code and never the JSX: a variable name on the face is
  // what plainText replaces, and the page has no reason to print one.
  assert.ok(!/>\s*WTP_/.test(PAGE));
});

test("every card on the page states whether it needs the owner", () => {
  // §9A.3 / POS-14. StatusBlock renders the line, so every StatusBlock must be
  // given one — and the page uses StatusBlock for each of its state cards.
  const blocks = PAGE.split("<StatusBlock").length - 1;
  const needs = PAGE.split("needsYou=").length - 1;
  assert.ok(blocks >= 4, `expected the page to use the shared state block, saw ${blocks}`);
  assert.equal(needs, blocks, "a StatusBlock without needsYou is a card that does not say whether it needs him");
});

test("the fixture the page validates its heartbeat reading with is a real code identity", () => {
  assert.equal(isCodeIdentity(identity()), true);
  assert.equal(isCodeIdentity(null), false);
  assert.equal(isCodeIdentity({ formatVersion: 1 }), false);
  assert.match(PAGE, /isCodeIdentity\(/);
});
