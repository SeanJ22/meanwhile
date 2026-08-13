import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  attributionSummary,
  meetingBodiesFor,
  resolveSegment,
  segmentAgenda,
  type AgendaItem,
} from "../lib/meetings/attribution.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import type { Body } from "../lib/registry/types.ts";
import type { LegistarEventItem } from "../lib/sources/legistar/types.ts";

/**
 * Agenda attribution — 4.6.9 / D19.
 *
 * Driven by the recorded Pima agenda rather than a synthetic one, because the
 * case only exists in real published text: a county board sitting as a library
 * district board, in the middle of its own meeting, marked with nothing but a
 * heading in capital letters.
 */

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
  // The contract sitting under that heading is library business. Before this,
  // it recorded as county-board business along with the other 123 items.
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
  // THE WHOLE POINT. Census publishes no boundary for a special district, so
  // the registry has no Library District division and none can be matched.
  // Falling back to the county board would re-create the exact misattribution
  // D19 exists to prevent — the agenda has already told us the host is not
  // responsible for these items.
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
  // THE CONSERVATION LAW, and it caught a real drop. Business is anything with
  // a matter file; each such item must land in exactly one segment. The first
  // version skipped items with an empty title before attributing them, which
  // silently lost the one Pima item that has a matter file and no title — 49
  // in, 48 out, no error. Asserting the count against its denominator is the
  // only thing that shows it.
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
  // A heading naming a body in another county must not match. Widening the
  // scope is how a heading match turns into the name join CLAUDE.md forbids.
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
