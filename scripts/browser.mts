/**
 * THE ONE PLACE A BROWSER IS OPENED (R50, closed 2026-08-18, g16).
 *
 * ## What went wrong twice
 *
 * `lib/log/client.ts` prefers `navigator.sendBeacon`, and Playwright's
 * `extraHTTPHeaders` do not apply to a beacon. So a walk that declared itself
 * on every fetch still wrote undeclared rows the moment a page unloaded with a
 * queued beacon — rows landing ORGANIC, our own robots counted as readers in
 * the store this business sells.
 *
 * It fired twice in two days. Seven rows on 2026-08-18 (g14, walks 7 and 8),
 * then forty-four more (g15). Both times the fix was applied to the contexts
 * that had leaked, and both times the next unguarded context leaked again,
 * because `scripts/` held fifty of them and each one was a fresh chance to
 * forget. Ten were guarded; forty were not.
 *
 * ## Why this file exists rather than a fiftieth copy of the guard
 *
 * A census of instances is not a fix for a class. The construction of a
 * browser context is now a single function, `launchGuarded`, and
 * `tests/browser-construction.test.ts` refuses any other script that calls
 * `chromium.launch`, `browser.newContext` or `browser.newPage` directly. A new
 * script cannot open an unguarded context without deleting a test.
 *
 * ## What the guard actually does, and what it costs
 *
 * 1. Every context carries `x-wtp-synthetic-run` on every request it makes.
 * 2. Every context has `navigator.sendBeacon` overridden to `undefined` before
 *    the first script runs, which forces `lib/log/client.ts` onto its `fetch`
 *    fallback — and fetch carries the header. It is an OVERRIDE, not a
 *    `delete`: g14's first attempt deleted the own-property, `sendBeacon` lives
 *    on `Navigator.prototype`, and the deletion was a no-op that type-checked,
 *    read correctly, and let four more rows through.
 * 3. A run that set no `WTP_RUN_ID` gets one minted here from its label rather
 *    than sending nothing. `syntheticRunHeaders()` returns `{}` for an unset
 *    env, and `{}` means ORGANIC — a silent, total leak available to anyone who
 *    forgot one export. The declaration is no longer optional.
 *
 * 4. Every context is FAIL-CLOSED against external map-provider hosts
 *    (MAPQ-1, 2026-09-07). The first MapTiler billing period closed at 101,863
 *    requests against a 100,000 allowance while public readership was tiny,
 *    and the strongest correlation in this repository is that this harness was
 *    repaired on 2026-08-22 so synthetic sessions could reach MapTiler again.
 *    A local page carrying the real public key spends the real allowance, so
 *    "local" is not evidence of "offline". Opting in takes TWO gates — the
 *    `spendsProviderQuota` option here AND `WTP_PROVIDER_ACCESS` in the
 *    process — and an opted-in run prints that it is spending and is capped.
 *
 * THE COST, STATED RATHER THAN HIDDEN: a run through this file does not
 * exercise the beacon transport at all. That is the right trade — a suite that
 * pollutes the sold store on every run is worse than one that tests a
 * transport one layer down — but it is a trade, and R50 records the
 * alternative that would not need it: teach the marker to travel in the request
 * BODY, which `lib/log/client.ts` already sends, so it survives both
 * transports. That is a change to production code and to the route's trust
 * rules; this is not.
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
 * The init script, as a string rather than a function.
 *
 * `addInitScript` accepts either, but a function is serialised by Playwright
 * and tsx's esbuild transform rewrites named functions through a `__name`
 * helper the page does not have. A string cannot be rewritten.
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
 * The run declaration, planted on `window` before the page's first script.
 *
 * A string for the same reason `KILL_BEACON` is one: tsx's esbuild transform
 * rewrites named functions through a `__name` helper the page does not have.
 * `JSON.stringify` on the id rather than interpolation, so a run id can never
 * close the quote and become page script.
 */
export function declareRun(runId: string): string {
  return `window.__WTP_SYNTHETIC_RUN__ = ${JSON.stringify(runId)};`;
}

export interface GuardedOptions extends LaunchOptions {
  /**
   * What to call this run in the search log when the environment did not say.
   *
   * Required, and required for a reason: an unlabelled run that also has no
   * `WTP_RUN_ID` would have nothing to declare, and the whole point of this
   * file is that there is no path through it that declares nothing.
   */
  label: string;
  /** The clock, passed in so the run id is reproducible in a test. */
  now?: () => Date;
  /**
   * **THE SECOND GATE ON SPENDING A THIRD PARTY'S QUOTA** (MAPQ-2, 2026-09-07).
   *
   * Absent — which is every ordinary run — means the browser cannot reach
   * MapTiler at all, and the app draws the plain-ground fallback it already
   * draws for a reader with no basemap. Present means this launch is asking to
   * spend real money, and it still only spends if the PROCESS also declared
   * `WTP_PROVIDER_ACCESS`. Two gates, because one environment variable
   * exported in a shell would otherwise be inherited by every sweep started in
   * it, and a broad visual sweep silently spending the tile allowance is the
   * defect this whole barrier exists to make impossible.
   *
   * `lib/ops/provider-access.ts` holds the policy and the measurement that
   * produced it.
   */
  spendsProviderQuota?: ExternalProvider;
  /**
   * FE-01: abort, in the browser, every request that would write to the site
   * (`/api/log`, `/api/events`, `/api/reactions`, `/api/feedback`, `/api/ask`,
   * Send posts). Walks of the live site set this, so they read without leaving
   * search-log or Ask rows. Counted on `GuardedBrowser.writesBlocked`.
   */
  blockWrites?: boolean;
}

/**
 * A browser that can only make guarded contexts.
 *
 * The raw Playwright `Browser` is deliberately NOT exposed. Handing it back
 * would restore the exact hole this file closes, one convenience call at a
 * time. A script needing a browser-level API adds it here, where the guard
 * comes with it.
 */
export interface GuardedBrowser {
  /** The run id every context of this browser declares. Print it; name it in reports. */
  readonly runId: string;
  /**
   * What this run has spent, blocked and refused at an external map provider
   * (MAPQ-1). LIVE and shared by every context of this browser: a ceiling that
   * reset per context would be a ceiling a caller could raise by opening
   * another one. Read it at the end of a run and put the numbers in the report.
   */
  readonly provider: ProviderLedger;
  /** Write requests this run aborted (FE-01); zero unless `blockWrites` was set. */
  readonly writesBlocked: { count: number; paths: Set<string> };
  /**
   * Named `context`, not `newContext`, and `page`, not `newPage`.
   *
   * Playwright's own names must stay unmistakable in a diff: the whole guard
   * rests on `tests/browser-construction.test.ts` being able to refuse
   * `browser.newContext(` and `browser.newPage(` outright, and it cannot do
   * that if the guarded API answers to the same words.
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
  const { label, now, spendsProviderQuota, blockWrites, ...launchOptions } = options;
  const writesBlocked = { count: 0, paths: new Set<string>() };
  const runId = runIdFor(label, now);

  /*
   * **THE QUOTA GATE IS DECIDED ONCE, HERE, FOR THE WHOLE RUN** (MAPQ-1/MAPQ-2).
   *
   * The first MapTiler billing period closed at 101,863 requests against a
   * 100,000 allowance while public readership was tiny, and the strongest
   * correlation in this repository is that synthetic browser sessions could
   * reach MapTiler again from 2026-08-22. A local page carrying the real
   * public key spends the real allowance: "local" is not evidence of
   * "offline". So the default is that no browser opened through this file can
   * reach the provider at all, and an opted-in run says so on stdout before it
   * spends a request — a run that quietly costs money is a run nobody can
   * separate from a reader afterwards.
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
   * **`NH91`, item 7, 2026-08-23 — the harness asks the IMAGE what it has.**
   *
   * Playwright 1.62.1 wants Chromium 1234 and this image ships 1194, so three
   * beacon-guard tests died on "Executable doesn't exist" and Playwright's
   * own advice — run `playwright install` — is unreachable here: the browser
   * CDN is not on this machine's egress.
   *
   * So the pinned build is used where it exists, another complete Chromium is
   * used by explicit path where it does not, and the substitution is PRINTED
   * rather than absorbed. `ABSENT` throws with the directory it searched:
   * a run that cannot open a browser must fail loudly and may never read as a
   * skip. `lib/ops/chromium-pin.ts` holds the pin and the reasoning.
   */
  const resolved = resolveChromium();
  if (resolved.kind === "ABSENT") throw new Error(describeChromium(resolved));
  if (resolved.kind === "SUBSTITUTED") console.warn(`  ${describeChromium(resolved)}`);

  const browser: Browser = await chromium.launch({
    ...launchOptions,
    ...(resolved.kind === "SUBSTITUTED" ? { executablePath: resolved.executablePath } : {}),
  });

  async function guardedContext(contextOptions: BrowserContextOptions = {}): Promise<BrowserContext> {
    const context = await browser.newContext({
      ...contextOptions,
      // The caller's headers are kept, and the marker is not one a caller may
      // overwrite: it goes on last.
      extraHTTPHeaders: { ...contextOptions.extraHTTPHeaders, ...headers },
    });
    /**
     * **THE MARKER GOES TO OUR ORIGIN AND NOWHERE ELSE.**
     * (`VF02`, NJ Hunt 6, 2026-08-22.)
     *
     * `extraHTTPHeaders` applies to EVERY request the context makes, third
     * parties included. MapTiler's CORS preflight does not allow
     * `x-wtp-synthetic-run`, so the style request was refused **and the basemap
     * failed in every capture and every walk this repo has ever taken**:
     *
     * ```
     * Access to fetch at 'https://api.maptiler.com/maps/.../style.json'
     * has been blocked by CORS policy: Request header field
     * x-wtp-synthetic-run is not allowed by Access-Control-Allow-Headers
     * ```
     *
     * That is why NJ Hunt 5's captures showed *Basemap unavailable* on a
     * production site that was serving readers a working map, and why 371 walk
     * checks and every DOM assertion disagreed with the photographs. **The
     * instrument was breaking the thing it was measuring.** A reader never sent
     * that header and never saw that failure.
     *
     * It is also a leak worth naming on its own: our run identifier was being
     * handed to every third-party host the page touched.
     *
     * The marker exists to declare rows written to OUR log, so our origin is
     * the only place it belongs. Same-origin requests pass through untouched
     * and keep it; cross-origin requests have it stripped.
     */
    /*
     * **The decision itself lives in `lib/ops/origin-confinement.ts`**
     * (RULING 101, 2026-08-23), because four lines inside a harness are
     * REMEMBERED rather than ENFORCED: nothing failed if they were deleted,
     * and nothing could test them without launching a browser.
     *
     * `confine` is a pure function over (requestUrl, frameUrl, headers), so
     * `tests/origin-confinement.test.ts` walks it across every third-party
     * host this product's pages actually reach and states the denominator.
     */
    /*
     * `request.frame()` THROWS for a request issued before its frame exists.
     *
     * Playwright says so in as many words: *"Frame for this navigation request
     * is not available, because the request was issued before the frame is
     * created."* It happens on a navigation a click starts, and it killed a
     * capture run on 2026-08-24 — the crash surfaced in a screenshot script and
     * the defect was here, in the shared path every guarded browser in this repo
     * goes through (RULING 103: fix at the shared path, not at the symptom).
     *
     * **The fallback FAILS SAFE, and the decision is still `confine`'s.** With
     * no frame there is nothing to compare an origin against, so the frame url
     * becomes `about:blank` — which cannot match our origin, so `confine`
     * strips. Stripping the headers here by hand would put a second copy of the
     * confinement rule back in the harness, which is precisely what RULING 101
     * moved OUT of this file, and `tests/origin-confinement.test.ts` refuses it.
     */
    const frameUrlOf = (request: { frame: () => { url: () => string } }): string => {
      try {
        return request.frame().url();
      } catch {
        return "about:blank";
      }
    };

    /**
     * **THE MAPTILER BARRIER** (MAPQ-1, 2026-09-07). True when the request was
     * aborted and the caller must stop.
     *
     * The decision itself lives in `lib/ops/provider-access.ts`, for the same
     * reason `confine` does — four lines inside a harness are remembered
     * rather than enforced, and a pure function is one a unit test can walk
     * across every provider host without launching a browser. This is the
     * bookkeeping, and it is a named function rather than an inline block so
     * the route handler below stays one decision followed by another.
     *
     * `route.abort` rather than a fulfilled empty body: MapLibre's `error`
     * handler in `components/map/map-canvas.tsx` already drops the map to
     * `FALLBACK_STYLE` and raises the reader's own "Basemap unavailable"
     * notice on a failed style request, so a blocked request produces the
     * app's EXISTING no-basemap behaviour. Overlays, markers, popups, district
     * layers and layout all keep rendering, which is what keeps the visual
     * suite testable while the quota stays ours.
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
        /* Loud at the moment of the breach, and again from close(): a ceiling
         * only reported at the end is a ceiling a run can blow through while
         * its operator watches it look fine. */
        if (!provider.exceeded) console.error(`\n  !! ${spend.says}\n`);
        provider.exceeded = true;
      } else {
        provider.blocked += 1;
      }
      await route.abort("blockedbyclient");
      return true;
    };

    await context.route("**/*", async (route) => {
      const request = route.request();
      // MAPQ-1 first: a request that is not going to leave needs no headers.
      if (await refusedByBarrier(route)) return;
      const decision = confine(request.url(), frameUrlOf(request), request.headers(), headers);
      if (decision.verdict === "SAME_ORIGIN_KEPT") {
        await route.continue();
        return;
      }
      await route.continue({ headers: decision.headers });
    });

    /* FE-01: registered after the route above, so it runs first (Playwright
     * runs the latest route first); `fallback` hands everything else on. */
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

    await context.addInitScript(KILL_BEACON);
    /*
     * ITEM 4b (g17): the declaration in the page, so it can ride in the BODY.
     *
     * `KILL_BEACON` above forces the fetch fallback, where the header arrives.
     * That is a workaround for a transport, and R50 recorded its cost in its
     * own header: a guarded run never exercises the beacon path, so nothing
     * proves it. This closes the gap at the source instead — `lib/log/client.ts`
     * copies this global into the request body, and no transport strips a body.
     *
     * Both stay. The override keeps a context safe if the body path ever
     * regresses; the body marker keeps a row declared if the override ever
     * becomes a no-op again, which is exactly what happened in g14 when a
     * `delete` was used on a prototype method.
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
     * **A RUN THAT BLEW ITS CEILING ENDS NON-ZERO** (MAPQ-2).
     *
     * The browser is closed FIRST and the throw comes after, so a breach never
     * leaks a Chromium process. The throw is the loud half of "fails loudly":
     * the banner at the moment of the breach can scroll off a long run's
     * output, and a script whose ceiling was decorative would otherwise report
     * success. Every ordinary run reaches this line with `exceeded` false and
     * nothing changes for it.
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
 * **SEED THE ZIP BEFORE THE FIRST PAINT.** (Extracted 2026-08-25 under RULING
 * 103, after `pnpm dupes` caught two copies of it in two shooters written the
 * same evening.)
 *
 * `?zip=` does NOT seed the app: the map entry renders its welcome overlay and
 * every capture behind it is a photograph of the overlay. The zip lives in
 * `sessionStorage` under `wtp.approximate_location`, in the shape
 * `use-stored-zip` writes, so it has to be there before the page runs.
 *
 * **This is a rung, which is why it is here rather than copied a third time.**
 * A previous session used the WRONG KEY and reported four layout items correct
 * while photographing the welcome card — every selector found what it was
 * looking for, because the rail renders underneath. The tutorial flag is
 * seeded alongside it: the first-run tour is its own check, not a thing every
 * other capture has to dismiss.
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
