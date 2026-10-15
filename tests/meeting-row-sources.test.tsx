import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MeetingCard } from "../components/ui/meeting-card.tsx";
import { MeetingRow } from "../components/ui/meeting-row.tsx";
import { HowToBeHeard } from "../components/map/meeting-panel.tsx";
import { DataProvider, type ShellData } from "../lib/state/data.tsx";
import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import { meetingCardGaps } from "../lib/meetings/card-gaps.ts";
import type { Meeting } from "../lib/sources/types.ts";

const base: Meeting = { id: "meeting:shared", title: "Budget hearing", bodyName: "Council", jurisdiction: "Example", ocdId: "ocd-division/country:us/state:az/place:example", startsAt: "2026-10-06T18:00:00Z", endsAt: null, timeZone: "America/Phoenix", status: "SCHEDULED", location: null, agendaUrl: null, provenance: { sourceUrl: "https://clerk.example.gov/calendar", sourceOrg: "Example Clerk", collectedAt: new Date().toISOString(), verifiedAt: null } } as Meeting;
const render = (meeting: Meeting) => renderToStaticMarkup(<MeetingRow meeting={meeting} compact />);

test("shared meeting row keeps its native identity and published online action", () => {
  const html = render({ ...base, online: { label: "Publisher's online room", joinUrl: "https://join.example.gov/room" } });
  assert.equal((html.match(/data-meeting-id="meeting:shared"/g) ?? []).length, 1);
  assert.match(html, /data-meeting-where="online"/);
  assert.match(html, /href="https:\/\/join.example.gov\/room"[^>]*>Join online/);
  assert.match(html, /Publisher&#x27;s online room/);
  assert.doesNotMatch(html, /data-card-sources/);
});

test("only a fresh first-party empty-slot observation contributes a not-posted agenda gap", () => {
  const observed = { ...base, agendaSlotObservedEmpty: true };
  assert.equal(meetingCardGaps(observed).find(gap => gap.label === "agendas")?.kind, "not-posted");
  for (const meeting of [base, { ...observed, provenance: { ...base.provenance, sourceUrl: null } }, { ...observed, provenance: { ...base.provenance, secondHand: true } }, { ...observed, provenance: { ...base.provenance, collectedAt: "2000-01-01" } }, { ...observed, carried: { source: "calendar", lastFreshAt: "2000-01-01" } }]) {
    assert.equal(meetingCardGaps(meeting).find(gap => gap.label === "agendas")?.kind, "not-held");
    assert.doesNotMatch(render(meeting), /not posted yet|data-working-on-it|working on getting this info|Want us to get/);
  }
});


test("a second-hand meeting retains its classification only within Sources", () => {
  const html = renderToStaticMarkup(<MeetingCard meeting={{ ...base, provenance: { ...base.provenance, secondHand: true } }} />);
  const sourcesAt = html.indexOf('data-card-sources');
  assert.ok(sourcesAt > 0);
  assert.doesNotMatch(html.slice(0, sourcesAt), /Second-hand listing/);
  assert.match(html.slice(sourcesAt), /Second-hand listing/);
  assert.doesNotMatch(render(base), /Second-hand listing/);
});

test("a held meeting page remains available without an agenda or online join link", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/reader-upcoming-meetings-85701.json", import.meta.url), "utf8")) as { meetings: Meeting[] };
  const meeting = fixture.meetings.find(row => row.id === "diligent:tusd1:503")!;
  assert.ok(meeting);
  assert.equal(meeting.agendaUrl, null);
  assert.equal(meeting.online?.joinUrl, null);
  const html = render(meeting);
  assert.match(html, /Online · Via Zoom Webinar<\/div>/);
  assert.match(html, /href="https:\/\/tusd1-schooldesk\.community\.diligentoneplatform\.com\/Portal\/MeetingInformation\.aspx\?Org=Cal&amp;Id=503"[^>]*>Meeting page/);
  assert.doesNotMatch(html, /Join online|Read the agenda|working on|Want us|Not posted/);
  assert.deepEqual(meetingCardGaps(meeting).map(gap => gap.label), ["agendas", "online join links"]);
});

test("a missing comment-period field preserves the body's held participation instructions", () => {
  const recorded = COMMENT_ACCESS.find(access => access.bodyId.endsWith("#planning-commission"))!;
  const access = { ...recorded, commentPeriod: "UNKNOWN" as const, commentPeriodDetail: null };
  const data = { commentAccess: [access] } as unknown as ShellData;
  const html = renderToStaticMarkup(<DataProvider value={data}><HowToBeHeard bodyId={access.bodyId} ocdId={access.ocdId} bodyName="Planning Commission" /></DataProvider>);
  assert.match(html, /Make your voice heard/);
  assert.match(html, /PlanningCommission@tucsonaz.gov/);
  assert.doesNotMatch(html, /data-card-sources|working on|Want us|UNKNOWN/);
});

test("a missing place is omitted while a publisher's held place is shown verbatim", () => {
  assert.doesNotMatch(render(base), /data-meeting-where/);
  const meeting: Meeting = { ...base, venueGap: { kind: "STATED_NOT_PLACED", publisher: "Example Clerk", publishedText: "Council chambers, west entrance" } };
  assert.match(render(meeting), /data-meeting-where="stated"[^>]*>Council chambers, west entrance/);
  assert.ok(!meetingCardGaps(meeting).some(gap => gap.label === "meeting places"));
});


test("shared meeting card keeps its OCD-derived level after the title", () => {
  const html = renderToStaticMarkup(<MeetingCard meeting={{ ...base, title: "Federal meeting by title only" }} title="Federal meeting by title only" />);
  const heading = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1];
  assert.ok(heading);
  assert.match(heading, /Federal meeting by title only.*data-level-tag="local"/);
  assert.doesNotMatch(heading, /data-level-tag="national"/);
});
