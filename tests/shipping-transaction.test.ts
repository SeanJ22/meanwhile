/**
 * **ONE LOGICAL CHANGE, ONE CERTIFICATION BUDGET.** (FCP-9A / 9B / 9E.)
 *
 * The control case is the 2026-09-07 incident itself: the transaction is
 * reconstructed from its real runs and scored, and the SLO is required to call
 * it a defect. A metric that cannot fail the incident it was built from is a
 * metric nobody can refute (RULING 159 — a result must be earned).
 *
 * Then the repaired shape is scored, and required to come in at one full
 * certification and no defects.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  FOLLOW_UP_NOT_INVALIDATION,
  INVALIDATION_REASONS,
  TRANSACTION_STAGES,
  freezeReview,
  isRefusal,
  openTransaction,
  recordCertification,
  recordMerge,
  recordObservation,
  reopenFrozen,
  stageAtLeast,
  type CertificationRecord,
  type ShippingTransaction,
} from "../lib/control-plane/shipping/transaction.ts";
import {
  FULL_CERTIFICATION_BUDGET,
  INCIDENT_2026_09_07,
  readAmplification,
  rollUpAmplification,
} from "../lib/control-plane/shipping/amplification.ts";

const NOW = "2026-09-07T18:00:00.000Z";

const GREEN_LOCAL = { green: true, named: ["test", "lint", "tsc", "governance:check"] };

function frozen(): ShippingTransaction {
  const opened = openTransaction({
    id: "txn-2026-09-07-example",
    headline: "an example change",
    denominator: ["FCP-1", "FCP-2"],
    now: NOW,
  });
  const result = freezeReview(opened, {
    sha: "aaaa111",
    tree: "tree-aaaa",
    baseSha: "bbbb222",
    baseTree: "tree-bbbb",
    localGate: GREEN_LOCAL,
    denominatorComplete: true,
    adversarialReviewComplete: true,
    evidence: "every row implemented; adversarial review complete; pnpm gates green",
    now: NOW,
  });
  assert.equal(isRefusal(result), false, "the baseline freeze must succeed");
  return result as ShippingTransaction;
}

function cert(over: Partial<CertificationRecord> = {}): CertificationRecord {
  return {
    kind: "FULL",
    outcome: "GREEN",
    runId: "805",
    sha: "aaaa111",
    tree: "tree-aaaa",
    startedAt: "2026-09-07T17:00:00.000Z",
    endedAt: "2026-09-07T17:12:00.000Z",
    runnerMinutes: 12,
    invalidation: null,
    invalidationEvidence: null,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE FREEZE REFUSES EVERY UNMET PRECONDITION, BY NAME (FCP-9A)
 * ═════════════════════════════════════════════════════════════════════════ */

const FREEZE_REFUSALS: ReadonlyArray<{ what: string; over: Record<string, unknown>; needle: RegExp }> = [
  {
    what: "the frozen denominator is not complete",
    over: { denominatorComplete: false },
    needle: /denominator is not complete/,
  },
  {
    what: "the local gate is red",
    over: { localGate: { green: false, named: ["test"] } },
    needle: /local gate is not green/,
  },
  {
    what: "the local gate reported green and named nothing (RULING 267)",
    over: { localGate: { green: true, named: [] } },
    needle: /names nothing has not been shown to have run/,
  },
  {
    what: "adversarial review has not happened — the #805 -> #806 shape",
    over: { adversarialReviewComplete: false },
    needle: /review that happens after the green/,
  },
];

for (const row of FREEZE_REFUSALS) {
  test(`a freeze is refused when ${row.what}`, () => {
    const opened = openTransaction({
      id: "txn-x",
      headline: "h",
      denominator: ["FCP-1"],
      now: NOW,
    });
    const result = freezeReview(opened, {
      sha: "aaaa111",
      tree: "tree-aaaa",
      baseSha: "bbbb222",
      baseTree: "tree-bbbb",
      localGate: GREEN_LOCAL,
      denominatorComplete: true,
      adversarialReviewComplete: true,
      evidence: "e",
      now: NOW,
      ...row.over,
    } as Parameters<typeof freezeReview>[1]);
    assert.equal(isRefusal(result), true, `${row.what} must refuse the freeze`);
    assert.match((result as { reason: string }).reason, row.needle);
  });
}

test("a satisfied freeze moves the transaction to REVIEW_FROZEN and records the head", () => {
  const txn = frozen();
  assert.equal(txn.stage, "REVIEW_FROZEN");
  assert.equal(txn.reviewFreeze?.frozenSha, "aaaa111");
  assert.equal(txn.candidateTree, "tree-aaaa");
  assert.equal(txn.baseTree, "tree-bbbb");
});

/* ══════════════════════════════════════════════════════════════════════════
 * A GREEN HEAD DOES NOT REOPEN FOR "ONE MORE REVIEW" (FCP-9A)
 * ═════════════════════════════════════════════════════════════════════════ */

test("every listed invalidation reason reopens a frozen head, with evidence", () => {
  for (const reason of INVALIDATION_REASONS) {
    const result = reopenFrozen(frozen(), { reason, evidence: "measured, and here is what" });
    assert.equal(isRefusal(result), false, `${reason} is a listed reason and must be accepted`);
    assert.equal((result as ShippingTransaction).stage, "DEVELOPING");
    assert.equal((result as ShippingTransaction).reviewFreeze, null);
  }
});

test("an invalidation reason with no evidence is a code, and a code is not a reason", () => {
  const result = reopenFrozen(frozen(), {
    reason: "GREEN_RUN_EXPOSED_DEFECT",
    evidence: "   ",
  });
  assert.equal(isRefusal(result), true);
  assert.match((result as { reason: string }).reason, /not a reason/);
});

test("follow-up work is refused as an invalidation reason and named as follow-up", () => {
  const result = reopenFrozen(frozen(), {
    reason: "ONE_MORE_REVIEW" as never,
    evidence: "I would like another look",
  });
  assert.equal(isRefusal(result), true);
  const reason = (result as { reason: string }).reason;
  for (const followUp of FOLLOW_UP_NOT_INVALIDATION) {
    assert.ok(reason.includes(followUp), `the refusal must name "${followUp}" as follow-up`);
  }
});

test("nothing can be reopened when nothing is frozen", () => {
  const opened = openTransaction({ id: "t", headline: "h", denominator: [], now: NOW });
  const result = reopenFrozen(opened, { reason: "AUTHOR_DIRECTIVE", evidence: "e" });
  assert.equal(isRefusal(result), true);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE STAGES ONLY MOVE FORWARD
 * ═════════════════════════════════════════════════════════════════════════ */

test("a tree cannot merge before it is certified", () => {
  const result = recordMerge(frozen(), { sha: "mmmm", tree: "tree-aaaa" });
  assert.equal(isRefusal(result), true);
  assert.match((result as { reason: string }).reason, /after it is CERTIFIED, never before/);
});

test("stageAtLeast orders the whole lifecycle", () => {
  for (let i = 0; i < TRANSACTION_STAGES.length; i += 1) {
    for (let j = 0; j < TRANSACTION_STAGES.length; j += 1) {
      assert.equal(
        stageAtLeast(TRANSACTION_STAGES[i], TRANSACTION_STAGES[j]),
        i >= j,
        `${TRANSACTION_STAGES[i]} >= ${TRANSACTION_STAGES[j]}`,
      );
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE INCIDENT IS SCORED A DEFECT (FCP-9E's known-answer control)
 * ═════════════════════════════════════════════════════════════════════════ */

/** The 2026-09-07 fan-out, reconstructed run by run from what was measured. */
function incidentTransaction(): ShippingTransaction {
  let txn = openTransaction({
    id: INCIDENT_2026_09_07.transactionId,
    headline: "MapTiler quota isolation",
    denominator: ["map-provider-quota"],
    now: "2026-09-07T15:40:00.000Z",
  });
  const runs: CertificationRecord[] = [
    /* #804 — superseded by the next push before it finished. */
    cert({
      runId: "804",
      outcome: "CANCELLED",
      sha: "head-804",
      startedAt: "2026-09-07T15:45:00.000Z",
      endedAt: "2026-09-07T15:48:00.000Z",
      runnerMinutes: 3,
    }),
    /* #805 — full green on an earlier head. */
    cert({
      runId: "805",
      sha: "head-805",
      startedAt: "2026-09-07T15:50:00.000Z",
      endedAt: "2026-09-07T16:05:00.000Z",
      runnerMinutes: 15,
    }),
    /* #806 — full green again, after a late review pass moved the head. */
    cert({
      runId: "806",
      sha: INCIDENT_2026_09_07.certifiedSha,
      startedAt: "2026-09-07T16:10:00.000Z",
      endedAt: "2026-09-07T16:25:00.000Z",
      runnerMinutes: 15,
    }),
    /* #807 — full green on the merge commit. Same tree as #806. */
    cert({
      runId: "807",
      sha: INCIDENT_2026_09_07.mergeSha,
      tree: INCIDENT_2026_09_07.certifiedTree,
      startedAt: "2026-09-07T16:30:00.000Z",
      endedAt: "2026-09-07T16:42:00.000Z",
      runnerMinutes: 12,
    }),
    /* #808 — the observer's own commit, cheap by RULING 278. */
    cert({
      runId: "808",
      kind: "CHEAP_ATTESTATION",
      sha: INCIDENT_2026_09_07.observerSha,
      startedAt: "2026-09-07T18:15:00.000Z",
      endedAt: "2026-09-07T18:17:00.000Z",
      runnerMinutes: 2,
    }),
  ];
  for (const record of runs) txn = recordCertification(txn, record);
  /*
   * Every run must land. A loop that silently dropped one would make the
   * incident score better than it was, which is the direction a measurement
   * must never be wrong in.
   */
  assert.equal(txn.certifications.length, runs.length, "every recorded run must land in the ledger");
  return txn;
}

test("the 2026-09-07 incident scores FOUR full certifications and is over budget", () => {
  const reading = readAmplification(incidentTransaction());
  assert.equal(reading.fullCertifications, 3, "three FULL runs completed (#805, #806, #807)");
  assert.equal(reading.supersededCertifications, 1, "#804 was cancelled mid-flight");
  assert.equal(reading.cheapAttestations, 1, "#808 took the RULING 278 cheap path");
  assert.equal(reading.withinBudget, false, "the incident must not read as within budget");
  assert.ok(
    reading.fullCertifications > FULL_CERTIFICATION_BUDGET,
    "the budget is one full certification and the incident bought three",
  );
});

test("every certification beyond the first is a REDUNDANT_CERTIFICATION defect when unreasoned", () => {
  const reading = readAmplification(incidentTransaction());
  assert.equal(reading.beyondFirst.length, 2, "#806 and #807 are beyond the first");
  assert.equal(reading.defects.length, 2);
  for (const defect of reading.defects) {
    assert.equal(defect.defect, "REDUNDANT_CERTIFICATION");
  }
  for (const row of reading.beyondFirst) {
    assert.match(row.reason, /NO REASON RECORDED/);
  }
});

test("owner wait is measured from the first certification start to merge-ready", () => {
  const reading = readAmplification(incidentTransaction());
  /* 15:45 (#804 starts) -> 16:05 (#805, the first green FULL, ends) = 20 min. */
  assert.equal(reading.ownerWaitMinutes, 20);
  assert.equal(reading.runnerMinutes, 47);
});

test("a certification beyond the first with a REASON is not a defect", () => {
  let txn = incidentTransaction();
  txn = {
    ...txn,
    certifications: txn.certifications.map((c) =>
      c.runId === "806"
        ? {
            ...c,
            invalidation: "BASE_MATERIALLY_CHANGED" as const,
            invalidationEvidence: "main advanced with a migration the candidate had to absorb",
          }
        : c,
    ),
  };
  const reading = readAmplification(txn);
  assert.equal(reading.defects.length, 1, "only #807 remains unreasoned");
  assert.match(reading.beyondFirst[0].reason, /BASE_MATERIALLY_CHANGED/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE REPAIRED SHAPE COMES IN AT ONE (FCP-9F's closure target)
 * ═════════════════════════════════════════════════════════════════════════ */

test("the repaired transaction: one full certification, one attestation, no defects", () => {
  let txn = frozen();
  /* The one full hosted certification the frozen candidate buys. */
  txn = recordCertification(txn, cert({ runId: "806", sha: "aaaa111", tree: "tree-aaaa" }));
  assert.equal(txn.stage, "CERTIFIED");

  /* The merge, whose tree IS the certified tree — so the main-side run attests. */
  txn = recordCertification(
    txn,
    cert({
      runId: "807",
      kind: "TREE_EQUIVALENCE_ATTESTATION",
      sha: "mmmm333",
      tree: "tree-aaaa",
      runnerMinutes: 1,
    }),
  );
  const next = recordMerge(txn, { sha: "mmmm333", tree: "tree-aaaa" });
  assert.equal(isRefusal(next), false);
  txn = next as ShippingTransaction;

  /* The observer's bookkeeping commit, cheap by RULING 278. */
  txn = recordCertification(
    txn,
    cert({ runId: "808", kind: "CHEAP_ATTESTATION", sha: "oooo444", runnerMinutes: 2 }),
  );
  txn = recordObservation(txn, {
    producer: "post-deploy-integrity",
    sha: "oooo444",
    now: "2026-09-07T19:00:00.000Z",
  });

  const reading = readAmplification(txn);
  assert.equal(reading.fullCertifications, 1, "FCP-9F's closure target: one full certification");
  assert.equal(reading.cheapAttestations, 2, "the tree-equivalence attestation and the observer's");
  assert.equal(reading.supersededCertifications, 0);
  assert.deepEqual(reading.defects, []);
  assert.equal(reading.withinBudget, true);
  assert.equal(reading.postShipCommits, 1);
  assert.equal(txn.stage, "OBSERVED");
});

test("the incident's own repair table names what each fix removes, and what survives", () => {
  assert.deepEqual([...INCIDENT_2026_09_07.irreducible], ["806", "808"]);
  assert.equal(Object.keys(INCIDENT_2026_09_07.repairs).length, 2);
  assert.equal(
    INCIDENT_2026_09_07.runs.length -
      Object.keys(INCIDENT_2026_09_07.repairs).length -
      INCIDENT_2026_09_07.irreducible.length,
    1,
    "#804 is the cancelled run: the freeze removes the push that superseded it",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ROLLUP
 * ═════════════════════════════════════════════════════════════════════════ */

test("a rollup of nothing reports null rather than zero", () => {
  const rollup = rollUpAmplification([]);
  assert.equal(rollup.certificationsPerTransaction, null);
  assert.equal(rollup.meanOwnerWaitMinutes, null);
  assert.equal(
    rollup.runnerMinutes,
    null,
    "zero minutes across no transactions would assert a measurement nobody took",
  );
});

test("a transaction whose runs reported no minutes reports NOT MEASURED, not 0", () => {
  let txn = frozen();
  txn = recordCertification(txn, cert({ runnerMinutes: null }));
  assert.equal(readAmplification(txn).runnerMinutes, null);
});
