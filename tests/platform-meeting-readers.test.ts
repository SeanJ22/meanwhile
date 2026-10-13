import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeCivicPlusSource, parseAgendaCenter, parseAgendaCenterCategories } from "../lib/sources/civicplus/index.ts";
import { boardDocsListUrl, makeBoardDocsSource, parseBoardDocsMeetings, parseBoardDocsCommittees } from "../lib/sources/boarddocs/index.ts";
import { makeCivicClerkSource } from "../lib/sources/civicclerk/index.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { attestationFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { verifyEndpointBody } from "../lib/hunt/meetings-site-discovery.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const ALAMEDA = fixture("civicplus-alameda-water-agendacenter.html");
const LIST = fixture("boarddocs-grand-rapids-meetings.json");
const DETAIL = fixture("boarddocs-grand-rapids-meeting.html");
const BOARD_URL = "https://go.boarddocs.com/mi/grand/Board.nsf/Public";
const BOARD: BodySourceWiring = {
  bodyId: "ocd-division/country:us/state:mi/school_district:grand_rapids#governing",
  ocdId: "ocd-division/country:us/state:mi/school_district:grand_rapids",
  agendaSourceType: "BOARDDOCS", jurisdiction: "Grand Rapids, MI", publishingOrg: "Grand Rapids Public Schools",
  timeZone: "America/Detroit", config: { portalUrl: BOARD_URL, committeeId: "A4EP6J588C05", slug: "mi-grand", bodyName: "Board of Education" },
  verifiedAt: "2024-05-22T12:00:00Z",
};

test("CivicPlus grouped category panels preserve Alameda's category names and agenda dates", () => {
  assert.deepEqual(parseAgendaCenterCategories(ALAMEDA), [
    { id: "3", name: "Engineering and Information Technology Committee" },
    { id: "5", name: "Operations and Water Quality Committee" },
  ]);
  assert.deepEqual(parseAgendaCenter(ALAMEDA, "3"), [{ date: "2024-09-04", agendaHref: "/AgendaCenter/ViewFile/Agenda/_09042024-1447" }]);
  assert.deepEqual(parseAgendaCenter(ALAMEDA, "5"), [{ date: "2024-09-03", agendaHref: "/AgendaCenter/ViewFile/Agenda/_09032024-1448" }]);
  assert.deepEqual(parseAgendaCenter(ALAMEDA, "999"), []);
});

test("BoardBook's real organization archive is confirmed through its agenda-link shape", () => {
  const url = "https://meetings.boardbook.org/Public/Organization/2065";
  const check = verifyEndpointBody({ vendor: "boardbook", url }, { status: 200, body: fixture("boardbook-amphi-2065.html"), finalUrl: url });
  assert.equal(check.verdict, "YIELDED");
  assert.equal(check.count, 16);
});

test("CivicPlus AgendaCenter-only rows fetch and publish without an unrelated iCal endpoint", async () => {
  const wiring: BodySourceWiring = { ...BOARD, agendaSourceType: "CIVICPLUS", publishingOrg: "Alameda County Water District", timeZone: "America/Los_Angeles",
    config: { slug: "alameda-water-committee", bodyName: "Engineering and Information Technology Committee", agendaCenterUrl: "https://www.acwd.org/AgendaCenter", agendaCenterCategoryId: "3" } };
  const seen: string[] = [];
  const source = makeCivicPlusSource([wiring], (async (url) => { seen.push(String(url)); return new Response(ALAMEDA); }) as typeof fetch);
  const raw = await source.fetch({ lat: 37.5, lng: -122, radiusKm: 25 });
  assert.deepEqual(seen, [wiring.config.agendaCenterUrl]);
  const { meetings, accounting } = source.normalizeWithDrops(raw, new Date("2024-09-01T00:00:00Z"));
  assert.equal(meetings.length, 1);
  assert.equal(new Date(meetings[0].startsAt).toISOString(), "2024-09-04T07:00:00.000Z");
  assert.equal(meetings[0].startPrecision, "DAY");
  assert.equal(meetings[0].agendaUrl, "https://www.acwd.org/AgendaCenter/ViewFile/Agenda/_09042024-1447");
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(meetingAcquisitionFailureDomain("civicplus", wiring), "meeting-upstream:www.acwd.org");
});

test("CivicPlus preserves verified calendar dates when the archive fails and records that partial read", async () => {
  const wiring: BodySourceWiring = { ...BOARD, agendaSourceType: "CIVICPLUS", timeZone: "America/New_York",
    config: { slug: "rockaway", summaryMatch: "Township Council", icalUrl: "https://www.rockawaytownship.org/council.ics", agendaCenterUrl: "https://www.rockawaytownship.org/AgendaCenter", agendaCenterCategoryId: "2" } };
  const source = makeCivicPlusSource([wiring], (async url => String(url).endsWith(".ics")
    ? new Response(fixture("civicplus-rockaway.ics")) : new Response("not found", { status: 404 })) as typeof fetch);
  const raw = await source.fetch({ lat: 40.9, lng: -74.5, radiusKm: 25 });
  const output = source.normalizeWithDrops(raw, new Date("2026-08-13T12:00:00-07:00"));
  assert.ok(output.meetings.length > 0);
  assert.equal(output.partialScopes?.[0].scope, "ARCHIVE");
  assert.match(output.partialScopes?.[0].cause ?? "", /404/);
});

test("BoardDocs real public list retains date, published start time and public agenda permalink", () => {
  const rows = parseBoardDocsMeetings(LIST);
  assert.ok(rows.length > 100);
  assert.deepEqual(rows[0], { id: "D5CSV7744EBE", title: "Special Board Meeting/Board Retreat @ 9:30 a.m. - 12:00 p.m.", date: "2024-05-22", hour: 9, minute: 30 });
  const output = makeBoardDocsSource([BOARD]).normalizeWithDrops([{ wiring: BOARD, text: LIST, details: { D5CSV7744EBE: DETAIL }, collectedAt: "2024-05-20T00:00:00Z" }], new Date("2024-05-20T00:00:00Z"));
  const meeting = output.meetings.find(m => m.id.endsWith(":D5CSV7744EBE"))!;
  assert.equal(new Date(meeting.startsAt).toISOString(), "2024-05-22T13:30:00.000Z");
  assert.equal(meeting.bodyName, "Board of Education");
  assert.equal(meeting.agendaUrl, "https://go.boarddocs.com/mi/grand/Board.nsf/goto?open&id=D5CSV7744EBE");
  assert.equal(meeting.status, "SCHEDULED");
  assert.match(meeting.venueGap?.publishedText ?? "", /1400 Fuller Ave\. NE/);
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.deepEqual(meetingSourceNamesForWiring(BOARD), ["boarddocs"]);
  assert.equal(meetingAcquisitionFailureDomain("boarddocs", BOARD), "meeting-upstream:go.boarddocs.com/mi/grand/board.nsf");
});

test("BoardDocs date-only source rows remain day precision and never assert an unpublished agenda", () => {
  // Synthetic omission of the real publisher's time exercises truthful precision.
  const row = { ...JSON.parse(LIST)[0], name: "Board Meeting" };
  const output = makeBoardDocsSource([BOARD]).normalizeWithDrops([{ wiring: BOARD, text: JSON.stringify([row]), collectedAt: "2024-05-20T00:00:00Z" }], new Date("2024-05-20T00:00:00Z"));
  assert.equal(output.meetings[0].startPrecision, "DAY");
  assert.equal(output.meetings[0].agendaUrl, null);
  assert.throws(() => parseBoardDocsMeetings("<html>BoardDocs</html>"));
  assert.throws(() => parseBoardDocsMeetings('[{"unique":"abc","numberdate":"20240231","name":"Meeting"}]'), /DATE_INVALID/);
});

for (const direct of [true, false]) test(`BoardDocs discovery reads an attested committee through identified form POST ${direct ? "from the homepage" : "through the government's meetings page"}`, async () => {
  const selector = '<div committeeid="A4EP6J588C05">Board of Education</div>';
  assert.deepEqual(parseBoardDocsCommittees(selector), [{ id: "A4EP6J588C05", name: "Board of Education" }]);
  const route = boardDocsListUrl(BOARD_URL, BOARD.config.committeeId);
  const seen: { url: string; method?: string; body?: string }[] = [];
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "mi:school:grand-rapids-public-schools", stateCode: "MI", name: "Grand Rapids Public Schools", govClass: "SCHOOL", ownWebAddress: "https://grps.org", basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "GAP_LEDGER", versionId: "a".repeat(64) } }, {
    open: async input => {
      seen.push(input);
      assert.match(input.headers["user-agent"], /we-the-people/);
      const body = input.url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /\n"
        : input.url === "https://grps.org/" ? `<a href="${direct ? BOARD_URL : "/meetings"}">Board of Education Meetings</a>`
        : input.url === "https://grps.org/meetings" ? `<h1>Board of Education</h1><a href="${BOARD_URL}">Board meetings</a>`
        : input.url === BOARD_URL ? selector : input.url === route ? LIST : "";
      return { status: body ? 200 : 404, body, bytes: body.length, contentType: input.url === route ? "application/json" : "text/html", location: null, transportError: null };
    }, spaceOut: async () => {}, now: () => "2024-05-20T00:00:00Z", budget: { spent: () => false },
    vault: async artifact => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
  });
  const find = attempt.found.find(f => f.vendor === "boarddocs")!;
  assert.ok(find, JSON.stringify(attempt.leads));
  assert.equal(find.url, route);
  assert.equal(seen.find(r => r.url === route)?.method, "POST");
  assert.equal(seen.find(r => r.url === route)?.body, "current_committee_id=A4EP6J588C05");
  assert.ok("attestation" in attestationFor(attempt, find));
});

test("BoardDocs public form POST uses the shared same-identity alternate client on a refusal", async () => {
  let form: Readonly<Record<string, string>> | undefined;
  const response = await politeGetText("https://go.boarddocs.com/mi/grand/Board.nsf/BD-GetMeetingsList?open", {
    form: { current_committee_id: "A4EP6J588C05" }, fetchImpl: (async () => new Response("refused", { status: 403 })) as typeof fetch,
    ladder: { curl: async (_url, _headers, _signal, submitted) => { form = submitted; return { status: 200, contentType: "application/json", text: LIST }; } },
  });
  assert.deepEqual(form, { current_committee_id: "A4EP6J588C05" });
  assert.equal(response.text, LIST);
});

test("CivicClerk assigns only the exact reviewed category's meetings to a body", () => {
  const wiring = { ...BOARD, agendaSourceType: "CIVICCLERK" as const, config: { slug: "grand", portalBase: "https://grand.portal.civicclerk.com", categoryId: "26" } };
  const output = makeCivicClerkSource([wiring]).normalizeWithDrops([{ wiring, collectedAt: "2024-05-20T00:00:00Z", events: [
    { id: 1, categoryId: 26, eventName: "Regular meeting", categoryName: "Board of Education", eventDate: "2024-05-22T18:30:00", startDateTime: "2024-05-22T18:30:00" },
    { id: 2, categoryId: 27, eventName: "Regular meeting", categoryName: "Planning Commission", eventDate: "2024-05-22T18:30:00", startDateTime: "2024-05-22T18:30:00" },
  ] }], new Date("2024-05-20T00:00:00Z"));
  assert.equal(output.meetings.length, 1);
  assert.equal(output.drops.notConfigured, 1);
});
