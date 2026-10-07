/**
 * The one command that may spend MapTiler quota — `pnpm provider:smoke`.
 *
 * A tiny opt-in that proves the real style URL, key and provider still answer:
 * a style document and the first tile its own source names. Bounded:
 *
 * - Two gates: `WTP_PROVIDER_ACCESS=maptiler` in the process AND the
 *   `spendsProviderQuota` launch option. One alone is refused.
 * - A hard ceiling, enforced in `scripts/browser.mts` for every context.
 * - Its own key, `WTP_MAPTILER_SMOKE_KEY`; it refuses to run if that equals the
 *   production or staging browser key.
 * - Its own origin, `http://maptiler-smoke.localhost`, fabricated in the browser
 *   (the smoke key's restricted origin in `lib/map/key-matrix.ts`).
 * - It prints what it spent, by host, and never writes the key anywhere.
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

/** The smoke's ceiling, tighter than the shared default: a style, its glyph or sprite requests, and one tile. */
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

  // Set before the browser opens, and only when the operator did not choose a tighter ceiling.
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
     * The page is fabricated, not served. Registered after the shared guard's own
     * `route("**\/*")`; Playwright runs handlers last-registered-first, so this one
     * answers the navigation and every provider request falls through to the guard.
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

          /* One tile, from a source the style itself named; a guessed URL that 404s would look like an outage. */
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
