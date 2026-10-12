import { fulfillPublicSourceRoute } from "../lib/hunt/public-browser.ts";
/**
 * The one place a browser is opened. `launchGuarded` is the only constructor;
 * `tests/browser-construction.test.ts` refuses any other script that calls
 * `chromium.launch`, `browser.newContext` or `browser.newPage` directly.
 *
 * 1. Every context carries `x-wtp-synthetic-run` on requests to our origin.
 * 2. `navigator.sendBeacon` is overridden to `undefined` before the first
 *    script runs (an override, not a `delete`: it lives on the prototype), so
 *    `lib/log/client.ts` falls back to `fetch`, which carries the header.
 *    Playwright's `extraHTTPHeaders` do not apply to a beacon.
 * 3. A run that set no `WTP_RUN_ID` gets one minted from its label; an empty
 *    declaration would read as ORGANIC traffic.
 * 4. Every context is fail-closed against external map-provider hosts: a local
 *    page carrying the real public key spends the real allowance. Opting in
 *    takes two gates (`spendsProviderQuota` here AND `WTP_PROVIDER_ACCESS` in
 *    the process), and an opted-in run prints that it is spending and is capped.
 *
 * The cost: a guarded run never exercises the beacon transport; the run
 * declaration also rides in the request body to cover that path.
 */

import { chromium } from "playwright";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
  Page,
  Route,
} from "playwright";

import { describeChromium, resolveChromium } from "../lib/ops/chromium-pin.ts";
import { makeRunId, syntheticRunHeaders, SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { confine } from "../lib/ops/origin-confinement.ts";
import { isLiveWriteRequest } from "../lib/ops/live-write-guard.ts";
import {
  decideProviderRequest,
  describeLedger,
  newProviderLedger,
  providerHostOf,
  resolveProviderPolicy,
  type ExternalProvider,
  type ProviderLedger,
} from "../lib/ops/provider-access.ts";

/**
 * The init script, as a string rather than a function: tsx's esbuild transform
 * rewrites named functions through a `__name` helper the page does not have.
 */
const KILL_BEACON = `(() => {
  try {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
    });
  } catch {
    // If it cannot be overridden the run still declares itself on every fetch.
  }
})()`;

/**
 * The run declaration, planted on `window` before the page's first script. A
 * string for the same reason as `KILL_BEACON`; `JSON.stringify` on the id so a
 * run id can never close the quote and become page script.
 */
export function declareRun(runId: string): string {
  return `window.__WTP_SYNTHETIC_RUN__ = ${JSON.stringify(runId)};`;
}

export interface GuardedOptions extends LaunchOptions {
  /** What to call this run when the environment did not say. Required: no path may declare nothing. */
  label: string;
  /** The clock, passed in so the run id is reproducible in a test. */
  now?: () => Date;
  /**
   * The second gate on spending a third party's quota. Absent (every ordinary
   * run) means the browser cannot reach MapTiler at all and the app draws its
   * no-basemap fallback. Present still spends only if the process also declared
   * `WTP_PROVIDER_ACCESS`, so an exported shell variable alone cannot make
   * every sweep spend. Policy: `lib/ops/provider-access.ts`.
   */
  spendsProviderQuota?: ExternalProvider;
  /**
   * Abort, in the browser, every request that would write to the site
   * (`/api/log`, `/api/events`, `/api/reactions`, `/api/feedback`, `/api/ask`,
   * Send posts), so live-site walks leave no rows. Counted on
   * `GuardedBrowser.writesBlocked`.
   */
  blockWrites?: boolean;
  /** Public-source browser: fulfill every HTTP request through pinned source transport. */
  publicSourcesOnly?: boolean;
}

/**
 * A browser that can only make guarded contexts. The raw Playwright `Browser`
 * is deliberately not exposed; a script needing a browser-level API adds it
 * here, where the guard comes with it.
 */
export interface GuardedBrowser {
  /** The run id every context of this browser declares. Print it; name it in reports. */
  readonly runId: string;
  /**
   * What this run has spent, blocked and refused at an external map provider.
   * Shared by every context of this browser, so a ceiling cannot be raised by
   * opening another context. Report it at the end of a run.
   */
  readonly provider: ProviderLedger;
  /** Write requests this run aborted; zero unless `blockWrites` was set. */
  readonly writesBlocked: { count: number; paths: Set<string> };
  /**
   * Named `context` and `page`, not `newContext`/`newPage`, so the construction
   * test can refuse Playwright's own names outright.
   */
  context(options?: BrowserContextOptions): Promise<BrowserContext>;
  /** A context and its first page, for the common case of wanting one page. */
  page(options?: BrowserContextOptions): Promise<Page>;
  close(): Promise<void>;
}

/** The run id this process declares: the environment's, or one minted from the label. */
export function runIdFor(label: string, now: () => Date = () => new Date()): string {
  const declared = process.env.WTP_RUN_ID?.trim();
  if (declared) return declared;
  return makeRunId(label, now().toISOString());
}

/**
 * Open a browser whose every context declares itself and cannot beacon.
 *
 * ```ts
 * const browser = await launchGuarded({ label: "walk-all" });
 * const page = await browser.page({ viewport: PHONE });
 * ```
 */
export async function launchGuarded(options: GuardedOptions): Promise<GuardedBrowser> {
  const { label, now, spendsProviderQuota, blockWrites, publicSourcesOnly, ...launchOptions } = options;
  const writesBlocked = { count: 0, paths: new Set<string>() };
  const runId = runIdFor(label, now);

  /*
   * The quota gate is decided once, here, for the whole run: by default no
   * browser opened through this file can reach the provider, and an opted-in
   * run says so on stdout before it spends a request.
   */
  const providerPolicy = resolveProviderPolicy({
    requested: spendsProviderQuota ?? null,
    env: process.env as Record<string, string | undefined>,
  });
  const provider = newProviderLedger(providerPolicy);
  if (providerPolicy.mode === "ALLOWED_BOUNDED") console.log(`  ${providerPolicy.says}`);
  if (providerPolicy.mode === "REFUSED_NOT_OPTED_IN") console.warn(`  ${providerPolicy.says}`);
  const headers = syntheticRunHeaders({ WTP_RUN_ID: runId });
  /* Belt and braces: a header set that somehow lost the marker is a leak with
   * no symptom, so it is refused here rather than discovered in the store. */
  if (!headers[SYNTHETIC_RUN_HEADER]) {
    throw new Error(
      `launchGuarded(${label}): the run marker is empty, so every row this run writes ` +
        "would land ORGANIC. Refusing to open a browser.",
    );
  }

  /*
   * The pinned Chromium build is used where it exists; another complete
   * Chromium is used by explicit path where it does not, and the substitution
   * is printed. `ABSENT` throws with the directory it searched. See
   * `lib/ops/chromium-pin.ts`.
   */
  const resolved = resolveChromium();
  if (resolved.kind === "ABSENT") throw new Error(describeChromium(resolved));
  if (resolved.kind === "SUBSTITUTED") console.warn(`  ${describeChromium(resolved)}`);

  const browser: Browser = await chromium.launch({
    ...launchOptions,
    ...(publicSourcesOnly ? { args: [...(launchOptions.args ?? []), "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"] } : {}),
    ...(resolved.kind === "SUBSTITUTED" ? { executablePath: resolved.executablePath } : {}),
  });

  async function guardedContext(contextOptions: BrowserContextOptions = {}): Promise<BrowserContext> {
    const context = await browser.newContext({
      ...contextOptions,
      ...(publicSourcesOnly ? { serviceWorkers: "block" as const } : {}),
      // The caller's headers are kept, and the marker is not one a caller may
      // overwrite: it goes on last.
      extraHTTPHeaders: { ...contextOptions.extraHTTPHeaders, ...headers },
    });
    /*
     * The marker goes to OUR origin and nowhere else: `extraHTTPHeaders`
     * applies to every request, and third parties (MapTiler's CORS preflight)
     * refuse it — and should never receive our run id anyway. The decision is
     * `confine` in `lib/ops/origin-confinement.ts`, a pure function the tests
     * walk across every third-party host.
     *
     * `request.frame()` throws for a request issued before its frame exists;
     * the fallback frame url is `about:blank`, which cannot match our origin,
     * so `confine` strips (fails safe).
     */
    const frameUrlOf = (request: { frame: () => { url: () => string } }): string => {
      try {
        return request.frame().url();
      } catch {
        return "about:blank";
      }
    };

    /**
     * The MapTiler barrier: true when the request was aborted and the caller
     * must stop. The decision lives in `lib/ops/provider-access.ts`; this is the
     * bookkeeping. `route.abort` makes the map fall back to its existing
     * no-basemap behaviour, so the rest of the page keeps rendering.
     */
    const refusedByBarrier = async (route: Route): Promise<boolean> => {
      const url = route.request().url();
      const spend = decideProviderRequest(url, providerPolicy, provider.spent);
      if (spend.verdict === "NOT_A_PROVIDER") return false;

      provider.hosts.add(providerHostOf(url));
      if (spend.verdict === "ALLOWED_UNDER_CEILING") {
        provider.spent += 1;
        return false;
      }
      if (spend.verdict === "REFUSED_CEILING_EXCEEDED") {
        provider.refused += 1;
        /* Loud at the moment of the breach, and again from close(). */
        if (!provider.exceeded) console.error(`\n  !! ${spend.says}\n`);
        provider.exceeded = true;
      } else {
        provider.blocked += 1;
      }
      await route.abort("blockedbyclient");
      return true;
    };

    const publicRequests = new AbortController();
    context.once("close", () => publicRequests.abort());
    if (publicSourcesOnly) await context.routeWebSocket("**/*", socket => socket.close());

    await context.route("**/*", async (route) => {
      const request = route.request();
      // The provider barrier first: a request that is not going to leave needs no headers.
      if (await refusedByBarrier(route)) return;
      const requestHeaders = publicSourcesOnly ? await request.allHeaders() : request.headers();
      const decision = confine(request.url(), frameUrlOf(request), requestHeaders, headers);
      if (publicSourcesOnly) {
        await fulfillPublicSourceRoute(route, decision.verdict === "SAME_ORIGIN_KEPT" ? requestHeaders : decision.headers, undefined, publicRequests.signal);
        return;
      }
      if (decision.verdict === "SAME_ORIGIN_KEPT") {
        await route.continue();
        return;
      }
      await route.continue({ headers: decision.headers });
    });

    /* Registered after the route above, so it runs first (Playwright runs the
     * latest route first); `fallback` hands everything else on. */
    if (blockWrites) {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (!isLiveWriteRequest(request.url(), request.method())) {
          await route.fallback();
          return;
        }
        writesBlocked.count += 1;
        writesBlocked.paths.add(new URL(request.url()).pathname);
        await route.abort("blockedbyclient");
      });
    }

    if (publicSourcesOnly) await context.addInitScript(`(() => {
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
        try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false }); } catch {}
      }
    })()`);
    await context.addInitScript(KILL_BEACON);
    /*
     * The declaration in the page, so `lib/log/client.ts` can carry it in the
     * request BODY, which no transport strips. Both this and the beacon
     * override stay, each covering the other's failure.
     */
    await context.addInitScript(declareRun(runId));
    return context;
  }

  return {
    runId,
    provider,
    writesBlocked,
    context: guardedContext,
    async page(contextOptions?: BrowserContextOptions): Promise<Page> {
      const context = await guardedContext(contextOptions);
      return context.newPage();
    },
    /**
     * A run that blew its ceiling ends non-zero, after the browser is closed
     * so no Chromium process leaks.
     */
    async close(): Promise<void> {
      await browser.close();
      if (provider.exceeded) {
        throw new Error(
          `launchGuarded(${label}): ${describeLedger(provider)}. The run asked for more ` +
            "external provider quota than it was allowed, so it is a failure, not a result.",
        );
      }
    },
  };
}

/**
 * Seeds the ZIP before the first paint. `?zip=` does not seed the app; the zip
 * lives in `sessionStorage` under `wtp.approximate_location`, in the shape
 * `use-stored-zip` writes. The tutorial flag is seeded too, so captures are not
 * photographs of the welcome overlay or the first-run tour.
 */
export async function seedZip(page: Page, zip: string): Promise<void> {
  await page.addInitScript(
    ({ zip: z }: { zip: string }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        // A browser refusing storage still renders; the capture will show the
        // overlay and the reader of the report will see that it did.
      }
    },
    { zip },
  );
}
