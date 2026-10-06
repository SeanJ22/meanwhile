import type { GuardedBrowser } from "../../scripts/browser.mts";
import type { PublishedFactSample, PublicationVitals } from "./publication-vitals.ts";

/** Use the runner's supervised guarded browser job. This reader starts no
 * browser or paid provider access and closes its page on every outcome.
 * Field selectors are CSS relative to the exact record container; hidden or
 * duplicated fields cannot satisfy the live check.
 */
export async function readPublishedFactPage(browser: Pick<GuardedBrowser, "page">, sample: PublishedFactSample): Promise<
  Awaited<ReturnType<Parameters<PublicationVitals["sample"]>[0]>>
> {
  const url = new URL(sample.url);
  if (url.protocol !== "https:" || url.hostname !== "meanwhileusa.com" || url.username || url.password || url.port ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) throw Error("PUBLICATION_VITAL_PUBLIC_PAGE_REQUIRED");
  const page = await browser.page();
  try {
    const response = await page.goto(sample.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (response?.status() !== 200 || page.url() !== sample.url) return { url: page.url(), status: response?.status() ?? 0, matches: [] };
    const records = page.locator(`css=${sample.selector}`);
    await records.first().waitFor({ state: "visible", timeout: 15_000 });
    const matches: { fields: Record<string, string[]> }[] = [];
    for (const record of await records.all()) {
      if (!await record.isVisible()) continue;
      const fields: Record<string, string[]> = {};
      for (const field of sample.fields) {
        fields[field.selector] = [];
        for (const value of await record.locator(`css=${field.selector}`).all()) {
          if (await value.isVisible()) fields[field.selector].push(await value.innerText({ timeout: 5_000 }));
        }
      }
      matches.push({ fields });
      // Two containers already establish ambiguity; do not walk the page.
      if (matches.length === 2) break;
    }
    return { url: page.url(), status: response.status(), matches };
  } finally { await page.close(); }
}
