import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  attributionMarker,
  attributionNotesFor,
} from "../lib/meetings/list-attribution.ts";

const ROOT = process.cwd();

const meeting = (jurisdiction: string, sourceOrg: string) => ({
  jurisdiction,
  provenance: { sourceOrg } as { sourceOrg: string },
});

/* --------------------------------------------- F01 3.2, the collapse --- */

test("F01 3.2: one note per DISTINCT attribution, not one per row", () => {
  const rows = [
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
  ];
  const { notes, markerFor } = attributionNotesFor(rows);
  assert.equal(notes.length, 1, "three identical rows produced more than one note");
  assert.equal(notes[0].marker, "*");
  // Nothing is de-sourced: both strings survive verbatim.
  assert.equal(notes[0].jurisdiction, "Tucson Unified School District, AZ");
  assert.equal(notes[0].sourceOrg, "TUSD Governing Board");
  for (const row of rows) assert.equal(markerFor(row), "*");
});

test("F01 3.2: two bodies at one venue get two markers, in render order", () => {
  // Tucson splits city and school meetings at the same point, which is exactly
  // why the marker rides on the row rather than the note standing alone.
  const school = meeting("Tucson Unified School District, AZ", "TUSD Governing Board");
  const city = meeting("Tucson, AZ", "City Clerk");
  const { notes, markerFor } = attributionNotesFor([school, city, school]);
  assert.deepEqual(notes.map((n) => n.marker), ["*", "†"]);
  assert.equal(markerFor(school), "*");
  assert.equal(markerFor(city), "†");
});

test("F01 3.2: a meeting from outside the list gets NO marker, never a wrong one", () => {
  const { markerFor } = attributionNotesFor([meeting("A", "a")]);
  assert.equal(markerFor(meeting("B", "b")), "");
});

test("F01 3.2: the marker set never runs out and never collides", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    const m = attributionMarker(i);
    assert.ok(m.length > 0, `marker ${i} is empty`);
    assert.ok(!seen.has(m), `marker ${i} collides with an earlier one (${m})`);
    seen.add(m);
  }
});

/* ------------------------------------ F01 3.1, every surface, no excuses --- */

test("F01 3.1: every meetings list renders the three groups, not a raw array", () => {
  // The defect was not the ordering function; it was that half the callers
  // never called it. This guard reads the surfaces themselves so a new one
  // cannot ship rendering `.map` over an unordered list again.
  for (const file of [
    "components/map/meeting-panel.tsx",
    "components/map/popup/entity-modal.tsx",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.match(
      source,
      /groupMeetingsForReading\(/,
      `${file} does not group its meetings`,
    );
    assert.match(
      source,
      /attributionNotesFor\(/,
      `${file} does not collapse its repeated attribution`,
    );
    // The notes are built from the GROUPS in group order, never from the raw
    // input — markers must match what the reader sees top to bottom.
    assert.match(
      source,
      /attributionNotesFor\(\s*\n?\s*groups\.flatMap/,
      `${file} builds its markers from an order the reader does not see`,
    );
  }
});

test("F01 3.2: the venue row no longer prints the jurisdiction on every meeting", () => {
  const source = readFileSync(
    join(ROOT, "components", "map", "meeting-panel.tsx"),
    "utf8",
  );
  const entry = source.slice(source.indexOf("function MeetingEntry"));
  assert.ok(
    !/\{meeting\.jurisdiction\}/.test(entry),
    "the per-row jurisdiction line is back",
  );
  assert.ok(
    !/\{meeting\.provenance\.sourceOrg\}/.test(entry),
    "the per-row source-org line is back",
  );
  // But the per-row provenance that genuinely varies stays on the row.
  assert.match(entry, /meeting\.provenance\.secondHand/);
  assert.match(entry, /meeting\.carried/);
});
