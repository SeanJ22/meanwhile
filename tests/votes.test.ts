import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

test("the popup legend speaks of their vote, never our approval", () => {
  const source = readFileSync(
    join(ROOT, "components", "map", "popup", "official-popup.tsx"),
    "utf8",
  );
  assert.ok(
    source.includes("Colors state their vote"),
    "the legend must attribute the colors to the member's vote",
  );
  assert.ok(
    source.includes("never our opinion"),
    "the legend must disclaim endorsement",
  );
});
