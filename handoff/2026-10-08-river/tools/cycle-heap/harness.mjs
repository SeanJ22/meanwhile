// Preload for the cycle-heap runs. Loaded after localprod's preload.
// 1. api.anthropic.com, Brave and Exa go to the local stub (CH_STUB_URL); nothing paid is ever reached.
// 2. Every other external http(s) fetch is recorded once to CH_HTTP_CACHE and replayed afterwards, so runs are comparable.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STUB = process.env.CH_STUB_URL;
const CACHE = process.env.CH_HTTP_CACHE;
if (!STUB) throw new Error("CH_STUB_URL is required");
if (CACHE) mkdirSync(CACHE, { recursive: true });
const inner = globalThis.fetch;
const PAID = new Map([["api.anthropic.com", ""], ["api.search.brave.com", "/brave"], ["api.exa.ai", "/exa"]]);

async function bodyBytes(input, init) {
  const b = init?.body ?? (input instanceof Request ? await input.clone().arrayBuffer() : null);
  if (b == null) return Buffer.alloc(0);
  if (typeof b === "string") return Buffer.from(b);
  if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return Buffer.from(b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (b instanceof URLSearchParams) return Buffer.from(b.toString());
  return Buffer.from(String(b));
}

function replayed(entry, body) {
  const response = new Response([101, 204, 205, 304].includes(entry.status) ? null : body, { status: entry.status, statusText: entry.statusText ?? "", headers: entry.headers });
  Object.defineProperty(response, "url", { value: entry.url });
  Object.defineProperty(response, "redirected", { value: entry.redirected === true });
  return response;
}

globalThis.fetch = async function harnessFetch(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  let url;
  try { url = new URL(href); } catch { return inner(input, init); }
  if (PAID.has(url.hostname)) {
    const target = `${STUB}${PAID.get(url.hostname)}${url.pathname}${url.search}`;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("x-api-key"); headers.delete("authorization"); headers.delete("x-subscription-token");
    const body = init?.body ?? (input instanceof Request && input.method !== "GET" ? await input.clone().arrayBuffer() : undefined);
    return inner(target, { method: init?.method ?? (input instanceof Request ? input.method : "GET"), headers, body, signal: init?.signal });
  }
  if (!CACHE || !/^https?:$/.test(url.protocol) || url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname.endsWith(".localprod.test")) {
    return inner(input, init);
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const reqBody = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await bodyBytes(input, init);
  const key = createHash("sha256").update(`${method} ${url.href} ${init?.redirect ?? "follow"} `).update(reqBody).digest("hex");
  const meta = join(CACHE, `${key}.json`); const data = join(CACHE, `${key}.body`);
  if (existsSync(meta)) {
    const entry = JSON.parse(readFileSync(meta, "utf8"));
    if (entry.error) throw new TypeError("fetch failed", { cause: Object.assign(new Error(entry.error.message), { code: entry.error.code }) });
    return replayed(entry, readFileSync(data));
  }
  let response;
  try { response = await inner(input, init); } catch (error) {
    const cause = error?.cause;
    if (!(init?.signal?.aborted)) {
      writeFileSync(`${meta}.tmp`, JSON.stringify({ url: url.href, error: { message: String(cause?.message ?? error?.message ?? error), code: cause?.code ?? null } }));
      renameSync(`${meta}.tmp`, meta);
    }
    throw error;
  }
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); } catch (error) { throw error; }
  const headers = {};
  for (const [k, v] of response.headers) if (k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding") headers[k] = v;
  const entry = { url: response.url || url.href, status: response.status, statusText: response.statusText, redirected: response.redirected, headers };
  writeFileSync(`${data}.tmp`, bytes); renameSync(`${data}.tmp`, data);
  writeFileSync(`${meta}.tmp`, JSON.stringify(entry)); renameSync(`${meta}.tmp`, meta);
  return replayed(entry, bytes);
};

// 3. In the research cycle only: a memory log tagged with the latest phase, sampled live-allocation profiles, and a heap snapshot near the limit.
const OUT = process.env.CH_OUT;
if (OUT && process.argv.some(a => a.endsWith("freshness-shadow.mts"))) {
  const { appendFileSync: append, writeFileSync: write, mkdirSync: mk } = await import("node:fs");
  const v8 = await import("node:v8");
  const inspector = await import("node:inspector");
  mk(OUT, { recursive: true });
  const tag = `${process.pid}`;
  let phase = "start"; let peakHeap = 0; let peakRss = 0;
  const original = console.log.bind(console);
  console.log = (...args) => {
    const line = args.map(String).join(" ");
    const m = /^\s+phase ([\w-]+):/.exec(line);
    if (m) phase = `after ${m[1]}`;
    return original(...args);
  };
  if (process.env.CH_SNAPSHOT === "1") v8.setHeapSnapshotNearHeapLimit(1);
  const sample = () => {
    const m = process.memoryUsage();
    const spaces = v8.getHeapSpaceStatistics();
    const old = spaces.find(s => s.space_name === "old_space");
    const lo = spaces.find(s => s.space_name === "large_object_space");
    peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss);
    append(`${OUT}/mem-${tag}.log`, `${new Date().toISOString()} heap=${(m.heapUsed / 1e6).toFixed(0)} total=${(m.heapTotal / 1e6).toFixed(0)} rss=${(m.rss / 1e6).toFixed(0)} ext=${(m.external / 1e6).toFixed(0)} ab=${(m.arrayBuffers / 1e6).toFixed(0)} old=${(old.space_used_size / 1e6).toFixed(0)} lo=${(lo.space_used_size / 1e6).toFixed(0)} peakHeap=${(peakHeap / 1e6).toFixed(0)} peakRss=${(peakRss / 1e6).toFixed(0)} | ${phase}\n`);
  };
  setInterval(sample, 2000).unref();
  process.on("exit", () => { sample(); append(`${OUT}/mem-${tag}.log`, `EXIT peakHeap=${(peakHeap / 1e6).toFixed(0)} peakRss=${(peakRss / 1e6).toFixed(0)} maxRSS=${(process.resourceUsage().maxRSS / 1024).toFixed(0)}\n`); });
  if (process.env.CH_PROFILE === "1") {
    const session = new inspector.Session(); session.connect();
    const post = (method, params) => new Promise((res, rej) => session.post(method, params ?? {}, (e, r) => e ? rej(e) : res(r)));
    await post("HeapProfiler.startSampling", { samplingInterval: 256 * 1024 });
    let n = 0;
    const dump = async () => { try { const { profile } = await post("HeapProfiler.getSamplingProfile"); write(`${OUT}/prof-${tag}-${String(++n).padStart(3, "0")}.heapprofile`, JSON.stringify(profile)); append(`${OUT}/mem-${tag}.log`, `PROFILE ${n} ${phase}\n`); } catch { /* busy */ } };
    setInterval(dump, Number(process.env.CH_PROFILE_MS ?? 60000)).unref();
  }
}
