/** Inspect the actual route's materialized HTML from the read-only BA-02 production replay. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { launchGuarded } from "./browser.mts";

const replay = JSON.parse(await readFile("data/ballot/reports/ba02-replay.json", "utf8")) as {
  states: { state: string; zipReadbacks: { zip: string; pageQuestionCount: number; pagePickCount: number; absences: string[] }[] }[];
};
const states = process.argv.find(arg => arg.startsWith("--states="))?.slice(9).split(",") ?? ["AZ", "SC", "AS", "GU", "PR"];
const output = ".scratch/ba02-pages";
await mkdir(output, { recursive: true });
const cssPrefix = pathToFileURL(resolve(".next/static/chunks")).href + "/";
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (/^\/pages\/\d{5}\.html$/.test(path)) {
      const html = await readFile(resolve(output, path.slice(7)), "utf8");
      response.setHeader("content-type", "text/html; charset=utf-8"); response.end(html.replaceAll(cssPrefix, "/css/"));
    } else if (/^\/(?:css|media)\/[a-zA-Z0-9_.-]+$/.test(path)) {
      const [, kind, name] = path.split("/");
      response.setHeader("content-type", kind === "css" ? "text/css" : "application/octet-stream");
      response.end(await readFile(resolve(".next/static", kind === "css" ? "chunks" : "media", name)));
    } else { response.statusCode = 404; response.end(); }
  } catch { response.statusCode = 500; response.end(); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await launchGuarded({ label: "ba02-route-replay-visual", blockWrites: true, headless: true });
const reports: Record<string, unknown>[] = [];
try {
  for (const state of states) {
    const expected = replay.states.find(row => row.state === state)?.zipReadbacks[0]; assert.ok(expected, `${state}: completed replay required`);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.page({ viewport });
      await page.route("https://**", route => route.abort());
      await page.route("http://**", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      try {
        await page.goto(`${origin}/pages/${expected.zip}.html`, { waitUntil: "load" });
        assert.equal(await page.locator("[data-retention-question]").count(), expected.pageQuestionCount);
        assert.equal(await page.locator('[data-kind="pick"]').count(), expected.pagePickCount);
        const dom = await page.evaluate(() => ({
          questions: [...document.querySelectorAll<HTMLElement>("[data-retention-question]")].map(element => ({ text: element.innerText, visible: element.getBoundingClientRect().height > 0 })),
          picks: [...document.querySelectorAll<HTMLElement>('[data-kind="pick"]')].map(element => ({ buttons: element.querySelectorAll("button").length, visible: element.getBoundingClientRect().height > 0 })),
          text: document.body.innerText, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        }));
        assert.ok(dom.questions.every(row => row.visible && row.text.length > 10));
        assert.ok(dom.picks.every(row => row.visible && row.buttons > 0));
        if (state === "AS") assert.doesNotMatch(dom.text, /State House contests aren't shown/);
        for (const absence of expected.absences) assert.ok(dom.text.includes(absence));
        assert.equal(dom.horizontalOverflow, false);
        const target = state === "PR" ? page.locator('main') : expected.pageQuestionCount > 0
          ? page.locator('[data-contest-id]').filter({ has: page.locator('[data-retention-question]') }).first()
          : page.locator('[data-kind="pick"]').first();
        await target.scrollIntoViewIfNeeded();
        const screenshot = `${output}/${state.toLowerCase()}-${viewport.width}.png`;
        await page.screenshot({ path: screenshot });
        reports.push({ state, zip: expected.zip, viewport, questionCount: dom.questions.length, pickControlCount: dom.picks.length,
          source: "Actual app/ballot/page.tsx route after ordinary publication into isolated memory; materialized HTML, compiled application CSS, real React PickControl SSR. Client event hydration is not part of this visual check.", screenshot, horizontalOverflow: dom.horizontalOverflow });
        console.log(`${state}/${expected.zip}/${viewport.width}: visible questions and buttons verified`);
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
await writeFile("data/ballot/reports/ba02-pages.json", JSON.stringify({ checkedAt: new Date().toISOString(), productionWrites: 0, reports }, null, 2) + "\n");
