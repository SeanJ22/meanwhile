import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **THE FEDERAL ROSTER RECONCILES, AND THE DIFFERENCE IS NAMED ROWS** (Prompt
 * D item 5, 2026-08-20).
 *
 * `docs/officials-audit.md` once stated "531 division-linked of 537"; this
 * fixture now reconciles the current 533-of-539 roster after two special
 * elections seated new voting members.
 * 2026-08-14 and nothing said what the six were. A stated number with an
 * unexplained remainder is a margin, and a margin is where a real loss hides:
 * six people could have been six delegates, or six members our own join
 * dropped, and the document read identically either way.
 *
 * So the six are NAMED here, each with its reason, and the test fails if a
 * seventh appears. Growing the list is a deliberate act with a reason attached
 * — never a tolerance that quietly widens.
 *
 * ## What the six are
 *
 * All six are NON-VOTING members: five Delegates (DC, VI, AS, GU, MP) and one
 * Resident Commissioner (PR). That is a fact about the world and is recorded
 * as one — not a vacancy, not a resignation, not a join loss in our code.
 *
 * ## The mechanism, stated separately from the classification
 *
 * The roster gives each of them a division of the shape
 * `ocd-division/country:us/state:<xx>/cd:at-large`, and `lib/registry` holds no
 * such division: the district geometry comes from Census TIGER congressional
 * districts, which do not enumerate DC or the five territories. So
 * `scripts/build-officeholders.ts` drops the link and RECORDS it in
 * `unmatched` with the id it could not find — the operation-count rule working
 * exactly as intended.
 *
 * The consequence is a reader-visible gap: nobody in DC, Puerto Rico, Guam,
 * the US Virgin Islands, American Samoa or the Northern Mariana Islands can
 * reach their member from a division lookup. That is a COVERAGE row, opened as
 * one, and it is not fixed here — the join is not broken, the divisions do not
 * exist.
 *
 * ## The rest of the arithmetic, so 539 is not a bare number either
 *
 *   539 held = 100 senators + 439 House members
 *   439 House = 433 voting representatives + the 6 non-voting below
 *   533 division-linked = 100 + 433
 *
 * The House floor is 435 voting seats and the roster holds 433 sitting ones,
 * so two seats are vacant on the read date. That is checked as a RANGE rather
 * than a constant, because a special election moves it and a test that failed
 * on a real-world election would be a test people delete.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "lib", "registry", "officeholders-us.json");

interface Officeholder {
  id: string;
  name: string;
  chamber?: string;
  state?: string;
}
interface Division {
  officeholderId: string;
  ocdId: string;
}
interface Unmatched {
  officeholderId: string;
  reason: string;
}

const set = JSON.parse(readFileSync(FILE, "utf8")) as {
  officeholders: Officeholder[];
  divisions: Division[];
  unmatched: Unmatched[];
};

/**
 * The six, by bioguide id, each with what it is. A person leaves this list only
 * when the reason stops being true — a delegate becomes a voting member, or we
 * acquire the territory divisions — and either is a deliberate edit.
 */
const NON_VOTING = new Map<string, string>([
  ["congress:N000147", "Eleanor Holmes Norton — Delegate, District of Columbia (non-voting)"],
  ["congress:P000610", "Stacey E. Plaskett — Delegate, U.S. Virgin Islands (non-voting)"],
  ["congress:R000600", "Aumua Amata Coleman Radewagen — Delegate, American Samoa (non-voting)"],
  ["congress:M001219", "James C. Moylan — Delegate, Guam (non-voting)"],
  ["congress:K000404", "Kimberlyn King-Hinds — Delegate, Northern Mariana Islands (non-voting)"],
  ["congress:H001103", "Pablo José Hernández — Resident Commissioner, Puerto Rico (non-voting)"],
]);

test("item 5: every federal officeholder is division-linked or a NAMED non-voting member", () => {
  const linked = new Set(set.divisions.map((d) => d.officeholderId));
  const unlinked = set.officeholders.filter((o) => !linked.has(o.id));

  const unexplained = unlinked
    .filter((o) => !NON_VOTING.has(o.id))
    .map((o) => `${o.id} ${o.name}`);
  assert.deepEqual(
    unexplained,
    [],
    "a federal member with no division and no recorded reason is a loss, not a margin — " +
      "name it here with what it is, or fix the join",
  );

  // And the other direction: a name on the list that is no longer unlinked has
  // stopped being true, and a list that keeps stale entries becomes permission
  // for whatever turns up under the same shape.
  const stale = [...NON_VOTING.keys()].filter((id) => linked.has(id));
  assert.deepEqual(stale, [], "these are division-linked now and must leave the list");

  assert.equal(unlinked.length, NON_VOTING.size, "the remainder is exactly the named six");
});

test("item 5: the counts reconcile — 533 + 6 = 539, stated as a pair", () => {
  const linked = new Set(set.divisions.map((d) => d.officeholderId));
  const linkedCount = set.officeholders.filter((o) => linked.has(o.id)).length;

  assert.equal(
    linkedCount + NON_VOTING.size,
    set.officeholders.length,
    `${linkedCount} division-linked + ${NON_VOTING.size} named non-voting must equal ` +
      `${set.officeholders.length} held — a stated N that does not reconcile with its ` +
      "own parts is a second opinion presented as arithmetic",
  );

  const senate = set.officeholders.filter((o) => o.chamber === "senate").length;
  const house = set.officeholders.filter((o) => o.chamber === "house").length;
  assert.equal(senate, 100, "the Senate is 100 seats and the roster holds all of them");
  assert.equal(senate + house, set.officeholders.length, "every member has a chamber");

  // The voting House, checked as a range: 435 is the floor and vacancies move
  // with special elections. A test that failed on a real-world election is a
  // test people delete.
  const votingHouse = house - NON_VOTING.size;
  assert.ok(
    votingHouse <= 435 && votingHouse >= 425,
    `${votingHouse} voting representatives — at or below the 435-seat floor, and ` +
      `${435 - votingHouse} vacancy(ies) is a plausible number. Outside this range, ` +
      "something structural has changed and the roster needs reading rather than trusting.",
  );
});

test("item 5: every dropped division is recorded with the id it could not find", () => {
  /*
   * The operation-count rule, on the join itself. A build that dropped a link
   * and said nothing would be indistinguishable from a build that had nothing
   * to drop, and the six would be invisible rather than merely unexplained.
   */
  assert.equal(
    set.unmatched.length,
    NON_VOTING.size,
    "the build records one unmatched entry per dropped link",
  );
  for (const u of set.unmatched) {
    assert.ok(
      NON_VOTING.has(u.officeholderId),
      `${u.officeholderId} was dropped and is not on the named list`,
    );
    assert.match(
      u.reason,
      /no division ocd-division\/country:us\/state:[a-z]{2}\/cd:at-large in registry/,
      "the reason names the exact division id the registry does not hold",
    );
  }
});
