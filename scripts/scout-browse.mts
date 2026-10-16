import { fetchSource, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { DEFAULT_USER_AGENT } from "../lib/control-plane/scheduler/route-executor.ts";
import type { BrowseFn, BrowseObservation } from "../lib/control-plane/scheduler/scout-contract.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";
import type { Page } from "playwright";
import type { WebsiteSize } from "../lib/control-plane/scheduler/host-supervision.ts";
import { websiteOf } from "../lib/control-plane/website-pacing.ts";

type Observed = {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
  contentType: string | null;
};

/** How long after `load` to wait for the network to go quiet before giving up on it. */
const NETWORK_IDLE_CAP_MS = 10_000;

export async function routeSourceRequests(page: Page, url: string, timeoutMs: number, websiteSize?: WebsiteSize | null): Promise<void> {
  const started = Date.now(), sourceHost = websiteOf(url);
  await page.route("**/*", async route => {
    const request = route.request(), target = request.url();
    if (!/^https?:/i.test(target)) { await route.abort(); return; }
    try {
      const response = await runWithSourceFetch(websiteSize && websiteOf(target) === sourceHost ? { websiteSize } : {},
        () => fetchSource(target, { method: request.method(), headers: request.headers(), body: request.postData(), redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, timeoutMs - (Date.now() - started))) }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch { await route.abort(); }
  });
}

async function observe(browser: GuardedBrowser, { url, timeoutMs, websiteSize }: Parameters<BrowseFn>[0]): Promise<BrowseObservation> {
  const started = Date.now();
  const requests: Observed[] = [];
  const page = await browser.page({ userAgent: DEFAULT_USER_AGENT });
  try {
    await routeSourceRequests(page, url, timeoutMs, websiteSize);
    page.on("request", request => {
      requests.push({ url: request.url(), method: request.method(), status: null, resourceType: request.resourceType(), contentType: null });
    });
    page.on("response", response => {
      const requestUrl = response.url(), method = response.request().method();
      for (let i = requests.length - 1; i >= 0; i -= 1) {
        const entry = requests[i];
        if (entry.url === requestUrl && entry.method === method && entry.status === null) {
          entry.status = response.status();
          entry.contentType = response.headers()["content-type"] ?? null;
          break;
        }
      }
    });

    let status: number | null = null;
    let transportError: string | null = null;
    try {
      const response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
      status = response ? response.status() : null;
      const remaining = Math.max(0, timeoutMs - (Date.now() - started));
      try {
        // Playwright interprets zero as no deadline, not as no time left.
        if (remaining > 0) await page.waitForLoadState("networkidle", { timeout: Math.min(remaining, NETWORK_IDLE_CAP_MS) });
      } catch {
        /* A page that never goes idle still loaded; what it fetched is in `requests`. */
      }
    } catch (error) {
      transportError = error instanceof Error ? error.message : String(error);
    }

    let html = "";
    let text = "";
    if (transportError === null) {
      html = await page.content();
      text = String(await page.evaluate("document.body ? document.body.innerText : ''"));
    }

    const observation: BrowseObservation = {
      finalUrl: page.url(),
      status,
      html,
      text,
      requests: requests.map((r) => ({ ...r })),
      transportError,
      durationMs: Date.now() - started,
    };
    return observation;
  } finally {
    await page.context().close();
  }
}
/** One lazy browser for the fleet; every observation closes its own guarded context. */
export function sharedScoutBrowser(launch: () => Promise<GuardedBrowser> = () => launchGuarded({ label: "scout-browse", headless: true })) {
  let browser: Promise<GuardedBrowser> | null = null;
  return {
    browse: (async input => {
      browser ??= launch().catch(error => { browser = null; throw error; });
      return observe(await browser, input);
    }) satisfies BrowseFn,
    close: async () => { if (browser) await (await browser).close(); browser = null; },
  };
}

export const browseWithPlaywright: BrowseFn = async input => {
  const url = process.env.WTP_WORKER_TOOLS_URL;
  if (url) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json",
      authorization: process.env.WTP_WORKER_TOOLS_TOKEN ?? "" }, body: JSON.stringify({ kind: "browse", body: input }),
      signal: AbortSignal.timeout(input.timeoutMs + 5_000) });
    if (!response.ok) throw new Error(`SHARED_BROWSER_FAILED:${response.status}`);
    return await response.json() as BrowseObservation;
  }
  const browser = sharedScoutBrowser();
  try { return await browser.browse(input); }
  finally { await browser.close(); }
};
