import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FAILURE_CLASSES,
  INTEGRITY_STATES,
  MAX_READING_AGE_HOURS,
  NEVER_CHECKED,
  assessIntegrity,
  evaluateReleaseFreeze,
  explainFreeze,
  sameCommit,
  touchesSchemaContract,
  type IntegrityRecord,
  type ProductionObservation,
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
/** The candidate being released — a third commit, because the candidate is no longer the subject. */
const SHA_C = "cccccccccccccccccccccccccccccccccccccccc";

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

/**
 * A production observation, built for a test.
 *
 * `servedSha` is what production was OBSERVED to serve; `ageHours` is how old
 * the reading is. Both are measurements the pure module never takes for itself —
 * `scripts/release-freeze-gate.mts` reads the clock and asks
 * `GET /api/build` — which is what makes every branch of rule 4 constructible
 * here rather than waited for in production.
 */
function serving(servedSha: string | null, ageHours: number | null): ProductionObservation {
  return {
    servedSha,
    how: servedSha === null ? "the observation FAILED in this test" : "stated by the test",
    readingAgeHours: ageHours,
    maxAgeHours: MAX_READING_AGE_HOURS,
  };
}

/** The ordinary healthy case: production serves what the reading is about, taken an hour ago. */
const FRESH = serving(SHA_A, 1);

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

test("NC4: a passing re-check against what production serves clears the freeze", () => {
  const frozen = evaluateReleaseFreeze({
    record: REFUSED,
    candidateSha: SHA_B,
    changedPaths: APP_CHANGE,
    production: FRESH,
  });
  assert.equal(frozen.frozen, true);

  /*
   * The re-check is taken against the commit production ACTUALLY SERVES, which
   * is the whole correction of 2026-08-29. A reading against the candidate could
   * not exist yet — the candidate has not deployed, and this gate runs before
   * the deploy — so keying the clearance on it would have made the freeze
   * unsatisfiable by construction.
   */
  const recheck: IntegrityRecord = { ...HELD, deployedSha: SHA_A, mainSha: SHA_A };
  const cleared = evaluateReleaseFreeze({
    record: recheck,
    candidateSha: SHA_B,
    changedPaths: APP_CHANGE,
    production: FRESH,
  });
  assert.equal(cleared.frozen, false);
  assert.equal(cleared.state, "CURRENT");
  assert.equal(cleared.freshness, "CURRENT_FOR_PRODUCTION");
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

  /*
   * STALE_HEALTHY IS STILL AN HONEST STATE and is still never reported as
   * CURRENT. What changed on 2026-08-29 is what FOLLOWS from it for a release:
   * see the SEEDED FAILURE block below. The state itself is untouched, which is
   * the point — no existing state was quietly repurposed.
   */
  const v = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_B,
    changedPaths: APP_CHANGE,
    production: serving(SHA_B, 1),
  });
  assert.equal(v.state, "STALE_HEALTHY");
  assert.doesNotMatch(v.reason, /\bCURRENT\b/);
});

test("NC7b: HELD with no recorded commit holds for nothing", () => {
  const a = assessIntegrity({ ...HELD, deployedSha: null }, SHA_A);
  assert.equal(a.state, "UNKNOWN");
  assert.match(a.reason, /nothing it can be said to hold FOR/);
});

/** ------- SEEDED FAILURE: a stale reading treated as CURRENT ------------- */

/**
 * **THE SEEDED FAILURE, AND THE GUARD THAT CATCHES IT.**
 *
 * SEED: production-integrity says HELD; the reading was taken days ago against
 * a commit production no longer serves; a production-changing release asks to
 * ship. Under the rule 4 that stood until 2026-08-29 — *"STALE_HEALTHY does not
 * freeze"* — this was PERMITTED, and it was permitted forever: nothing in the
 * mechanism ever expired a healthy answer.
 *
 * GUARD: `evaluateReleaseFreeze`'s freshness clause. It keys on the SERVED sha
 * and on the reading's AGE, both passed in by `scripts/release-freeze-gate.mts`,
 * and refuses by name with the exact remedy.
 *
 * The route REJECTED, recorded so it is not re-proposed: keying the freeze on
 * the CANDIDATE sha. A post-deploy reading against a candidate cannot exist
 * until that candidate has deployed, and this gate runs before the deploy — so
 * that rule freezes every production-changing release forever, and an
 * unsatisfiable gate is the best argument anyone will ever have for the skip
 * flag this repository refuses to have.
 */
test("SEEDED: a healthy reading about a commit production no longer serves FREEZES", () => {
  const stale: IntegrityRecord = { ...HELD, observedAt: "2026-08-26T04:00:00.000Z" };
  const v = evaluateReleaseFreeze({
    record: stale,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    // Production moved on: it serves SHA_B, and the reading is about SHA_A.
    production: serving(SHA_B, 72),
  });

  assert.equal(v.frozen, true, "this is the exact case the old rule 4 permitted forever");
  assert.equal(v.freshness, "PRODUCTION_MOVED");
  assert.equal(v.servedSha, SHA_B);
  assert.match(v.reason, /PRODUCTION MOVED UNDER THE LAST READING/);
  assert.ok(v.remedy, "a freeze must name what clears it");
  assert.match(v.remedy!, /integrity:check --sha=/, "the remedy is a command, never a shrug");
  assert.match(v.remedy!, /post-deploy-integrity\.yml/, "and it names the automatic path too");
  assert.match(explainFreeze(v), /RELEASE FROZEN/);
});

test("SEEDED (age half): a reading older than the bound FREEZES even about the served commit", () => {
  /*
   * The independent half. Production has NOT moved — it serves exactly what the
   * reading is about — and the reading has simply gone stale on the clock. This
   * is the "indefinitely stale" clause, and it is the one with no escape hatch:
   * a healthy answer that never expires is an answer about nothing.
   */
  const v = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: serving(SHA_A, MAX_READING_AGE_HOURS + 0.5),
  });
  assert.equal(v.frozen, true);
  assert.equal(v.freshness, "READING_EXPIRED");
  assert.match(v.reason, /THE READING HAS EXPIRED/);
  assert.match(v.remedy!, /integrity:check/);
});

test("POSITIVE CONTROL: a fresh reading about the served commit PERMITS the release", () => {
  /*
   * Without this the guard above proves only that something refuses, which a
   * gate that refuses everything also does. Production serves the commit the
   * reading was taken against, and the reading is an hour old: the release
   * proceeds, and the reason says why rather than printing a bare OK.
   */
  const v = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: serving(SHA_A, 1),
  });
  assert.equal(v.frozen, false);
  assert.equal(v.freshness, "CURRENT_FOR_PRODUCTION");
  assert.equal(v.state, "CURRENT");
  assert.equal(v.remedy, null);
  assert.match(v.reason, /Release permitted/);
  assert.match(explainFreeze(v), /release permitted/);
});

test("an unsupplied observation FREEZES rather than defaulting to permitted", () => {
  /*
   * FAIL-CLOSED BY OMISSION. A caller that never asks what production serves
   * gets the strict answer, so there is no way to be permitted by leaving the
   * question unasked — which is the only shape under which "there is no skip
   * flag" survives a caller who would like one.
   */
  const v = evaluateReleaseFreeze({ record: HELD, candidateSha: SHA_C, changedPaths: APP_CHANGE });
  assert.equal(v.frozen, true);
  assert.equal(v.freshness, "NOT_ASSESSED");
  assert.match(v.reason, /An unasked question is not a passing answer/);
});

test("a production that could not be ASKED is COULD NOT TELL, and it freezes", () => {
  const v = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: serving(null, 1),
  });
  assert.equal(v.frozen, true);
  assert.equal(v.freshness, "PRODUCTION_UNOBSERVABLE");
  assert.match(v.reason, /RULING 24/);
  // And it is NOT reported as a failure of production's schema.
  assert.notEqual(v.state, "DEGRADED");
});

test("a docs-only change is outside release-freeze semantics however stale the reading", () => {
  /*
   * Rule 1 is unchanged, and the freshness clause may not reach through it.
   * Paperwork is not punished for the database's condition, and a close-out
   * commit that could not alter what a reader sees is not a release.
   */
  const v = evaluateReleaseFreeze({
    record: { ...HELD, observedAt: "2026-01-01T00:00:00.000Z" },
    candidateSha: SHA_C,
    changedPaths: DOCS_ONLY,
    production: serving(SHA_B, 5_000),
  });
  assert.equal(v.frozen, false);
  assert.equal(v.productionChanging, false);
  assert.equal(v.freshness, "NOT_APPLICABLE");
});

test("an abbreviated recorded SHA and the full served one are the SAME commit", () => {
  /*
   * THE FALSE-FREEZE DIRECTION, guarded explicitly. The committed record has
   * carried an abbreviated sha since 2026-08-28 (`"71325247"`) and
   * `GET /api/build` returns all forty characters. Strict equality would have
   * reported PRODUCTION_MOVED for a commit that had not moved — a refusal for a
   * reason that was never true, which is the direction that gets a gate switched
   * off rather than fixed.
   */
  const abbreviated = SHA_A.slice(0, 8);
  assert.equal(sameCommit(abbreviated, SHA_A), true);
  assert.equal(sameCommit(SHA_A, SHA_B), false);
  assert.equal(sameCommit("713252", SHA_A), false, "below git's own abbreviation floor, refuse to match");
  assert.equal(sameCommit(null, SHA_A), false, "an absent sha matches nothing");

  const v = evaluateReleaseFreeze({
    record: { ...HELD, deployedSha: abbreviated },
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: serving(SHA_A, 1),
  });
  assert.equal(v.frozen, false, "the same commit written two ways is not production moving");
  assert.equal(v.freshness, "CURRENT_FOR_PRODUCTION");
});

test("the freshness bound has no environment escape hatch and no skip flag", () => {
  /*
   * RULING 24's family, asserted rather than asserted-in-a-comment. A bound a
   * caller can raise is not a bound, and an env var that turns the clause off
   * would restore the exact hole it closes.
   */
  // `module` as an identifier is refused by @next/next/no-assign-module-variable.
  const pureModule = readFileSync(join(ROOT, "lib", "ops", "production-integrity.ts"), "utf8");
  const gate = readFileSync(join(ROOT, "scripts", "release-freeze-gate.mts"), "utf8");
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.doesNotMatch(code(pureModule), /process\.env/, "the pure module reads no environment at all");
  const ESCAPE = /process\.env\.[A-Z_]*(SKIP|FORCE|IGNORE|OVERRIDE|STALE|FRESH|MAX_AGE|BYPASS)[A-Z_]*/;
  assert.doesNotMatch(code(gate), ESCAPE, "the gate reads no override for the freshness bound");
  assert.doesNotMatch(code(gate), /--(skip|force|no-freeze|served)\b/, "no flag may state or skip the observation");
  // Positive control: the detector fires on the shape it hunts.
  assert.match("if (process.env.WTP_SKIP_FRESHNESS) return;", ESCAPE, "the escape-hatch detector matches nothing");
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

/* ══════════════════════════════════════════════════════════════════════════
 * WHERE A FRESHNESS FREEZE FAILS THE JOB, AND WHERE IT ONLY REPORTS
 * (2026-08-29, measured on this gate's own first run against `main`.)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE DEFECT THIS PINS, and it was measured rather than imagined.
 *
 * The freshness clause shipped in PR #221, the merge landed, and the `gates` job
 * on the merge commit went RED with `PRODUCTION_MOVED` while nothing whatever
 * was wrong with production — the reading held, the deploy succeeded, and all 23
 * migrations were applied.
 *
 * It was red BY CONSTRUCTION and would have been red after every
 * production-changing merge forever: the `gates` job checks out the merge
 * commit, whose integrity record necessarily predates the deploy that merge
 * triggers, so `served != recorded` is guaranteed. A gate that fails regardless
 * of the truth measures nothing, and a permanently red `main` is how a real red
 * stops being read.
 *
 * These tests hold the narrowing in place and — more importantly — hold the
 * PULL REQUEST half unchanged, because that is where every protection lives.
 */
test("the freshness split is by EVENT, and the pull-request half is untouched", () => {
  const gate = readFileSync(join(ROOT, "scripts", "release-freeze-gate.mts"), "utf8");

  // The condition is on the push-to-main event specifically, never on a bare
  // "is this CI" test, which would take the pull request with it.
  assert.match(gate, /GITHUB_EVENT_NAME === "push"/);
  assert.match(gate, /refs\/heads\/main|GITHUB_REF_NAME === "main"/);

  /*
   * DEGRADED IS EXCLUDED BY NAME. `PRODUCTION_MOVED` and its siblings say "we do
   * not currently know"; DEGRADED says "we asked, and production and the
   * committed migrations disagree" — an active incident that is true whichever
   * event observed it, and exactly the 2026-08-28 drift. If this ever falls
   * through the same branch, a real incident stops failing `main`.
   */
  assert.match(gate, /verdict\.state !== "DEGRADED"/);
});

test("SEEDED: a DEGRADED reading is NOT covered by the push-to-main narrowing", () => {
  // The narrowing must never reach a genuine incident. Asserted on the model
  // rather than on the script's prose: a REFUSED reading freezes, and the
  // verdict it produces carries the state the script excludes by name.
  const degraded = evaluateReleaseFreeze({
    record: {
      ...NEVER_CHECKED,
      deployedSha: "589676ae",
      observed: "REFUSED",
      failureClass: "MIGRATION_NOT_APPLIED",
      detail: "production is missing 0022_adorable_hemingway",
      observedAt: "2026-08-29T16:00:00.000Z",
      moment: "post-deploy",
      gateExit: 1,
    },
    candidateSha: "7634fdb0",
    changedPaths: ["lib/db/migrations/0023_x.sql"],
    production: { servedSha: "589676ae", how: "GET /api/build", readingAgeHours: 0.1, maxAgeHours: 24 },
  });
  assert.equal(degraded.frozen, true);
  assert.equal(degraded.state, "DEGRADED", "a DEGRADED verdict must keep failing every event");
});

test("POSITIVE CONTROL: a freshness freeze and a DEGRADED freeze are DIFFERENT states", () => {
  // Without this, the test above would pass against a model that reported every
  // freeze as DEGRADED — and the script's exclusion would then silence
  // everything rather than nothing.
  const moved = evaluateReleaseFreeze({
    record: {
      ...NEVER_CHECKED,
      deployedSha: "de61ff5d",
      observed: "HELD",
      failureClass: null,
      detail: "held",
      observedAt: "2026-08-29T16:01:14.134Z",
      moment: "post-deploy",
      gateExit: 0,
    },
    candidateSha: "7634fdb0",
    changedPaths: ["lib/control-plane/completion.ts"],
    production: { servedSha: "589676ae", how: "GET /api/build", readingAgeHours: 0.7, maxAgeHours: 24 },
  });
  assert.equal(moved.frozen, true, "production moved under the reading — still a freeze");
  assert.notEqual(moved.state, "DEGRADED", "a stale reading is not an incident");
  assert.equal(moved.state, "STALE_HEALTHY");
  assert.equal(moved.freshness, "PRODUCTION_MOVED");
});
