/**
 * **THE SCOUT'S REAL BROWSER.** (Level 1 activation, 2026-09-01.)
 *
 * `BrowseFn` for `scout-tools.ts`, opened through `launchGuarded` — the only
 * permitted construction site (R50; `tests/browser-construction.test.ts`).
 * Bytes are NOT vaulted here; the toolkit vaults what this observes.
 *
 * Invariants: the browser is always closed; `networkidle` is bounded and its
 * absence is not a failure (a chatty page still loaded); the page evaluate is a
 * string expression, because tsx's `__name` helper does not exist in the page.
 */

import { DEFAULT_USER_AGENT } from "../lib/control-plane/scheduler/route-executor.ts";
import type { BrowseFn, BrowseObservation } from "../lib/control-plane/scheduler/scout-contract.ts";
import { launchGuarded } from "./browser.mts";

type Observed = {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
  contentType: string | null;
};

/** How long after `load` to wait for the network to go quiet before giving up on it. */
const NETWORK_IDLE_CAP_MS = 10_000;

export const browseWithPlaywright: BrowseFn = async ({ url, timeoutMs }) => {
  const started = Date.now();
  const requests: Observed[] = [];
  const browser = await launchGuarded({ label: "scout-browse", headless: true });
  try {
    const page = await browser.page({ userAgent: DEFAULT_USER_AGENT });
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
        await page.waitForLoadState("networkidle", { timeout: Math.min(remaining, NETWORK_IDLE_CAP_MS) });
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
    await browser.close();
  }
};
