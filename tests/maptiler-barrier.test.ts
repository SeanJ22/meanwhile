import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";

import { launchGuarded } from "../scripts/browser.mts";
import { MAPTILER, PROVIDER_ACCESS_VAR, PROVIDER_CEILING_VAR } from "../lib/ops/provider-access.ts";
import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";

/**
 * No request in this file can reach MapTiler: every browser maps `*.maptiler.com` to a local server this test
 * owns, and the key is a valid-shaped literal that is nobody's key. The local server is both the blackhole and
 * the instrument: a hit on it proves a request left the browser.
 */

/** Valid-shaped and owned by nobody. Never a real key, in a file or in a report. */
const LOOKS_LIKE_A_KEY = "AAAAAAAAAAAAAAAAAAAA";

/** What the app's own `lib/map/style.ts` builds, in shape. */
const STYLE_PATH = `/maps/basic-v2-dark/style.json?key=${LOOKS_LIKE_A_KEY}`;

interface Landed {
  readonly host: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The page under test asks for the provider style from script and counts its requests. `http:` so a landed
 * request is served rather than dying in a TLS handshake; the barrier is scheme-agnostic.
 */
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>barrier</title>
<script>
  window.__attempts = 0;
  window.ask = async function (n) {
    const results = [];
    for (let i = 0; i < n; i += 1) {
      window.__attempts += 1;
      try {
        const r = await fetch("http://api.maptiler.com${STYLE_PATH}&n=" + i, { cache: "no-store" });
        results.push("status:" + r.status);
      } catch (e) {
        results.push("threw:" + (e && e.message ? e.message : "unknown"));
      }
    }
    return results;
  };
</script>`;

async function serve(landed: Landed[]): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").split(":")[0];
    if (host === "maptiler.com" || host.endsWith(".maptiler.com")) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      landed.push({ host, url: req.url ?? "", headers });
      req.resume();
      res
        .writeHead(200, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        })
        .end(JSON.stringify({ version: 8, layers: [] }));
      return;
    }
    // The explicit local proxy also receives Chromium background requests.
    // Sink them locally; only provider requests belong in this instrument.
    if (host !== "127.0.0.1" && host !== "localhost") {
      req.resume(); res.writeHead(204).end(); return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, port: address.port };
}

/** Every MapTiler host resolves to the local server, whatever the barrier does. */
function blackhole(port: number) {
  return {
    args: [`--host-resolver-rules=MAP *.maptiler.com 127.0.0.1:${port},MAP maptiler.com 127.0.0.1:${port}`],
    // Managed browsers may proxy HTTP before applying DNS rules. Send every
    // third-party request to our instrument explicitly; it never forwards.
    proxy: { server: `http://127.0.0.1:${port}`, bypass: "127.0.0.1,localhost" },
  };
}

/** Set an env var for one test and put it back, whatever happens. */
function withEnv(t: { after: (fn: () => void) => void }, name: string, value: string | undefined): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("THE PLANT: a guarded synthetic browser with a configured key does reach MapTiler", async (t) => {
  // The open-barrier control: if this stops landing, the assertions below measure nothing.
  const landed: Landed[] = [];
  const { server, port } = await serve(landed);
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });

  withEnv(t, PROVIDER_ACCESS_VAR, MAPTILER);
  const browser = await launchGuarded({
    label: "maptiler-barrier-plant",
    spendsProviderQuota: MAPTILER,
    ...blackhole(port),
  });
  t.after(() => browser.close());

  const page = await browser.page();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate("window.ask(1)");

  assert.equal(await page.evaluate("window.__attempts"), 1, "the page must have asked once");
  assert.equal(
    landed.length,
    1,
    "the plant did not land: with the barrier open, a guarded browser must still reach the " +
      "provider — otherwise this file proves nothing about the barrier",
  );
  assert.equal(landed[0].host, "api.maptiler.com", "the request must be addressed to the provider");
  assert.equal(browser.provider.spent, 1, "the run ledger must record the request it let out");
  assert.equal(browser.provider.blocked, 0);

  // The run marker never crosses to a third-party host.
  assert.equal(
    landed[0].headers[SYNTHETIC_RUN_HEADER],
    undefined,
    "our run identifier must never travel to a third-party host",
  );
});

test("THE BARRIER: the same page, the same key, and nothing reaches the provider", async (t) => {
  const landed: Landed[] = [];
  const { server, port } = await serve(landed);
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });

  // The environment still opts in; without the launch option, nothing is spent.
  withEnv(t, PROVIDER_ACCESS_VAR, MAPTILER);
  const browser = await launchGuarded({ label: "maptiler-barrier", ...blackhole(port) });
  t.after(() => browser.close());

  const page = await browser.page();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  const results = (await page.evaluate("window.ask(3)")) as string[];

  assert.equal(await page.evaluate("window.__attempts"), 3, "the page must still have asked");
  assert.equal(
    landed.length,
    0,
    `${landed.length} request(s) reached the provider host from a normal guarded run`,
  );
  assert.equal(browser.provider.blocked, 3, "every attempt must be recorded as blocked");
  assert.equal(browser.provider.spent, 0, "a normal run spends nothing");
  assert.equal(browser.provider.policy.mode, "BLOCKED");
  assert.deepEqual([...browser.provider.hosts], ["api.maptiler.com"]);

  // The page sees a network failure, the same as an offline reader.
  for (const r of results) {
    assert.match(r, /^threw:/, `the page must see a failed request, saw ${r}`);
  }
});

test("the environment alone cannot open the barrier, and neither can the option alone", async (t) => {
  const landed: Landed[] = [];
  const { server, port } = await serve(landed);
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });

  withEnv(t, PROVIDER_ACCESS_VAR, undefined);
  const browser = await launchGuarded({
    label: "maptiler-barrier-half-open",
    spendsProviderQuota: MAPTILER,
    ...blackhole(port),
  });
  t.after(() => browser.close());

  const page = await browser.page();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate("window.ask(1)");

  assert.equal(browser.provider.policy.mode, "REFUSED_NOT_OPTED_IN");
  assert.equal(landed.length, 0, "a launch that asked, in a process that never said, must not spend");
  assert.equal(browser.provider.blocked, 1);
});

test("the ceiling is hard, and a run that blows it fails rather than reporting a result", async (t) => {
  const landed: Landed[] = [];
  const { server, port } = await serve(landed);
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });

  withEnv(t, PROVIDER_ACCESS_VAR, MAPTILER);
  withEnv(t, PROVIDER_CEILING_VAR, "2");
  const browser = await launchGuarded({
    label: "maptiler-barrier-ceiling",
    spendsProviderQuota: MAPTILER,
    ...blackhole(port),
  });

  const page = await browser.page();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate("window.ask(5)");

  assert.equal(browser.provider.policy.ceiling, 2);
  assert.equal(landed.length, 2, "exactly the ceiling may leave — no more, and not fewer");
  assert.equal(browser.provider.spent, 2);
  assert.equal(browser.provider.refused, 3);
  assert.equal(browser.provider.exceeded, true);

  await assert.rejects(
    () => browser.close(),
    /ceiling|CEILING/,
    "a run that exceeded its ceiling must end loudly — a silent overspend is the whole defect",
  );
});
