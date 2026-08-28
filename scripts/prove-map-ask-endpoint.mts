import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

/**
 * **WHICH ENDPOINT THE MAP ASK INPUT ACTUALLY CALLS.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * A source grep proves what the file says. A rendered panel proves a reply was
 * rendered. Neither is the same as watching the request leave the browser, and
 * the defect this session opened on was precisely a surface that looked right
 * and called something else.
 *
 * So this types one question into the real map Ask input and records every
 * request the page makes to `/api/ask/*`, in order, with its status. It asserts
 * nothing — it reports, and the report is the evidence.
 */

const BASE = (process.env.ASK_WALK_BASE ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const OUT = process.argv[2] ?? "data/hunt/map-ask-endpoint.json";
const ZIP = "85641";

const guarded = await launchGuarded({
  label: "prove-map-ask-endpoint",
  now: () => new Date("2026-08-28T00:00:00Z"),
});

const context = await guarded.context({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await context.addInitScript(
  ({ zip }) => {
    try {
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip, savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
      sessionStorage.setItem(
        "wtp.location_origin",
        JSON.stringify({ zip, origin: "TYPED_ZIP" }),
      );
    } catch {
      /* A browser refusing storage lands on the welcome card, which the report
         would show as an absent input rather than as a passing run. */
    }
  },
  { zip: ZIP },
);

const page = await context.newPage();

const asks: { method: string; url: string; status: number | null }[] = [];
page.on("request", (r) => {
  if (r.url().includes("/api/ask/")) {
    asks.push({ method: r.method(), url: new URL(r.url()).pathname, status: null });
  }
});
page.on("response", (r) => {
  if (!r.url().includes("/api/ask/")) return;
  const path = new URL(r.url()).pathname;
  const row = [...asks].reverse().find((a) => a.url === path && a.status === null);
  if (row) row.status = r.status();
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(5000);
if ((await page.locator("[data-ask-panel]").count()) === 0) {
  await page.locator("[data-ask-pill]").first().click();
  await page.waitForTimeout(1500);
}

const input = await page.$("[data-ask-box]");
const report: Record<string, unknown> = { base: BASE, inputFound: Boolean(input) };
if (input) {
  await input.click();
  await input.fill("What's on the Vail school district agenda?");
  await input.press("Enter");
  await page.waitForTimeout(16_000);

  report.rendered = await page.evaluate(
    `(function () {
      var g = document.querySelector("[data-ask-grounded]");
      return {
        present: !!g,
        mode: g ? g.getAttribute("data-ask-grounded-mode") : null,
        subject: g ? g.getAttribute("data-ask-grounded-subject") : null
      };
    })()`,
  );
}
report.askRequests = asks;

await guarded.close();
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
