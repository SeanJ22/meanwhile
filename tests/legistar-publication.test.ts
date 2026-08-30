import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  observationFromEvent,
  observationFromGridCell,
  reconcilePublicationObservations,
} from "../lib/outcomes/publication.ts";
import type { AgendaPublicationObservation } from "../lib/outcomes/publication.ts";
import { normalizeWithDrops } from "../lib/sources/legistar-insite/index.ts";
import { parseGridNoRecords } from "../lib/sources/legistar-insite/calendar.ts";
import type { InSiteRange } from "../lib/sources/legistar-insite/calendar.ts";
import type { LegistarInSiteRaw } from "../lib/sources/legistar-insite/index.ts";
import {
  hasRecordedAction,
  readDisposition,
  toOutcomeRecords,
} from "../lib/sources/legistar/outcomes.ts";
import { NEVER_READ } from "../lib/ops/freshness.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
} from "../lib/sources/legistar/types.ts";

/**
 * **THE PUBLISHER'S OWN READING, AND THE TENANT THAT PROVES ONE IS NOT A CLASS.**
 * (WS-LEGI, 2026-08-29.)
 *
 * Two subjects, both about the same mistake in different clothes: reading a
 * government's surface, throwing the reading away, and then describing our own
 * empty field as if it were the government's silence.
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const NOW = new Date("2026-08-28T12:00:00Z");

/* ------------------------------------------------------------------ *
 * The reading the adapter used to discard
 * ------------------------------------------------------------------ */

function win(range: InSiteRange, html: string): LegistarInSiteRaw["windows"][number] {
  return { range, rendered: range, html, pager: null, pages: [], noRecords: parseGridNoRecords(html) };
}

function pimaReading(): LegistarInSiteRaw {
  return {
    slug: "pima",
    calendarUrl: "https://pima.legistar.com/Calendar.aspx",
    windows: [
      win("This Month", fixture("legistar-insite-pima-calendar-this-month.html")),
      win("Next Month", fixture("legistar-insite-pima-calendar-next-month.html")),
    ],
    feedXml: null,
    feedUrl: null,
  } as LegistarInSiteRaw;
}

test("REGRESSION: the portal's agenda reading is KEPT, not discarded into a null URL", () => {
  /*
   * The defect, exactly. `lib/sources/legistar-insite/index.ts` read the grid's
   * agenda cell, tested it against /not available/i to decide whether to emit an
   * `agendaUrl`, and dropped the reading. Its own comment then claimed the null
   * "renders as the NAMED GAP it is — the body has not posted an agenda", which
   * is a claim about a government resting on nothing but our own empty field.
   *
   * This test fails if the reading is ever discarded again.
   */
  const result = normalizeWithDrops([pimaReading()], NOW);

  assert.ok(
    result.publicationObservations.length > 0,
    "the adapter must keep what the portal said about each sitting's agenda",
  );
  assert.equal(
    result.publicationObservations.length,
    result.meetings.length,
    "one reading per produced sitting — an AVAILABLE cell is evidence too, and " +
      "recording only the negatives would make this a defect log",
  );

  for (const observation of result.publicationObservations) {
    assert.match(observation.meetingId, /^legistar-insite:/, "scoped to one sitting");
    assert.ok(observation.evidenceQuote.length > 0, "a report needs a quoted basis");
    assert.equal(observation.observedAt, NOW.toISOString(), "and an observation time");
    assert.equal(observation.observedUrl, "https://pima.legistar.com/Calendar.aspx");
    assert.equal(observation.sourceOrg, "Pima County Clerk of the Board");
    assert.equal(observation.routeId, "INSITE_CALENDAR");
  }
});

test("the reading and the agendaUrl can never contradict each other", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  const byId = new Map(
    result.publicationObservations.map((o) => [o.meetingId, o]),
  );

  for (const meeting of result.meetings) {
    const observation = byId.get(meeting.id);
    assert.ok(observation, `${meeting.id} has a publication reading`);
    assert.equal(
      observation.report === "AVAILABLE",
      meeting.agendaUrl !== null,
      `${meeting.id}: the observation and the emitted URL disagree about the same ` +
        "cell, which means two predicates are reading one string",
    );
  }
});

test("an empty cell is DESCRIBED rather than quoted as an empty string", () => {
  const observation = observationFromGridCell({
    meetingId: "legistar-insite:x:1",
    status: "   ",
    href: null,
    calendarUrl: "https://x.legistar.com/Calendar.aspx",
    sourceOrg: "X Clerk",
    observedAt: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(observation.report, "NOT_AVAILABLE");
  assert.match(observation.evidenceQuote, /empty agenda cell/);
  assert.notEqual(observation.evidenceQuote, "");
});

test("only a FIRST_PARTY reading is minted, and the status string alone never means available", () => {
  const event = JSON.parse(
    fixture(join("legistar", "pima-event-1825.json")),
  ) as LegistarEvent;

  const observation = observationFromEvent({
    meetingId: "legistar:pima:1825",
    event,
    sourceOrg: "Pima County Clerk of the Board",
    observedAt: "2026-08-29T00:00:00.000Z",
  });

  assert.equal(observation.provenance, "FIRST_PARTY_PUBLISHER");
  assert.equal(observation.report, "AVAILABLE");
  assert.match(observation.evidenceQuote, /EventAgendaStatusName=Final/);
  assert.match(observation.evidenceQuote, /EventAgendaFile=https/);

  /*
   * **The status string is not the fact.** Pima returns "Final" on sittings with
   * no document at all, so reading availability off the label would report every
   * sitting's agenda as published. The DOCUMENT POINTER decides.
   */
  const noDocument = observationFromEvent({
    meetingId: "legistar:pima:1825",
    event: { ...event, EventAgendaFile: null },
    sourceOrg: "Pima County Clerk of the Board",
    observedAt: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(noDocument.report, "NOT_AVAILABLE");
  assert.match(noDocument.evidenceQuote, /EventAgendaStatusName=Final/);
});

/* ------------------------------------------------------------------ *
 * Two representations, and neither retires the other (RULING 207)
 * ------------------------------------------------------------------ */

const observation = (
  routeId: string,
  report: "AVAILABLE" | "NOT_AVAILABLE",
  observedAt: string,
): AgendaPublicationObservation => ({
  meetingId: "legistar:pima:1825",
  provenance: "FIRST_PARTY_PUBLISHER",
  report,
  observedAt,
  observedUrl: "https://pima.legistar.com/Calendar.aspx",
  sourceOrg: "Pima County Clerk of the Board",
  evidenceQuote: report === "AVAILABLE" ? "Agenda" : "Not Available",
  routeId,
});

test("SEEDED FAILURE: two surfaces disagreeing yields NO actionable reading", () => {
  /*
   * The RULING 207 assertion. A caller that got a "best" reading here would
   * treat it as settled, and the fact that this publisher's own two surfaces
   * disagree — a real state with a real cause — would be gone.
   */
  const reconciled = reconcilePublicationObservations("legistar:pima:1825", [
    observation("INSITE_CALENDAR", "NOT_AVAILABLE", "2026-08-29T10:00:00.000Z"),
    observation("WEBAPI_EVENT", "AVAILABLE", "2026-08-29T10:00:00.000Z"),
  ]);

  assert.equal(reconciled.agreement, "DISAGREE");
  assert.equal(
    reconciled.actionable,
    null,
    "a disagreement must not resolve itself into a usable reading",
  );
  assert.equal(reconciled.observations.length, 2, "and BOTH readings are kept");
  assert.match(reconciled.note, /never retires another/);
});

test("two surfaces agreeing is corroboration, and one surface says it is alone", () => {
  const agreed = reconcilePublicationObservations("legistar:pima:1825", [
    observation("INSITE_CALENDAR", "NOT_AVAILABLE", "2026-08-29T10:00:00.000Z"),
    observation("WEBAPI_EVENT", "NOT_AVAILABLE", "2026-08-29T11:00:00.000Z"),
  ]);
  assert.equal(agreed.agreement, "AGREE_NOT_AVAILABLE");
  assert.ok(agreed.actionable);
  assert.match(agreed.note, /2 independent publisher surfaces agree/);

  const alone = reconcilePublicationObservations("legistar:pima:1825", [
    observation("WEBAPI_EVENT", "AVAILABLE", "2026-08-29T10:00:00.000Z"),
  ]);
  assert.equal(alone.agreement, "SINGLE_ROUTE");
  assert.match(alone.note, /uncorroborated/);
});

test("a re-read of ONE route replaces that route's earlier reading, never another route's", () => {
  const reconciled = reconcilePublicationObservations("legistar:pima:1825", [
    observation("INSITE_CALENDAR", "NOT_AVAILABLE", "2026-08-28T10:00:00.000Z"),
    observation("INSITE_CALENDAR", "AVAILABLE", "2026-08-29T10:00:00.000Z"),
    observation("WEBAPI_EVENT", "AVAILABLE", "2026-08-29T09:00:00.000Z"),
  ]);
  assert.equal(reconciled.observations.length, 2, "one per route, newest kept");
  assert.equal(reconciled.agreement, "AGREE_AVAILABLE");
});

test("no reading at all is the absence of a reading, never a reading of an absence", () => {
  const reconciled = reconcilePublicationObservations("legistar:pima:9999", []);
  assert.equal(reconciled.actionable, null);
  assert.match(reconciled.note, /absence of a reading, not a reading of an absence/);
  assert.ok(
    !/has not published|did not post/i.test(reconciled.note),
    "and it makes no claim about the body",
  );
});

test("an observation scoped to a different sitting is never borrowed", () => {
  /*
   * Scoping is the whole rule. A reading of meeting A saying "Not Available"
   * must not be able to answer a question about meeting B, however close they
   * are in time or however plainly the portal is the same portal.
   */
  const reconciled = reconcilePublicationObservations("legistar:pima:1826", [
    observation("INSITE_CALENDAR", "NOT_AVAILABLE", "2026-08-29T10:00:00.000Z"),
  ]);
  assert.equal(reconciled.observations.length, 0);
  assert.equal(reconciled.actionable, null);
});

/* ------------------------------------------------------------------ *
 * MESA — the second tenant, and the reason one tenant is not a class
 * ------------------------------------------------------------------ */

test("MESA: the same route that gives Pima 2,083 person-votes gives Mesa NO outcome half", () => {
  /*
   * **THE CLASS-LEVEL FINDING, MEASURED LIVE ON 2026-08-29.**
   *
   * `/v1/mesa/events` for 2026-05-01..2026-08-29: **59 sittings, 874 agenda
   * items, ZERO recorded actions, ZERO pass flags, ZERO roll-call flags, ZERO
   * per-person vote rows.** The same four fields that carry Pima's entire
   * outcome record are present on Mesa's rows and are null on every one.
   *
   * This is the tenant that makes "Legistar is supported" an unsafe sentence.
   * Reported from Pima alone, this adapter looks like an outcome source; run
   * against Mesa it produces nothing, and the dangerous reading of that nothing
   * is *Mesa's council decides nothing* — a claim about a government made out of
   * one route's emptiness.
   *
   * The honest reading is the one the route portfolio encodes: the Web API's
   * outcome half is EMPTY ON THIS TENANT, the fact is still owed, and it must be
   * sought through a different representation (INSITE_ACCESSIBLE_MINUTES).
   */
  const items = JSON.parse(
    fixture(join("legistar", "legistar-mesa-eventitems-4717.json")),
  ) as LegistarEventItem[];

  assert.ok(items.length > 0, "the recorded reply carries rows — the route worked");

  for (const item of items) {
    assert.equal(item.EventItemActionName ?? null, null);
    assert.equal(item.EventItemPassedFlagName ?? null, null);
    assert.equal(item.EventItemRollCallFlag, 0);
  }

  /*
   * And the transform does the right thing with it: ZERO outcome records, and
   * NOT one outcome record per item carrying a manufactured "no action" verdict.
   */
  const outcomes = toOutcomeRecords(items, {
    slug: "mesa",
    eventId: 4717,
    sourceOrg: "City of Mesa City Clerk",
    readOn: NEVER_READ,
  });
  assert.deepEqual(outcomes, [], "no action recorded means no ACTION_SUMMARY record");
  assert.equal(items.filter(hasRecordedAction).length, 0);

  /*
   * The single most important negative: a null pass flag is NOT_RECORDED and
   * never FAILED. Reading Mesa's nulls as defeats would have manufactured 874
   * rejections out of one city's four months.
   */
  for (const item of items) {
    assert.equal(readDisposition(item).disposition, "NOT_RECORDED");
  }
});

test("MESA: an empty outcome half is a fact about the ROUTE, and the fact stays owed", () => {
  /*
   * The portfolio is what keeps Mesa's silence from becoming Mesa's record. The
   * Web API answered — 200, 874 rows — and it carries no ACTION_TAKEN for this
   * tenant, so the fact is still owed through a representation that can bear it.
   */
  const items = JSON.parse(
    fixture(join("legistar", "legistar-mesa-eventitems-4717.json")),
  ) as LegistarEventItem[];

  assert.ok(
    items.every((item) => "EventItemActionName" in item),
    "the outcome FIELDS are on the wire — this is an empty record, not a missing " +
      "field, and the two must not be confused",
  );
});
