import assert from "node:assert/strict";
import test from "node:test";

import { BODY_ROSTERS } from "./fixtures/held-body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

// A party never ships without the record it was read from, never the office's own page; a null party names its gap.
test("M61: no statewide executive carries a party without its record, and no null is silent", () => {
  assert.ok(
    STATEWIDE_EXECUTIVES.length >= 3,
    `the store holds ${STATEWIDE_EXECUTIVES.length} statewide executives — a shrunken store is a lost corpus`,
  );

  let withParty = 0;
  for (const exec of STATEWIDE_EXECUTIVES) {
    const { partyLabel } = exec.holder;
    if (!partyLabel) {
      assert.ok(
        exec.partyAbsence && exec.partyAbsence.length > 40,
        `${exec.holder.name}: no party and no stated reason — a bare null is the M61 defect, ` +
          "which was a card rendering nothing while a record existed somewhere",
      );
      assert.ok(
        !exec.partySourceUrl,
        `${exec.holder.name}: cites a party record while carrying no party`,
      );
      continue;
    }
    withParty += 1;
    assert.ok(
      exec.partySourceUrl && /^https:\/\//.test(exec.partySourceUrl),
      `${exec.holder.name}: party "${partyLabel}" with no source record`,
    );
    assert.ok(
      exec.partySourceOrg && exec.partySourceOrg.length > 8,
      `${exec.holder.name}: party source has no publishing organisation`,
    );
    // The office's own page does not state a party, so it is never a party source.
    assert.notEqual(
      exec.partySourceUrl,
      exec.sourceUrl,
      `${exec.holder.name}: cites the office page for party, which does not publish it`,
    );
  }

  // A floor, so a store that stopped holding parties cannot pass by holding nothing.
  assert.ok(withParty >= 3, `only ${withParty} statewide executives carry a party`);
});

test("M61: every governor carries a party, and the record it came from", () => {
  const governors = STATEWIDE_EXECUTIVES.filter((e) => e.holder.officeTitle === "Governor");
  assert.equal(governors.length, 3, "AZ, NJ, NH");
  for (const governor of governors) {
    assert.ok(governor.holder.partyLabel, `${governor.holder.name}: governor with no party`);
    assert.ok(
      governor.partySourceUrl && /^https:\/\//.test(governor.partySourceUrl),
      `${governor.holder.name}: party with no source record`,
    );
    assert.notEqual(
      governor.partySourceUrl,
      governor.sourceUrl,
      `${governor.holder.name}: cites the office page for party, which does not publish it`,
    );
  }
});

test("M61: every roster states whether its seats carry a party", () => {
  assert.ok(BODY_ROSTERS.length >= 12, `only ${BODY_ROSTERS.length} rosters`);
  for (const roster of BODY_ROSTERS) {
    assert.ok(
      ["PARTISAN", "NONPARTISAN", "UNDETERMINED"].includes(roster.partisanship),
      `${roster.bodyId}: no partisanship recorded`,
    );
    // UNDETERMINED is the open state and cites nothing by definition.
    if (roster.partisanship !== "UNDETERMINED") {
      assert.ok(
        roster.partisanshipSourceUrl,
        `${roster.bodyId}: claims ${roster.partisanship} with no record`,
      );
    }
    // No party on a body recorded as nonpartisan, nor one without its own record.
    for (const member of roster.members) {
      if (member.partyLabel) {
        assert.notEqual(
          roster.partisanship,
          "NONPARTISAN",
          `${member.name}: party on a body recorded as nonpartisan`,
        );
        assert.ok(
          member.partySourceUrl,
          `${member.name}: party "${member.partyLabel}" with no source record`,
        );
      }
    }
  }
});

/** Anything a party may NOT be read from, however convenient. */
const FORBIDDEN_PARTY_SOURCES = [
  "democrats.org",
  "gop.com",
  "democraticparty",
  "republicanparty",
  "ballotpedia.org",
  "wikipedia.org",
  "vote411.org",
  "facebook.com",
  "twitter.com",
  "x.com",
];

// Rosters whose partisanship is still open: declared work items, never exemptions. UNDETERMINED renders nothing.
const PARTISANSHIP_STILL_OPEN: readonly string[] = [];

test("M62: every roster is settled, or is a DECLARED open partisanship item", () => {
  // An UNDETERMINED roster must be declared, so it stays visible as owed.
  const undetermined = BODY_ROSTERS.filter(
    (r) => r.partisanship === "UNDETERMINED",
  ).map((r) => r.bodyId);

  const undeclared = undetermined.filter(
    (id) => !PARTISANSHIP_STILL_OPEN.includes(id),
  );
  assert.deepEqual(
    undeclared,
    [],
    `${undeclared.length} roster(s) are UNDETERMINED without being declared open — ` +
      `add them to PARTISANSHIP_STILL_OPEN with the reason, or source the record`,
  );

  // And the list may not rot: an entry that has since been settled is removed.
  const stale = PARTISANSHIP_STILL_OPEN.filter((id) => !undetermined.includes(id));
  assert.deepEqual(
    stale,
    [],
    `${stale.length} declared-open roster(s) are no longer UNDETERMINED — settled, so delete the entry`,
  );

  // A settled answer still has to cite what settled it.
  for (const roster of BODY_ROSTERS) {
    if (roster.partisanship === "UNDETERMINED") continue;
    assert.ok(
      roster.partisanshipSourceUrl,
      `${roster.bodyId}: claims ${roster.partisanship} with no record`,
    );
  }

  // Stated with its denominator.
  const settled = BODY_ROSTERS.filter((r) => r.partisanshipSourceUrl).length;
  assert.equal(
    settled,
    BODY_ROSTERS.length - undetermined.length,
    `${settled} of ${BODY_ROSTERS.length} rosters cite a partisanship record, with ${undetermined.length} declared open`,
  );
  assert.ok(
    settled >= 12,
    `only ${settled} rosters are settled — M62 walked twelve and none may regress`,
  );
});

test("M62: every party on a curated local is dated and read from an election authority", () => {
  let held = 0;
  let members = 0;

  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members) {
      members++;
      if (!member.partyLabel) continue;
      held++;

      assert.ok(
        member.partySourceUrl?.startsWith("https://"),
        `${member.name}: party with no https record`,
      );
      // An undated party cannot be aged.
      assert.ok(
        /^\d{4}-\d{2}-\d{2}$/.test(member.partyCollectedAt ?? ""),
        `${member.name}: party with no collectedAt`,
      );
      assert.ok(
        (member.partySourceOrg ?? "").length > 10,
        `${member.name}: party with no publishing body named`,
      );

      const url = (member.partySourceUrl ?? "").toLowerCase();
      for (const bad of FORBIDDEN_PARTY_SOURCES) {
        assert.ok(
          !url.includes(bad),
          `${member.name}: party read from ${bad} — certified results or silence`,
        );
      }
    }
  }

  // The denominator, printed on every run.
  console.log(`\n  party  ${held} of ${members} curated local member(s) carry a party\n`);
  assert.ok(
    held >= 30,
    `only ${held} of ${members} curated local members carry a party — M62 landed 30`,
  );
});

test("M62: an appointed member on a partisan body renders no party", () => {
  // Appointed members have no certified result naming a party, so neither may carry one.
  const appointed = ["roster:pima#5", "roster:rockaway#1"];
  for (const id of appointed) {
    const member = BODY_ROSTERS.flatMap((r) => r.members).find((m) => m.id === id);
    assert.ok(member, `${id} is gone from the rosters — update this guard with it`);
    assert.ok(
      !member.partyLabel,
      `${member.name}: carries a party with no certified result behind it`,
    );
  }
});
