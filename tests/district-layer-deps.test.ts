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
  /* Two claims, two sections: the governing set at an address and the drawn set, each with its own count. */
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
    A ZCTA crosses city, county and school lines, so the first section is gated on a resolved address and renders a
    named gap otherwise. Scanned with comments stripped: what must not exist is the rendered string.
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
