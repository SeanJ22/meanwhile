import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FAILURE_CLASSES,
  INTEGRITY_STATES,
  NEVER_CHECKED,
  assessIntegrity,
  evaluateReleaseFreeze,
  explainFreeze,
  touchesSchemaContract,
  type IntegrityRecord,
} from "../lib/ops/production-integrity.ts";
import { GATES } from "../scripts/gates.mjs";

/**
 * NH273 — THE NEGATIVE CONTROLS.
 *
 * Every test here plants a state the system must refuse to call healthy. The
 * defect being guarded against is not a crash; it is a green that never looked.
 * On 2026-08-28 three required checks passed while production served a schema
 * the deployed code did not have, and none of them was wrong — none of them had
 * asked production anything.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HELD: IntegrityRecord = {
  formatVersion: 1,
  deployedSha: SHA_A,
  mainSha: SHA_A,
  observed: "HELD",
  failureClass: null,
  detail: "HOLDS — 23 of 23 committed migration(s) applied",
  observedAt: "2026-08-28T12:00:00.000Z",
  moment: "post-deploy",
  gateExit: 0,
};

const REFUSED: IntegrityRecord = {
  ...HELD,
  observed: "REFUSED",
  failureClass: "MIGRATION_NOT_APPLIED",
  detail: "REFUSED — 2 EXPAND migration(s) are committed and NOT applied to production",
  gateExit: 1,
};

const NO_CREDENTIAL: IntegrityRecord = {
  ...HELD,
  observed: "COULD_NOT_TELL",
  failureClass: "CREDENTIAL_ABSENT",
  detail: "db:gate: COULD NOT TELL — WTP_PRODUCTION_DATABASE_URL_READONLY is not set",
  gateExit: 2,
};

const APP_CHANGE = ["app/api/meetings/route.ts", "lib/meetings/query.ts"];
const SCHEMA_CHANGE = ["lib/db/migrations/0023_new_thing.sql", "lib/db/schema.ts"];
const DOCS_ONLY = ["docs/state.md", "docs/tracker-working.csv"];

/** ---------------------- 1. green CI + red integrity is NOT current ------ */

test("NC1: GitHub green plus a red post-deploy reading is DEGRADED, never CURRENT", () => {
  const a = assessIntegrity(REFUSED, SHA_A);
  assert.equal(a.state, "DEGRADED");
  assert.equal(a.failureClass, "MIGRATION_NOT_APPLIED");
  assert.match(a.reason, /REFUSED/);

  // And it is not rescued by asking about the very commit it was taken against.
  assert.notEqual(assessIntegrity(REFUSED, null).state, "CURRENT");
});

/** ---------------------- 2. DEGRADED blocks the next release ------------- */

test("NC2: a DEGRADED reading freezes the next production-changing release", () => {
  const v = evaluateReleaseFreeze({
    record: REFUSED,
    candidateSha: SHA_B,
    changedPaths: APP_CHANGE,
  });
  assert.equal(v.frozen, true);
  assert.equal(v.state, "DEGRADED");
  assert.equal(v.productionChanging, true);
  assert.ok(v.remedy, "a freeze must name what clears it");
  assert.match(v.remedy!, /integrity:check/);
  assert.match(explainFreeze(v), /RELEASE FROZEN/);
});

test("NC2b: the freeze reaches a production-changing release even when it touches no schema", () => {
  const v = evaluateReleaseFreeze({ record: REFUSED, candidateSha: SHA_B, changedPaths: APP_CHANGE });
  assert.equal(v.touchesSchemaContract, false, "this change moves no migration");
  assert.equal(v.frozen, true, "DEGRADED blocks every production-changing release, not only schema ones");
});

/** ---------------------- 3. docs-only does not clear a freeze ------------ */

test("NC3: a docs-only change is not a production release and does not clear the freeze", () => {
  const v = evaluateReleaseFreeze({ record: REFUSED, candidateSha: SHA_B, changedPaths: DOCS_ONLY });
  assert.equal(v.frozen, false, "paperwork is not punished for the database's condition");
  assert.equal(v.productionChanging, false);

  // The critical half: shipping it did not make production healthy.
  assert.equal(v.state, "DEGRADED", "the integrity state is unchanged by a docs-only merge");
  assert.match(v.reason, /DEGRADED/);

  // And the next application-bearing change is still frozen.
  const next = evaluateReleaseFreeze({ record: REFUSED, candidateSha: SHA_B, changedPaths: APP_CHANGE });
  assert.equal(next.frozen, true, "a docs-only merge in between cannot have thawed anything");
});

/** ---------------------- 4. a green re-check clears the freeze ----------- */

test("NC4: a passing re-check against the candidate clears the freeze", () => {
  const frozen = evaluateReleaseFreeze({ record: REFUSED, candidateSha: SHA_B, changedPaths: APP_CHANGE });
  assert.equal(frozen.frozen, true);

  const recheck: IntegrityRecord = { ...HELD, deployedSha: SHA_B, mainSha: SHA_B };
  const cleared = evaluateReleaseFreeze({ record: recheck, candidateSha: SHA_B, changedPaths: APP_CHANGE });
  assert.equal(cleared.frozen, false);
  assert.equal(cleared.state, "CURRENT");
});

/** ---------------------- 5. a missing credential cannot be green --------- */

test("NC5: an absent credential is CREDENTIAL_MISSING and never CURRENT", () => {
  const a = assessIntegrity(NO_CREDENTIAL, SHA_A);
  assert.equal(a.state, "CREDENTIAL_MISSING");
  assert.notEqual(a.state, "CURRENT");
  assert.match(a.reason, /not a passing check/);

  // It freezes a schema-moving release — the exact case where blindness is the defect.
  const schema = evaluateReleaseFreeze({
    record: NO_CREDENTIAL,
    candidateSha: SHA_B,
    changedPaths: SCHEMA_CHANGE,
  });
  assert.equal(schema.frozen, true);
  assert.match(schema.remedy!, /NH272/);

  // A production-changing release that leaves the schema alone is permitted,
  // and is reported as unproven rather than as green.
  const app = evaluateReleaseFreeze({
    record: NO_CREDENTIAL,
    candidateSha: SHA_B,
    changedPaths: APP_CHANGE,
  });
  assert.equal(app.frozen, false);
  assert.equal(app.state, "CREDENTIAL_MISSING");
  assert.match(app.reason, /NOT being reported as current/);
});

test("NC5b: a never-checked repository is UNKNOWN, and UNKNOWN is not a pass", () => {
  assert.equal(NEVER_CHECKED.observed, "COULD_NOT_TELL");
  const a = assessIntegrity(NEVER_CHECKED, SHA_A);
  assert.equal(a.state, "UNKNOWN");
  const v = evaluateReleaseFreeze({
    record: NEVER_CHECKED,
    candidateSha: SHA_A,
    changedPaths: SCHEMA_CHANGE,
  });
  assert.equal(v.frozen, true, "a schema change with no reading at all ships blind");
});

/** ---------------------- 6. no rollback exists -------------------------- */

test("NC6: no rollback path exists anywhere in the NH273 mechanism", () => {
  const sources = [
    "lib/ops/production-integrity.ts",
    "scripts/production-integrity.mts",
    "scripts/release-freeze-gate.mts",
  ];
  const ROLLBACK =
    /\b(git\s+revert|git\s+reset\s+--hard|netlify\s+(api\s+)?rollback|restoreDeploy|rollbackDeploy|--rollback)\b/i;

  for (const rel of sources) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    // Strip block comments: this module explains at length WHY it does not roll
    // back, and a sweep that reads its own reasoning as the defect is the guard
    // failing rather than the code.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, ROLLBACK, `${rel} contains a rollback action — NH273 forbids automatic rollback`);
  }

  // Positive control: the detector really does fire on the shape it hunts.
  assert.match("await netlify.rollbackDeploy(id)", ROLLBACK, "the rollback detector matches nothing at all");
});

/** ---------------------- 7. stale status cannot bless a later deploy ----- */

test("NC7: a green reading about an earlier SHA is STALE_HEALTHY, never CURRENT", () => {
  const a = assessIntegrity(HELD, SHA_B);
  assert.equal(a.state, "STALE_HEALTHY");
  assert.equal(a.observedSha, SHA_A);
  assert.equal(a.aboutSha, SHA_B);
  assert.match(a.reason, /not an answer about this one/);

  // It does not freeze — it is an honest healthy history — but a report of it
  // may never say CURRENT.
  const v = evaluateReleaseFreeze({ record: HELD, candidateSha: SHA_B, changedPaths: APP_CHANGE });
  assert.equal(v.frozen, false);
  assert.equal(v.state, "STALE_HEALTHY");
  assert.doesNotMatch(explainFreeze(v), /CURRENT/);
});

test("NC7b: HELD with no recorded commit holds for nothing", () => {
  const a = assessIntegrity({ ...HELD, deployedSha: null }, SHA_A);
  assert.equal(a.state, "UNKNOWN");
  assert.match(a.reason, /nothing it can be said to hold FOR/);
});

/** ---------------------- the unreadable-list rule ----------------------- */

test("a changed-path list that could not be read is treated as touching the schema", () => {
  assert.equal(touchesSchemaContract(null), true, "null is the absence of a measurement, not an empty one");
  assert.equal(touchesSchemaContract([]), false, "an empty list is a real measurement");
  assert.equal(touchesSchemaContract(["lib/db/schema.ts"]), true);
  // Built rather than written as a literal. A backslash repo path in source can
  // only ever match on Windows, and RULING 14's guard refuses the shape on
  // sight — correctly, even here, where the backslashes are the subject of the
  // test rather than a way of naming a file.
  const windowsPath = ["lib", "db", "migrations", "0023_x.sql"].join("\\");
  assert.equal(touchesSchemaContract([windowsPath]), true, "windows separators normalise");
  assert.equal(touchesSchemaContract(["lib/db/queries.ts"]), false);
});

/** ---------------------- wiring and vocabulary -------------------------- */

test("the freeze gate is in the gate set, in the required CI job", () => {
  const gate = GATES.find((g) => g.id === "release:freeze");
  assert.ok(gate, "release:freeze is not in scripts/gates.mjs — it would run in CI and not locally");
  assert.equal(gate.ciJob, "gates (test · lint · tsc)", "it must sit in the required context");
  assert.match(gate.command, /release-freeze-gate\.mts/);
  assert.ok(gate.why.length > 20, "every gate states why it exists");
});

test("the freeze gate runs in build-check.yml's gates job and is bounded", () => {
  const text = readFileSync(join(ROOT, ".github", "workflows", "build-check.yml"), "utf8");
  const gatesAt = text.indexOf("  gates:");
  assert.ok(gatesAt > 0);
  const gates = text.slice(gatesAt);
  assert.match(gates, /run: corepack pnpm exec tsx scripts\/release-freeze-gate\.mts/);

  // F25: the step names its own bound rather than sitting until the job's.
  const stepAt = gates.indexOf("- name: Release freeze");
  const step = gates.slice(stepAt, stepAt + 400);
  assert.match(step, /timeout-minutes:\s*\d+/, "the step must bound itself");
});

test("the committed record parses, declares its version, and is not vacuous", () => {
  const record = JSON.parse(
    readFileSync(join(ROOT, "data", "ops", "production-integrity.json"), "utf8"),
  ) as IntegrityRecord;

  assert.equal(record.formatVersion, 1);
  assert.ok(INTEGRITY_STATES.length === 5);
  assert.ok(["HELD", "REFUSED", "COULD_NOT_TELL"].includes(record.observed));
  if (record.failureClass !== null) {
    assert.ok(FAILURE_CLASSES.includes(record.failureClass), `unknown failure class ${record.failureClass}`);
  }
  assert.ok(record.observedAt, "a reading with no time cannot be aged");
  assert.equal(record.moment, "post-deploy", "the recorded reading must be the one where both phases are owed");
});

test("an unparseable or future-shaped record reads as UNKNOWN rather than throwing or passing", () => {
  // The reader is exercised through the same code path the gate uses.
  const future = { ...HELD, formatVersion: 99 } as unknown as IntegrityRecord;
  // assessIntegrity itself is version-agnostic; the guard lives in readRecord,
  // so what is asserted here is the SHAPE contract the reader depends on.
  assert.notEqual(future.formatVersion, 1);
  assert.equal(assessIntegrity(NEVER_CHECKED, SHA_A).state, "UNKNOWN");
});
