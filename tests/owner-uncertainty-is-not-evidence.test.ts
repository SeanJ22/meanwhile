/**
 * **OWNER UNCERTAINTY IS NOT EVIDENCE, IN EITHER DIRECTION.**
 * (Session B closure, 2026-08-31, the author's correction.)
 *
 * ## The mistake this exists to make impossible
 *
 * A Session B report said a reader-suite RED was *"corroborated by the owner's
 * own F2 being COULD NOT TELL"* — reasoning from the owner not having been able
 * to check, to a conclusion about what a government publishes.
 *
 * That is the substitution this whole product refuses, arriving through the
 * answer key rather than through a render: **the absence of a reading became a
 * reading.** `COULD NOT TELL` says one thing and it is about the owner.
 *
 * It was also false, which is the part worth keeping. Walking the routes
 * afterwards found **417 roll calls and 2,083 per-person vote rows** held from
 * that tenant, **285 of them for the exact sitting** the claim was about. The
 * unverified row was cited as support for a statement that measurement
 * contradicted outright.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONFIRMED,
  NON_EVIDENTIARY_STATUSES,
  assertCitableAsEvidence,
  isCitableAsEvidence,
  loadControlFacts,
  type SheetRow,
} from "../lib/health/owner-corpus.ts";

const ROOT = process.cwd();

function row(over: Partial<Record<string, string>> = {}): SheetRow {
  return {
    ID: "F2",
    ZIP: "85701",
    Type: "PRESENT",
    "Fact to verify (drafted — confirm or correct)": "Roll-call votes are published on Legistar.",
    Status: "COULD NOT TELL",
    "Source link (paste)": "https://pima.legistar.com/",
    "Verified through (date)": "46264",
    Notes: "",
    ...over,
  } as SheetRow;
}

test("SEEDED: a COULD NOT TELL row cited as evidence FAILS", () => {
  assert.throws(
    () => assertCitableAsEvidence("F2", "COULD NOT TELL"),
    /may not be cited as evidence/,
  );
  assert.throws(() => assertCitableAsEvidence("F6", ""), /may not be cited as evidence/);
  assert.throws(() => assertCitableAsEvidence("F9", "SKIPPED"), /may not be cited as evidence/);
});

test("the refusal says the weight is zero in BOTH directions", () => {
  /*
   * The message matters as much as the throw. "Not confirmed" invites a reader
   * to treat it as weak evidence of absence, which is the exact reading that
   * produced the mistake.
   */
  try {
    assertCitableAsEvidence("F2", "COULD NOT TELL");
    assert.fail("should have thrown");
  } catch (error) {
    const message = String(error);
    assert.match(message, /EITHER direction/i);
    assert.match(message, /never corroboration of an absence/i);
    assert.match(message, /never corroboration of a presence/i);
  }
});

test("only CONFIRMED is citable, and the non-evidentiary list is closed", () => {
  assert.ok(isCitableAsEvidence(CONFIRMED));
  assert.ok(isCitableAsEvidence(" confirmed "));
  for (const status of NON_EVIDENTIARY_STATUSES) {
    assert.equal(isCitableAsEvidence(status), false, `${JSON.stringify(status)} is not evidence`);
  }
});

test("SEEDED: the loader never admits a non-CONFIRMED row into the answer key", () => {
  const loaded = loadControlFacts([
    row(),
    row({ ID: "F5", Status: "CONFIRMED", "Fact to verify (drafted — confirm or correct)": "Five members." }),
    row({ ID: "F7", Status: "" }),
    row({ ID: "F8", Status: "SKIPPED" }),
  ]);
  assert.deepEqual(loaded.matched, ["F5"], "one row met the criterion, and it is named");
  assert.equal(loaded.loaded.length, 1);
  assert.equal(loaded.seen, 4, "and the denominator states what was looked at");
  for (const r of loaded.rows) {
    assert.ok(isCitableAsEvidence(r.status ?? ""), `${r.id} reached the key without CONFIRMED`);
  }
});

/* ==================================================================== */

test("MEASURED: the Pima roll-call routes are walked, and the counts are the record", () => {
  /*
   * The correction's operative half. Before any statement about what Pima
   * publishes, the routes are walked and counted — and these counts are read
   * off the committed outcomes store rather than asserted in prose.
   *
   * If this file stops holding rolls, the honest reading is that OUR retrieval
   * changed, not that a government stopped publishing. That is why the
   * assertion is a floor and not an equality.
   */
  const outcomes = JSON.parse(
    readFileSync(join(ROOT, "data", "outcomes", "legistar-outcomes.json"), "utf8"),
  ) as {
    sittings: {
      startsAt: string;
      rollCalls?: { votes?: unknown[]; members?: unknown[] }[];
      failedRollCallExtractions?: unknown[];
      routesWalked?: { route?: string }[];
    }[];
  };

  const rows = (s: (typeof outcomes.sittings)[number]): number =>
    (s.rollCalls ?? []).reduce((n, r) => n + ((r.votes ?? r.members ?? []).length), 0);

  const totalRolls = outcomes.sittings.reduce((n, s) => n + (s.rollCalls ?? []).length, 0);
  const totalRows = outcomes.sittings.reduce((n, s) => n + rows(s), 0);

  assert.ok(
    totalRolls > 0 && totalRows > 0,
    `the outcomes store holds ${totalRolls} roll call(s) and ${totalRows} per-person row(s). ` +
      "Zero here would mean OUR retrieval produced nothing — never that the publisher stopped.",
  );

  /* The sitting the claim was about. */
  const aug25 = outcomes.sittings.filter((s) => s.startsAt.slice(0, 10) === "2026-08-25");
  assert.ok(aug25.length > 0, "the 2026-08-25 Board sitting is held");
  const aug25Rows = aug25.reduce((n, s) => n + rows(s), 0);
  assert.ok(
    aug25Rows > 0,
    `2026-08-25 holds ${aug25Rows} per-person vote row(s). "We hold no Pima roll-call votes" was ` +
      "false, and an unverified workbook row was cited as corroboration for it.",
  );

  /*
   * The known OUR-side failure, kept visible rather than tuned away: the
   * attendance item's own roll-call flag says a roll was taken and the votes
   * route returns nothing for it, once per sitting.
   */
  const failed = outcomes.sittings.reduce(
    (n, s) => n + (s.failedRollCallExtractions ?? []).length,
    0,
  );
  assert.ok(
    failed > 0,
    "the attendance-item extraction failure is a FAILED EXTRACTION on our side and is recorded " +
      "as one; it is not licence to say no roll call exists",
  );
});
