import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NEVER_READ } from "../lib/ops/freshness.ts";
import {
  applyMinutesApprovals,
  concludedSittingRows,
  FAILED_MINUTES_REVERIFY_DAYS,
  minutesDocumentCheck,
  failedMinutesReadFor,
  isHeldFailedExtraction,
  minutesLinkFor,
  minutesRefreshDecision,
  minutesSitting,
  notYetPublishedSitting,
  readMinutesDocument,
  sittingAfterRead,
  type MinutesDocumentHead,
  type MinutesDocumentRead,
} from "../lib/outcomes/minutes-ingest.ts";
import { mesaLegistarMinutesOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { mergeSnapshot } from "../lib/outcomes/ingest.ts";
import { outcomeEvidenceFor, outcomeGapWhose, resetOutcomeSnapshotCache, useOutcomeSnapshotForTests } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { parseCalendarRows, type InSiteCalendarRow } from "../lib/sources/legistar-insite/calendar.ts";
import {
  consentItems,
  MINUTES_PARSER_REVISION,
  minutesBodyText,
  minutesOutcomeRecords,
  parseCouncilMinutes,
  type MinutesPage,
} from "../lib/sources/legistar-insite/minutes.ts";
import { findTenant } from "../lib/sources/legistar-insite/tenant-registry.ts";

const DIR = "tests/fixtures/legistar-insite-mesa-minutes";
/** sha256 of lib/sources/legistar-insite/minutes.ts (LF line endings) at MINUTES_PARSER_REVISION "2026-09-25.motion-clauses". */
const PINNED_MINUTES_PARSER_DIGEST = "12179d0eed01392166b0d244ff9e0e1a064e828e90637656490bb96a028dafd3";
const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const tenant = findTenant("mesa")!;
const CALENDAR_URL = "https://mesa.legistar.com/Calendar.aspx";

const freshRows = parseCalendarRows(readFileSync(`${DIR}/calendar-2026-09-25.html`, "utf8"));
const thisYearRows = [
  ...parseCalendarRows(readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-paged.html", "utf8")),
  ...parseCalendarRows(readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-page2.html", "utf8")),
];

/** The recorded grid row for a portal id, preferring the reading that links minutes. */
function row(insiteId: string): InSiteCalendarRow {
  const readings = [...freshRows, ...thisYearRows].filter((candidate) => candidate.insiteId === insiteId);
  const found = readings.find((candidate) => candidate.minutes.href) ?? readings[0];
  assert.ok(found, `grid row ${insiteId} is in the recorded calendar`);
  return found;
}

interface PagesFixture {
  readonly url: string;
  readonly sha256: string;
  readonly byteCount: number;
  readonly pageCount: number;
  readonly pages: MinutesPage[];
}

function pagesFixture(insiteId: string): PagesFixture {
  return JSON.parse(readFileSync(`${DIR}/minutes-${insiteId}.pages.json`, "utf8")) as PagesFixture;
}

function textDocument(insiteId: string): MinutesDocumentRead {
  const fixture = pagesFixture(insiteId);
  const link = minutesLinkFor(row(insiteId), tenant.host);
  assert.ok(link, `${insiteId} publishes a minutes link`);
  assert.equal(link.url, fixture.url, "the grid's link is the document the fixture was read from");
  return { link, sha256: fixture.sha256, byteCount: fixture.byteCount, pageCount: fixture.pageCount, pages: fixture.pages, unreadable: null };
}

async function pdfDocument(insiteId: string): Promise<MinutesDocumentRead> {
  const link = minutesLinkFor(row(insiteId), tenant.host);
  assert.ok(link, `${insiteId} publishes a minutes link`);
  return readMinutesDocument(link, new Uint8Array(readFileSync(`${DIR}/minutes-${insiteId}.pdf`)));
}

function sittingFrom(insiteId: string, document: MinutesDocumentRead): PersistedSittingOutcomes {
  return minutesSitting({ tenant, row: row(insiteId), calendarUrl: CALENDAR_URL, observedAt: "2026-09-25T18:00:00.000Z", document, readOn: NEVER_READ }).sitting;
}

function snapshotOf(sittings: readonly PersistedSittingOutcomes[]): OutcomeSnapshot {
  return applyMinutesApprovals(mergeSnapshot({ generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] }, sittings, { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" }));
}

test("the 2026-07-27 council minutes: five motions, two split votes, the consent agenda and the items pulled from it", () => {
  const fixture = pagesFixture("1336059");
  const parsed = parseCouncilMinutes(fixture.pages);
  assert.equal(parsed.title, "COUNCIL MINUTES");
  assert.equal(parsed.kind, "MINUTES");
  assert.equal(parsed.sittingDate, "2026-07-27");
  assert.equal(parsed.bodyEndsAt, "ATTESTATION", "the attached presentations after the clerk's certification are not read");
  assert.deepEqual(parsed.unreadMotions, []);
  assert.deepEqual(parsed.motions.map((motion) => [motion.items.join(","), motion.disposition, motion.itemBasis]), [
    ["1", "PASSED", "CONSENT_AGENDA"],
    ["5-c", "PASSED", "NAMED_INSTRUMENT"],
    ["6-e", "PASSED", "NAMED_INSTRUMENT"],
    ["7-a,7-b", "PASSED", "NAMED_INSTRUMENT"],
    ["8-a", "PASSED", "NAMED_INSTRUMENT"],
  ]);

  const landingFees = parsed.motions[1]!;
  assert.equal(landingFees.mover, "Councilmember Adams");
  assert.equal(landingFees.seconder, "Councilmember Heredia");
  assert.equal(landingFees.motion, "that Resolution No. 12559 be adopted");
  assert.equal(landingFees.tally, "AYES – Freeman–Somers–Adams–Duff–Heredia–Taylor NAYS – Goforth");
  assert.equal(landingFees.result, "Mayor Freeman declared the motion carried by majority vote.");
  assert.equal(landingFees.page, 4);

  // The margin number "9." printed beside the last motion is not its item: the ordinance it names is.
  const fleet = parsed.motions[4]!;
  assert.equal(fleet.motion, "that Ordinance No. 6026 be adopted");
  assert.deepEqual(fleet.items, ["8-a"]);
  assert.equal(fleet.tally, "AYES - Freeman-Duff-Goforth-Heredia NAYS - Somers-Adams-Taylor");

  assert.deepEqual(consentItems(parsed).map((item) => item.reference), ["2", "3-a", "4-a", "4-b", "5-a", "5-b", "6-a", "6-b", "6-c", "6-d"]);
  assert.ok(parsed.items.some((item) => item.reference === "5-c" && item.removedFromConsent), "5-c was pulled from consent");
  assert.ok(!consentItems(parsed).some((item) => item.reference === "5-c"), "a pulled item is never carried by the consent motion");

  const records = minutesOutcomeRecords(parsed, { eventId: 1336059, sourceOrg: tenant.publishingOrg, documentUrl: fixture.url, readOn: NEVER_READ });
  assert.equal(records.length, 5 + 10, "one record per motion and one per consent item the consent motion carried");
  assert.deepEqual(records.map((record) => record.eventItemId), records.map((_, index) => index + 1));
  const body = minutesBodyText(fixture.pages);
  for (const record of records) {
    assert.equal(record.recordClass, "ACTION_SUMMARY");
    assert.equal(record.provenance.endpoint, fixture.url);
    assert.equal(record.provenance.sourceOrg, "City of Mesa City Clerk");
    assert.ok(record.quote && body.includes(record.quote), `record ${record.eventItemId}'s quote is verbatim minutes text`);
    assert.match(record.quote!, /^It was moved by /);
    assert.equal(record.rollCall, "NOT_RETRIEVED", "a surname tabulation is text, never a per-person roll");
    assert.match(record.rollCallGap ?? "", /carried verbatim; it has not been turned into per-member roll-call records/);
  }
  const hotel = records.find((record) => record.itemReference === "5-a")!;
  assert.equal(hotel.onConsentCalendar, true);
  assert.equal(hotel.matterFile, "Resolution No. 12557");
  assert.match(hotel.itemQuote ?? "", /AC Hotel by Marriott/);
  assert.match(hotel.sectionQuote ?? "", /^5\. Take action on the following resolutions:/);
  assert.equal(hotel.action, "that the consent agenda items be approved");
  const tireShop = records.find((record) => record.itemReference === "7-a, 7-b")!;
  assert.equal(tireShop.matterFile, "Resolution No. 12560, Ordinance No. 6023");
  assert.equal(tireShop.tallyText, "AYES – Somers–Adams–Duff–Heredia NAYS – Freeman–Goforth–Taylor");
});

test("the 2026-07-20 council minutes, a signed scan read through its OCR text layer (real PDF bytes)", async () => {
  const document = await pdfDocument("1336056");
  assert.equal(document.sha256, "5c57f8d7416f93d621b7d8285cd796ee1e7170d87ecf739f1f908407d8fe630a", "the digest is of the bytes, taken before pdf.js takes the buffer");
  assert.equal(document.byteCount, 325518);
  assert.equal(document.unreadable, null);
  const sitting = sittingFrom("1336056", document);
  assert.equal(sitting.extraction, "RETRIEVED");
  assert.equal(sitting.meetingId, "legistar-insite:mesa:1336056");
  assert.equal(sitting.bodyId, MESA);
  assert.equal(sitting.startsAt, "2026-07-20T17:45:00-07:00");
  assert.deepEqual(sitting.routesWalked, ["INSITE_CALENDAR", "INSITE_ACCESSIBLE_MINUTES"]);
  const motions = sitting.outcomes.filter((record) => !record.onConsentCalendar || record.itemReference === "1");
  assert.deepEqual(motions.map((record) => record.itemReference), ["1", "5-b", "5-c", "6-d"]);
  for (const record of motions) {
    assert.equal(record.disposition, "PASSED");
    assert.equal(record.dispositionRaw, "Vice Mayor Somers declared the motion carried unanimously by those present.");
    assert.match(record.tallyText ?? "", /ABSENT\s*[–-]\s*Freeman\s*[–-]\s*Goforth$/, "the absent members stay in the clerk's own tabulation");
  }
  assert.equal(sitting.minutesDocument?.title, "COUNCIL MINUTES");
  assert.equal(sitting.minutesDocument?.publisherLabel, "Minutes");
  assert.equal(sitting.minutesDocument?.approval.state, "APPROVAL_NOT_SEEN");
  assert.equal(sitting.minutesDocument?.approvalCarried, true);
  assert.ok(sitting.minutesDocument?.approves.some((entry) => entry.kind === "REGULAR" && entry.date === "2026-06-08"));
});

test("action minutes are not approved minutes: the 2026-09-17 'Results' are the clerk's draft, and they say no formal action was taken", async () => {
  const document = await pdfDocument("1343177");
  assert.equal(document.link.label, "Results");
  const sitting = sittingFrom("1343177", document);
  assert.equal(sitting.minutesDocument?.title, "COUNCIL STRATEGIC PLANNING ACTION MINUTES");
  assert.equal(sitting.minutesDocument?.approval.state, "DRAFT_ACTION_MINUTES");
  assert.match(sitting.minutesDocument?.approval.detail ?? "", /not the approved record/);
  assert.equal(sitting.extraction, "RETRIEVED", "the minutes say, in their own words, that no formal action was taken");
  assert.equal(sitting.outcomes.length, 0);

  useOutcomeSnapshotForTests(snapshotOf([sitting]));
  const evidence = outcomeEvidenceFor({ meetingId: sitting.meetingId, questionClass: "WHAT_WAS_DECIDED" });
  assert.equal(evidence.state, "NO_ACTION_RECORDED");
  assert.equal(outcomeGapWhose(evidence.state), "THEIRS");
  assert.match(evidence.gap ?? "", /no formal action was taken/);
  useOutcomeSnapshotForTests(null);

  // The same document with that sentence gone is a failed extraction, never "nothing was decided".
  const silent = { ...document, pages: document.pages.map((page) => ({ ...page, text: page.text.replace(/Presentation and discussion only; no formal action taken by the Council\./g, "") })) };
  const refused = sittingFrom("1343177", silent);
  assert.equal(refused.extraction, "ZERO_ROWS_FAILED");
  assert.match(refused.extractionNote ?? "", /FAILED extraction/);
});

test("a sitting whose minutes are not published yet is 'not yet published' — the publisher's state, never 'no decision'", () => {
  const council = freshRows.find((candidate) => candidate.insiteId === "1336069")!;
  assert.equal(council.bodyName, "City Council");
  assert.equal(council.date, "9/14/2026");
  assert.equal(council.minutes.status, "Not available");
  assert.equal(minutesLinkFor(council, tenant.host), null);
  const sitting = notYetPublishedSitting({ tenant, row: council, calendarUrl: CALENDAR_URL, observedAt: "2026-09-25T17:34:19.584Z" });
  assert.equal(sitting.extraction, "NOT_YET_PUBLISHED");
  assert.equal(sitting.outcomes.length, 0);
  assert.match(sitting.extractionNote ?? "", /has not published minutes for this sitting yet: the portal's minutes cell read "Not available" at 2026-09-25T17:34:19\.584Z/);

  useOutcomeSnapshotForTests(snapshotOf([sitting]));
  for (const questionClass of ["WHAT_WAS_DECIDED", "HOW_DID_THEY_VOTE"] as const) {
    const evidence = outcomeEvidenceFor({ meetingId: sitting.meetingId, questionClass });
    assert.equal(evidence.state, "MINUTES_NOT_YET_PUBLISHED");
    assert.equal(outcomeGapWhose(evidence.state), "THEIRS");
    assert.deepEqual(evidence.openFailures, [], "an unpublished document is not a failure of ours");
    assert.match(evidence.gap ?? "", /not a record that nothing was decided/);
    assert.doesNotMatch(evidence.gap ?? "", /no action recorded|failed retrieval/i);
  }
  useOutcomeSnapshotForTests(null);
});

test("a later sitting's minutes approving these minutes marks them APPROVED, with its own words", async () => {
  const july20 = sittingFrom("1336056", await pdfDocument("1336056"));
  const july27 = sittingFrom("1336059", textDocument("1336059"));
  const september17 = sittingFrom("1343177", await pdfDocument("1343177"));
  const snapshot = snapshotOf([july20, july27, september17]);
  const approved = snapshot.sittings.find((sitting) => sitting.meetingId === july20.meetingId)!;
  assert.equal(approved.minutesDocument?.approval.state, "APPROVED");
  assert.equal(approved.minutesDocument?.approval.approvedAt?.meetingId, "legistar-insite:mesa:1336059");
  assert.match(approved.minutesDocument?.approval.approvedAt?.quote ?? "", /^\*2\. Approval of minutes of previous meetings as written\. Minutes from the Study Session meeting held on April 30, 2026, and the Regular Council meeting held on July 20, 2026\./);
  assert.match(approved.minutesDocument?.approval.detail ?? "", /^Approved by the council at its sitting of 2026-07-27/);
  const pending = snapshot.sittings.find((sitting) => sitting.meetingId === july27.meetingId)!;
  assert.equal(pending.minutesDocument?.approval.state, "APPROVAL_NOT_SEEN", "no held sitting records approving the July 27 minutes yet");
  assert.equal(snapshot.sittings.find((sitting) => sitting.meetingId === september17.meetingId)!.minutesDocument?.approval.state, "DRAFT_ACTION_MINUTES");
  // Without the approving sitting, the same minutes are not described as approved.
  assert.equal(snapshotOf([july20]).sittings[0]!.minutesDocument?.approval.state, "APPROVAL_NOT_SEEN");
});

test("the 2026-06-01 minutes: one motion adopting five resolutions and an ordinance reaches all six items", () => {
  const parsed = parseCouncilMinutes(pagesFixture("1336065").pages);
  const combined = parsed.motions.find((motion) => motion.instruments.length > 3)!;
  assert.deepEqual(combined.instruments, ["Resolution No. 12525", "Resolution No. 12529", "Resolution No. 12530", "Resolution No. 12532", "Resolution No. 12538", "Ordinance No. 6015"]);
  assert.deepEqual(combined.items, ["6-b", "6-f", "6-g", "6-i", "6-o", "7-d"]);
  assert.equal(parsed.motions[0]!.motion, "that Jacob Brown be appointed as City Magistrate");
  assert.deepEqual(parsed.approvals[0]?.sittings, [
    { kind: "STUDY_SESSION", date: "2026-03-23" },
    { kind: "STUDY_SESSION", date: "2026-04-06" },
    { kind: "STUDY_SESSION", date: "2026-05-04" },
    { kind: "REGULAR", date: "2026-05-18" },
  ]);
});

test("the 2026-06-08 study session's scrambled OCR: displaced margin numbers stay out of the motion and the result is still found", () => {
  const fixture = pagesFixture("1343128");
  const parsed = parseCouncilMinutes(fixture.pages);
  assert.equal(parsed.motions.length, 2);
  const [appointments, receipt] = parsed.motions;
  assert.deepEqual(appointments!.items, ["2-b"]);
  assert.equal(receipt!.motion, "that receipt of the above listed minutes be acknowledged");
  assert.deepEqual(receipt!.items, ["3", "3-a", "3-b", "3-c"], "'the above listed' minutes are the whole group under item 3");
  assert.equal(receipt!.tally, "A YES - Freeman-Somers-Adams- Duff-Heredia-Goforth-Taylor NAYS -None");
  assert.equal(receipt!.result, "Carried unanimously.");
  assert.equal(receipt!.disposition, "PASSED");
  assert.ok(minutesBodyText(fixture.pages).includes(receipt!.quote));
});

test("result wording: a failed motion reads FAILED, and a motion with no readable result is NOT_RECORDED, never failed", () => {
  // Synthetic: a real passage with only its result sentence changed, since no recorded motion failed.
  const pages = pagesFixture("1336059").pages;
  const failedPages = pages.map((page) => ({ ...page, text: page.text.replace("NAYS – Goforth Mayor Freeman declared the motion carried by majority vote.", "NAYS – Goforth Mayor Freeman declared the motion failed.") }));
  const failed = parseCouncilMinutes(failedPages).motions[1]!;
  assert.equal(failed.disposition, "FAILED");
  assert.equal(failed.result, "Mayor Freeman declared the motion failed.");

  const silentPages = pages.map((page) => ({ ...page, text: page.text.replace("NAYS – Goforth Mayor Freeman declared the motion carried by majority vote.", "NAYS – Goforth") }));
  const parsed = parseCouncilMinutes(silentPages);
  const silent = parsed.motions[1]!;
  assert.equal(silent.disposition, "NOT_RECORDED");
  assert.equal(silent.result, null);
  const record = minutesOutcomeRecords(parsed, { eventId: 1336059, sourceOrg: tenant.publishingOrg, documentUrl: "https://mesa.legistar.com/x", readOn: NEVER_READ })
    .find((row) => row.itemReference === "5-c")!;
  assert.match(record.dispositionGap ?? "", /That is not a record of it failing/);
});

test("the minutes link: the accessible HTML first, the PDF second, on the portal or the vendor's document host, never a third host", async () => {
  const withPdf = row("1336059");
  assert.deepEqual(minutesLinkFor(withPdf, tenant.host), { url: "https://mesa.legistar.com/View.ashx?M=M&ID=1336059&GUID=B0165E88-90A2-4E7C-80FE-0AA9E5A24F1A", format: "PDF", label: "Minutes" });
  // Synthetic: no Mesa row has published an accessible-minutes rendering (0 of 163 seen).
  const accessible = { ...withPdf, accessibleMinutes: { status: "Accessible Minutes", href: "View.ashx?M=MADA&ID=1336059&GUID=B0165E88-90A2-4E7C-80FE-0AA9E5A24F1A" } };
  assert.equal(minutesLinkFor(accessible, tenant.host)?.format, "HTML");
  // The vendor's document host answers robots.txt with `Disallow: /`; that is recorded and blocks nothing.
  const vendorHost = { ...withPdf, minutes: { status: "Minutes", href: "https://legistar.granicus.com/mesa/meetings/2026/7/x.pdf" } };
  assert.deepEqual(minutesLinkFor(vendorHost, tenant.host), { url: "https://legistar.granicus.com/mesa/meetings/2026/7/x.pdf", format: "PDF", label: "Minutes" });
  // Still guarded: a third host, plain http, or credentials in the URL are never followed.
  const thirdHost = { ...withPdf, minutes: { status: "Minutes", href: "https://example.com/mesa/x.pdf" } };
  assert.equal(minutesLinkFor(thirdHost, tenant.host), null, "a link to a third host is not this tenant's publication");
  const plainHttp = { ...withPdf, minutes: { status: "Minutes", href: "http://legistar.granicus.com/mesa/meetings/2026/7/x.pdf" } };
  assert.equal(minutesLinkFor(plainHttp, tenant.host), null, "https only");
  const credentialed = { ...withPdf, minutes: { status: "Minutes", href: "https://user:secret@legistar.granicus.com/mesa/meetings/2026/7/x.pdf" } };
  assert.equal(minutesLinkFor(credentialed, tenant.host), null, "a URL carrying credentials is never followed");
  // A minutes document read from the vendor's host names that host on its pointer.
  const vendorLink = minutesLinkFor(vendorHost, tenant.host)!;
  const fromVendor = sittingFrom("1336059", { ...textDocument("1336059"), link: vendorLink });
  assert.equal(fromVendor.minutesPointer.host, "legistar.granicus.com");
  assert.equal(fromVendor.minutesDocument?.url, vendorLink.url);
  assert.equal(sittingFrom("1336059", textDocument("1336059")).minutesPointer.host, tenant.host, "a portal document names the portal");

  const html = new TextEncoder().encode(`<html><body><p>OFFICE OF THE CITY CLERK COUNCIL MINUTES July 27, 2026</p><p>5-c. A resolution extending Falcon Field Airport&#8217;s landing fee implementation date. – Resolution No. 12559</p><p>It was moved by Councilmember Adams, seconded by Councilmember Heredia, that Resolution No. 12559 be adopted.</p><p>Upon tabulation of votes, it showed: AYES – Freeman–Somers NAYS – Goforth</p><p>Mayor Freeman declared the motion carried by majority vote.</p></body></html>`);
  const read = await readMinutesDocument(minutesLinkFor(accessible, tenant.host)!, html);
  assert.equal(read.sha256, createHash("sha256").update(html).digest("hex"));
  const parsed = parseCouncilMinutes(read.pages);
  assert.equal(parsed.motions[0]?.disposition, "PASSED");
  assert.deepEqual(parsed.motions[0]?.items, ["5-c"]);
});

test("which sittings a pass reads again: new, newly published, relabelled, failed or due for rechecking", async () => {
  const july20 = sittingFrom("1336056", await pdfDocument("1336056"));
  const link = minutesLinkFor(row("1336056"), tenant.host)!;
  assert.deepEqual(minutesRefreshDecision(link, undefined), { walk: true, reason: "NEW" });
  assert.deepEqual(minutesRefreshDecision(link, july20), { walk: true, reason: "DOCUMENT_REVERIFY" });
  assert.deepEqual(minutesRefreshDecision({ ...link, label: "Results" }, july20), { walk: true, reason: "PUBLISHER_RELABELED" });
  assert.deepEqual(minutesRefreshDecision(null, july20), { walk: false, reason: "LINK_WITHDRAWN_KEPT" });
  const unpublished = notYetPublishedSitting({ tenant, row: row("1336069"), calendarUrl: CALENDAR_URL, observedAt: "2026-09-25T17:34:19.584Z" });
  assert.deepEqual(minutesRefreshDecision(null, unpublished), { walk: false, reason: "STILL_NOT_PUBLISHED" });
  assert.deepEqual(minutesRefreshDecision(link, unpublished), { walk: true, reason: "MINUTES_PUBLISHED" });
  assert.deepEqual(minutesRefreshDecision(link, { ...july20, extraction: "REQUEST_FAILED" }), { walk: true, reason: "PRIOR_EXTRACTION_FAILED" });
});

test("the concluded sittings a pass considers: the wired bodies, in the window, already held, one row per portal id", () => {
  const rows = concludedSittingRows([...freshRows, ...thisYearRows], tenant, { from: "2026-07-28", to: "2026-09-24" }, new Date("2026-09-25T18:00:00.000Z"));
  assert.ok(rows.every((candidate) => tenant.bodyNames.includes(candidate.bodyName)), "Planning and Zoning and the other boards are not this contract's body");
  assert.equal(new Set(rows.map((candidate) => candidate.insiteId)).size, rows.length);
  const strategic = rows.find((candidate) => candidate.insiteId === "1343177")!;
  assert.equal(strategic.minutes.status, "Results", "the reading that carries the link wins over an older one without it");
  assert.ok(!rows.some((candidate) => candidate.insiteId === "1336055"), "the 9/28 sitting has not happened yet");
  assert.ok(!rows.some((candidate) => candidate.insiteId === "1336059"), "7/27 is outside this window");
  resetOutcomeSnapshotCache();
});

/** The grid row as Mesa's calendar printed it for a sitting the recorded grids do not carry. */
function printedRow(insiteId: string, date: string, kind: string, guid: string): InSiteCalendarRow {
  return {
    bodyName: "City Council",
    bodyHref: null,
    date,
    time: "7:30 AM",
    location: "",
    kind,
    insiteId,
    insiteGuid: null,
    icalHref: null,
    detailHref: null,
    notViewable: false,
    agenda: { status: "", href: null },
    accessibleAgenda: { status: "", href: null },
    minutes: { status: "Minutes", href: `View.ashx?M=M&ID=${insiteId}&GUID=${guid}` },
    accessibleMinutes: { status: "Not available", href: null },
  };
}

function printedSitting(insiteId: string, printed: InSiteCalendarRow): PersistedSittingOutcomes {
  const fixture = pagesFixture(insiteId);
  const link = minutesLinkFor(printed, tenant.host)!;
  assert.equal(link.url, fixture.url, "the printed row links the document the fixture was read from");
  const document: MinutesDocumentRead = { link, sha256: fixture.sha256, byteCount: fixture.byteCount, pageCount: fixture.pageCount, pages: fixture.pages, unreadable: null };
  return minutesSitting({ tenant, row: printed, calendarUrl: CALENDAR_URL, observedAt: "2026-09-25T22:30:58.000Z", document, readOn: NEVER_READ }).sitting;
}

test("a motion written without 'that' is read: the 2026-06-04 study session acknowledges its boards' minutes", () => {
  const parsed = parseCouncilMinutes(pagesFixture("1343167").pages);
  assert.equal(parsed.sittingDate, "2026-06-04");
  assert.deepEqual(parsed.unreadMotions, [], "no passage beginning 'It was moved' is left unread");
  assert.equal(parsed.motions.length, 1);
  const [receipt] = parsed.motions;
  assert.equal(receipt.mover, "Councilmember Duff");
  assert.equal(receipt.seconder, "Councilmember Taylor");
  assert.equal(receipt.motion, "receipt of the above listed minutes be acknowledged", "the motion is the clerk's own words, no 'that' supplied");
  assert.equal(receipt.disposition, "PASSED");
  assert.match(receipt.result ?? "", /declared the motion carried unanimously by those present/);
  assert.ok(minutesBodyText(pagesFixture("1343167").pages).includes(receipt.quote), "the quote is a substring of the page");

  const sitting = printedSitting("1343167", printedRow("1343167", "6/4/2026", "Study Session", "93E1C4BC-0679-46E0-BC3E-504D43EA97AD"));
  assert.equal(sitting.extraction, "RETRIEVED", "it was a failed extraction in production; the minutes record a motion");
  assert.equal(sitting.outcomes.length, 1);
});

test("a motion written as an infinitive is read: the 2026-08-13 study session's direction to the City Attorney", () => {
  const parsed = parseCouncilMinutes(pagesFixture("1343172").pages);
  assert.deepEqual(parsed.unreadMotions, []);
  assert.equal(parsed.motions.length, 4, "three motions were promoted; the fourth was an unread passage");
  const direction = parsed.motions[3]!;
  assert.equal(direction.mover, "Councilmember Adams");
  assert.equal(direction.seconder, "Councilmember Duff");
  assert.match(direction.motion, /^to direct the City Attorney to pursue litigation on behalf of the City of Mesa/);
  assert.equal(direction.disposition, "PASSED");
  // The usual form still quotes its "that".
  assert.match(parsed.motions[0]!.motion, /^that the Council concur with the Mayor’s recommendations/);
});

test("minutes that record no motion and do not say no action was taken stay a failed extraction: the 2026-05-28 strategic planning session", () => {
  const parsed = parseCouncilMinutes(pagesFixture("1343166").pages);
  assert.equal(parsed.title, "COUNCIL STRATEGIC PLANNING MINUTES");
  assert.deepEqual(parsed.motions, []);
  assert.deepEqual(parsed.unreadMotions, []);
  assert.equal(parsed.statesNoFormalAction, false);
  const sitting = printedSitting("1343166", printedRow("1343166", "5/28/2026", "Strategic Planning Session", "F1571C51-0D0D-4537-9B82-C6F355A76A24"));
  assert.equal(sitting.extraction, "ZERO_ROWS_FAILED", "the fail-closed rule holds for genuinely motion-free text");
});

test("a held sitting uses a new parser immediately and still checks its source on later scheduled passes", () => {
  const printed = printedRow("1343172", "8/13/2026", "Study Session", "DABA0407-10BF-4893-B11D-B037EB724A63");
  const link = minutesLinkFor(printed, tenant.host)!;
  const now = printedSitting("1343172", printed);
  assert.equal(now.extractionNote, null, "this parser leaves no passage unread");
  assert.equal(now.minutesDocument?.parserRevision, MINUTES_PARSER_REVISION, "the reading records the parser that made it");
  assert.deepEqual(minutesRefreshDecision(link, now), { walk: true, reason: "DOCUMENT_REVERIFY" });
  // Three motions, the fourth named unread, held before parser revisions existed.
  const { parserRevision: _revision, ...olderDocument } = now.minutesDocument!;
  const unread =
    ' 1 passage(s) beginning "It was moved" were not in the clerk\'s usual form and were not read: "It was moved by Councilmember Adams, seconded by Councilmember Duff, to direct the City Attorney …"';
  const heldThen = { ...now, extractionNote: unread, minutesDocument: olderDocument };
  assert.deepEqual(minutesRefreshDecision(link, heldThen), { walk: true, reason: "UNREAD_PASSAGES_HELD" });
  // The same unread passage under the parser in force is not downloaded again every pass.
  assert.deepEqual(minutesRefreshDecision(link, { ...now, extractionNote: unread }), { walk: true, reason: "DOCUMENT_REVERIFY" });
});

const STRATEGIC = () => printedRow("1343166", "5/28/2026", "Strategic Planning Session", "F1571C51-0D0D-4537-9B82-C6F355A76A24");
const FAILED_AT = "2026-09-25T22:31:11.000Z";

function heldStrategicFailure(): PersistedSittingOutcomes {
  const fixture = pagesFixture("1343166");
  const printed = STRATEGIC();
  const link = minutesLinkFor(printed, tenant.host)!;
  const document: MinutesDocumentRead = { link, sha256: fixture.sha256, byteCount: fixture.byteCount, pageCount: fixture.pageCount, pages: fixture.pages, unreadable: null };
  const fresh = minutesSitting({ tenant, row: printed, calendarUrl: CALENDAR_URL, observedAt: FAILED_AT, document, readOn: NEVER_READ }).sitting;
  const failed = failedMinutesReadFor(fresh, document, { contentType: "application/pdf", etag: null, lastModified: null }, FAILED_AT);
  assert.ok(failed, "a read whose extraction failed is remembered");
  return sittingAfterRead(undefined, fresh, failed);
}

const MESA_HEAD = (overrides: Partial<MinutesDocumentHead> = {}): MinutesDocumentHead => ({
  status: 200, contentType: "application/pdf", contentLength: 18_779_714, etag: null, lastModified: null, ...overrides,
});

test("a document read whose extraction failed is held with the identity of the bytes it failed on", () => {
  const held = heldStrategicFailure();
  assert.equal(held.extraction, "ZERO_ROWS_FAILED", "the fail-closed rule: a failed extraction, never 'nothing was decided'");
  assert.deepEqual(held.outcomes, []);
  assert.equal(isHeldFailedExtraction(held), true);
  const failed = held.failedMinutesRead!;
  assert.deepEqual(
    { url: failed.url, label: failed.publisherLabel, sha256: failed.sha256, bytes: failed.byteCount, type: failed.contentType, etag: failed.etag, lastModified: failed.lastModified, parser: failed.parserRevision, at: failed.readAt },
    {
      url: "https://mesa.legistar.com/View.ashx?M=M&ID=1343166&GUID=F1571C51-0D0D-4537-9B82-C6F355A76A24",
      label: "Minutes",
      sha256: "82be9aab1e9df35331762ae8ba501fc2bb658cc0900467a2f8e8ceb873e7c796",
      bytes: 18_779_714,
      type: "application/pdf",
      etag: null,
      lastModified: null,
      parser: MINUTES_PARSER_REVISION,
      at: FAILED_AT,
    },
  );
  assert.match(failed.reason, /yielded no motion/);
  // A request that failed read no bytes: nothing is remembered, and it stays a retryable request.
  const requestFailed = { ...held, extraction: "REQUEST_FAILED" as const, failedMinutesRead: undefined };
  assert.equal(isHeldFailedExtraction(requestFailed), false);
});

test("the next pass asks the portal first: an unchanged document is not downloaded, a changed one is read at once", () => {
  const held = heldStrategicFailure();
  const link = minutesLinkFor(STRATEGIC(), tenant.host)!;
  const hourLater = new Date("2026-09-25T23:31:11.000Z");
  const decision = minutesRefreshDecision(link, held, hourLater);
  assert.equal(decision.walk, false);
  assert.equal(decision.reason, "FAILED_DOCUMENT_CHECK");
  assert.equal(decision.check, held.failedMinutesRead);

  const failed = held.failedMinutesRead!;
  assert.deepEqual(minutesDocumentCheck(failed, MESA_HEAD()), { walk: false, reason: "DOCUMENT_UNCHANGED", detail: "the same 18779714 bytes by length, type and validators" });
  assert.equal(minutesDocumentCheck(failed, MESA_HEAD({ contentType: "application/pdf; charset=binary" })).reason, "DOCUMENT_UNCHANGED", "the type's parameters are not the type");
  for (const [changed, why] of [
    [MESA_HEAD({ contentLength: 18_779_715 }), /length 18779714 → 18779715/],
    [MESA_HEAD({ contentType: "text/html" }), /type application\/pdf → text\/html/],
    [MESA_HEAD({ etag: '"abc"' }), /ETag none → "abc"/],
    [MESA_HEAD({ lastModified: "Fri, 25 Sep 2026 23:00:00 GMT" }), /Last-Modified none →/],
  ] as const) {
    const check = minutesDocumentCheck(failed, changed);
    assert.equal(check.walk, true, why.source);
    assert.equal(check.reason, "DOCUMENT_CHANGED");
    assert.match(check.detail, why);
  }
  // A check the portal does not answer says nothing: the failure stays held, nothing is downloaded.
  for (const unanswered of [null, MESA_HEAD({ status: 405 }), MESA_HEAD({ contentLength: null })]) {
    const check = minutesDocumentCheck(failed, unanswered);
    assert.deepEqual({ walk: check.walk, reason: check.reason }, { walk: false, reason: "DOCUMENT_UNCHECKED" });
  }
});

test("a held failed extraction is read again at once when the parser changes, when its link changes, and after a week", () => {
  const held = heldStrategicFailure();
  const link = minutesLinkFor(STRATEGIC(), tenant.host)!;
  const soon = new Date("2026-09-26T12:00:00.000Z");
  const olderParser = { ...held, failedMinutesRead: { ...held.failedMinutesRead!, parserRevision: "2026-09-24.before-motion-clauses" } };
  assert.deepEqual(minutesRefreshDecision(link, olderParser, soon), { walk: true, reason: "FAILED_DOCUMENT_PARSER_CHANGED" });
  assert.deepEqual(minutesRefreshDecision({ ...link, url: `${link.url}&v=2` }, held, soon), { walk: true, reason: "PRIOR_EXTRACTION_FAILED" }, "a new link is a new document");
  assert.deepEqual(minutesRefreshDecision({ ...link, label: "Results" }, held, soon), { walk: true, reason: "PRIOR_EXTRACTION_FAILED" });
  const justUnder = new Date(Date.parse(FAILED_AT) + FAILED_MINUTES_REVERIFY_DAYS * 86_400_000 - 1);
  assert.equal(minutesRefreshDecision(link, held, justUnder).reason, "FAILED_DOCUMENT_CHECK");
  const aWeek = new Date(Date.parse(FAILED_AT) + FAILED_MINUTES_REVERIFY_DAYS * 86_400_000);
  assert.deepEqual(minutesRefreshDecision(link, held, aWeek), { walk: true, reason: "FAILED_DOCUMENT_REVERIFY" });
});

test("a failure over verified minutes keeps the verified reading and remembers the failed document beside it; a success clears it", () => {
  const verified = sittingFrom("1336059", textDocument("1336059"));
  assert.equal(verified.extraction, "RETRIEVED");
  const strategic = heldStrategicFailure();
  const failed = strategic.failedMinutesRead!;
  const relabeled = sittingAfterRead(verified, strategic, failed);
  assert.equal(relabeled.extraction, "RETRIEVED", "a relabel to a document that fails never replaces what was verified");
  assert.deepEqual(relabeled.outcomes, verified.outcomes);
  assert.equal(relabeled.failedMinutesRead, failed);
  assert.equal(sittingAfterRead(strategic, verified, null).failedMinutesRead, undefined, "a read that succeeds clears the remembered failure");
});

test("the Mesa candidate admits a held failed extraction, names it, and still refuses a failure with no document identity", () => {
  const held = heldStrategicFailure();
  const snapshot = snapshotOf([held]);
  const candidate = mesaLegistarMinutesOutcomesCandidate({ snapshot, acquisitions: [], retrievedAt: FAILED_AT, sourceThrough: FAILED_AT });
  assert.deepEqual(candidate.semantics.violations, []);
  const named = candidate.excludedFacts?.find((fact) => fact.code === "MINUTES_EXTRACTION_FAILED_HELD");
  assert.ok(named, "the held failure is named on the candidate");
  assert.equal(named.key, "legistar-insite:mesa:1343166:minutes-extraction");
  assert.match(named.detail, /18779714 bytes, sha256 82be9aab1e9df353…, parser 2026-09-25\.motion-clauses/);

  const unremembered = { ...held, failedMinutesRead: undefined };
  const refused = mesaLegistarMinutesOutcomesCandidate({ snapshot: snapshotOf([unremembered]), acquisitions: [], retrievedAt: FAILED_AT, sourceThrough: FAILED_AT });
  assert.match(refused.semantics.violations.join(" "), /1 minutes read\(s\) failed \(legistar-insite:mesa:1343166\)/);
  const withRecords = { ...held, outcomes: sittingFrom("1336059", textDocument("1336059")).outcomes };
  const invented = mesaLegistarMinutesOutcomesCandidate({ snapshot: snapshotOf([withRecords]), acquisitions: [], retrievedAt: FAILED_AT, sourceThrough: FAILED_AT });
  assert.match(invented.semantics.violations.join(" "), /is a failed extraction and carries records/);
});

test("a reader asking what the 2026-05-28 session decided is told we could not read it, never that nothing was decided", () => {
  useOutcomeSnapshotForTests(snapshotOf([heldStrategicFailure()]));
  const evidence = outcomeEvidenceFor({ meetingId: "legistar-insite:mesa:1343166", questionClass: "WHAT_WAS_DECIDED" });
  assert.equal(evidence.state, "EXTRACTION_FAILED");
  assert.equal(outcomeGapWhose(evidence.state), "OURS");
  assert.match(evidence.gap ?? "", /could not find in them what was decided/);
  assert.doesNotMatch(evidence.gap ?? "", /agenda items|has not been retried/);
  assert.equal(evidence.records.length, 0);
  useOutcomeSnapshotForTests(null);
});

test("the parser's revision is pinned to its source: an edit to the minutes parser has to decide whether held readings are re-read", () => {
  const source = readFileSync("lib/sources/legistar-insite/minutes.ts", "utf8").replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(source).digest("hex");
  assert.deepEqual(
    { revision: MINUTES_PARSER_REVISION, digest },
    { revision: "2026-09-25.motion-clauses", digest: PINNED_MINUTES_PARSER_DIGEST },
    "lib/sources/legistar-insite/minutes.ts changed. If what it extracts changed, change MINUTES_PARSER_REVISION " +
      "(held failed and unread readings are then read again); either way record the new digest and revision here.",
  );
});

test("a continuation that is not a motion's own words stays an unread passage, never a guessed motion", () => {
  const pages = [{ page: 1, text: "OFFICE OF THE CITY CLERK COUNCIL MINUTES June 4, 2026 1. Item. It was moved by Councilmember Duff, seconded by Councilmember Taylor, and the item was discussed. Carried unanimously. It was moved by Councilmember Duff, seconded by Councilmember Taylor, Resolution No. 12001 be adopted." }];
  const parsed = parseCouncilMinutes(pages);
  assert.deepEqual(parsed.motions, []);
  assert.equal(parsed.unreadMotions.length, 2);
});
