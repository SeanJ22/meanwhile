import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  attributionSummary,
  meetingBodiesFor,
  resolveMeetingBodies,
  resolveSegment,
  segmentAgenda,
  type AgendaItem,
} from "../lib/meetings/attribution.ts";
import { validateSnapshot } from "../lib/meetings/snapshot.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import type { Body } from "../lib/registry/types.ts";
import { normalizeWithDrops } from "../lib/sources/legistar/index.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
} from "../lib/sources/legistar/types.ts";

/** Agenda attribution, driven by a recorded agenda: a county board sitting as a district board, marked only by a capitalised heading. */

const PIMA_HOST = {
  bodyId: "ocd-division/country:us/state:az/county:pima#governing",
  ocdId: "ocd-division/country:us/state:az/county:pima",
  name: "PIMA COUNTY BOARD OF SUPERVISORS",
};

function loadItems(): AgendaItem[] {
  const raw = readFileSync(
    join(import.meta.dirname, "fixtures", "legistar-pima-eventitems-1824.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as LegistarEventItem[] | { value: LegistarEventItem[] };
  const items = Array.isArray(parsed) ? parsed : parsed.value;
  return items.map((i) => ({
    id: i.EventItemId,
    sequence: i.EventItemAgendaSequence,
    title: i.EventItemTitle ?? i.EventItemMatterName ?? "",
    matterFile: i.EventItemMatterFile,
  }));
}

test("the recorded Pima agenda splits into more than one acting body", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  assert.ok(segments.length > 1, "a sitting-as agenda must not collapse to one segment");
  assert.equal(segments[0].role, "HOST");
});

test("the library district's business is separated from the county board's", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  const library = segments.find((s) => /library district/i.test(s.heading));

  assert.ok(library, "LIBRARY DISTRICT BOARD should open its own segment");
  assert.equal(library.role, "SITTING_AS");
  // The contract sitting under that heading is library business.
  assert.ok(library.itemIds.length > 0, "the library segment should carry its items");
  assert.ok(
    !segments[0].itemIds.some((id) => library.itemIds.includes(id)),
    "an item cannot belong to both the host and another board",
  );
});

test("control returns to the host afterwards", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  const back = segments.findIndex((s) => /sitting as the board of supervisors/i.test(s.heading));
  assert.ok(back > 0, "the return-to-host heading should open a segment");
  assert.equal(segments[back].role, "HOST");
  assert.equal(segments[back].attribution, "HOST_BODY");
  assert.equal(segments[back].bodyId, PIMA_HOST.bodyId);
});

test("an unresolved segment attributes to nothing — never to the host", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  const labels = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));
  const resolved = segments.map((s) =>
    resolveSegment(s, registry.bodies as Body[], labels, PIMA_HOST.ocdId),
  );

  const library = resolved.find((s) => /library district/i.test(s.heading))!;
  // Census publishes no boundary for a special district, so none can be matched; falling back to the county board would misattribute these items.
  assert.equal(library.attribution, "UNRESOLVED");
  assert.equal(library.bodyId, null);
  assert.equal(library.ocdId, null);
  assert.match(library.unresolvedReason!, /no division/i);
});

test("a plain section heading does not start a new body", () => {
  // "CALL TO THE PUBLIC" has no matter file and is shouted in capitals like the
  // real switches are. Treating it as a body would scatter county business
  // across invented boards, which is the same error pointing the other way.
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  assert.ok(!segments.some((s) => /call to the public/i.test(s.heading)));
});

test("an agenda with no sitting-as headings yields exactly one host segment", () => {
  const plain: AgendaItem[] = [
    { id: 1, sequence: 1, title: "REGULAR AGENDA", matterFile: null },
    { id: 2, sequence: 2, title: "Award of contract", matterFile: "C-2026-1" },
    { id: 3, sequence: 3, title: "Budget transfer", matterFile: "C-2026-2" },
  ];
  const segments = segmentAgenda(plain, PIMA_HOST);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].role, "HOST");
  assert.deepEqual(segments[0].itemIds, [2, 3]);
});

test("the join rows carry the published heading as evidence", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  const rows = meetingBodiesFor("legistar:pima:1824", segments);

  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.equal(row.meetingId, "legistar:pima:1824");
    // An attribution that cannot be checked against the source is an assertion,
    // not a record.
    assert.ok(row.evidence.length > 0, "every row needs its heading");
  }
  // A row may legitimately have a null bodyId; that is the unresolved case.
  assert.ok(rows.some((r) => r.bodyId === null));
});

test("the summary counts unattributed items rather than hiding them", () => {
  const segments = segmentAgenda(loadItems(), PIMA_HOST);
  const labels = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));
  const rows = meetingBodiesFor(
    "legistar:pima:1824",
    segments.map((s) => resolveSegment(s, registry.bodies as Body[], labels, PIMA_HOST.ocdId)),
  );

  const summary = attributionSummary(rows);
  assert.ok(summary.host >= 1);
  assert.ok(summary.unresolved >= 1, "the library district should be counted as unresolved");
  assert.ok(
    summary.itemsUnattributed >= 1,
    "items under an unresolved heading must be counted, not silently dropped",
  );
});

test("every item of real business is attributed to exactly one segment", () => {
  // Business is anything with a matter file; each such item must land in exactly one segment, counted against its denominator.
  const items = loadItems();
  const business = items.filter((i) => i.matterFile);
  const segments = segmentAgenda(items, PIMA_HOST);

  const attributed = segments.flatMap((s) => s.itemIds);
  assert.equal(
    attributed.length,
    business.length,
    `${business.length} items of business, ${attributed.length} attributed`,
  );
  assert.equal(
    new Set(attributed).size,
    attributed.length,
    "an item must not be attributed twice",
  );
  for (const item of business) {
    assert.ok(attributed.includes(item.id), `item ${item.id} was dropped`);
  }
});

test("resolution never reaches outside the host's own division", () => {
  // A heading naming a body in another county must not match.
  const segment = segmentAgenda(
    [
      { id: 1, sequence: 1, title: "SITTING AS OTHER BOARDS", matterFile: null },
      { id: 2, sequence: 2, title: "Morris", matterFile: null },
      { id: 3, sequence: 3, title: "Some business", matterFile: "X-1" },
    ],
    PIMA_HOST,
  )[1];

  const labels = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));
  const resolved = resolveSegment(
    segment,
    registry.bodies as Body[],
    labels,
    PIMA_HOST.ocdId,
  );
  assert.equal(resolved.attribution, "UNRESOLVED");
  assert.equal(resolved.bodyId, null);
});

test("the adapter produces acting-body rows from a real fetch shape", () => {
  // The rows are built by normalizeWithDrops: the path an ingest takes.
  const events = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "legistar-pima-events.json"), "utf8"),
  ) as LegistarEvent[];
  const rawItems = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures", "legistar-pima-eventitems-1824.json"),
      "utf8",
    ),
  ) as LegistarEventItem[] | { value: LegistarEventItem[] };
  const items = Array.isArray(rawItems) ? rawItems : rawItems.value;

  const { meetings, agendasRead } = normalizeWithDrops(
    events.map((event) => ({
      event,
      slug: "pima",
      collectedAt: "2026-08-12T22:00:00.000Z",
      items: event.EventId === 1824 ? items : null,
    })),
    new Date("2026-08-12T22:00:00.000Z"),
  );

  assert.equal(agendasRead, 1, "exactly one agenda was read, and the count says so");
  const withRows = meetings.filter((m) => m.actingBodies !== undefined);
  assert.equal(withRows.length, 1, "only the meeting whose agenda was read carries rows");
  assert.ok(withRows[0].actingBodies!.length > 1, "the Pima agenda has more than one acting body");
  assert.ok(
    withRows[0].actingBodies!.every((r) => r.meetingId === withRows[0].id),
    "every row cites the meeting it belongs to",
  );
});

test("a meeting whose agenda was NOT read carries no rows at all — absent, not empty", () => {
  // The distinction the whole field rests on. An empty array would say "we
  // read this agenda and nobody else acted", which is a claim about a meeting
  // nobody looked at.
  const events = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "legistar-pima-events.json"), "utf8"),
  ) as LegistarEvent[];
  const { meetings, agendasRead } = normalizeWithDrops(
    events.map((event) => ({
      event,
      slug: "pima",
      collectedAt: "2026-08-12T22:00:00.000Z",
      items: null,
    })),
    new Date("2026-08-12T22:00:00.000Z"),
  );
  assert.equal(agendasRead, 0);
  assert.ok(meetings.length > 0, "the meetings still normalize");
  for (const m of meetings) {
    assert.equal(m.actingBodies, undefined, "no agenda read means no rows, not zero rows");
  }
});

test("resolving join rows against the registry never writes the host onto an unresolved one", () => {
  const rows = meetingBodiesFor("legistar:pima:1824", segmentAgenda(loadItems(), PIMA_HOST));
  const labels = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));
  const resolved = resolveMeetingBodies(
    rows,
    registry.bodies as Body[],
    labels,
    PIMA_HOST.ocdId,
  );

  assert.equal(resolved.length, rows.length, "resolution adds and drops nothing");
  const unresolved = resolved.filter((r) => r.attribution === "UNRESOLVED");
  assert.ok(unresolved.length > 0, "Pima's two special districts have no Census division");
  for (const row of unresolved) {
    assert.equal(row.bodyId, null, `"${row.evidence}" was given a body id`);
    assert.equal(row.ocdId, null, `"${row.evidence}" was given the host's division`);
    assert.notEqual(row.ocdId, PIMA_HOST.ocdId);
  }
  // And the host's own rows are untouched by the pass.
  for (const row of resolved.filter((r) => r.role === "HOST")) {
    assert.equal(row.attribution, "HOST_BODY");
    assert.equal(row.ocdId, PIMA_HOST.ocdId);
  }
});

test("the write boundary refuses a snapshot that attributes an unresolved heading to the host", () => {
  // The rule is enforced where the FILE is written, not where a component
  // renders — by the time a null reaches a component the lie is already in
  // the data. This is the same argument the refresh corollary makes.
  const base = {
    formatVersion: 1 as const,
    generatedAt: "2026-08-17T00:00:00.000Z",
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [
      {
        source: "legistar",
        ok: true,
        error: null,
        fetched: 1,
        normalized: 1,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      },
    ],
    agendaDocuments: [],
  };
  const meeting = {
    id: "legistar:pima:1824",
    ocdId: PIMA_HOST.ocdId,
    /* Required of every meeting; without it the snapshot is refused before this test reaches its own check. */
    bodyId: PIMA_HOST.bodyId,
    bodyName: "Board of Supervisors",
    title: "Regular Meeting",
    startsAt: "2026-08-11T13:30:00-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Board Chambers", address: null, lat: 32.22, lng: -110.97 },
    agendaUrl: null,
    jurisdiction: "Pima County, AZ",
    status: "CONCLUDED" as const,
    provenance: {
      sourceUrl: null,
      sourceOrg: "Pima County",
      collectedAt: "2026-08-12T22:00:00.000Z",
      verifiedAt: null,
    },
  };

  const honest = {
    ...base,
    meetings: [
      {
        ...meeting,
        actingBodies: [
          {
            meetingId: "legistar:pima:1824",
            bodyId: null,
            ocdId: null,
            role: "SITTING_AS" as const,
            attribution: "UNRESOLVED" as const,
            evidence: "LIBRARY DISTRICT BOARD",
            itemCount: 19,
          },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => validateSnapshot(honest));

  const smuggled = {
    ...base,
    meetings: [
      {
        ...meeting,
        actingBodies: [
          {
            ...honest.meetings[0].actingBodies[0],
            ocdId: PIMA_HOST.ocdId,
          },
        ],
      },
    ],
  };
  assert.throws(() => validateSnapshot(smuggled), /attributes to NOTHING, never to the host/);
});

test("a page-break marker is typography, not a body — the items after it stay put", () => {
  // The agenda prints "PAGE BREAK" as an item inside the sitting-as region; it must not open a segment.
  const segments = segmentAgenda(
    [
      { id: 1, sequence: 1, title: "BOARD OF SUPERVISORS SITTING AS OTHER BOARDS", matterFile: null },
      { id: 2, sequence: 2, title: "FLOOD CONTROL DISTRICT BOARD", matterFile: null },
      { id: 3, sequence: 3, title: "First flood control item", matterFile: "FC-1" },
      { id: 4, sequence: 4, title: "PAGE BREAK", matterFile: null },
      { id: 5, sequence: 5, title: "Second flood control item", matterFile: "FC-2" },
      { id: 6, sequence: 6, title: "* * *", matterFile: null },
      { id: 7, sequence: 7, title: "Third flood control item", matterFile: "FC-3" },
      { id: 8, sequence: 8, title: "SITTING AS THE BOARD OF SUPERVISORS", matterFile: null },
    ],
    PIMA_HOST,
  );

  const flood = segments.filter((s) => /flood control/i.test(s.heading));
  assert.equal(flood.length, 1, "the page break must not split the district into two segments");
  assert.deepEqual(
    flood[0].itemIds,
    [3, 5, 7],
    "every item between the district heading and the return belongs to the district",
  );
  assert.ok(
    !segments.some((s) => /page\s*break/i.test(s.heading) || /^[^\p{L}]+$/u.test(s.heading)),
    "no segment is opened by typography",
  );
});
