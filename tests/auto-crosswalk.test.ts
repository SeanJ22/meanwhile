import assert from "node:assert/strict";
import { printedNames } from "../lib/meetings/printed-body-names.ts";
import test from "node:test";

import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  composeCrosswalk,
  derivedCrosswalkCandidate,
  derivedCrosswalkProjectionIssue,
  planDerivedCrosswalk,
  type AutoCrosswalkReview,
} from "../lib/civic-data/derived-crosswalk.ts";
import { CROSSWALK_CITATION, crosswalkRowId, crosswalkRowIssue, subBodyId, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import {
  autoCrosswalkReviewerId,
  reviewDiscoveryWalk,
  textSha256,
  type HeldBytes,
  type RegisteredGovernment,
} from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { deriveWiringDecisions, type DerivedWiringInputs } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { planDerivedVersion } from "../lib/civic-data/derived-authority.ts";
import { bodySourceWiringFor, derivedWiringKey, derivedAdapterConfig, type DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import { meetingEndpointCandidates } from "../lib/hunt/meetings-site-discovery.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const T_WALK = "2026-09-25T12:00:00.000Z";
const NOW = "2026-09-25T13:00:00.000Z";
const REVIEWER = autoCrosswalkReviewerId("0123456789abcdef");
const JURISDICTION = "oh:city:city-of-testburg";
const OCD = "ocd-division/country:us/state:oh/place:testburg";
const HOST = "testburg.oh.example.gov";
const ROUTE = `https://${HOST}/calendar/meetings.ics`;
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };

function ics(events: readonly { uid: string; summary: string; start: string; categories?: string; tz?: string | null }[], extra: readonly string[] = []): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", ...extra,
    ...events.flatMap((e) => [
      "BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.summary}`,
      e.tz === null ? `DTSTART:${e.start}Z` : `DTSTART;TZID=${e.tz ?? "America/New_York"}:${e.start}`,
      ...(e.categories ? [`CATEGORIES:${e.categories}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR", "",
  ].join("\r\n");
}

const HOME = `<html><body><nav><a href="/calendar/meetings.ics">Meetings calendar</a></nav>
<h1>City of Testburg</h1><p>The Testburg City Council meets the first Monday of each month. The Housing Commission advises the City Council on housing.</p>
</body></html>`;

const FEED = ics([
  { uid: "c1", summary: "City Council Regular Meeting", start: "20261005T190000" },
  { uid: "c2", summary: "Testburg City Council Work Session", start: "20261019T180000" },
  { uid: "y1", summary: "Youth City Council", start: "20261007T160000" },
  { uid: "h1", summary: "Housing Commission Meeting", start: "20261008T170000" },
  { uid: "f1", summary: "Fair Housing Commission", start: "20261009T170000" },
  { uid: "t1", summary: "Tourism Commission", start: "20261012T170000" },
  { uid: "g1", summary: "Franklin County Commission", start: "20261013T090000" },
  { uid: "e1", summary: "Fall Festival", start: "20261014T100000" },
]);

const REGISTRATION: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-OH:registration:v1", versionId: "reg-oh-1", readModelSha256: "c".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" };
const REGISTERED: RegisteredGovernment = { bodyId: `${OCD}#governing`, ocdId: OCD, publishingOrg: "Testburg city", input: REGISTRATION };

/** Walk a recorded site as the free walk does, keeping every body it vaulted, as the vault holds it. */
async function walk(replies: Readonly<Record<string, RecordedReply>>, need: Partial<MeetingsDiscoveryNeed> = {}) {
  const bodies = new Map<string, HeldBytes>();
  let tick = 0;
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: JURISDICTION, stateCode: "OH", name: "CITY OF TESTBURG", govClass: "CITY_OR_TOWN", ownWebAddress: HOST,
    basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "ref-1" }, ...need,
  }, {
    open: recordedDiscoveryOpen(replies),
    spaceOut: async () => {},
    vault: async (artifact, body) => {
      bodies.set(artifact.id, {
        text: body,
        sha256: artifact.contentHash.slice("sha256-".length),
        evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW", retrievedAt: artifact.retrievedAt },
      });
      return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
    },
    now: () => new Date(Date.parse(T_WALK) + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
  });
  return { attempt, bodies };
}

const SITE = (feed = FEED, home = HOME): Record<string, RecordedReply> => ({
  [`https://${HOST}/robots.txt`]: ALLOW,
  [`https://${HOST}/`]: { status: 200, body: home },
  [ROUTE]: { status: 200, body: feed, contentType: "text/calendar" },
});

test("route selection leaves the original saved walk intact and does not re-review superseded calendars", async () => {
  const recorded = await walk(SITE());
  const before = JSON.stringify(recorded.attempt);
  const selected = review(recorded.attempt, recorded.bodies, { routes: [ROUTE] });
  assert.ok(selected.accepted.length > 0);
  const superseded = review(recorded.attempt, recorded.bodies, { routes: ["https://elsewhere.example.gov/another.ics"] });
  assert.deepEqual(superseded.accepted, []);
  assert.deepEqual(superseded.held, []);
  assert.equal(JSON.stringify(recorded.attempt), before);
});

test("an official school's linked Diligent portal becomes a reviewed, body-filtered reader connection", async () => {
  const portal = "https://fixture.community.highbond.com/Portal/";
  const portalHtml = '<h1>Fixture Accommodation Schools</h1><h2>Governing Board</h2><a href="/Portal/MeetingSchedule.aspx">Calendar</a>';
  const route = meetingEndpointCandidates(portalHtml, portal, T_WALK).find(c => c.vendor === "diligent")!.url;
  const rows = [
    { Id: 217, Name: "Regular Board Meeting - Oct 14 2026", MeetingTypeName: "Regular Board Meeting", MeetingDateTime: "2026-10-14 16:15", MeetingLocation: "Support Center", Published: false },
    { Id: 218, Name: "Finance Committee Meeting", MeetingTypeName: "Finance Committee", MeetingDateTime: "2026-10-15 12:00", MeetingLocation: "Support Center", Published: true },
  ];
  const jurisdictionId = "az:depschool:fixture-accommodation-school";
  const ocdId = "ocd-division/country:us/state:az/school_district:fixture";
  const recorded = await walk({
    [`https://${HOST}/robots.txt`]: ALLOW,
    [`https://${HOST}/`]: { status: 200, body: `<h1>Fixture Accommodation Schools</h1><a href="${portal}">Governing Board Agenda/Minutes</a>` },
    "https://fixture.community.highbond.com/robots.txt": ALLOW,
    [portal]: { status: 200, body: portalHtml },
    [route]: { status: 200, body: JSON.stringify(rows), contentType: "application/json" },
  }, { jurisdictionId, stateCode: "AZ", name: "Fixture Accommodation Schools" });
  const result = review(recorded.attempt, recorded.bodies, { registered: { bodyId: `${ocdId}#board`, ocdId, publishingOrg: "Fixture Accommodation Schools", countyFips: "04013", input: { ...REGISTRATION, scope: "US-AZ:registration:v1" } } });
  const accepted = result.accepted.find(a => a.row.bodyId === `${ocdId}#board`);
  assert.ok(accepted, JSON.stringify(result.held));
  assert.equal(accepted.row.kind, "DILIGENT");
  assert.equal(accepted.row.filter.titleMatch, "Regular Board Meeting");
  assert.equal(crosswalkRowIssue(accepted.row), null);
  const row = { ...accepted.row, officialHost: new URL(route).hostname, state: "US-AZ", config: derivedAdapterConfig({ ...accepted.row, officialHost: new URL(route).hostname }), crosswalkRowId: accepted.row.id, verifiedAt: T_WALK } as DerivedWiringRow;
  const source = makeDiligentSource([bodySourceWiringFor(row)]);
  const read = source.normalizeWithDrops([{ wiring: bodySourceWiringFor(row), meetings: rows, collectedAt: T_WALK }], new Date(NOW));
  assert.equal(read.meetings.length, 1, "the other committee is not misattributed to the board");
  assert.equal(Date.parse(read.meetings[0].startsAt), Date.parse("2026-10-14T23:15:00.000Z"));
  assert.equal(read.meetings[0].agendaUrl, null, "the schedule publishes even while the portal has not published its agenda");
  assert.equal(read.meetings[0].bodyId, `${ocdId}#board`);
  const unattested = review({ ...recorded.attempt, site: undefined }, recorded.bodies);
  assert.equal(unattested.accepted.length, 0, "recognizing a vendor alone never establishes body identity");
});

function review(attempt: MeetingsDiscoveryAttempt, bodies: ReadonlyMap<string, HeldBytes>, over: Partial<Parameters<typeof reviewDiscoveryWalk>[0]> = {}) {
  return reviewDiscoveryWalk({
    walk: { attempt, recordId: "7", recordedAt: attempt.finishedAt },
    registered: REGISTERED,
    held: (id) => bodies.get(id) ?? null,
    handWired: () => false,
    reviewer: REVIEWER,
    now: NOW,
    ...over,
  });
}

const reasons = (r: AutoCrosswalkReview) => r.held.map((h) => `${h.reason}:${h.bodyName ?? "-"}`).sort();

test("ACCEPTED: the registered governing body and a printed sub-body, each on its own exact filter, every C16 check passing", async () => {
  const { attempt, bodies } = await walk(SITE());
  assert.equal(attempt.outcome, "FOUND");
  const r = review(attempt, bodies);
  const rows = new Map(r.accepted.map((a) => [a.row.bodyName, a.row]));
  assert.deepEqual([...rows.keys()].sort(), ["City Council", "Fair Housing Commission", "Housing Commission", "Tourism Commission", "Youth City Council"]);

  const council = rows.get("City Council")!;
  assert.equal(council.bodyId, `${OCD}#governing`, "the registered body, never a name-derived one");
  assert.equal(council.bodyRole, "GOVERNING");
  assert.deepEqual(council.filter, { titleMatch: "City Council", titleExclude: "Youth City Council" }, "a longer name that contains it is excluded by its exact words");
  assert.equal(council.evidence.calendar.selected, 2);
  assert.equal(council.evidence.calendar.total, 8);
  assert.equal(council.timeZone, "America/New_York");
  assert.equal(council.officialHost, HOST);

  const housing = rows.get("Housing Commission")!;
  assert.equal(housing.bodyId, subBodyId(OCD, "Housing Commission"));
  assert.equal(housing.bodyRole, "SUB_BODY");
  assert.deepEqual(housing.filter, { titleMatch: "Housing Commission", titleExclude: "Fair Housing Commission" }, "Fair Housing Commission is another body");
  assert.equal(housing.evidence.calendar.selected, 1);

  for (const row of r.accepted.map((a) => a.row)) {
    assert.equal(crosswalkRowIssue(row), null);
    assert.equal(row.reviewedBy, REVIEWER, "the reviewer is the reviewer's code version, never the owner");
    assert.equal(row.evidence.calendar.sha256, textSha256(FEED), "the calendar is cited by the sha256 of the bytes the walk vaulted");
    const separatePage = row.bodyName === "City Council" || row.bodyName === "Housing Commission";
    assert.equal(row.evidence.bodyPage.sha256, textSha256(separatePage ? HOME : FEED));
    assert.equal(row.evidence.bodyPage.url, separatePage ? `https://${HOST}/` : ROUTE);
    assert.ok(row.evidence.bodyPage.quote.includes(row.bodyName));
    assert.equal(row.authorization, CROSSWALK_CITATION);
  }
  assert.deepEqual(reasons(r), [
    "SEPARATE_GOVERNMENT_NAME:Franklin County Commission",
  ], "every other printed name is held by name, never guessed");
  for (const h of r.held) {
    assert.ok(h.ruledOut && h.wouldSettle && h.whoMovesNext, `${h.key} names its dead end`);
    assert.match(h.key, /^auto-crosswalk:oh:city:city-of-testburg\|https:\/\//);
  }
});

test("an authority commission binds locally while a bare authority remains another government", async () => {
  const feed = ics([
    { uid: "c1", summary: "City Council Meeting", start: "20261005T190000" },
    { uid: "h1", summary: "Housing Authority Commission Meeting", start: "20261006T190000" },
    { uid: "a1", summary: "River Water Authority Meeting", start: "20261007T190000" },
  ]);
  const { attempt, bodies } = await walk(SITE(feed));
  const result = review(attempt, bodies);
  assert.ok(result.accepted.some(entry => entry.row.bodyName === "Housing Authority Commission"), JSON.stringify(result.held));
  assert.ok(result.held.some(entry => entry.bodyName === "River Water Authority" && entry.reason === "SEPARATE_GOVERNMENT_NAME"));
});

test("HELD, AMBIGUOUS TITLE: an event naming the body and another body holds the row; nothing is accepted for it", async () => {
  const feed = ics([
    { uid: "c1", summary: "City Council Regular Meeting", start: "20261005T190000" },
    { uid: "j1", summary: "City Council and Planning Commission Joint Meeting", start: "20261006T190000" },
  ]);
  const { attempt, bodies } = await walk(SITE(feed, `${HOME}<p>Planning Commission</p>`));
  const r = review(attempt, bodies);
  assert.deepEqual(r.accepted, []);
  const held = r.held.find((h) => h.reason === "AMBIGUOUS_TITLE" && h.bodyId === `${OCD}#governing`);
  assert.ok(held, JSON.stringify(r.held));
  assert.match(held.detail, /"City Council and Planning Commission Joint Meeting" names City Council and Planning Commission/);
  assert.equal(held.whoMovesNext, "a reviewing agent session");
  assert.ok(r.held.some((h) => h.reason === "AMBIGUOUS_TITLE" && h.bodyName === "Planning Commission"), "the other body is held on the same evidence");
});

test("HELD: a calendar off the government's attested own host, and a name no saved page prints", async () => {
  const google = "https://calendar.google.com/calendar/ical/testburg%40example.com/public/basic.ics";
  const { attempt, bodies } = await walk({
    [`https://${HOST}/robots.txt`]: ALLOW,
    [`https://${HOST}/`]: { status: 200, body: `<a href="${google}">Calendar</a> City Council` },
    "https://calendar.google.com/robots.txt": ALLOW,
    [google]: { status: 200, body: FEED, contentType: "text/calendar" },
  });
  assert.equal(attempt.outcome, "FOUND");
  const r = review(attempt, bodies);
  assert.deepEqual(r.accepted, []);
  assert.deepEqual(reasons(r), ["HOST_NOT_OWN:-"]);
});

test("HELD: bytes not vaulted, a government registration does not pair, a hand-wired body, and a find of another kind", async () => {
  const { attempt, bodies } = await walk(SITE());
  assert.deepEqual(reasons(review(attempt, new Map())), ["EVIDENCE_NOT_VAULTED:-"]);
  assert.deepEqual(reasons(review(attempt, bodies, { registered: { notRegistered: "OH registration pairs oh:city:city-of-testburg with no body" } })), ["BODY_NOT_REGISTERED:-"]);
  const wired = review(attempt, bodies, { handWired: (id) => id === `${OCD}#governing` });
  assert.ok(wired.held.some((h) => h.reason === "ALREADY_WIRED" && h.bodyName === "City Council"));
  assert.deepEqual(wired.accepted.map((a) => a.row.bodyName), ["Fair Housing Commission", "Housing Commission", "Tourism Commission", "Youth City Council"]);

  const unsupported = { ...attempt, found: [{ ...attempt.found[0]!, vendor: "onbase", url: "https://fixture.hylandcloud.com/100" }] };
  assert.deepEqual(reasons(review(unsupported, bodies)), ["KIND_NOT_REVIEWABLE:-"]);
});

test("HELD: robots not shown for a read, a UTC-stamped calendar, and a state whose clock is not one zone", async () => {
  const { attempt, bodies } = await walk(SITE());
  /* Robots.txt is read first and recorded, whatever it says: a walk that recorded no reading of it holds the row. */
  const unread = { ...attempt, steps: attempt.steps.filter((s) => s.purpose !== "robots") };
  assert.deepEqual(reasons(review(unread, bodies)), ["ROBOTS_NOT_READ:-"]);
  /* A verdict other than ALLOWED is evidence, never a hold. */
  const cannotTell = { ...attempt, steps: attempt.steps.map((s) => (s.purpose === "robots" ? { ...s, permission: "CANNOT_TELL" as const } : s)) };
  assert.deepEqual(reasons(review(cannotTell, bodies)), reasons(review(attempt, bodies)));

  const utc = ics([{ uid: "c1", summary: "City Council Regular Meeting", start: "20261005T230000", tz: null }]);
  const stamped = await walk(SITE(utc));
  const r = review(stamped.attempt, stamped.bodies);
  assert.deepEqual(r.accepted, []);
  assert.ok(r.held.some((h) => h.reason === "UTC_STAMPED_TIMES"), "Holbrook stored 6 PM local as 18:00 UTC (R21): a UTC-stamped feed is confirmed by a person");

  const floating = ics([{ uid: "c1", summary: "City Council Regular Meeting", start: "20261005T190000" }].map((e) => ({ ...e, tz: undefined })), []);
  const texas = await walk(SITE(floating.replace(/DTSTART;TZID=America\/New_York:/g, "DTSTART:")), { stateCode: "TX" });
  const tx = review(texas.attempt, texas.bodies);
  assert.deepEqual(tx.accepted, []);
  assert.ok(tx.held.some((h) => h.reason === "TIME_ZONE_UNKNOWN"), "Texas spans zones and the feed states none: never guessed");

  const eastern = await walk(SITE(ics([{ uid: "c1", summary: "City Council Regular Meeting", start: "20261005T190000", tz: "America/Chicago" }])));
  assert.ok(review(eastern.attempt, eastern.bodies).held.some((h) => h.reason === "TIME_ZONE_CONFLICT"), "an Ohio calendar keeping Central time is a conflict");
});

test("ROBOTS IS RECORDED, NOT BLOCKING: a robots.txt that disallows every path, or cannot be read, holds no row; an access control on the naming page does", async () => {
  const robots = `https://${HOST}/robots.txt`;
  for (const [label, reply] of [
    ["a disallow-all robots.txt", { status: 200, body: "User-agent: *\nDisallow: /\n", contentType: "text/plain" }],
    ["a robots.txt that answered 500", { status: 500, body: "server error" }],
    ["a robots.txt behind a 403", { status: 403, body: "forbidden" }],
  ] as const) {
    const walked = await walk({ ...SITE(), [robots]: reply });
    assert.equal(walked.attempt.outcome, "FOUND", `${label}: the walk reads the public pages anyway`);
    const recorded = walked.attempt.steps.filter((s) => s.purpose !== "robots").map((s) => s.permission);
    assert.ok(recorded.length > 0 && recorded.every((p) => p !== "ALLOWED" && p !== "NO_ROBOTS"), `${label}: the verdict travels on every read (${recorded.join(", ")})`);
    const r = review(walked.attempt, walked.bodies);
    assert.deepEqual(r.accepted.map((a) => a.row.bodyName).sort(), ["City Council", "Fair Housing Commission", "Housing Commission", "Tourism Commission", "Youth City Council"], `${label}: accepted on the same checks as any read`);
    assert.ok(r.held.every((h) => h.reason !== "PERMISSION_NOT_SHOWN" && h.reason !== "ROBOTS_NOT_READ"), `${label}: ${reasons(r).join(", ")}`);
  }

  /* A bot challenge answered in place of the naming page is an access control: never read as the government's page. */
  const { attempt, bodies } = await walk(SITE());
  const home = attempt.steps.find((s) => s.purpose === "homepage" && s.status === 200)!;
  const challenged = new Map(bodies);
  challenged.set(home.artifactId!, { ...bodies.get(home.artifactId!)!, text: `<html><head><title>Just a moment...</title></head><body>${HOME}</body></html>` });
  const r = review(attempt, challenged);
  assert.ok(r.accepted.length > 0, "the independently accessible official calendar still supplies its facts");
  assert.ok(r.accepted.every(({ row }) => row.evidence.bodyPage.url === ROUTE), "the challenge page is never cited as the naming document");
});

test("an official calendar names a county sub-body without a second page or a duplicate county-prefixed identity", async () => {
  const feed = ics([{ uid: "board", summary: "Testburg County Board of Adjustment Meeting", start: "20261021T170000" }]);
  const recorded = await walk(SITE(feed, '<a href="/calendar/meetings.ics">Development Services calendar</a>'), {
    jurisdictionId: "oh:county:county-of-testburg", govClass: "COUNTY", name: "TESTBURG COUNTY",
  });
  const r = review(recorded.attempt, recorded.bodies);
  const row = r.accepted.find(({ row }) => row.bodyName === "Board of Adjustment")?.row;
  assert.ok(row, reasons(r).join(", "));
  assert.equal(row.bodyId, subBodyId(OCD, "Board of Adjustment"));
  assert.equal(row.evidence.bodyPage.url, ROUTE);
  assert.equal(row.evidence.bodyPage.sha256, textSha256(feed));
  assert.match(row.evidence.bodyPage.quote, /County Board of Adjustment/);
  assert.equal(row.evidence.calendar.selected, 1);
});

test("HELD: two bodies selecting one event, and a category that is a body's name", async () => {
  /* One sitting filed under two boards: each filter alone is clean, and together they claim the same event. */
  const both = ics([
    { uid: "a1", summary: "Regular Meeting", start: "20261005T190000", categories: "Parks Board,Zoning Board" },
  ]);
  const home = `${HOME}<p>Parks Board</p><p>Zoning Board</p>`;
  const conflicted = await walk(SITE(both, home));
  const r = review(conflicted.attempt, conflicted.bodies);
  assert.deepEqual(r.accepted, []);
  assert.deepEqual(reasons(r).filter((x) => x.startsWith("CONFLICTING")), ["CONFLICTING_SELECTION:Parks Board", "CONFLICTING_SELECTION:Zoning Board"]);
  const joined = await walk(SITE(ics([{ uid: "a1", summary: "Housing Commission / Parks Board", start: "20261005T190000" }]), home));
  assert.ok(review(joined.attempt, joined.bodies).held.every((h) => h.reason !== "CONFLICTING_SELECTION"), "a title naming two bodies is held as ambiguous before any conflict");

  const categorized = ics([
    { uid: "p1", summary: "Regular Meeting", start: "20261005T190000", categories: "Planning Board" },
    { uid: "p2", summary: "Special Meeting", start: "20261006T190000", categories: "Planning Board" },
  ]);
  const byCategory = await walk(SITE(categorized, `${HOME}<p>Planning Board</p>`));
  const c = review(byCategory.attempt, byCategory.bodies);
  assert.deepEqual(c.accepted.map((a) => [a.row.bodyName, a.row.filter]), [["Planning Board", { categoryMatch: "Planning Board" }]]);
  assert.equal(c.accepted[0]!.row.evidence.calendar.selected, 2);
});

test("PRINTED NAMES: a run of capitalized words ending in a body noun, two bodies joined by 'and' are two", () => {
  const names = (title: string) => printedNames(title, JURISDICTION).map((n) => n.text);
  assert.deepEqual(names("Regular City Council Meeting"), ["City Council"]);
  assert.deepEqual(names("Testburg Housing Commission"), ["Housing Commission"]);
  assert.deepEqual(names("City Council and Planning Commission Joint Meeting"), ["City Council", "Planning Commission"]);
  assert.deepEqual(names("Parks and Recreation Advisory Board"), ["Parks and Recreation Advisory Board"]);
  assert.deepEqual(names("Board of Zoning Appeals Meeting"), ["Board of Zoning Appeals"]);
  assert.deepEqual(names("City Council Finance Committee"), ["City Council Finance Committee"]);
  assert.deepEqual(names("CITY COUNCIL - SPECIAL MEETING"), ["CITY COUNCIL"]);
  assert.deepEqual(names("Fall Festival"), []);
  assert.deepEqual(names("Board of Commissioners General Session"), ["Board of Commissioners"], "a body noun ends a noun-first name");
  assert.deepEqual(names("Board of Education Budget Hearing"), ["Board of Education"]);
  assert.deepEqual(printedNames("Franklin County Board of Commissioners Briefing", "oh:county:county-of-franklin").map((n) => n.text), ["County Board of Commissioners"], "the government's own name is not the body's");
});

function row(patch: Partial<MeetingBodyCrosswalkRow> = {}): MeetingBodyCrosswalkRow {
  const bodyId = subBodyId(OCD, "Housing Commission");
  return {
    id: `${bodyId}|ICAL`, jurisdictionId: JURISDICTION, ocdId: OCD, bodyId, bodyRole: "SUB_BODY", bodyName: "Housing Commission",
    kind: "ICAL", route: ROUTE, officialHost: HOST, filter: { titleMatch: "Housing Commission" }, publishingOrg: "Testburg city", timeZone: "America/New_York",
    evidence: {
      bodyPage: { url: `https://${HOST}/`, sha256: "1".repeat(64), quote: "The Housing Commission advises" },
      calendar: { url: ROUTE, sha256: "2".repeat(64), selected: 1, total: 8 },
      readAt: T_WALK,
    },
    status: "ACTIVE", reviewedBy: REVIEWER, reviewedAt: NOW, authorization: CROSSWALK_CITATION,
    ...patch,
  };
}

const reviewOf = (rows: readonly MeetingBodyCrosswalkRow[], held: AutoCrosswalkReview["held"] = []): AutoCrosswalkReview => ({
  jurisdictionId: JURISDICTION,
  inputs: [{ kind: "DISCOVERY_ATTEMPT", attemptId: "da-1", recordId: "7", recordedAt: T_WALK }],
  accepted: rows.map((r) => ({ row: r, inputs: [] })),
  held,
});

test("every verified route survives beside a legacy calendar; renewing or withdrawing one does not replace another", () => {
  const legacy = row();
  const route = `https://${HOST}/other-calendar.ics`;
  const other = row({ id: crosswalkRowId(legacy.bodyId, "ICAL", route), route,
    evidence: { ...legacy.evidence, calendar: { ...legacy.evidence.calendar, url: route } } });
  const updated = { ...legacy, id: crosswalkRowId(legacy.bodyId, "ICAL", legacy.route) };
  const plan = planDerivedCrosswalk({ previous: [legacy], reviews: [reviewOf([updated, other])] });
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.rows.find(value => value.route === legacy.route), legacy, "held identity and evidence stay exact");
  assert.deepEqual(plan.accepted, [other.id]);
  assert.deepEqual(derivedCrosswalkProjectionIssue({ kind: "meeting-body-crosswalk-derived", formatVersion: 1, records: plan.rows }), null);
  const withdrawn = { ...legacy, status: "WITHDRAWN" as const, reviewedBy: "reviewing agent", withdrawal: { reason: "route replaced" } };
  assert.deepEqual(composeCrosswalk([withdrawn], plan.rows).rows.map(value => value.id), [withdrawn.id, other.id]);
  assert.deepEqual(planDerivedCrosswalk({ previous: plan.rows, reviews: [] }).rows, plan.rows, "an outage keeps both calendars");
});

test("THE PLAN: an accepted row is never dropped; the same walk carries it byte-exactly, a newer walk renews it, an older one never does", () => {
  const first = planDerivedCrosswalk({ previous: [], reviews: [reviewOf([row()])] });
  assert.deepEqual(first.accepted, [row().id]);

  /* The next pass reviews the same walk: the row is carried as it was, even with a later review time. */
  const same = planDerivedCrosswalk({ previous: first.rows, reviews: [reviewOf([row({ reviewedAt: "2026-09-25T19:00:00.000Z" })])] });
  assert.deepEqual(same.carried, [row().id]);
  assert.deepEqual(same.rows, first.rows);

  /* An outage or a walk that did not reach the calendar: no review of it at all. Carried. */
  const outage = planDerivedCrosswalk({ previous: first.rows, reviews: [] });
  assert.deepEqual(outage.rows, first.rows);

  /* A newer walk's evidence renews it: this is also the later review a suspended connection waits for. */
  const newer = row({ evidence: { ...row().evidence, calendar: { ...row().evidence.calendar, sha256: "3".repeat(64) }, readAt: "2026-10-05T12:00:00.000Z" }, reviewedAt: "2026-10-05T13:00:00.000Z" });
  const renewed = planDerivedCrosswalk({ previous: first.rows, reviews: [reviewOf([newer])] });
  assert.deepEqual(renewed.renewed, [row().id]);
  assert.equal(renewed.rows[0]!.reviewedAt, "2026-10-05T13:00:00.000Z");

  /* A review of an older walk never replaces newer evidence. */
  const older = row({ evidence: { ...row().evidence, calendar: { ...row().evidence.calendar, sha256: "4".repeat(64) }, readAt: "2026-09-20T12:00:00.000Z" } });
  assert.deepEqual(planDerivedCrosswalk({ previous: renewed.rows, reviews: [reviewOf([older])] }).rows, renewed.rows);

  /* A hold on a later pass never removes the accepted row. */
  const held = planDerivedCrosswalk({
    previous: first.rows,
    reviews: [reviewOf([], [{ key: "auto-crosswalk:x|y|AMBIGUOUS_TITLE|housing-commission", jurisdictionId: JURISDICTION, route: ROUTE, bodyName: "Housing Commission", bodyId: null, reason: "AMBIGUOUS_TITLE", detail: "d", ruledOut: "r", wouldSettle: "w", whoMovesNext: "a reviewing agent session" }])],
  });
  assert.deepEqual(held.rows, first.rows);
  assert.equal(held.held.length, 1);
  const candidate = derivedCrosswalkCandidate(held, [], NOW);
  assert.deepEqual(candidate.excludedFacts?.map((f) => f.code), ["AUTO_CROSSWALK_HELD_AMBIGUOUS_TITLE"], "Admin's held records show the dead end");
  assert.match(candidate.excludedFacts?.[0]?.detail ?? "", /Who moves next: a reviewing agent session\./);
});

test("THE VERSION: every row passes C16 and names the reviewer's code version; a manual reviewer's row is refused", () => {
  const plan = planDerivedCrosswalk({ previous: [], reviews: [reviewOf([row()])] });
  const candidate = derivedCrosswalkCandidate(plan, [], NOW);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal(derivedCrosswalkProjectionIssue(candidate.readModel), null);
  assert.match(
    derivedCrosswalkProjectionIssue({ kind: "meeting-body-crosswalk-derived", formatVersion: 1, records: [row({ reviewedBy: "a reviewing agent session" })] }) ?? "",
    /names the reviewer's code version/,
  );
  assert.match(
    derivedCrosswalkProjectionIssue({ kind: "meeting-body-crosswalk-derived", formatVersion: 1, records: [row({ evidence: { ...row().evidence, calendar: { ...row().evidence.calendar, selected: 0 } } })] }) ?? "",
    /selected no meeting/,
  );
});

/** The reader adapter's own reading of held bytes with a row's filter (the wiring derive's `verify`). */
function adapterVerify(texts: ReadonlyMap<string, string>): DerivedWiringInputs["verify"] {
  return (wiringRow, binding, evidence, others) => {
    const text = texts.get(evidence.artifactId) ?? "";
    const wiring = bodySourceWiringFor(wiringRow);
    const own = makeIcalSource([wiring]).normalizeWithDrops([{ wiring, ics: text, collectedAt: NOW, sourceUrl: wiringRow.route }], new Date(NOW)).meetings
      .filter((m) => m.bodyId === wiringRow.bodyId);
    if (own.length === 0) return { changed: "the reviewed filter selects none of the feed's events" };
    const foreign = own.find((m) => !m.title.toLowerCase().includes(wiringRow.bodyName.toLowerCase()) && others.some((o) => m.title.toLowerCase().includes(o.toLowerCase())));
    if (foreign) return { wrongAttribution: `"${foreign.title}" names another body` };
    return { verified: { adapter: binding.adapter, closureDigest: binding.closureDigest, verifiedAt: NOW, sittings: own.length, evidence }, selected: own.map((m) => `${m.startsAt}|${m.title}`) };
  };
}

function wiringInputs(
  walked: { attempt: MeetingsDiscoveryAttempt; bodies: ReadonlyMap<string, HeldBytes> },
  rows: readonly MeetingBodyCrosswalkRow[],
  automaticIds: ReadonlySet<string>,
  previous: DerivedWiringInputs["previous"],
  now: string,
): DerivedWiringInputs {
  const manualInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US-AZ+US-NH+US-NJ:meeting-body-crosswalk", versionId: "xw-manual", readModelSha256: "d".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" };
  const autoInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-body-crosswalk-derived", versionId: "xw-auto", readModelSha256: "e".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" };
  const texts = new Map([...walked.bodies].map(([id, b]) => [id, b.text] as const));
  return {
    crosswalk: { input: manualInput, versionId: "xw-manual", rows, automatic: { input: autoInput, versionId: "xw-auto", rowIds: automaticIds } },
    registration: () => ({ input: REGISTRATION }),
    attempts: [{ attempt: walked.attempt, recordId: "7", recordedAt: walked.attempt.finishedAt }],
    handWired: () => false,
    vaulted: (id) => walked.bodies.get(id)?.evidence ?? null,
    vaultedBytes: (hex) => [...walked.bodies.values()].find((b) => b.sha256 === hex)?.evidence ?? null,
    verify: adapterVerify(texts),
    adapterDigest: () => "ical@0123456789ab",
    previous,
    now,
  };
}

test("THE C16 TRIGGERS APPLY TO AUTOMATIC ROWS EXACTLY: a 404 suspends it, an outage never drops it, and only a later automatic review restores it", async () => {
  const later = (days: number) => new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
  const first = await walk(SITE());
  const accepted = review(first.attempt, first.bodies).accepted.find((a) => a.row.bodyName === "Housing Commission")!.row;
  const auto = new Set([accepted.id]);
  const promoted = planDerivedVersion([], deriveWiringDecisions(wiringInputs(first, [accepted], auto, [], NOW)));
  assert.deepEqual(promoted.promoted, [derivedWiringKey(accepted.kind, accepted.bodyId, accepted.route)]);

  /* The calendar now answers 404: ROUTE_GONE suspends the automatic row, exactly as a reviewed one. */
  const gone = await walk({ ...SITE(), [ROUTE]: { status: 404, body: "gone" } });
  assert.notEqual(gone.attempt.outcome, "FOUND");
  const suspended = planDerivedVersion(promoted.rows, deriveWiringDecisions(wiringInputs(gone, [accepted], auto, promoted.rows, later(1))));
  assert.equal(suspended.rows[0]!.suspension?.trigger, "ROUTE_GONE");
  /* The reviewer made no review of a walk that found nothing: the automatic row is carried, never dropped or withdrawn. */
  const carried = planDerivedCrosswalk({ previous: [accepted], reviews: [review(gone.attempt, gone.bodies)] });
  assert.deepEqual(carried.rows, [accepted]);

  /* The same evidence again restores nothing: the suspended row waits for a review later than its suspension. */
  const again = planDerivedVersion(suspended.rows, deriveWiringDecisions(wiringInputs(first, [accepted], auto, suspended.rows, later(2))));
  assert.equal(again.rows[0]!.suspension?.trigger, "ROUTE_GONE");

  /* A newer walk finds the calendar again; the reviewer's newer review renews the row, and that review restores it. */
  const back = await walk(SITE());
  const renewedRows = planDerivedCrosswalk({
    previous: [accepted],
    reviews: [review({ ...back.attempt }, new Map([...back.bodies].map(([id, b]) => [id, { ...b, evidence: { ...b.evidence, retrievedAt: later(3) } }])), { now: later(3) })],
  });
  assert.deepEqual(renewedRows.renewed, [accepted.id]);
  const restored = planDerivedVersion(suspended.rows, deriveWiringDecisions(wiringInputs(back, renewedRows.rows, new Set(renewedRows.rows.map((r) => r.id)), suspended.rows, later(3))));
  assert.ok(restored.promoted.includes(derivedWiringKey(accepted.kind, accepted.bodyId, accepted.route)));
  assert.equal(restored.rows.find((e) => e.key === derivedWiringKey(accepted.kind, accepted.bodyId, accepted.route))!.suspension, undefined, "restored by a review after its suspension");

  /* A person's withdrawal wins over the reviewer: CROSSWALK_WITHDRAWN suspends the connection the automatic row made. */
  const withdrawn = { ...accepted, reviewedBy: "a reviewing agent session", status: "WITHDRAWN" as const, withdrawal: { reason: "not the city's commission" } };
  const composed = composeCrosswalk([withdrawn], [accepted]);
  const byReview = planDerivedVersion(promoted.rows, deriveWiringDecisions(wiringInputs(first, composed.rows, composed.automaticIds, promoted.rows, later(4))));
  assert.equal(byReview.rows[0]!.suspension?.trigger, "CROSSWALK_WITHDRAWN");
});

test("A REVIEWED ROW WINS A CONFLICT: where a manual and an automatic row select one sitting, only the automatic row meets the trigger", async () => {
  const first = await walk(SITE());
  const accepted = review(first.attempt, first.bodies).accepted.find((a) => a.row.bodyName === "Housing Commission")!.row;
  /* A reviewed row for another body whose filter also selects the Housing Commission's sitting, naming no other body. */
  const otherId = subBodyId(OCD, "Commission");
  const manual: MeetingBodyCrosswalkRow = {
    ...accepted, id: `${otherId}|ICAL`, bodyId: otherId, bodyName: "Commission", filter: { titleMatch: "Commission" },
    reviewedBy: "a reviewing agent session",
    evidence: { ...accepted.evidence, bodyPage: { ...accepted.evidence.bodyPage, quote: "the Housing Commission advises" } },
  };
  const composed = composeCrosswalk([manual], [accepted]);
  assert.deepEqual(composed.rows.map((r) => r.id).sort(), [accepted.id, manual.id].sort(), "different filters: both are decided");
  const decisions = deriveWiringDecisions(wiringInputs(first, composed.rows, composed.automaticIds, [], NOW));
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  assert.equal(byKey.get(derivedWiringKey(manual.kind, otherId, manual.route))?.disposition, "PROMOTE", `the reviewed row stands: ${JSON.stringify(byKey.get(derivedWiringKey(manual.kind, otherId, manual.route))).slice(0, 300)}`);
  const lost = byKey.get(derivedWiringKey(accepted.kind, accepted.bodyId, accepted.route));
  assert.equal(lost?.disposition, "HOLD");
  assert.match(lost?.disposition === "HOLD" ? lost.detail : "", /^CONFLICTING_EVIDENCE/);
});

test("MANUAL ROWS WIN: a reviewed row for the same body and kind, withdrawn or not, and one claiming the same calendar and filter", () => {
  const auto = row();
  const manual = row({ reviewedBy: "a reviewing agent session", status: "WITHDRAWN", withdrawal: { reason: "the commission was dissolved" } });
  const composed = composeCrosswalk([manual], [auto]);
  assert.deepEqual(composed.rows, [manual], "a withdrawal by review is never undone by the reviewer");
  assert.equal(composed.automaticIds.size, 0);

  const other = row({ reviewedBy: "a reviewing agent session", bodyName: "Housing Board", bodyId: subBodyId(OCD, "Housing Board"), id: `${subBodyId(OCD, "Housing Board")}|ICAL`, evidence: { ...row().evidence, bodyPage: { ...row().evidence.bodyPage, quote: "The Housing Board advises" } } });
  const claimed = composeCrosswalk([other], [auto]);
  assert.deepEqual(claimed.rows.map((r) => r.id), [other.id]);
  assert.match(claimed.shadowed[0]?.why ?? "", /claims the same calendar and filter/);

  const alone = composeCrosswalk(null, [auto]);
  assert.deepEqual([...alone.automaticIds], [auto.id], "automatic rows connect calendars on their own");
});
