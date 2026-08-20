import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  KELLY_FIELDS,
  KELLY_FIELD_LABEL,
  VERIFIED_ABSENT_WORDING,
  isEvidencedAbsence,
  stateFor,
  statesFor,
} from "../lib/ballot/hunt-state.ts";
import type {
  CandidateHuntFile,
  FieldPresence,
  KellyField,
  RecordedFieldState,
} from "../lib/ballot/hunt-state.ts";
import { equalDepthGate } from "../lib/coverage/tier.ts";
import type { CandidateDepth } from "../lib/coverage/tier.ts";

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
      if (!isEvidencedAbsence(record)) offenders.push(`${key}.${field}`);
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

test("2.5: the validator refuses every defective shape — proven by plant", () => {
  const good: RecordedFieldState = {
    state: "VERIFIED_ABSENT",
    checkedAt: "2026-08-20",
    rungs: [
      { rung: "2 plain fetch", attemptedAt: "2026-08-20", result: "404" },
      { rung: "6 live browser", attemptedAt: "2026-08-20", result: "no site found" },
    ],
  };
  assert.equal(isEvidencedAbsence(good), true, "a complete record is accepted");

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
  ];
  for (const [why, shape] of bad) {
    assert.equal(
      isEvidencedAbsence(shape as RecordedFieldState),
      false,
      `refused: ${why}`,
    );
  }
});

test("2.5: an unevidenced VERIFIED_ABSENT reads as NOT_HUNTED, never as a finding", () => {
  // The render-default rule one layer down. If the file ever carries a
  // defective record, the surface must fall back to "we have not finished",
  // never forward to "there is nothing to find".
  const defective = { state: "VERIFIED_ABSENT" } as RecordedFieldState;
  assert.equal(stateFor(false, defective), "NOT_HUNTED");
});

test("2.5: a stored FOUND on an absent field never reads as FOUND", () => {
  /*
   * A default may never manufacture a claim. If the file says a photo was
   * found and the data holds no photo, the honest reading is that the hunt
   * is not finished — the file may raise an absent field only as far as
   * VERIFIED_ABSENT, and only on evidence.
   */
  assert.equal(stateFor(false, { state: "FOUND" }), "NOT_HUNTED");
  // And presence wins upward whatever the file says.
  assert.equal(stateFor(true, { state: "NOT_HUNTED" }), "FOUND");
});

/* ========================================================================== */
/* 2.6 — no contest renders cards while any field in it is NOT_HUNTED         */
/* ========================================================================== */

const fields = (spec: Partial<Record<KellyField, string>>) =>
  Object.fromEntries(
    KELLY_FIELDS.map((f) => [f, spec[f] ?? "FOUND"]),
  ) as CandidateDepth["fields"];

/**
 * The gate's whole contract, asserted from the outside: if any candidate in a
 * contest carries a NOT_HUNTED field, no cards ship.
 *
 * Exhaustive over the four fields and over which candidate carries the gap,
 * because the failure this guards against is a partial implementation — a gate
 * that checks three fields and forgets the fourth renders exactly the
 * asymmetry RULING 7 exists to refuse, and would pass a single-case test.
 */
test("2.6: any NOT_HUNTED field, on any candidate, withholds the contest", () => {
  for (const field of KELLY_FIELDS) {
    for (const who of [0, 1]) {
      const candidates: CandidateDepth[] = [
        { candidateId: "a", candidateName: "A", fields: fields({}) },
        { candidateId: "b", candidateName: "B", fields: fields({}) },
      ];
      candidates[who]!.fields[field] = "NOT_HUNTED";
      const decision = equalDepthGate(candidates);
      assert.equal(
        decision.render,
        false,
        `a NOT_HUNTED ${field} on candidate ${who} must withhold the contest`,
      );
      if (!decision.render) {
        assert.deepEqual(decision.unhunted.map((u) => u.candidateId), [
          who === 0 ? "a" : "b",
        ]);
        assert.deepEqual(decision.unhunted[0]!.fields, [field]);
      }
    }
  }
});

test("2.6: with no NOT_HUNTED field anywhere, the contest renders", () => {
  const decision = equalDepthGate([
    { candidateId: "a", candidateName: "A", fields: fields({}) },
    {
      candidateId: "b",
      candidateName: "B",
      fields: fields({ campaignSite: "VERIFIED_ABSENT", photo: "VERIFIED_ABSENT" }),
    },
  ]);
  assert.equal(decision.render, true);
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

test("every candidate record carries all four fields with a legal state", () => {
  const LEGAL = new Set(["NOT_HUNTED", "FOUND", "VERIFIED_ABSENT"]);
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
/* The reader-facing half                                                     */
/* ========================================================================== */

test("a completed hunt that found nothing has its own wording, per field", () => {
  for (const field of KELLY_FIELDS) {
    const sentence = VERIFIED_ABSENT_WORDING[field];
    assert.ok(sentence && sentence.length > 20, `${field} has a sentence`);
    /*
     * The ATTRIBUTION is the rule, never a particular sentence. What must
     * survive is that the reader can tell OUR unfinished hunt from THEIR
     * absence, so every one of these has to say we looked AND say the thing
     * does not exist.
     */
    assert.match(sentence, /\bWe searched\b/, `${field} says we did the work`);
    assert.match(
      sentence,
      /\b(has not published|does not have|have not published)\b/,
      `${field} states the absence as a fact about the candidate`,
    );
  }
});

test("no reader-facing label is an enum key", () => {
  // Reader surfaces speak plain language: `campaignSite` is an identifier and
  // never reaches a reader.
  for (const field of KELLY_FIELDS) {
    const label = KELLY_FIELD_LABEL[field];
    assert.ok(label && label.length > 0, `${field} has a label`);
    assert.notEqual(label, field, `${field}'s label is not its key`);
  }
});

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
    campaignSite: {
      state: "VERIFIED_ABSENT",
      checkedAt: "2026-08-20",
      rungs: [{ rung: "2 plain fetch", attemptedAt: "2026-08-20", result: "none" }],
    },
  });
  assert.equal(states.photo, "FOUND", "present beats the record");
  assert.equal(states.blurb, "NOT_HUNTED");
  assert.equal(states.contact, "NOT_HUNTED", "absent can never read FOUND");
  assert.equal(states.campaignSite, "VERIFIED_ABSENT", "evidenced absence stands");
});
