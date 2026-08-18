import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSearchIndex } from "@/lib/search/index";
import { groupByVenue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";

/**
 * M135 (2026-08-18) — every row opens a card, applied to the ask panel's
 * autocomplete.
 *
 * MEASURED, across the four pilot zips
 * (`corepack pnpm exec tsx scripts/audit-search-rows.mts`):
 *
 *   BEFORE  227 rows — 163 venue panel,  0 card, 43 fly only, 21 SILENT
 *   AFTER   227 rows — 163 venue panel, 36 card, 26 fly only,  2 SILENT
 *
 * A row was silent when it carried no venue and no geometry: `onSearchPick`
 * selected a venue for the first, flew for the second, and a row with neither
 * fell off the end of the function. D18 named that defect for the meetings LIST
 * ("a row that answers a click with silence") and fixed it there; the sibling
 * handler never got the same fix.
 *
 * ONE DIAGNOSIS WAS TRIED AND DISCARDED, recorded because it is the more
 * useful half. The first theory was that body and place rows — which are
 * aggregates borrowing geometry from one of their meetings — were borrowing
 * from an online sitting while located ones existed. A reordering was written,
 * and the measurement was identical on both sides: 21 silent either way, because
 * venue meetings are iterated ahead of online ones and the aggregate already
 * preferred a located representative. The change was reverted rather than
 * shipped with a plausible story attached, and no test here asserts it.
 *
 * THE TWO ROWS STILL SILENT are named rather than rounded away, and each is a
 * refusal rather than an oversight:
 *   - `85701 body: Finance and Audit Committee Meeting` — the body could not be
 *     resolved distinctly, so no card opens. See the refusal test below.
 *   - `85641 place: Pima County, AZ` — a place is a division several bodies sit
 *     in, this product has no committed card for a place subject, and electing
 *     one of N bodies to stand for it would be an invented answer.
 */

const PIMA = "ocd-division/country:us/state:az/county:pima";

function meeting(over: Partial<Meeting> & { id: string }): Meeting {
  return {
    ocdId: PIMA,
    bodyName: "Board of Supervisors",
    title: "Regular Meeting",
    startsAt: "2026-09-11T13:30:00-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Board Chambers", address: null, lat: 32.22, lng: -110.97 },
    agendaUrl: null,
    jurisdiction: "Pima County, AZ",
    status: "SCHEDULED" as const,
    provenance: {
      sourceUrl: null,
      sourceOrg: "Pima County",
      collectedAt: "2026-08-18T22:00:00.000Z",
      verifiedAt: null,
    },
    ...over,
  } as Meeting;
}

/** An online sitting: in no venue, and with no place to fly to (D18). */
function online(over: Partial<Meeting> & { id: string }): Meeting {
  return meeting({ ...over, location: null });
}

function index(meetings: Meeting[]) {
  return buildSearchIndex(
    groupByVenue(meetings.filter((m) => m.location !== null)),
    [],
    meetings.filter((m) => m.location === null),
  );
}

/** The handler's body, sliced out of source for the guards below. */
function searchPickSource(): string {
  const source = readFileSync("components/map/map-entry.tsx", "utf8");
  const start = source.indexOf("const onSearchPick = useCallback");
  const end = source.indexOf("const onPickMeeting = useCallback");
  assert.ok(start > 0 && end > start, "onSearchPick is still where the guard expects it");
  return source.slice(start, end);
}

test("an all-online body carries no geometry, and none is invented for it", () => {
  // The precondition the card fallback exists for. A body that genuinely never
  // meets anywhere has no lat/lng, and that is a true fact about the body — the
  // fix answers it with a card, never by manufacturing a point to fly to.
  const rows = index([
    online({ id: "m:a", title: "Regular Meeting" }),
    online({ id: "m:b", title: "Special Meeting" }),
  ]);

  const body = rows.find((r) => r.kind === "body");
  assert.ok(body, "the index still produces a body row");
  assert.equal(body.lat, null, "no location is invented for an all-online body");
  assert.equal(body.venueKey, null, "an online body is in no venue");

  const onlineMeetingRow = rows.find((r) => r.kind === "meeting");
  assert.ok(onlineMeetingRow);
  assert.equal(onlineMeetingRow.venueKey, null, "an online sitting is in no venue");
  assert.equal(onlineMeetingRow.lat, null, "and has nowhere to fly to");
});

test("the rows that carry neither venue nor geometry are exactly the kinds with a card fallback", () => {
  /*
   * The property that makes the surface answerable: every row that cannot be
   * answered by a venue or by the camera is of a kind whose pick opens a card.
   * `place` is the one kind that is not, which is why the audit's remainder is
   * a place row and why that row is named in this file's header rather than
   * asserted away.
   */
  const rows = index([
    online({ id: "m:online", title: "Special Meeting" }),
    meeting({ id: "m:located", title: "Regular Meeting" }),
  ]);

  const noRoute = rows.filter((r) => r.venueKey === null && r.lat === null);
  const kinds = [...new Set(noRoute.map((r) => r.kind))].sort();

  assert.deepEqual(
    kinds.filter((k) => k !== "meeting" && k !== "body"),
    [],
    "a row with no venue and no geometry is a meeting or a body — both have a card",
  );
  console.log(
    `search-rows: ${rows.length} rows, ${noRoute.length} with no venue and no geometry`,
  );
});

test("onSearchPick opens a card for the rows it cannot fly to", () => {
  /*
   * A source guard, not a render test. `onSearchPick` lives inside a large
   * client component whose whole tree would have to be mounted to exercise it,
   * and the property worth protecting is narrow: the fallback branches exist
   * and are gated on the row having no venue. Deleting either one re-opens the
   * defect the audit measured, and the audit script's AFTER column becomes a
   * fiction the same moment — this is what keeps that column honest.
   */
  const pick = searchPickSource();

  assert.match(
    pick,
    /if \(!item\.venueKey\)/,
    "the fallback is gated on the row having no venue",
  );
  assert.match(
    pick,
    /meetingSubject\(/,
    "a meeting row with no venue opens the large meeting card (D18's fix)",
  );
  assert.match(
    pick,
    /bodySubject\(/,
    "a body row opens that body's large battlecard (M135's ruling)",
  );
});

test("a body row's card is refused rather than guessed when the match is ambiguous", () => {
  /*
   * The distinctness rule, applied to a join that can collapse. Several bodies
   * share one division — 85701 resolves 60 covered bodies against one point —
   * and `CoveredBody.name` is null on derived rows, so a match on ocdId alone
   * would open one body's card from another body's row. The handler matches on
   * division AND name, accepts an ocdId-only match only where the division
   * holds exactly one body, and otherwise opens nothing.
   *
   * That refusal is the reason one row of 227 is still silent, and it is the
   * right trade: no card is strictly worse than the wrong card, and the wrong
   * card is a false claim about a government.
   */
  const pick = searchPickSource();

  assert.match(pick, /b\.name === item\.label/, "the name is part of the match");
  assert.match(
    pick,
    /named\.length === 1/,
    "a named match is accepted only when it is unique",
  );
  assert.match(
    pick,
    /candidates\.length === 1/,
    "an ocdId-only match is accepted only when the division holds one body",
  );
  assert.ok(
    !/candidates\[0\]\s*;?\s*$/m.test(pick.replace(/candidates\.length === 1[\s\S]*?candidates\[0\]/, "")),
    "there is no unguarded fall-through to the first candidate",
  );
});
