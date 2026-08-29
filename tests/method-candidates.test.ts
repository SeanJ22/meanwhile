/**
 * **VALIDATION BEFORE ADMISSION, AND A REFUSAL THAT SURVIVES THE TERMINAL.**
 * (2026-08-29.)
 *
 * `runLearnBatch` was an unconditional canonical writer: read the store, call
 * `learnBatch`, `writeFileSync`. No gate of any kind. A route carrying a value
 * off a closed set reached `data/method/knowledge.json` and the first thing that
 * noticed was `pnpm method:check`, afterwards, if somebody ran it — which is
 * exactly the sequence the `effort` and `outcome` notes in `validateKnowledge`
 * are both written accounts of.
 *
 * The controls here are written so they can fail:
 *
 *   a. a BAD candidate cannot change the store — proved against a real copy of
 *      the real canonical store, by BYTES;
 *   b. a VALID candidate can — same copy, same mechanism, bytes change and the
 *      method version increments;
 *   c. the refusal is DURABLE: a REJECTED candidate is persisted with its code
 *      and the exact issues, and survives a reload from disk;
 *   d. the lifecycle is a lifecycle — a terminal candidate cannot be rewritten;
 *   e. candidate ids are derived, so a replayed submission collides instead of
 *      duplicating;
 *   f. the counts by lifecycle add up to the corpus.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CANDIDATE_LIFECYCLE_STATES,
  CandidateLifecycleRefused,
  InvalidMethodStoreRefused,
  candidateCounts,
  emptyCandidateStore,
  markAdmitted,
  markRejected,
  markValidated,
  methodCandidateId,
  methodStoreIssues,
  proposeCandidate,
  readCandidateStore,
  rejectedCandidates,
  writeMethodStore,
} from "../lib/method/candidate.ts";
import {
  admitLearnedRoutes,
  runLearnBatch,
  UNATTRIBUTED_SCRIPT_ATTEMPT,
  type LearnedRoute,
} from "../lib/method/learn-batch.ts";
import { emptyKnowledge, type MethodKnowledge } from "../lib/method/knowledge.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ON = "2026-08-29";
const CANONICAL = join(ROOT, "data", "method", "knowledge.json");

/**
 * A copy of the REAL canonical store in a scratch directory.
 *
 * A synthetic three-route store would prove the gate works on a store nobody
 * has. The real one carries 116 routes, four claim classes, two withdrawn
 * assertions and twelve legacy sub-branches with unparseable dates — the shape
 * the gate actually has to hold. The canonical file itself is never written by
 * these tests; only the copy is.
 */
function copyOfCanonical(name: string): { dir: string; storePath: string; candidatePath: string } {
  const dir = join(ROOT, ".scratch", `method-candidate-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "data", "method"), { recursive: true });
  const storePath = join(dir, "data", "method", "knowledge.json");
  writeFileSync(storePath, readFileSync(CANONICAL, "utf8"), "utf8");
  return { dir, storePath, candidatePath: join(dir, "data", "method", "candidates.json") };
}

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

/**
 * A route that DOES NOT validate, and the defect is the exact one the store's
 * own history records reaching canonical knowledge twice: a value off a closed
 * set that `tsc` caught afterwards for an unrelated reason.
 */
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

/* ------------------------------------------------------------------------ (a) */

test("PLANTED: a BAD candidate cannot change data/method/knowledge.json — by bytes", () => {
  const { dir, storePath, candidatePath } = copyOfCanonical("bad");
  const before = readFileSync(storePath, "utf8");
  const beforeStore = JSON.parse(before) as MethodKnowledge;

  /*
   * `runLearnBatch` sets `process.exitCode = 1` on a refusal, because its
   * callers are scripts that ignore the return value and a script that refuses
   * must exit non-zero. In-process that would make the whole test RUN report
   * failure, so the exit code is saved and restored around the call — the
   * refusal itself is asserted on the returned result, not on the exit code.
   */
  const exitCodeBefore = process.exitCode;
  const result = runLearnBatch(storePath, [badRoute("gate-control-bad")], ON, {
    attemptId: "at-test-bad",
    candidateStorePath: candidatePath,
  });
  assert.equal(process.exitCode, 1, "a refusing script run must exit non-zero");
  process.exitCode = exitCodeBefore;

  assert.equal(result.written, false, "a batch that would break the store was WRITTEN");
  assert.ok(result.refusal, "the refusal must say so in words");
  assert.match(result.refusal, /REFUSED/);
  assert.ok(
    result.introduced.some((i) => i.rule === "outcome-value-off-the-closed-set"),
    `the exact rule must be named; got ${JSON.stringify(result.introduced)}`,
  );

  // THE ASSERTION THAT MATTERS. A refusal that still wrote would be worse than
  // no refusal at all.
  assert.equal(readFileSync(storePath, "utf8"), before, "the store changed during a refusal");
  const after = JSON.parse(readFileSync(storePath, "utf8")) as MethodKnowledge;
  assert.equal(after.version, beforeStore.version);
  assert.equal(after.routes.length, beforeStore.routes.length);
  assert.ok(!after.routes.some((r) => r.id === "gate-control-bad"));

  /* (c) AND THE REFUSAL IS DURABLE — reloaded from disk, not from memory. */
  const candidates = readCandidateStore(candidatePath);
  const rejected = rejectedCandidates(candidates);
  assert.equal(rejected.length, 1, "a rejection must be recorded; silence is not a rejection record");
  assert.equal(rejected[0].rejection?.code, "VALIDATION_FAILED");
  assert.equal(rejected[0].attemptId, "at-test-bad");
  assert.equal(rejected[0].observedMethodVersion, beforeStore.version, "the version OBSERVED is recorded");
  assert.ok(
    rejected[0].rejection?.issues.some((i) => i.rule === "outcome-value-off-the-closed-set"),
    "the rejection retains the exact issues, not a summary of them",
  );
  assert.equal(rejected[0].proposal.id, "gate-control-bad", "the proposal itself is retained");

  // The candidate was VALIDATED before it was REJECTED — the validators ran.
  assert.equal(rejected[0].validation?.ok, false);
  assert.equal(rejected[0].validation?.againstMethodVersion, beforeStore.version);

  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ (b) */

test("a VALID candidate DOES change the store, and the method version increments", () => {
  const { dir, storePath, candidatePath } = copyOfCanonical("good");
  const before = readFileSync(storePath, "utf8");
  const beforeStore = JSON.parse(before) as MethodKnowledge;

  const result = runLearnBatch(storePath, [goodRoute("gate-control-good")], ON, {
    attemptId: "at-test-good",
    candidateStorePath: candidatePath,
  });

  assert.equal(result.written, true, `the valid candidate was refused: ${result.refusal}`);
  assert.equal(result.learned, 1);
  assert.notEqual(readFileSync(storePath, "utf8"), before, "the bytes did not change");

  const after = JSON.parse(readFileSync(storePath, "utf8")) as MethodKnowledge;
  assert.equal(after.version, beforeStore.version + 1, "learning a route increments the method version");
  assert.equal(after.routes.length, beforeStore.routes.length + 1);
  assert.ok(after.routes.some((r) => r.id === "gate-control-good"));

  // And the written store is VALID — the gate is not a filter that lets its own
  // output through.
  assert.deepEqual(methodStoreIssues(after), methodStoreIssues(beforeStore));

  const candidates = readCandidateStore(candidatePath);
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].lifecycle, "ADMITTED");
  assert.equal(candidates.candidates[0].admission?.effect, "LEARNED");
  assert.equal(candidates.candidates[0].admission?.methodVersionAfter, after.version);
  assert.deepEqual(candidateCounts(candidates), {
    PROPOSED: 0,
    VALIDATED: 0,
    ADMITTED: 1,
    REJECTED: 0,
  });

  rmSync(dir, { recursive: true, force: true });
});

test("re-offering an admitted route is ALREADY_KNOWN, not a second learning", () => {
  const { dir, storePath, candidatePath } = copyOfCanonical("rerun");
  runLearnBatch(storePath, [goodRoute("gate-control-rerun")], ON, {
    attemptId: "at-run-1",
    candidateStorePath: candidatePath,
  });
  const afterFirst = readFileSync(storePath, "utf8");

  const second = runLearnBatch(storePath, [goodRoute("gate-control-rerun")], ON, {
    attemptId: "at-run-2",
    candidateStorePath: candidatePath,
  });
  assert.equal(second.written, true);
  assert.equal(second.learned, 0);
  assert.equal(second.already, 1);

  const after = JSON.parse(readFileSync(storePath, "utf8")) as MethodKnowledge;
  const first = JSON.parse(afterFirst) as MethodKnowledge;
  assert.equal(after.version, first.version, "a re-run must not inflate the method version");

  const candidates = readCandidateStore(candidatePath);
  assert.equal(candidates.candidates.length, 2, "two Attempts offered it; both are recorded");
  assert.equal(candidates.candidates[1].admission?.effect, "ALREADY_KNOWN");

  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------- the gate itself */

test("writeMethodStore REFUSES a store that would introduce an issue, and writes nothing", () => {
  const { dir, storePath } = copyOfCanonical("direct");
  const before = readFileSync(storePath, "utf8");
  const k = JSON.parse(before) as MethodKnowledge;

  // Version 56 so the route enters AFTER the claim-class floor: two independent
  // rules must both fire, because a gate that catches one defect and waves the
  // next one through is a gate that has been tested against one defect.
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

  assert.throws(
    () => writeMethodStore(storePath, broken, { expectedVersion: k.version, stamp: ON }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidMethodStoreRefused, "the refusal must be a NAMED error class");
      assert.ok(error.issues.some((i) => i.rule === "over-generalized"));
      assert.ok(error.issues.some((i) => i.rule === "claim-class-required-for-new-route"));
      return true;
    },
  );
  assert.equal(readFileSync(storePath, "utf8"), before, "the store changed during a refusal");
  rmSync(dir, { recursive: true, force: true });
});

test("a NEW store is validated too — being the first write is not a reason to skip the gate", () => {
  const dir = join(ROOT, ".scratch", "method-candidate-fresh");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const storePath = join(dir, "knowledge.json");

  const seeded = admitLearnedRoutes(emptyKnowledge(), emptyCandidateStore(), [badRoute("fresh-bad")], {
    stamp: ON,
  });
  assert.equal(seeded.admitted, false);

  assert.throws(
    () => writeMethodStore(storePath, seeded.batch.knowledge, { expectedVersion: null, stamp: ON }),
    InvalidMethodStoreRefused,
  );
  assert.equal(existsSync(storePath), false, "a refused first write must leave no file behind");
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ (d) (e) (f) */

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

  // A DIFFERENT Attempt offering the same route is a different record: two
  // workers proposing the same thing is a real event and is not deduplicated
  // into one worker's submission.
  const other = proposeCandidate(replay.store, {
    attemptId: "at-other",
    proposal,
    submittedAt: ON,
    observedMethodVersion: 55,
  });
  assert.equal(other.store.candidates.length, 2);
});

test("the lifecycle counts name every state, including the zeroes, and add up", () => {
  const store = readCandidateStore(join(ROOT, "data", "method", "candidates.json"));
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
