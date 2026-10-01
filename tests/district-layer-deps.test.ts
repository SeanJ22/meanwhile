import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOOR = readFileSync(
  join(ROOT, "components", "map", "door-overlay.tsx"),
  "utf8",
);

test("M139: the districts door renders two sections, never one wearing both names", () => {
  /*
    Sub-item 3. The door used to be either/or — the governing set at an
    address, the drawn set everywhere else — so two different claims shared
    one heading depending on where the reader stood. They are now two
    sections with a rule between them and a count each.
  */
  assert.match(DOOR, /heading="Districts you're in"/, "the governing section is gone");
  assert.match(DOOR, /heading="Districts in view"/, "the drawn section is gone");
  assert.match(
    DOOR,
    /border-t border-\[var\(--panel-border\)\]/,
    "the dividing line between the two sections is gone",
  );
});

test("M139: a zip never claims to know which districts the reader is in", () => {
  /*
    The row's own wording for the first section was "Districts in this zip",
    and that is the one thing deliberately not built. A ZCTA crosses city,
    county and school lines, so a centroid can sit in a different town than
    the reader — `deriveStatsView` already settles this and CLAUDE.md's entry
    rule settles it above that. The section is gated on a resolved ADDRESS and
    renders a named gap otherwise.
  */
  /*
    Scanned with COMMENTS STRIPPED. The component explains at length why this
    phrasing was not built, quoting the row's own wording to do it — so a scan
    of the raw file finds the phrase in the very paragraph forbidding it, and
    the first run of this test failed against a correct file for exactly that
    reason. What must not exist is the rendered string, not the discussion.
  */
  const code = DOOR.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  assert.ok(
    !/Districts in this zip/i.test(code),
    "a heading claims the districts of a zip — a ZCTA crosses city, county and " +
      "school lines, so that is a district claim a zip cannot support",
  );
  assert.match(
    DOOR,
    /atAddress && coverage/,
    "the governing rows are no longer gated on a resolved address",
  );
  assert.match(
    DOOR,
    /A zip code crosses city, county and school district lines/,
    "the honest gap line for the no-address case is gone — absence must be " +
      "named as ours, never rendered as an empty list that reads as a finding",
  );
});

test("M139: a section with no answer shows no number, rather than a zero", () => {
  /*
    "We can't tell you from a zip" and "the answer is none" are different
    sentences, and a 0 beside a heading says the second one.
  */
  assert.match(
    DOOR,
    /\{count !== null && \(/,
    "the door section renders its count unconditionally — a null count must " +
      "render no number at all, not 0",
  );
});
