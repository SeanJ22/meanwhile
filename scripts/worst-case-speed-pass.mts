#!/usr/bin/env node
/**
 * Worst-case speed pass on the live site: every resident-task surface and Ask question at
 * sampled published ZIPs, phone and desktop, each visit a fresh browser context. Judged by
 * the slowest visit against three seconds; an unfinished visit fails.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/worst-case-speed-pass.mts [--dry-run]
 *
 * "Usable", on the browser clock from navigation start:
 *   home, map   the first pin of the reader's area is on the map
 *   ballot      the ballot heading is there and the page can answer a tap
 *   meetings    the meetings door has opened and shows its groups
 *   officials   the officials door has opened
 *   ask         from pressing Ask to the first answer, refusal or destination
 *
 * Writes are blocked except for Ask, which runs a model and is measured at WTP_SPEED_ASK_ZIPS
 * ZIPs (default 1) with the synthetic marker. `--dry-run` prints rows without recording.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordSpeedPass } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import {
  judgeSpeed, sampleZips, speedTargets, SPEED_PROFILES, type ResidentTaskSet, type SpeedRun, type SpeedTarget,
} from "../lib/health/worst-case-speed.ts";
import { openSurfaceFixes } from "../lib/health/surface-fixes.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { publishedPlaces } from "../lib/ops/post-deploy-warm.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const BASE = (process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
const ZIP_COUNT = Number(process.env.WTP_SPEED_ZIPS ?? 3);
const ASK_ZIP_COUNT = Number(process.env.WTP_SPEED_ASK_ZIPS ?? 1);
const RUNS = Number(process.env.WTP_SPEED_RUNS ?? 2);
const WAIT_MS = 20_000;

const DRY = process.argv.includes("--dry-run");
const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url && !DRY) {
  console.error("speed: the control plane is not configured; nothing was measured");
  process.exit(1);
}
const tasks = JSON.parse(readFileSync(join(process.cwd(), "data/health/resident-tasks.json"), "utf8")) as ResidentTaskSet;
const places = await publishedPlaces(BASE, fetch, 15_000).catch(() => []);
if (places.length === 0) {
  console.error("speed: no published place could be read from the live site");
  process.exit(1);
}
const zips = sampleZips(places.map((p) => p.zip), ZIP_COUNT, now);
const askZips = new Set(zips.slice(0, ASK_ZIP_COUNT));
const targets = speedTargets(tasks, zips).filter((t) => t.surface !== "ask" || askZips.has(t.zip));

/** Open a door (a stat card) by its label from inside the page, never with the mouse. */
const DOOR = { meetings: "meetings", officials: "officials" } as const;
const READY: Record<string, string> = {
  home: ".map-pin, .maplibregl-marker",
  map: ".map-pin, .maplibregl-marker",
  ballot: "main h1",
  meetings: ".al-group-head, .al-overlay-body",
  officials: ".door-panel",
};
const ANSWERED = "[data-ask-grounded], [data-ask-destination], [data-ask-refusal], [data-ask-answer-bodies]";

async function visit(browser: GuardedBrowser, target: SpeedTarget): Promise<SpeedRun> {
  const context = await browser.context({ viewport: SPEED_PROFILES[target.profile], deviceScaleFactor: 2, reducedMotion: "reduce" });
  await context.addInitScript(() => { try { localStorage.setItem("wtp.tutorial_seen", "1"); } catch { /* defaults are fine */ } });
  const page = await context.newPage();
  try {
    const path = target.surface === "ballot" ? `/ballot?zip=${target.zip}` : `/?zip=${target.zip}`;
    await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 60_000 });
    if (target.surface === "ask") {
      await page.waitForFunction(() => document.readyState !== "loading", undefined, { timeout: WAIT_MS });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mw:open-pop", { detail: "ask" })));
      const box = page.locator("[data-ask-panel] [data-ask-box]").first();
      try { await box.waitFor({ state: "visible", timeout: WAIT_MS }); } catch { return { ...target, ms: null, note: "the Ask box did not open" }; }
      await box.fill(target.question ?? "");
      const started = await page.evaluate(() => performance.now());
      await box.press("Enter");
      try { await page.waitForSelector(ANSWERED, { state: "attached", timeout: WAIT_MS }); } catch { return { ...target, ms: null, note: "no answer within 20 seconds" }; }
      return { ...target, ms: Math.round((await page.evaluate(() => performance.now())) - started) };
    }
    if (target.surface === "meetings" || target.surface === "officials") {
      const label = DOOR[target.surface];
      const opened = await page.waitForFunction((word) => {
        const pattern = new RegExp(word, "i");
        for (const el of Array.from(document.querySelectorAll("button, [role=button]"))) {
          const text = el.textContent ?? "";
          if (pattern.test(text) && /\d/.test(text)) { (el as HTMLElement).click(); return true; }
        }
        return false;
      }, label, { timeout: WAIT_MS, polling: 100 }).then(() => true, () => false);
      if (!opened) return { ...target, ms: null, note: `the ${label} door never appeared` };
    }
    const selector = READY[target.surface];
    if (!selector) return { ...target, ms: null, note: "no measure is defined for this page" };
    try { await page.waitForSelector(selector, { state: "attached", timeout: WAIT_MS }); } catch { return { ...target, ms: null, note: "it never became usable within 20 seconds" }; }
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return { now: performance.now(), interactive: nav ? nav.domInteractive : 0 };
    });
    return { ...target, ms: Math.round(target.surface === "ballot" ? Math.max(t.now, t.interactive) : t.now) };
  } catch (error) {
    return { ...target, ms: null, note: error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "the visit failed" };
  } finally {
    await context.close();
  }
}

const reader = await launchGuarded({ label: "worst-case-speed", headless: true, blockWrites: true });
const asker = targets.some((t) => t.surface === "ask") ? await launchGuarded({ label: "worst-case-speed-ask", headless: true }) : null;
const runs: SpeedRun[] = [];
try {
  for (const target of targets) {
    const times = target.surface === "ask" ? 1 : RUNS;
    for (let i = 0; i < times; i += 1) runs.push(await visit(target.surface === "ask" ? asker! : reader, target));
  }
} finally {
  await reader.close();
  await asker?.close();
}

const pass = judgeSpeed(runs, now);
if (DRY) {
  for (const row of pass.rows) console.log(`  ${row.verdict}  ${row.says}`);
} else {
  const repos = await createPgRepositories(url!, now, { skipBootstrap: true });
  await recordSpeedPass(repos, pass);
  const fixes = await openSurfaceFixes(repos, pass, now).catch((error) => { console.error(`speed: fix items were not opened (${error instanceof Error ? error.message : error})`); return { opened: [] }; });
  if (fixes.opened.length > 0) console.log(`speed: ${fixes.opened.length} fix item${fixes.opened.length === 1 ? "" : "s"} kept open`);
}
console.log(`speed: ${pass.passed} within three seconds, ${pass.failed} too slow or unfinished, at ${pass.zips.join(", ")} (run ${reader.runId})`);
