import assert from "node:assert/strict";
import { test } from "node:test";

import { AgendaDocumentStore, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { documentUrlFor, isAnotherPublishersNoticePage, seedHeldAgendaDocuments } from "../scripts/ingest.ts";

/**
 * **A SITTING IS NEVER LENT ANOTHER PUBLISHER'S NOTICE PAGE.** (2026-09-24.)
 *
 * A scheduled sitting with no agenda link is given its body's notice page, and
 * failing a body match, the division's notice page when every notice URL on
 * the division agrees. One notice URL always agrees with itself, and on two
 * divisions it was another government's:
 * - The Lake Todd Village District row is keyed on Newbury and publishes on
 *   the Town of Bradford's calendar. On 2026-09-24, 26 held documents served
 *   Bradford's calendar as the agenda of Newbury sittings, some since
 *   2026-08-21.
 * - The Central Arizona Water Conservation District is the only notice page on
 *   Pima County's division. The Board of Supervisors' study session of
 *   2026-10-13 was served CAP's board page as its agenda (read 15:43:43Z),
 *   under "Pima County Clerk of the Board".
 * Both were read back from production's /api/agenda on 2026-09-24. The rows
 * below mirror those production sittings and use the real wiring.
 */

const BRADFORD_CALENDAR = "https://bradfordnh.gov/pages/calendar";
const CAP_BOARD_PAGE = "https://www.cap-az.com/board/board-committee-meetings/";
const NEWBURY = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const BRADFORD = "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town";
const PIMA = "ocd-division/country:us/state:az/county:pima";

function sitting(id: string, ocdId: string, bodyName: string, sourceOrg: string, agendaUrl: string | null = null): Meeting {
  return {
    id,
    ocdId,
    bodyName,
    title: bodyName,
    startsAt: "2026-10-13T19:00:00-04:00",
    status: "SCHEDULED",
    agendaUrl,
    location: null,
    provenance: { sourceOrg, sourceUrl: "https://example.invalid/calendar", collectedAt: "2026-09-24T16:52:08.409Z", verifiedAt: null },
  } as unknown as Meeting;
}

const newburyPlanning = sitting(
  "ical:newbury-ical-planning-board:calendar.37991.field_date_and_time.0@www.newbury.nh.gov",
  NEWBURY, "Planning Board", "Town of Newbury",
);
const newburyConservation = sitting(
  "schedulepage:newbury-conservation-commission:2026-10-15",
  NEWBURY, "Conservation Commission", "Newbury Conservation Commission",
);
const pimaStudySession = sitting("legistar-insite:pima:1381578", PIMA, "Board of Supervisors", "Pima County Clerk of the Board");
const lakeTodd = sitting("ical:lake-todd-village-district-newbury:2026-10-10", NEWBURY, "Lake Todd Village District", "Town of Bradford");
const bradfordSelectBoard = sitting("ical:bradford-select-board:2026-10-06", BRADFORD, "Select Board", "Town of Bradford");
const bradfordUnwiredBody = sitting("ical:bradford-other:2026-10-07", BRADFORD, "Heritage Commission", "Town of Bradford");

test("a division's only notice page is not lent to a sitting of another publisher", () => {
  assert.equal(documentUrlFor(newburyPlanning), null, "Newbury is not given Bradford's calendar");
  assert.equal(documentUrlFor(newburyConservation), null);
  assert.equal(documentUrlFor(pimaStudySession), null, "Pima's Board is not given CAP's board page");
});

test("a body's own notice page, and its own publisher's shared page, still reach its sittings", () => {
  assert.equal(documentUrlFor(lakeTodd), BRADFORD_CALENDAR, "Lake Todd publishes on Bradford's calendar");
  assert.equal(documentUrlFor(bradfordSelectBoard), BRADFORD_CALENDAR);
  assert.equal(documentUrlFor(bradfordUnwiredBody), BRADFORD_CALENDAR, "one town, one calendar");
  const linked = sitting("legistar-insite:pima:1381577", PIMA, "Board of Supervisors", "Pima County Clerk of the Board",
    "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=X");
  assert.equal(documentUrlFor(linked), linked.agendaUrl, "an agenda link is never replaced");
});

test("a lent page is recognized as another publisher's; a sitting's own link never is", () => {
  assert.equal(isAnotherPublishersNoticePage(newburyPlanning, BRADFORD_CALENDAR), true);
  assert.equal(isAnotherPublishersNoticePage(pimaStudySession, CAP_BOARD_PAGE), true);
  assert.equal(isAnotherPublishersNoticePage(lakeTodd, BRADFORD_CALENDAR), false);
  assert.equal(isAnotherPublishersNoticePage(bradfordUnwiredBody, BRADFORD_CALENDAR), false);
  assert.equal(isAnotherPublishersNoticePage(newburyPlanning, "https://www.newbury.nh.gov/some-agenda.pdf"), false, "not a notice page");
  const ownLink = sitting(newburyPlanning.id, NEWBURY, "Planning Board", "Town of Newbury", BRADFORD_CALENDAR);
  assert.equal(isAnotherPublishersNoticePage(ownLink, BRADFORD_CALENDAR), false, "the sitting's own agenda link");
});

test("held pages another publisher lent are set aside when the previous payload is carried forward", () => {
  const held = (meeting: Meeting, url: string, retrievedAt: string, hash: string): AgendaDocument => ({
    id: `${meeting.id}@${hash}`,
    meetingId: meeting.id,
    ocdId: meeting.ocdId,
    documentUrl: url,
    contentHash: hash,
    retrievedAt,
    contentType: "text/html",
    sourceUrl: url,
    sourceOrg: meeting.provenance.sourceOrg,
    collectedAt: retrievedAt,
    verifiedAt: null,
    text: "Calendar Select Board Office Office hours",
    extraction: "html",
    extractionNote: null,
  });
  const ownAgenda = "https://www.newbury.nh.gov/fileadmin/planning-board-agenda.pdf";
  const documents = [
    held(newburyPlanning, BRADFORD_CALENDAR, "2026-08-22T04:17:24.362Z", "a1"),
    held(newburyPlanning, BRADFORD_CALENDAR, "2026-09-21T13:40:55.293Z", "a2"),
    held(newburyConservation, ownAgenda, "2026-09-20T10:00:00.000Z", "b1"),
    held(lakeTodd, BRADFORD_CALENDAR, "2026-09-21T13:40:56.000Z", "c1"),
  ];
  const store = new AgendaDocumentStore();
  const seeded = seedHeldAgendaDocuments({ meetings: [newburyPlanning, newburyConservation, lakeTodd], agendaDocuments: documents }, store);

  assert.equal(seeded.lentNotices, 2, "both Bradford-calendar reads held for Newbury's Planning Board");
  assert.deepEqual([...seeded.lentNoticeUrls], [BRADFORD_CALENDAR]);
  assert.equal(seeded.carried, 2);
  assert.equal(store.latestFor(newburyPlanning.id), null);
  assert.equal(store.latestFor(newburyConservation.id)?.documentUrl, ownAgenda);
  assert.equal(store.latestFor(lakeTodd.id)?.documentUrl, BRADFORD_CALENDAR, "Lake Todd's own page stays");
});
