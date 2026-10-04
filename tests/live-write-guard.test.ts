import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isLiveWriteRequest, isLocalBase } from "../lib/ops/live-write-guard.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

test("FE-01: every write route is aborted", () => {
  for (const p of ["/api/log", "/api/events", "/api/reactions", "/api/feedback", "/api/speak"]) {
    assert.equal(isLiveWriteRequest(`https://example.test${p}`, "POST"), true, p);
  }
  assert.equal(isLiveWriteRequest("https://example.test/api/ask/grounded", "POST"), true);
  assert.equal(isLiveWriteRequest("https://example.test/api/ask", "GET"), true);
});

test("FE-01: reads pass", () => {
  assert.equal(isLiveWriteRequest("https://example.test/api/meetings?zip=1", "GET"), false);
  assert.equal(isLiveWriteRequest("https://example.test/api/log", "OPTIONS"), false);
  assert.equal(isLiveWriteRequest("not a url", "POST"), false);
});

test("FE-01: a local base is recognised", () => {
  assert.equal(isLocalBase("http://localhost:3000"), true);
  assert.equal(isLocalBase(PUBLIC_SITE_ORIGIN), false);
});

test("FE-01: launchGuarded applies the guard when asked", async () => {
  const src = await readFile(new URL("../scripts/browser.mts", import.meta.url), "utf8");
  assert.match(src, /if \(blockWrites\)[\s\S]{0,200}isLiveWriteRequest/);
});
