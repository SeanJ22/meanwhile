/**
 * One sitting the publisher's own calendar lists twice, under two recurring series with every published field
 * the same, is one sitting. The fixture is a recorded read of a town's export with `DESCRIPTION` removed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { reissuesSitting } from "../lib/sources/event-identity.ts";
import { makeIcalSource, parseIcs, publishedFieldsOf, relistedNote } from "../lib/sources/ical/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { reconcileSuccessfulMeetingPartition } from "../scripts/ingest.ts";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "ical", "newbury-2026-09-23-selectboard.ics"), "utf8");
const READ_AT = "2026-09-23T17:30:01.000Z";
const SLUG = "newbury-ical-governing";
const GOVERNING: BodySourceWiring = FIXTURE_DOOR_ROWS.find((row) => row.agendaSourceType === "ICAL" && row.config.slug === SLUG)!;
const id = (node: number) => `ical:${SLUG}:calendar.${node}.field_date_and_time.0@www.newbury.nh.gov`;
const page = (node: number) => `https://www.newbury.nh.gov/home/events/${node}`;

/** The seven in-window sittings the town lists under both series (the last two in the 120-day held window): [survivor node, relisted node, UTC start]. */
const TWICE: readonly (readonly [number, number, string])[] = [
  [42976, 44076, "2026-10-26T22:00:00.000Z"],
  [42981, 44081, "2026-11-09T23:00:00.000Z"],
  [42986, 44086, "2026-11-23T23:00:00.000Z"],
  [42991, 44091, "2026-12-07T23:00:00.000Z"],
  [42996, 44096, "2026-12-21T23:00:00.000Z"],
  [43001, 44101, "2027-01-04T23:00:00.000Z"],
  [43006, 44106, "2027-01-18T23:00:00.000Z"],
];

function normalize(ics: string, now = READ_AT) {
  return makeIcalSource([GOVERNING]).normalizeWithDrops(
    [{ wiring: GOVERNING, ics, collectedAt: now, sourceUrl: GOVERNING.config.feedUrl ?? "" }],
    new Date(now),
  );
}

/** One VEVENT block of the recorded feed, exactly as served, by its node number. */
function block(node: number): string {
  const found = FIXTURE.split("BEGIN:VEVENT").slice(1)
    .map((b) => `BEGIN:VEVENT${b.split("END:VEVENT")[0]}END:VEVENT\r\n`)
    .find((b) => b.includes(`UID:calendar.${node}.field_date_and_time.0@`));
  assert.ok(found, `node ${node} is in the recorded feed`);
  return found;
}

const calendar = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("")}END:VCALENDAR\r\n`;

test("RELISTED · the town's seven in-window twice-listed Selectboard sittings are seven sittings, each keeping both listings", () => {
  const result = normalize(FIXTURE);
  assert.equal(result.accounting.outcome, "CONSERVED");
  assert.equal(result.meetings.length, 17, "24 events in the 120-day window (17 in the 90-day one), 7 of them a second listing of a sitting already held");
  assert.equal(result.duplicateIdentity?.publisherRelisted, 7);

  for (const [kept, relisted, startsAt] of TWICE) {
    const onThatInstant = result.meetings.filter((m) => m.startsAt === startsAt);
    assert.equal(onThatInstant.length, 1, `${startsAt}: one sitting, not two`);
    const [sitting] = onThatInstant;
    assert.equal(sitting.id, id(kept), "the lowest id survives, whatever the feed order");
    assert.equal(sitting.title, "Selectboard Meeting");
    assert.equal(sitting.bodyId, GOVERNING.bodyId);
    assert.deepEqual(sitting.provenance.publisherListings, {
      note: "listed twice in the publisher's own calendar",
      sourceIds: [id(kept), id(relisted)],
      sourceUrls: [page(kept), page(relisted)],
    });
    assert.equal(sitting.provenance.sourceUrl, page(kept));
  }
  // Every other sitting is listed once and says nothing about relisting.
  assert.equal(result.meetings.filter((m) => m.provenance.publisherListings === undefined).length, 10);
});

test("RELISTED · the answer does not depend on which listing the feed serves first", () => {
  const [kept, relisted] = TWICE[0];
  const forward = normalize(calendar(block(kept), block(relisted))).meetings;
  const backward = normalize(calendar(block(relisted), block(kept))).meetings;
  assert.equal(forward.length, 1);
  assert.deepEqual(backward, forward);
});

test("RELISTED · two listings that differ in ANY published field stay two listings", () => {
  // Real pairs the town published at one instant with different titles.
  const spring = normalize(FIXTURE, "2026-04-01T12:00:00.000Z");
  assert.equal(spring.duplicateIdentity?.publisherRelisted, 0);
  for (const [a, b, startsAt] of [[42406, 38991, "2026-02-02T23:00:00.000Z"], [40731, 39016, "2026-04-13T22:00:00.000Z"]] as const) {
    const both = spring.meetings.filter((m) => m.startsAt === startsAt).map((m) => m.id).sort();
    assert.deepEqual(both, [id(a), id(b)].sort(), `${startsAt}: both listings stay`);
  }
  assert.ok(spring.meetings.every((m) => m.provenance.publisherListings === undefined));

  // The two real 26 October listings, each changed in one field the town could
  // publish: a description, a room, an end, a status, another page. None merges.
  // (A title that differs is the two real pairs above.)
  const [kept, relisted] = TWICE[0];
  const edits: readonly [string, (b: string) => string][] = [
    ["description", (b) => b.replace("SUMMARY:", "DESCRIPTION:Agenda to follow\r\nSUMMARY:")],
    ["location", (b) => b.replace("SUMMARY:", "LOCATION:Newbury Town Office\r\nSUMMARY:")],
    ["end", (b) => b.replace("DTEND;TZID=America/New_York:20261026T180000", "DTEND;TZID=America/New_York:20261026T200000")],
    ["status", (b) => b.replace("SUMMARY:", "STATUS:CANCELLED\r\nSUMMARY:")],
    ["url beyond its own id", (b) => b.replace(`/home/events/${relisted}`, `/home/meetings/${relisted}`)],
  ];
  for (const [field, edit] of edits) {
    const result = normalize(calendar(block(kept), edit(block(relisted))));
    assert.equal(result.meetings.length, 2, `${field}: two listings`);
    assert.equal(result.duplicateIdentity?.publisherRelisted, 0, field);
    assert.equal(result.accounting.outcome, "CONSERVED", field);
  }
});

test("RELISTED · only the publisher's record-keeping and the URL's own id are set aside", () => {
  const [kept, relisted] = TWICE[0];
  const [a, b] = parseIcs(calendar(block(kept), block(relisted)));
  assert.notEqual(a.uid, b.uid);
  assert.equal(a.publishedFields, b.publishedFields);
  assert.match(a.publishedFields!, /^URL;TYPE=URI:https:\/\/www\.newbury\.nh\.gov\/home\/events\/\{uid\}$/m);
  assert.doesNotMatch(a.publishedFields!, /^(UID|CREATED|LAST-MODIFIED|DTSTAMP|SEQUENCE)[;:]/m);
  assert.match(a.publishedFields!, /^SUMMARY:Selectboard Meeting$/m);
  assert.match(a.publishedFields!, /^DTSTART;TZID=America\/New_York:20261026T180000$/m);

  // A word the UID and the URL share is not the entry's number and is kept.
  assert.equal(
    publishedFieldsOf("URL:https://t.gov/calendar/events/7\r\nSUMMARY:Board", "calendar.7@t.gov"),
    "URL:https://t.gov/calendar/events/7\nSUMMARY:Board",
  );
  assert.equal(
    publishedFieldsOf("URL:https://t.gov/calendar/events/7123\r\nSUMMARY:Board", "calendar.7123@t.gov"),
    "URL:https://t.gov/calendar/events/{uid}\nSUMMARY:Board",
  );
  assert.equal(relistedNote(3), "listed 3 times in the publisher's own calendar");
});

test("RELISTED · the listing the merge retires yields to the one kept, and is never carried as a second sitting", () => {
  const fresh = normalize(FIXTURE).meetings;
  // Both listings of each sitting, as held before collapsing.
  const before: Meeting[] = fresh.flatMap((meeting) => {
    const listings = meeting.provenance.publisherListings;
    const single = { ...meeting, provenance: { ...meeting.provenance } };
    delete single.provenance.publisherListings;
    if (!listings) return [single];
    return [single, { ...single, id: listings.sourceIds[1], provenance: { ...single.provenance, sourceUrl: listings.sourceUrls[1] } }];
  });
  assert.equal(before.length, 24);

  const reconciled = reconcileSuccessfulMeetingPartition({
    sourceName: "ical",
    generatedAt: READ_AT,
    freshMeetings: fresh,
    freshAgendaDocuments: [],
    previous: {
      formatVersion: 1,
      generatedAt: "2026-09-23T15:00:00.000Z",
      counts: { fresh: before.length, carried: 0, total: before.length },
      sources: [],
      meetings: before,
      agendaDocuments: [],
    } as unknown as MeetingsSnapshot,
  });
  assert.deepEqual(reconciled.carriedMeetingIds, []);
  assert.deepEqual(
    reconciled.removalEvidence.map((row) => [row.key, row.code, (row as { successorKey?: string }).successorKey]).sort(),
    TWICE.map(([kept, relisted]) => [`meeting:${id(relisted)}`, "SUPERSEDED_BY_OCCURRENCE_IDENTITY", `meeting:${id(kept)}`]).sort(),
  );
  for (const [kept, relisted] of TWICE) {
    const survivor = fresh.find((m) => m.id === id(kept))!;
    const retired = before.find((m) => m.id === id(relisted))!;
    assert.equal(reissuesSitting(retired, survivor), true, "the promotion door re-derives the same answer");
  }
});
