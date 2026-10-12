import assert from "node:assert/strict";
import test from "node:test";

import {
  CROSSWALK_CITATION,
  crosswalkListIssues,
  crosswalkReceiptIssue,
  crosswalkRowIssue,
  subBodyId,
  type MeetingBodyCrosswalkRow,
} from "../lib/civic-data/meeting-body-crosswalk.ts";
import { manualProjectionCandidate, type CuratedReaderProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

/**
 * Saved official evidence establishes the exact body and which meetings belong to it. Domain ownership alone does
 * not say which board a calendar belongs to, so a row names the body as the government prints it, the filter that
 * selects its meetings, and the sha256 of the pages that establish both.
 */

const OCD = "ocd-division/country:us/state:az/place:flagstaff";
const AT = "2026-09-24T20:10:00.000Z";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

function row(patch: Partial<MeetingBodyCrosswalkRow> = {}): MeetingBodyCrosswalkRow {
  const bodyName = patch.bodyName ?? "Housing Commission";
  const bodyId = patch.bodyId ?? subBodyId(OCD, bodyName);
  const kind = patch.kind ?? "OFFICIAL_PAGE_EVENTS";
  return {
    id: `${bodyId}|${kind}`,
    jurisdictionId: "az:city:city-of-flagstaff",
    ocdId: OCD,
    bodyId,
    bodyRole: "SUB_BODY",
    bodyName,
    kind,
    route: "https://www.flagstaff.az.gov/Calendar.aspx?EID=2823",
    officialHost: "www.flagstaff.az.gov",
    filter: { nameTerms: "Housing Commission" },
    publishingOrg: "City of Flagstaff",
    timeZone: "America/Phoenix",
    evidence: {
      bodyPage: { url: "https://www.flagstaff.az.gov/1234/Housing-Commission", sha256: H1, quote: "The Housing Commission advises the City Council" },
      calendar: { url: "https://www.flagstaff.az.gov/Calendar.aspx?EID=2823", sha256: H2, selected: 1, total: 1 },
      readAt: AT,
    },
    status: "ACTIVE",
    reviewedBy: "RouteTask agent session (Claude Code, claude-opus-5-5)",
    reviewedAt: AT,
    authorization: CROSSWALK_CITATION,
    ...patch,
  };
}

test("C16: a commission is a sub-body of its division, its id derived only from its printed name", () => {
  assert.equal(subBodyId(OCD, "Housing Commission"), `${OCD}#body:housing-commission`);
  assert.equal(crosswalkRowIssue(row()), null);
  assert.match(crosswalkRowIssue(row({ bodyId: `${OCD}#body:housing` }))!, /derived from its division and its printed name/);
  const council = row({ bodyRole: "GOVERNING", bodyName: "City Council", bodyId: `${OCD}#governing` });
  assert.equal(crosswalkRowIssue({ ...council, id: `${OCD}#governing|OFFICIAL_PAGE_EVENTS`, filter: { nameTerms: "City Council" }, evidence: { ...council.evidence, bodyPage: { ...council.evidence.bodyPage, quote: "the Flagstaff City Council meets" } } }), null);
  assert.match(crosswalkRowIssue(row({ bodyRole: "GOVERNING" }))!, /#governing/);
});

test("C16: a calendar is never a body's by domain alone: the filter must name the body's meetings", () => {
  assert.match(crosswalkRowIssue(row({ filter: {} }))!, /only through a filter naming it \(nameTerms\)/);
  assert.match(crosswalkRowIssue(row({ kind: "ICAL", id: `${subBodyId(OCD, "Housing Commission")}|ICAL`, filter: { nameTerms: "x" } }))!, /a ICAL filter has no nameTerms/);
  assert.equal(crosswalkRowIssue(row({ kind: "ICAL", id: `${subBodyId(OCD, "Housing Commission")}|ICAL`, filter: { titleMatch: "Housing Commission" } })), null);
  assert.match(crosswalkRowIssue(row({ kind: "LEGISTAR" as never }))!, /a LEGISTAR filter has no nameTerms/);
});

test("C16: the evidence is the government's own page naming the body, cited by sha256", () => {
  assert.match(crosswalkRowIssue(row({ evidence: { ...row().evidence, bodyPage: { ...row().evidence.bodyPage, url: "https://www.example.org/flagstaff" } } }))!, /not on the government's own host/);
  assert.match(crosswalkRowIssue(row({ evidence: { ...row().evidence, bodyPage: { ...row().evidence.bodyPage, quote: "a page about something else" } } }))!, /does not print "Housing Commission"/);
  assert.match(crosswalkRowIssue(row({ evidence: { ...row().evidence, bodyPage: { ...row().evidence.bodyPage, sha256: `sha256-${H1}` } } }))!, /bare hex/);
  assert.match(crosswalkRowIssue(row({ evidence: { ...row().evidence, calendar: { ...row().evidence.calendar, selected: 0 } } }))!, /selected no meeting/);
  assert.match(crosswalkRowIssue(row({ route: "http://www.flagstaff.az.gov/Calendar.aspx?EID=2823" }))!, /not an https URL/);
  assert.match(crosswalkRowIssue(row({ reviewedBy: "Sean" }))!, /agent session/);
  assert.match(crosswalkRowIssue(row({ authorization: "someone said so" as never }))!, /does not carry the crosswalk citation/);
  assert.match(crosswalkRowIssue(row({ reviewedAt: "2026-09-24T00:00:00.000Z" }))!, /reviewed before its evidence/);

  const sources = [
    { requestedUrl: row().evidence.bodyPage.url, finalUrl: row().evidence.bodyPage.url, rawHash: H1 },
    { requestedUrl: row().route, finalUrl: row().route, rawHash: H2 },
  ];
  assert.equal(crosswalkReceiptIssue(row(), sources), null);
  assert.match(crosswalkReceiptIssue(row(), [sources[0]!, { ...sources[1]!, rawHash: H1 }])!, /calendar is not the receipted bytes/);
});

test("C16: two bodies claiming the same meetings is conflicting evidence; withdrawal is stated, never an omission", () => {
  const a = row();
  const b = row({ bodyName: "Tourism Commission", evidence: { ...row().evidence, bodyPage: { ...row().evidence.bodyPage, quote: "the Tourism Commission" } } });
  assert.deepEqual(crosswalkListIssues([a]), []);
  assert.ok(crosswalkListIssues([a, { ...b, filter: a.filter }]).some((i) => i.startsWith("CONFLICTING_EVIDENCE")));
  assert.deepEqual(crosswalkListIssues([a, { ...b, filter: { nameTerms: "Tourism Commission" } }]), []);
  assert.match(crosswalkRowIssue(row({ status: "WITHDRAWN" }))!, /states why/);
  assert.equal(crosswalkRowIssue(row({ status: "WITHDRAWN", withdrawal: { reason: "the city moved the commission's calendar" } })), null);
});

test("C16: the crosswalk promotes through the verified manual door, and a row not bound to its receipted bytes is held alone", async () => {
  const good = row();
  const other = row({
    bodyName: "Tourism Commission",
    route: "https://www.flagstaff.az.gov/Calendar.aspx?EID=3031",
    filter: { nameTerms: "Tourism Commission" },
    evidence: {
      bodyPage: { url: "https://www.flagstaff.az.gov/5678/Tourism-Commission", sha256: "3".repeat(64), quote: "the Tourism Commission" },
      calendar: { url: "https://www.flagstaff.az.gov/Calendar.aspx?EID=3031", sha256: "4".repeat(64), selected: 1, total: 1 },
      readAt: AT,
    },
  });
  const source = (url: string, rawHash: string) => ({
    requestedUrl: url, finalUrl: url, publisher: "City of Flagstaff", sourceClass: "OFFICIAL_PUBLISHER" as const,
    retrievedAt: AT, httpStatus: 200, rawHash, reviewedEvidence: "The page names the body; the calendar's events carry its name.",
  });
  const pkg = (rows: MeetingBodyCrosswalkRow[], hashes: Record<string, string>): ManualProjectionPackage => ({
    contractId: "meeting-body-crosswalk",
    version: AT,
    sourceThrough: AT,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: AT,
      reviewedBy: "RouteTask agent session (Claude Code, claude-opus-5-5)",
      sources: Object.entries(hashes).map(([url, hash]) => source(url, hash)),
    },
    payload: { kind: "meeting-body-crosswalk", records: rows as unknown as CuratedReaderProjection["records"] },
  });
  const hashes = {
    [good.evidence.bodyPage.url]: H1, [good.route]: H2,
    [other.evidence.bodyPage.url]: "3".repeat(64), [other.route]: "4".repeat(64),
  };
  const store = new MemoryRoutineDataStore();
  const promoted = await processRegisteredManualCandidate(store, "meeting-body-crosswalk", manualProjectionCandidate(pkg([good, other], hashes)), AT);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");

  /* One row now cites bytes the receipt does not hold: it alone is held, and the other is promoted. */
  const mismatched = manualProjectionCandidate(pkg([good, { ...other, evidence: { ...other.evidence, calendar: { ...other.evidence.calendar, sha256: "5".repeat(64) } } }], hashes));
  assert.deepEqual(mismatched.civicRecords?.map((m) => m.key), [`curated-reader:${good.id}`]);
  assert.ok((mismatched.excludedFacts ?? []).some((fact) => (fact.key ?? "").includes(other.id)), JSON.stringify((mismatched.excludedFacts ?? []).map((f) => f.key)));
});
