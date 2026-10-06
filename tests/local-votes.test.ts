import assert from "node:assert/strict";
import test from "node:test";

import { identityWords, linkLocalVotes, localVotesForMember, rosterMemberForVoter, voteMeetsMinimum, type LocalVoteRosterFor } from "../lib/outcomes/local-votes.ts";
import { composeLocalMemberVotes } from "../lib/ask/person-votes.ts";
import type { PersistedSittingOutcomes } from "../lib/outcomes/types.ts";

const prov = (endpoint: string) => ({ endpoint, sourceOrg: "City Clerk", readOn: "2026-09-01T00:00:00.000Z" });

function sitting(meetingId: string, bodyId: string | null, startsAt: string, title: string, votes: Array<[string | null, string | null]>, sourceUrl: string | null = `https://clerk.example/${meetingId}`): PersistedSittingOutcomes {
  return {
    meetingId, bodyId, ocdId: null, slug: "council", eventId: 1, bodyName: "City Council", jurisdiction: "City", startsAt, sourceOrg: "City Clerk", sourceUrl,
    agenda: [{ recordClass: "AGENDA", eventItemId: 7, eventId: 1, sequence: 1, agendaNumber: "7", title, matterFile: null, matterType: null, provenance: prov("https://clerk.example/agenda") }],
    outcomes: [{ recordClass: "ACTION_SUMMARY", eventItemId: 7, dispositionRaw: "Passed" } as never],
    rollCalls: [{ recordClass: "ROLL_CALL", eventItemId: 7, votes: votes.map(([personName, value], i) => ({ personName, personId: i, value, sort: i })), provenance: prov(`https://clerk.example/votes/${meetingId}`) }],
  } as unknown as PersistedSittingOutcomes;
}

const rosters: Record<string, { id: string; name: string }[]> = {
  "body:council": [{ id: "roster:body:council#0", name: "Regina Romero" }, { id: "roster:body:council#1", name: "Bo Chen" }, { id: "roster:body:council#2", name: "Ana Reyes" }],
  "body:twins": [{ id: "roster:body:twins#0", name: "Pat Lee" }, { id: "roster:body:twins#1", name: "Pat Lee" }],
};
const rosterFor: LocalVoteRosterFor = (bodyId) => rosters[bodyId] ?? [];

test("a voter joins the roster member on the same body by whole name words, in any order", () => {
  assert.equal(rosterMemberForVoter("Romero, Regina", rosters["body:council"]!)?.id, "roster:body:council#0");
  assert.equal(rosterMemberForVoter("Mayor Regina Romero", rosters["body:council"]!)?.id, "roster:body:council#0");
  assert.equal(rosterMemberForVoter("Regina M. Romero", rosters["body:council"]!)?.id, "roster:body:council#0");
  assert.deepEqual(identityWords("Councilmember Bo Chen Jr."), ["bo", "chen"]);
});

test("a surname alone, a longer surname, an unknown voter and a name two members share join nobody", () => {
  assert.equal(rosterMemberForVoter("Romero", rosters["body:council"]!), null);
  assert.equal(rosterMemberForVoter("Bo Chenoweth", rosters["body:council"]!), null);
  assert.equal(rosterMemberForVoter("Zed Quill", rosters["body:council"]!), null);
  assert.equal(rosterMemberForVoter("Pat Lee", rosters["body:twins"]!), null);
});

test("each linked vote is a VOTE record at the minimum, in the publisher's word, with its sitting as the source", () => {
  const link = linkLocalVotes([
    sitting("m1", "body:council", "2026-08-04T09:00:00-07:00", "Adopt the Library Budget", [["Romero, Regina", "Aye"], ["Bo Chen", "Nay"], ["Visiting Guest", "Aye"], [null, "Aye"]]),
  ], rosterFor);
  assert.equal(link.considered, 3);
  assert.equal(link.unlinked, 1);
  assert.equal(link.records.length, 2);
  const mayor = localVotesForMember(link.records, "roster:body:council#0");
  assert.deepEqual(mayor.map((v) => [v.person, v.position, v.subject, v.date, v.result, v.sourceUrl]),
    [["Regina Romero", "Aye", "Adopt the Library Budget", "2026-08-04", "Passed", "https://clerk.example/m1"]]);
  assert.ok(link.records.every(voteMeetsMinimum));
});

test("a same-named person on another body is never joined, and a sitting with no body or page links nothing", () => {
  const link = linkLocalVotes([
    sitting("m2", "body:other", "2026-08-04T09:00:00-07:00", "Item", [["Regina Romero", "Aye"]]),
    sitting("m3", null, "2026-08-04T09:00:00-07:00", "Item", [["Regina Romero", "Aye"]]),
    sitting("m4", "body:council", "2026-08-04T09:00:00-07:00", "Item", [["Regina Romero", "Aye"]], null),
  ], rosterFor);
  assert.equal(link.records.length, 0);
  assert.equal(link.unlinked, 3);
});

test("a vote with no item title or no date is not a fact", () => {
  const noTitle = { ...sitting("m5", "body:council", "2026-08-04T09:00:00-07:00", "", [["Regina Romero", "Aye"]]), agenda: [], outcomes: [] } as PersistedSittingOutcomes;
  const noDate = sitting("m6", "body:council", "", "Item", [["Regina Romero", "Aye"]]);
  const link = linkLocalVotes([noTitle, noDate], rosterFor);
  assert.equal(link.records.length, 0);
});

test("the card answer: the member's recorded votes, newest first, nothing summed", () => {
  const link = linkLocalVotes([
    sitting("m1", "body:council", "2026-08-04T09:00:00-07:00", "Adopt the Library Budget", [["Regina Romero", "Aye"]]),
    sitting("m0", "body:council", "2025-03-04T09:00:00-07:00", "Road repair contract", [["Regina Romero", "Nay"]]),
  ], rosterFor);
  const votes = localVotesForMember(link.records, "roster:body:council#0");
  const out = composeLocalMemberVotes({ name: "Mayor Regina Romero", topic: null, votes })!;
  assert.match(out.answer, /most recent recorded votes: Aye on Adopt the Library Budget \(August 4th, 2026; Passed\) and Nay on Road repair contract/);
  assert.deepEqual(out.citedUrls, ["https://clerk.example/m1", "https://clerk.example/m0"]);
  const topical = composeLocalMemberVotes({ name: "Mayor Regina Romero", topic: "the library budget", votes })!;
  assert.match(topical.answer, /^Mayor Regina Romero's recorded votes that match the question, newest first: Aye on Adopt the Library Budget/);
  assert.equal(composeLocalMemberVotes({ name: "x", topic: "zoning", votes }), null);
  assert.equal(composeLocalMemberVotes({ name: "x", topic: null, votes: [] }), null);
});
