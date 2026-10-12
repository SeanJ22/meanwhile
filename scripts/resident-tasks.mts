#!/usr/bin/env node
/**
 * Resident tasks, run on the live site: drives each task in
 * data/health/resident-tasks.json by the scripted taps in
 * lib/health/resident-tasks.ts, at ZIPs sampled from the published places, on a
 * phone (390 by 844) and a desktop. Each step records time from tap to usable
 * result, a screenshot and page measurements. Every published ZIP never run
 * before is queued first.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/resident-tasks.mts [--if-queued] [--dry-run[=dir]] [--zip=NNNNN]
 *
 *   --if-queued   run only when a published ZIP has never been run (cheap; one read of the live site and the log)
 *   --dry-run     run and print, record nothing; screenshots go to the given folder (default .scratch/resident-tasks)
 *   --zip=NNNNN   run at this ZIP only (checking by hand)
 *
 * Screenshots go to the portrait blob store under `resident-tasks/`; the pass
 * goes to the live-audit log. Writes are blocked in every visit except Ask's,
 * which must reach /api/ask; Ask tasks run at one ZIP on a phone
 * (WTP_TASK_ASK_ZIPS, default 1; 0 leaves Ask out), with the run's synthetic
 * marker. Exit 1 when the control plane is not configured or no published
 * place could be read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Page } from "playwright";

import { readTaskZips, recordTaskPass } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { collectPageObservation, LAYOUT_SHIFT_INIT_SCRIPT, measurePage } from "../lib/health/page-metrics.ts";
import {
  chooseTaskZips, judgeTask, readySelector, shotKey, startPath, TASK_PROFILES, TASK_SCRIPTS, taskPass, taskTargets, WORDS,
  type Finder, type ResidentTask, type ResidentTaskFile, type TaskCheck, type TaskProfile, type TaskRun, type TaskStepRecord,
} from "../lib/health/resident-tasks.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { publishedPlaces } from "../lib/ops/post-deploy-warm.ts";
import { storeRunScreenshot } from "../lib/photos/store.ts";
import { launchGuarded, seedZip, type GuardedBrowser } from "./browser.mts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const BASE = (process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
const ZIP_COUNT = Number(process.env.WTP_TASK_ZIPS ?? 2);
const ASK_ZIPS = Number(process.env.WTP_TASK_ASK_ZIPS ?? 1);
const WAIT_MS = 20_000;
const QUIET_MS = 500;
const TAP_TIMEOUT_MS = 5_000;
const BROWSER_ARGS = (process.env.WTP_BROWSER_ARGS ?? "").split(" ").filter(Boolean);

const arg = (name: string) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const DRY = arg("dry-run");
const DRY_DIR = DRY?.includes("=") ? DRY.split("=")[1] : ".scratch/resident-tasks";
const ONLY_ZIP = arg("zip")?.split("=")[1];
const IF_QUEUED = Boolean(arg("if-queued"));

const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url && !DRY) {
  console.error("resident tasks: the control plane is not configured; nothing was run");
  process.exit(1);
}
const file = JSON.parse(readFileSync(join(process.cwd(), "data/health/resident-tasks.json"), "utf8")) as ResidentTaskFile;
const places = ONLY_ZIP ? [{ zip: ONLY_ZIP }] : await publishedPlaces(BASE, fetch, 15_000).catch(() => []);
if (places.length === 0) {
  console.error("resident tasks: no published place could be read from the live site");
  process.exit(1);
}
const repos = url && !DRY ? await createPgRepositories(url, now, { skipBootstrap: true }) : null;
const everRun = repos && !ONLY_ZIP ? await readTaskZips(repos) : new Set<string>();
const { zips, queued } = ONLY_ZIP ? { zips: [ONLY_ZIP], queued: [] as string[] } : chooseTaskZips(places.map((p) => p.zip), everRun, ZIP_COUNT, now);
if (IF_QUEUED && queued.length === 0) {
  console.log("resident tasks: no newly published ZIP is waiting for its first run");
  process.exit(0);
}
const targets = taskTargets(file.tasks, IF_QUEUED ? queued : zips, ASK_ZIPS);

/* ------------------------------------------------------- inside the page */

/** Resolves with performance.now() at the last change to the page once it has been still for `quiet` ms, or at `max`. */
async function settled(page: Page): Promise<number> {
  return page.evaluate(({ quiet, max }) => new Promise<number>((resolve) => {
    let last = performance.now();
    const started = last;
    const observer = new MutationObserver(() => { last = performance.now(); });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = () => {
      const t = performance.now();
      if (t - last >= quiet || t - started >= max) { observer.disconnect(); resolve(last); } else setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  }), { quiet: QUIET_MS, max: WAIT_MS });
}

type Found = { id: string; says: string; at: { x: number; y: number } } | { id: null; says: string; covered: boolean; offscreen: boolean };

/** Find what a resident would tap: visible, matching its words and its row, and on top (not covered). */
async function find(page: Page, finders: readonly Finder[]): Promise<Found> {
  return page.evaluate((list) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    // Where a thumb would land: the middle of the part of the target that is on screen (a row cut off at the edge is still tapped where it shows).
    const shownPart = (el: Element) => {
      const r = el.getBoundingClientRect();
      const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
      return right - left >= 4 && bottom - top >= 4 ? { x: (left + right) / 2, y: (top + bottom) / 2, r } : null;
    };
    const onTop = (el: Element, x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    let covered = false;
    let offscreen = false;
    for (const f of list) {
      const name = f.name ? new RegExp(f.name, "i") : null;
      const near = f.near ? new RegExp(f.near) : null;
      const all = Array.from(document.querySelectorAll(f.css)).filter(visible);
      for (const el of all) {
        const words = `${(el as HTMLElement).innerText ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
        if (name && !name.test(words)) continue;
        if (f.upcoming && /concluded|cancel+ed|already happened|postponed/i.test(words)) continue;
        if (near) {
          let ok = false;
          for (let a = el.parentElement, i = 0; a && i < 4; a = a.parentElement, i += 1) {
            if (all.filter((x) => a!.contains(x)).length > 1) break;
            if (near.test(a.innerText ?? "")) { ok = true; break; }
          }
          if (!ok) continue;
        }
        el.scrollIntoView({ block: "center", inline: "center" });
        const part = shownPart(el);
        if (!part) { offscreen = true; continue; }
        if (!onTop(el, part.x, part.y)) { covered = true; continue; }
        const id = `rt-${Math.random().toString(36).slice(2)}`;
        el.setAttribute("data-rt-target", id);
        return { id, says: f.says, at: { x: part.x - part.r.left, y: part.y - part.r.top } };
      }
    }
    return { id: null, says: list.map((f) => f.says).join(" or "), covered, offscreen };
  }, finders as Finder[]);
}

/** A resident waits for what they mean to tap to appear: up to 8 seconds, or 1.5 for an optional tap. */
async function findWaiting(page: Page, finders: readonly Finder[], optional: boolean): Promise<Found> {
  const until = Date.now() + (optional ? 1_500 : 8_000);
  for (;;) {
    const found = await find(page, finders);
    if (found.id !== null || Date.now() >= until) return found;
    await page.waitForTimeout(250);
  }
}

/** Which checks the screen the task ended on does not meet. */
async function unmet(page: Page, scope: string, checks: readonly TaskCheck[]): Promise<string[]> {
  return page.evaluate(({ scope: sel, list, gathering: g }) => {
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const root = Array.from(document.querySelectorAll(sel)).filter(shown).at(-1);
    if (!root) return list.map((c) => c.says);
    const text = (root as HTMLElement).innerText ?? "";
    // The same rule as saysGathering() in lib/health/resident-tasks.ts, which cannot be called from inside the page.
    const gathered = (c: TaskCheck) => c.orGathering === true && (c.part
      ? new RegExp(`(?:${c.part})[^\\n]{0,80}(?:\\n[^\\n]{0,80})?(?:${g})`, "i").test(text)
      : new RegExp(g, "i").test(text));
    return list.filter((c) => {
      const byText = c.text ? new RegExp(c.text, "i").test(text) : false;
      const byCss = c.css ? Array.from((c.anywhere ? document : root).querySelectorAll(c.css)).some(shown) : false;
      return !(byText || byCss || gathered(c));
    }).map((c) => c.says);
  }, { scope, list: checks as TaskCheck[], gathering: WORDS.gathering });
}

/* --------------------------------------------------------------- one run */

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

async function runTask(browser: GuardedBrowser, task: ResidentTask, zip: string, profile: TaskProfile): Promise<TaskRun> {
  const script = TASK_SCRIPTS[task.id];
  const context = await browser.context({ viewport: TASK_PROFILES[profile], deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const steps: TaskStepRecord[] = [];
  let taps = 0;
  let deadEnd: string | null = null;
  let missing: string[] = [];
  const record = async (says: string, ms: number | null) => {
    const shot = await keep(shotKey(now, browser.runId, task.id, zip, profile, steps.length), await page.screenshot({ type: "png" }));
    const issues: Record<string, number> = {};
    try {
      for (const issue of measurePage(await page.evaluate(collectPageObservation)).issues) issues[issue.kind] = (issues[issue.kind] ?? 0) + 1;
    } catch { /* a screen that could not be measured still keeps its screenshot */ }
    steps.push({ says, ms: ms === null ? null : Math.round(ms), shot, issues });
  };
  try {
    await seedZip(page, zip);
    await page.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT);
    await page.goto(`${BASE}${startPath(task.start, zip)}`, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForSelector(readySelector(task.start, zip), { state: "visible", timeout: WAIT_MS });
    await record(`Opened the ${task.start === "home" || task.start === "ask" ? "home" : task.start} page`, await settled(page));
    for (const step of script.steps) {
      if (step.kind === "ask") {
        const found = await findWaiting(page, [{ says: "the Ask box", css: "button.ask-pill, button[aria-label^='Ask about']" }], false);
        if (found.id === null) { deadEnd = "could not find the Ask box"; break; }
        await page.locator(`[data-rt-target="${found.id}"]`).click({ timeout: TAP_TIMEOUT_MS, position: found.at });
        taps += 1;
        const box = page.locator("[data-ask-panel] [data-ask-box]").last();
        try { await box.waitFor({ state: "visible", timeout: WAIT_MS }); } catch { deadEnd = "the Ask box did not open"; break; }
        await box.fill(task.question ?? task.title);
        const started = await page.evaluate(() => performance.now());
        await box.press("Enter");
        taps += 1;
        try {
          await page.waitForSelector("[data-ask-grounded], [data-ask-destination], [data-ask-refusal], [data-ask-answer-bodies]", { state: "attached", timeout: WAIT_MS });
        } catch { await record(`Asked "${task.question}"`, null); deadEnd = "Ask gave no answer within 20 seconds"; break; }
        await record(`Asked "${task.question}"`, (await settled(page)) - started);
        continue;
      }
      const started = await page.evaluate(() => performance.now());
      let tapped: Found | null = null;
      for (let attempt = 0; attempt < 2 && tapped === null; attempt += 1) {
        // A second look only when the target was re-drawn between finding and tapping; a covered target is a finding.
        const found = await findWaiting(page, step.finders, step.optional === true);
        if (found.id === null) { tapped = found; break; }
        try {
          await page.locator(`[data-rt-target="${found.id}"]`).click({ timeout: TAP_TIMEOUT_MS, position: found.at });
          tapped = found;
        } catch (error) {
          if (error instanceof Error && /intercepts pointer events/.test(error.message)) { tapped = { id: null, says: found.says, covered: true, offscreen: false }; break; }
          if (attempt === 1) tapped = { id: null, says: `${found.says} (it could not be tapped)`, covered: false, offscreen: false };
        }
      }
      if (tapped === null || tapped.id === null) {
        if (step.optional && tapped !== null && !tapped.covered) continue;
        const why = tapped ?? { says: "the next thing to tap", covered: false, offscreen: false };
        deadEnd = why.covered ? `${why.says} was covered by another part of the page`
          : why.offscreen ? `${why.says} was not on screen` : `could not find ${why.says}`;
        break;
      }
      const found = tapped;
      taps += 1;
      await record(`Tapped ${found.says}`, (await settled(page)) - started);
    }
    if (deadEnd === null) missing = await unmet(page, script.scope, script.checks);
  } catch (error) {
    deadEnd = deadEnd ?? `the page failed (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown"})`;
  } finally {
    await context.close();
  }
  return judgeTask(task, { taskId: task.id, zip, profile, steps, taps, deadEnd, missing });
}

/* ------------------------------------------------------------------ pass */

const reader = await launchGuarded({ label: "resident-tasks", headless: true, blockWrites: true, args: BROWSER_ARGS });
const asker = targets.some((t) => t.task.start === "ask") ? await launchGuarded({ label: "resident-tasks-ask", headless: true, args: BROWSER_ARGS }) : null;
const runs: TaskRun[] = [];
try {
  for (const t of targets) runs.push(await runTask(t.task.start === "ask" ? asker! : reader, t.task, t.zip, t.profile));
} finally {
  await reader.close();
  await asker?.close();
}

const pass = taskPass(runs, now, reader.runId, IF_QUEUED ? queued : queued.filter((z) => zips.includes(z)));
if (DRY) {
  for (const run of pass.runs) {
    console.log(`  ${run.verdict}  ${run.says}`);
    for (const s of run.steps) console.log(`          ${s.says} · ${s.ms === null ? "—" : `${s.ms} ms`} · ${s.shot ?? "no screenshot"}${Object.keys(s.issues).length ? ` · ${JSON.stringify(s.issues)}` : ""}`);
  }
} else {
  await recordTaskPass(repos!, pass);
}
console.log(`resident tasks: ${pass.passed} passed, ${pass.failed} failed, at ${pass.zips.join(", ")}${pass.queued.length ? ` (first run for ${pass.queued.join(", ")})` : ""} (run ${reader.runId})`);
