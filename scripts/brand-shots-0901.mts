/**
 * Brand identity captures and in-browser token probes — ITEM J, 2026-09-01.
 *
 *   pnpm exec tsx scripts/brand-shots-0901.mts --phase before
 *   pnpm exec tsx scripts/brand-shots-0901.mts --phase after
 *
 * Runs against a LOCAL production build (RULING 125). Every browser comes
 * from `launchGuarded`, so every request this script makes declares itself
 * synthetic and no beacon can leak on unload.
 *
 * What it measures, rather than what it looks at:
 *
 * - **Undeclared custom properties**, read with `getComputedStyle` on the
 *   REAL elements the app renders, in the REAL built chunk. A `var(--token)`
 *   whose token is never declared is invalid at computed-value time, so an
 *   inherited property (`color`) falls back to the inherited value and a
 *   non-inherited one (`border-color`) falls back to `currentColor`. The
 *   probe reports the computed border colour beside the computed text colour;
 *   equal means the fallback fired.
 * - **Font origin**, by recording every request URL the page makes. A single
 *   hit on fonts.googleapis.com or fonts.gstatic.com is the failure.
 * - **The six sidebar adjacency captures** — both themes, each tier tab.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "playwright";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ZIP = "85701";
const PHASE = process.argv.includes("--phase")
  ? (process.argv[process.argv.indexOf("--phase") + 1] ?? "after")
  : "after";

const OUT = join(process.cwd(), "docs", "evidence", "brand-2026-09-01", PHASE);
mkdirSync(OUT, { recursive: true });

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const fontHits: string[] = [];
const allHosts = new Set<string>();
/** Every request the captured pages made — the DENOMINATOR the font count is
 *  measured against. "Zero Google font requests" from a page that made no
 *  requests at all is not a result (RULING 159). */
let requestsSeen = 0;
/** Captures actually written, against the ones this run set out to take. */
let shotsTaken = 0;
const shotsAttempted: string[] = [];

type Theme = "dark" | "light";

async function openPage(
  browser: GuardedBrowser,
  theme: Theme,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.context({
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ zip, theme }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
        if (theme === "light") localStorage.setItem("wtp.theme", "light");
        else localStorage.removeItem("wtp.theme");
      } catch {
        /* defaults are fine */
      }
    },
    { zip: ZIP, theme },
  );
  const page = await context.newPage();
  page.on("request", (r) => {
    const url = r.url();
    try {
      const host = new URL(url).host;
      requestsSeen += 1;
      allHosts.add(host);
      if (FONT_HOSTS.some((h) => host.endsWith(h))) fontHits.push(url);
    } catch {
      /* data: and blob: urls have no host */
    }
  });
  return page;
}

/** A fresh page with NO theme forced at all — neither attribute nor colorScheme. */
async function openBare(browser: GuardedBrowser, theme: Theme): Promise<Page> {
  return openPage(browser, theme, { width: 1280, height: 900 });
}

const probes: Record<string, unknown> = {};

/**
 * The token probe, as an expression.
 *
 * tsx rewrites named functions through a `__name` helper the page does not
 * have, so every `evaluate` callback here stays expression-shaped and all the
 * logic that can live in Node lives in Node.
 */
const PROBE = `(() => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { selector: sel, found: false };
    const cs = getComputedStyle(el);
    return {
      selector: sel,
      found: true,
      color: cs.color,
      borderTopColor: cs.borderTopColor,
      borderTopStyle: cs.borderTopStyle,
      fallbackFired: cs.borderTopColor === cs.color,
    };
  };
  const root = getComputedStyle(document.documentElement);
  const tok = (n) => root.getPropertyValue(n).trim();
  return {
    dataTheme: document.documentElement.getAttribute("data-theme"),
    tokens: {
      "--mark": tok("--mark"),
      "--accent-state": tok("--accent-state"),
      "--font-record": tok("--font-record"),
      "--font-eb-garamond": tok("--font-eb-garamond"),
      "--border": tok("--border"),
      "--panel-border": tok("--panel-border"),
      "--bg": tok("--bg"),
      "--panel": tok("--panel"),
      "--panel-bg": tok("--panel-bg"),
      "--surface": tok("--surface"),
      "--text": tok("--text"),
      "--text-muted": tok("--text-muted"),
      "--link": tok("--link"),
    },
    elements: [
      read(".voting-panel"),
      read(".voting-panel-input"),
      read(".voting-jurisdiction"),
      read(".voting-site"),
      read(".jurisdiction-badge[data-badge='NEARBY']"),
      read(".jurisdiction-badge[data-badge='NO_BOUNDARY']"),
      read(".jurisdiction-badge[data-badge='COULD_GOVERN']"),
      read(".al-focus-chip"),
      read(".welcome-icon"),
      read(".wtp-logo"),
      read(".wtp-logo-square"),
      read(".brand-name"),
    ],
  };
})()`;

/**
 * THE STYLESHEET SWEEP, RUN IN THE BROWSER, AGAINST THE BUILT CHUNK.
 *
 * Reading `globals.css` proves what the source says. This reads what SHIPPED:
 * it walks every rule in every stylesheet the page actually loaded, pulls
 * every `var(--token)` out of the rule text, and asks the live document
 * whether that token resolves to anything. A token that resolves to the empty
 * string and has no fallback is a declaration that will be dropped at
 * computed-value time.
 *
 * No regular expression anywhere in here. A regex inside a template literal
 * loses its escapes: it still MATCHES, but the capture groups shift and the
 * numbers come back NaN — and `NaN > 0` is false, so a "did we find it" check
 * reports nothing found while having looked at the wrong thing.
 */
const SHEET_SWEEP = `(() => {
  const root = getComputedStyle(document.documentElement);
  const findings = [];
  const scanned = { sheets: 0, rules: 0, refs: 0 };
  const scanText = (text, where) => {
    let i = 0;
    for (;;) {
      const at = text.indexOf("var(", i);
      if (at < 0) break;
      i = at + 4;
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\\t")) j += 1;
      let k = j;
      while (
        k < text.length &&
        (text[k] === "-" ||
          text[k] === "_" ||
          (text[k] >= "a" && text[k] <= "z") ||
          (text[k] >= "A" && text[k] <= "Z") ||
          (text[k] >= "0" && text[k] <= "9"))
      ) k += 1;
      const token = text.slice(j, k);
      if (token.slice(0, 2) !== "--") continue;
      let m = k;
      while (m < text.length && text[m] === " ") m += 1;
      const hasFallback = text[m] === ",";
      scanned.refs += 1;
      if (token.slice(0, 5) === "--tw-") continue;
      const value = root.getPropertyValue(token);
      if (value.trim() !== "") continue;
      findings.push({ token: token, hasFallback: hasFallback, where: where });
    }
  };
  /*
    EVERY rule is scanned AND recursed into, in that order.

    The first version of this walked children instead of scanning whenever
    \`rule.cssRules\` was truthy — and Chromium supports nested CSS, so every
    ordinary style rule carries an EMPTY \`cssRules\` list, which is truthy.
    The sweep therefore recursed into nothing 1428 times and reported zero
    var() references in a stylesheet that is full of them: a green result
    from an instrument that never looked. Declarations are read off
    \`rule.style\` rather than out of \`cssText\`, so the property name comes
    with the finding.
  */
  const walkRules = (rules, label) => {
    for (const rule of rules) {
      scanned.rules += 1;
      const where = rule.selectorText || label;
      /*
        A rule with a \`style\` is a DECLARATION rule and its \`cssText\` is
        scanned whole — longhands enumerated off \`style\` would miss a var()
        inside a SHORTHAND, which serializes to the empty string, and the
        shorthand is exactly the case that dropped ten borders entirely.
        A grouping rule (@media, @layer, @supports) has no \`style\`, and its
        \`cssText\` contains its children, so it is only recursed into.
      */
      if (rule.style) scanText(rule.cssText || "", where);
      if (rule.cssRules && rule.cssRules.length > 0) walkRules(rule.cssRules, where);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    scanned.sheets += 1;
    walkRules(rules, sheet.href || "inline");
  }
  const unresolvedNoFallback = findings.filter((f) => !f.hasFallback);
  return {
    scanned: scanned,
    unresolvedTotal: findings.length,
    unresolvedWithoutFallback: unresolvedNoFallback.length,
    tokens: [...new Set(unresolvedNoFallback.map((f) => f.token))].sort(),
    sample: unresolvedNoFallback.slice(0, 40),
  };
})()`;

async function shoot(page: Page, name: string, selector?: string): Promise<void> {
  shotsAttempted.push(name);
  const path = join(OUT, `${name}.png`);
  if (selector) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) {
      /*
        NAMED, never absorbed. A capture script that guesses a selector, misses,
        and prints a clean summary is the exact defect RULING 159's plant
        reproduces — so the miss says which selector missed, and the run's
        capture count comes up short at the end.
      */
      console.log(`  !!  ${name}: ${selector} matched NOTHING — no capture taken`);
      return;
    }
    await el.screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
  shotsTaken += 1;
  console.log(`  ok  ${name}.png`);
}

async function main(): Promise<void> {
  console.log(`brand shots · phase=${PHASE} · base=${BASE}`);
  const browser = await launchGuarded({ label: `brand-shots-${PHASE}` });
  console.log(`  run id ${browser.runId}`);

  for (const theme of ["dark", "light"] as Theme[]) {
    // ── the welcome overlay: a page with NO seeded location ────────────────
    const welcomeCtx = await browser.context({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    await welcomeCtx.addInitScript(
      ({ theme }) => {
        try {
          if (theme === "light") localStorage.setItem("wtp.theme", "light");
          else localStorage.removeItem("wtp.theme");
        } catch {
          /* defaults are fine */
        }
      },
      { theme },
    );
    const welcome = await welcomeCtx.newPage();
    welcome.on("request", (r) => {
      try {
        const host = new URL(r.url()).host;
        requestsSeen += 1;
        allHosts.add(host);
        if (FONT_HOSTS.some((h) => host.endsWith(h))) fontHits.push(r.url());
      } catch {
        /* data: urls */
      }
    });
    await welcome.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
    await welcome.waitForTimeout(1200);
    await shoot(welcome, `welcome-${theme}`, ".welcome-card");
    await shoot(welcome, `welcome-lockup-${theme}`, ".welcome-lockup");
    probes[`welcome-${theme}`] = await welcome.evaluate(PROBE);
    await welcomeCtx.close();

    // ── the sidebar, six adjacency captures (3 tiers × 2 themes) ───────────
    const map = await openBare(browser, theme);
    await map.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
    await map.waitForTimeout(2500);
    /*
      The toggle is MULTI-select and starts with all three on, so "state
      selected" is produced by turning the other two OFF rather than by
      clicking state. The adjacency the brief asks about is the brand sitting
      an inch above a tab filled with `--tier-fill-state`, and that fill is
      only on the tabs whose `data-active` is true.
    */
    for (const tier of ["local", "state", "national"]) {
      for (const other of ["local", "state", "national"]) {
        const btn = map.locator(`.view-btn[data-tier="${other}"]`).first();
        if ((await btn.count()) === 0) {
          console.log(`  !!  sidebar ${theme}: no view-btn[data-tier="${other}"]`);
          continue;
        }
        const on = (await btn.getAttribute("data-active")) === "true";
        const want = other === tier;
        if (on !== want) {
          await btn.click({ timeout: 5000 }).catch(() => {});
          await map.waitForTimeout(250);
        }
      }
      await map.waitForTimeout(400);
      await shoot(map, `sidebar-${theme}-${tier}`, ".sidebar-header");
    }
    probes[`map-${theme}`] = await map.evaluate(PROBE);
    await map.context().close();

    // ── the ballot page: voting panel + jurisdiction badges ────────────────
    const ballot = await openBare(browser, theme);
    await ballot.goto(`${BASE}/ballot?zip=${ZIP}`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });
    await ballot.waitForTimeout(1500);
    const where = ballot.locator("button", { hasText: "Where can I vote?" }).first();
    if ((await where.count()) > 0) {
      await where.click({ timeout: 10_000 }).catch(() => {});
      await ballot.waitForTimeout(1500);
    } else {
      console.log(`  !!  ballot ${theme}: no "Where can I vote?" button found`);
    }
    await shoot(ballot, `voting-panel-${theme}`, ".voting-panel");
    probes[`ballot-${theme}`] = await ballot.evaluate(PROBE);
    probes[`sheet-sweep-${theme}`] = await ballot.evaluate(SHEET_SWEEP);
    /* The page eyebrow: the wordmark at its 18px floor, in the real app. */
    await shoot(ballot, `eyebrow-ballot-${theme}`, ".wtp-logo");
    await ballot.context().close();

    // ── the transparency page: a second 18px wordmark, on a plain surface ──
    const transparency = await openBare(browser, theme);
    await transparency.goto(`${BASE}/transparency`, {
      waitUntil: "networkidle",
      timeout: 90_000,
    });
    await transparency.waitForTimeout(600);
    await shoot(transparency, `eyebrow-transparency-${theme}`, ".wtp-logo");
    await transparency.context().close();
  }

  await browser.close();

  const report = {
    phase: PHASE,
    base: BASE,
    fontHostHits: fontHits,
    hostsContacted: [...allHosts].sort(),
    probes,
  };
  const jsonPath = join(OUT, "probe.json");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n  probe → ${jsonPath}`);

  /*
    RULING 159 — BOTH NUMBERS, AND THE DENOMINATOR IS EARNED.

    "Zero requests reached a Google font host" is only a fact about the site if
    the pages made requests at all. A run whose browser never got off the
    ground would otherwise print the same reassuring zero, so the population is
    every request the captured pages made and an empty one throws by name.
  */
  console.log(
    `  ${floorLine(
      floored(
        "requests to a Google font host",
        "every request the captured pages made",
        requestsSeen,
        fontHits.length,
      ),
    )}`,
  );
  if (fontHits.length > 0) for (const u of fontHits) console.log(`    ${u}`);

  /* The same floor over the captures: a partial run must not read as a clean
     one (RULING 100). */
  console.log(
    `  ${floorLine(
      floored("captures written", "the captures this run set out to take", shotsAttempted.length, shotsTaken),
    )}`,
  );
  if (shotsTaken !== shotsAttempted.length) {
    throw new Error(
      `${shotsAttempted.length - shotsTaken} capture(s) were not written. A capture ` +
        "set with holes in it is not evidence; the misses are named above.",
    );
  }
}

await main();
