import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerReaderRenderHooks } from "../lib/holdings/reader-census.ts";
import { GET as votesGet } from "../app/api/votes/route.ts";
import { getStateVotesSnapshot } from "../lib/sources/legiscan/snapshot.ts";
import { LEGISCAN_ATTRIBUTION } from "../lib/sources/legiscan/types.ts";
import { getVotesSnapshot } from "../lib/votes/snapshot.ts";
import type { MemberRollCall, VoteAttribution } from "../components/map/popup/official-popup.tsx";

// Use the existing Reader TSX/CSS content-rendering hooks with native Node.
await registerReaderRenderHooks(process.cwd());
const { RecentVoteRecords } = await import("../components/map/popup/official-popup.tsx");

async function recordedVotes(member: string) {
  const response = await votesGet(new Request(`https://reader.test/api/votes?member=${member}`));
  assert.equal(response.status, 200);
  return await response.json() as {
    generatedAt: string;
    votes: MemberRollCall[];
    count: number;
    attribution?: VoteAttribution;
  };
}

const escaped = (text: string) => text.replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#x27;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

test("held NH override and veto-message records reach the actual Reader leaf with state semantics", async () => {
  const snapshot = getStateVotesSnapshot();
  const controls = [
    { name: "Karen Ebel", member: "plural:947e2e2b-04eb-4f92-9f83-aef8760517e0", voteId: "legiscan:1725386", phrase: "override the governor's veto" },
    { name: "Dan Innis", member: "plural:6328e7f7-d952-4d28-98b8-75a9a6f50c8d", voteId: "legiscan:1725502", phrase: "governor's objections to a bill" },
  ];
  for (const control of controls) {
    const held = snapshot.rollCalls.find(row => row.id === control.voteId);
    const position = snapshot.positions.find(row => row.rollCallId === control.voteId && row.officeholderId === control.member);
    assert.ok(held && position, `${control.name}: held control is required`);
    const payload = await recordedVotes(control.member);
    assert.equal(payload.generatedAt, snapshot.generatedAt);
    assert.deepEqual(payload.attribution, LEGISCAN_ATTRIBUTION);
    assert.equal(payload.count, payload.votes.length);
    const row = payload.votes.find(vote => vote.id === control.voteId);
    assert.ok(row, `${control.name}: record must reach the Reader API`);
    assert.deepEqual(row.jurisdiction, { level: "state", state: "NH" });
    assert.equal(row.question, held.motion);
    assert.equal(row.position, position.position);
    assert.equal(row.result, held.result);
    assert.equal(row.rollCallUrl, held.rollCallUrl);
    assert.equal(row.billUrl, held.billUrl);

    // RecentVoteRecords is shared by the map/official card and ballot record.
    const markup = renderToStaticMarkup(createElement(RecentVoteRecords, {
      votes: payload.votes, attribution: payload.attribution ?? null,
      failed: false, reactionContext: null,
    }));
    assert.equal([...markup.matchAll(/data-recent-vote-id=/g)].length, payload.count);
    assert.ok(markup.includes(`data-recent-vote-id="${control.voteId}"`));
    for (const value of [control.phrase, held.billTitle, held.motion, held.result, held.rollCallUrl, held.billUrl!]) {
      assert.ok(markup.includes(escaped(value)), `${control.name}: missing rendered ${value}`);
    }
    assert.doesNotMatch(markup, /President|two-thirds|60 votes|signed (?:the|this) bill|became law/i);
    if (held.motion.startsWith("VETO MESSAGE")) {
      assert.doesNotMatch(markup, /A No vote here was a vote against overriding the veto/);
    }
    assert.match(markup, /LegiScan/);
    assert.match(markup, /CC BY 4\.0/);
  }
});

test("held federal nomination keeps the President explainer through API and Reader rendering", async () => {
  const snapshot = getVotesSnapshot();
  const member = "congress:K000377"; // Mark Kelly: federal control, unrelated to NH.
  const voteId = "senate:119-2:220";
  const held = snapshot.votes.find(vote => vote.id === voteId);
  const position = snapshot.positions.find(row => row.voteId === voteId && row.officeholderId === member);
  assert.ok(held && position);
  const payload = await recordedVotes(member);
  const row = payload.votes.find(vote => vote.id === voteId);
  assert.ok(row);
  assert.deepEqual(row.jurisdiction, { level: "federal" });
  assert.equal(row.position, position.position);
  assert.equal(row.rollCallUrl, held.rollCallUrl);
  assert.equal(payload.generatedAt, snapshot.generatedAt);
  const markup = renderToStaticMarkup(createElement(RecentVoteRecords, {
    votes: [row], attribution: null, failed: false, reactionContext: null,
  }));
  assert.ok(markup.includes(escaped("approve the President's nominee")));
  assert.ok(markup.includes(escaped(held.rollCallUrl)));
  assert.ok(markup.includes(`data-recent-vote-id="${voteId}"`));
  assert.doesNotMatch(markup, /governor/i);
});
