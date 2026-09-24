import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";

// C21 (2026-09-24). Netlify starts Next as a full server, so Next's default
// preload requires every route's server code before a cold instance answers
// its first request. The reason and the measurements sit beside the setting in
// next.config.ts; this keeps the setting from leaving quietly.
test("a cold server instance loads only the route it was asked for: Next's preload of every route stays off", () => {
  assert.equal(nextConfig.experimental?.preloadEntriesOnStart, false);
});
