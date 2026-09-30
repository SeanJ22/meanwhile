import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MAX_READING_AGE_HOURS,
  NEVER_CHECKED,
  assessIntegrity,
  classifyEquivalenceRange,
  evaluateReleaseFreeze,
  explainFreeze,
  sameCommit,
  touchesSchemaContract,
  type IntegrityRecord,
  type ProductionObservation,
} from "../lib/ops/production-integrity.ts";
import { validIntegrityRecord } from "../lib/ops/production-integrity-data-plane.ts";
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

test("the canonical durable record validator accepts exact readings and rejects vacuous ones", () => {
  assert.equal(validIntegrityRecord(HELD), true);
  assert.equal(validIntegrityRecord(REFUSED), true);
  assert.equal(validIntegrityRecord({ ...HELD, deployedSha: "not-a-sha" }), false);
  assert.equal(validIntegrityRecord({ ...HELD, observedAt: null }), true, "NEVER_CHECKED remains a valid in-memory state");
});

test("an unparseable or future-shaped record reads as UNKNOWN rather than throwing or passing", () => {
  const future = { ...HELD, formatVersion: 99 } as unknown as IntegrityRecord;
  assert.equal(validIntegrityRecord(future), false);
  assert.equal(assessIntegrity(NEVER_CHECKED, SHA_A).state, "UNKNOWN");
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

/** -------------------- NH289: served commit vs application release -------- */

/*
 * THE DEFECT, MEASURED ON 2026-08-30. PR #226 merged as `9fb33469` at
 * 07:37:09Z; the post-deploy observer committed `5169fa32` — a child changing
 * exactly `data/ops/production-integrity.json` — 62 seconds later; Netlify
 * built the observer commit riding the accumulated diff, so production
 * REPORTED `5169fa32` while SERVING `9fb33469`'s application byte for byte.
 * The reading (HELD, 0.1h old, against `9fb33469`) was true, current and
 * about the application production served — and the next pull request froze
 * on PRODUCTION_MOVED anyway. The commit had moved; the application had not,
 * and the gate could not tell them apart.
 *
 * The repair is a PROOF, never an allowlist: the served commit must be shown
 * to descend from the measured release with nothing production-bearing in
 * the range, by the same `classifyDeploy` predicate the deploy filter runs.
 * Nothing here special-cases a sha, and every uncertain input stays frozen.
 */

test("POSITIVE CONTROL (NH289): a PROVEN non-shipping descendant is the same application", () => {
  const verdict = evaluateReleaseFreeze({
    record: HELD, // taken against SHA_A
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: {
      ...serving(SHA_B, 1),
      equivalence: {
        verdict: "EQUIVALENT",
        how: "bbbbbbb descends from aaaaaaa and all 1 changed path(s) in the range are non-shipping (first is data/ops/production-integrity.json)",
      },
    },
  });
  assert.equal(verdict.frozen, false, "the application production serves IS the measured release");
  assert.equal(verdict.freshness, "CURRENT_FOR_PRODUCTION");
  assert.equal(verdict.servedSha, SHA_B, "the served COMMIT is reported as observed");
  assert.equal(verdict.applicationReleaseSha, SHA_A, "the application-bearing RELEASE is reported too");
  const printed = explainFreeze(verdict);
  assert.ok(printed.includes(SHA_B), "the log names the served commit");
  assert.ok(printed.includes(`application-bearing release: ${SHA_A}`), "and the release the reading covers");
});

test("SEEDED (NH289): the same difference WITHOUT a proof still freezes — absence is not equivalence", () => {
  const verdict = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: serving(SHA_B, 1), // no equivalence field at all
  });
  assert.equal(verdict.frozen, true);
  assert.equal(verdict.freshness, "PRODUCTION_MOVED");
});

test("SEEDED (NH289): a SHIPPING child of the measured release is a real move and freezes", () => {
  const verdict = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: {
      ...serving(SHA_B, 1),
      equivalence: {
        verdict: "NOT_EQUIVALENT",
        how: "1 of 2 path(s) in aaaaaaa..bbbbbbb are production-bearing — first is app/api/meetings/route.ts",
      },
    },
  });
  assert.equal(verdict.frozen, true);
  assert.equal(verdict.freshness, "PRODUCTION_MOVED");
  assert.ok(verdict.reason.includes("production-bearing"), "the refusal names the shipping evidence");
});

test("SEEDED (NH289): an UNPROVABLE range is CANNOT_TELL, and CANNOT_TELL freezes", () => {
  const verdict = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: {
      ...serving(SHA_B, 1),
      equivalence: { verdict: "CANNOT_TELL", how: "the history here is too shallow to prove descent" },
    },
  });
  assert.equal(verdict.frozen, true, "unprovable is never equivalent");
  assert.equal(verdict.freshness, "PRODUCTION_MOVED");
});

test("SEEDED (NH289): a DEGRADED reading with a non-shipping child is STILL DEGRADED", () => {
  // Equivalence lives inside rule 4 and rule 4 reaches only readings that
  // HELD. A proof about the range must never soften an active incident.
  const verdict = evaluateReleaseFreeze({
    record: REFUSED,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: {
      ...serving(SHA_B, 1),
      equivalence: { verdict: "EQUIVALENT", how: "the range is exactly the observer's record commit" },
    },
  });
  assert.equal(verdict.frozen, true);
  assert.equal(verdict.state, "DEGRADED", "equivalence cannot reach rule 2");
});

test("SEEDED (NH289): an EXPIRED healthy parent stays expired however equivalent the child", () => {
  const verdict = evaluateReleaseFreeze({
    record: HELD,
    candidateSha: SHA_C,
    changedPaths: APP_CHANGE,
    production: {
      ...serving(SHA_B, MAX_READING_AGE_HOURS + 5),
      equivalence: { verdict: "EQUIVALENT", how: "non-shipping descendant, proven" },
    },
  });
  assert.equal(verdict.frozen, true, "equivalence settles WHICH release; it never resets the clock");
  assert.equal(verdict.freshness, "READING_EXPIRED");
});

test("NH289: the range classifier proves each half and fails toward CANNOT_TELL", () => {
  const RANGE = { recordedSha: SHA_A, servedSha: SHA_B };

  const observer = classifyEquivalenceRange({
    ...RANGE,
    ancestry: "ancestor" as const,
    rangePaths: ["data/ops/production-integrity.json"],
  });
  assert.equal(observer.verdict, "EQUIVALENT", "the observer's own record commit is the founding case");

  const docsChild = classifyEquivalenceRange({ ...RANGE, ancestry: "ancestor", rangePaths: DOCS_ONLY });
  assert.equal(docsChild.verdict, "EQUIVALENT", "a docs-only child is the same application release");

  const identical = classifyEquivalenceRange({ ...RANGE, ancestry: "ancestor", rangePaths: [] });
  assert.equal(identical.verdict, "EQUIVALENT", "identical trees are the same application");

  const appInRange = classifyEquivalenceRange({
    ...RANGE,
    ancestry: "ancestor" as const,
    rangePaths: ["data/ops/production-integrity.json", ...APP_CHANGE],
  });
  assert.equal(appInRange.verdict, "NOT_EQUIVALENT", "one app file anywhere in the range destroys equivalence");

  const schemaInRange = classifyEquivalenceRange({ ...RANGE, ancestry: "ancestor", rangePaths: SCHEMA_CHANGE });
  assert.equal(schemaInRange.verdict, "NOT_EQUIVALENT", "a migration in the range is a shipping change");

  const unrelated = classifyEquivalenceRange({ ...RANGE, ancestry: "not-ancestor", rangePaths: [] });
  assert.equal(unrelated.verdict, "NOT_EQUIVALENT", "identical trees do not rescue a foreign history");

  const shallow = classifyEquivalenceRange({ ...RANGE, ancestry: "unknown", rangePaths: DOCS_ONLY });
  assert.equal(shallow.verdict, "CANNOT_TELL", "unproven descent is unclaimed descent");

  const unreadable = classifyEquivalenceRange({ ...RANGE, ancestry: "ancestor", rangePaths: null });
  assert.equal(unreadable.verdict, "CANNOT_TELL", "an unreadable range is never equivalent");
});
