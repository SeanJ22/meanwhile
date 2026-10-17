import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { contestsForDivisions } from "../lib/ballot/contests.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import { ballotNavigationFor } from "../lib/ballot/navigation.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
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

function committedNavigation(state: string) {
  const file = JSON.parse(readFileSync(join(process.cwd(), "data", "ballot", "2026-navigation", `${state.toLowerCase()}.json`), "utf8")) as
    { package: { version: string; payload: CuratedReaderProjection } };
  return { payload: file.package.payload, version: file.package.version };
}

test("the NJ date strip is complete and cited", () => {
  const { payload, version } = committedNavigation("NJ");
  const dates = electionDatesFor("NJ", ballotNavigationFor("NJ", payload, version, []).dates);
  assert.ok(dates);
  assert.equal(dates.electionDay, "2026-11-03");
  const labels = dates.steps.map((s) => s.label).join(" | ");
  for (const needed of ["registration", "Mail-ballot", "early voting"]) {
    assert.match(labels, new RegExp(needed, "i"), `date strip is missing ${needed}`);
  }
  for (const step of dates.steps) assert.match(step.sourceUrl, /^https:\/\/www\.nj\.gov\//);
});

test("polling lookup fields are validated from the held projection but never surface as a link", () => {
  for (const state of ["AZ", "NJ", "NH", "OH"]) {
    const { payload, version } = committedNavigation(state);
    assert.ok(payload.records.some((row) => (row.value as { fieldKind?: string }).fieldKind === "polling_lookup"), `${state} holds a polling lookup field`);
    const links = ballotNavigationFor(state, payload, version, []).links;
    assert.ok(links.length > 0);
    assert.deepEqual(links.filter((link) => !["registration_page", "registration_lookup", "ballot_lookup"].includes(link.purpose)), []);
  }
});

/** VS-01 supersedes F21's outbound pointer: every reader gets the in-app answer, including places without a ballot or date strip. */
test("VS-01: the ballot page always offers one in-app voting lookup without requiring dates or a ballot", async () => {
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
test("AZ-4/AZ-5: the ballot reads each state's navigation once, and registration is one labelled pill", () => {
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");

  const reads = page.split("readBallotNavigationProjection(state)").length - 1;
  assert.equal(reads, 1, `the navigation is read ${reads} time(s) per state; there is one read`);

  const pills = page.split("data-registration-pill").length - 1;
  assert.equal(pills, 1, `${pills} registration pill(s) rendered; exactly one is expected`);

  assert.ok(
    /data-leaves-app[\s\S]{0,160}voting-open-button/.test(page),
    "the registration pill must be labelled as leaving the app",
  );
  assert.ok(
    /aria-label=\{`\$\{link\.label\}[\s\S]{0,80}opens the official site in a new tab`\}/.test(page),
    "the leaving warning is not in the pill's accessible name, so a reader who cannot see the arrow is never told",
  );
});
