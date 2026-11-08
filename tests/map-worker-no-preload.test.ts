import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("the map worker is fetched only by the Worker that runs it, never by an unused head preload", () => {
  const layout = readFileSync(join(import.meta.dirname, "..", "app", "layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /maplibre-gl-worker/, "a <link rel=preload> for a module Worker is never reused and the browser warns it went unused");
});
