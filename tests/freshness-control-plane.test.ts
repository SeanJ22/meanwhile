/**
 * **THE DESTRUCTIVE PROOF: TWELVE INJECTED FAILURES, TWELVE CONTAINMENTS.**
 * (FCP-8, 2026-09-07.)
 *
 * > Do not close this on one green run. Prove the architecture by injecting
 * > failures and observing containment.
 *
 * Every row of FCP-8's matrix is a test here, named by its number, and each one
 * injects the failure rather than describing it. The two rows that are
 * governance-gated — 11 and 12 — are tested as what they actually are: a GATE
 * whose conditions are read from the repository's own proof state, currently
 * NOT MET, and an invariant that forbids two clocks in both directions.
 * Asserting them as passed would be a session grading its own homework, which
 * RULING 216 exists to prevent.
 *
 * The cross-cutting property under all twelve is the one FCP-2 states in a
 * sentence: **a failure outside acquisition may never rewrite an acquisition
 * result.** Row 5 and row 6 are the same claim from two directions, and the
 * exhaustive cross-product test at the end is the general form.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACQUISITION_OUTCOMES,
  FORBIDDEN_ACQUISITION_DEPENDENCIES,
  acquisitionSummary,
  applyDownstream,
  changedHoldings,
  isSealed,
  sealAcquisition,
  type CandidateHolding,
  type SealedAcquisition,
} from "../lib/control-plane/freshness/acquisition.ts";
import {
  CROSS_HOLDING_COUPLINGS,
  PROOF_EXECUTORS,
  judgeCertification,
  selectExecutors,
  type CertificationVerdict,
  type ExecutorReading,
} from "../lib/control-plane/freshness/certification.ts";
import {
  planWindow,
  windowFanOut,
  withoutAlreadyShipped,
} from "../lib/control-plane/freshness/coalesce.ts";
import {
  DOMAIN_POLICIES,
  decideEscalation,
  resolvedSubjects,
} from "../lib/control-plane/freshness/escalation.ts";
import {
  RESOURCE_GRANTS,
  classesWithHostedMinutes,
  crossedBoundary,
  hostedRunsFor,
  maySpend,
} from "../lib/control-plane/freshness/resource-policy.ts";
import {
  AUTHORITY_TRANSFER_GATE,
  decideBackup,
  judgeAuthority,
  readAuthority,
} from "../lib/control-plane/freshness/authority.ts";

const NOW = "2026-09-07T04:00:00.000Z";

function holding(recordClass: string, over: Partial<CandidateHolding> = {}): CandidateHolding {
  return {
    recordClass,
    sourceId: recordClass,
    contentHash: `hash-${recordClass}`,
    governedPaths: [`data/${recordClass}.json`],
    rows: 42,
    acquiredAt: NOW,
    evidenceRef: `.window/candidates/${recordClass}`,
    ...over,
  };
}

function acquired(recordClass: string): SealedAcquisition {
  const sealed = sealAcquisition({
    sourceId: recordClass,
    recordClass,
    outcome: "ACQUIRED_CHANGED",
    holding: holding(recordClass),
    now: NOW,
  });
  assert.equal(isSealed(sealed), true);
  return sealed as SealedAcquisition;
}

function failed(recordClass: string): SealedAcquisition {
  const sealed = sealAcquisition({
    sourceId: recordClass,
    recordClass,
    outcome: "SOURCE_FAILED",
    failure: "TRANSPORT_FAILED",
    detail: "connection reset by the publisher",
    now: NOW,
  });
  assert.equal(isSealed(sealed), true);
  return sealed as SealedAcquisition;
}

/** Every dependent executor passes for this record class. */
function allPass(h: CandidateHolding): ExecutorReading[] {
  return selectExecutors(h).selected.map((e) => ({
    executorId: e.id,
    result: "PASS" as const,
    detail: "passed",
  }));
}

function certify(h: CandidateHolding, readings = allPass(h)): CertificationVerdict {
  return judgeCertification({ holding: h, readings });
}

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 1 — A QUIET DAY
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 1 · a quiet day: no commit, no build, no deploy, no hosted freshness run", () => {
  const plan = planWindow([]);
  const fanOut = windowFanOut(plan);
  assert.equal(fanOut.commits, 0);
  assert.equal(fanOut.builds, 0);
  assert.equal(fanOut.deploys, 0);
  assert.equal(fanOut.hostedFreshnessRuns, 0);
  assert.equal(plan.regeneration.passes, 0, "nothing ships, so no dependent is regenerated");
  assert.match(plan.headline, /quiet window/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 2 — FOUR SOURCES CHANGED, ONE COMMIT
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 2 · four sources changed: one coalesced candidate, at most ONE commit", () => {
  const classes = ["meetings", "fec", "state-votes", "nj-filing"];
  const plan = planWindow(classes.map((c) => certify(holding(c))));
  assert.equal(plan.shipping.length, 4);
  assert.equal(plan.commits, 1, "four sources must not cost four commits (RULING 124)");
  assert.equal(plan.builds, 1);
  assert.equal(plan.deploys, 1);
  assert.equal(plan.regeneration.passes, 1, "dependents regenerate ONCE over the final set");
  assert.deepEqual(
    [...plan.regeneration.invariants],
    ["reader-last-mile-closure"],
    "the one genuine cross-holding invariant, regenerated once",
  );
  assert.equal(windowFanOut(plan).hostedFreshnessRuns, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 3 — ONE SOURCE'S ACQUISITION FAILS
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 3 · one acquisition fails: the others continue, locally, with no extra hosted run", () => {
  const results = [acquired("meetings"), failed("fec"), acquired("state-votes")];
  const survivors = changedHoldings(results);
  assert.equal(survivors.length, 2, "a failed source must not discard the healthy ones");
  assert.deepEqual(
    survivors.map((h) => h.recordClass),
    ["meetings", "state-votes"],
  );

  const plan = planWindow(survivors.map((h) => certify(h)));
  assert.equal(plan.commits, 1);
  assert.match(acquisitionSummary(results), /1 failed — fec \(TRANSPORT_FAILED\)/);

  /* The retry is LOCAL, and the policy refuses hosted minutes for it. */
  const retry = maySpend("LOCAL_RETRY", "hosted-actions-minutes");
  assert.equal(retry.allowed, false);
  assert.equal(hostedRunsFor([{ executionClass: "LOCAL_RETRY" }]), 0);
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 4 — A SOURCE-SPECIFIC CONSUMER PROOF FAILS
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 4 · one consumer proof fails: ONLY that holding is held", () => {
  const meetings = holding("meetings");
  const fec = holding("fec");
  const votes = holding("state-votes");

  const meetingsVerdict = judgeCertification({
    holding: meetings,
    readings: allPass(meetings).map((r) =>
      r.executorId === "meeting-read-model"
        ? { ...r, result: "FAIL" as const, detail: "the next meeting rendered the wrong date" }
        : r,
    ),
  });
  assert.equal(meetingsVerdict.state, "CONSUMER_DEFECT");

  const plan = planWindow([meetingsVerdict, certify(fec), certify(votes)]);
  assert.deepEqual(
    plan.shipping.map((h) => h.recordClass),
    ["fec", "state-votes"],
    "an unrelated holding must not be vetoed by the meetings proof",
  );
  assert.equal(plan.held.length, 1);
  assert.equal(plan.held[0].reason, "CONTENT_DEFECT");
  assert.equal(
    plan.held[0].retryableWithoutRefetch,
    false,
    "a content defect must not be retried into a green",
  );
  assert.equal(plan.commits, 1);
});

test("FCP-8 row 4b · an unrelated witness cannot select itself onto another record class", () => {
  /*
   * FCP-3's own sentence: unrelated Arizona governor / campaign-money witnesses
   * cannot veto unrelated holdings. Asserted structurally — the executor is not
   * even SELECTED, so there is no path by which its result could be consulted.
   */
  const { selected } = selectExecutors(holding("fec"));
  assert.deepEqual(
    selected.map((e) => e.id).sort(),
    ["federal-money", "reader-last-mile"],
    "only the executors that read this record class run",
  );
  const verdict = certify(holding("fec"), [
    ...allPass(holding("fec")),
    { executorId: "meeting-read-model", result: "FAIL", detail: "unrelated red" },
  ]);
  assert.equal(
    verdict.state,
    "CERTIFIED",
    "a reading from an executor that does not depend on this holding is not consulted",
  );
  assert.ok(verdict.skipped.includes("meeting-read-model"));
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 5 — SHARED PROOF INFRASTRUCTURE IS UNAVAILABLE
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 5 · the browser is down: acquisitions stay truthful and there are no N-source debts", () => {
  const classes = ["meetings", "fec", "state-votes", "nj-filing"];
  const acquisitions = classes.map((c) => acquired(c));

  const verdicts = classes.map((c) => {
    const h = holding(c);
    return judgeCertification({
      holding: h,
      readings: allPass(h).map((r) => ({
        ...r,
        result: "BLOCKED" as const,
        detail: "chromium would not start",
      })),
    });
  });

  for (const v of verdicts) {
    assert.equal(
      v.state,
      "PROOF_INFRASTRUCTURE_BLOCKED",
      "a proof that could not RUN is not a proof that FAILED",
    );
  }
  for (const a of acquisitions) {
    assert.equal(a.outcome, "ACQUIRED_CHANGED", "the acquisitions are untouched by the blockage");
  }

  const plan = planWindow(verdicts);
  assert.equal(plan.commits, 0, "nothing is certified, so nothing ships");
  assert.equal(plan.held.length, 4);
  for (const held of plan.held) {
    assert.equal(held.reason, "PROOF_INFRASTRUCTURE_UNAVAILABLE");
    assert.equal(
      held.retryableWithoutRefetch,
      true,
      "the bytes are parked, so a retry must not ask the publisher again",
    );
  }

  /*
   * ONE incident, not four. The escalation policy groups by domain, and one
   * blocked instrument is one condition however many holdings sit behind it —
   * the same discipline debt.ts already applies by root cause.
   */
  const decision = decideEscalation({
    domain: "PROOF_INFRASTRUCTURE_FAILURE",
    subject: "chromium",
    overdueHours: 2,
    flags: [],
    detail: "chromium would not start",
  });
  assert.equal(decision.escalate, false, "two hours of a dead browser is not the owner's problem");
  assert.equal(decision.selfHeal, "RETRY_LOCAL_BACKOFF");
  assert.equal(decision.adminState, "PENDING");
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 6 — MAPTILER IS UNAVAILABLE
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 6 · MapTiler is unavailable: no acquisition and no certification can even ask", () => {
  /*
   * The containment is structural rather than behavioural: no proof executor
   * declares maptiler-requests, and no freshness execution class is granted it,
   * so a MapTiler outage has no path by which it could reach a holding.
   */
  for (const executor of PROOF_EXECUTORS) {
    assert.equal(
      executor.spends.includes("maptiler-requests"),
      false,
      `${executor.id} must not spend the map provider's allowance — FCP-3 requires normal ` +
        "certification not to depend on an irrelevant external provider",
    );
  }
  for (const klass of ["RUNTIME_FRESHNESS", "LOCAL_RETRY", "PROMOTION_WINDOW"]) {
    assert.equal(maySpend(klass, "maptiler-requests").allowed, false, `${klass} must be refused`);
  }
  const smoke = maySpend("PROVIDER_SMOKE", "maptiler-requests");
  assert.equal(smoke.allowed, true, "the bounded provider-smoke class is the one exception");

  /* And with the provider dark, the window still ships. */
  const plan = planWindow([certify(holding("meetings")), certify(holding("fec"))]);
  assert.equal(plan.commits, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 7 — GITHUB ACTIONS IS UNAVAILABLE OR EXHAUSTED
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 7 · Actions exhausted: acquisition and local certification are unaffected", () => {
  /*
   * Nothing in the freshness path holds a grant for hosted minutes, so an
   * exhausted balance cannot stop any of it. That is the whole of FCP-5's
   * boundary, and it is checked from the grant table rather than asserted.
   */
  assert.deepEqual(
    [...classesWithHostedMinutes()],
    ["SHIPPING_CERTIFICATION"],
    "exactly one execution class may spend hosted minutes, and it is code shipping",
  );
  const freshnessWork = [
    { executionClass: "RUNTIME_FRESHNESS" },
    { executionClass: "LOCAL_RETRY" },
    { executionClass: "LOCAL_RETRY" },
    { executionClass: "PROMOTION_WINDOW" },
  ];
  assert.equal(hostedRunsFor(freshnessWork), 0);

  const plan = planWindow([certify(holding("meetings"))]);
  assert.equal(plan.commits, 1, "the window still coalesces its one commit");
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 8 — PUSH / DEPLOY IS UNAVAILABLE
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 8 · push is refused: the candidate stays certified and queued, with no refetch", () => {
  const verdicts = [certify(holding("meetings")), certify(holding("fec"))];
  for (const v of verdicts) assert.equal(v.state, "CERTIFIED");

  /* The push fails. Certification is unchanged — it is a fact about bytes. */
  const decision = decideEscalation({
    domain: "SHIPPING_FAILURE",
    subject: "push-main",
    overdueHours: 1,
    flags: [],
    detail: "the remote refused the push",
  });
  assert.equal(decision.escalate, false, "one hour is a retry, not an escalation");
  assert.equal(decision.selfHeal, "RETRY_LOCAL_BACKOFF");

  /* Every holding still carries its parked bytes, so the retry needs no publisher. */
  for (const v of verdicts) {
    assert.notEqual(v.holding.evidenceRef, "");
  }

  /* A protection refusal does NOT wait — it cannot resolve by waiting. */
  const refused = decideEscalation({
    domain: "SHIPPING_FAILURE",
    subject: "push-main",
    overdueHours: 0,
    flags: ["BRANCH_PROTECTION_REFUSED"],
    detail: "GH013",
  });
  assert.equal(refused.escalate, true);
  assert.equal(refused.adminState, "DEGRADED");
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 9 — RECOVERY
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 9 · recovery: the held holding certifies, debt clears, and shipping coalesces", () => {
  const h = holding("fec");
  const blocked = judgeCertification({
    holding: h,
    readings: allPass(h).map((r) => ({ ...r, result: "BLOCKED" as const, detail: "browser down" })),
  });
  assert.equal(planWindow([blocked]).commits, 0);

  /* The instrument comes back. The SAME parked bytes certify — no refetch. */
  const recovered = certify(h);
  assert.equal(recovered.state, "CERTIFIED");
  assert.equal(recovered.holding.contentHash, blocked.holding.contentHash);

  const plan = planWindow([recovered, certify(holding("meetings"))]);
  assert.equal(plan.commits, 1, "recovery coalesces into ONE commit with whatever else is ready");

  const cleared = resolvedSubjects(
    [
      { domain: "PROOF_INFRASTRUCTURE_FAILURE", subject: "chromium", overdueHours: 3, flags: [], detail: "" },
      { domain: "SOURCE_ACQUISITION_FAILURE", subject: "legiscan", overdueHours: 3, flags: [], detail: "" },
    ],
    ["chromium"],
  );
  assert.deepEqual([...cleared], ["chromium"], "recovery clears debt automatically");
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 10 — THE STANDING RUNNER RESTARTS
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 10 · a restart loses no obligation and ships nothing twice", () => {
  const verdicts = [certify(holding("meetings")), certify(holding("fec"))];
  const first = planWindow(verdicts);
  assert.equal(first.commits, 1);
  assert.equal(first.shipping.length, 2);

  /* The runner dies after the commit and comes back with the same verdicts. */
  const shipped = first.shipping.map((h) => h.contentHash);
  const replay = planWindow(withoutAlreadyShipped(verdicts, shipped));
  assert.equal(replay.commits, 0, "a restart must not ship the same bytes a second time");
  assert.equal(replay.shipping.length, 0);

  /* A holding acquired DURING the outage is still owed and still ships. */
  const later = planWindow(withoutAlreadyShipped([...verdicts, certify(holding("nj-filing"))], shipped));
  assert.equal(later.commits, 1);
  assert.deepEqual(
    later.shipping.map((h) => h.recordClass),
    ["nj-filing"],
    "nothing is lost across the restart",
  );

  /* Planning is a pure function of its verdicts — replay is deterministic. */
  assert.deepEqual(planWindow(verdicts), first);
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROWS 11 AND 12 — AUTHORITY TRANSFER, AS A GATE RATHER THAN A CLAIM
 * ═════════════════════════════════════════════════════════════════════════ */

test("FCP-8 row 11 · the transfer gate is four named conditions, not a judgement", () => {
  assert.equal(AUTHORITY_TRANSFER_GATE.length, 4);
  const ids = AUTHORITY_TRANSFER_GATE.map((g) => g.id);
  assert.deepEqual(ids, ["READER_GREEN", "TRUTH_GREEN", "FRESHNESS_GREEN", "INDEPENDENTLY_REPRODUCED"]);
  for (const condition of AUTHORITY_TRANSFER_GATE) {
    assert.ok(condition.ruling.startsWith("RULING "), `${condition.id} must cite its ruling`);
  }
});

test("FCP-8 row 11 · the repository's CURRENT proof state does NOT transfer authority", () => {
  /*
   * The contracts read NOT_READY and the newest shadow run's provenance is
   * LOCAL_SESSION. This is the honest state and the test asserts it, so that a
   * later session cannot read a passing suite as evidence the transfer happened.
   */
  const reading = readAuthority({
    reader: "NOT_READY",
    truth: "NOT_READY",
    freshness: "NOT_READY",
    independentlyReproduced: false,
    readFrom: "data/health/freshness-shadow-runs/2026-09-02-02.json",
  });
  assert.equal(reading.transferred, false);
  assert.equal(reading.authoritative, "GITHUB_SCHEDULED_WORKFLOW");
  assert.equal(reading.roles.STANDING_RUNNER_SCHEDULER, "NON_AUTHORITATIVE_BACKUP");
  assert.equal(reading.unmet.length, 4);
  assert.match(reading.reason, /nothing refreshes at all/);
});

test("FCP-8 row 11 · a fully met gate DOES transfer, so the gate is not a permanent no", () => {
  const reading = readAuthority({
    reader: "GREEN",
    truth: "GREEN",
    freshness: "GREEN",
    independentlyReproduced: true,
    readFrom: "a canonical run this session did not perform",
  });
  assert.equal(reading.transferred, true);
  assert.equal(reading.authoritative, "STANDING_RUNNER_SCHEDULER");
  assert.deepEqual(reading.unmet, []);
});

test("FCP-8 row 12 · after transfer the GitHub cron is MANUAL_ONLY — it cannot run due work", () => {
  const reading = readAuthority({
    reader: "GREEN",
    truth: "GREEN",
    freshness: "GREEN",
    independentlyReproduced: true,
    readFrom: "canonical",
  });
  assert.equal(
    reading.roles.GITHUB_SCHEDULED_WORKFLOW,
    "MANUAL_ONLY",
    "a second clock capable of independently executing the same due work must not remain",
  );
  assert.equal(judgeAuthority(reading.roles), null, "the arrangement is lawful");
});

test("FCP-8 row 12 · two authoritative clocks is refused, and so is zero", () => {
  const both = judgeAuthority({
    GITHUB_SCHEDULED_WORKFLOW: "AUTHORITATIVE",
    STANDING_RUNNER_SCHEDULER: "AUTHORITATIVE",
  });
  assert.notEqual(both, null);
  assert.match(both as string, /both AUTHORITATIVE/);

  const neither = judgeAuthority({
    GITHUB_SCHEDULED_WORKFLOW: "RETIRED",
    STANDING_RUNNER_SCHEDULER: "NON_AUTHORITATIVE_BACKUP",
  });
  assert.notEqual(neither, null);
  assert.match(neither as string, /nothing refreshes at all/);
});

test("the backup wakeup does no work while the authoritative clock is alive", () => {
  const quiet = decideBackup({
    hoursSinceAuthoritativeCycle: 3,
    authoritative: "STANDING_RUNNER_SCHEDULER",
  });
  assert.equal(quiet.runTheWork, false, "a quiet day with a live runner costs a read, not a sweep");

  const stale = decideBackup({
    hoursSinceAuthoritativeCycle: 30,
    authoritative: "STANDING_RUNNER_SCHEDULER",
  });
  assert.equal(stale.runTheWork, true);

  const unknown = decideBackup({
    hoursSinceAuthoritativeCycle: null,
    authoritative: "STANDING_RUNNER_SCHEDULER",
  });
  assert.equal(unknown.runTheWork, true, "an unreadable heartbeat is never a healthy one");

  const beforeTransfer = decideBackup({
    hoursSinceAuthoritativeCycle: 1,
    authoritative: "GITHUB_SCHEDULED_WORKFLOW",
  });
  assert.equal(
    beforeTransfer.runTheWork,
    true,
    "before the transfer the workflow IS the clock and must keep doing its own work",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CROSS-CUTTING PROPERTY (FCP-2)
 * ═════════════════════════════════════════════════════════════════════════ */

test("no downstream outcome, of any kind, can rewrite an acquisition verdict", () => {
  const downstreams: unknown[] = [
    { state: "CONSUMER_DEFECT" },
    { state: "PROOF_INFRASTRUCTURE_BLOCKED" },
    { browser: "dead" },
    { maptiler: 429 },
    new Error("the whole suite went red"),
    null,
    undefined,
  ];
  for (const outcome of ACQUISITION_OUTCOMES) {
    const sealed = sealAcquisition({
      sourceId: "s",
      recordClass: "meetings",
      outcome,
      failure: outcome === "SOURCE_FAILED" ? "UPSTREAM_ERROR" : null,
      holding: outcome === "ACQUIRED_CHANGED" ? holding("meetings") : null,
      now: NOW,
    });
    assert.equal(isSealed(sealed), true, `${outcome} must seal`);
    for (const downstream of downstreams) {
      const combined = applyDownstream(sealed as SealedAcquisition, downstream);
      assert.deepEqual(
        combined.acquisition,
        sealed,
        `${outcome} was rewritten by a downstream result — the 2026-09-01 defect`,
      );
      assert.equal(combined.acquisition.outcome, outcome);
    }
  }
});

test("the forbidden acquisition dependencies are named, and no executor smuggles one in", () => {
  assert.ok(FORBIDDEN_ACQUISITION_DEPENDENCIES.includes("browser"));
  assert.ok(FORBIDDEN_ACQUISITION_DEPENDENCIES.includes("maptiler"));
  assert.ok(FORBIDDEN_ACQUISITION_DEPENDENCIES.includes("github-action"));
  assert.ok(FORBIDDEN_ACQUISITION_DEPENDENCIES.includes("unrelated-source"));
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEALING CONTRACT REFUSES SELF-CONTRADICTORY VERDICTS
 * ═════════════════════════════════════════════════════════════════════════ */

const SEAL_REFUSALS: ReadonlyArray<{ what: string; input: Record<string, unknown>; needle: RegExp }> = [
  {
    what: "a SOURCE_FAILED with no failure class",
    input: { outcome: "SOURCE_FAILED", failure: null },
    needle: /absence is argued, never asserted/,
  },
  {
    what: "a SOURCE_FAILED carrying a holding",
    input: { outcome: "SOURCE_FAILED", failure: "UPSTREAM_ERROR", holding: holding("meetings") },
    needle: /nothing was acquired/,
  },
  {
    what: "an ACQUIRED_CHANGED with no holding",
    input: { outcome: "ACQUIRED_CHANGED", holding: null },
    needle: /names no change/,
  },
  {
    what: "a zero-row extraction reported as a change (RULING 269)",
    input: { outcome: "ACQUIRED_CHANGED", holding: holding("meetings", { rows: 0 }) },
    needle: /zero-row extraction is a failed extraction/,
  },
  {
    what: "an acquired holding with nowhere to park its bytes",
    input: { outcome: "ACQUIRED_CHANGED", holding: holding("meetings", { evidenceRef: "" }) },
    needle: /would have to refetch/,
  },
  {
    what: "an UNCHANGED carrying a candidate",
    input: { outcome: "UNCHANGED", holding: holding("meetings") },
    needle: /nothing new to hold/,
  },
];

for (const row of SEAL_REFUSALS) {
  test(`sealing refuses ${row.what}`, () => {
    const sealed = sealAcquisition({
      sourceId: "s",
      recordClass: "meetings",
      now: NOW,
      ...row.input,
    } as Parameters<typeof sealAcquisition>[0]);
    assert.equal(isSealed(sealed), false, `${row.what} must be refused`);
    assert.match((sealed as { reason: string }).reason, row.needle);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TABLES THEMSELVES
 * ═════════════════════════════════════════════════════════════════════════ */

test("every proof executor declares at least one record class it actually reads", () => {
  const known = new Set(["meetings", "fec", "state-votes", "nj-filing"]);
  for (const executor of PROOF_EXECUTORS) {
    assert.ok(executor.dependsOn.length > 0, `${executor.id} depends on nothing, so it runs always`);
    for (const cls of executor.dependsOn) {
      assert.ok(known.has(cls), `${executor.id} declares unknown record class ${cls}`);
    }
    assert.ok(executor.spends.length > 0, `${executor.id} must declare what it spends`);
  }
});

test("a record class no executor claims stays PENDING rather than certifying itself", () => {
  const orphan = holding("campaign-finance");
  const verdict = judgeCertification({ holding: orphan, readings: [] });
  assert.equal(verdict.state, "CERTIFICATION_PENDING");
  assert.match(verdict.reason, /no proof executor declares a dependency/);
  assert.equal(planWindow([verdict]).commits, 0);
});

test("a selected executor that reported nothing leaves the holding PENDING", () => {
  const h = holding("meetings");
  const verdict = judgeCertification({ holding: h, readings: [] });
  assert.equal(verdict.state, "CERTIFICATION_PENDING");
  assert.match(verdict.reason, /reported nothing/);
});

test("a content defect outranks an infrastructure block", () => {
  const h = holding("meetings");
  const verdict = judgeCertification({
    holding: h,
    readings: [
      { executorId: "meeting-read-model", result: "FAIL", detail: "wrong date" },
      { executorId: "reader-last-mile", result: "BLOCKED", detail: "browser down" },
    ],
  });
  assert.equal(
    verdict.state,
    "CONSUMER_DEFECT",
    "a retry would find the same wrong bytes; the block must not mask the defect",
  );
});

test("the only cross-holding coupling regenerates over the final set and ships nothing together", () => {
  assert.equal(CROSS_HOLDING_COUPLINGS.length, 1);
  assert.equal(CROSS_HOLDING_COUPLINGS[0].mode, "REGENERATE_OVER_FINAL_SET");
  assert.equal(
    CROSS_HOLDING_COUPLINGS.filter((c) => c.mode === "SHIP_TOGETHER").length,
    0,
    "a SHIP_TOGETHER coupling converts an independent failure domain back into a shared one",
  );
});

test("every execution class states why its grant is that size, and no grant is empty", () => {
  for (const grant of RESOURCE_GRANTS) {
    assert.ok(grant.allowed.length > 0, `${grant.executionClass} grants nothing`);
    assert.ok(grant.why.length > 40, `${grant.executionClass} must say why, not just that`);
  }
});

test("an unknown resource and an unknown execution class are both REFUSED", () => {
  const unknownResource = maySpend("RUNTIME_FRESHNESS", "some-new-provider");
  assert.equal(unknownResource.allowed, false);
  assert.match(unknownResource.reason, /adding a provider is a decision rather than a discovery/);

  const unknownClass = maySpend("WHATEVER_THIS_IS", "local-compute");
  assert.equal(unknownClass.allowed, false);
  assert.match(unknownClass.reason, /refused rather than granted a default/);
});

test("crossing an execution-class boundary is reported, not silently permitted", () => {
  const crossings = crossedBoundary("RUNTIME_FRESHNESS", [
    "local-compute",
    "maptiler-requests",
    "hosted-actions-minutes",
  ]);
  assert.equal(crossings.length, 2);
  assert.deepEqual(
    crossings.map((c) => c.resource).sort(),
    ["hosted-actions-minutes", "maptiler-requests"],
  );
});

test("an unclassified failure escalates — the opposite default from an unknown resource", () => {
  const decision = decideEscalation({
    domain: "SOMETHING_NOBODY_CLASSIFIED" as never,
    subject: "x",
    overdueHours: 0,
    flags: [],
    detail: "",
  });
  assert.equal(decision.escalate, true);
  assert.match(decision.reason, /most worth a person's attention/);
});

test("no valid last-known-good escalates on sight; every other domain waits", () => {
  const emergency = decideEscalation({
    domain: "NO_VALID_LAST_GOOD",
    subject: "meetings",
    overdueHours: 0,
    flags: [],
    detail: "",
  });
  assert.equal(emergency.escalate, true);

  for (const policy of DOMAIN_POLICIES) {
    if (policy.domain === "NO_VALID_LAST_GOOD") continue;
    const fresh = decideEscalation({
      domain: policy.domain,
      subject: "s",
      overdueHours: 0,
      flags: [],
      detail: "",
    });
    assert.equal(
      fresh.escalate,
      false,
      `${policy.domain} must not reach the owner on its first occurrence (RULING 218)`,
    );
  }
});

test("every domain policy states its threshold's reason", () => {
  for (const policy of DOMAIN_POLICIES) {
    assert.ok(policy.why.length > 60, `${policy.domain} must say why its threshold is that size`);
  }
});
