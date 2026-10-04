import assert from "node:assert/strict";
import test from "node:test";

import { composeHistoricalVotes, historicalVoteItems, voteIsBy } from "../lib/ask/meeting-history-votes.ts";
import type { PersistedSittingOutcomes } from "../lib/outcomes/types.ts";

const prov = (endpoint: string) => ({ endpoint, sourceOrg: "City Clerk", readOn: "2026-09-01T00:00:00.000Z" });

function sitting(meetingId: string, startsAt: string, title: string, votes: Array<[string, string]>, result: string | null): PersistedSittingOutcomes {
  return {
    meetingId, bodyId: "body:board", ocdId: null, slug: "board", eventId: 1, bodyName: "Board of Supervisors", jurisdiction: "County",
    startsAt, sourceOrg: "City Clerk", sourceUrl: null,
    agenda: [{ recordClass: "AGENDA", eventItemId: 7, eventId: 1, sequence: 1, agendaNumber: "7", title, matterFile: null, matterType: null, provenance: prov("https://clerk.example/agenda") }],
    outcomes: [{ recordClass: "ACTION_SUMMARY", eventItemId: 7, dispositionRaw: result } as never],
    rollCalls: [{ recordClass: "ROLL_CALL", eventItemId: 7, votes: votes.map(([personName, value], i) => ({ personName, personId: i, value, sort: i })), provenance: prov(`https://clerk.example/votes/${meetingId}`) }],
  } as unknown as PersistedSittingOutcomes;
}

const held = [
  sitting("m-new", "2026-08-04T09:00:00-07:00", "Adopt the Library Budget", [["Ana Reyes", "Aye"], ["Bo Chen", "Nay"]], "Pass"),
  sitting("m-old", "2025-03-04T09:00:00-07:00", "Approve the Library Budget for fiscal year 2026", [["Ana Reyes", "Aye"], ["Bo Chen", "Aye"]], "Pass"),
  sitting("m-other", "2025-01-10T09:00:00-07:00", "Road repair contract", [["Ana Reyes", "Aye"]], "Pass"),
];

test("a vote more than 120 days old is found with no date window", () => {
  const items = historicalVoteItems(held, { person: null, topic: "the library budget" });
  assert.deepEqual(items.map((i) => i.meetingId), ["m-new", "m-old"]);
});

test("a named member's own word on each item, newest first, in the publisher's words", () => {
  const items = historicalVoteItems(held, { person: "Supervisor Chen", topic: "library budget" });
  assert.deepEqual(items.map((i) => [i.date, i.votes[0].value]), [["2026-08-04", "Nay"], ["2025-03-04", "Aye"]]);
  const out = composeHistoricalVotes({ person: "Supervisor Chen", bodyName: "the board", topic: "library budget", items })!;
  assert.match(out.answer, /On March 4th, 2025, Bo Chen voted Aye on "Approve the Library Budget for fiscal year 2026"/);
  assert.match(out.answer, /We hold 2 matching recorded vote items for Supervisor Chen, from March 4th, 2025 to August 4th, 2026/);
  assert.deepEqual(out.citedUrls, ["https://clerk.example/votes/m-new", "https://clerk.example/votes/m-old"]);
});

test("the body's answer lists each recorded word by member and never sums", () => {
  const items = historicalVoteItems(held, { person: null, topic: "library budget" });
  const out = composeHistoricalVotes({ person: null, bodyName: "the board", topic: "library budget", items })!;
  assert.match(out.answer, /the recorded votes were Aye: Ana Reyes; Nay: Bo Chen/);
  assert.doesNotMatch(out.answer, /\b\d+-\d+\b/);
});

test("nothing matching, or a topic with no content word, is the writer's", () => {
  assert.equal(composeHistoricalVotes({ person: null, bodyName: "x", topic: "zoning", items: historicalVoteItems(held, { person: null, topic: "zoning" }) }), null);
  assert.deepEqual(historicalVoteItems(held, { person: null, topic: "the" }), []);
});

test("a surname inside a longer one never matches the member", () => {
  assert.equal(voteIsBy("Bo Chen", "Chen"), true);
  assert.equal(voteIsBy("Bo Chenoweth", "Chen"), false);
  assert.equal(voteIsBy("Mayor", "Mayor"), false);
});
