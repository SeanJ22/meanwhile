/**
 * BEFORE/AFTER screenshot pairs, one browser for the whole set.
 *
 *   pnpm pairs before            # every shot in the manifest
 *   pnpm pairs after 02 05 6b    # only the items named
 *
 * Why this exists beside `pnpm shoot`: the author judges this session's work
 * by eye, item by item, and `shoot` launches a browser per shot (~12s each).
 * A twenty-shot BEFORE pass through `shoot` is four minutes of Chromium
 * startup. This drives one context and reuses it, and — more importantly —
 * the manifest is the RECORD of what each pair is of, so an AFTER shot is
 * guaranteed to be the same surface in the same state as its BEFORE.
 *
 * Files land at `screenshots/<phase>-<item>-<name>.png`.
 *
 * Every step failure is LOUD. A missing selector that silently leaves the
 * page on an earlier state produces a screenshot that looks like a successful
 * capture of the wrong thing — the no-op-reports-success shape this repo
 * keeps rediscovering. A failed step aborts its shot and is reported in the
 * run summary with a non-zero exit.
 */

import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "screenshots");
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

type Step =
  | { do: "click"; sel: string }
  | { do: "clickIfThere"; sel: string }
  | { do: "fill"; sel: string; value: string }
  | { do: "press"; sel: string; key: string }
  | { do: "scrollTo"; sel: string }
  | { do: "wait"; ms: number }
  | { do: "waitFor"; sel: string }
  | { do: "drag"; from: [number, number]; to: [number, number] }
  | { do: "clickXY"; at: [number, number] };

interface Shot {
  /** The brief's item number. Groups the pair. */
  item: string;
  name: string;
  path?: string;
  zip?: string | null;
  theme?: "dark" | "light";
  viewport?: { width: number; height: number };
  districts?: boolean;
  /** Skip the first-run tour seed — for shots OF a fresh profile. */
  fresh?: boolean;
  settleMs?: number;
  steps?: Step[];
  fullPage?: boolean;
}

/**
 * The manifest. One entry per numbered item the author judges by eye; a few
 * items get two, where the change lands on two surfaces.
 */
const SHOTS: Shot[] = [
  {
    item: "01",
    name: "who-governs-card",
    zip: "85701",
    viewport: PHONE,
  },
  {
    item: "02",
    name: "floaters",
    zip: "85701",
    viewport: PHONE,
  },
  {
    item: "02",
    name: "sidebar-desktop",
    zip: "85701",
    viewport: DESKTOP,
  },
  {
    item: "02",
    name: "ballot-header",
    zip: "85701",
    path: "/ballot?zip=85701",
    viewport: PHONE,
  },
  {
    item: "03",
    name: "zip-switch",
    zip: "85701",
    viewport: PHONE,
  },
  {
    item: "04",
    name: "calendar-chooser",
    zip: "85701",
    viewport: PHONE,
    // The ballot page's own Add-to-calendar, beside the election date: one
    // click instead of three, and the same ONE component every surface uses.
    path: "/ballot?zip=85701",
    steps: [
      { do: "click", sel: "[data-add-to-calendar]" },
      { do: "wait", ms: 600 },
    ],
  },
  {
    item: "05",
    name: "footer-legend-collision",
    zip: "85701",
    viewport: PHONE,
    steps: [{ do: "click", sel: ".sidebar-toggle" }, { do: "wait", ms: 900 }],
  },
  {
    item: "05",
    name: "tier-toggles",
    zip: "85701",
    viewport: PHONE,
    steps: [{ do: "click", sel: ".sidebar-toggle" }, { do: "wait", ms: 900 }],
  },
  {
    item: "05",
    name: "funding-section",
    zip: "85701",
    path: "/ballot?zip=85701",
    viewport: PHONE,
    steps: [
      { do: "scrollTo", sel: "[data-funding-section]" },
      { do: "wait", ms: 700 },
    ],
  },
  {
    item: "06",
    name: "clear-picks-dialog",
    zip: "85701",
    path: "/ballot?zip=85701",
    viewport: PHONE,
    steps: [
      { do: "clickIfThere", sel: "button:has-text('Clear my picks')" },
      { do: "wait", ms: 600 },
    ],
  },
  {
    item: "6b",
    name: "battlecard-senator",
    zip: "85701",
    viewport: PHONE,
  },
  {
    item: "6b2",
    name: "state-focus",
    zip: "85701",
    viewport: PHONE,
    districts: true,
  },
  {
    item: "6b3",
    name: "ballot-cards",
    zip: "85701",
    path: "/ballot?zip=85701",
    viewport: PHONE,
    steps: [{ do: "wait", ms: 600 }],
  },
  {
    item: "6c",
    name: "question-boxes",
    zip: "85701",
    path: "/ballot?zip=85701",
    viewport: PHONE,
    steps: [
      { do: "scrollTo", sel: ".reaction-box" },
      { do: "wait", ms: 600 },
    ],
  },
  {
    item: "6e2",
    name: "welcome-overlay",
    zip: null,
    viewport: PHONE,
    fresh: true,
  },
  {
    item: "6e2",
    name: "welcome-overlay-desktop",
    zip: null,
    viewport: DESKTOP,
    fresh: true,
  },
  {
    item: "6g",
    name: "source-tag-overflow",
    zip: "85701",
    viewport: PHONE,
  },
];

async function seed(page: Page, shot: Shot) {
  await page.context().addInitScript(
    ({ zip, theme, districts, tutorial }) => {
      try {
        if (theme === "light") localStorage.setItem("wtp.theme", "light");
        else localStorage.removeItem("wtp.theme");
        // SESSION storage since 2026-08-15 (6f): the location no longer
        // survives a tab closing. Recents are the localStorage half, seeded
        // with a second zip so the switcher has a recent to show.
        if (zip) {
          sessionStorage.setItem(
            "wtp.approximate_location",
            JSON.stringify({ zip, savedAt: new Date().toISOString() }),
          );
          localStorage.setItem(
            "wtp.recent_zips",
            JSON.stringify([zip, "03255", "07866"].slice(0, 3)),
          );
        } else {
          sessionStorage.removeItem("wtp.approximate_location");
        }
        localStorage.setItem("wtp.show_districts", districts ? "1" : "0");
        if (tutorial) localStorage.removeItem("wtp.tutorial_seen");
        else localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        // Nothing to do; the shot starts from defaults.
      }
    },
    {
      zip: shot.zip ?? null,
      theme: shot.theme ?? "dark",
      districts: shot.districts ?? false,
      tutorial: shot.fresh ?? false,
    },
  );
}

async function run(page: Page, step: Step) {
  if (step.do === "wait") return page.waitForTimeout(step.ms);
  if (step.do === "waitFor")
    return page.locator(step.sel).first().waitFor({ timeout: 8000 });
  if (step.do === "click") {
    await page.locator(step.sel).first().click({ timeout: 8000 });
    return page.waitForTimeout(450);
  }
  if (step.do === "clickIfThere") {
    const el = page.locator(step.sel).first();
    if ((await el.count()) === 0) {
      console.log(`      (absent, skipped: ${step.sel})`);
      return;
    }
    await el.click({ timeout: 8000 });
    return page.waitForTimeout(450);
  }
  if (step.do === "fill") {
    await page.locator(step.sel).first().fill(step.value, { timeout: 8000 });
    return page.waitForTimeout(400);
  }
  if (step.do === "press") {
    await page.locator(step.sel).first().press(step.key);
    return page.waitForTimeout(600);
  }
  if (step.do === "scrollTo") {
    await page.locator(step.sel).first().scrollIntoViewIfNeeded({ timeout: 8000 });
    return page.waitForTimeout(400);
  }
  if (step.do === "drag") {
    await page.mouse.move(step.from[0], step.from[1]);
    await page.mouse.down();
    await page.mouse.move(step.to[0], step.to[1], { steps: 14 });
    await page.mouse.up();
    return page.waitForTimeout(2600);
  }
  if (step.do === "clickXY") {
    await page.mouse.click(step.at[0], step.at[1]);
    return page.waitForTimeout(700);
  }
}

const phase = process.argv[2];
// "prod" is the same manifest against a deployed origin (SHOOT_BASE_URL) —
// added 2026-08-16 so a production pass files beside its local pair instead
// of overwriting it.
if (phase !== "before" && phase !== "after" && phase !== "prod") {
  console.error("usage: pnpm pairs <before|after|prod> [item…]");
  process.exit(1);
}
const only = new Set(process.argv.slice(3));
const wanted = only.size ? SHOTS.filter((s) => only.has(s.item)) : SHOTS;
if (!wanted.length) {
  console.error(`no shots match ${[...only].join(", ")}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];

for (const shot of wanted) {
  const label = `${phase}-${shot.item}-${shot.name}`;
  const context = await browser.newContext({
    viewport: shot.viewport ?? PHONE,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript({
    content: `document.addEventListener("DOMContentLoaded",function(){
      var s=document.createElement("style");
      s.textContent="nextjs-portal{display:none !important}";
      document.head.appendChild(s);
    })`,
  });
  const page = await context.newPage();
  await seed(page, shot);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  try {
    await page.goto(`${BASE_URL}${shot.path ?? "/"}`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    await page.waitForTimeout(shot.settleMs ?? (shot.path ? 2500 : 7000));
    for (const step of shot.steps ?? []) await run(page, step);
    await page.screenshot({
      path: join(OUT_DIR, `${label}.png`),
      scale: "css",
      fullPage: shot.fullPage ?? false,
    });
    console.log(`  ok  ${label}${errors.length ? `  [${errors.length} page error(s)]` : ""}`);
    for (const e of errors) console.log(`      ${e}`);
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message.split("\n")[0]}`);
    console.log(`  FAIL ${label}: ${(error as Error).message.split("\n")[0]}`);
  }
  await context.close();
}

await browser.close();
console.log(
  `\n${wanted.length - failures.length}/${wanted.length} shot(s) captured for phase ${phase}`,
);
if (failures.length) {
  console.log("failures:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
