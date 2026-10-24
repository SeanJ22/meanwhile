/** Open the real reader pages in Chrome. The shared browser harness blocks writes. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const browser = await launchGuarded({ label: "rb-a6-reader", blockWrites: true, executablePath: process.env.RB_A6_CHROME,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined, args: ["--no-sandbox"] });
const context = await browser.context({ viewport: { width: 1440, height: 1000 } });
const results = [];
mkdirSync(".scratch/rb-a6-reader", { recursive: true });
try {
  for (const zip of ["85003", "19147", "98101"]) {
    const page = await context.newPage();
    const started = performance.now();
    const response = await page.goto(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);
    await page.getByText(/election/i).first().waitFor({ state: "visible" });
    writeFileSync(`.scratch/rb-a6-reader/${zip}-first.txt`, await page.locator("body").innerText());
    if (zip === "85003") await page.getByText(/November 3(?:rd)?,? 2026/).first().waitFor({ state: "visible" });
    const text = await page.locator("body").innerText();
    assert.ok(text.length > 1000, "The reader has usable ballot content");
    const date = text.match(/[^\n]*November 3(?:rd)?,? 2026[^\n]*/)?.[0] ?? null;
    if (zip === "85003") assert.ok(date?.includes("November 3"), "Phoenix keeps its Election Day");
    await page.screenshot({ path: `.scratch/rb-a6-reader/${zip}.png`, fullPage: false });
    writeFileSync(`.scratch/rb-a6-reader/${zip}.txt`, text);
    results.push({ zip, status: response!.status(), readyMs: Math.round(performance.now() - started), chars: text.length, election: date,
      electionOffice: text.match(/[^\n]*(?:Secretary of State|Elections Division|Bureau of Commissions)[^\n]*/g) ?? [] });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}
writeFileSync(".scratch/rb-a6-reader/results.json", JSON.stringify({ observedAt: new Date().toISOString(), runId: browser.runId,
  browser: "Google Chrome for Testing", writesBlocked: browser.writesBlocked.count, results }, null, 2) + "\n");
