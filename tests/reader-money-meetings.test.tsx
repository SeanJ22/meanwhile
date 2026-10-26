import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FundingDisplay } from "../components/funding/funding-section.tsx";
import { AgendaDocuments } from "../components/map/popup/agenda-section.tsx";
import { MeetingRecords } from "../components/map/popup/meeting-records.tsx";
import { ReaderNamesProvider } from "../components/ui/reader-names-context.tsx";
import { CardFooter } from "../components/ui/card-footer.tsx";
import type { FundingDisplayData } from "../lib/funding/display.ts";
import { groupContributions } from "../lib/funding/grouping.ts";
import type { ContributionRow } from "../lib/funding/types.ts";
import type { MeetingReaderRecords } from "../lib/meetings/reader-records.ts";

test("a voting gap's held place name is cased before the shared footer prints it", () => {
  const gaps = [{ id: "census-place", label: "Census coordinates for SOUTH BOSTON YMCA" }];
  const stored = structuredClone(gaps);
  const html = renderToStaticMarkup(createElement(CardFooter, { gaps, sources: [] }));
  assert.match(html, /Census coordinates for South Boston YMCA/);
  assert.doesNotMatch(html, /SOUTH BOSTON/);
  assert.deepEqual(gaps, stored);
});

test("money reaches its reader in normal case while the filed names and sentences stay intact", () => {
  const contribution: ContributionRow = {
    dataClass: "FEC_CONTRIBUTOR", kind: "COMMITTEE_OR_ORGANIZATION", contributorName: "MILWAUKEE YMCA PAC",
    amount: 2500, receiptDate: "2026-09-01", city: "MILWAUKEE", state: "WI", entityType: "PAC", lineNumber: "11C",
    committeeType: null, organizationType: null, designation: null, contributorCommitteeId: null,
  };
  const data: FundingDisplayData = {
    fecCandidateId: "reader-case", name: "JANE MCDONALD", cycleLabel: "2025–26",
    sentences: ["JANE MCDONALD RECEIVED MONEY FROM MILWAUKEE YMCA PAC."], totals: null,
    contributors: [contribution], contributorGroups: groupContributions([contribution]), contributorsShown: true,
    secondHop: {}, reportedThrough: "2026-09-01", concentration: null, concentrationSentences: [],
    typeConcentrationSentences: [], sourceUrl: "https://www.fec.gov/", sourceOrg: "Federal Election Commission", collectedAt: "2026-09-02",
  };
  const stored = structuredClone(data);
  const html = renderToStaticMarkup(createElement(FundingDisplay, { data, context: null }));
  assert.match(html, /Jane McDonald received money from Milwaukee YMCA PAC\./);
  assert.match(html, /Milwaukee YMCA PAC/);
  assert.doesNotMatch(html, /MILWAUKEE|MCDONALD|RECEIVED/);
  assert.deepEqual(data, stored);
});

test("held people and places survive sentence casing through meeting records and agenda documents", () => {
  const provenance = { endpoint: "https://example.gov/meeting", sourceOrg: "Common Council", readOn: "UNKNOWN" as const };
  const records: MeetingReaderRecords = {
    meetingId: "reader-case", bodyId: "council", status: "HELD", sourceUrl: provenance.endpoint, sourceOrg: provenance.sourceOrg,
    agenda: [{ recordClass: "AGENDA", eventItemId: 1, eventId: 1, sequence: 1, agendaNumber: "1", title: "AUTHORIZE FEMA FUNDS FOR MILWAUKEE YMCA.", matterFile: null, matterType: null, provenance }],
    actions: [{ recordClass: "ACTION_SUMMARY", eventItemId: 1, eventId: 1, matterFile: null, action: "MOVED BY JANE MCDONALD TO APPROVE THE MILWAUKEE PLAN.",
      disposition: "PASSED", dispositionRaw: "PASSED", dispositionConflict: null, dispositionGap: null, mover: "JANE MCDONALD", seconder: null,
      tallyText: "CARRIED UNANIMOUSLY", matterStatus: null, onConsentCalendar: false, rollCall: "RECORDED", rollCallGap: null, provenance }],
    rollCalls: [{ recordClass: "ROLL_CALL", eventItemId: 1, votes: [{ personName: "JANE MCDONALD", personId: 1, value: "AYE", sort: 1 }], provenance }],
    counts: { agenda: 1, actions: 1, rollCalls: 1, votes: 1 },
  };
  const documents = [{ documentUrl: provenance.endpoint, contentHash: "reader-case", retrievedAt: "2026-09-02", contentType: "text/html", extraction: "html" as const,
    extractionNote: null, text: "1. AUTHORIZE FEMA FUNDS FOR MILWAUKEE YMCA.", sourceOrg: provenance.sourceOrg }];
  const stored = structuredClone({ records, documents });
  const html = renderToStaticMarkup(<ReaderNamesProvider names={["Milwaukee"]}>
    <MeetingRecords records={records} />
    <AgendaDocuments documents={documents} meetingId={records.meetingId} agendaUrl={provenance.endpoint} />
  </ReaderNamesProvider>);
  assert.match(html, /Authorize FEMA funds for Milwaukee YMCA\./);
  assert.match(html, /Moved by Jane McDonald to approve the Milwaukee plan\./);
  assert.match(html, /Jane McDonald: Aye/);
  assert.doesNotMatch(html, /AUTHORIZE|MILWAUKEE|MCDONALD|UNANIMOUSLY/);
  assert.deepEqual({ records, documents }, stored);
});
