import { assertPublicUrl } from "../lib/hunt/egress.ts";
/**
 * The scout's real browser: `BrowseFn` for `scout-tools.ts`, opened through
 * `launchGuarded`, the only permitted construction site. Bytes are not vaulted
 * here; the toolkit vaults what this observes.
 *
 * Invariants: the browser is always closed; `networkidle` is bounded and its
 * absence is not a failure; the page evaluate is a string expression, because
 * tsx's `__name` helper does not exist in the page.
 */

import { DEFAULT_USER_AGENT } from "../lib/control-plane/scheduler/route-executor.ts";
import type { BrowseFn, BrowseObservation } from "../lib/control-plane/scheduler/scout-contract.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

type Observed = {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
  contentType: string | null;
};

/** How long after `load` to wait for the network to go quiet before giving up on it. */
const NETWORK_IDLE_CAP_MS = 10_000;

async function observe(browser: GuardedBrowser, { url, timeoutMs }: Parameters<BrowseFn>[0]): Promise<BrowseObservation> {
  assertPublicUrl(url);
  const started = Date.now();
  const requests: Observed[] = [];
  const page = await browser.page({ userAgent: DEFAULT_USER_AGENT });
  try {
    page.on("request", (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        status: null,
        resourceType: request.resourceType(),
        contentType: null,
      });
    });
    page.on("response", (response) => {
      const requestUrl = response.url();
      const method = response.request().method();
      /* The most recent unanswered entry for this url+method is the one this answers. */
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
export function sharedScoutBrowser(launch: () => Promise<GuardedBrowser> = () => launchGuarded({ label: "scout-browse", headless: true, publicSourcesOnly: true })) {
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
