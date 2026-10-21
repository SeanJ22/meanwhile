import { pageAddress } from "../doors/page-doors.ts";
import { evaluatePermission } from "../control-plane/scheduler/robots.ts";
import { DEFAULT_USER_AGENT } from "../control-plane/scheduler/user-agent.ts";
import type { VotingSourceAttempt, VotingSourceRuntime } from "./voting-source-types.ts";

export interface VotingCapture { url: string; contentType: string; bytes: Uint8Array }
export interface VotingFetchSession {
  attempts: VotingSourceAttempt[];
  rawBodies: VotingCapture[];
  get: (url: string, init?: RequestInit) => Promise<VotingCapture>;
}
const blockedBody = (text: string) => /(?:<title>[^<]*(?:access denied|just a moment|attention required)|cf-chl-|g-recaptcha|h-captcha|captcha-container|name=["']password["'])/i.test(text);
function publicUrl(value: string): URL {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("Only public election source URLs may be read");
  return url;
}

export function votingFetchSession(runtime: VotingSourceRuntime): VotingFetchSession {
  const attempts: VotingSourceAttempt[] = [], rawBodies: VotingCapture[] = [];
  const robots = new Map<string, { text: string | null; status: number | null; error: string | null; type: string | null }>();
  const recorded = new Set<string>();
  const send = async (url: string, init: RequestInit, route: "direct" | "browser-ua") => {
    const fetcher = route === "browser-ua" ? runtime.browserFetch : runtime.fetch;
    if (!fetcher) throw new Error("Browser-UA rung unavailable; follow the next official route");
    if (Object.keys(init.headers ?? {}).some(key => /^(?:authorization|cookie|proxy-authorization)$/i.test(key))) throw new Error("Authenticated election source requests are forbidden");
    const response = await fetcher(url, { ...init, redirect: "manual", credentials: "omit", signal: init.signal ?? AbortSignal.timeout(20_000), headers: { "user-agent": DEFAULT_USER_AGENT, ...init.headers } });
    attempts.push({ url, route, outcome: `HTTP ${response.status}` });
    return response;
  };
  const readRobots = async (url: URL) => {
    if (!robots.has(url.origin)) {
      try {
        let at = new URL("/robots.txt", url); let response = await send(at.href, {}, "direct");
        if ([403, 503].includes(response.status) && runtime.browserFetch) response = await send(at.href, {}, "browser-ua");
        for (let hops = 0; response.status >= 300 && response.status < 400 && hops < 5; hops++) {
          const location = response.headers.get("location"); if (!location) break;
          const next = publicUrl(new URL(location, at).href);
          // A cross-origin robots redirect is not permission to read that host's pages.
          if (next.origin !== url.origin) throw new Error("robots.txt redirects to another host");
          at = next; response = await send(at.href, {}, "direct");
        }
        const text = await response.text(), type = response.headers.get("content-type");
        robots.set(url.origin, { text, status: response.status, error: null, type });
        rawBodies.push({ url: at.href, contentType: type ?? "text/plain", bytes: new TextEncoder().encode(text) });
      } catch (error) { robots.set(url.origin, { text: null, status: null, error: String(error), type: null }); }
    }
    const read = robots.get(url.origin)!;
    const permission = evaluatePermission({ robotsText: read.text, status: read.status, transportError: read.error, contentType: read.type }, url.href);
    // Evidence, never a refusal: what robots.txt said about this page is kept with the read, and the read goes on.
    const noted = `${url.origin}${url.pathname}|${permission.verdict}`;
    if (permission.verdict !== "ALLOWED" && !recorded.has(noted)) {
      recorded.add(noted);
      attempts.push({ url: new URL("/robots.txt", url).href, route: "direct",
        outcome: `robots.txt ${permission.verdict} for ${url.pathname}${permission.crawlDelayMs ? ` (crawl-delay ${permission.crawlDelayMs} ms)` : ""}: ${permission.detail} — recorded as evidence; the public page is still read` });
    }
  };
  const fetchCapture = async (value: string, init: RequestInit = {}): Promise<VotingCapture> => {
    let url = publicUrl(value);
    for (let hops = 0; hops < 8; hops++) {
      if (runtime.deadlineMs !== undefined && Date.now() >= runtime.deadlineMs) throw new Error("Reader lookup deadline reached");
      await readRobots(url);
      let response = await send(url.href, init, "direct");
      if ([403, 503].includes(response.status) && runtime.browserFetch) {
        response = await send(url.href, init, "browser-ua");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location"); if (!location) throw new Error("Source redirect has no location");
        const next = publicUrl(new URL(location, url).href);
        url = next; continue;
      }
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}${response.headers.get("retry-after") ? `; retry after ${response.headers.get("retry-after")}` : ""}`);
      const bytes = new Uint8Array(await response.arrayBuffer()), contentType = response.headers.get("content-type") ?? "";
      if ((contentType.includes("html") || bytes[0] === 60) && blockedBody(new TextDecoder().decode(bytes))) throw new Error("Source presents a CAPTCHA, login, or bot wall; follow the next official route");
      const capture = { url: url.href, contentType, bytes }; rawBodies.push(capture); return capture;
    }
    throw new Error("Source redirect chain did not resolve");
  };
  const get = async (value: string, init: RequestInit = {}): Promise<VotingCapture> => {
    if (!runtime.captureCache || init.body || (init.method ?? "GET") !== "GET") return fetchCapture(value, init);
    const key = pageAddress(value)?.url ?? value;
    const held = runtime.captureCache.get(key);
    if (held) {
      const captures = await held;
      rawBodies.push(...captures);
      attempts.push({ url: value, route: "direct", outcome: "Held capture reused in this pass" });
      return captures.at(-1)!;
    }
    const start = rawBodies.length;
    const pending = fetchCapture(value, init).then(() => rawBodies.slice(start));
    runtime.captureCache.set(key, pending);
    try { return (await pending).at(-1)!; }
    catch (error) { runtime.captureCache.delete(key); throw error; }
  };
  return { attempts, rawBodies, get };
}
