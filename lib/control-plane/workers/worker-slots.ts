import { freemem, platform, tmpdir, totalmem } from "node:os";
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const MIB = 1024 * 1024;
/** Rounded-up measured RSS peaks; a reservation pays only for growth not yet in OS usage. */
export const WORKER_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = { route: 285, scout: 248, lease: 342, national: 1258 };
/** Rounded up from the ordinary staging research parent's 3,069,235,200-byte peak. */
export const RESEARCH_PARENT_PEAK_MIB = 2928;
/** Promoter peak 1,923 MiB plus the held national-worker peak; both may still grow. */
export const NATIONAL_PLACE_PEAK_MIB = 1923 + WORKER_ENTRY_PEAK_MIB.national!;
/** Bulk data families use the retained data-worker bound, covering their staging entry peaks. */
const ROUTINE_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = {
  // A complete 113 MiB Illinois session parsed and promoted in the fixture
  // store peaked at 3,013 MiB. Round up for these state-scoped bulk writers;
  // the existing host observer still accounts for their whole process trees.
  "openstates-votes-refresh.mts": 3072,
  "legiscan-votes-refresh.mts": 3072,
  "census-geography-refresh.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "promote-manual-civic-projection.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "ingest.ts": WORKER_ENTRY_PEAK_MIB.national!,
  "state-rollcalls.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "legistar-outcomes-ingest.mts": 355,
  "acs-population-promote.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "fetch-congress-legislators.mts": 384,
  "national-people-refresh.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "people-portraits-refresh.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "campaign-finance-az-pima-transactions.mts": 368,
  "build-nj-morris-ballot.mts": 345,
};
export const REGISTRY_ROSTER_PUBLICATION_PEAK_MIB = 4012;
export const WORKER_MEMORY_HEADROOM_MIB = 768;

export function availableWorkerMemoryBytes(): number {
  let available = freemem();
  if (platform() === "linux") {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
      if (match) available = Number(match[1]) * 1024;
    } catch { /* os.freemem remains conservative. */ }
  }
  const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
  return Number.isFinite(hostMiB) && hostMiB > 0
    ? Math.min(available, Math.max(0, hostMiB * MIB - process.memoryUsage.rss())) : available;
}

export interface WorkerProcessMemory { readonly pid: number; readonly parentPid: number; readonly rss: number }
async function hostProcesses(): Promise<readonly WorkerProcessMemory[]> {
  const rows: WorkerProcessMemory[] = [];
  try {
    if (platform() === "linux") {
      await Promise.all((await readdir("/proc")).filter(name => /^\d+$/.test(name)).map(async name => {
        try {
          const status = await readFile(`/proc/${name}/status`, "utf8");
          rows.push({ pid: Number(name), parentPid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0),
            rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
        } catch { /* A process can exit while the host is sampled. */ }
      }));
    } else if (platform() === "win32") {
      const source = await new Promise<string>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4 * MIB },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); }));
      const values = JSON.parse(source) as { ProcessId: number; ParentProcessId: number; WorkingSetSize: string | number }[];
      for (const row of values) rows.push({ pid: row.ProcessId, parentPid: row.ParentProcessId, rss: Number(row.WorkingSetSize) });
    }
  } catch { /* Unobserved children keep their complete peak reserved. */ }
  if (!rows.some(row => row.pid === process.pid)) rows.push({ pid: process.pid, parentPid: process.ppid, rss: process.memoryUsage.rss() });
  return rows;
}

function descendants(root: number, rows: readonly WorkerProcessMemory[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of rows) { const list = children.get(row.parentPid) ?? []; list.push(row.pid); children.set(row.parentPid, list); }
  const ids = new Set([root]);
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    for (const pid of children.get(pending[index]!) ?? []) if (!ids.has(pid)) { ids.add(pid); pending.push(pid); }
  }
  return ids;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

interface MemoryReservation { id: string; owner: number; pid: number | null; peak: number; entry: string }
interface HostState { reservations: MemoryReservation[]; parents: { pid: number; peak: number }[] }
export interface WorkerMemoryHost {
  transact(operation: (state: HostState, processes: readonly WorkerProcessMemory[]) => void, sampleProcesses?: boolean): boolean | Promise<boolean>;
}
/** Transient host reservations, shared by independent research/routine parents.
 * No work, receipt, spending or publication state is written here. */
export function workerMemoryHost(input: { readonly shared?: boolean; readonly processes?: () => readonly WorkerProcessMemory[] | PromiseLike<readonly WorkerProcessMemory[]> } = {}): WorkerMemoryHost {
  let local: HostState = { reservations: [], parents: [] };
  const sample = input.processes ?? hostProcesses;
  const apply = (operation: Parameters<WorkerMemoryHost["transact"]>[0], rows: readonly WorkerProcessMemory[]): boolean => {
    const path = join(tmpdir(), "meanwhile-worker-memory.json");
    const lock = join(tmpdir(), "meanwhile-worker-memory.json.lock");
    const temporary = join(tmpdir(), "meanwhile-worker-memory.json.tmp");
    let descriptor: number | undefined;
    if (input.shared) {
      try { descriptor = openSync(lock, "wx"); writeFileSync(lock, String(process.pid)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try { const owner = Number(readFileSync(lock, "utf8")); if (owner > 0 && !alive(owner)) unlinkSync(lock); }
        catch { /* A concurrent holder may already have released its lock. */ }
        return false;
      }
    }
    try {
      if (input.shared && existsSync(path)) local = JSON.parse(readFileSync(path, "utf8")) as HostState;
      // A dead parent cannot retain future growth. A surviving job tree still can.
      local.parents = local.parents.filter(parent => alive(parent.pid));
      local.reservations = local.reservations.filter(row => alive(row.owner) || (row.pid !== null && alive(row.pid)));
      operation(local, rows);
      if (input.shared) {
        writeFileSync(temporary, JSON.stringify(local)); renameSync(temporary, path);
      }
      return true;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (input.shared) unlinkSync(lock);
    }
  };
  return { transact: (operation, sampleProcesses = true) => {
    if (!sampleProcesses) return apply(operation, []);
    const rows = sample();
    // Sampling may wait on the OS; the shared lock only protects the state update.
    return Array.isArray(rows) ? apply(operation, rows) : Promise.resolve(rows).then(values => apply(operation, values));
  } };
}
const sharedHost = workerMemoryHost({ shared: true });

export interface WorkerMemoryLimit {
  readonly admissionsOpen?: () => boolean;
  readonly availableBytes?: () => number;
  readonly headroomBytes?: number;
  readonly peakBytes?: (entry: string) => number;
  /** Measured parent peak; current RSS is already excluded from OS free memory. */
  readonly parentPeakBytes?: number;
  readonly host?: WorkerMemoryHost;
  readonly waitMs?: number;
}
export interface WorkerMemoryRelease {
  (): void;
  /** Include the whole process tree, including browser and national grandchildren. */
  observe?(pid: number): void;
}
export interface WorkerProcessSlots {
  acquire(entry?: string, deadlineMs?: number): Promise<WorkerMemoryRelease>;
}

export function routineProcessSlots(memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  return workerProcessSlots(() => Number.MAX_SAFE_INTEGER, { ...memory,
    peakBytes: memory.peakBytes ?? (entry => entry.startsWith("national-place:") ? NATIONAL_PLACE_PEAK_MIB * MIB :
      entry === "registry-runtime-bindings" || entry.startsWith("registry-runtime-bindings/") || entry.startsWith("worker-publication:registry-runtime-bindings:")
        ? REGISTRY_ROSTER_PUBLICATION_PEAK_MIB * MIB : (/^state-money-.+[.]mts$/.test(entry.split(/[\\/]/).at(-1)!)
          ? WORKER_ENTRY_PEAK_MIB.national! : ROUTINE_ENTRY_PEAK_MIB[entry.split(/[\\/]/).at(-1)!] ?? WORKER_ENTRY_PEAK_MIB.lease!) * MIB) });
}

export function workerProcessSlots(capacity: () => number, memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  let active = 0;
  let drainScheduled = false;
  let draining = false;
  let wake: ReturnType<typeof setTimeout> | undefined;
  const available = memory.availableBytes ?? availableWorkerMemoryBytes;
  const headroom = memory.headroomBytes ?? WORKER_MEMORY_HEADROOM_MIB * MIB;
  const host = memory.host ?? (memory.availableBytes ? workerMemoryHost({ processes: () => [] }) : sharedHost);
  const peakFor = memory.peakBytes ?? (entry => {
    const kind = /(?:^|\/|\\)(route|scout|lease|national)-worker[.]ts$/.exec(entry)?.[1] ?? "lease";
    return WORKER_ENTRY_PEAK_MIB[kind]! * MIB;
  });
  const waiting: { entry: string; deadline: number; resolve: (release: WorkerMemoryRelease) => void; reject: (error: Error) => void }[] = [];
  const mutate = (operation: (state: HostState, processes: readonly WorkerProcessMemory[]) => void): void => {
    try {
      void Promise.resolve(host.transact(operation, false)).then(applied => {
        if (!applied) setTimeout(() => mutate(operation), 50).unref();
      }, () => { setTimeout(() => mutate(operation), 1000).unref(); });
    } catch { setTimeout(() => mutate(operation), 1000).unref(); }
  };
  if ((memory.parentPeakBytes ?? 0) > 0) mutate(state => {
    const parent = state.parents.find(row => row.pid === process.pid);
    if (parent) parent.peak = Math.max(parent.peak, memory.parentPeakBytes!);
    else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes! });
  });
  const expire = (): void => {
    const now = Date.now();
    for (let index = waiting.length - 1; index >= 0; index--) {
      if (memory.admissionsOpen?.() === false || now >= waiting[index]!.deadline) {
        const [item] = waiting.splice(index, 1);
        item!.reject(new Error(memory.admissionsOpen?.() === false ? "RUNTIME_RELEASE_DRAINED: queued work remains owed" : "WORKER_MEMORY_DEADLINE: memory wait deferred; work remains owed"));
      }
    }
  };
  const scheduleWake = (): void => {
    clearTimeout(wake); wake = undefined;
    if (waiting.length) wake = setTimeout(() => { void drain(); }, Math.max(1, Math.min(1000, ...waiting.map(item => item.deadline - Date.now()))));
  };
  const drain = async (): Promise<void> => {
    expire();
    const maximum = capacity();
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      for (const item of waiting.splice(0)) item.reject(new Error("LEASE_WORKER_CAPACITY_INVALID"));
      scheduleWake();
      return;
    }
    if (draining || !waiting.length || active >= maximum) { scheduleWake(); return; }
    draining = true;
    scheduleWake();
    try { await host.transact((state, rows) => {
        expire();
        const maximum = capacity();
        if (!Number.isSafeInteger(maximum) || maximum <= 0) {
          for (const item of waiting.splice(0)) item.reject(new Error("LEASE_WORKER_CAPACITY_INVALID"));
          return;
        }
        const current = new Map(rows.map(row => [row.pid, row.rss]));
        const trees = new Map<number, Set<number>>();
        const idsFor = (pid: number): Set<number> => {
          let ids = trees.get(pid); if (!ids) { ids = descendants(pid, rows); trees.set(pid, ids); } return ids;
        };
        const rssFor = (pid: number | null): number => pid === null ? 0 : rows.reduce((sum, row) => idsFor(pid).has(row.pid) ? sum + row.rss : sum, 0);
        const inherited = state.reservations.find(row => row.owner !== process.pid && row.pid !== null && idsFor(row.pid).has(process.pid));
        if (inherited) state.parents = state.parents.filter(parent => parent.pid !== process.pid);
        else {
          const parent = state.parents.find(row => row.pid === process.pid);
          if (parent) parent.peak = Math.max(parent.peak, memory.parentPeakBytes ?? 0);
          else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes ?? 0 });
        }
        while (active < maximum && waiting.length) {
          const growth = state.reservations.reduce((sum, row) => sum + Math.max(0, row.peak - rssFor(row.pid)), 0) +
            state.parents.reduce((sum, row) => sum + Math.max(0, row.peak - (current.get(row.pid) ?? 0)), 0);
          const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
          const participants = new Set(state.parents.flatMap(parent => [...idsFor(parent.pid)]));
          const used = rows.reduce((sum, row) => participants.has(row.pid) ? sum + row.rss : sum, 0);
          const free = Math.min(available(), Number.isFinite(hostMiB) && hostMiB > 0 ? Math.max(0, hostMiB * MIB - used) : Infinity);
          const rosterLive = state.reservations.some(row => row.peak >= REGISTRY_ROSTER_PUBLICATION_PEAK_MIB * MIB);
          const index = waiting.findIndex(item => {
            if (Date.now() >= item.deadline) return false;
            const peak = peakFor(item.entry);
            return inherited || (!rosterLive && (peak < REGISTRY_ROSTER_PUBLICATION_PEAK_MIB * MIB || !state.reservations.length) && free >= headroom + growth + peak);
          });
          if (index < 0) break;
          const [item] = waiting.splice(index, 1);
          const id = randomUUID();
          if (!inherited) state.reservations.push({ id, owner: process.pid, pid: null, peak: peakFor(item!.entry), entry: item!.entry });
          active++;
          let released = false;
          const release: WorkerMemoryRelease = Object.assign(() => {
            if (released) return;
            released = true; active--;
            if (!inherited) mutate(state => { state.reservations = state.reservations.filter(row => row.id !== id); });
            requestDrain();
          }, { observe: (pid: number) => {
            if (released || inherited) return;
            mutate(state => { const row = state.reservations.find(row => row.id === id); if (row) row.pid = pid; });
          } });
          item!.resolve(release);
        }
      }); } catch (error) {
        console.warn(`Host memory admission unavailable; queued work keeps its deadline: ${error instanceof Error ? error.message : String(error)}`);
    } finally { draining = false; scheduleWake(); }
  };
  const requestDrain = (): void => {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => { drainScheduled = false; void drain(); });
  };
  return { acquire: (entry = "lease-worker.ts", deadlineMs = Date.now() + (memory.waitMs ?? 120_000)) =>
    new Promise<WorkerMemoryRelease>((resolve, reject) => { waiting.push({ entry, deadline: deadlineMs, resolve, reject }); requestDrain(); }) };
}

/** How often a wait for host memory says it is still waiting. */
export const MEMORY_WAIT_REPORT_EVERY_MS = 60_000;

/**
 * A wait for host memory reports once a minute that it is still waiting, so the
 * runner's no-output timeout does not end it as a crash. Quick admissions print nothing.
 */
export function reportingWorkerSlots(slots: WorkerProcessSlots, options: {
  readonly write?: (line: string) => void;
  readonly everyMs?: number;
  /** The length of a reported minute; tests shorten it. */
  readonly minuteMs?: number;
} = {}): WorkerProcessSlots {
  const write = options.write ?? (line => console.log(line));
  const everyMs = options.everyMs ?? MEMORY_WAIT_REPORT_EVERY_MS;
  const minuteMs = options.minuteMs ?? 60_000;
  let waits = 0;
  return { acquire: (entry, deadlineMs) => {
    const wait = ++waits;
    const started = Date.now();
    const kind = (entry ?? "lease-worker.ts").split(/[\\/]/).at(-1);
    const limit = deadlineMs === undefined || !Number.isFinite(deadlineMs) ? null : Math.max(1, Math.ceil((deadlineMs - started) / minuteMs));
    const timer = setInterval(() => {
      const minutes = Math.max(1, Math.round((Date.now() - started) / minuteMs));
      write(`  waiting for memory: wait ${wait} (${kind}) ${minutes}${limit === null ? "" : ` of ${limit}`} min; the work stays owed`);
    }, everyMs);
    timer.unref?.();
    const settled = slots.acquire(entry, deadlineMs);
    void settled.then(() => clearInterval(timer), () => clearInterval(timer));
    return settled;
  } };
}

/**
 * What the host holds, for the runner's heartbeat. Read-only: the reservation
 * file is read without its lock (writers replace it whole). `fitLeaseWorkers`
 * is free memory less the 0.75 GiB margin and reserved growth, over one lease
 * worker's peak.
 */
export interface HostMemoryReading {
  readonly at: string;
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly headroomBytes: number;
  /** The runner and every process under it. */
  readonly runnerTreeRssBytes: number;
  readonly runnerTreeProcesses: number;
  readonly parents: readonly { readonly pid: number; readonly peakBytes: number; readonly rssBytes: number }[];
  readonly reservations: readonly { readonly entry: string; readonly peakBytes: number; readonly rssBytes: number }[];
  /** What the parents and reservations may still grow by before their peaks. */
  readonly reservedGrowthBytes: number;
  readonly leaseWorkerPeakBytes: number;
  /** Further lease workers admission would start now. */
  readonly fitLeaseWorkers: number;
}

export function memoryReading(input: {
  readonly at: string; readonly totalBytes: number; readonly availableBytes: number; readonly rootPid: number;
  readonly rows: readonly WorkerProcessMemory[]; readonly state: { readonly reservations: readonly { pid: number | null; peak: number; entry: string }[];
    readonly parents: readonly { pid: number; peak: number }[] } | null;
  readonly headroomBytes?: number; readonly leaseWorkerPeakBytes?: number;
}): HostMemoryReading {
  const headroomBytes = input.headroomBytes ?? WORKER_MEMORY_HEADROOM_MIB * MIB;
  const leaseWorkerPeakBytes = input.leaseWorkerPeakBytes ?? WORKER_ENTRY_PEAK_MIB.lease! * MIB;
  const treeRss = (pid: number | null): number => {
    if (pid === null) return 0;
    const ids = descendants(pid, input.rows);
    return input.rows.reduce((sum, row) => ids.has(row.pid) ? sum + row.rss : sum, 0);
  };
  const runner = descendants(input.rootPid, input.rows);
  const parents = (input.state?.parents ?? []).map(row => ({ pid: row.pid, peakBytes: row.peak,
    rssBytes: input.rows.find(r => r.pid === row.pid)?.rss ?? 0 }));
  const reservations = (input.state?.reservations ?? []).map(row => ({ entry: row.entry.split(/[\\/]/).at(-1) ?? row.entry, peakBytes: row.peak, rssBytes: treeRss(row.pid) }));
  const reservedGrowthBytes = [...parents, ...reservations].reduce((sum, row) => sum + Math.max(0, row.peakBytes - row.rssBytes), 0);
  const spare = input.availableBytes - headroomBytes - reservedGrowthBytes;
  return { at: input.at, totalBytes: input.totalBytes, availableBytes: input.availableBytes, headroomBytes,
    runnerTreeRssBytes: input.rows.reduce((sum, row) => runner.has(row.pid) ? sum + row.rss : sum, 0),
    runnerTreeProcesses: input.rows.filter(row => runner.has(row.pid)).length,
    parents, reservations, reservedGrowthBytes, leaseWorkerPeakBytes,
    fitLeaseWorkers: Math.max(0, Math.floor(spare / leaseWorkerPeakBytes)) };
}

/** The reading for this host, rooted at this process (the runner). Never throws; an unreadable file reads as no reservations. */
export async function hostMemoryReading(at: string = new Date().toISOString()): Promise<HostMemoryReading> {
  let state: HostState | null = null;
  try { state = JSON.parse(readFileSync(join(tmpdir(), "meanwhile-worker-memory.json"), "utf8")) as HostState; }
  catch { state = null; }
  const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
  return memoryReading({ at, totalBytes: Number.isFinite(hostMiB) && hostMiB > 0 ? hostMiB * MIB : totalmem(),
    availableBytes: availableWorkerMemoryBytes(), rootPid: process.pid, rows: await hostProcesses(),
    state: state === null ? null : { reservations: (state.reservations ?? []).filter(row => row.pid === null || alive(row.pid) || alive(row.owner)),
      parents: (state.parents ?? []).filter(row => alive(row.pid)) } });
}
