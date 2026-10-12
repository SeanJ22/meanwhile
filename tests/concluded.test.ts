import assert from "node:assert/strict";
import test from "node:test";

import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import {
  allHistoryGaps,
  concludedGapNoteFor,
  historyGapsFor,
} from "../lib/meetings/history-gaps.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { applyFilters } from "../lib/state/derive.ts";
import { INITIAL_STATE, uiReducer } from "../lib/state/reducer.ts";
import { daysBackForStatuses } from "../lib/state/status-intent.ts";
import type { Meeting } from "../lib/sources/types.ts";

function meetingAt(startsAt: string, status: Meeting["status"]): Meeting {
  return {
    id: `t:${startsAt}:${status}`,
    ocdId: "ocd-division/country:us/state:az/county:pima",
    bodyName: "Board of Supervisors",
    title: "Board of Supervisors",
    startsAt,
    timeZone: "America/Phoenix",
    location: { name: "v", address: "a", lat: 32.2, lng: -110.97 },
    agendaUrl: null,
    jurisdiction: "Pima County, AZ",
    status,
    provenance: {
      sourceUrl: "https://example.gov",
      sourceOrg: "Clerk",
      collectedAt: "2026-08-15T00:00:00.000Z",
      verifiedAt: null,
    },
  };
}

test("the Concluded chip opens the window its own meetings live in", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const past = meetingAt("2026-07-20T17:00:00.000Z", "CONCLUDED");
  const future = meetingAt("2026-08-25T17:00:00.000Z", "SCHEDULED");
  const meetings = [past, future];

  const naive = {
    ...INITIAL_STATE,
    filters: { ...INITIAL_STATE.filters, statuses: ["CONCLUDED" as const] },
  };
  assert.equal(
    applyFilters({ meetings, ui: naive, center: null, now }).length,
    1,
    "the default window now reaches back far enough for the chip to answer on its own",
  );

  const fromNarrow = uiReducer(
    { ...INITIAL_STATE, filters: { ...INITIAL_STATE.filters, daysBack: 0 } },
    { type: "filter/toggleStatus", value: "CONCLUDED" },
  );
  assert.equal(fromNarrow.filters.daysBack, CONCLUDED_LOOKBACK_DAYS);
  assert.equal(
    applyFilters({ meetings, ui: fromNarrow, center: null, now }).length,
    1,
  );

  const tapped = uiReducer(INITIAL_STATE, {
    type: "filter/toggleStatus",
    value: "CONCLUDED",
  });
  assert.equal(tapped.filters.daysBack, CONCLUDED_LOOKBACK_DAYS);
  const shown = applyFilters({ meetings, ui: tapped, center: null, now });
  assert.equal(shown.length, 1, "the concluded meeting must be revealed");
  assert.equal(shown[0].id, past.id);

  const scheduled = uiReducer(INITIAL_STATE, {
    type: "filter/toggleStatus",
    value: "SCHEDULED",
  });
  assert.equal(scheduled.filters.daysBack, INITIAL_STATE.filters.daysBack);

  assert.equal(daysBackForStatuses(["CONCLUDED"], 120), null);
  assert.equal(daysBackForStatuses([], 0), null);

  const untapped = uiReducer(tapped, {
    type: "filter/toggleStatus",
    value: "CONCLUDED",
  });
  assert.equal(untapped.filters.daysBack, CONCLUDED_LOOKBACK_DAYS);
});

test("a body that publishes no history says so, in plain language", () => {
  for (const row of FIXTURE_DOOR_ROWS) {
    if (row.publishesHistory === false) {
      const reason = row.historyGapReason ?? "";
      assert.ok(
        reason.length > 20,
        `${row.bodyId}: publishesHistory=false with no reader-facing reason`,
      );
      assert.ok(
        !/ical|rss|api|json|adapter|endpoint|scrape/i.test(reason),
        `${row.bodyId}: the reason talks like a build log — "${reason}"`,
      );
      assert.ok(!/ocd-division/.test(reason));
    } else {
      assert.equal(
        row.historyGapReason,
        undefined,
        `${row.bodyId}: carries a history-gap reason but does not claim the gap`,
      );
    }
  }

  const gaps = allHistoryGaps();
  console.log(`\n  gaps  ${gaps.length} wired body/bodies publish no history\n`);
  assert.equal(
    gaps.length,
    0,
    `${gaps.length} history gap(s): ${gaps.map((g) => g.bodyName).join(", ")}`,
  );
  for (const gap of gaps) {
    assert.ok(FIXTURE_DOOR_ROWS.some((r) => r.bodyId === gap.bodyId));
  }
});

test("the gap note fires only when the reader asks about the past", () => {
  const cleanBody = [{ bodyId: "ocd-division/country:us/state:az/county:pima#governing" }];

  assert.equal(concludedGapNoteFor(false, historyGapsFor(cleanBody)), null, "not asking, no note");
  assert.equal(
    concludedGapNoteFor(true, historyGapsFor(cleanBody)),
    null,
    "a body that does publish history gets no excuse made for it",
  );
  assert.equal(historyGapsFor(cleanBody).length, 0);

  const note = concludedGapNoteFor(true, [
    {
      bodyId: "ocd-division/country:us/state:zz/place:example#governing",
      bodyName: "Example Township Council",
      jurisdiction: "Example Township, ZZ",
      reason: "The township's website lists meetings that haven't happened yet.",
    },
  ]);
  assert.ok(note && note.length > 30);
  assert.ok(note.includes("Example Township Council"), "the note names the body");
  assert.ok(!/ical|rss|api|adapter/i.test(note), "the note talks like a build log");
  assert.equal(concludedGapNoteFor(false, []), null);
});

test("the Apptegy fetch asks the vendor for the past", async () => {
  const { makeApptegySource } = await import("../lib/sources/apptegy/index.ts");
  const asked: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    return new Response(
      JSON.stringify({
        events: [
          {
            id: 1,
            title: "Governing Board Meeting",
            start_at: "2026-06-02T19:00:00.000-07:00",
            venue: "District Office",
            latitude: "32.0",
            longitude: "-110.7",
            description: null,
          },
        ],
        meta: { links: { next: null } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const wiring = FIXTURE_DOOR_ROWS.filter((r) => r.agendaSourceType === "APPTEGY");
  assert.ok(wiring.length > 0, "the denominator: Apptegy rows exist");

  const source = makeApptegySource(wiring, fakeFetch);
  const raw = await source.fetch({
    lat: 32.05,
    lng: -110.62,
    radiusKm: 40,
    startsAfter: "2026-05-17T00:00:00.000Z",
    startsBefore: "2026-10-14T00:00:00.000Z",
  });

  assert.equal(asked.length, wiring.length, "one first page per wired org");
  for (const url of asked) {
    assert.ok(
      url.includes("start_date=2026-05-17"),
      `the fetch did not ask for history: ${url}`,
    );
  }

  const meetings = source.normalize(raw, new Date("2026-08-15T12:00:00.000Z"));
  assert.ok(meetings.length > 0, "the fetched past event normalized to nothing");
  assert.ok(
    meetings.every((m) => m.status === "CONCLUDED"),
    "a June meeting read on 15 August is concluded",
  );
  const first = meetings[0];
  assert.ok(first, "no meeting to check the citation on");
  assert.ok(
    first.provenance.sourceUrl?.includes("start_date="),
    `citation does not name the window it was read with: ${first.provenance.sourceUrl}`,
  );
});
