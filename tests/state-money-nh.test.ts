import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import { isRenderable, type StateMoneySnapshot } from "../lib/funding/state-money.ts";

/**
 * **NEW HAMPSHIRE MONEY, ON THE 03255 BALLOT.** (Session C, 2026-08-31.)
 *
 * The snapshot is acquired data, not a fixture: `pnpm money:nh` reads the
 * Secretary of State's Campaign Finance System and writes it. These guards
 * exist because the file can go stale, be regenerated wrongly, or be replaced
 * by a run against a different year, and every one of those failures renders
 * as a confident number on a named person's card.
 *
 * The claims here are about SHAPE and SAFETY, never about amounts — an amount
 * is the state's to publish and ours to reproduce, and pinning one here would
 * fail honestly every time the state updated it.
 */

const SNAPSHOT = join(ROOT, "data", "funding", "state-money-nh-2026.json");
const BALLOT = join(ROOT, "data", "ballot", "nh-merrimack-2026.json");

function snapshot(): StateMoneySnapshot {
  return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
}

test("the NH snapshot exists and is the shape the loader names", () => {
  assert.ok(
    existsSync(SNAPSHOT),
    "lib/funding/state-snapshot.ts names state-money-nh-2026.json; without the file the ballot silently loses NH money",
  );
  const s = snapshot();
  assert.equal(s.formatVersion, 1);
  assert.equal(s.cycle, 2026);
  assert.ok(s.records.length > 0, "a snapshot with no records is a failed run, not an empty state");
  for (const r of s.records) {
    assert.equal(r.jurisdiction, "NH", "a NH snapshot may not carry another state's records");
    assert.equal(r.dataClass, "STATE_COMMITTEE");
    assert.ok(r.checkedAt, "every record states when it was read");
    assert.ok(r.provenance?.sourceOrg, "every record names the body that published it");
  }
});

test("an absence is never a zero, and a filing always carries a figure", () => {
  for (const r of snapshot().records) {
    if (r.filingState === "NO_REPORTS_ON_FILE") {
      /*
       * THE FALSE-ZERO RULE, at the data layer. "No reports on file" is a
       * statement about the REGISTRY, and rendering it as $0 would be a claim
       * about a named person's campaign that nobody made.
       */
      assert.equal(r.totals.receipts, null, `${r.targetKeys[0]}: an absence may not state receipts`);
      assert.equal(
        r.totals.expenditures,
        null,
        `${r.targetKeys[0]}: an absence may not state expenditures`,
      );
    }
    if (r.filingState === "FILED") {
      assert.ok(
        r.totals.receipts !== null || r.totals.expenditures !== null,
        `${r.targetKeys[0]}: a FILED record with no figure at all is not a filing`,
      );
      assert.ok(r.committeeId, "a filing is joined by committee id, never by a name string");
    }
    // Cash on hand is not published on this endpoint. Null, never 0.
    assert.equal(r.totals.cashOnHand, null, "the CFS filer record publishes no cash-on-hand");
  }
});

test("a LEAD never reaches a reader, and only a confirmed match carries a target", () => {
  for (const r of snapshot().records) {
    if (r.filingState === "LEAD") {
      assert.equal(isRenderable(r), false, "RULING 118: a LEAD never renders");
      assert.deepEqual(r.targetKeys, [], "a LEAD may not claim a candidate");
    }
    /*
     * A record may claim a candidate in exactly two ways, and they are
     * different claims:
     *
     * - It NAMES A COMMITTEE, and then name, office and year must all agree —
     *   otherwise it is somebody else's money on this person's card.
     * - It names NO committee, which is the sourced dated absence. There is
     *   nothing for it to agree with, and demanding agreement would forbid the
     *   product from ever saying "we asked and they hold nothing".
     */
    if (r.targetKeys.length > 0 && r.committeeId !== null) {
      assert.equal(
        r.match.allThreeAgree,
        true,
        `${r.targetKeys[0]}: a record naming a committee may only claim a candidate when name, office and year agree`,
      );
    }
    if (r.targetKeys.length > 0 && r.committeeId === null) {
      assert.equal(
        r.filingState,
        "NO_REPORTS_ON_FILE",
        `${r.targetKeys[0]}: a record with no committee can only be a sourced absence`,
      );
      assert.match(
        r.match.note,
        /searched|holds no/i,
        `${r.targetKeys[0]}: an absence must say what was asked and when`,
      );
    }
  }
});

test("every claimed target is a real candidacy, and no federal seat is claimed", () => {
  const ballot = JSON.parse(readFileSync(BALLOT, "utf8")) as {
    contests: { id: string; title: string }[];
    candidacies: { id: string; contestId: string }[];
  };
  const contestOf = new Map(ballot.candidacies.map((c) => [c.id, c.contestId]));
  const titleOf = new Map(ballot.contests.map((c) => [c.id, c.title]));

  let claimed = 0;
  for (const r of snapshot().records) {
    for (const key of r.targetKeys) {
      claimed += 1;
      const contestId = contestOf.get(key);
      assert.ok(contestId, `${key} is not a candidacy on the NH ballot`);
      const title = titleOf.get(contestId) ?? "";
      /*
       * A candidate for Congress files with the FEC, and this product already
       * reads FEC money on those cards. A state regulator's silence about a
       * federal seat is not an absence — it is the wrong question, and
       * recording it would manufacture a gap.
       */
      assert.doesNotMatch(
        title,
        /United States Senator|Representative in Congress/,
        `${key}: a federal seat may not carry a state-committee record`,
      );
    }
  }
  assert.ok(claimed > 0, "a snapshot claiming no candidacy at all has not been joined to the ballot");
});
