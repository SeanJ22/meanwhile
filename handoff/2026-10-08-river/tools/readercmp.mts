/* Load reader pages at the same places and keep what renders and what each data call answered. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { launchGuarded } from "../scripts/browser.mts";

const BASE = process.env.READERCMP_BASE ?? "http://localhost:3000";
const OUT = process.env.READERCMP_OUT!;
const ZIPS = ["02916", "07432", "17032", "22749", "38879", "46052", "54947", "55310", "96731", "99020", "85701", "03301"];
const PAGES = (zip: string) => [`/?zip=${zip}`, `/ballot?zip=${zip}`, `/about-area?zip=${zip}`];
/* Relative times move between runs; they are not page content. */
const steady = (text: string) => text.replace(/\b\d+ (second|minute|hour|day|week|month)s? ago\b/g, "<ago>").replace(/\b(just now|today|yesterday)\b/gi, "<when>");

const browser = await launchGuarded({ label: "readercmp", executablePath: "/opt/pw-browsers/chromium", blockWrites: true } as never);
const rows: unknown[] = [];
for (const zip of ZIPS) {
  for (const path of PAGES(zip)) {
    const page = await browser.page();
    const calls: { path: string; status: number; sha: string }[] = [];
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/") || response.request().method() !== "GET") return;
      let body = "";
      try { body = await response.text(); } catch { body = "<unread>"; }
      calls.push({ path: `${url.pathname}${url.search}`, status: response.status(), sha: createHash("sha256").update(steady(body)).digest("hex").slice(0, 16) });
    });
    const started = Date.now();
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60_000 }).catch(() => null);
    const loadMs = Date.now() - started;
    await page.waitForTimeout(8_000);
    const text = steady(await page.innerText("body").catch(() => ""));
    rows.push({ zip, path, status: response?.status() ?? null, loadMs, text, calls: calls.sort((a, b) => a.path.localeCompare(b.path)) });
    console.log(zip, path, response?.status(), loadMs, text.length, calls.length);
    await page.context().close();
  }
}
await browser.close();
writeFileSync(OUT, JSON.stringify(rows, null, 2));
