import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { connect as tlsConnect } from "node:tls";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { assertPublicUrl, EgressRefusal } from "./egress.ts";

export interface PublicAddress { readonly address: string; readonly family: number }
export type PublicResolver = (hostname: string) => Promise<readonly PublicAddress[]>;

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(normalized) !== 6) return false;
  // Only global unicast is routable; mapped, transition, and documentation ranges are excluded.
  const [first, second] = normalized.split(":").map(part => parseInt(part || "0", 16));
  return first! >= 0x2000 && first! < 0x4000 && first !== 0x2002 && first !== 0x3fff &&
    !(first === 0x2001 && (second! < 0x200 || second === 0xdb8));
}

export async function checkedPublicAddress(url: URL, resolve: PublicResolver = hostname => lookup(hostname, { all: true, verbatim: true })): Promise<PublicAddress> {
  assertPublicUrl(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new EgressRefusal(`Source host does not resolve exclusively to public addresses: ${url.hostname}`);
  }
  return addresses.find(address => address.family === 4) ?? addresses[0]!;
}

type Pool = { readonly agent: http.Agent | https.Agent; active: number };
const pools = new Map<string, Pool>();
function proxyFor(url: URL): URL | null {
  const ignored = (process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",").map(value => value.trim().toLowerCase());
  if (ignored.some(host => host === "*" || host === url.hostname || (host.startsWith(".") && url.hostname.endsWith(host)))) return null;
  const proxy = url.protocol === "https:" ? process.env.HTTPS_PROXY ?? process.env.https_proxy : process.env.HTTP_PROXY ?? process.env.http_proxy;
  return proxy ? new URL(proxy) : null;
}
function agentFor(url: URL, address: PublicAddress, proxy: URL | null): http.Agent | https.Agent {
  const options = { keepAlive: true, maxSockets: 16, maxFreeSockets: 2, timeout: 30_000 };
  const agent = url.protocol === "https:" ? new https.Agent(options) : new http.Agent(options);
  if (!proxy) return agent;
  agent.createConnection = (_connection, callback) => {
    const target = `${address.family === 6 ? `[${address.address}]` : address.address}:${url.port || (url.protocol === "https:" ? 443 : 80)}`;
    const headers: Record<string, string> = { host: url.host };
    if (proxy.username || proxy.password) headers["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    const tunnel = (proxy.protocol === "https:" ? https.request : http.request)(proxy, { method: "CONNECT", path: target, headers, agent: false });
    const fail = (error: Error) => callback?.(error, undefined as never);
    tunnel.setTimeout(30_000, () => tunnel.destroy(new Error("Source proxy connection timed out")));
    tunnel.once("error", fail);
    tunnel.once("connect", (response, socket, head) => {
      tunnel.removeListener("error", fail);
      if (response.statusCode !== 200) { socket.destroy(); fail(new Error(`Source proxy refused connection (${response.statusCode})`)); return; }
      if (head.length) socket.unshift(head);
      if (url.protocol === "http:") { callback?.(null, socket); return; }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const secure = tlsConnect({ socket, host: hostname, servername: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true });
      secure.once("error", fail);
      secure.once("secureConnect", () => { secure.removeListener("error", fail); callback?.(null, secure); });
    });
    tunnel.end();
    return undefined;
  };
  return agent;
}
function poolFor(url: URL, address: PublicAddress): Pool {
  const proxy = proxyFor(url), key = `${url.origin}/${address.address}/${proxy?.href ?? ""}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = { agent: agentFor(url, address, proxy), active: 0 };
  }
  pools.delete(key);
  pools.set(key, pool);
  for (const [oldKey, old] of pools) {
    if (pools.size <= 64) break;
    if (oldKey !== key && old.active === 0) { old.agent.destroy(); pools.delete(oldKey); }
  }
  return pool;
}

export async function publicTransport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init), url = assertPublicUrl(request.url);
  request.signal.throwIfAborted();
  const address = await checkedPublicAddress(url), pool = poolFor(url, address);
  const headers = Object.fromEntries(request.headers);
  headers.host = url.host;
  headers["accept-encoding"] = "gzip, deflate, br";
  pool.active += 1;
  return new Promise<Response>((resolve, reject) => {
    const send = url.protocol === "https:" ? https.request : http.request;
    const outgoing = send(url, {
      method: request.method, headers, agent: pool.agent, signal: request.signal,
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all) (callback as unknown as (error: null, addresses: readonly PublicAddress[]) => void)(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, incoming => {
      const responseHeaders = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i]!, incoming.rawHeaders[i + 1]!);
      let stream: Readable = incoming;
      const encoding = responseHeaders.get("content-encoding");
      if (encoding === "gzip") stream = incoming.pipe(createGunzip());
      else if (encoding === "deflate") stream = incoming.pipe(createInflate());
      else if (encoding === "br") stream = incoming.pipe(createBrotliDecompress());
      if (stream !== incoming) {
        incoming.once("error", error => stream.destroy(error));
        responseHeaders.delete("content-encoding"); responseHeaders.delete("content-length");
      }
      const status = incoming.statusCode ?? 502;
      const empty = request.method === "HEAD" || [204, 205, 304].includes(status);
      const response = new Response(empty ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, statusText: incoming.statusMessage, headers: responseHeaders });
      Object.defineProperty(response, "url", { value: url.href });
      if (empty) incoming.resume();
      resolve(response);
    });
    outgoing.once("close", () => { pool.active -= 1; });
    outgoing.once("error", reject);
    if (request.body) Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).on("error", error => outgoing.destroy(error)).pipe(outgoing);
    else outgoing.end();
  });
}
