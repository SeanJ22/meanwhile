import type { Route } from "playwright";
import { publicFetch } from "./egress.ts";
import { readCompleteResponse } from "../sources/source-bytes.ts";

/** Browser DNS never gets a second chance to resolve a checked source hostname. */
export async function fulfillPublicSourceRoute(route: Route, headers: Record<string, string>, fetchImpl: typeof fetch = publicFetch, signal?: AbortSignal): Promise<void> {
  const request = route.request();
  try {
    const payload = request.postDataBuffer();
    const response = await fetchImpl(request.url(), {
      method: request.method(), headers, redirect: "manual",
      body: payload ? new Uint8Array(payload).buffer : undefined,
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    const noBody = request.method() === "HEAD" || [204, 205, 304].includes(response.status);
    const body = noBody ? new Uint8Array(0) : await readCompleteResponse(response, 16 * 1024 * 1024);
    const responseHeaders = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) responseHeaders["set-cookie"] = cookies.join("\n");
    // The checked transport has decoded compressed bytes. Playwright's fulfill
    // computes the length of the actual body delivered to the browser.
    if (!noBody) delete responseHeaders["content-length"];
    await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(body) });
  } catch {
    await route.abort("blockedbyclient").catch(() => {});
  }
}
