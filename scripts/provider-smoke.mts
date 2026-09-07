/**
 * **THE ONE COMMAND THAT MAY SPEND MAPTILER QUOTA** — `pnpm provider:smoke`
 * (MAPQ-2, 2026-09-07).
 *
 * ## What it is for
 *
 * MAPQ-1 makes every ordinary synthetic browser run fail closed at MapTiler.
 * That is the right default and it has a cost, stated rather than hidden: no
 * ordinary run proves any more that the real style URL, the real key and the
 * real provider still work together. A basemap that quietly stopped resolving
 * would look exactly like a basemap we deliberately blocked.
 *
 * So there is exactly one opt-in, and this is it. It is deliberately TINY — a
 * style document and the first tile its own source names, not a Reader
 * regression suite — because the question is "does the provider path answer?",
 * and a hundred tiles do not answer it better than two.
 *
 * ## Everything about it is bounded, and it says so
 *
 * - **Two gates.** `WTP_PROVIDER_ACCESS=maptiler` in the process AND the
 *   `spendsProviderQuota` option at the launch. One alone is refused, so no
 *   sweep started in an opted-in shell can inherit the ability to spend.
 * - **A hard ceiling**, enforced in `scripts/browser.mts` for every context of
 *   the run, and a run that crosses it aborts the remaining requests and ends
 *   non-zero.
 * - **Its own key.** `WTP_MAPTILER_SMOKE_KEY`, never the production or staging
 *   browser key, and it REFUSES to run if the two values are equal — spending
 *   the production key here would put robot requests back inside production's
 *   number and undo the attribution this whole repair is for.
 * - **Its own origin.** The page is fabricated inside the browser at
 *   `http://maptiler-smoke.localhost`, so the smoke needs no server and its
 *   Origin header is a host nothing else uses. That is the narrow origin the
 *   smoke key is restricted to in `lib/map/key-matrix.ts`.
 * - **It prints what it spent**, by host, before it exits.
 *
 * ## What it deliberately does not do
 *
 * It does not render a map, walk the Reader, or touch production. It never
 * writes the key anywhere — not to stdout, not to a file, not into a
 * screenshot. And it is not on any schedule: a standing job that spends a
 * third party's allowance is the shape of the problem, not the fix.
 */

import { launchGuarded } from "./browser.mts";
import {
  MAPTILER,
  PROVIDER_ACCESS_VAR,
  PROVIDER_CEILING_VAR,
  describeLedger,
} from "../lib/ops/provider-access.ts";
import { SMOKE_ORIGIN, refuseSharedKey, smokeStyleUrl } from "../lib/map/key-matrix.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

/** The dark style the Reader asks for by default. One question, one style. */
const STYLE = process.env.NEXT_PUBLIC_MAPTILER_STYLE?.trim() || "basic-v2-dark";

/**
 * The smoke's ceiling, tighter than the shared default.
 *
 * A style document, the glyph or sprite requests a style pulls, and one tile.
 * Eight is generous for that and far too small for anything that could be
 * mistaken for a sweep.
 */
const SMOKE_CEILING = "8";

interface Reading {
  readonly styleStatus: number | null;
  readonly layers: number | null;
  readonly sources: number | null;
  readonly tileStatus: number | null;
  readonly threw: string | null;
}

async function main(): Promise<void> {
  const key = process.env.WTP_MAPTILER_SMOKE_KEY;
  const verdict = refuseSharedKey({
    smokeKey: key,
    productionKey: process.env.NEXT_PUBLIC_MAPTILER_KEY,
  });
  if (!verdict.ok) {
    console.error(`\nPROVIDER SMOKE — NOT RUN\n\n  ${verdict.says}\n`);
    process.exitCode = 1;
    return;
  }

  /*
   * The ceiling is set here, before the browser is opened, and only when the
   * operator did not already choose a tighter one. A smoke that inherited the
   * shared 25 would be a smoke with more headroom than it has business having.
   */
  if (!process.env[PROVIDER_CEILING_VAR]) process.env[PROVIDER_CEILING_VAR] = SMOKE_CEILING;

  console.log("\nPROVIDER SMOKE — MapTiler\n");
  console.log(`  origin        ${SMOKE_ORIGIN}`);
  console.log(`  style         ${STYLE}`);
  console.log("  key           WTP_MAPTILER_SMOKE_KEY (value never printed)");
  console.log(`  ceiling       ${process.env[PROVIDER_CEILING_VAR]} request(s)\n`);

  const browser = await launchGuarded({
    label: "provider-smoke",
    spendsProviderQuota: MAPTILER,
  });
  if (browser.provider.policy.mode !== "ALLOWED_BOUNDED") {
    await browser.close();
    console.error(
      `\nPROVIDER SMOKE — NOT RUN\n\n  ${browser.provider.policy.says}\n\n` +
        `  Run it as: ${PROVIDER_ACCESS_VAR}=maptiler pnpm provider:smoke\n`,
    );
    process.exitCode = 1;
    return;
  }

  let reading: Reading = {
    styleStatus: null,
    layers: null,
    sources: null,
    tileStatus: null,
    threw: null,
  };

  try {
    const context = await browser.context();
    /*
     * THE PAGE IS FABRICATED, NOT SERVED.
     *
     * Registered AFTER the shared guard's own `route("**\/*")`, and Playwright
     * runs handlers last-registered-first, so this one sees the navigation
     * first and answers it. Everything else — including every provider request
     * the page then makes — falls through to the guard, which is where the
     * barrier, the ceiling and the origin confinement all live. The smoke gets
     * an origin without a server; it does not get its own network policy.
     */
    await context.route(`${SMOKE_ORIGIN}/**`, async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><meta charset=utf-8><title>provider smoke</title>",
      });
    });

    const page = await context.newPage();
    await page.goto(`${SMOKE_ORIGIN}/`, { waitUntil: "domcontentloaded" });

    reading = (await page.evaluate(
      async ({ styleUrl }: { styleUrl: string }) => {
        const out: {
          styleStatus: number | null;
          layers: number | null;
          sources: number | null;
          tileStatus: number | null;
          threw: string | null;
        } = { styleStatus: null, layers: null, sources: null, tileStatus: null, threw: null };
        try {
          const styleResponse = await fetch(styleUrl, { cache: "no-store" });
          out.styleStatus = styleResponse.status;
          if (!styleResponse.ok) return out;

          const style = (await styleResponse.json()) as {
            layers?: unknown[];
            sources?: Record<string, { url?: string; tiles?: string[] }>;
          };
          out.layers = Array.isArray(style.layers) ? style.layers.length : null;
          out.sources = style.sources ? Object.keys(style.sources).length : null;

          /* One tile, from a source the style itself named — never a URL this
           * script guessed. A guessed tile URL that 404s would look like a
           * provider outage. */
          const first = Object.values(style.sources ?? {})[0];
          const tileUrl = first?.url ?? first?.tiles?.[0]?.replace(/\{[xyz]\}/g, "0");
          if (typeof tileUrl === "string" && tileUrl.startsWith("http")) {
            const tileResponse = await fetch(tileUrl, { cache: "no-store" });
            out.tileStatus = tileResponse.status;
          }
        } catch (error) {
          out.threw = (error as Error)?.message ?? "unknown";
        }
        return out;
      },
      { styleUrl: smokeStyleUrl(STYLE, key as string) },
    )) as Reading;
  } finally {
    /* `close()` throws when the ceiling was exceeded. That is the loud failure,
     * and it must not be swallowed by the reporting below. */
    await browser.close();
  }

  console.log("  WHAT THE PROVIDER ANSWERED\n");
  console.log(`    style.json          ${reading.styleStatus ?? "no answer"}`);
  console.log(`    layers in the style ${reading.layers ?? "not read"}`);
  console.log(`    vector sources      ${reading.sources ?? "not read"}`);
  console.log(`    one tile            ${reading.tileStatus ?? "not asked"}`);
  if (reading.threw) console.log(`    threw               ${reading.threw}`);
  /*
   * RULING 159: the spend is printed over the ceiling it was allowed, so a run
   * that spent nothing is visibly a run that spent nothing OUT OF a real
   * allowance — never a bare zero that could equally mean the browser never
   * opened.
   */
  console.log(
    `\n  ${floorLine(
      floored(
        "provider requests spent",
        "this run's ceiling",
        browser.provider.policy.ceiling,
        browser.provider.spent,
      ),
    )}`,
  );
  console.log(`  ${describeLedger(browser.provider)}\n`);

  const ok = reading.styleStatus === 200 && (reading.layers ?? 0) > 0;
  if (!ok) {
    console.error(
      "  PROVIDER SMOKE FAILED. The real style path did not answer with a style document. " +
        "This is a fact about the provider or the key, not about the barrier.\n",
    );
    process.exitCode = 1;
    return;
  }
  console.log("  PROVIDER SMOKE PASSED — the real style path answers, and the run was capped.\n");
}

await main();
