/**
 * R40 — the personal email leaves; Feedback is the in-app form.
 *
 * The walk checks the row demands, against `SHOOT_BASE_URL` (default local):
 *
 *  - the sidebar footer renders the Feedback link and NO email anywhere;
 *  - the link opens the in-app route, not a mail client;
 *  - a synthetic-marked test submission lands in the store (204);
 *  - the forced-failure path renders honestly — the reader is told, and the
 *    text stays in the box.
 *
 * `pnpm tsx scripts/walk-r40.mts`
 */
import { chromium, type Page } from "playwright";
import { join } from "node:path";

import { syntheticRunHeaders } from "../lib/db/run-marker.ts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const HEADERS = syntheticRunHeaders();

/** Assembled, so this file is not itself a hit for the address scan. */
const ADDRESS = ["seanj22", "gmail.com"].join("@");

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function cannotRun(name: string, why: string) {
  results.push(`CANNOT-RUN ${name} — ${why}`);
}

const browser = await chromium.launch();

// ── The sidebar footer, desktop (where the rail renders) ─────────────────
{
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip: "03255", savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
    } catch {
      /* defaults are fine */
    }
  });
  const page: Page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);

  const footer = (await page.evaluate(`(() => {
    const links = [...document.querySelectorAll("a")];
    const feedback = links.find((a) => /^Feedback$/.test((a.textContent || "").trim()));
    return {
      hasLink: Boolean(feedback),
      href: feedback ? feedback.getAttribute("href") : null,
      mailtos: links.filter((a) => (a.getAttribute("href") || "").startsWith("mailto:")).length,
      bodyHasAddress: (document.body.innerText || "").includes(${JSON.stringify(ADDRESS)}),
      htmlHasAddress: document.documentElement.innerHTML.includes(${JSON.stringify(ADDRESS)}),
    };
  })()`)) as {
    hasLink: boolean;
    href: string | null;
    mailtos: number;
    bodyHasAddress: boolean;
    htmlHasAddress: boolean;
  };

  check("the sidebar footer renders the Feedback link", footer.hasLink, `href=${footer.href}`);
  check(
    "the link is the in-app route, not a mail client",
    footer.href === "/feedback",
    `href=${footer.href}`,
  );
  check(
    "no email address anywhere on the map page",
    !footer.bodyHasAddress && !footer.htmlHasAddress && footer.mailtos === 0,
    `visible text ${footer.bodyHasAddress}, served HTML ${footer.htmlHasAddress}, mailto: links ${footer.mailtos}`,
  );
  await page.screenshot({ path: join(OUT, "r40-sidebar-footer.png") });

  // /transparency, the other surface the address used to sit on — twice.
  await page.goto(`${BASE}/transparency`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const transparency = (await page.evaluate(`(() => ({
    address: document.documentElement.innerHTML.includes(${JSON.stringify(ADDRESS)}),
    mailtos: [...document.querySelectorAll("a")].filter((a) => (a.getAttribute("href") || "").startsWith("mailto:")).length,
    disclosesFeedback: /feedback form/i.test(document.body.innerText || ""),
    saysNotLicensed: /aggregated or licensed/i.test(document.body.innerText || ""),
  }))()`)) as {
    address: boolean;
    mailtos: number;
    disclosesFeedback: boolean;
    saysNotLicensed: boolean;
  };
  check(
    "/transparency carries no address and no mailto",
    !transparency.address && transparency.mailtos === 0,
    `address ${transparency.address}, mailto: links ${transparency.mailtos}`,
  );
  check(
    "/transparency discloses the feedback store, in the same commit",
    transparency.disclosesFeedback && transparency.saysNotLicensed,
    `names the form ${transparency.disclosesFeedback}, states never-licensed ${transparency.saysNotLicensed}`,
  );
  await page.context().close();
}

// ── The form: a real submission, declared synthetic ──────────────────────
{
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/feedback`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const input = page.locator("[data-feedback-input]");
  if (!(await input.isVisible().catch(() => false))) {
    cannotRun("the feedback form", "no input on /feedback");
  } else {
    const stamp = new Date().toISOString();
    await input.fill(
      `R40 walk probe ${stamp} — synthetic, from scripts/walk-r40.mts. Not a reader.`,
    );
    await page.screenshot({ path: join(OUT, "r40-form-filled.png") });

    const status = await Promise.all([
      page
        .waitForResponse((r) => r.url().includes("/api/feedback"), { timeout: 20_000 })
        .then((r) => r.status())
        .catch(() => -1),
      page.getByRole("button", { name: /Send it/i }).click(),
    ]).then(([s]) => s);

    await page.waitForTimeout(1200);
    const after = (await page.evaluate(`(() => ({
      thanked: /Got it/i.test(document.body.innerText || ""),
      error: (document.querySelector("[data-feedback-error]") || {}).textContent || null,
      stillHasText: Boolean(document.querySelector("[data-feedback-input]")),
    }))()`)) as { thanked: boolean; error: string | null; stillHasText: boolean };

    // 204 means stored; 503 means this deploy has no store attached, which is
    // an honest state and must NOT render as a thank-you.
    if (status === 204) {
      check("a synthetic-marked submission lands in the store", true, `HTTP 204, ${stamp}`);
      check("only a stored submission is thanked", after.thanked, "the thank-you rendered");
    } else if (status === 503) {
      check(
        "no store attached is told, never thanked",
        !after.thanked && Boolean(after.error),
        `HTTP 503, error rendered: ${JSON.stringify(after.error)}`,
      );
      cannotRun(
        "a synthetic-marked submission lands in the store",
        "this runtime has no DATABASE_URL, so there is no store to land in",
      );
    } else {
      check(
        "a synthetic-marked submission lands in the store",
        false,
        `HTTP ${status}, error rendered: ${JSON.stringify(after.error)}`,
      );
    }
    await page.screenshot({ path: join(OUT, "r40-form-result.png") });
  }
  await page.context().close();
}

// ── The forced-failure path: the reader is told, and keeps their text ────
{
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Force the write to fail at the network layer — the state a reader hits
  // when the server is unreachable, which must never read as success.
  await page.route("**/api/feedback", (route) => route.abort());
  await page.goto(`${BASE}/feedback`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const input = page.locator("[data-feedback-input]");
  if (!(await input.isVisible().catch(() => false))) {
    cannotRun("the forced-failure path", "no input on /feedback");
  } else {
    const typed = "R40 forced-failure probe — this submission is aborted in flight.";
    await input.fill(typed);
    await page.getByRole("button", { name: /Send it/i }).click();
    await page.waitForTimeout(1500);

    const state = (await page.evaluate(`(() => {
      const box = document.querySelector("[data-feedback-input]");
      const err = document.querySelector("[data-feedback-error]");
      return {
        thanked: /Got it/i.test(document.body.innerText || ""),
        error: err ? (err.textContent || "").trim() : null,
        textKept: box ? box.value : null,
      };
    })()`)) as { thanked: boolean; error: string | null; textKept: string | null };

    check(
      "a failed write is told plainly and never thanked",
      !state.thanked && Boolean(state.error),
      `thanked ${state.thanked}, message ${JSON.stringify(state.error)}`,
    );
    check(
      "a failed write keeps the reader's text in the box",
      state.textKept === typed,
      `kept ${JSON.stringify(state.textKept?.slice(0, 40))}`,
    );
    await page.screenshot({ path: join(OUT, "r40-form-failure.png") });
  }
  await page.context().close();
}

await browser.close();

console.log(`\nR40 walk — ${BASE}\n`);
for (const line of results) console.log("  " + line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
const could = results.filter((r) => r.startsWith("CANNOT-RUN")).length;
console.log(
  `\n${results.length - failed - could} pass · ${failed} fail · ${could} could not run\n`,
);
