import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { AgendaDocumentStore, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { isAnotherBodysNoticePage } from "../lib/meetings/notice-pages.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { documentUrlFor, heldNoticePageIsNotItsAgenda, seedHeldAgendaDocuments } from "../scripts/ingest.ts";

/**
 * A sitting is never lent another publisher's notice page. A scheduled sitting with no agenda link
 * is given its body's notice page, or the division's when every notice URL on the division agrees;
 * a single notice URL always agrees with itself, so ownership is checked against the sitting's
 * body and publisher. The rows below model two such cases: a district keyed on one town that
 * publishes on another town's calendar, and a lone regional district's page on a county division.
 */

const BRADFORD_CALENDAR = "https://bradfordnh.gov/pages/calendar";
const CAP_BOARD_PAGE = "https://www.cap-az.com/board/board-committee-meetings/";
const NEWBURY = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const BRADFORD = "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town";
const PIMA = "ocd-division/country:us/state:az/county:pima";

/** Sittings carry their body id. */
function sitting(id: string, ocdId: string, bodyName: string, sourceOrg: string, agendaUrl: string | null = null, slot = bodyName.toLowerCase().replace(/\s+/g, "-")): Meeting {
  return {
    id,
    ocdId,
    bodyId: `${ocdId}#${slot}`,
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
const pimaStudySession = sitting("legistar-insite:pima:1381578", PIMA, "Board of Supervisors", "Pima County Clerk of the Board", null, "governing");
const lakeTodd = sitting("ical:lake-todd-village-district-newbury:2026-10-10", NEWBURY, "Lake Todd Village District", "Town of Bradford");
const bradfordSelectBoard = sitting("ical:bradford-select-board:2026-10-06", BRADFORD, "Select Board", "Town of Bradford");
const bradfordUnwiredBody = sitting("ical:bradford-other:2026-10-07", BRADFORD, "Heritage Commission", "Town of Bradford");
const WARNER_CALENDAR = "https://warnernh.gov/calendar/";
const warnerSelectBoard = sitting("ical:warner-select-board:2026-10-05",
  "ocd-division/country:us/state:nh/county:merrimack/place:warner_town", "Select Board", "Town of Warner");

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

/** The ownership question the ingest asks, in the one form every reader surface asks it. */
const anotherBodys = (meeting: Meeting, url: string) =>
  isAnotherBodysNoticePage(url, { bodyId: meeting.bodyId, publisher: meeting.provenance.sourceOrg });

test("a lent page is recognized as another body's; a sitting's own link never is", () => {
  assert.equal(anotherBodys(newburyPlanning, BRADFORD_CALENDAR), true);
  assert.equal(anotherBodys(pimaStudySession, CAP_BOARD_PAGE), true);
  assert.equal(anotherBodys(lakeTodd, BRADFORD_CALENDAR), false);
  assert.equal(anotherBodys(bradfordUnwiredBody, BRADFORD_CALENDAR), false, "one town, one calendar: its publisher's page");
  assert.equal(anotherBodys(newburyPlanning, "https://www.newbury.nh.gov/some-agenda.pdf"), false, "not a notice page");
  // The sitting's own agenda link is decided before ownership, and never set aside.
  const ownLink = sitting(newburyPlanning.id, NEWBURY, "Planning Board", "Town of Newbury", BRADFORD_CALENDAR);
  assert.equal(heldNoticePageIsNotItsAgenda(ownLink, { documentUrl: BRADFORD_CALENDAR, text: "Calendar" }), false, "the sitting's own agenda link");
  const scriptSource = readFileSync(new URL("../scripts/ingest.ts", import.meta.url), "utf8");
  assert.doesNotMatch(scriptSource, /function isAnotherPublishersNoticePage/, "one ownership rule, not a second copy in the ingest");
});

/* A body whose sittings and wiring row name the publisher differently still owns its notice page. */
const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const TUSD_BOARD_PAGE = "https://govboard.tusd1.org/";
const tusdSpecial = sitting("diligent:tusd1:510", TUSD, "Governing Board", "Tucson Unified School District", null, "board");

test("R14: Tucson Unified's own notice page is its own, whichever publisher name its sittings carry", () => {
  assert.equal(anotherBodys(tusdSpecial, TUSD_BOARD_PAGE), false);
  const notice = "Special Meeting of the Governing Board 1. Call to order. 2. Public hearing on the Palo Verde ITM. 3. Adjournment.";
  assert.equal(
    heldNoticePageIsNotItsAgenda(tusdSpecial, { documentUrl: TUSD_BOARD_PAGE, text: notice }),
    false,
    "a notice the board posted with agenda items is the sitting's agenda",
  );
  assert.equal(
    heldNoticePageIsNotItsAgenda(tusdSpecial, { documentUrl: TUSD_BOARD_PAGE, text: "Governing Board Members Meeting Schedule" }),
    true,
    "its page stating no agenda item is still not an agenda",
  );
  assert.equal(
    heldNoticePageIsNotItsAgenda({ ...tusdSpecial, bodyId: undefined }, { documentUrl: TUSD_BOARD_PAGE, text: "Governing Board Members Meeting Schedule" }),
    true,
    "an unknown body is never called another's, and the page still states no item",
  );
});

test("R14: every held production case keeps its answer — each is set aside as before", () => {
  const heldPages = JSON.parse(readFileSync(new URL("./fixtures/notice-pages-held-2026-09-24.json", import.meta.url), "utf8")) as {
    cap: { url: string; text: string };
    mesa: { url: string; text: string };
  };
  const newburyHeld = JSON.parse(readFileSync(new URL("./fixtures/newbury-selectboard-held-2026-09-24.json", import.meta.url), "utf8")) as {
    calendar: { url: string; text: string };
  };
  const mesaCouncil = sitting("legistar-insite:mesa:1343183", "ocd-division/country:us/state:az/place:mesa", "City Council", "City of Mesa", null, "governing");
  const newburySelectboard = sitting("ical:newbury-ical-governing:calendar.42961", NEWBURY, "Selectboard", "Town of Newbury", null, "governing");
  const cases: [string, Meeting, { documentUrl: string; text: string }][] = [
    ["CAP's page held for a Pima Board sitting", pimaStudySession, { documentUrl: heldPages.cap.url, text: heldPages.cap.text }],
    ["Mesa's council page held for a council sitting", mesaCouncil, { documentUrl: heldPages.mesa.url, text: heldPages.mesa.text }],
    ["Bradford's calendar held for a Newbury Selectboard sitting", newburySelectboard, { documentUrl: newburyHeld.calendar.url, text: newburyHeld.calendar.text }],
    ["Bradford's calendar held for a Newbury Planning Board sitting", newburyPlanning, { documentUrl: BRADFORD_CALENDAR, text: newburyHeld.calendar.text }],
    ["Bradford's calendar held for Lake Todd", lakeTodd, { documentUrl: BRADFORD_CALENDAR, text: newburyHeld.calendar.text }],
  ];
  for (const [label, meeting, doc] of cases) {
    assert.equal(heldNoticePageIsNotItsAgenda(meeting, doc), true, label);
  }
});

test("held notice pages that are not their sitting's agenda are left out of the run's store", () => {
  const held = (meeting: Meeting, url: string, retrievedAt: string, hash: string, text = "Calendar Select Board Office Office hours"): AgendaDocument => ({
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
    text,
    extraction: "html",
    extractionNote: null,
  });
  const ownAgenda = "https://www.newbury.nh.gov/fileadmin/planning-board-agenda.pdf";
  const documents = [
    held(newburyPlanning, BRADFORD_CALENDAR, "2026-08-22T04:17:24.362Z", "a1"),
    held(newburyPlanning, BRADFORD_CALENDAR, "2026-09-21T13:40:55.293Z", "a2"),
    held(newburyConservation, ownAgenda, "2026-09-20T10:00:00.000Z", "b1"),
    held(lakeTodd, BRADFORD_CALENDAR, "2026-09-21T13:40:56.000Z", "c1"),
    // An agenda its own publisher posted on its notice page states items and stays.
    held(warnerSelectBoard, WARNER_CALENDAR, "2026-09-21T13:41:00.000Z", "d1",
      "Select Board agenda 1. Call to order. 2. Approval of minutes. 3. Adjournment."),
  ];
  const store = new AgendaDocumentStore();
  const seeded = seedHeldAgendaDocuments(
    { meetings: [newburyPlanning, newburyConservation, lakeTodd, warnerSelectBoard], agendaDocuments: documents },
    store,
  );

  // The two lent calendar reads, and the district's own calendar page, which states no agenda item.
  assert.equal(seeded.noticePagesSetAside, 3);
  assert.deepEqual([...seeded.noticePageUrlsSetAside], [BRADFORD_CALENDAR]);
  assert.equal(seeded.carried, 2);
  assert.equal(store.latestFor(newburyPlanning.id), null);
  assert.equal(store.latestFor(newburyConservation.id)?.documentUrl, ownAgenda);
  assert.equal(store.latestFor(lakeTodd.id), null, "a calendar stating no agenda item is not Lake Todd's agenda");
  assert.equal(store.latestFor(warnerSelectBoard.id)?.documentUrl, WARNER_CALENDAR, "an agenda posted on the notice page stays");
});
