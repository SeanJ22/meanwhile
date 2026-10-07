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

test("SRC-1: identical rows credit ONE source, and it is named verbatim", () => {
  const rows = [
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
    meeting("Tucson Unified School District, AZ", "TUSD Governing Board"),
  ];
  const credit = sourceCreditFor(rows);
  assert.equal(credit.kind, "single");
  assert.equal(credit.lead, "These were sourced from TUSD Governing Board.");
  // The single form names its source in the sentence, so the list beneath is empty.
  assert.deepEqual(credit.sources, []);
});

test("SRC-1: one sitting reads 'This was', never 'These were'", () => {
  const credit = sourceCreditFor([meeting("Tucson, AZ", "City Clerk")], 1);
  assert.equal(credit.lead, "This was sourced from City Clerk.");
});

test("SRC-2: more than one source is the author's sentence plus the list", () => {
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

test("F01 3.1: every meetings list renders the three groups, not a raw array", () => {
  // Reads the surfaces themselves so a new one cannot render `.map` over an unordered list.
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
    // The credit is built from the groups in group order, the order the reader met them.
    assert.match(
      source,
      /sourceCreditFor\(\s*\n?\s*groups\.flatMap/,
      `${file} builds its credit from an order the reader does not see`,
    );
  }
});

test("SRC-1: no meeting surface prints a footnote marker on a row", () => {
  // No inline footnote marker or marker block may come back on any card surface.
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
