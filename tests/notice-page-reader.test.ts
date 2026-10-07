import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyAgendaPublication, readerAgendaDocuments } from "../lib/ask/agenda-publication.ts";
import { buildTopicTimeline, composeTopicAnswer } from "../lib/ask/topic-timeline.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../lib/meetings/notice-pages.ts";
import { agendaTopicFor } from "../lib/routing/agenda-search.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";

const HELD = JSON.parse(readFileSync("tests/fixtures/notice-pages-held-2026-09-24.json", "utf8")) as {
  readonly cap: { readonly url: string; readonly text: string };
  readonly mesa: { readonly url: string; readonly text: string };
};
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MESA = "ocd-division/country:us/state:az/place:mesa";
const WARNER = "ocd-division/country:us/state:nh/county:merrimack/place:warner_town";
const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const NOW = Date.parse("2026-09-24T18:00:00.000Z");

function held(input: {
  meetingId: string; ocdId: string; url: string; text: string | null; sourceOrg: string; retrievedAt?: string;
}): AgendaDocument {
  const retrievedAt = input.retrievedAt ?? "2026-09-24T15:43:43.664Z";
  return {
    id: `${input.meetingId}@${input.url.length}${input.text?.length ?? 0}`,
    meetingId: input.meetingId,
    ocdId: input.ocdId,
    documentUrl: input.url,
    contentHash: `${input.url.length}${input.text?.length ?? 0}`,
    retrievedAt,
    contentType: "text/html; charset=UTF-8",
    text: input.text,
    extraction: input.text === null ? "failed" : "html",
    extractionNote: input.text === null ? "No readable text: the page held no words." : null,
    sourceUrl: input.url,
    sourceOrg: input.sourceOrg,
    collectedAt: retrievedAt,
    verifiedAt: null,
  };
}

function reading(document: AgendaDocument, bodyId: string) {
  const meetings = [{ id: document.meetingId, ocdId: document.ocdId, bodyId }];
  const shown = readerAgendaDocuments([document], { documentsAcrossCorpus: [document], meetingsAcrossCorpus: meetings });
  const publication = classifyAgendaPublication({ meetingId: document.meetingId, bodyName: "the body",
    documentsForMeeting: [document], documentsAcrossCorpus: [document], meetingsAcrossCorpus: meetings, now: NOW });
  return { shown, publication };
}

test("the wiring decides whose notice page a URL is", () => {
  assert.equal(isWiredNoticePage(HELD.cap.url), true);
  assert.equal(isWiredNoticePage("https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=X"), false);
  assert.equal(isAnotherBodysNoticePage(HELD.cap.url, { bodyId: `${PIMA}#governing`, publisher: "Pima County Clerk of the Board" }), true);
  assert.equal(isAnotherBodysNoticePage(HELD.cap.url, { bodyId: `${PIMA}#central-arizona-water-conservation-district`, publisher: "Central Arizona Water Conservation District" }), false);
  assert.equal(isAnotherBodysNoticePage("https://govboard.tusd1.org/", { bodyId: `${TUSD}#board`, publisher: "Tucson Unified School District" }), false,
    "Tucson Unified's board page is its own, whichever publisher name its sittings carry");
  assert.equal(isAnotherBodysNoticePage(HELD.cap.url, { bodyId: null, publisher: "Pima County Clerk of the Board" }), false,
    "another body's is said on evidence, never on a missing body");
});

test("Pima 1381578: CAP's meetings page is never shown for a Pima Board sitting, and the sitting holds no agenda", () => {
  const cap = held({ meetingId: "legistar-insite:pima:1381578", ocdId: PIMA, url: HELD.cap.url, text: HELD.cap.text, sourceOrg: "Pima County Clerk of the Board" });
  const { shown, publication } = reading(cap, `${PIMA}#governing`);
  assert.deepEqual(shown.documents, []);
  assert.equal(shown.anotherBodysPagesSetAside, 1);
  assert.equal(shown.heldRows, shown.documents.length + shown.identicalContentRows + shown.publicationIndexRowsSetAside + shown.anotherBodysPagesSetAside);
  assert.equal(publication.acquisition, "NOT_ACQUIRED", "the Pima sitting's agenda is not held; CAP's page says nothing about it");
  assert.equal(publication.currentDocumentUrl, null);
});

test("Mesa 1343183: the council's own meetings page is its publication index, never a read agenda", () => {
  const mesa = held({ meetingId: "legistar-insite:mesa:1343183", ocdId: MESA, url: HELD.mesa.url, text: HELD.mesa.text, sourceOrg: "City of Mesa City Clerk", retrievedAt: "2026-09-24T12:17:11.950Z" });
  const { shown, publication } = reading(mesa, `${MESA}#governing`);
  assert.equal(shown.sittingSpecific, false, "the council's meetings page is not the sitting's own document");
  assert.equal(shown.anotherBodysPagesSetAside, 0, "it is Mesa's own page, shown for what it is");
  assert.equal(publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
});

test("Warner: a failed read of the town calendar is the body's page, not a document we could not read", () => {
  const calendar = held({ meetingId: "ical:warner-planning-board:79tvoc4a1u7709j9u00603lkeu@google.com", ocdId: WARNER,
    url: "https://warnernh.gov/calendar/", text: null, sourceOrg: "Town of Warner" });
  const { publication } = reading(calendar, `${WARNER}#planning-board`);
  assert.equal(publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
});

test("an agenda posted on a body's notice page is still that sitting's agenda", () => {
  const posted = held({ meetingId: "legistar-insite:mesa:1343190", ocdId: MESA, url: HELD.mesa.url,
    text: "City Council Regular Meeting 1. Call to order. 2. Consent agenda. 3. Adjournment.", sourceOrg: "City of Mesa City Clerk" });
  const { shown, publication } = reading(posted, `${MESA}#governing`);
  assert.equal(shown.sittingSpecific, true);
  assert.equal(publication.acquisition, "ITEMS_READER_READY");
});

test("Ask's topic timeline neither searches CAP's page nor counts Oct 13 as a read agenda", () => {
  const studySession = {
    id: "legistar-insite:pima:1381578", bodyName: "Board of Supervisors", title: "Study Session",
    startsAt: "2026-10-13T13:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, status: "SCHEDULED",
    provenance: { sourceUrl: "https://pima.legistar.com/Calendar.aspx", sourceOrg: "Pima County Clerk of the Board" },
  };
  const cap = held({ meetingId: studySession.id, ocdId: PIMA, url: HELD.cap.url, text: HELD.cap.text, sourceOrg: "Pima County Clerk of the Board" });
  const timeline = buildTopicTimeline({ topic: agendaTopicFor("data center")!, bodyId: `${PIMA}#governing`,
    bodyName: "Pima County Board Of Supervisors", meetings: [studySession], documents: [cap], sittings: [], now: NOW });
  assert.equal(timeline.denominators.topicAgendaDocumentsSearched ?? 0, 0, "CAP's page was searched as a Pima agenda");
  assert.ok(timeline.unreadSittings.some((sitting) => sitting.meetingId === studySession.id),
    "Oct 13 read as a sitting whose agenda we hold");
});

test("Newbury Selectboard: portal shells and another town's calendar are not 'the agendas we hold'", () => {
  const NEWBURY = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
  const HELD9 = JSON.parse(readFileSync("tests/fixtures/newbury-selectboard-held-2026-09-24.json", "utf8")) as {
    readonly portal: { readonly url: string; readonly extraction: string; readonly text: string };
    readonly calendar: { readonly url: string; readonly extraction: string; readonly text: string };
  };
  const sittings = Array.from({ length: 9 }, (_, index) => ({
    id: `newbury-selectboard-${index}`, bodyName: "Newbury Selectboard", title: "Selectboard",
    startsAt: new Date(Date.parse("2026-08-17T18:00:00-04:00") + index * 7 * 86_400_000).toISOString(),
    timeZone: "America/New_York", agendaUrl: null, status: "SCHEDULED",
    provenance: { sourceUrl: "https://www.newbury.nh.gov/calendar", sourceOrg: "Town of Newbury" },
  }));
  const documents = sittings.map((sitting, index) => {
    const page = index < 4 ? HELD9.portal : HELD9.calendar;
    return held({ meetingId: sitting.id, ocdId: NEWBURY, url: page.url, text: page.text, sourceOrg: "Town of Newbury" });
  });
  const timeline = buildTopicTimeline({ topic: agendaTopicFor("cell tower")!, bodyId: `${NEWBURY}#governing`,
    bodyName: "Newbury Selectboard", meetings: sittings, documents, sittings: [], now: NOW });
  assert.equal(timeline.denominators.topicAgendaDocumentsSearched ?? 0, 0, "portal pages and a lent calendar were counted as agendas");
  const composed = composeTopicAnswer(timeline, NOW);
  assert.doesNotMatch(composed?.answer ?? "", /in the \d+ agendas? we hold/, "an answer claimed agendas we do not hold");
});
