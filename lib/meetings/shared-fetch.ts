import { publicFetch } from "../hunt/egress.ts";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { recordAcquiredResponse } from "../sources/acquisition-trace.ts";
import { challengeIn, curlGetText, curlRequestHeaders } from "../sources/http.ts";

/** One family pass shares successful source bytes, including companion feeds.
 * Each adapter still attributes those bytes inside its own acquisition scope. */
export function meetingFetchPass(options: {
  fetchImpl?: typeof fetch;
  curl?: typeof curlGetText;
  websiteSize?: WebsiteSizeForUrl;
} = {}): typeof fetch {
  const requests = new Map<string, number>();
  const responses = new Map<string, Promise<Response>>();
  const take = (url: string) => {
    const site = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const count = requests.get(site) ?? 0;
    const limit = websiteRequestLimit(options.websiteSize?.(url));
    if (limit !== null && count >= limit) {
      throw new Error(`Meeting source ${site}: shared website request bound reached; held meetings remain available for the next pass`);
    }
    requests.set(site, count + 1);
  };
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const key = `${init?.method ?? (input instanceof Request ? input.method : "GET")} ${url}`;
    let pending = responses.get(key);
    if (!pending) {
      pending = (async () => {
        take(url);
        let response = await (options.fetchImpl ?? publicFetch)(input, init);
        // Retain the adapter's existing identified curl fallback. Both
        // transports spend from the same website allowance.
        if (response.status === 403 || (response.ok && challengeIn(await response.clone().text()) !== null)) {
          take(url);
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          const result = await (options.curl ?? curlGetText)(url, curlRequestHeaders(headers.get("accept") ?? undefined), signal ?? undefined);
          response = new Response(new Uint8Array(result.bytes).buffer, { status: result.status, headers: { "content-type": result.contentType } });
          Object.defineProperty(response, "url", { value: result.finalUrl || url });
        }
        if (!response.ok || challengeIn(await response.clone().text()) !== null) responses.delete(key);
        return response;
      })();
      responses.set(key, pending);
      pending.catch(() => { if (responses.get(key) === pending) responses.delete(key); });
    }
    const saved = await pending;
    const response = saved.clone();
    if (saved.url !== response.url) Object.defineProperty(response, "url", { value: saved.url });
    signal?.throwIfAborted();
    if (response.ok) recordAcquiredResponse({ requestedUrl: url, finalUrl: response.url || url,
      httpStatus: response.status, bytes: new Uint8Array(await response.clone().arrayBuffer()) });
    return response;
  };
}
