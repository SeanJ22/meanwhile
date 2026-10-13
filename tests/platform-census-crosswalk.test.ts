/** Recorded publisher bytes cross the same discovery, review and Reader-config seams as a standing pass. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, textSha256, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { crosswalkRowIssue } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { derivedAdapterConfig } from "../lib/civic-data/derived-meeting-wiring.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const NOW = "2026-08-14T12:00:00.000Z";
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };

async function recordedReview(input: { jurisdictionId: string; ocdId: string; stateCode: string; countyFips: string; home: string; name: string; govClass: MeetingsDiscoveryNeed["govClass"]; html: string; replies: Record<string, RecordedReply> }) {
  const held = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: input.jurisdictionId, stateCode: input.stateCode, countyFips: input.countyFips, name: input.name,
    govClass: input.govClass, ownWebAddress: input.home, basis: "SOURCE_DISCOVERY_OWED", sources: [],
    addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "recorded-transport" },
  }, {
    open: recordedDiscoveryOpen({ [`${input.home}robots.txt`]: ALLOW, [input.home]: { status: 200, body: input.html }, ...input.replies }),
    readOfficialPages: async () => [{ canonicalUrl: "https://fixture-directory.gov/governments", text: `<a href="${input.home}">${input.name}</a>` }],
    spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false },
    vault: async (artifact, body) => {
      held.set(artifact.id, { text: body, sha256: textSha256(body), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } });
      return { stored: true, where: "recorded source fixture", why: "held" };
    },
  });
  const bodyId = `${input.ocdId}${input.govClass === "SCHOOL_DISTRICT" ? "#board" : "#governing"}`;
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "fixture-walk", recordedAt: NOW },
    registered: { bodyId, ocdId: input.ocdId, publishingOrg: input.name, countyFips: input.countyFips, input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: `US-${input.stateCode}:registration:v1`, versionId: "recorded-registration", readModelSha256: "c".repeat(64), promotedAt: NOW } },
    held: id => held.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: NOW });
  return { attempt, review, bodyId };
}

test("BoardBook's recorded school archive becomes a whole-organization board route from its attested link", async () => {
  const route = "https://meetings.boardbook.org/Public/Organization/2065";
  const result = await recordedReview({ jurisdictionId: "az:school:amphitheater-unified-school-district", ocdId: "ocd-division/country:us/state:az/school_district:amphitheater_unified_district", stateCode: "AZ", countyFips: "04019", home: "https://www.amphi.com/", name: "Amphitheater Unified School District", govClass: "SCHOOL_DISTRICT",
    html: `<h1>Amphitheater Governing Board</h1><a href="${route}">Governing Board meetings</a>`,
    replies: { "https://meetings.boardbook.org/robots.txt": ALLOW, [route]: { status: 200, body: fixture("boardbook-amphi-2065.html") } } });
  const row = result.review.accepted.find(entry => entry.row.kind === "BOARDBOOK" && entry.row.bodyId === result.bodyId)?.row;
  assert.ok(row, JSON.stringify({ held: result.review.held, attempt: result.attempt }));
  assert.deepEqual(row.filter, {});
  assert.equal(row.timeZone, "America/Phoenix");
  assert.equal(crosswalkRowIssue(row), null);
  assert.equal(derivedAdapterConfig(row).orgId, "2065");
});

test("CivicClerk's recorded Mandan commission API uses Morton County's Central clock and exact category filter", async () => {
  const portal = "https://mandannd.portal.civicclerk.com/";
  const route = "https://mandannd.api.civicclerk.com/v1/Events?$top=5";
  const result = await recordedReview({ jurisdictionId: "nd:city:city-of-mandan", ocdId: "ocd-division/country:us/state:nd/place:mandan", stateCode: "ND", countyFips: "38059", home: "https://www.cityofmandan.com/", name: "City of Mandan", govClass: "CITY_OR_TOWN",
    html: `<h1>Mandan City Commission</h1><a href="${portal}">City Commission meetings</a>`, replies: { "https://mandannd.portal.civicclerk.com/robots.txt": ALLOW, [portal]: { status: 200, body: '<h1>City Commission</h1>' }, "https://mandannd.api.civicclerk.com/robots.txt": ALLOW, [route]: { status: 200, body: fixture("civicclerk-mandan-events.json"), contentType: "application/json" } } });
  const row = result.review.accepted.find(entry => entry.row.kind === "CIVICCLERK" && entry.row.bodyId === result.bodyId)?.row;
  assert.ok(row, JSON.stringify({held:result.review.held,attempt:result.attempt}));
  assert.deepEqual(row.filter, { bodyMatch: "City Commission", portalBase: "https://mandannd.portal.civicclerk.com" });
  assert.equal(row.timeZone, "America/Chicago");
  assert.equal(row.evidence.calendar.selected, 15);
  assert.equal(crosswalkRowIssue(row), null);
  assert.equal(derivedAdapterConfig(row).bodyMatch, "City Commission");
});

test("IQM2's recorded Morris calendar reviews the complete printed county-board label", async () => {
  const route = "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx";
  const result = await recordedReview({ jurisdictionId: "nj:county:morris", ocdId: "ocd-division/country:us/state:nj/county:morris", stateCode: "NJ", countyFips: "34027", home: "https://www.morriscountynj.gov/", name: "Morris County", govClass: "COUNTY",
    html: `<h1>Board of County Commissioners</h1><a href="${route}">Board of County Commissioners meetings</a>`, replies: { "https://morriscountynj.iqm2.com/robots.txt": ALLOW, [route]: { status: 200, body: fixture("iqm2/morris-calendar.html") } } });
  const row = result.review.accepted.find(entry => entry.row.kind === "IQM2" && entry.row.bodyId === result.bodyId)?.row;
  assert.ok(row, JSON.stringify({held:result.review.held,attempt:result.attempt}));
  assert.deepEqual(row.filter, { boardMatch: "Board of County Commissioners" });
  assert.equal(crosswalkRowIssue(row), null);
});

test("AgendaCenter's recorded Rockaway archive reviews one published category and retains its agenda route", async () => {
  const route = "https://www.rockawaytownship.org/AgendaCenter";
  const result = await recordedReview({ jurisdictionId: "nj:city:township-of-rockaway", ocdId: "ocd-division/country:us/state:nj/cousub:rockaway", stateCode: "NJ", countyFips: "34027", home: "https://www.rockawaytownship.org/", name: "Rockaway Township", govClass: "CITY_OR_TOWN",
    html: `<h1>Township Council</h1><a href="${route}">Township Council agendas</a>`, replies: { [route]: { status: 200, body: fixture("civicplus-rockaway-agendacenter.html") } } });
  const row = result.review.accepted.find(entry => entry.row.kind === "CIVICPLUS" && entry.row.bodyId === result.bodyId)?.row;
  assert.ok(row, JSON.stringify({held:result.review.held,attempt:result.attempt}));
  assert.deepEqual(row.filter, { agendaCenterCategoryId: "2" });
  assert.equal(crosswalkRowIssue(row), null);
  assert.equal(derivedAdapterConfig(row).agendaCenterUrl, route);
});

test("BoardDocs' recorded Grand Rapids public list selects its published committee through the official link", async () => {
  const portal = "https://go.boarddocs.com/mi/grand/Board.nsf/Public";
  const route = "https://go.boarddocs.com/mi/grand/Board.nsf/BD-GetMeetingsList?open&current_committee_id=A4EP6J588C05";
  const result = await recordedReview({ jurisdictionId: "mi:school:grand-rapids-public-schools", ocdId: "ocd-division/country:us/state:mi/school_district:grand_rapids", stateCode: "MI", countyFips: "26081", home: "https://www.grps.org/", name: "Grand Rapids Public Schools", govClass: "SCHOOL_DISTRICT",
    html: `<h1>School Board</h1><a href="${portal}">School Board meetings</a>`, replies: { "https://go.boarddocs.com/robots.txt": ALLOW, [portal]: { status: 200, body: '<div committeeid="A4EP6J588C05">School Board</div>' }, [route]: { status: 200, body: fixture("boarddocs-grand-rapids-meetings.json"), contentType: "application/json" } } });
  const row = result.review.accepted.find(entry => entry.row.kind === "BOARDDOCS" && entry.row.bodyId === result.bodyId)?.row;
  assert.ok(row, JSON.stringify({held:result.review.held,attempt:result.attempt}));
  assert.deepEqual(row.filter, { committeeId: "A4EP6J588C05" });
  assert.equal(row.timeZone, "America/New_York");
  assert.equal(crosswalkRowIssue(row), null);
});
