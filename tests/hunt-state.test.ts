import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MANIFEST_VERSION,
  judgeManifestWalk,
  requiredRouteIds,
} from "../lib/hunt/branch-manifest.ts";
import type { ManifestBranch, ManifestField } from "../lib/hunt/branch-manifest.ts";
import { isEvidencedByBranches } from "../lib/hunt/discovery.ts";
import {
  HUNT_STATES,
  KELLY_FIELDS,
  KELLY_FIELD_NOT_APPLICABLE_WHEN,
  isEvidencedAbsence,
  isEvidencedNotApplicable,
  stateFor,
  statesFor,
} from "../lib/ballot/hunt-state.ts";
import type {
  CandidateHuntFile,
  FieldPresence,
  RecordedFieldState,
} from "../lib/ballot/hunt-state.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "ballot", "candidate-hunt-state.json");

const file = JSON.parse(readFileSync(FILE, "utf8")) as CandidateHuntFile;
const KEYS = Object.keys(file.candidates);

/* ========================================================================== */
/* 2.5 — VERIFIED_ABSENT without rungs and a date is not a finding            */
/* ========================================================================== */

/**
 * `VERIFIED_ABSENT` is a CLAIM ABOUT A NAMED PERSON — "we did the work; this
 * candidate has no campaign site." It is not a convenient way to stop a
 * contest being withheld, and the difference between the two is entirely
 * whether the evidence is on the record.
 *
 * So the same standard the transparency mandate puts on every other claim of
 * absence applies here: the rungs walked, each with its attempt date and what
 * it returned, and the date the hunt completed. A record missing any of that
 * is an assertion of absence wearing a finding's name.
 *
 * This fails in both directions — the committed file is swept, AND the
 * validator is proven to reject each defective shape, because a validator
 * nobody has watched refuse anything is a validator that may not be looking.
 */
test("2.5: no VERIFIED_ABSENT record exists without recorded rungs and a date", () => {
  const offenders: string[] = [];
  for (const key of KEYS) {
    for (const field of KELLY_FIELDS) {
      const record = file.candidates[key]![field];
      if (record.state !== "VERIFIED_ABSENT") continue;
      if (!isEvidencedAbsence(record, field)) offenders.push(`${key}.${field}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "VERIFIED_ABSENT is a finding about a named person and carries the rungs " +
      "walked and the date checked. Without them it is an assertion of absence, " +
      "which is the one thing this product may never render.",
  );
});

/**
 * **RULING 61 (2026-08-21) raised the bar these fixtures are built against.**
 *
 * A full manifest walk, built from the manifest itself rather than transcribed,
 * because a hand-written list of fourteen route ids is a list that goes stale
 * the first time a route is added — and the whole point of the ruling is that
 * adding a route re-opens what was already judged.
 */
function fullManifestWalk(field: ManifestField, on = "2026-08-20"): ManifestBranch[] {
  return requiredRouteIds(field).map((route) => ({
    branch: `walked the ${route} route`,
    through: route,
    attemptedAt: on,
    result: "nothing",
    found: false,
    rung: "2",
    route,
  }));
}

test("2.5: the validator refuses every defective shape — proven by plant", () => {
  const good: RecordedFieldState = {
    state: "VERIFIED_ABSENT",
    checkedAt: "2026-08-20",
    rungs: [
      { rung: "2 plain fetch", attemptedAt: "2026-08-20", result: "404" },
      { rung: "6 live browser", attemptedAt: "2026-08-20", result: "no site found" },
    ],
    // RULING 52 (2026-08-21): two INDEPENDENT branches, going through two
    // different publishers. Rungs alone were never enough — every wrong
    // verdict that produced the ruling had a defensible rung history.
    // RULING 61 (2026-08-21): and two was not enough either. Exhaustion is now
    // EVERY route the manifest names for this field.
    branches: fullManifestWalk("campaignSite"),
    manifestVersion: MANIFEST_VERSION,
  };
  assert.equal(isEvidencedAbsence(good, "campaignSite"), true, "a complete record is accepted");

  const bad: Array<[string, unknown]> = [
    ["no rungs at all", { state: "VERIFIED_ABSENT", checkedAt: "2026-08-20" }],
    [
      "an empty rung list",
      { state: "VERIFIED_ABSENT", checkedAt: "2026-08-20", rungs: [] },
    ],
    [
      "no checkedAt",
      { state: "VERIFIED_ABSENT", rungs: [{ rung: "2", attemptedAt: "2026-08-20", result: "404" }] },
    ],
    [
      "a plausible-looking but unparseable date",
      {
        state: "VERIFIED_ABSENT",
        checkedAt: "August 20",
        rungs: [{ rung: "2", attemptedAt: "2026-08-20", result: "404" }],
      },
    ],
    [
      "a rung with no result",
      {
        state: "VERIFIED_ABSENT",
        checkedAt: "2026-08-20",
        rungs: [{ rung: "2", attemptedAt: "2026-08-20", result: "" }],
      },
    ],
    [
      "a rung with no attempt date",
      {
        state: "VERIFIED_ABSENT",
        checkedAt: "2026-08-20",
        rungs: [{ rung: "2", result: "404" }],
      },
    ],
    // RULING 61's own refusals, each on an otherwise perfect record.
    [
      "a complete walk with no manifest version stamped on it",
      { ...(good as object), manifestVersion: undefined },
    ],
    [
      "a complete walk judged against a superseded manifest",
      { ...(good as object), manifestVersion: "v0" },
    ],
    [
      "branches that walked routes the manifest does not name",
      {
        ...(good as object),
        branches: fullManifestWalk("campaignSite").map((b) => ({ ...b, route: `x-${b.route}` })),
      },
    ],
  ];
  for (const [why, shape] of bad) {
    assert.equal(
      isEvidencedAbsence(shape as RecordedFieldState, "campaignSite"),
      false,
      `refused: ${why}`,
    );
  }
});

test("RULING 61: two independent branches no longer earns VERIFIED_ABSENT", () => {
  /*
   * This is the guard for what the ruling actually CHANGED, and it is written
   * as the old bar passing and the new one refusing, on one record. RULING 52's
   * two-independent-branches record was correct law until 2026-08-21 and there
   * are zero such records in the file, so nothing is grandfathered.
   */
  const twoBranches: RecordedFieldState = {
    state: "VERIFIED_ABSENT",
    checkedAt: "2026-08-20",
    rungs: [{ rung: "2 plain fetch", attemptedAt: "2026-08-20", result: "404" }],
    branches: [
      {
        branch: "the candidate's filing with the Secretary of State",
        through: "sos.nh.gov",
        attemptedAt: "2026-08-20",
        result: "filing carries no website field",
        found: false,
        rung: "2",
        route: "filing-state",
      },
      {
        branch: "the county party's candidate listing",
        through: "merrimackdems.org",
        attemptedAt: "2026-08-20",
        result: "listed with no link",
        found: false,
        rung: "6",
        route: "party-committee-roster",
      },
    ],
    manifestVersion: MANIFEST_VERSION,
  };

  // The RULING 52 bar: still cleanly cleared.
  assert.ok(
    isEvidencedByBranches({
      branches: twoBranches.branches,
      checkedAt: twoBranches.checkedAt,
    }),
    "the fixture must clear the old two-independent-branch bar, or it proves nothing",
  );

  // The RULING 61 bar: refused, and the verdict hands back a work list.
  assert.equal(isEvidencedAbsence(twoBranches, "campaignSite"), false);
  const verdict = judgeManifestWalk({
    field: "campaignSite",
    branches: twoBranches.branches,
    checkedAt: twoBranches.checkedAt,
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(verdict.exhausted, false);
  assert.ok(
    verdict.missing.length >= 10,
    `the reader of a failed exhaustion needs the routes still owed; got ${verdict.missing.length}`,
  );
});

test("RULING 61: adding a route re-opens every absence earned under the old manifest", () => {
  // The retroactive half. Nothing has to remember to go back for these —
  // stamping the version is what makes it automatic.
  const earnedUnderV0: RecordedFieldState = {
    state: "VERIFIED_ABSENT",
    checkedAt: "2026-08-20",
    rungs: [{ rung: "2", attemptedAt: "2026-08-20", result: "404" }],
    branches: fullManifestWalk("photo"),
    manifestVersion: "v0",
  };
  assert.equal(isEvidencedAbsence(earnedUnderV0, "photo"), false);
  assert.equal(
    stateFor(false, earnedUnderV0, "photo"),
    "NOT_HUNTED",
    "and it falls back to 'we have not finished', never forward to 'there is nothing'",
  );
});

test("2.5: an unevidenced VERIFIED_ABSENT reads as NOT_HUNTED, never as a finding", () => {
  // The render-default rule one layer down. If the file ever carries a
  // defective record, the surface must fall back to "we have not finished",
  // never forward to "there is nothing to find".
  const defective = { state: "VERIFIED_ABSENT" } as RecordedFieldState;
  assert.equal(stateFor(false, defective, "photo"), "NOT_HUNTED");
});

test("2.5: a stored FOUND on an absent field never reads as FOUND", () => {
  /*
   * A default may never manufacture a claim. If the file says a photo was
   * found and the data holds no photo, the honest reading is that the hunt
   * is not finished — the file may raise an absent field only as far as
   * VERIFIED_ABSENT, and only on evidence.
   */
  assert.equal(stateFor(false, { state: "FOUND" }, "photo"), "NOT_HUNTED");
  // And presence wins upward whatever the file says.
  assert.equal(stateFor(true, { state: "NOT_HUNTED" }, "photo"), "FOUND");
});

/* ========================================================================== */
/* Item 2 — NOT_APPLICABLE, the fourth state                                  */
/* ========================================================================== */

test("2.1: NOT_APPLICABLE is a legal state and it is the fourth", () => {
  assert.deepEqual([...HUNT_STATES], [
    "NOT_HUNTED",
    "FOUND",
    "VERIFIED_ABSENT",
    "NOT_APPLICABLE",
  ]);
});

test("2.7: NOT_APPLICABLE without a recorded reason and date is refused", () => {
  /*
   * The same evidence discipline VERIFIED_ABSENT carries, for the same reason.
   * "This field cannot exist for this person" is a claim about a named person.
   * A record missing its reason or its date is a GAP wearing a finding's name,
   * and that is the one thing this repo may never render — so it is refused
   * here and reads as NOT_HUNTED at the surface, which is the safe direction.
   */
  const bad: [string, unknown][] = [
    ["no reason at all", { state: "NOT_APPLICABLE", checkedAt: "2026-08-20" }],
    ["an empty reason", { state: "NOT_APPLICABLE", reason: "  ", checkedAt: "2026-08-20" }],
    ["no date", { state: "NOT_APPLICABLE", reason: "never held the office" }],
    [
      "a date that is not a wall-clock stamp",
      { state: "NOT_APPLICABLE", reason: "never held the office", checkedAt: "yesterday" },
    ],
  ];
  for (const [why, shape] of bad) {
    assert.equal(
      isEvidencedNotApplicable(shape as RecordedFieldState),
      false,
      `refused: ${why}`,
    );
    assert.equal(
      stateFor(false, shape as RecordedFieldState, "photo"),
      "NOT_HUNTED",
      `${why} falls back to NOT_HUNTED rather than forward to a finding`,
    );
  }

  const good: RecordedFieldState = {
    state: "NOT_APPLICABLE",
    reason: "the candidate has never held this office, so there is no roll-call record",
    checkedAt: "2026-08-20",
  };
  assert.equal(isEvidencedNotApplicable(good), true);
  assert.equal(stateFor(false, good, "photo"), "NOT_APPLICABLE");
  // Presence still wins upward: a field that is actually there is FOUND.
  assert.equal(stateFor(true, good, "photo"), "FOUND");
});

test("2.2: the structural-availability rule is stated for every Kelly field", () => {
  /*
   * Read off the frozen field matrix (vH-1, 2026-08-16), never decided by a
   * session that wants the denominator smaller. All four read "never", which
   * is why item 2 moved nothing out of the 249.
   */
  for (const field of KELLY_FIELDS) {
    const rule = KELLY_FIELD_NOT_APPLICABLE_WHEN[field];
    assert.ok(rule && rule.length > 0, `${field} states when it does not apply`);
    assert.match(
      rule,
      /^never/,
      `${field}: the frozen matrix says this field always applies to a candidate`,
    );
  }
});

/* ========================================================================== */
/* The migration's own invariants                                             */
/* ========================================================================== */

test("the migration promoted nothing to VERIFIED_ABSENT", () => {
  /*
   * That state is earned by a hunt session and NEVER by a backfill — a
   * migration knows only whether a field is PRESENT, which is a different
   * question from whether anyone looked. This asserts the file as migrated;
   * a later hunt session that legitimately records findings will change this
   * test's expectation, deliberately and by hand, along with the evidence.
   */
  const promoted: string[] = [];
  for (const key of KEYS) {
    for (const field of KELLY_FIELDS) {
      if (file.candidates[key]![field].state === "VERIFIED_ABSENT") {
        promoted.push(`${key}.${field}`);
      }
    }
  }
  // If this ever grows entries, every one must be evidenced — which the 2.5
  // sweep above already enforces. This is the record of what the migration
  // itself produced.
  assert.deepEqual(
    promoted,
    [],
    "nothing may be promoted to VERIFIED_ABSENT by a migration",
  );
});

test("every NOT_APPLICABLE in the file carries its reason and its date", () => {
  // Item 2.3's own record. Nothing moved in Prompt D — the frozen matrix says
  // all four Kelly fields always apply to a candidate — so this is empty
  // today, and it is the gate a later session's move has to pass.
  const bad: string[] = [];
  let count = 0;
  for (const key of KEYS) {
    for (const field of KELLY_FIELDS) {
      const rec = file.candidates[key]![field];
      if (rec.state !== "NOT_APPLICABLE") continue;
      count += 1;
      if (!isEvidencedNotApplicable(rec)) bad.push(`${key}.${field}`);
    }
  }
  assert.deepEqual(bad, [], "a NOT_APPLICABLE without a reason and a date is not a finding");
  console.log(`  NOT_APPLICABLE records in the file: ${count}`);
});

test("every candidate record carries all four fields with a legal state", () => {
  const LEGAL = new Set<string>(HUNT_STATES);
  const bad: string[] = [];
  for (const key of KEYS) {
    const rec = file.candidates[key]!;
    for (const field of KELLY_FIELDS) {
      if (!rec[field] || !LEGAL.has(rec[field].state)) bad.push(`${key}.${field}`);
    }
  }
  assert.deepEqual(bad, [], "a missing or unknown state is not a third answer");
  assert.ok(
    KEYS.length > 100,
    `expected the whole candidate set, found ${KEYS.length} — a migration that ` +
      "wrote almost nothing must not read as a migration that found nothing to do",
  );
});

test("the file's migratedAt is a wall-clock stamp, not a plausible date", () => {
  assert.match(
    file.migratedAt,
    /^\d{4}-\d{2}-\d{2}$/,
    "written by corepack pnpm stamp (America/Phoenix), never typed by hand",
  );
});

/* ========================================================================== */
/* Reconciliation                                                             */
/* ========================================================================== */

test("statesFor reconciles presence against the record, field by field", () => {
  const presence: FieldPresence = {
    photo: true,
    blurb: false,
    contact: false,
    campaignSite: false,
  };
  const states = statesFor(presence, {
    photo: { state: "NOT_HUNTED" },
    blurb: { state: "NOT_HUNTED" },
    contact: { state: "FOUND" },
    // RULING 61: a full manifest walk, built from the manifest so that adding
    // a route re-opens this record rather than leaving it quietly standing.
    campaignSite: {
      state: "VERIFIED_ABSENT",
      checkedAt: "2026-08-20",
      rungs: [{ rung: "2 plain fetch", attemptedAt: "2026-08-20", result: "none" }],
      branches: fullManifestWalk("campaignSite"),
      manifestVersion: MANIFEST_VERSION,
    },
  });
  assert.equal(states.photo, "FOUND", "present beats the record");
  assert.equal(states.blurb, "NOT_HUNTED");
  assert.equal(states.contact, "NOT_HUNTED", "absent can never read FOUND");
  assert.equal(states.campaignSite, "VERIFIED_ABSENT", "evidenced absence stands");
});
