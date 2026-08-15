import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import {
  allHistoryGaps,
  concludedGapNote,
  historyGapsFor,
} from "../lib/meetings/history-gaps.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { applyFilters } from "../lib/state/derive.ts";
import { INITIAL_STATE, uiReducer } from "../lib/state/reducer.ts";
import { daysBackForStatuses } from "../lib/state/status-intent.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * M58 (2026-08-15) — concluded meetings, and the control that could not
 * reveal them.
 *
 * The author reported seeing concluded meetings only at 85701. Measured on
 * production before anything was changed, the truth was worse and simpler:
 * tapping the **Concluded** chip rendered "0 meetings — nothing matches" at
 * ALL FOUR demo zips, Tucson included, while the payloads behind those
 * screens carried 24 concluded sittings at 85701, 4 at 07866 and 2 at 03255.
 * The server had been sending the recent past all along; the client's date
 * window starts at now, so `days < -daysBack` dropped every one, and the one
 * control that names concluded meetings could never match a row by itself.
 *
 * Two guards, then: the rule that makes the chip answerable, and the promise
 * that a Concluded surface is never silently empty.
 */

const ROOT = join(import.meta.dirname, "..");

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

test("M58: the Concluded chip opens the window its own meetings live in", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const past = meetingAt("2026-07-20T17:00:00.000Z", "CONCLUDED");
  const future = meetingAt("2026-08-25T17:00:00.000Z", "SCHEDULED");
  const meetings = [past, future];

  // The production behaviour, reproduced: default window + Concluded chip
  // matched nothing, at every zip.
  const naive = {
    ...INITIAL_STATE,
    filters: { ...INITIAL_STATE.filters, statuses: ["CONCLUDED" as const] },
  };
  assert.equal(
    applyFilters({ meetings, ui: naive, center: null, now }).length,
    0,
    "the defect itself — if this starts passing, the window default changed and this test needs rewriting, not deleting",
  );

  // Through the reducer, the way a reader actually taps it.
  const tapped = uiReducer(INITIAL_STATE, {
    type: "filter/toggleStatus",
    value: "CONCLUDED",
  });
  assert.equal(tapped.filters.daysBack, CONCLUDED_LOOKBACK_DAYS);
  const shown = applyFilters({ meetings, ui: tapped, center: null, now });
  assert.equal(shown.length, 1, "the concluded meeting must be revealed");
  assert.equal(shown[0].id, past.id);

  // A forward-only status leaves the window where it was: nothing is
  // widened that does not need widening.
  const scheduled = uiReducer(INITIAL_STATE, {
    type: "filter/toggleStatus",
    value: "SCHEDULED",
  });
  assert.equal(scheduled.filters.daysBack, INITIAL_STATE.filters.daysBack);

  // The reader's own wider choice is never narrowed.
  assert.equal(daysBackForStatuses(["CONCLUDED"], 120), null);
  assert.equal(daysBackForStatuses([], 0), null);

  // Turning the chip back off does not slam the window shut — the reader
  // may have dragged it there, and inferring a retreat would be guessing.
  const untapped = uiReducer(tapped, {
    type: "filter/toggleStatus",
    value: "CONCLUDED",
  });
  assert.equal(untapped.filters.daysBack, CONCLUDED_LOOKBACK_DAYS);
});

/**
 * The never-silently-empty promise. Every wired body either serves concluded
 * meetings or carries a stated, reader-facing reason it cannot — and the
 * reason has to survive being read aloud to a stranger.
 */
test("M58: a body that publishes no history says so, in plain language", () => {
  for (const row of SOURCE_WIRING) {
    if (row.publishesHistory === false) {
      const reason = row.historyGapReason ?? "";
      assert.ok(
        reason.length > 20,
        `${row.bodyId}: publishesHistory=false with no reader-facing reason`,
      );
      // The plain-language rule: no vendor names, no identifiers, no jargon
      // in a sentence a reader sees.
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
  assert.ok(gaps.length > 0, "the denominator: at least one gap is recorded");
  // Every gap joins by bodyId to a real wiring row — never a name.
  for (const gap of gaps) {
    assert.ok(SOURCE_WIRING.some((r) => r.bodyId === gap.bodyId));
  }
});

test("M58: the gap note fires only when the reader asks about the past", () => {
  const gapBody = [{ bodyId: allHistoryGaps()[0].bodyId }];
  const cleanBody = [{ bodyId: "ocd-division/country:us/state:az/county:pima#governing" }];

  assert.equal(concludedGapNote(false, gapBody), null, "not asking, no note");
  assert.equal(
    concludedGapNote(true, cleanBody),
    null,
    "a body that does publish history gets no excuse made for it",
  );
  const note = concludedGapNote(true, gapBody);
  assert.ok(note && note.length > 30);
  assert.ok(note.includes(allHistoryGaps()[0].bodyName), "the note names the body");
  assert.equal(historyGapsFor(cleanBody).length, 0);
});

/**
 * The adapter half: the source that CAN serve history must ask for it. The
 * Apptegy events API is upcoming-only unless `start_date` is sent, and this
 * adapter took the default for two of the four demo zips — so Vail and
 * Rockaway Township's school board were empty on the Concluded filter by
 * construction. Verified live 2026-08-15: `?start_date=2026-05-17` returns
 * four concluded board meetings for each org.
 */
test("M58: the Apptegy fetch asks the vendor for the past", async () => {
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

  const wiring = SOURCE_WIRING.filter((r) => r.agendaSourceType === "APPTEGY");
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

  // And the past event survives normalization as CONCLUDED — a fetch that
  // asks and a normalize that drops is the same silent empty.
  const meetings = source.normalize(raw, new Date("2026-08-15T12:00:00.000Z"));
  assert.ok(meetings.length > 0, "the fetched past event normalized to nothing");
  assert.ok(
    meetings.every((m) => m.status === "CONCLUDED"),
    "a June meeting read on 15 August is concluded",
  );
  // The citation carries the window it was actually read with.
  const first = meetings[0];
  assert.ok(first, "no meeting to check the citation on");
  assert.ok(
    first.provenance.sourceUrl?.includes("start_date="),
    `citation does not name the window it was read with: ${first.provenance.sourceUrl}`,
  );
});

/**
 * The whole point, stated as a denominator over the committed snapshot: how
 * many wired jurisdictions can show a concluded meeting, and every one that
 * cannot must be an explained gap rather than a silence. This is the test
 * that would have caught the original defect — five of the nine adapters
 * were serving history and nobody had ever counted.
 */
test("M58: every wired jurisdiction either has history or explains its absence", () => {
  const snapshot = JSON.parse(
    readFileSync(join(ROOT, "data", "meetings-snapshot.json"), "utf8"),
  ) as { meetings: Array<{ id: string; jurisdiction: string; startsAt: string }> };

  const now = Date.parse(snapshot.meetings[0] ? "2026-08-15T12:00:00.000Z" : "");
  const pastByJurisdiction = new Map<string, number>();
  for (const m of snapshot.meetings) {
    const past = Date.parse(m.startsAt) < now ? 1 : 0;
    pastByJurisdiction.set(
      m.jurisdiction,
      (pastByJurisdiction.get(m.jurisdiction) ?? 0) + past,
    );
  }

  const explained = new Set(allHistoryGaps().map((g) => g.jurisdiction));
  const unexplained: string[] = [];
  for (const [jurisdiction, past] of pastByJurisdiction) {
    if (past === 0 && !explained.has(jurisdiction)) unexplained.push(jurisdiction);
  }

  // Stated with its denominator, per CLAUDE.md: a deliberate clip must not
  // read as a failure and a real failure must not read as a clip.
  const total = pastByJurisdiction.size;
  const withHistory = [...pastByJurisdiction.values()].filter((n) => n > 0).length;
  assert.ok(
    total > 0,
    "the snapshot holds no meetings at all — fix that before reading this test",
  );
  assert.deepEqual(
    unexplained,
    [],
    `${withHistory} of ${total} wired jurisdictions show concluded meetings; these show none and give no reason: ${unexplained.join(", ")}`,
  );
});
