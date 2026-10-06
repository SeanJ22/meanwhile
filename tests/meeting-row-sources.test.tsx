import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MeetingCard } from "../components/ui/meeting-card.tsx";
import { MeetingRow } from "../components/ui/meeting-row.tsx";
import type { Meeting } from "../lib/sources/types.ts";

const base: Meeting = { id: "meeting:shared", title: "Budget hearing", bodyName: "Council", jurisdiction: "Example", ocdId: "ocd-division/country:us/state:az/place:example", startsAt: "2026-10-06T18:00:00Z", endsAt: null, timeZone: "America/Phoenix", status: "SCHEDULED", location: null, agendaUrl: null, provenance: { sourceUrl: "https://clerk.example.gov/calendar", sourceOrg: "Example Clerk", collectedAt: new Date().toISOString(), verifiedAt: null } } as Meeting;
const render = (meeting: Meeting) => renderToStaticMarkup(<MeetingRow meeting={meeting} compact />);

test("shared meeting row keeps its native identity and published online action", () => {
  const html = render({ ...base, online: { label: "Publisher's online room", joinUrl: "https://join.example.gov/room" } });
  assert.equal((html.match(/data-meeting-id="meeting:shared"/g) ?? []).length, 1);
  assert.match(html, /data-meeting-where="online"/);
  assert.match(html, /href="https:\/\/join.example.gov\/room"[^>]*>Join online/);
  assert.match(html, /Publisher&#x27;s online room/);
  assert.match(html, /data-card-sources/);
});

test("only a fresh first-party empty-slot observation earns Agenda not posted yet", () => {
  const observed = { ...base, agendaSlotObservedEmpty: true };
  assert.match(render(observed), /Agenda not posted yet/);
  for (const meeting of [base, { ...observed, provenance: { ...base.provenance, sourceUrl: null } }, { ...observed, provenance: { ...base.provenance, secondHand: true } }, { ...observed, provenance: { ...base.provenance, collectedAt: "2000-01-01" } }, { ...observed, carried: { source: "calendar", lastFreshAt: "2000-01-01" } }]) {
    assert.doesNotMatch(render(meeting), /Agenda not posted yet/);
    assert.match(render(meeting), /data-working-on-it="not-searched"/);
  }
});


test("a second-hand meeting retains its classification only within Sources", () => {
  const html = render({ ...base, provenance: { ...base.provenance, secondHand: true } });
  const sourcesAt = html.indexOf('data-card-sources');
  assert.ok(sourcesAt > 0);
  assert.doesNotMatch(html.slice(0, sourcesAt), /Second-hand listing/);
  assert.match(html.slice(sourcesAt), /Second-hand listing/);
  assert.doesNotMatch(render(base), /Second-hand listing/);
});


test("shared meeting card keeps its OCD-derived level after the title", () => {
  const html = renderToStaticMarkup(<MeetingCard meeting={{ ...base, title: "Federal meeting by title only" }} title="Federal meeting by title only" />);
  const heading = html.match(/<h2[^>]*>(.*?)<\/h2>/s)?.[1];
  assert.ok(heading);
  assert.match(heading, /Federal meeting by title only.*data-level-tag="local"/);
  assert.doesNotMatch(heading, /data-level-tag="national"/);
});
