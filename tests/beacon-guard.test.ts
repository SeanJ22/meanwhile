import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

import { launchGuarded } from "../scripts/browser.mts";
import { markerFromRequest } from "../lib/db/run-marker.ts";

/**
 * R50: THE GUARD IS PROVEN BY RUNNING IT (2026-08-18, g16).
 *
 * ## Why the previous guard could not have caught either leak
 *
 * `tests/run-marker-coverage.test.ts` (deleted with this file's arrival) asserted that a browser script MENTIONED
 * `syntheticRunHeaders` in its source. Every script that leaked mentioned it.
 * The header was real and it was sent — on `fetch`. The leak was
 * `navigator.sendBeacon` AT UNLOAD, which Playwright's `extraHTTPHeaders` do
 * not reach, so the transport that carried our rows carried no declaration and
 * the store recorded seven rows (g14) and then forty-four (g15) as READER
 * signal. (R50 read this as "sendBeacon bypasses the header" full stop, which
 * is one step too broad — see the fixture's note below for the measurement.)
 *
 * A source-level assertion cannot see a transport. This one does not try:
 * it opens a real browser through the shared construction site, makes a page
 * fire the exact transport `lib/log/client.ts` prefers, and asks
 * `markerFromRequest` — the production function that decides a row's class —
 * what the request that arrived would be recorded as.
 *
 * ## Why it lands against a local server rather than production
 *
 * The row this proves is a row in `search_log`, and writing one to production
 * to prove it would add exactly the pollution the guard exists to prevent —
 * with no sanctioned write path to remove it afterwards (R43). So the request
 * lands here, and the CLASSIFICATION is computed by the same function the
 * route calls. What is asserted is the whole causal chain minus the INSERT:
 * transport → headers on the wire → `markerFromRequest` → run class.
 *
 * ## The plant
 *
 * A guard that returns "no leak" proves nothing until it has been shown
 * detecting one. So the same page is driven twice: once through
 * `launchGuarded`, and once through a context built the way every unguarded
 * script built one — `extraHTTPHeaders` and nothing else. The second is
 * asserted to leak. If it ever stops leaking, this test is measuring the wrong
 * thing and says so.
 */

const RUN_ID = "beacon-guard-test@2026-08-18T00:00:00.000Z";

/**
 * What `lib/log/client.ts` does, in a page: beacon if there is one, else fetch.
 *
 * `fire()` is called directly, and the same call is also registered on
 * `pagehide` — because WHEN the beacon leaves is the whole mechanism. Measured
 * 2026-08-18 against Playwright's own network stack: a beacon fired while the
 * page is alive DOES carry `extraHTTPHeaders`; a beacon flushed during an
 * unload — a reload or a navigation — DOES NOT. That is why the production
 * leak surfaced only once g14's ask checks started reloading the page between
 * questions, and it sharpens R50's original reading: the transport is not
 * unconditionally header-less, the unload path is.
 */
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>beacon</title>
<script>
  window.fire = function () {
    var body = JSON.stringify({ eventType: "SEARCH", ocdIds: [], detail: {} });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
      return "beacon";
    }
    fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      keepalive: true,
    });
    return "fetch";
  };
  addEventListener("pagehide", function () { window.fire(); });
</script>`;

interface Landed {
  transport: string;
  headers: Record<string, string>;
}

/** A stand-in for the route: records what arrived at /api/log. */
async function serve(landed: Landed[]): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/api/log") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      landed.push({ transport: req.headers["content-type"] ?? "", headers });
      req.resume();
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Wait for the row to arrive rather than sleeping at it (R49). */
async function waitForRow(landed: Landed[], ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (landed.length > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("a context from the shared site cannot write an undeclared row", async (t) => {
  const previous = process.env.WTP_RUN_ID;
  process.env.WTP_RUN_ID = RUN_ID;
  const landed: Landed[] = [];
  const { server, origin } = await serve(landed);
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  const browser = await launchGuarded({ label: "beacon-guard-test" });
  t.after(async () => {
    await browser.close();
    if (previous === undefined) delete process.env.WTP_RUN_ID;
    else process.env.WTP_RUN_ID = previous;
  });

  const page = await browser.page();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  // The guard's mechanism, observed rather than assumed: the page must find no
  // sendBeacon to prefer. If this ever reads "beacon", the override stopped
  // working and every assertion below would be about the wrong transport.
  const transport = await page.evaluate("window.fire()");
  assert.equal(
    transport,
    "fetch",
    "the guarded context still exposes navigator.sendBeacon — the override is a no-op again",
  );

  assert.ok(await waitForRow(landed), "no request reached /api/log at all");

  /* THE ROW'S CLASS, computed by the production function rather than by
   * looking for a header by eye. */
  const request = new Request(`${origin}/api/log`, {
    method: "POST",
    headers: landed[0].headers,
  });
  const marker = markerFromRequest(request);
  assert.equal(marker.runClass, "SYNTHETIC", "the landed row would be recorded as a READER");
  assert.equal(marker.runId, RUN_ID, "the row carries no run id to attribute it by");
});

test("an unguarded context leaks — the plant that proves the test can fail", async (t) => {
  const landed: Landed[] = [];
  const { server, origin } = await serve(landed);
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  /* Built exactly as forty unguarded scripts built one: headers, no override.
   * This is the ONLY place outside scripts/browser.mts that may do this, and
   * tests/browser-construction.test.ts only polices scripts/ for that reason. */
  const raw = await chromium.launch();
  t.after(() => raw.close());
  const context = await raw.newContext({
    extraHTTPHeaders: { "x-wtp-synthetic-run": RUN_ID },
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  /* The UNLOAD path, which is the one that leaked in production. Navigating
   * away flushes the queued beacon, and that is the beacon the headers do not
   * reach. A beacon fired while this page is alive would arrive declared and
   * would prove nothing. */
  await page.goto(`${origin}/elsewhere`, { waitUntil: "domcontentloaded" });

  assert.ok(await waitForRow(landed), "no request reached /api/log at all");

  const request = new Request(`${origin}/api/log`, {
    method: "POST",
    headers: landed[0].headers,
  });
  assert.equal(
    markerFromRequest(request).runClass,
    "ORGANIC",
    "the unguarded unload beacon arrived DECLARED — Playwright now applies extraHTTPHeaders " +
      "to an unload-time sendBeacon, which would mean this guard is obsolete and the test " +
      "above is measuring nothing. Check that before deleting anything.",
  );
});

test("the transport this guards is still the one lib/log/client.ts prefers", async () => {
  /* The page fixture above is a copy of the client's transport choice, and a
   * copy goes stale silently. If the client ever stops preferring sendBeacon,
   * the fixture is no longer the thing being guarded. */
  const src = await readFile(join(process.cwd(), "lib", "log", "client.ts"), "utf8");
  assert.match(
    src,
    /navigator\.sendBeacon\)/,
    "lib/log/client.ts no longer prefers sendBeacon — re-read tests/beacon-guard.test.ts's fixture",
  );
});
