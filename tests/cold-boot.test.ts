import test from "node:test";
import assert from "node:assert/strict";
import configuration from "../next.config.ts";
const nextConfig = await configuration("phase-test");

test("a cold server instance loads only the route it was asked for: Next's preload of every route stays off", () => {
  assert.equal(nextConfig.experimental?.preloadEntriesOnStart, false);
});
