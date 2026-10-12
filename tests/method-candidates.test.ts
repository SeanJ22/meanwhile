/**
 * A route carrying a value off a closed set is never admitted: the prospective knowledge is validated first, and a
 * refused batch is recorded as REJECTED candidates with the exact issues, durably and immutably.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_LIFECYCLE_STATES,
  CandidateLifecycleRefused,
  candidateCounts,
  emptyCandidateStore,
  introducedIssues,
  markAdmitted,
  markRejected,
  markValidated,
  methodCandidateId,
  methodStoreIssues,
  proposeCandidate,
  rejectedCandidates,
  type CandidateStore,
} from "../lib/method/candidate.ts";
import { admitLearnedRoutes, UNATTRIBUTED_SCRIPT_ATTEMPT, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { emptyKnowledge, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { methodFixture } from "./method-store-fixture.ts";

const ON = "2026-08-29";

/** A route that VALIDATES: post-v55, so it must declare a claim class, and does. */
function goodRoute(id: string): LearnedRoute {
  return {
    id,
    title: `${id} — a synthetic route used only to prove the admission gate`,
    tier: "A1",
    fields: ["meeting"],
    note: "a test route; portability is UNKNOWN and it claims nothing",
    origin: "tests/method-candidates.test.ts",
    outcome: { jurisdiction: "az", rows: 3, outcome: "YIELDED", note: "synthetic" },
    claims: [
      {
        id: `${id}#exists`,
        class: "ROUTE_EXISTENCE",
        statement: "this synthetic route exists",
        restsOn: [],
      },
    ],
  };
}

/** A route that does not validate: a value off a closed set. */
function badRoute(id: string): LearnedRoute {
  return {
    ...goodRoute(id),
    outcome: {
      jurisdiction: "az",
      rows: 3,
      // `WORKED` is not a member of YIELDED | ZERO | FAILED | BLOCKED.
      outcome: "WORKED" as LearnedRoute["outcome"]["outcome"],
      note: "synthetic",
    },
  };
}

test("PLANTED: a BAD candidate changes nothing and is refused by name", () => {
  const k = methodFixture();
  const before = JSON.stringify(k);
  const out = admitLearnedRoutes(k, emptyCandidateStore(), [badRoute("gate-control-bad")], { stamp: ON, attemptId: "at-test-bad" });

  assert.equal(out.admitted, false, "a batch that would break the store was ADMITTED");
  assert.ok(out.refusal);
  assert.match(out.refusal, /REFUSED/);
  assert.ok(
    out.introduced.some((i) => i.rule === "outcome-value-off-the-closed-set"),
    `the exact rule must be named; got ${JSON.stringify(out.introduced)}`,
  );
  // A refusal that still changed the knowledge would be worse than no refusal at all.
  assert.equal(JSON.stringify(out.knowledge), before, "the knowledge changed during a refusal");
  assert.ok(!out.knowledge.routes.some((r) => r.id === "gate-control-bad"));

  /* The refusal is durable: through a serialization round trip, not from memory. */
  const candidates = JSON.parse(JSON.stringify(out.candidates)) as CandidateStore;
  const rejected = rejectedCandidates(candidates);
  assert.equal(rejected.length, 1, "a rejection must be recorded; silence is not a rejection record");
  assert.equal(rejected[0].rejection?.code, "VALIDATION_FAILED");
  assert.equal(rejected[0].attemptId, "at-test-bad");
  assert.equal(rejected[0].observedMethodVersion, k.version, "the version OBSERVED is recorded");
  assert.ok(
    rejected[0].rejection?.issues.some((i) => i.rule === "outcome-value-off-the-closed-set"),
    "the rejection retains the exact issues, not a summary of them",
  );
  assert.equal(rejected[0].proposal.id, "gate-control-bad", "the proposal itself is retained");
  // The candidate was VALIDATED before it was REJECTED — the validators ran.
  assert.equal(rejected[0].validation?.ok, false);
  assert.equal(rejected[0].validation?.againstMethodVersion, k.version);

  // A first batch into an empty store is validated too: being first is not a reason to skip the gate.
  assert.equal(admitLearnedRoutes(emptyKnowledge(), emptyCandidateStore(), [badRoute("fresh-bad")], { stamp: ON }).admitted, false);
});

test("a VALID candidate IS admitted, and the method version increments", () => {
  const k = methodFixture();
  const out = admitLearnedRoutes(k, emptyCandidateStore(), [goodRoute("gate-control-good")], { stamp: ON, attemptId: "at-test-good" });

  assert.equal(out.admitted, true, `the valid candidate was refused: ${out.refusal}`);
  assert.equal(out.batch.learned, 1);
  assert.equal(out.knowledge.version, k.version + 1, "learning a route increments the method version");
  assert.equal(out.knowledge.routes.length, k.routes.length + 1);
  assert.ok(out.knowledge.routes.some((r) => r.id === "gate-control-good"));
  // The admitted knowledge is VALID — the gate is not a filter that lets its own output through.
  assert.deepEqual(methodStoreIssues(out.knowledge), methodStoreIssues(k));

  assert.equal(out.candidates.candidates.length, 1);
  assert.equal(out.candidates.candidates[0].lifecycle, "ADMITTED");
  assert.equal(out.candidates.candidates[0].admission?.effect, "LEARNED");
  assert.equal(out.candidates.candidates[0].admission?.methodVersionAfter, out.knowledge.version);
  assert.deepEqual(candidateCounts(out.candidates), { PROPOSED: 0, VALIDATED: 0, ADMITTED: 1, REJECTED: 0 });
});

test("re-offering an admitted route is ALREADY_KNOWN, not a second learning", () => {
  const first = admitLearnedRoutes(methodFixture(), emptyCandidateStore(), [goodRoute("gate-control-rerun")], { stamp: ON, attemptId: "at-run-1" });
  const second = admitLearnedRoutes(first.knowledge, first.candidates, [goodRoute("gate-control-rerun")], { stamp: ON, attemptId: "at-run-2" });
  assert.equal(second.admitted, true);
  assert.equal(second.batch.learned, 0);
  assert.equal(second.batch.already, 1);
  assert.equal(second.knowledge.version, first.knowledge.version, "a re-run must not inflate the method version");
  assert.equal(second.candidates.candidates.length, 2, "two Attempts offered it; both are recorded");
  assert.equal(second.candidates.candidates[1].admission?.effect, "ALREADY_KNOWN");
});

test("a store that would introduce an issue is refused, and two independent rules both fire", () => {
  const k: MethodKnowledge = methodFixture();
  // Version +1 so the route enters AFTER the claim-class floor: a gate that catches one defect and waves the next one through has been tested against one defect.
  const broken: MethodKnowledge = {
    ...k,
    version: k.version + 1,
    routes: [
      ...k.routes,
      {
        id: "direct-write-control",
        title: "a route with no claim class, learned after the floor version",
        tier: "A1",
        fields: ["meeting"],
        applicability: {
          portability: "NATIONWIDE",
          states: ["az"],
          governmentTypes: [],
          platforms: [],
          publishers: [],
          note: "claims nationwide on one state's evidence",
        },
        outcomes: [],
        subBranches: [],
        origin: "tests/method-candidates.test.ts",
        learnedAtVersion: k.version + 1,
        learnedOn: ON,
      },
    ],
  };
  const { introduced } = introducedIssues(k, broken);
  assert.ok(introduced.some((i) => i.rule === "over-generalized"));
  assert.ok(introduced.some((i) => i.rule === "claim-class-required-for-new-route"));
});

test("a terminal candidate is history and is never rewritten", () => {
  const p = proposeCandidate(emptyCandidateStore(), {
    attemptId: "at-lifecycle",
    proposal: goodRoute("lifecycle-control"),
    submittedAt: ON,
    observedMethodVersion: 55,
  });
  const v = markValidated(p.store, p.candidate.id, {
    at: ON,
    againstMethodVersion: 55,
    introduced: [],
    preExisting: 0,
    ok: true,
  });
  const a = markAdmitted(v.store, p.candidate.id, {
    at: ON,
    admittedAs: "lifecycle-control",
    effect: "LEARNED",
    methodVersionAfter: 56,
  });

  assert.throws(
    () =>
      markRejected(a.store, p.candidate.id, {
        at: ON,
        code: "VALIDATION_FAILED",
        reason: "a second opinion",
        issues: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof CandidateLifecycleRefused);
      assert.equal(error.from, "ADMITTED");
      assert.equal(error.to, "REJECTED");
      return true;
    },
  );

  // And the reverse: a PROPOSED candidate cannot skip to ADMITTED.
  assert.throws(
    () =>
      markAdmitted(p.store, p.candidate.id, {
        at: ON,
        admittedAs: "lifecycle-control",
        effect: "LEARNED",
        methodVersionAfter: 56,
      }),
    CandidateLifecycleRefused,
  );
});

test("candidate ids are DERIVED, so a replayed submission collides instead of duplicating", () => {
  const proposal = goodRoute("derived-id-control");
  const id = methodCandidateId("at-derived", proposal.id, ON);

  const first = proposeCandidate(emptyCandidateStore(), {
    attemptId: "at-derived",
    proposal,
    submittedAt: ON,
    observedMethodVersion: 55,
  });
  assert.equal(first.candidate.id, id);
  assert.equal(first.already, false);

  const replay = proposeCandidate(first.store, {
    attemptId: "at-derived",
    proposal,
    submittedAt: ON,
    observedMethodVersion: 55,
  });
  assert.equal(replay.already, true);
  assert.equal(replay.store.candidates.length, 1, "a replay created a second record of one offer");

  // A different Attempt offering the same route is a different record.
  const other = proposeCandidate(replay.store, {
    attemptId: "at-other",
    proposal,
    submittedAt: ON,
    observedMethodVersion: 55,
  });
  assert.equal(other.store.candidates.length, 2);
});

test("the lifecycle counts name every state, including the zeroes, and add up", () => {
  const refused = admitLearnedRoutes(methodFixture(), emptyCandidateStore(), [badRoute("count-bad")], { stamp: ON, attemptId: "at-count-bad" });
  const store = admitLearnedRoutes(refused.knowledge, refused.candidates, [goodRoute("count-good")], { stamp: ON, attemptId: "at-count-good" }).candidates;
  assert.equal(store.candidates.length, 2);
  const counts = candidateCounts(store);
  assert.deepEqual(Object.keys(counts).sort(), [...CANDIDATE_LIFECYCLE_STATES].sort());
  assert.equal(
    Object.values(counts).reduce((n, x) => n + x, 0),
    store.candidates.length,
    "a candidate in no counted state would vanish from every report",
  );
});

test("an admission with no control-plane Attempt says so rather than minting an id", () => {
  const a = admitLearnedRoutes(emptyKnowledge(), emptyCandidateStore(), [goodRoute("unattributed")], {
    stamp: ON,
  });
  assert.equal(a.admitted, true);
  assert.equal(a.candidates.candidates[0].attemptId, UNATTRIBUTED_SCRIPT_ATTEMPT);
  assert.ok(
    !/^at-/.test(a.candidates.candidates[0].attemptId),
    "a fabricated Attempt id would resolve to nothing and read exactly like one that resolves",
  );
});
