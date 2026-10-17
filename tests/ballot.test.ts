import assert from "node:assert/strict";
import test from "node:test";

import { contestsForDivisions } from "../lib/ballot/contests.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import type { BallotSet, Contest } from "../lib/ballot/types.ts";

const STATE = "ocd-division/country:us/state:xx";
const COUNTY = `${STATE}/county:example`;
const TOWN = `${COUNTY}/place:town_a`;
const OTHER_TOWN = `${COUNTY}/place:town_b`;
const OTHER_STATE = "ocd-division/country:us/state:yy";
const provenance = { sourceUrl: "https://elections.example.gov/list.pdf", sourceOrg: "Example County Clerk", collectedAt: "2026-09-01", secondHand: false } as Contest["provenance"];
const contest = (id: string, ocdId: string): Contest => ({
  id, electionId: "xx-2026-11-03", ocdId, divisionVintage: "2025", title: id, type: "CANDIDACY", voteFor: 1, termYears: 4, scopeNote: null, provenance,
});
const SET: BallotSet = {
  election: { id: "xx-2026-11-03", date: "2026-11-03", name: "2026 General Election", state: "xx" },
  contests: [contest("statewide", STATE), contest("county", COUNTY), contest("town-a", TOWN), contest("town-b", OTHER_TOWN), contest("elsewhere", OTHER_STATE)],
  candidacies: [],
  measures: [],
  absences: [{ ocdId: TOWN, divisionVintage: "2025", statement: "No town council race is on this ballot.", provenance }],
};

test("a reader sees every contest on their divisions and their state, and nothing across a boundary", () => {
  const { contests, absences } = contestsForDivisions(SET, [COUNTY, TOWN]);
  assert.deepEqual(contests.map((c) => c.id), ["statewide", "county", "town-a"]);
  assert.deepEqual(absences.map((a) => a.ocdId), [TOWN]);
  const neighbour = contestsForDivisions(SET, [COUNTY, OTHER_TOWN]);
  assert.deepEqual(neighbour.contests.map((c) => c.id), ["statewide", "county", "town-b"]);
  assert.deepEqual(neighbour.absences, []);
  assert.deepEqual(contestsForDivisions(SET, ["ocd-division/country:us/state:zz/county:none"]).contests, []);
});


test("VS-01: the ballot page always offers one in-app voting lookup without requiring dates or a ballot", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const ts = await import("typescript");
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  const syntax = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls: import("typescript").JsxSelfClosingElement[] = [];
  function visit(node: import("typescript").Node): void {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(syntax) === "WhereToVote") controls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert.equal(controls.length, 1, "one shared voting lookup must be present on the ballot page");
  let ancestor: import("typescript").Node | undefined = controls[0].parent;
  while (ancestor && !ts.isReturnStatement(ancestor)) {
    assert.ok(!ts.isConditionalExpression(ancestor), "voting lookup is conditional on page data");
    assert.ok(!ts.isBinaryExpression(ancestor) || ![ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(ancestor.operatorToken.kind),
      "voting lookup is hidden behind a ballot, date, or ZIP condition");
    ancestor = ancestor.parent;
  }
  assert.ok(ancestor && ts.isReturnStatement(ancestor), "voting lookup must render in the page return");
  const control = readFileSync(join(process.cwd(), "components", "ballot", "where-to-vote.tsx"), "utf8");
  assert.match(control, /<VotingSitesPanel\b/, "the control must open the in-app voting answer");
  assert.doesNotMatch(control, /<a\s|<Link\s/, "the voting control must not send readers to an external lookup");
});

test("official registration and polling navigation is rendered independently of a ballot", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("app/ballot/page.tsx", "utf8");
  assert.match(page, /navigationStates\.map\(state/);
  assert.match(page, /data-navigation-kind=\{link\.purpose\}/);
  assert.match(page, /data-leaves-app/);
  assert.match(page, /aria-label=\{`\$\{link\.label\} — opens the official site in a new tab`\}/);
});
