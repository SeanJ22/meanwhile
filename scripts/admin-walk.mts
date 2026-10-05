/**
 * **RENDER THE GATED ADMIN CONSOLE LOCALLY AND READ WHAT IT SAYS.**
 * (Admin Pass C, 2026-09-06.)
 *
 * Every admin pass has rebuilt this walk from scratch in a scratch directory
 * and then lost it. It lives in `scripts/` now, because "prove the change
 * renders before claiming it does" is the standing rule for this surface
 * (RULING 262: a capture is evidence only once it has been read) and the
 * instrument for it should not have to be re-derived every time.
 *
 * ## The two things that make an admin page renderable from a script
 *
 * ```
 *   the HOST gate    isAdminHostRequest reads x-forwarded-host, and undici
 *                    ignores a custom Host header but sends this one
 *   the SESSION      a REAL signed session, minted here with the same key the
 *                    server has — never a bypass, never a disabled check
 * ```
 *
 * The cookie is `__Host-`-prefixed, so it needs `secure`, and Chromium refuses
 * to set a Secure cookie against an `http://` url — but it will happily SEND
 * one set against `https://localhost:<port>` to `http://localhost:<port>`.
 * That asymmetry is the whole trick and it is why the url below is rewritten.
 *
 * ## Usage
 *
 *   pnpm admin:walk                                  # localhost:3100, dark
 *   ADMIN_WALK_BASE=http://localhost:3000 pnpm admin:walk
 *   ADMIN_WALK_PAGES=admin,readiness/az pnpm admin:walk
 *   ADMIN_WALK_THEMES=dark,light ADMIN_WALK_WIDTH=1024 pnpm admin:walk
 *
 * Writes a PNG and the page's rendered text per page per theme into
 * `.scratch/admin-walk/`, plus `timings.json` for the ADM-38 measurement.
 * `.scratch` is gitignored: RULING 20's guard fails the suite on a new PNG
 * anywhere it would be committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { join } from "node:path";

import { ADMIN_SESSION_COOKIE, signSession } from "../lib/control-plane/admin-auth.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { isLocalBase } from "../lib/ops/live-write-guard.ts";
import { launchGuarded } from "./browser.mts";

/** The admin host, derived from the one origins module rather than retyped. */
const ADMIN_HOST = new URL(ADMIN_ORIGIN).host;
const BASE = process.env.ADMIN_WALK_BASE ?? "http://localhost:3100";
const OUT = process.env.ADMIN_WALK_OUT ?? join(".scratch", "admin-walk");
const PAGES = (process.env.ADMIN_WALK_PAGES ?? "admin,readiness/az").split(",").map((p) => p.trim()).filter(Boolean);
const THEMES = (process.env.ADMIN_WALK_THEMES ?? "dark").split(",").map((t) => t.trim()).filter(Boolean);
const WIDTH = Number(process.env.ADMIN_WALK_WIDTH ?? 1440);
const SETTLE_MS = Number(process.env.ADMIN_WALK_SETTLE_MS ?? 0);
/** A full-page capture of a console page hits tens of thousands of pixels; clamp it. */
const MAX_CAPTURE_HEIGHT = 7000;

/* FE-01: the live admin site is read with every write route aborted in the browser. */
const LIVE_TARGET = !isLocalBase(BASE);
if (LIVE_TARGET) console.log(`admin:walk · live target ${BASE}: write routes are aborted in the browser (FE-01).`);
const key = process.env.WTP_ADMIN_SESSION_KEY;
if (!key) throw new Error("WTP_ADMIN_SESSION_KEY is not set, so no session can be minted and every page would redirect to the login.");

const nowSeconds = Math.floor(Date.now() / 1000);
const cookie = await signSession({ sid: "adm_walk00000000000000", iat: nowSeconds, exp: nowSeconds + 8 * 3600, via: "google" }, key);

mkdirSync(OUT, { recursive: true });
const browser = await launchGuarded({ label: "admin-walk", blockWrites: LIVE_TARGET });
const readings: Record<string, unknown>[] = [];

for (const theme of THEMES) {
  const context = await browser.context({
    viewport: { width: WIDTH, height: 1200 },
    extraHTTPHeaders: { "x-forwarded-host": ADMIN_HOST },
  });
  await context.addCookies([
    { name: ADMIN_SESSION_COOKIE, value: cookie, url: BASE.replace(/^http:/, "https:"), secure: true, httpOnly: true, sameSite: "Lax" },
  ]);
  await context.addInitScript(`localStorage.setItem("wtp.theme", ${JSON.stringify(theme)})`);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

  for (const path of PAGES) {
    const startedAt = Date.now();
    let status = 0;
    try {
      const response = await page.goto(`${BASE}/${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      status = response?.status() ?? 0;
    } catch (error) {
      errors.push(`goto ${path}: ${String(error).slice(0, 200)}`);
    }
    const domMs = Date.now() - startedAt;
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      /* a page that never idles is still read; the timing says so */
    }
    // The console's sections load after the shell (live sync); ADMIN_WALK_SETTLE_MS waits for them before the page is read.
    if (SETTLE_MS > 0) await page.waitForTimeout(SETTLE_MS);
    const readyMs = Date.now() - startedAt;
    const name = `${path.replace(/[/?&=:]/g, "_")}.${theme}`;
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    try {
      await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: WIDTH, height: Math.min(height, MAX_CAPTURE_HEIGHT) } });
    } catch (error) {
      errors.push(`capture ${path}: ${String(error).slice(0, 150)}`);
    }
    const text = await page.evaluate(() => document.body.innerText);
    writeFileSync(join(OUT, `${name}.txt`), text);
    /*
     * ADM-38 measures what the OWNER waits for, which is not when the stream
     * closes. A streamed page paints its shell long before `domcontentloaded`
     * fires, so the two numbers that matter are the first byte and the first
     * paint; `ready` is kept beside them as the outside edge.
     */
    const paint = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { ttfb: nav ? Math.round(nav.responseStart) : null, fcp: fcp ? Math.round(fcp.startTime) : null };
    });
    readings.push({ page: path, theme, status, ttfbMs: paint.ttfb, fcpMs: paint.fcp, domMs, readyMs, height, chars: text.length });
    console.log(
      `admin:walk · ${path} [${theme}] status ${status} · first byte ${paint.ttfb ?? "?"} ms · first paint ${paint.fcp ?? "?"} ms · settled ${readyMs} ms · ${height} px · ${text.length} chars`,
    );
  }
  if (errors.length > 0) {
    console.log(`admin:walk · ${errors.length} console/page error(s) in the ${theme} pass:`);
    for (const e of errors.slice(0, 10)) console.log(`    ${e}`);
  }
  await context.close();
}

if (LIVE_TARGET) {
  console.log(`admin:walk · the browser aborted ${browser.writesBlocked.count} write request(s).`);
}
await browser.close();
writeFileSync(join(OUT, "timings.json"), `${JSON.stringify(readings, null, 2)}\n`);
/*
 * RULING 159: a count printed by a script states its denominator. The walk's
 * denominator is every page it was asked for, in every theme — so a reading
 * that never happened (a page that would not load) is visible as a shortfall
 * rather than as a smaller-looking success.
 */
console.log(`admin:walk · ${floorLine(floored("admin readings", "the requested pages in every theme", PAGES.length * THEMES.length, readings.length))} · written to ${OUT}`);
