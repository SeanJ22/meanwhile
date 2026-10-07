import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { describeChromium, resolveChromium } from "../lib/ops/chromium-pin.ts";

import { declareRun, launchGuarded } from "../scripts/browser.mts";
import {
  markerFromRequest,
  markerFromRequestWithBody,
} from "../lib/db/run-marker.ts";

/** The plants launch Playwright directly to prove the guard can fail; a plant that cannot launch throws with the directory it searched. */
function rawLaunchOptions(): { executablePath?: string } {
  const resolved = resolveChromium();
  if (resolved.kind === "ABSENT") throw new Error(describeChromium(resolved));
  return resolved.kind === "SUBSTITUTED" ? { executablePath: resolved.executablePath } : {};
}

/** The guard is proven by running it: a real browser fires the client's transport and markerFromRequest classifies the request that arrived. A plant driven the unguarded way must leak. Requests land on a local server, never production. */

const RUN_ID = "beacon-guard-test@2026-08-18T00:00:00.000Z";

/** What lib/log/client.ts does in a page: beacon if there is one, else fetch. Fired directly and on pagehide, because an unload-time beacon does not carry extraHTTPHeaders. */
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

/** Wait for the row to arrive rather than sleeping at it. */
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
  /* The plant is build-sensitive: with a substituted Chromium build it reports CANNOT RUN, naming the build. */
  const resolved = resolveChromium();
  if (resolved.kind === "SUBSTITUTED") {
    t.skip(`CANNOT RUN: ${describeChromium(resolved)} — the beacon transport differs by build`);
    return;
  }

  const landed: Landed[] = [];
  const { server, origin } = await serve(landed);
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  /* Built exactly as forty unguarded scripts built one: headers, no override.
   * This is the ONLY place outside scripts/browser.mts that may do this, and
   * tests/browser-construction.test.ts only polices scripts/ for that reason. */
  const raw = await chromium.launch(rawLaunchOptions());
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

/** The leaking path, driven: an unguarded context with the run declared on window; the beacon flushes at unload and markerFrom classifies its body. The header is deliberately absent. */

/** The client's transport choice AND its body, including the declaration. */
const PAGE_HTML_WITH_BODY_MARKER = `<!doctype html><meta charset="utf-8"><title>beacon</title>
<script>
  window.fire = function () {
    var payload = { eventType: "SEARCH", ocdIds: [], detail: {} };
    if (typeof window.__WTP_SYNTHETIC_RUN__ === "string") {
      payload.syntheticRun = window.__WTP_SYNTHETIC_RUN__;
    }
    var body = JSON.stringify(payload);
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

interface LandedWithBody extends Landed {
  body: string;
}

/** The same stand-in, keeping the BODY as well as the headers. */
async function serveWithBody(
  landed: LandedWithBody[],
): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/api/log") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        landed.push({
          transport: req.headers["content-type"] ?? "",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE_HTML_WITH_BODY_MARKER);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test("an UNLOAD beacon carrying no header is still recorded as synthetic", async (t) => {
  const landed: LandedWithBody[] = [];
  const { server, origin } = await serveWithBody(landed);
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  const raw = await chromium.launch(rawLaunchOptions());
  t.after(() => raw.close());
  /* No extraHTTPHeaders and no sendBeacon override: the leaking configuration,
   * with the run declared in the page instead. */
  const context = await raw.newContext();
  await context.addInitScript(declareRun(RUN_ID));
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  /* Nothing is fired while the page is alive — a live beacon would prove
   * nothing, since a live beacon already carried the header. The navigation
   * below is what flushes it, and that flush is the one that leaked in
   * production. */
  await page.goto(`${origin}/elsewhere`, { waitUntil: "domcontentloaded" });

  assert.ok(await waitForRow(landed), "no request reached /api/log at all");

  const request = new Request(`${origin}/api/log`, {
    method: "POST",
    headers: landed[0].headers,
  });
  assert.equal(
    markerFromRequest(request).runClass,
    "ORGANIC",
    "the header arrived after all — this test is no longer measuring the unload path",
  );

  const body = JSON.parse(landed[0].body) as Record<string, unknown>;
  const marker = markerFromRequestWithBody(request, body);
  assert.equal(
    marker.runClass,
    "SYNTHETIC",
    "the unload beacon's row would still be recorded as a READER — the body marker did not survive",
  );
  assert.equal(marker.runId, RUN_ID, "the row carries no run id to attribute it by");
});

test("the shared site plants the declaration, and the client sends it", async () => {
  /* The chain has three links and this test can only run two of them in a
   * browser, so the third is pinned in source: the site must plant the global,
   * and the client must copy it into the body. A page fixture is a COPY of the
   * client's behaviour, and a copy goes stale silently. */
  const site = await readFile(join(process.cwd(), "scripts", "browser.mts"), "utf8");
  assert.match(
    site,
    /addInitScript\(declareRun\(runId\)\)/,
    "the shared site no longer plants the run declaration in the page",
  );

  const client = await readFile(join(process.cwd(), "lib", "log", "client.ts"), "utf8");
  assert.match(
    client,
    /__WTP_SYNTHETIC_RUN__/,
    "lib/log/client.ts no longer reads the planted declaration",
  );
  assert.match(
    client,
    /SYNTHETIC_RUN_BODY_KEY/,
    "lib/log/client.ts no longer puts the declaration in the body under the shared key",
  );

  const route = await readFile(
    join(process.cwd(), "app", "api", "log", "route.ts"),
    "utf8",
  );
  assert.match(
    route,
    /markerFromRequestWithBody\(request, body\)/,
    "/api/log reads the header only again — an unload beacon's declaration would be dropped",
  );
});
