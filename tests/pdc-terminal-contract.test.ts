import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ledger = JSON.parse(
  readFileSync("docs/permanent-civic-data-plane-cutover-v2-ledger.json", "utf8"),
) as {
  readonly terminalInvariants?: Readonly<Record<string, unknown>>;
  readonly acceptanceRegressionEvidence?: readonly Readonly<Record<string, unknown>>[];
};

const REQUIRED_TERMINAL_INVARIANTS = {
  GITHUB_ROUTINE_DATA_CRONS: 0,
  GITHUB_ROUTINE_OPS_CRONS: 0,
  ROUTINE_DATA_GIT_WRITERS: 0,
  ROUTINE_OPS_GIT_WRITERS: 0,
  LEGACY_REFRESH_EXECUTABLES: 0,
  DUAL_AUTHORITIES_FOR_ROUTINE_SOURCES: 0,
  RUNTIME_EVENT_TO_SOFTWARE_CI_FEEDBACK_LOOPS: 0,
  ROUTINE_SOURCE_FAILURE_CAN_TRIGGER_SOFTWARE_RELEASE: "NO",
  ROUTINE_SOURCE_FAILURE_CAN_ERASE_LKG: "NO",
  OWNER_CAN_VERIFY_RUNTIME_DATA_WITHOUT_GITHUB_ACTIONS: "YES",
  GITHUB_ACTIONS_ROLE: "SOFTWARE_CI_ONLY",
  UNRELATED_SOFTWARE_TEST_CAN_FAIL_SOURCE_REFRESH: "NO",
  UNRELATED_SOFTWARE_FAILURE_CAN_REVERT_SOURCE_DATA: "NO",
  SOURCE_DISPOSITION_REQUIRES_SOURCE_SCOPED_EVIDENCE: "YES",
} as const;

test("the frozen ledger names every amended terminal PDC invariant exactly", () => {
  for (const [key, expected] of Object.entries(REQUIRED_TERMINAL_INVARIANTS)) {
    assert.equal(ledger.terminalInvariants?.[key], expected, key);
  }
});

test("the frozen regression evidence retains both concrete failure classes", () => {
  const evidence = ledger.acceptanceRegressionEvidence ?? [];
  assert.ok(evidence.some((row) => row.run === "34232794631" && row.reproducedByBuildCheck === "34236904831"));
  assert.ok(evidence.some((row) => row.commit === "673f1dd"));
});

test("the 673f1dd root cause is bound to the live commit and classifier evidence", () => {
  const evidence = (ledger.acceptanceRegressionEvidence ?? []).find((row) => row.commit === "673f1dd");
  assert.ok(evidence);
  const live = evidence.liveRecheck as Readonly<Record<string, unknown>>;
  assert.equal(live.fullSha, "673f1ddc63fbc5f513a89034d65990ff9849b99b");
  assert.equal(live.buildRun, "34266244424");
  assert.equal(live.postDeployRun, "34266244387");
  assert.equal(live.pathEvidenceDisagrees, true);
  assert.deepEqual(live.githubCommitPaths, [
    "docs/log.md",
    "docs/tracker-opened.json",
    "docs/tracker-working.csv",
    "docs/tracker.md",
    "docs/tracker.xlsx",
  ]);
  const classifier = live.classifierEvidence as Readonly<Record<string, unknown>>;
  assert.deepEqual(
    {
      opsOnlyPaths: classifier.opsOnlyPaths,
      pathClass: classifier.pathClass,
      class: classifier.class,
      cost: classifier.cost,
      certifiedTreeReuse: classifier.certifiedTreeReuse,
    },
    {
      opsOnlyPaths: "0 of 5",
      pathClass: "PROOF-BEARING",
      class: "SHIPPING",
      cost: "FULL",
      certifiedTreeReuse: "NOT_A_TWO_PARENT_MERGE",
    },
  );
  assert.match(String(live.permanentRepair), /Delete the Git-writing job-watch authority/);
});
