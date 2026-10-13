import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

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
    assert.match(source, /<MeetingSourceCredit/, `${file} does not contribute its sources to the card`);
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
