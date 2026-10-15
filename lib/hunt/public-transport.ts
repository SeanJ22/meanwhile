/** A source-only fetch. DNS is checked once per hop and the socket uses that saved IP. */
import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Duplex } from "node:stream";
import { assertPublicUrl, EgressRefusal, MAX_PUBLIC_REDIRECTS, publicRedirectHeaders, resolvePublicTarget, systemPublicLookup,
  type PublicLookup, type PublicTarget } from "./egress.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
type ProxyEnvironment = Readonly<Record<string, string | undefined>>;
type PinnedRequest = (target: PublicTarget, request: { method: string; headers: Headers; body: Uint8Array | undefined; signal: AbortSignal }, proxy: URL | null) => Promise<Response>;

type PublicAddress = PublicTarget["addresses"][number];
const DNS_TTL_MS = 30_000;
const AGENTS_KEPT = 256;
const DNS_ANSWERS_KEPT = 4096;
const agents = new Map<string, http.Agent | https.Agent>();

/** One lookup per host per half minute, shared by concurrent callers; failures are never kept. Every answer is still checked on use. */
export function sharedLookup(lookup: PublicLookup, now: () => number = Date.now): PublicLookup {
  const answers = new Map<string, { at: number; addresses: Promise<readonly PublicAddress[]> }>();
  return host => {
    const held = answers.get(host);
    if (held && now() - held.at < DNS_TTL_MS) return held.addresses;
    const addresses = lookup(host);
    addresses.catch(() => { if (answers.get(host)?.addresses === addresses) answers.delete(host); });
    answers.delete(host);
    answers.set(host, { at: now(), addresses });
    if (answers.size > DNS_ANSWERS_KEPT) answers.delete(answers.keys().next().value!);
    return addresses;
  };
}
const sharedSystemLookup = sharedLookup(systemPublicLookup);

/** One keep-alive agent per checked host, port and IP, so a socket is only ever reused for the destination that was checked. */
function pooledAgent(url: URL, selected: PublicAddress): http.Agent | https.Agent {
  const key = `${url.protocol}//${url.host}|${selected.address}`;
  const held = agents.get(key);
  if (held) { agents.delete(key); agents.set(key, held); return held; }
  const options = { keepAlive: true, maxSockets: 4, maxFreeSockets: 2, timeout: 10_000 };
  const agent = url.protocol === "https:" ? new https.Agent(options) : new http.Agent(options);
  agents.set(key, agent);
  if (agents.size > AGENTS_KEPT) {
    const [oldKey, oldest] = agents.entries().next().value!;
    agents.delete(oldKey);
    // Idle sockets close now; any still in a request close when it finishes.
    oldest.maxFreeSockets = 0;
    for (const sockets of Object.values(oldest.freeSockets)) for (const socket of sockets ?? []) socket.destroy();
  }
  return agent;
}

class StaleSocket extends Error {}

/** Proxy configuration is operator-owned. CONNECT still names the checked destination IP. */
export function publicProxyFor(url: URL, env: ProxyEnvironment = process.env): URL | null {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const exclusions = (env.no_proxy ?? env.NO_PROXY ?? "").split(/[\s,]+/).filter(Boolean);
  for (const exclusion of exclusions) {
    if (exclusion === "*") return null;
    const token = exclusion.toLowerCase();
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(token);
    if (!match || (match[2] && match[2] !== port)) continue;
    const host = match[1].replace(/^\[|\]$/g, "").replace(/^\*?\./, "");
    if (hostname === host || hostname.endsWith(`.${host}`)) return null;
  }
  const configured = (url.protocol === "https:" ? env.https_proxy ?? env.HTTPS_PROXY : env.http_proxy ?? (env.REQUEST_METHOD ? undefined : env.HTTP_PROXY)) ?? env.all_proxy ?? env.ALL_PROXY;
  if (!configured) return null;
  let proxy: URL;
  try { proxy = new URL(configured); } catch { throw new EgressRefusal("invalid configured source proxy"); }
  if (!["http:", "https:"].includes(proxy.protocol)) throw new EgressRefusal("source proxy must support HTTP CONNECT; refusing an unsupported proxy without bypassing it");
  return proxy;
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function proxyTunnel(target: PublicTarget, proxy: URL, signal: AbortSignal): Promise<Duplex> {
  const selected = target.addresses.find(address => address.family === 4) ?? target.addresses[0];
  const port = target.url.port || (target.url.protocol === "https:" ? "443" : "80");
  const authority = `${selected.family === 6 ? `[${selected.address}]` : selected.address}:${port}`;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: authority };
    if (proxy.username || proxy.password) headers["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    const connect = (proxy.protocol === "https:" ? https : http).request({
      protocol: proxy.protocol, hostname: proxy.hostname.replace(/^\[|\]$/g, ""),
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80), method: "CONNECT", path: authority,
      headers, signal, agent: false,
    });
    connect.once("error", reject);
    connect.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200 || head.length) {
        socket.destroy(); reject(new EgressRefusal("configured proxy refused the checked source tunnel")); return;
      }
      // This is the only exception to public IP checks: the operator's proxy.
      // It receives an IP CONNECT target, never a hostname to resolve again.
      resolve(socket);
    });
    connect.end();
  });
}

/** Uses core Node sockets; no fallback to global fetch, a global dispatcher or a second DNS lookup. */
export const requestPinned: PinnedRequest = async (target, input, proxy) => {
  try { return await sendPinned(target, input, proxy, true); }
  catch (error) {
    if (!(error instanceof StaleSocket)) throw error;
    return sendPinned(target, input, proxy, false);
  }
};

async function sendPinned(target: PublicTarget, input: Parameters<PinnedRequest>[1], proxy: URL | null, pooled: boolean): Promise<Response> {
  input.signal.throwIfAborted();
  const url = target.url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const selected = target.addresses.find(address => address.family === 4) ?? target.addresses[0];
  let socket: Duplex | undefined;
  let agent: http.Agent | https.Agent | undefined;
  if (proxy) {
    socket = await proxyTunnel(target, proxy, input.signal);
    if (url.protocol === "https:") {
      const secured = tls.connect({ socket: socket as import("node:net").Socket,
        servername: host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host,
        checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(host, certificate) });
      const abort = () => secured.destroy(input.signal.reason instanceof Error ? input.signal.reason : new Error("source request aborted"));
      input.signal.addEventListener("abort", abort, { once: true });
      try { await abortable(new Promise<void>((resolve, reject) => { secured.once("secureConnect", resolve); secured.once("error", reject); }), input.signal); }
      catch (error) { secured.destroy(); throw error; }
      finally { input.signal.removeEventListener("abort", abort); }
      socket = secured;
    }
    agent = url.protocol === "https:" ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
    const approvedSocket = socket;
    agent.createConnection = () => approvedSocket as import("node:net").Socket;
  }
  return new Promise((resolve, reject) => {
    const headers = new Headers(input.headers);
    for (const name of HOP_HEADERS) headers.delete(name);
    headers.set("host", url.host);
    if (proxy || !pooled) headers.set("connection", "close");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");
    if (input.body) headers.set("content-length", String(input.body.byteLength));
    else headers.delete("content-length");
    const request = (url.protocol === "https:" ? https : http).request({
      protocol: url.protocol, hostname: proxy ? host : selected.address, family: proxy ? undefined : selected.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80), path: `${url.pathname}${url.search}`,
      method: input.method, headers: Object.fromEntries(headers), agent: agent ?? (pooled ? pooledAgent(url, selected) : false), signal: input.signal,
      ...(url.protocol === "https:" ? {
        servername: host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host,
        checkServerIdentity: (_name: string, certificate: tls.PeerCertificate) => tls.checkServerIdentity(host, certificate),
      } : {}),
    });
    request.once("error", error => {
      socket?.destroy(); agent?.destroy();
      const reset = (error as NodeJS.ErrnoException).code;
      reject(request.reusedSocket && !input.body && ["GET", "HEAD"].includes(input.method) && (reset === "ECONNRESET" || reset === "EPIPE")
        ? new StaleSocket() : error);
    });
    request.once("response", response => {
      let decoded: Readable = response;
      try {
        const resultHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) resultHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        for (const name of HOP_HEADERS) resultHeaders.delete(name);
        const status = response.statusCode ?? 502;
        const noBody = input.method === "HEAD" || [204, 205, 304].includes(status);
        if (noBody) {
          response.resume();
          resolve(new Response(null, { status, headers: resultHeaders })); return;
        }
        const encoding = resultHeaders.get("content-encoding")?.trim().toLowerCase();
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
        if (decoder) {
          response.once("error", error => decoder.destroy(error));
          decoded = response.pipe(decoder);
          resultHeaders.delete("content-encoding"); resultHeaders.delete("content-length");
        }
        decoded.once("close", () => { response.destroy(); agent?.destroy(); });
        const body = Readable.toWeb(decoded) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers: resultHeaders }));
      } catch (error) {
        decoded.destroy(); response.destroy(); socket?.destroy(); agent?.destroy();
        reject(error);
      }
    });
    request.end(input.body);
  });
}

/** Dependencies are test seams. Production always uses system DNS and the pinned core transport. */
export function createPublicFetch(dependencies: { lookup?: PublicLookup; request?: PinnedRequest; env?: ProxyEnvironment; timeoutMs?: number } = {}): typeof fetch {
  const resolve = dependencies.lookup ?? sharedSystemLookup;
  const send = dependencies.request ?? requestPinned;
  return async (input, init) => {
    assertPublicUrl(input instanceof Request ? input.url : String(input));
    const request = new Request(input, init);
    const providedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = providedSignal ?? AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let current = request.url;
    let method = request.method;
    let headers = new Headers(request.headers);
    let body: Uint8Array | undefined;
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const next = await abortable(reader.read(), signal);
          if (next.done) break;
          chunks.push(next.value);
        }
        body = Buffer.concat(chunks);
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    for (let hop = 0; ; hop++) {
      const target = await abortable(resolvePublicTarget(current, resolve), signal);
      const response = await abortable(send(target, { method, headers, body, signal }, publicProxyFor(target.url, dependencies.env)), signal);
      const location = response.headers.get("location");
      if (!REDIRECTS.has(response.status) || location === null || request.redirect === "manual") {
        Object.defineProperties(response, { url: { value: current, configurable: true }, redirected: { value: hop > 0, configurable: true } });
        return response;
      }
      await response.body?.cancel();
      if (request.redirect === "error") throw new EgressRefusal("redirect refused for this source request");
      if (hop >= MAX_PUBLIC_REDIRECTS) throw new EgressRefusal("too many source redirects");
      const next = new URL(location, current).toString();
      headers = publicRedirectHeaders(headers, current, next);
      if ((response.status === 303 && method !== "HEAD") || ([301, 302].includes(response.status) && method === "POST")) {
        method = "GET"; body = undefined;
        for (const name of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(name);
      }
      current = next;
    }
  };
}

export const publicFetch: typeof fetch = createPublicFetch();
