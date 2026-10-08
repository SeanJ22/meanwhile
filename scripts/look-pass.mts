#!/usr/bin/env node
/**
 * **ONE LOOK PASS ON THE LIVE SITE AFTER A DEPLOY.**
 *
 * Reads the commit the live site serves (/api/build). When no look pass has run
 * on it yet, shoots each reader surface at a published ZIP sampled for the day,
 * on a phone (390 by 844) and a desktop, runs the page measurements on
 * each screen, and asks the look reviewer for a verdict per screen from
 * the screenshots, the task and the written look standard alone. Red flags
 * become fix-list items pointing at their screenshot; green flags are counted.
 * The pass goes to the live-audit log, and Admin shows it.
 *
 * Runs on the runner host, once a cycle; it exits at once when the deploy has
 * been looked at already:
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/look-pass.mts [--force] [--dry-run[=dir]] [--zip=NNNNN]
 *
 *   --force       look again even if this deploy has a look entry
 *   --dry-run     shoot, measure and print; no model call, nothing recorded (screenshots to the given folder, default .scratch/look-pass)
 *   --zip=NNNNN   look at this ZIP only (checking by hand)
 *
 * Writes are blocked in every visit. The reviewer is a model call: it runs only
 * when ANTHROPIC_API_KEY is set and the owner's spend controls leave room for
 * it (lib/frontend/look-spend.ts); otherwise the pass is kept with every screen
 * "not reviewed" and says why. WTP_LOOK_REVIEW=off leaves the reviewer out.
 * Exit 0 with a one-line summary; exit 1 when the control plane is not
 * configured or no published place could be read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Page } from "playwright";

import { addFixItem } from "../lib/control-plane/fix-list.ts";
import { readLookedCommits, recordLookPass } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import {
  LOOK_PROFILES, lookFixAdds, lookOwed, lookPass, lookShotKey, lookTargets, screenLabel, withFixIds,
  type LookScreen, type LookTarget, type ShotScreen,
} from "../lib/frontend/look-pass.ts";
import { reviewLook, type LookScreenshot } from "../lib/frontend/look-review.ts";
import { lookModelCall, reserveLookSpend } from "../lib/frontend/look-spend.ts";
import { collectPageObservation, LAYOUT_SHIFT_INIT_SCRIPT, measurePage } from "../lib/health/page-metrics.ts";
import { sampleZips } from "../lib/health/worst-case-speed.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { publishedPlaces } from "../lib/ops/post-deploy-warm.ts";
import { storeRunScreenshot } from "../lib/photos/store.ts";
import { launchGuarded, seedZip, type GuardedBrowser } from "./browser.mts";
import { fetchServedCommit } from "./post-deploy-observer.mts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const BASE = (process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
const ZIP_COUNT = Number(process.env.WTP_LOOK_ZIPS ?? 1);
const WAIT_MS = 20_000;
const BROWSER_ARGS = (process.env.WTP_BROWSER_ARGS ?? "").split(" ").filter(Boolean);

const arg = (name: string) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const DRY = arg("dry-run");
const DRY_DIR = DRY?.includes("=") ? DRY.split("=")[1] : ".scratch/look-pass";
const ONLY_ZIP = arg("zip")?.split("=")[1];
const FORCE = Boolean(arg("force"));

const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url && !DRY) {
  console.error("look pass: the control plane is not configured; nothing was looked at");
  process.exit(1);
}
const repos = url && !DRY ? await createPgRepositories(url, now, { skipBootstrap: true }) : null;
const served = await fetchServedCommit(BASE, { runId: "look-pass" });
const looked = repos ? new Set((await readLookedCommits(repos)).map((l) => l.sha)) : new Set<string>();
if (!FORCE && !DRY && !lookOwed(served.sha, looked)) {
  console.log(served.sha === null ? `look pass: the served commit could not be read (${served.how}); nothing was looked at`
    : `look pass: the deploy of ${served.sha.slice(0, 8)} has been looked at already`);
  process.exit(0);
}
const sha = served.sha ?? "unknown";
const places = ONLY_ZIP ? [{ zip: ONLY_ZIP }] : await publishedPlaces(BASE, fetch, 15_000).catch(() => []);
if (places.length === 0) {
  console.error("look pass: no published place could be read from the live site");
  process.exit(1);
}
const zips = ONLY_ZIP ? [ONLY_ZIP] : sampleZips(places.map((p) => p.zip), ZIP_COUNT, now);
const targets = lookTargets(zips);
const tasks = JSON.parse(readFileSync(join(process.cwd(), "data/health/resident-tasks.json"), "utf8")) as { tasks: { start: string; title: string }[] };
const standard = readFileSync(join(process.cwd(), "docs/look-standard.md"), "utf8");

/* ----------------------------------------------------------- one screen */

const READY: Record<LookTarget["surface"], string> = {
  home: ".map-pin, .maplibregl-marker",
  ballot: "main h1",
  meetings: ".al-group-head, .al-overlay-body",
  officials: ".door-panel",
};

async function keep(key: string, bytes: Uint8Array): Promise<string | null> {
  try {
    if (DRY) {
      const path = join(DRY_DIR, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    } else {
      await storeRunScreenshot(key, bytes);
    }
    return key;
  } catch {
    return null;
  }
}

/** Open a door (a stat card) by its label, as the speed pass does. */
async function openDoor(page: Page, word: string): Promise<boolean> {
  return page.waitForFunction((w) => {
    const pattern = new RegExp(w, "i");
    for (const el of Array.from(document.querySelectorAll("button, [role=button]"))) {
      const text = el.textContent ?? "";
      if (pattern.test(text) && /\d/.test(text)) { (el as HTMLElement).click(); return true; }
    }
    return false;
  }, word, { timeout: WAIT_MS, polling: 100 }).then(() => true, () => false);
}

async function shoot(browser: GuardedBrowser, target: LookTarget): Promise<{ screen: ShotScreen; image: LookScreenshot | null }> {
  const context = await browser.context({ viewport: { ...LOOK_PROFILES[target.profile] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(() => { try { localStorage.setItem("wtp.tutorial_seen", "1"); } catch { /* defaults are fine */ } });
  const page = await context.newPage();
  const fail = (why: string) => ({ screen: { target, shot: null, issues: {}, issueLines: [], failed: why }, image: null });
  try {
    await seedZip(page, target.zip);
    await page.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT);
    await page.goto(`${BASE}${target.surface === "ballot" ? `/ballot?zip=${target.zip}` : `/?zip=${target.zip}`}`, { waitUntil: "commit", timeout: 60_000 });
    if ((target.surface === "meetings" || target.surface === "officials") && !(await openDoor(page, target.surface))) return fail(`the ${target.surface} door never appeared`);
    try { await page.waitForSelector(READY[target.surface], { state: "visible", timeout: WAIT_MS }); } catch { return fail("it never became usable within 20 seconds"); }
    await page.waitForTimeout(1_500);
    const bytes = await page.screenshot({ type: "png" });
    const shot = await keep(lookShotKey(sha, now, target), bytes);
    const issues: ShotScreen["issues"] = {};
    const issueLines: string[] = [];
    try {
      for (const issue of measurePage(await page.evaluate(collectPageObservation)).issues) {
        (issues as Record<string, number>)[issue.kind] = (issues[issue.kind] ?? 0) + 1;
        if (issueLines.length < 5) issueLines.push(issue.detail);
      }
    } catch { /* a screen that could not be measured still keeps its screenshot */ }
    return {
      screen: { target, shot, issues, issueLines, failed: null },
      image: { label: screenLabel(target), mediaType: "image/png", base64: Buffer.from(bytes).toString("base64") },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "the visit failed");
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------ pass */

const browser = await launchGuarded({ label: "look-pass", headless: true, blockWrites: true, args: BROWSER_ARGS });
const shots: { screen: ShotScreen; image: LookScreenshot | null }[] = [];
try {
  for (const t of targets) shots.push(await shoot(browser, t));
} finally {
  await browser.close();
}

const sent = shots.filter((s) => s.image !== null);
const task = [
  "A resident opens Meanwhile at their ZIP code to understand what their local government is doing. On these screens they try to:",
  ...[...new Set(tasks.tasks.filter((t) => t.start !== "ask").map((t) => t.title))].map((title) => `- ${title}`),
].join("\n");
const apiKey = process.env.ANTHROPIC_API_KEY;
const reviewerOff = DRY || process.env.WTP_LOOK_REVIEW === "off";
const outcome = await reviewLook({ screenshots: sent.map((s) => s.image!), task, standard }, reviewerOff || !apiKey || !repos ? {} : {
  callModel: lookModelCall(repos, apiKey),
  reserveSpend: async (screens) => {
    const room = await reserveLookSpend(repos, now, screens);
    if (!room.ok) console.log(`look pass: the reviewer was held: ${room.why}`);
    return room.ok;
  },
});
let pass = lookPass({ sha, at: now, runId: browser.runId, shots: shots.map((s) => s.screen), reviewed: sent.map((s) => s.screen), outcome });

if (DRY) {
  for (const s of pass.screens) console.log(`  ${s.verdict.padEnd(12)} ${s.label} · ${s.shot ?? s.failed ?? "no screenshot"}${s.issueLines.length ? ` · ${s.issueLines.length} measured` : ""}`);
} else {
  const ids = new Map<LookScreen, string>();
  for (const { screen, add } of lookFixAdds(pass)) ids.set(screen, await addFixItem(repos!, { ...add, by: "The look check", at: now }));
  pass = withFixIds(pass, ids);
  await recordLookPass(repos!, pass);
}
console.log(`look pass: deploy ${sha.slice(0, 8)} is ${pass.verdict}: ${pass.red} red, ${pass.green} green, ${pass.notReviewed} not reviewed, at ${pass.zips.join(", ")}${pass.reviewerSays ? ` (${pass.reviewerSays})` : ""} (run ${pass.runId})`);
