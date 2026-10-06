import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEY_VOTE_PICKS, pickedKeyVotesFor, validKeyVotePicks } from "../lib/votes/key-vote-picks.ts";
import type { MemberVote, RollCallVote } from "../lib/votes/types.ts";

const roll = (id: string): RollCallVote => ({
  id, chamber: id.startsWith("house") ? "house" : "senate", congress: 119, session: 2, rollNumber: 5, date: "2026-03-01",
  title: "A bill", titleSource: "BILL_TITLE", question: "On Passage", legisNum: "H.R. 1", result: "Passed 218–210",
  billUrl: null, rollCallUrl: "https://clerk.house.gov/x", retrievedAt: "2026-03-02",
});

test("the product never picks: the default is empty", () => {
  assert.deepEqual(DEFAULT_KEY_VOTE_PICKS, []);
});

test("validation accepts roll ids with a note and refuses repeats, strays and long notes", () => {
  assert.ok(validKeyVotePicks([{ rollId: "house:119-2:5", why: "Sets the budget" }, { rollId: "senate:119-2:31" }]));
  assert.ok(!validKeyVotePicks([{ rollId: "house:119-2:5" }, { rollId: "house:119-2:5" }]));
  assert.ok(!validKeyVotePicks([{ rollId: "not-a-roll" }]));
  assert.ok(!validKeyVotePicks([{ rollId: "house:119-2:5", score: 3 }]));
  assert.ok(!validKeyVotePicks([{ rollId: "house:119-2:5", why: "x".repeat(241) }]));
});

test("a member sees only their own chamber's picks, with a missing position left as a gap", () => {
  const picks = [{ rollId: "house:119-2:5", why: "Budget" }, { rollId: "senate:119-2:9" }, { rollId: "house:119-2:77" }];
  const positions: MemberVote[] = [{ officeholderId: "congress:A000001", voteId: "house:119-2:5", position: "YES" }];
  const rows = pickedKeyVotesFor(picks, "house", [roll("house:119-2:5")], positions, "congress:A000001");
  assert.deepEqual(rows.map((r) => r.rollId), ["house:119-2:5", "house:119-2:77"]);
  assert.equal(rows[0].position, "YES");
  assert.equal(rows[0].why, "Budget");
  assert.equal(rows[1].held, false);
  assert.equal(rows[1].position, null);
  assert.deepEqual(pickedKeyVotesFor(picks, null, [], [], "congress:A000001"), []);
});
