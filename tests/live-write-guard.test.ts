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

const HARNESSES = ["walk-all", "visual-suite", "reader-suite", "admin-walk"] as const;

test("FE-01: the four harnesses read a live target instead of refusing it, with writes aborted", async () => {
  for (const name of HARNESSES) {
    const src = await readFile(new URL(`../scripts/${name}.mts`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /REFUSED — the target|refuses \$\{BASE\}|process\.exit\(1\);\n  \}\n\}\n/, name);
    assert.match(src, /const LIVE_TARGET = !isLocalBase\(BASE\);/, name);
    assert.match(src, /launchGuarded\(\{[^}]*blockWrites: LIVE_TARGET[^}]*\}\)/, name);
  }
});

test("FE-01: a guarded browser lets reads through and stops every write before it leaves", async () => {
  const { createServer } = await import("node:http");
  const { launchGuarded } = await import("../scripts/browser.mts");
  const arrived: string[] = [];
  const server = createServer((req, res) => {
    arrived.push(`${req.method} ${req.url}`);
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>t</title>");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const browser = await launchGuarded({ label: "fe01-test", headless: true, blockWrites: true });
  try {
    const page = await browser.page();
    await page.goto(`${base}/`);
    const outcomes = await page.evaluate(async () => {
      const tries: [string, string][] = [
        ["/api/meetings?zip=00000", "GET"],
        ["/api/log", "POST"],
        ["/api/events", "POST"],
        ["/api/reactions", "POST"],
        ["/api/feedback", "POST"],
        ["/api/ask", "GET"],
        ["/api/ask/grounded", "POST"],
        ["/api/speak", "POST"],
      ];
      const out: Record<string, boolean> = {};
      for (const [path, method] of tries) {
        try {
          await fetch(path, method === "POST" ? { method, body: "{}" } : { method });
          out[path] = true;
        } catch {
          out[path] = false;
        }
      }
      return out;
    });
    assert.equal(outcomes["/api/meetings?zip=00000"], true, "a read reaches the site");
    for (const path of ["/api/log", "/api/events", "/api/reactions", "/api/feedback", "/api/ask", "/api/ask/grounded", "/api/speak"]) {
      assert.equal(outcomes[path], false, `${path} was aborted in the browser`);
    }
    const writesArrived = arrived.filter((r) => !r.startsWith("GET /api/meetings") && r !== "GET /" && !r.startsWith("GET /favicon"));
    assert.deepEqual(writesArrived, [], "no write reached the server");
    assert.equal(browser.writesBlocked.count, 7);
  } finally {
    await browser.close();
    server.close();
  }
});
