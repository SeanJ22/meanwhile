/**
 * Where a runner check opens the site.
 *
 * The browser checks (look pass, resident tasks, speed pass, publication
 * readbacks) used to open https://meanwhileusa.com on every visit, which is
 * what costs Netlify requests and database reads. Now the bulk of the visits
 * go to a copy of this same release served on the runner itself, and each
 * check spends only a few live visits a day (Admin: "Live-site browser visits
 * per check per day"). The copy is the same code with the runner's own
 * settings, so it reads the same production data the live site reads. It
 * cannot see what only the real site has: the CDN and its caching, edge
 * functions, Netlify headers, the real network path. The live visits are for
 * those.
 *
 * The copy is the standalone Next build of the runner's checkout, built once
 * per release under the checkout and served on 127.0.0.1 for as long as the
 * check runs; the check starts it and stops it. It reads the same saved keys
 * (and so the same production data) as the runner, which the runner's loader
 * opens before the site starts. No fallback to the live site:
 * a copy that cannot start fails the check, and the failure is printed.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { availableWorkerMemoryBytes } from "../lib/control-plane/workers/worker-slots.ts";
import { makeRunId, SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { isLiveWriteRequest } from "../lib/ops/live-write-guard.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";
import { LIVE_VISITS_DEFAULT, LIVE_VISITS_SETTING, takeLiveVisit, type LiveVisitLedger } from "../lib/ops/live-visits.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readSetting } from "../lib/control-plane/settings.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const BUILD_LIMIT_MS = 25 * 60_000;
const READY_LIMIT_MS = 90_000;
/** The build's heap. The whole build (Turbopack workers included, no type check: CI has checked the commit) measured about 4.1 GiB at its peak. */
const BUILD_HEAP_MB = 2048;
/** Free memory the build waits for: its measured peak plus the host's 0.75 GiB margin. */
const BUILD_NEEDS_BYTES = 4.9 * 1024 ** 3;
const BUILD_MEMORY_WAIT_MS = 20 * 60_000;

/** The build starts only when the host can hold it and keep its margin; workers are admitted by free memory, so they make room as they finish. */
async function waitForBuildMemory(): Promise<void> {
  const until = Date.now() + BUILD_MEMORY_WAIT_MS;
  while (availableWorkerMemoryBytes() < BUILD_NEEDS_BYTES) {
    if (Date.now() > until) throw new Error("local site: the host never had enough free memory to build this release's copy; nothing was built");
    await sleep(15_000);
  }
}

function readLiveVisitLedger(path: string): LiveVisitLedger | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { day?: unknown; counts?: unknown };
    if (typeof parsed.day !== "string" || !parsed.counts || typeof parsed.counts !== "object") return null;
    const counts = Object.fromEntries(Object.entries(parsed.counts).filter((e): e is [string, number] => Number.isFinite(e[1])));
    return { day: parsed.day, counts };
  } catch {
    return null;
  }
}

function writeLiveVisitLedger(path: string, ledger: LiveVisitLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(ledger));
  renameSync(`${path}.tmp`, path);
}

function hostDirectory(): string {
  return process.env.WTP_WORKER_MEMORY_DIRECTORY ?? join(tmpdir(), "meanwhile-worker-memory");
}

/** The browser cache folder for one check; kept between its visits and runs. */
export function cacheFolder(label: string): string {
  return join(hostDirectory(), "browser-cache", label);
}

const standaloneDir = (root: string) => join(root, ".next", "standalone");
const stampPath = (root: string) => join(root, ".next", "local-site.json");

function currentSha(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function builtFor(root: string, sha: string): boolean {
  try {
    return existsSync(join(standaloneDir(root), "server.js")) && (JSON.parse(readFileSync(stampPath(root), "utf8")) as { sha?: string }).sha === sha;
  } catch {
    return false;
  }
}

async function withBuildLock<T>(work: () => Promise<T>): Promise<T> {
  const lock = join(hostDirectory(), "local-site-build.lock");
  mkdirSync(hostDirectory(), { recursive: true });
  const until = Date.now() + BUILD_LIMIT_MS + READY_LIMIT_MS;
  for (;;) {
    try { mkdirSync(lock); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > until) throw new Error("local site: the build lock stayed held; nothing was built");
      await sleep(5_000);
    }
  }
  try { return await work(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

/** Build this checkout's standalone site if it is not built for the checkout's commit. */
async function ensureBuilt(root: string): Promise<string> {
  const sha = currentSha(root);
  if (builtFor(root, sha)) return sha;
  await withBuildLock(async () => {
    if (builtFor(root, sha)) return;
    await waitForBuildMemory();
    await new Promise<void>((resolve, reject) => {
      const build = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
        cwd: root, stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, NEXT_PRIVATE_STANDALONE: "true", COMMIT_REF: "", WTP_LOCAL_SITE_BUILD: "1", NODE_OPTIONS: `--max-old-space-size=${BUILD_HEAP_MB}` },
      });
      const timer = setTimeout(() => build.kill("SIGKILL"), BUILD_LIMIT_MS);
      build.on("error", reject);
      build.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`local site: the build ended with code ${code}`)); });
    });
    // Next's standalone server serves its own static files and public folder only when they sit beside it.
    cpSync(join(root, ".next", "static"), join(standaloneDir(root), ".next", "static"), { recursive: true });
    if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(standaloneDir(root), "public"), { recursive: true });
    writeFileSync(stampPath(root), JSON.stringify({ sha, builtAt: new Date().toISOString() }));
  });
  return sha;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address() as net.AddressInfo; probe.close(() => resolve(port)); });
  });
}

export interface LocalSite {
  readonly sha: string;
  /**
   * An address for one run's visits. Everything it forwards carries the run's
   * marker; the map relay (it would spend MapTiler's quota from here) is always
   * refused, and the write routes too unless `writes` is set. A refusal drops the
   * connection, as the live-site browser guard's abort does.
   */
  address(run: { runId: string; writes: boolean }): Promise<string>;
  stop(): Promise<void>;
}

const MAP_RELAY = "/api/maptiler";

export function guardProxy(upstreamPort: number, run: { runId: string; writes: boolean }): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];
    if (path === MAP_RELAY || path.startsWith(`${MAP_RELAY}/`) || (!run.writes && isLiveWriteRequest(`http://local${url}`, req.method ?? "GET"))) {
      req.socket.destroy();
      return;
    }
    const upstream = http.request({
      host: "127.0.0.1", port: upstreamPort, path: url, method: req.method,
      headers: { ...req.headers, [SYNTHETIC_RUN_HEADER]: run.runId },
    }, (answer) => { res.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(res); });
    upstream.on("error", () => { res.statusCode = 502; res.end(); });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server)); });
}

/** Build if needed, serve on a free localhost port, and return once /api/build answers. */
export async function startLocalSite(root: string = process.cwd()): Promise<LocalSite> {
  const sha = await ensureBuilt(root);
  const port = await freePort();
  // Started through the runner's own loader, which opens the saved keys from the control plane before the site's first line runs.
  const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--import", join(root, "scripts", "register-test-loader.mjs"), "server.js"], {
    cwd: standaloneDir(root), stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
  });
  let exited = false;
  server.on("exit", () => { exited = true; });
  const proxies = new Map<string, Promise<string>>();
  const open: http.Server[] = [];
  const stop = async () => {
    for (const proxy of open) proxy.close();
    if (exited) return;
    server.kill("SIGTERM");
    const until = Date.now() + 5_000;
    while (!exited && Date.now() < until) await sleep(100);
    if (!exited) server.kill("SIGKILL");
  };
  const until = Date.now() + READY_LIMIT_MS;
  for (;;) {
    if (exited) throw new Error("local site: the server ended before it answered");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/build`, { signal: AbortSignal.timeout(5_000) })).ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > until) { await stop(); throw new Error("local site: the server did not answer within 90 seconds"); }
    await sleep(500);
  }
  return {
    sha, stop,
    address(run) {
      const key = `${run.runId}|${run.writes}`;
      if (!proxies.has(key)) proxies.set(key, guardProxy(port, run).then((proxy) => { open.push(proxy); return `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`; }));
      return proxies.get(key)!;
    },
  };
}

export interface Visit {
  readonly origin: string;
  /** True when this visit is to the live site (an uncached, routed browser); false for the runner's own copy. */
  readonly live: boolean;
}

export interface Site {
  /** Where the next visit goes: the live site while this check's allowance for the day lasts, otherwise the runner's own copy. */
  next(run: { runId: string; writes: boolean }): Promise<Visit>;
  /** The live site while the allowance lasts, otherwise null (for checks that mean nothing on a copy, like real-network speed). */
  nextLive(): Visit | null;
  stop(): Promise<void>;
}

export interface SiteOptions {
  readonly label: string;
  readonly now: string;
  /** Live visits per day; read from the Admin setting when not given. */
  readonly perDay: number;
  /** A base URL someone asked for by hand (SHOOT_BASE_URL): every visit goes there and nothing is counted. */
  readonly fixedOrigin?: string;
  readonly ledgerPath?: string;
  readonly start?: () => Promise<LocalSite>;
}

export function openSite(options: SiteOptions): Site {
  const ledgerPath = options.ledgerPath ?? join(hostDirectory(), "live-visits.json");
  let local: Promise<LocalSite> | null = null;
  const takeLive = (): boolean => {
    const taken = takeLiveVisit(readLiveVisitLedger(ledgerPath), options.label, options.now, options.perDay);
    if (taken.live) writeLiveVisitLedger(ledgerPath, taken.ledger);
    return taken.live;
  };
  const live: Visit = { origin: PUBLIC_SITE_ORIGIN, live: true };
  return {
    async next(run) {
      if (options.fixedOrigin) return { origin: options.fixedOrigin, live: true };
      if (takeLive()) return live;
      local ??= (options.start ?? startLocalSite)();
      return { origin: await (await local).address(run), live: false };
    },
    nextLive: () => (takeLive() ? live : null),
    async stop() { if (local) await (await local.catch(() => null))?.stop(); },
  };
}

/**
 * The browsers one check visits with: the runner's own copy gets a browser
 * that keeps its HTTP cache between visits and runs, the live site an
 * ordinary guarded one (Chromium turns its cache off under the request
 * routing that blocks MapTiler and writes there). Opened on first use.
 */
export function visitBrowsers(options: { label: string; now: string; blockWrites: boolean; args?: string[] }) {
  const runId = makeRunId(options.label, options.now);
  const base = { runId, headless: true as const, blockWrites: options.blockWrites, ...(options.args?.length ? { args: options.args } : {}) };
  let local: GuardedBrowser | null = null;
  let live: GuardedBrowser | null = null;
  return {
    runId,
    async forVisit(visit: Visit): Promise<GuardedBrowser> {
      if (visit.live) return (live ??= await launchGuarded({ ...base, label: options.label }));
      return (local ??= await launchGuarded({ ...base, label: options.label, cacheDir: cacheFolder(options.label) }));
    },
    async close() {
      const open = [local, live].filter((b): b is GuardedBrowser => b !== null);
      local = live = null;
      for (const b of open) await b.close();
    },
  };
}

/** The Admin setting, with its default when the control plane cannot be read. */
export async function liveVisitsPerDay(repos: Pick<ControlPlaneRepositories, "adminConfig"> | null): Promise<number> {
  const row = repos ? await repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null) : null;
  return readSetting(row && isAdminConfig(row.value) ? row.value : null, LIVE_VISITS_SETTING, LIVE_VISITS_DEFAULT);
}
