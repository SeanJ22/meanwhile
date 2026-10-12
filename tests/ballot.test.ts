import assert from "node:assert/strict";
import test from "node:test";

import { contestsForDivisions } from "../lib/sources/ballot-nj-morris/index.ts";
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

test("item 6: every covered state points at its own official polling-place lookup", async () => {
  const { POLLING_PLACE_LINKS, pollingPlaceLinkFor } = await import(
    "../lib/ballot/polling-place-links.ts"
  );
  const { REGISTRATION_LINKS } = await import(
    "../lib/ballot/registration-links.ts"
  );

  // Every state we can render a ballot for gets the pointer.
  for (const reg of REGISTRATION_LINKS) {
    const link = pollingPlaceLinkFor(reg.state);
    assert.ok(link, `${reg.state} has a registration link but no polling-place link`);
  }

  const hosts = new Set<string>();
  for (const link of POLLING_PLACE_LINKS) {
    const url = new URL(link.url);
    assert.equal(url.protocol, "https:", `${link.state} link is not https`);
    // The authority's own host — never an aggregator, never a third party.
    assert.match(
      url.hostname,
      /(\.gov|\.arizona\.vote)$/,
      `${link.state} points at ${url.hostname}, which is not an election authority's host`,
    );
    // A cited URL must have been fetched and verified, and the sentence must say which rung answered.
    assert.ok(link.verification.length > 40, `${link.state} verification is too thin`);
    assert.match(link.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(link.sourceOrg.length > 0);
    // Plain words on the reader-facing line — no identifiers, no jargon.
    assert.match(link.label, /^Find your polling place$/);
    assert.ok(link.note.length > 0, `${link.state} must say what the tool asks for`);
    hosts.add(`${link.state}|${url.href}`);
  }
  // Distinct states resolve to distinct URLs — the uniqueness invariant.
  assert.equal(hosts.size, POLLING_PLACE_LINKS.length);
  assert.equal(
    new Set(POLLING_PLACE_LINKS.map((l) => l.url)).size,
    POLLING_PLACE_LINKS.length,
    "two states share one polling-place URL",
  );
});

/** The pointer is required once per page, in the dates header: a reader must always find it, and a repeated identical control reads worse. */
test("F21: the ballot page renders the polling-place pointer exactly once, in the dates header", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  assert.ok(page.includes("pollingPlaceLinkFor"), "the ballot page never asks for it");

  const pointerCall = "pollingPlaceLinkFor(set.election.state, pollingPlaceLinks)";
  const occurrences = page.split(pointerCall).length - 1;
  assert.equal(
    occurrences,
    1,
    `the pointer resolves ${occurrences} time(s); once per page, in the dates header (F21)`,
  );

  // Location, not just count. The dates header is the block that also
  // resolves the registration deadline and early-voting steps.
  const header = page.indexOf("const reg = registrationLinkFor(set.election.state, registrationLinks);");
  const pointer = page.indexOf(pointerCall);
  assert.ok(header >= 0 && pointer > header, "the pointer left the dates header");
  /* The pointer sits inside the dates section, and the separate registration checker box stays gone. */
  const sectionEnd = page.indexOf("</section>", pointer);
  assert.ok(sectionEnd > pointer, "the pointer is not inside the dates section at all");
  assert.ok(
    page.indexOf("registration checker, prominent") === -1,
    "the separate registration checker box is back — AZ-4 and AZ-5 deduplicated it to one pill",
  );

  /* The pointer is the in-app pill; the state's tool is not offered as a second route beside it. */
  assert.ok(
    !/own tool/.test(page),
    "the state's polling-place tool is being offered as a second route again (BAL-2)",
  );
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
