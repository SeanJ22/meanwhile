import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 1a (2026-08-17): the welcome overlay's mission text is the author's,
 * verbatim. This test pins every sentence so an edit — however
 * well-intentioned — fails the build instead of shipping. The zip entry and
 * the reader's ZIP entry stays beneath it.
 */

const MISSION_SENTENCES = [
  "Whether you care about politics or not, politics cares about you.",
  "Government reports to you.",
  "While you were at work, a data center was approved three miles from your kids' school. While you were at soccer practice, the school board adopted a new AI policy. While you were living an ordinary week, decisions about your next four years got made.",
  "Not in secret. In public, on a schedule, in a room you were allowed to walk into. Nobody told you.",
  "Know where it's happening. Know when it's happening. Show up if you can.",
  "And when you can't — say something anyway.",
];

test("the welcome overlay carries the author's mission text verbatim", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "map", "welcome-overlay.tsx"),
    "utf8",
  );
  // JSX wraps lines and escapes apostrophes; the reader sees the unwrapped,
  // unescaped text, so that is what gets compared.
  const rendered = source.replace(/&apos;/g, "'").replace(/\s+/g, " ");

  for (const sentence of MISSION_SENTENCES) {
    assert.ok(
      rendered.includes(sentence),
      `mission text altered — missing verbatim sentence: "${sentence}"`,
    );
  }
});

test("ZIP and location entry remain, with no hard-coded pilot examples", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "map", "welcome-overlay.tsx"),
    "utf8",
  );
  assert.ok(source.includes("<ZipComb"), "zip entry removed from the overlay");
  assert.ok(source.includes("useMyLocation"), "location entry removed from the overlay");
  assert.doesNotMatch(source, /QUICK_ZIPS|Or start with one of these/, "FE-39 removes the pilot examples");
});
