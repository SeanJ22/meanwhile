import type { WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { recordAcquiredResponse } from "../sources/acquisition-trace.ts";
import { fetchSource, runWithSourceFetch } from "../sources/fetch-source.ts";

export type MeetingFetchPass = typeof fetch & { clear(): void };

export function meetingFetchPass(options: {
  fetchImpl?: typeof fetch;
  websiteSize?: WebsiteSizeForUrl;
} = {}): MeetingFetchPass {
  const responses = new Map<string, Promise<Response>>();
  const fetchMember: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : input instanceof Request && method !== "GET" ? await input.clone().text() : "";
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const key = `${method} ${url}\n${JSON.stringify([...headers])}\n${body}`;
    let pending = responses.get(key);
    if (!pending) {
      pending = runWithSourceFetch({ websiteSize: options.websiteSize }, () => (options.fetchImpl ?? fetchSource)(input, init));
      responses.set(key, pending);
      pending.then(response => { if (!response.ok) responses.delete(key); }, () => responses.delete(key));
    }
    const saved = await pending;
    const response = saved.clone();
    if (saved.url !== response.url) Object.defineProperty(response, "url", { value: saved.url });
    signal?.throwIfAborted();
    if (response.ok) recordAcquiredResponse({ requestedUrl: url, finalUrl: response.url || url,
      httpStatus: response.status, bytes: new Uint8Array(await response.clone().arrayBuffer()) });
    return response;
  };
  return Object.assign(fetchMember, { clear: () => responses.clear() });
}
