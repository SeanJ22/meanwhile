import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("the welcome overlay explains the site in one short line", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "map", "welcome-overlay.tsx"),
    "utf8",
  );
  const description = /<p className="welcome-msg">([^<]+)<\/p>/.exec(source)?.[1];
  assert.ok(description && description.length < 120);
  assert.match(description, /government.*meetings/);
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
