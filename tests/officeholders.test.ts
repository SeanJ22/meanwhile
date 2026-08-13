import assert from "node:assert/strict";
import { test } from "node:test";

import {
  congressSource,
  houseOcdId,
  stateOcdId,
  type CongressLegislator,
} from "../lib/sources/congress/index.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import roster from "../lib/registry/officeholders-us.json" with { type: "json" };

/**
 * The federal roster, against the committed artifact.
 *
 * The thing worth pinning hardest is the **join**. A name rendered against a
 * division that does not exist is the exact failure CLAUDE.md line 17 is for,
 * and the way it happens is not a bad name — it is a plausible identifier that
 * matches nothing. At-large districts are where that was waiting.
 */

const SET = roster as unknown as OfficeholderSet;

const KNOWN_DIVISIONS = new Set(
  (registry as { divisions: { ocdId: string }[] }).divisions.map((d) => d.ocdId),
);

const isStateId = (ocdId: string) =>
  /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId);

test("at-large districts map to cd:at-large, never cd:0", () => {
  // The bulk file numbers an at-large seat 0. This repo calls it `at-large`.
  // `cd:0` matches no division and would silently lose six voting members.
  assert.equal(
    houseOcdId("WY", 0),
    "ocd-division/country:us/state:wy/cd:at-large",
  );
  assert.equal(houseOcdId("AZ", 6), "ocd-division/country:us/state:az/cd:6");
});

test("every at-large link in the roster resolves to a real division", () => {
  const atLarge = SET.divisions.filter((d) => d.ocdId.includes("cd:at-large"));

  assert.equal(atLarge.length, 6, "AK, DE, ND, SD, VT and WY");
  for (const link of atLarge) {
    assert.ok(
      KNOWN_DIVISIONS.has(link.ocdId),
      `${link.ocdId} is not a division in registry.json`,
    );
  }
});

test("no shipped division link is a dead join", () => {
  for (const link of SET.divisions) {
    if (isStateId(link.ocdId)) continue;
    assert.ok(
      KNOWN_DIVISIONS.has(link.ocdId),
      `${link.ocdId} matches no division — a name would render against nothing`,
    );
  }
});

test("seats that matched nothing are reported, not silently dropped", () => {
  // The six non-voting delegates: DC and five territories. Census does not
  // carry their congressional geometry, so the registry has no division.
  assert.equal(SET.unmatched.length, 6);
  for (const entry of SET.unmatched) {
    assert.match(entry.reason, /no division/);
  }
});

test("the division link is many-to-many, which is why it is a join table", () => {
  // Arizona elects two senators to one state division. A single ocdId column
  // on the officeholder would have to drop one of them.
  const azSenators = SET.divisions.filter((d) => d.ocdId === stateOcdId("AZ"));
  assert.equal(azSenators.length, 2);
});

test("a congressional district resolves to exactly one representative", () => {
  const az6 = SET.divisions.filter(
    (d) => d.ocdId === "ocd-division/country:us/state:az/cd:6",
  );
  assert.equal(az6.length, 1);
});

test("every officeholder carries provenance naming where it was read", () => {
  for (const person of SET.officeholders) {
    assert.ok(person.provenance.sourceUrl?.startsWith("https://"));
    assert.ok(person.provenance.sourceOrg.length > 0);
    assert.ok(person.provenance.collectedAt);
    assert.equal(
      person.provenance.verifiedAt,
      null,
      "nothing human has confirmed these rows",
    );
  }
});

test("no photo is shipped without a licence", () => {
  for (const person of SET.officeholders) {
    if (person.photo === null) continue;
    assert.ok(
      person.photo.license,
      `${person.name} has a photo with an unknown licence — not clearable`,
    );
  }
});

test("the roster carries no score, rank, or ordering by fit", () => {
  // CLAUDE.md forbids composite match scores and anything implying a
  // recommendation. This asserts the shape can't quietly grow one.
  const banned = /score|rank|rating|match|fit|grade/i;
  for (const key of Object.keys(SET.officeholders[0])) {
    assert.doesNotMatch(key, banned, `${key} looks evaluative`);
  }
});

test("normalize attaches senators to the state and reps to the district", () => {
  const raw: CongressLegislator[] = [
    {
      id: { bioguide: "S000001" },
      name: { first: "A", last: "Senator", official_full: "A Senator" },
      terms: [
        {
          type: "sen",
          start: "2025-01-03",
          end: "2031-01-03",
          state: "AZ",
          party: "Independent",
        },
      ],
    },
    {
      id: { bioguide: "R000001" },
      name: { first: "A", last: "Rep" },
      terms: [
        {
          type: "rep",
          start: "2025-01-03",
          end: "2027-01-03",
          state: "WY",
          district: 0,
        },
      ],
    },
  ];

  const set = congressSource.normalize(raw, "2026-08-12T00:00:00.000Z");

  assert.equal(set.officeholders.length, 2);
  assert.equal(set.officeholders[0].officeTitle, "U.S. Senator");
  assert.equal(set.officeholders[1].name, "A Rep", "falls back to first + last");

  const ids = set.divisions.map((d) => d.ocdId);
  assert.ok(ids.includes("ocd-division/country:us/state:az"));
  assert.ok(ids.includes("ocd-division/country:us/state:wy/cd:at-large"));
});

test("a House term with no district is reported rather than guessed at", () => {
  const set = congressSource.normalize(
    [
      {
        id: { bioguide: "X000001" },
        name: { first: "No", last: "District" },
        terms: [
          { type: "rep", start: "2025-01-03", end: "2027-01-03", state: "AZ" },
        ],
      },
    ],
    "2026-08-12T00:00:00.000Z",
  );

  assert.equal(set.divisions.length, 0);
  assert.equal(set.unmatched.length, 1);
  assert.match(set.unmatched[0].reason, /no district number/);
});

test("party is carried for display and is the only evaluative-looking field", () => {
  // It exists because the source publishes it and a roster that hides it is
  // less honest, not more. Nothing may infer a position from it.
  const withParty = SET.officeholders.filter((o) => o.partyLabel !== null);
  assert.ok(withParty.length > 0);
});
