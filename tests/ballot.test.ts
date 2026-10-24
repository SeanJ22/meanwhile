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

test("the NJ date strip is complete and cited", () => {
  const dates = electionDatesFor("NJ");
  assert.ok(dates);
  assert.equal(dates.electionDay, "2026-11-03");
  const labels = dates.steps.map((s) => s.label).join(" | ");
  for (const needed of ["registration", "Mail ballots", "early voting", "Election Day"]) {
    assert.match(labels, new RegExp(needed, "i"), `date strip is missing ${needed}`);
  }
  assert.match(dates.sourceUrl, /^https:\/\/www\.nj\.gov\//);
});

test("polling lookup routes come from the held projection, without a literal state list", async () => {
  const { POLLING_PLACE_LINKS, pollingPlaceLinkFor } = await import(
    "../lib/ballot/polling-place-links.ts"
  );
  assert.deepEqual(POLLING_PLACE_LINKS, []);
  assert.equal(pollingPlaceLinkFor("OH", []), null);

  for (const state of ["AZ", "NJ", "NH", "OH"]) assert.equal(pollingPlaceLinkFor(state), null);

});

/** VS-01 supersedes F21's outbound pointer: every reader gets the in-app answer, including places without a ballot or date strip. */
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
  assert.ok(!page.includes("pollingPlaceLinkFor"), "the ballot page sends readers out for their voting answer");
  const control = readFileSync(join(process.cwd(), "components", "ballot", "where-to-vote.tsx"), "utf8");
  assert.match(control, /<VotingSitesPanel\b/, "the control must open the in-app voting answer");
  assert.doesNotMatch(control, /<a\s|<Link\s/, "the voting control must not send readers to an external lookup");
});

/** The registration destination reaches the reader once: the Secretary of State is the only authoritative source for registration status, so the pill leaves the app and says so. */
test("AZ-4/AZ-5: the ballot resolves the registration link exactly once, and it is a labelled pill", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");

  const resolves = page.split("registrationLinkFor(set.election.state, registrationLinks)").length - 1;
  assert.equal(
    resolves,
    1,
    `the registration link resolves ${resolves} time(s); there is one pill`,
  );

  const pills = page.split("data-registration-pill").length - 1;
  assert.equal(pills, 1, `${pills} registration pill(s) rendered; exactly one is expected`);

  assert.ok(
    page.includes("data-leaves-app\n                    className=\"voting-open-button\"") ||
      /data-leaves-app[\s\S]{0,120}voting-open-button/.test(page),
    "the registration pill must be labelled as leaving the app",
  );
  /* The leaving warning is on the control and in its accessible name. */
  assert.ok(
    /only place this can be checked/.test(page),
    "the pill no longer says why it leaves — the Secretary of State is the system of record",
  );
  assert.ok(
    /aria-label=\{`\$\{reg\.label\}[\s\S]{0,200}leaves this app`\}/.test(page),
    "the leaving warning is not in the pill's accessible name, so a reader who cannot see the arrow is never told",
  );
});
