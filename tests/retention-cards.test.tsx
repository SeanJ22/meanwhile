import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RetentionCard } from "../components/ballot/retention-card.tsx";
import type { BallotSet } from "../lib/ballot/types.ts";
import { readerText } from "./helpers/reader-markup.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";

test("all 313 held retention contests draw a sourced card and independent Yes/No picks", () => {
  let count = 0;
  for (const file of readdirSync("data/ballot/2026-general").filter(file => file.endsWith(".json"))) {
    const input = JSON.parse(readFileSync(`data/ballot/2026-general/${file}`, "utf8")) as { ballots: Record<string, BallotSet> };
    for (const ballot of Object.values(input.ballots)) for (const contest of ballot.contests.filter(row => row.type === "RETENTION")) {
      const candidates = ballot.candidacies.filter(candidate => candidate.contestId === contest.id);
      const html = readerText(renderToStaticMarkup(<RetentionCard contest={contest} candidates={candidates} />));
      assert.ok(html.includes(`data-contest-id="${contest.id}"`));
      assert.ok(html.includes('data-contest-type="RETENTION"'));
      assert.match(html, />Yes<\/button>/);
      assert.match(html, />No<\/button>/);
      if (contest.scopeNote?.includes("Shall")) assert.ok(html.includes(contest.scopeNote));
      for (const candidate of candidates) assert.ok(html.toLowerCase().includes(ballotCandidateDisplayName(candidate).toLowerCase()), `${contest.id}: the filed judge is visible`);
      count++;
    }
  }
  assert.equal(count, 313);
});
