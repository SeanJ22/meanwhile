import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { publishCapturedMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { agendaFileOnPage, canceledOnPage, publishMeetingFacts, sittingOnPage } from "../lib/facts/meeting-facts.ts";
import { meetingEntityId } from "../lib/facts/meeting-read.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";

const clocks = factClocks(null);
const NOW = new Date("2026-10-24T20:00:00.000Z");
const OCD = "ocd-division/country:us/state:tx/place:lewisville", BODY = `${OCD}#body:planning`;

function capture(text: string, url: string, observedAt = NOW.toISOString()): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text, acquiredByAttemptId: "at-feed", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "door" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

function meeting(over: Partial<Meeting> & { id: string; title: string; startsAt: string; sourceUrl: string }): Meeting {
  const { sourceUrl, ...rest } = over;
  return { ocdId: OCD, bodyId: BODY, bodyName: "Planning Commission", timeZone: "America/Chicago", location: null, agendaUrl: null, jurisdiction: "Lewisville, TX",
    status: "SCHEDULED", provenance: { sourceUrl, sourceOrg: "cityoflewisville.legistar.com", collectedAt: NOW.toISOString(), verifiedAt: null }, ...rest } as Meeting;
}

async function seeded() {
  const db = await factDb();
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Lewisville','TX')", [OCD]);
  return db;
}

/** A Legistar calendar row as the page writes it: a long run of markup lies between the date and the time. */
const calendarRow = (title: string, date: string, time: string) => `<tr class="rgRow" valign="top"><td><a id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00_ctl14_hypBody" href="DepartmentDetail.aspx?ID=39270&amp;GUID=4B059E4E-25EC-4EF3-A9C1-8A67BC7FEE49" style="color:Blue;font-family:Tahoma;font-size:10pt;">${title}</a></td><td class="rgSorted">${date}</td><td><span style="white-space: nowrap;"><a id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00_ctl14_hypiCal" href="View.ashx?M=IC&amp;ID=1455879&amp;GUID=4B2DABD4-0560-4CF9-A0DC-3ECBCAC23CFF" style="color:Blue;font-family:Tahoma;font-size:10pt;"><img id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00_ctl14_btnExportToCalendar1" CommandName="Export" src="Images/ical.gif" alt="Export to iCalendar" style="border-width:0px;" /></a></span></td><td><span id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00_ctl14_lblTime" style="color:Black;font-family:Tahoma;font-size:10pt;">${time}</span></td></tr>`;

test("the page that shows the sitting is the copy it is checked on, judged by the text the check reads and not by the markup", async () => {
  const CAL = "https://cityoflewisville.legistar.com/Calendar.aspx";
  const thisMonth = capture(`<html><body><table>${calendarRow("Planning Commission", "10/24/2026", "6:30 PM")}</table></body></html>`, CAL);
  const nextYear = capture(`<html><body><table>${calendarRow("Planning Commission", "10/24/2026", "6:30 PM")}${calendarRow("Planning Commission", "12/14/2026", "5:30 PM")}</table></body></html>`, CAL, "2026-10-24T20:01:00.000Z");
  const sitting = meeting({ id: "legistar-insite:lewisville:1", title: "Planning Commission", startsAt: "2026-12-14T17:30:00-06:00", sourceUrl: CAL });
  assert.equal(sittingOnPage(nextYear.evidence.text, sitting), null, "the raw markup puts the time further than the date's neighbourhood");
  const db = await seeded();
  try {
    const report = await publishCapturedMeetingFacts({ facts: db, meetings: [sitting], captures: [thisMonth, nextYear], producedBy: "test", clocks, now: NOW });
    assert.equal(report.complete, true);
    const [start] = await db.query(`SELECT f.value, f.quote, s.blob_key FROM fact f JOIN source_copy s ON s.id=f.source_copy_id
      WHERE f.entity_id=$1 AND f.field='starts_at' AND f.status='live'`, [meetingEntityId(sitting.id)]);
    assert.equal(start?.blob_key, `artifact:${nextYear.evidence.artifactId}`, "the page that lists December is the copy, not the one that lists October");
    assert.match(String(start?.quote), /12\/14\/2026.*5:30 PM/);
    assert.deepEqual(await db.query("SELECT field FROM blank WHERE entity_id=$1 AND field IN ('title','starts_at')", [meetingEntityId(sitting.id)]), []);
  } finally { await db.pg.close(); }
});

test("a publisher that writes the local clock with a trailing Z is quoted as it wrote it; without that writing the start stays a blank", async () => {
  const API = "https://capeelizabethme.api.civicclerk.com/v1/Events";
  const page = capture('{"value":[{"id":7428,"eventName":"Conservation Committee","startDateTime":"2026-12-08T19:00:00Z"}]}', API);
  const base = { id: "civicclerk:cape:7428", title: "Conservation Committee", startsAt: "2026-12-08T19:00:00-05:00", timeZone: "America/New_York", sourceUrl: API };
  const db = await seeded();
  try {
    await publishMeetingFacts(db, { meeting: meeting({ ...base, startsAtOnPage: "2026-12-08T19:00:00Z" }), capture: page, producedBy: "test" }, clocks, NOW);
    const [start] = await db.query("SELECT value_text, quote FROM fact WHERE entity_id=$1 AND field='starts_at' AND status='live'", [meetingEntityId(base.id)]);
    assert.deepEqual([start?.value_text, start?.quote], ["2026-12-08T19:00:00Z", "2026-12-08T19:00:00Z"]);
    const other = { ...base, id: "civicclerk:cape:7429" };
    await publishMeetingFacts(db, { meeting: meeting(other), capture: page, producedBy: "test" }, clocks, NOW);
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND field='starts_at'", [meetingEntityId(other.id)])).length, 0);
    assert.equal((await db.query("SELECT reason FROM blank WHERE entity_id=$1 AND field='starts_at'", [meetingEntityId(other.id)]))[0]?.reason, "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY");
  } finally { await db.pg.close(); }
});

test("a CivicClerk agenda file is quoted by its number beside the word Agenda, and a number beside another kind of file is not an agenda", async () => {
  const API = "https://auburnwa.api.civicclerk.com/v1/Events";
  const page = capture('{"value":[{"id":2210,"eventName":"Human Services Committee","startDateTime":"2026-12-08T19:00:00Z","publishedFiles":[{"id":0,"fileId":7051,"publishTo":null,"type":"Agenda","name":"Agenda","streamUrl":null},{"id":0,"fileId":7162,"type":"Minutes","name":"Minutes","streamUrl":null}]}]}', API);
  const file = (id: number) => `https://auburnwa.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=${id},plainText=false)`;
  assert.deepEqual(agendaFileOnPage(page.evidence.text, file(7051)), { valueText: "7051", quote: '"fileId":7051,"publishTo":null,"type":"Agenda"' });
  assert.equal(agendaFileOnPage(page.evidence.text, file(7162)), null);
  assert.equal(agendaFileOnPage(page.evidence.text, file(9999)), null);
  const db = await seeded();
  try {
    const base = { id: "civicclerk:auburn:2210", title: "Human Services Committee", startsAt: "2026-12-08T11:00:00-08:00", timeZone: "America/Los_Angeles", sourceUrl: API };
    await publishMeetingFacts(db, { meeting: meeting({ ...base, startsAtOnPage: "2026-12-08T19:00:00Z", agendaUrl: file(7051) }), capture: page, producedBy: "test" }, clocks, NOW);
    const [agenda] = await db.query("SELECT value, quote, quote_start IS NOT NULL AS checked FROM fact WHERE entity_id=$1 AND field='agenda_url' AND status='live'", [meetingEntityId(base.id)]);
    assert.deepEqual([agenda?.value, agenda?.checked], [file(7051), true]);
    const minutes = { ...base, id: "civicclerk:auburn:2211" };
    await publishMeetingFacts(db, { meeting: meeting({ ...minutes, startsAtOnPage: "2026-12-08T19:00:00Z", agendaUrl: file(7162) }), capture: page, producedBy: "test" }, clocks, NOW);
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND field='agenda_url'", [meetingEntityId(minutes.id)])).length, 0);
  } finally { await db.pg.close(); }
});

test("a canceled sitting is a fact quoted from the publisher's own word beside its title, and it moves to history when the publisher stops saying it", async () => {
  const FEED = "https://webapi.legistar.com/v1/lewisville/events";
  const said = '[{"EventId":9,"EventBodyName":"Planning Commission","EventComment":"Planning Commission - CANCELLED","EventDate":"2026-12-14T00:00:00","EventTime":"5:30 PM"}]';
  const unsaid = '[{"EventId":9,"EventBodyName":"Planning Commission","EventComment":"Planning Commission","EventDate":"2026-12-14T00:00:00","EventTime":"5:30 PM"}]';
  assert.equal(canceledOnPage(unsaid, { title: "Planning Commission" }), null);
  const found = canceledOnPage(said, { title: "Planning Commission" });
  assert.equal(found?.valueText, "CANCELLED");
  assert.ok(found?.quote.includes("Planning Commission - CANCELLED"));
  const sitting = meeting({ id: "legistar:lewisville:9", title: "Planning Commission", startsAt: "2026-12-14T17:30:00-06:00", sourceUrl: FEED, status: "CANCELED" });
  const db = await seeded();
  try {
    const id = meetingEntityId(sitting.id);
    await publishMeetingFacts(db, { meeting: sitting, capture: capture(said, FEED), producedBy: "test" }, clocks, NOW);
    assert.deepEqual(await db.query("SELECT value, value_text, status FROM fact WHERE entity_id=$1 AND field='status'", [id]), [{ value: "CANCELED", value_text: "CANCELLED", status: "live" }]);
    const later = new Date(NOW.getTime() + 3_600_000);
    await publishMeetingFacts(db, { meeting: { ...sitting, status: "SCHEDULED" }, capture: capture(unsaid, FEED, later.toISOString()), producedBy: "test", canceledHeld: true }, clocks, later);
    assert.deepEqual(await db.query("SELECT status, held_reason FROM fact WHERE entity_id=$1 AND field='status'", [id]), [{ status: "superseded", held_reason: "GONE_FROM_SOURCE" }]);
    const blind = meeting({ id: "legistar:lewisville:10", title: "Parks Board", startsAt: "2026-12-15T17:30:00-06:00", sourceUrl: FEED, status: "CANCELED" });
    await publishMeetingFacts(db, { meeting: blind, capture: capture(unsaid, FEED), producedBy: "test" }, clocks, NOW);
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND field='status'", [meetingEntityId(blind.id)])).length, 0, "a cancellation the page does not state is not published");
  } finally { await db.pg.close(); }
});

test("a value the saved page does not show is a blank with its reason and never reaches readers", async () => {
  const FEED = "https://cityoflewisville.legistar.com/Calendar.aspx";
  const page = capture("<html><body>Planning Commission 12/14/2026 5:30 PM Council Chambers</body></html>", FEED);
  const sitting = meeting({ id: "legistar-insite:lewisville:2", title: "Planning Commission", startsAt: "2026-12-14T17:30:00-06:00", sourceUrl: FEED,
    agendaUrl: "https://cityoflewisville.legistar.com/View.ashx?M=A&ID=2", videoUrl: "https://cityoflewisville.legistar.com/Video.aspx?ID=2" });
  const db = await seeded();
  try {
    const report = await publishMeetingFacts(db, { meeting: sitting, capture: page, producedBy: "test" }, clocks, NOW);
    const id = meetingEntityId(sitting.id);
    assert.deepEqual((await db.query("SELECT field FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field", [id])).map(row => row.field), ["starts_at", "title"]);
    assert.deepEqual((await db.query("SELECT field, reason FROM blank WHERE entity_id=$1 AND field IN ('agenda_url','video_url') ORDER BY field", [id])),
      [{ field: "agenda_url", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }, { field: "video_url", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
    assert.ok(report.blanks >= 2);
  } finally { await db.pg.close(); }
});
