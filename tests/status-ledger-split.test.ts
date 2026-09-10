/**
 * **THE SEEDED FAILURES FOR THE CAPABILITY / STATUS SPLIT.** (A.1 WI6.)
 *
 * The audit finding: `lib/ops/status-ledger.ts` held a static array of
 * hand-typed `lastResult` strings ("suite green in the workstream run that
 * generated this ledger"), `proofClass`, dates and SHAs (many of them "—"),
 * and `status:ledger --check` proved that the Markdown matched the array. It
 * proved a document equals its own source. It could not, and did not, prove
 * that any named check currently passes.
 *
 * These tests pin the repair: a result may only come from a run record, and
 * there is nowhere in the curated half to type one.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPABILITY_REGISTRY,
  type CapabilityEntry,
} from "../lib/ops/capability-registry.ts";
import { resolveCapability, type RunRecordSet } from "../lib/ops/status-result.ts";

const HEAD = "cccccccccccccccccccccccccccccccccccccccc";
const OTHER = "dddddddddddddddddddddddddddddddddddddddd";

function noRecords(): RunRecordSet {
  return { gates: null, walk: null };
}

function gateRecords(
  status: string,
  testedSha: string | null = HEAD,
  /**
   * Session B: the run's PROVENANCE, which is now what decides the proof
   * class. A record with none — the default here, and every record written
   * before B — is `SESSION_MEASURED`. See `lib/ops/run-provenance.ts`.
   */
  provenance: unknown = undefined,
): RunRecordSet {
  return {
    gates: {
      runId: "gates@2026-08-30T00:00:00.000Z",
      testedSha,
      finishedAt: "2026-08-30T00:00:00.000Z",
      gates: [{ id: "test", status, seconds: 42 }],
      path: "data/ops/gate-runs/2026-08-30-01.json",
      provenance,
    } as never,
    walk: null,
  };
}

const SUITE_ENTRY: CapabilityEntry = {
  id: "example",
  capability: "Something the suite proves.",
  provenBy: { kind: "SUITE", testFiles: ["tests/example.test.ts"] },
  evidence: "tests/example.test.ts",
};

const always = () => true;
const never = () => false;

/* ====================================================================== */

test("SEEDED: a hand-typed PASS with no run record does not render green", () => {
  /*
   * The plant. A curated row may carry any prose it likes — including the
   * word PASS, in the capability text and the evidence — and it still cannot
   * produce a proven row, because the result is not read from the row.
   */
  const planted: CapabilityEntry = {
    id: "planted",
    capability: "This capability PASSES. Status: PASS. Last result: green, verified, PASS.",
    provenBy: { kind: "SUITE", testFiles: ["tests/nonexistent.test.ts"] },
    evidence: "PASS — asserted here in as many words as anyone likes",
  };
  const result = resolveCapability(planted, noRecords(), HEAD, always);
  assert.equal(result.state, "UNPROVEN");
  assert.equal(result.proofClass, null);
  assert.equal(result.runId, null);
  assert.match(result.detail, /no gate run record exists/);
});

test("the curated registry has NO field in which a result could be typed", () => {
  /*
   * Structural, not stylistic. The old shape's whole failure was that
   * `lastResult`, `proofClass`, `asOf` and `sha` existed to be typed into.
   */
  for (const entry of CAPABILITY_REGISTRY) {
    const keys = Object.keys(entry);
    for (const forbidden of ["lastResult", "proofClass", "asOf", "sha", "status", "result"]) {
      assert.ok(
        !keys.includes(forbidden),
        `${entry.id} carries a "${forbidden}" field — a curated row may not hold a result`,
      );
    }
  }
});

test("a run record saying PASS on this tree DOES prove the row, and derives its proof class", () => {
  const result = resolveCapability(SUITE_ENTRY, gateRecords("PASS"), HEAD, always);
  assert.equal(result.state, "PROVEN");
  /*
   * SESSION_MEASURED, and the change from A.1's expectation here IS the WI1.8
   * repair. This record carries no provenance, so nothing in it establishes
   * that the run was separate from the implementing session's own observation
   * — and RULING 216 excludes that observation from INDEPENDENTLY_REPRODUCED
   * by name. A.1 returned the stronger class for every passing canonical
   * result, which awarded the activation-gating class to `pnpm gates` run on
   * an unmerged branch.
   */
  assert.equal(result.proofClass, "SESSION_MEASURED");
  assert.match(result.proofClassReason ?? "", /carries no provenance block/);
  assert.equal(result.testedSha, HEAD);
  assert.equal(result.recordPath, "data/ops/gate-runs/2026-08-30-01.json");
});

test("the stronger proof class is still REACHABLE — an integrated, non-session run earns it", () => {
  /* A repair that made INDEPENDENTLY_REPRODUCED unreachable would have traded
     one wrong answer for another. */
  const result = resolveCapability(
    SUITE_ENTRY,
    gateRecords("PASS", HEAD, {
      runClass: "SCHEDULED",
      workingTreeClean: true,
      integratedAtRunTime: true,
      integrationRef: "origin/main",
    }),
    HEAD,
    always,
  );
  assert.equal(result.state, "PROVEN");
  assert.equal(result.proofClass, "INDEPENDENTLY_REPRODUCED");
});

test("a run this session invoked on its own unmerged branch stays SESSION_MEASURED", () => {
  const result = resolveCapability(
    SUITE_ENTRY,
    gateRecords("PASS", HEAD, {
      runClass: "LOCAL_SESSION",
      workingTreeClean: true,
      integratedAtRunTime: false,
      integrationRef: "origin/main",
    }),
    HEAD,
    always,
  );
  assert.equal(result.proofClass, "SESSION_MEASURED");
  assert.match(result.proofClassReason ?? "", /not yet in origin\/main/);
});

test("a run record saying FAIL renders FAILING, never absent and never green", () => {
  const result = resolveCapability(SUITE_ENTRY, gateRecords("FAIL"), HEAD, always);
  assert.equal(result.state, "FAILING");
  assert.equal(result.proofClass, null);
  assert.match(result.detail, /FAIL/);
});

test("SEEDED: a green record from a tree the release does not contain is STALE, not PROVEN", () => {
  const result = resolveCapability(SUITE_ENTRY, gateRecords("PASS", OTHER), HEAD, never);
  assert.equal(result.state, "STALE");
  assert.equal(result.proofClass, null);
  assert.match(result.detail, /does not contain/);
});

test("a record with no tested SHA is STALE — it cannot be placed against the release", () => {
  const result = resolveCapability(SUITE_ENTRY, gateRecords("PASS", null), HEAD, always);
  assert.equal(result.state, "STALE");
  assert.match(result.detail, /names no tested SHA/);
});

test("a capability with no named check is UNPROVEN and states what is needed", () => {
  const entry: CapabilityEntry = {
    id: "unnamed",
    capability: "Something nothing checks.",
    provenBy: null,
    neededCheck: "a named unit test over the grouping function",
    evidence: "git history",
  };
  const result = resolveCapability(entry, gateRecords("PASS"), HEAD, always);
  assert.equal(result.state, "UNPROVEN");
  assert.match(result.detail, /a named unit test over the grouping function/);
});

test("a gate the run record does not name is UNPROVEN, not assumed passing", () => {
  const entry: CapabilityEntry = {
    id: "absent-gate",
    capability: "Proven by a gate that is not in the gate set.",
    provenBy: { kind: "GATE", gateId: "status:ledger" },
    evidence: "scripts/handoff.mjs runs it, but it is not a member of the gate set",
  };
  const result = resolveCapability(entry, gateRecords("PASS"), HEAD, always);
  assert.equal(result.state, "UNPROVEN");
  assert.match(result.detail, /names no gate `status:ledger`/);
});

test("every registry row carries a stable id, and the ids are unique", () => {
  const ids = CAPABILITY_REGISTRY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "capability ids must be unique");
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} is not a stable slug`);
});

test("every UNPROVEN row in the curated registry names the check that needs to exist", () => {
  for (const entry of CAPABILITY_REGISTRY) {
    if (entry.provenBy !== null) continue;
    assert.ok(
      entry.neededCheck && entry.neededCheck.length > 0,
      `${entry.id} is UNPROVEN and does not name the check that needs to exist`,
    );
  }
});
