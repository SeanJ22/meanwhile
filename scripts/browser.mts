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
} from "playwright";

import { describeChromium, resolveChromium } from "../lib/ops/chromium-pin.ts";
import { makeRunId, syntheticRunHeaders, SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { confine } from "../lib/ops/origin-confinement.ts";

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
  const { label, now, ...launchOptions } = options;
  const runId = runIdFor(label, now);
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
    await context.route("**/*", async (route) => {
      const request = route.request();
      const decision = confine(request.url(), request.frame().url(), request.headers(), headers);
      if (decision.verdict === "SAME_ORIGIN_KEPT") {
        await route.continue();
        return;
      }
      await route.continue({ headers: decision.headers });
    });

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
    context: guardedContext,
    async page(contextOptions?: BrowserContextOptions): Promise<Page> {
      const context = await guardedContext(contextOptions);
      return context.newPage();
    },
    close: () => browser.close(),
  };
}
