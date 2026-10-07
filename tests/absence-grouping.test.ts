/** Grouping "no local election" absences: identical statements merge, and no absence is ever dropped. */
import test from "node:test";
import assert from "node:assert/strict";

import { groupAbsences, listNames, splitJurisdiction } from "../lib/ballot/absence-grouping.ts";
import type { BallotAbsence } from "../lib/ballot/types.ts";

const CLERK = {
  sourceOrg: "Morris County Clerk",
  sourceUrl: "https://morriscountyclerk.example/filings",
  collectedAt: "2026-08-25",
} as unknown as BallotAbsence["provenance"];

const noLocal = (ocdId: string, jurisdiction: string, provenance = CLERK): BallotAbsence =>
  ({
    ocdId,
    divisionVintage: "TIGER_GENZ2025",
    statement: `NO LOCAL ELECTION — the Morris County Clerk's 2026 general-election candidate list carries this entry for ${jurisdiction}: no municipal seats are on the November 2026 ballot.`,
    provenance,
  }) as BallotAbsence;

test("BAL-24: two townships collapse to ONE block that names BOTH", () => {
  const grouped = groupAbsences([
    noLocal("ocd-division/country:us/state:nj/county:morris/place:denville", "Denville Township"),
    noLocal("ocd-division/country:us/state:nj/county:morris/place:rockaway", "Rockaway Township"),
  ]);

  assert.equal(grouped.length, 1, "the two blocks did not merge");
  assert.equal(grouped[0].members.length, 2, "a member was dropped — that is a deleted fact");
  assert.match(grouped[0].statement, /Denville Township and Rockaway Township/);
  assert.match(grouped[0].statement, /no municipal seats are on the November 2026 ballot\.$/);
});

test("BAL-24 — THE LOAD-BEARING CASE: nothing is ever dropped", () => {
  const inputs: BallotAbsence[][] = [
    [noLocal("a", "Denville Township"), noLocal("b", "Rockaway Township")],
    [noLocal("a", "Denville Township")],
    [
      noLocal("a", "Denville Township"),
      noLocal("b", "Rockaway Township"),
      noLocal("c", "Mine Hill Township"),
    ],
    [
      noLocal("a", "Denville Township"),
      noLocal("b", "Rockaway Township", {
        ...CLERK,
        collectedAt: "2026-07-01",
      } as unknown as BallotAbsence["provenance"]),
    ],
  ];
  for (const input of inputs) {
    const out = groupAbsences(input);
    const carried = out.flatMap((g) => g.members).map((m) => m.ocdId).sort();
    assert.deepEqual(
      carried,
      input.map((a) => a.ocdId).sort(),
      "an absence vanished between the input and the render",
    );
  }
});

test("BAL-24: a DIFFERENT read date never merges — two dates are two claims", () => {
  const grouped = groupAbsences([
    noLocal("a", "Denville Township"),
    noLocal("b", "Rockaway Township", {
      ...CLERK,
      collectedAt: "2026-07-01",
    } as unknown as BallotAbsence["provenance"]),
  ]);
  assert.equal(grouped.length, 2, "two read dates were collapsed under one citation");
});

test("BAL-24: a DIFFERENT authority never merges", () => {
  const grouped = groupAbsences([
    noLocal("a", "Denville Township"),
    noLocal("b", "Rockaway Township", {
      ...CLERK,
      sourceOrg: "New Jersey Division of Elections",
    } as unknown as BallotAbsence["provenance"]),
  ]);
  assert.equal(grouped.length, 2, "two authorities were collapsed under one citation");
});

test("BAL-24: a sentence that does not carry the shape renders exactly as it did", () => {
  // A statement that cannot be parsed is left alone, never forced into a group.
  const odd = {
    ocdId: "z",
    divisionVintage: "v",
    statement: "The Secretary of State has not published a seat count for this office.",
    provenance: CLERK,
  } as BallotAbsence;
  const grouped = groupAbsences([odd, noLocal("a", "Denville Township")]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].statement, odd.statement, "an unparsable statement was rewritten");
  assert.equal(splitJurisdiction(odd.statement), null);
});

test("BAL-24: names join the way a sentence does", () => {
  assert.equal(listNames(["A"]), "A");
  assert.equal(listNames(["A", "B"]), "A and B");
  assert.equal(listNames(["A", "B", "C"]), "A, B and C");
});
