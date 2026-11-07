/**
 * Where a runner check opens the site: a copy of this release served on the
 * runner (the standalone build CI uploads as artifact `local-site-<sha>`,
 * fetched with the runner's saved GitHub key; the runner never builds it), or
 * the live site for the few visits a day the Admin setting allows. The copy
 * reads the same saved keys, so the same production data; it cannot show the
 * CDN, edge functions, Netlify headers or the real network, which the live
 * visits are for. With no copy of the release yet, only the live allowance is
 * visited, and the check says so.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { storedKeyValue } from "../lib/core/keys-values.ts";
import { makeRunId, SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { isLiveWriteRequest } from "../lib/ops/live-write-guard.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";
import { LIVE_VISITS_DEFAULT, LIVE_VISITS_SETTING, takeLiveVisit, type LiveVisitLedger } from "../lib/ops/live-visits.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readSetting } from "../lib/control-plane/settings.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const READY_LIMIT_MS = 90_000;
const REPOSITORY = "SeanJ22/meanwhile";

function readLiveVisitLedger(path: string): LiveVisitLedger | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as LiveVisitLedger; } catch { return null; }
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

const siteRoot = () => join(hostDirectory(), "local-site");

/** The unpacked CI build for this commit, downloaded once; null when CI has not uploaded it (yet). */
async function releaseCopy(sha: string): Promise<string | null> {
  const dir = join(siteRoot(), sha);
  if (existsSync(join(dir, "server.js"))) return dir;
  const token = storedKeyValue("GH_TOKEN") ?? storedKeyValue("GITHUB_TOKEN");
  if (!token) return null;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "meanwhile-runner" };
  const found = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts?name=local-site-${sha}&per_page=5`, { headers, signal: AbortSignal.timeout(30_000) });
  const artifact = found.ok ? ((await found.json()) as { artifacts?: { expired: boolean; archive_download_url: string }[] }).artifacts?.find((a) => !a.expired) : undefined;
  if (!artifact) return null;
  const zip = await fetch(artifact.archive_download_url, { headers, signal: AbortSignal.timeout(300_000) });
  if (!zip.ok) return null;
  if (existsSync(siteRoot())) for (const old of readdirSync(siteRoot())) rmSync(join(siteRoot(), old), { recursive: true, force: true });
  const work = join(siteRoot(), `${sha}.partial`);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "artifact.zip"), Buffer.from(await zip.arrayBuffer()));
  execFileSync("python3", ["-m", "zipfile", "-e", "artifact.zip", "."], { cwd: work });
  mkdirSync(join(work, "site"));
  execFileSync("tar", ["-xzf", "local-site.tgz", "-C", "site"], { cwd: work });
  renameSync(join(work, "site"), dir);
  rmSync(work, { recursive: true, force: true });
  return dir;
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

/** Fetch this commit's CI build if needed, serve it on a free localhost port, and return once /api/build answers; null when CI has no build for it yet. */
export async function startLocalSite(root: string = process.cwd()): Promise<LocalSite | null> {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dir = await releaseCopy(sha).catch(() => null);
  if (!dir) return null;
  const port = await freePort();
  // Started through the runner's own loader, which opens the saved keys from the control plane before the site's first line runs.
  const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--import", join(root, "scripts", "register-test-loader.mjs"), "server.js"], {
    cwd: dir, stdio: ["ignore", "inherit", "inherit"],
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
  /** Where the next visit goes: the live site while this check's allowance for the day lasts, otherwise the runner's own copy; null when the release has no copy yet and the allowance is spent. */
  next(run: { runId: string; writes: boolean }): Promise<Visit | null>;
  /** Said in the run's output when a visit could not go to the release's copy. */
  note(): string;
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
  readonly start?: () => Promise<LocalSite | null>;
}

export function openSite(options: SiteOptions): Site {
  const ledgerPath = options.ledgerPath ?? join(hostDirectory(), "live-visits.json");
  let local: Promise<LocalSite | null> | null = null;
  let missing = false;
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
      const copy = await local;
      if (!copy) { missing = true; return null; }
      return { origin: await copy.address(run), live: false };
    },
    note: () => (missing ? " (CI has no build of this release for the runner yet, so only the live allowance was visited)" : ""),
    nextLive: () => (takeLive() ? live : null),
    async stop() { await (await local?.catch(() => null))?.stop(); },
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
