/**
 * **THE SEEDED FAILURES FOR THE UNIVERSE CHECK AND THE DIAGNOSTIC LIFECYCLE.**
 * (A.1 WI2 and WI3, 2026-08-30.)
 *
 * Two audit findings are pinned here:
 *
 * 1. The universe checker existed and was never invoked, and its only
 *    body-layer denominator was the registry the instances are generated
 *    from — a mirror that agrees over any universe, including a wrong one.
 * 2. RED produced no obligation, and the helper that would have produced one
 *    wrote its completion condition into prose and attached the DEFAULT
 *    contract — so the item could be closed by a validator that never asked
 *    the question again.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateCompletion } from "../lib/control-plane/completion.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { DEFAULT_CONTRACT } from "../lib/control-plane/work-item.ts";
import {
  closeSatisfiedDiagnostics,
  persistDiagnostics,
  readerDiagnostic,
} from "../lib/health/diagnostics.ts";
import {
  assertDenominatorIsIndependent,
  checkInstanceUniverse,
  type EnumerationDenominator,
  type ReaderQuestionInstance,
} from "../lib/health/reader-question.ts";

const NOW = "2026-08-30T12:00:00.000Z";
const SHA_FAILED = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_FIXED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function instance(over: Partial<ReaderQuestionInstance> = {}): ReaderQuestionInstance {
  return {
    id: "rq:0123456789abcdef",
    templateId: "Q1",
    /*
     * **GENERATED_FROM_REGISTRY, and the default was wrong.**
     * (Session B resume, W4, 2026-08-31.)
     *
     * This factory stamped `HAND_AUTHORED_ADVERSARIAL` while the test below
     * describes its own instances as "what the registry produced". The
     * mislabel was invisible for as long as `checkInstanceUniverse` ignored
     * the class — it compared every instance in the ZIP against the body
     * denominator regardless of which class had promised one-per-body.
     *
     * Now that the check is scoped to the class whose contract that IS, the
     * fixture has to say what it means. The coverage tests below are about the
     * NH232 shape — a REGENERATION silently dropping bodies — which is a
     * property of the generated class and of nothing else.
     */
    questionClass: "GENERATED_FROM_REGISTRY",
    zip: "85701",
    subjectBodyId: "wtp-body/pima#governing",
    questionText: "What actions did the board take at its study session?",
    window: { notBefore: null, notAfter: null },
    status: { state: "ACTIVE" },
    ...over,
  };
}

/* ====================================================================== *
 * WI2 — THE UNIVERSE CHECK
 * ====================================================================== */

test("SEEDED: removing a body from the registry while the evidence still enumerates it is a coverage defect, not a smaller corpus", () => {
  /*
   * The instances are what the registry produced. The denominator is what the
   * ENUMERATION EVIDENCE holds. The registry has dropped one body — the NH232
   * failure shape exactly — and a mirror denominator would agree with the
   * smaller corpus and report nothing.
   */
  const generated = [
    instance({ id: "rq:a", subjectBodyId: "body/one" }),
    instance({ id: "rq:b", subjectBodyId: "body/two" }),
  ];
  const evidenceDenominator: EnumerationDenominator = {
    zip: "85701",
    layer: "GOVERNING_BODY",
    source: "PROJECT_BODY_ENUMERATION_EVIDENCE",
    memberIds: ["body/one", "body/two", "body/three"],
  };

  const defect = checkInstanceUniverse(generated, evidenceDenominator);
  assert.notEqual(defect, null, "a body enumerated by the evidence with no instance is a defect");
  assert.deepEqual(defect?.missingSubjects, ["body/three"]);
  assert.match(defect?.detail ?? "", /disagree/);
});

test("SEEDED: a PROJECT_REGISTRY denominator is refused for the body layer — registry checking registry is a mirror", () => {
  const mirror: EnumerationDenominator = {
    zip: "85701",
    layer: "GOVERNING_BODY",
    source: "PROJECT_REGISTRY",
    memberIds: ["body/one"],
  };
  assert.throws(() => assertDenominatorIsIndependent(mirror), /mirror/);
});

test("the evidence-sourced denominator IS permitted for the body layer (RULING 9 is about source class)", () => {
  const evidence: EnumerationDenominator = {
    zip: "85701",
    layer: "GOVERNING_BODY",
    source: "PROJECT_BODY_ENUMERATION_EVIDENCE",
    memberIds: [],
  };
  assert.doesNotThrow(() => assertDenominatorIsIndependent(evidence));
  /* And Census still may not, which is the rule that was already right. */
  assert.throws(
    () =>
      checkInstanceUniverse([], {
        zip: "85701",
        layer: "GOVERNING_BODY",
        source: "CENSUS_TIGER",
        memberIds: [],
      }),
    /RULING 9/,
  );
});

/* ====================================================================== *
 * WI3 — THE DIAGNOSTIC LIFECYCLE
 * ====================================================================== */

test("SEEDED: a diagnostic WorkItem whose contract is DEFAULT_CONTRACT fails", () => {
  const item = readerDiagnostic(instance(), "rendering", "empty panel", SHA_FAILED, NOW);
  assert.notDeepEqual(
    item.contract,
    DEFAULT_CONTRACT,
    "a reader diagnostic carrying the default contract has no reader obligation in it at all",
  );
  assert.notEqual(item.contract.instrumentEvidence, null);
  assert.equal(item.contract.instrumentEvidence?.instanceId, "rq:0123456789abcdef");
  assert.equal(item.contract.instrumentEvidence?.createdAtSha, SHA_FAILED);
  assert.equal(item.contract.instrumentEvidence?.requiredVerdict, "GREEN");
});

test("SEEDED: a WorkItem cannot close without a qualifying GREEN run", () => {
  const item = readerDiagnostic(instance(), "acquisition", "no records", SHA_FAILED, NOW);
  const snapshot = {
    item,
    routeTasks: [],
    validations: [],
    audits: [],
    contradictions: [],
    upstreamStates: new Map(),
    denominatorComplete: null,
    /* Nothing green. This is what a session claiming "fixed" looks like. */
    instrumentGreens: new Set<string>(),
    now: NOW,
  };
  const verdict = evaluateCompletion(snapshot, "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, false);
  assert.ok(
    verdict.refusals.some((r) => r.code === "INSTRUMENT_VERDICT_NOT_EARNED"),
    "the refusal must name the unearned instrument verdict",
  );
});

test("SEEDED: an UNANCHORED contract (no SHA) refuses completion rather than closing on any green", () => {
  const item = readerDiagnostic(instance(), "acquisition", "no records", null, NOW);
  const verdict = evaluateCompletion(
    {
      item,
      routeTasks: [],
      validations: [],
      audits: [],
      contradictions: [],
      upstreamStates: new Map(),
      denominatorComplete: null,
      instrumentGreens: new Set(["rq:0123456789abcdef"]),
      now: NOW,
    },
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, false);
  assert.ok(verdict.refusals.some((r) => r.code === "INSTRUMENT_EVIDENCE_UNANCHORED"));
});

test("a qualifying GREEN on that exact instance DOES close it", () => {
  const item = readerDiagnostic(instance(), "acquisition", "no records", SHA_FAILED, NOW);
  const verdict = evaluateCompletion(
    {
      item,
      routeTasks: [],
      validations: [],
      audits: [],
      contradictions: [],
      upstreamStates: new Map(),
      denominatorComplete: null,
      instrumentGreens: new Set(["rq:0123456789abcdef"]),
      now: NOW,
    },
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, true, verdict.refusals.map((r) => r.code).join(", "));
});

test("a green on a DIFFERENT instance does not close this one", () => {
  const item = readerDiagnostic(instance(), "acquisition", "no records", SHA_FAILED, NOW);
  const verdict = evaluateCompletion(
    {
      item,
      routeTasks: [],
      validations: [],
      audits: [],
      contradictions: [],
      upstreamStates: new Map(),
      denominatorComplete: null,
      /* A sibling question turned green. That says nothing about this one. */
      instrumentGreens: new Set(["rq:some-other-question"]),
      now: NOW,
    },
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, false);
});

/* ---------------------------------------------------- persistence --- */

test("SEEDED: a RED persists exactly one WorkItem, and a second run does not duplicate it", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-diagnostics-"));
  try {
    const repos = await createFileRepositories(root);
    const item = readerDiagnostic(instance(), "acquisition", "no records", SHA_FAILED, NOW);

    const first = await persistDiagnostics(repos, [item], NOW);
    assert.deepEqual(first.created, [item.id]);
    assert.deepEqual(first.existing, []);

    /* The SAME red on a later run. The obligation has not changed, so the id
       has not changed, so nothing new is created. */
    const again = readerDiagnostic(
      instance(),
      "acquisition",
      "no records — observed again on a later run with different wording",
      SHA_FIXED,
      "2026-08-31T00:00:00.000Z",
    );
    const second = await persistDiagnostics(repos, [again], "2026-08-31T00:00:00.000Z");
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.existing, [item.id]);

    assert.equal((await repos.workItems.list()).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the closer closes only on a run whose tree CONTAINS the failure commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-close-"));
  try {
    const repos = await createFileRepositories(root);
    const item = readerDiagnostic(instance(), "acquisition", "no records", SHA_FAILED, NOW);
    await persistDiagnostics(repos, [item], NOW);

    /* An UNRELATED tree: the green is real and it is about other code. */
    const unrelated = await closeSatisfiedDiagnostics(
      repos,
      {
        instrument: "READER_SUITE",
        testedSha: SHA_FIXED,
        greenInstanceIds: ["rq:0123456789abcdef"],
      },
      () => false,
      NOW,
    );
    assert.deepEqual(unrelated.closed, []);
    assert.equal(unrelated.refused.length, 1);

    /* A tree that contains the failure commit. Now it closes. */
    const descendant = await closeSatisfiedDiagnostics(
      repos,
      {
        instrument: "READER_SUITE",
        testedSha: SHA_FIXED,
        greenInstanceIds: ["rq:0123456789abcdef"],
      },
      (ancestor, head) => ancestor === SHA_FAILED && head === SHA_FIXED,
      NOW,
    );
    assert.deepEqual(descendant.closed, [item.id]);

    const stored = await repos.workItems.mustRead(item.id);
    assert.equal(stored.value.state, "VERIFIED_COMPLETE");
    assert.match(
      stored.value.transitions.at(-1)?.why ?? "",
      /evaluated rq:0123456789abcdef GREEN/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a VISUAL_SUITE run does not close a READER_SUITE diagnostic", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-cross-"));
  try {
    const repos = await createFileRepositories(root);
    const item = readerDiagnostic(instance(), "rendering", "empty panel", SHA_FAILED, NOW);
    await persistDiagnostics(repos, [item], NOW);

    const visual = await closeSatisfiedDiagnostics(
      repos,
      {
        instrument: "VISUAL_SUITE",
        testedSha: SHA_FIXED,
        greenInstanceIds: ["rq:0123456789abcdef"],
      },
      () => true,
      NOW,
    );
    assert.deepEqual(visual.closed, [], "one instrument may not certify another's obligation");
    assert.equal((await repos.workItems.mustRead(item.id)).value.state, "OPEN");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
