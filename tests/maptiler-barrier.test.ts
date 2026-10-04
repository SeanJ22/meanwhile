import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";

import { launchGuarded } from "../scripts/browser.mts";
import { MAPTILER, PROVIDER_ACCESS_VAR, PROVIDER_CEILING_VAR } from "../lib/ops/provider-access.ts";
import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";

/**
 * **THE BARRIER IS PROVEN BY RUNNING IT** (MAPQ-1 and MAPQ-8, 2026-09-07).
 *
 * ## The measurement this exists to stop repeating
 *
 * The first MapTiler billing period closed at **101,863 requests against a
 * 100,000-request free allowance** while public readership was tiny. The
 * strongest correlation in the repository is dated: `lib/ops/origin-confinement.ts`
 * records that on 2026-08-22 our own run-marker header stopped breaking
 * MapTiler's CORS preflight, so synthetic browser sessions could reach the
 * provider again — and provider traffic rose from there. Every capture, walk
 * and local browser test carrying the real public key was spending the real
 * allowance. **"Local" is not evidence of "offline".**
 *
 * ## The plant, and why it is not a raw browser
 *
 * `tests/beacon-guard.test.ts` proves its guard by building an UNGUARDED
 * context that genuinely leaks. That shape is wrong here, because the
 * pre-repair class was never about an unguarded context: **a fully guarded
 * synthetic browser, with a configured key, reached MapTiler.** So the plant
 * is the guarded browser itself with the barrier opened — the exact code path
 * that produced the bill — and the assertion is that the request LANDS. Then
 * the same page, the same key and the same harness with the barrier at its
 * default is asserted to land nothing. One difference between the two runs,
 * and it is the thing this session added.
 *
 * ## No request in this file can reach MapTiler, twice over
 *
 * A test that proves a quota barrier must not spend quota proving it, and a
 * regression in the barrier must not turn this file into a leak of its own.
 *
 *   1. Every browser here launches with `--host-resolver-rules` mapping
 *      `*.maptiler.com` at a local server this test owns. There is no route out
 *      of the process to the real provider even if the barrier is deleted.
 *   2. The key in the URL is a fixed literal that is not, and has never been,
 *      anybody's key. It is valid-SHAPED, which is what the acceptance row asks
 *      for — the point is that a configured-looking key does not get through.
 *
 * The local server is therefore both the blackhole and the instrument: a hit on
 * it is positive proof that a request left the browser, and its silence is
 * positive proof that one did not. That is a stronger observation than reading
 * an error string, because "blocked" and "never attempted" produce the same
 * silence at the network and must not be confused for one another — so the
 * count of requests the PAGE issued is asserted separately, from the browser
 * side, and it is non-zero in every case below.
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
 * The page under test: it asks for the provider style exactly as MapLibre
 * would, from script, and reports how many requests it issued.
 *
 * `http:` rather than `https:` so a landed request is served rather than
 * dying in a TLS handshake against a plain server. The barrier is
 * scheme-agnostic by construction (`providerOf` accepts both and
 * `tests/provider-access.test.ts` walks both), so this costs the proof
 * nothing and buys it a positive observation.
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

/**
 * The blackhole. Every MapTiler host resolves to the local server, so nothing
 * in this file can reach the real provider whatever the barrier does.
 */
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
  /*
   * This is the pre-repair class, reproduced exactly and on purpose. If it ever
   * stops landing, the page has stopped asking for a basemap and every
   * assertion below is measuring the wrong thing — so a green "nothing landed"
   * here is a failure, not a pass.
   */
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

  /* RULING 101 still holds under the new ordering: the marker is a fact about
   * our origin and does not cross to a third party, barrier or no barrier. */
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

  /*
   * The environment still says the operator once opted in. That is deliberate:
   * a shell that exported the variable is exactly how a broad visual sweep
   * would silently inherit the ability to spend, and the second gate is what
   * stops it. This run does not ask, so this run does not spend.
   */
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

  /* The page sees a network failure, which is the same thing it sees when a
   * reader is offline — and `components/map/map-canvas.tsx` already answers
   * that by dropping to FALLBACK_STYLE and raising its own notice. */
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
