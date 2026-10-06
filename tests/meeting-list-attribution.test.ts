import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  numberWord,
  sourceCreditFor,
} from "../lib/meetings/list-attribution.ts";

const ROOT = process.cwd();

const meeting = (jurisdiction: string, sourceOrg: string) => ({
  jurisdiction,
  provenance: { sourceOrg } as { sourceOrg: string },
});

/* ------------------------------------------------------------------------
 * SRC-1 / SRC-2 / SRC-3 (2026-08-24) — ONE SOURCE LINE, ZERO INLINE MARKERS.
 *
 * WHAT LEFT THIS FILE, STATED RATHER THAN LET VANISH (RULING 62). The four
 * F01 3.2 guards that pinned the FOOTNOTE MARKER system are gone, because the
 * behaviour they protected is the behaviour the author struck out:
 *
 *   - "one note per DISTINCT attribution, not one per row"   -> replaced below
 *     by the same distinctness claim asserted on `sourceCreditFor`.
 *   - "two bodies at one venue get two markers, in render order"  -> DELETED.
 *     There are no markers. The two-source case is asserted below as a LIST
 *     at the foot instead.
 *   - "a meeting from outside the list gets NO marker"       -> DELETED with
 *     `markerFor`, which no longer exists.
 *   - "the marker set never runs out and never collides"     -> DELETED with
 *     `attributionMarker`, which no longer exists.
 *
 * The two F01 3.1 guards (every list groups; the row prints no per-row
 * jurisdiction or source org) SURVIVE below, updated to the new function
 * names. They were never about markers.
 * ---------------------------------------------------------------------- */

test("SRC-1: identical rows credit ONE source, and it is named verbatim", () => {
  const rows = [
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
  ];
  const credit = sourceCreditFor(rows);
  assert.equal(credit.kind, "single");
  assert.equal(credit.lead, "These were sourced from TUSD Governing Board.");
  // The single form names its source in the sentence, so the list beneath is
  // empty — printing it twice is the repetition this exists to remove.
  assert.deepEqual(credit.sources, []);
});

test("SRC-1: one sitting reads 'This was', never 'These were'", () => {
  const credit = sourceCreditFor([meeting("Tucson, AZ", "City Clerk")], 1);
  assert.equal(credit.lead, "This was sourced from City Clerk.");
});

test("SRC-2: more than one source is the author's sentence plus the list", () => {
  // Tucson splits city and school meetings at one address, which is why the
  // multi-source form has to exist at all.
  const school = meeting("Tucson Unified School District, AZ", "TUSD Governing Board");
  const city = meeting("Tucson, AZ", "City Clerk");
  const credit = sourceCreditFor([school, city, school]);
  assert.equal(credit.kind, "multi");
  assert.equal(
    credit.lead,
    "We sourced this information from these two sources:",
  );
  // Verbatim, in first-appearance order — the order the reader met them in.
  assert.deepEqual(credit.sources, [
    {
      jurisdiction: "Tucson Unified School District, AZ",
      sourceOrg: "TUSD Governing Board",
    },
    { jurisdiction: "Tucson, AZ", sourceOrg: "City Clerk" },
  ]);
});

test("SRC-2: the author's own example wording — 'these three sources'", () => {
  const credit = sourceCreditFor([
    meeting("Rockaway Township, NJ", "Rockaway Township"),
    meeting("Rockaway Township, NJ", "Rockaway Township Board of Adjustment"),
    meeting("Rockaway Township, NJ", "Rockaway Township Planning Board"),
  ]);
  assert.equal(
    credit.lead,
    "We sourced this information from these three sources:",
  );
  assert.equal(credit.sources.length, 3);
});

test("SRC-1: nothing to credit renders NOTHING, never a placeholder", () => {
  const credit = sourceCreditFor([]);
  assert.equal(credit.kind, "none");
  assert.equal(credit.lead, "");
  assert.deepEqual(credit.sources, []);
});

test("small counts read as words in the sentence, large ones as digits", () => {
  assert.equal(numberWord(2), "two");
  assert.equal(numberWord(3), "three");
  assert.equal(numberWord(10), "ten");
  assert.equal(numberWord(11), "11");
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
      /sourceCreditFor\(/,
      `${file} does not credit its sources in one line`,
    );
    // The credit is built from the GROUPS in group order, never from the raw
    // input — the sources must be named in the order the reader met them.
    assert.match(
      source,
      /sourceCreditFor\(\s*\n?\s*groups\.flatMap/,
      `${file} builds its credit from an order the reader does not see`,
    );
  }
});

test("SRC-1: no meeting surface prints a footnote marker on a row", () => {
  // The author put a red arrow on a bare `*` floating between two meetings
  // (`11-59-24`) and red-boxed the whole marker block at the foot of a
  // Rockaway card (`12-24-03`). Neither may come back on any card surface.
  for (const file of [
    "components/map/meeting-panel.tsx",
    "components/map/popup/entity-modal.tsx",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.ok(
      !/markerFor\s*\(/.test(source),
      `${file} is printing per-row source markers again`,
    );
    assert.ok(
      !/attributionMarker\s*\(/.test(source),
      `${file} is printing per-row source markers again`,
    );
  }
});

test("F01 3.2: the venue row no longer prints the jurisdiction on every meeting", () => {
  const source = readFileSync(
    join(ROOT, "components", "map", "meeting-panel.tsx"),
    "utf8",
  );
  assert.match(source, /<MeetingRow/);
  const entry = readFileSync(join(ROOT, "components", "ui", "meeting-row.tsx"), "utf8");
  assert.ok(
    !/\{meeting\.jurisdiction\}/.test(entry),
    "the per-row jurisdiction line is back",
  );
  assert.ok(
    !/\{meeting\.provenance\.sourceOrg\}/.test(entry),
    "the per-row source-org line is back",
  );
  // Metadata that varies by sitting remains in its retained Sources.
  assert.match(readFileSync(join(ROOT, "components/officials/card-sources-list.tsx"), "utf8"), /entry\.provenance\.secondHand/);
  assert.match(readFileSync(join(ROOT, "lib/officials/card-sources.ts"), "utf8"), /meeting\.carried/);
});
