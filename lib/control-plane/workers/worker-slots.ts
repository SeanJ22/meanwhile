import { freemem, platform, tmpdir, totalmem } from "node:os";
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const MIB = 1024 * 1024;
/** Rounded-up measured RSS peaks for a script never measured on this host; a reservation pays only for growth not yet in OS usage. */
export const WORKER_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = { route: 285, scout: 248, lease: 342, national: 1258 };
/** Rounded up from the ordinary staging research parent's 3,069,235,200-byte peak. */
export const RESEARCH_PARENT_PEAK_MIB = 2928;
/** Promoter peak 1,923 MiB plus the held national-worker peak; both may still grow. */
export const NATIONAL_PLACE_PEAK_MIB = 1923 + WORKER_ENTRY_PEAK_MIB.national!;
/** Bulk data families use the retained data-worker bound until their own runs are measured on this host. */
const ROUTINE_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = {
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
export const MEETING_WORKER_PEAK_MIB = 896;
export const READER_PUBLISH_PEAK_MIB = 1536;
export const PUBLICATION_OUTBOX_PEAK_MIB = 512;

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

interface MemoryReservation { id: string; owner: number; pid: number | null; peak: number; entry: string; scope?: "process" | "tree" }
interface HostState {
  reservations: MemoryReservation[];
  parents: { pid: number; peak: number }[];
  peaks?: Record<string, number[]>;
  priority?: { id: string; owner: number; deadline: number }[];
}

/** How often a running reserved child's peak is read, and how many recent run peaks set its script's reservation. */
const PEAK_SAMPLE_MS = 2000;
const MEASURED_PEAK_RUNS = 5;
/** The script an entry runs ("…/national-people-refresh.mts"); entries that name no script keep their table peak. */
function measuredPeakKey(entry: string): string | null {
  if (entry.startsWith("meeting-batch:")) return "meeting-batch";
  if (entry.startsWith("reader-publish:")) return "reader-publish";
  if (entry.startsWith("publish-outbox:")) return "publish-outbox";
  const script = entry.split(/[\\/]/).at(-1)!;
  return /[.](?:mts|ts|mjs|js)$/.test(script) ? script : null;
}
/** The largest recent measured peak, 5% over and rounded up to a whole MiB. */
function measuredReservationBytes(peaks: readonly number[]): number {
  return Math.ceil(Math.max(...peaks) * 1.05 / MIB) * MIB;
}
/** Linux high-water RSS of a process and its live descendants; null once the process is gone. */
async function processTreePeakBytes(root: number, scope: "process" | "tree"): Promise<number | null> {
  let total = 0;
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    const pid = pending[index]!;
    try { total += Number(/^VmHWM:\s+(\d+)/m.exec(await readFile(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024; }
    catch { if (pid === root) return null; continue; }
    if (scope === "process") break;
    try { pending.push(...(await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).split(/\s+/).filter(Boolean).map(Number)); }
    catch { /* A descendant can exit between reads. */ }
  }
  return total;
}
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
      local.priority = local.priority?.filter(row => alive(row.owner) && row.deadline > Date.now());
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

const rosterPublication = (entry: string): boolean => entry === "registry-runtime-bindings" ||
  entry.startsWith("registry-runtime-bindings/") || entry.startsWith("worker-publication:registry-runtime-bindings:");
const readerPublication = (entry: string): boolean => entry.startsWith("reader-publish:");
const publicationOutbox = (entry: string): boolean => entry.startsWith("publish-outbox:");

export function routineProcessSlots(memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  return workerProcessSlots(() => Number.MAX_SAFE_INTEGER, { ...memory,
    peakBytes: memory.peakBytes ?? (entry => entry.startsWith("meeting-batch:") ? MEETING_WORKER_PEAK_MIB * MIB :
      readerPublication(entry) ? READER_PUBLISH_PEAK_MIB * MIB :
      publicationOutbox(entry) ? PUBLICATION_OUTBOX_PEAK_MIB * MIB :
      entry.startsWith("national-place:") ? NATIONAL_PLACE_PEAK_MIB * MIB :
      rosterPublication(entry) ? REGISTRY_ROSTER_PUBLICATION_PEAK_MIB * MIB : (/^state-money-.+[.]mts$/.test(entry.split(/[\\/]/).at(-1)!)
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
  const waiting: { id: string; entry: string; deadline: number; resolve: (release: WorkerMemoryRelease) => void; reject: (error: Error) => void }[] = [];
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
        if (readerPublication(item!.entry)) mutate(state => { state.priority = state.priority?.filter(row => row.id !== item!.id); });
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
      const ids = new Set(waiting.map(item => item.id));
      mutate(state => { state.priority = state.priority?.filter(row => !ids.has(row.id)); });
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
          const ids = new Set(waiting.map(item => item.id));
          state.priority = state.priority?.filter(row => !ids.has(row.id));
          for (const item of waiting.splice(0)) item.reject(new Error("LEASE_WORKER_CAPACITY_INVALID"));
          return;
        }
        const current = new Map(rows.map(row => [row.pid, row.rss]));
        const trees = new Map<number, Set<number>>();
        const idsFor = (pid: number): Set<number> => {
          let ids = trees.get(pid); if (!ids) { ids = descendants(pid, rows); trees.set(pid, ids); } return ids;
        };
        const rssFor = (reservation: Pick<MemoryReservation, "pid" | "scope">): number => reservation.pid === null ? 0 : reservation.scope === "process"
          ? current.get(reservation.pid) ?? 0 : rows.reduce((sum, row) => idsFor(reservation.pid!).has(row.pid) ? sum + row.rss : sum, 0);
        const inherited = state.reservations.find(row => row.scope !== "process" && row.owner !== process.pid && row.pid !== null && idsFor(row.pid).has(process.pid));
        if (inherited) state.parents = state.parents.filter(parent => parent.pid !== process.pid);
        else {
          const parent = state.parents.find(row => row.pid === process.pid);
          if (parent) parent.peak = Math.max(parent.peak, memory.parentPeakBytes ?? 0);
          else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes ?? 0 });
        }
        // A child past its reserved peak has shown it can reach that size again.
        for (const row of state.reservations) row.peak = Math.max(row.peak, rssFor(row));
        const reserve = (entry: string): number => {
          const measured = state.peaks?.[measuredPeakKey(entry) ?? ""];
          const baseline = peakFor(entry);
          if (!measured?.length) return baseline;
          const recent = measuredReservationBytes(measured);
          // Small states cannot lower the reservation needed by the next large state.
          return entry.startsWith("meeting-batch:") || readerPublication(entry) || publicationOutbox(entry)
            ? Math.max(baseline, recent) : recent;
        };
        waiting.sort((left, right) => Number(readerPublication(right.entry)) - Number(readerPublication(left.entry)));
        while (active < maximum && waiting.length) {
          const growth = state.reservations.reduce((sum, row) => sum + Math.max(0, row.peak - rssFor(row)), 0) +
            state.parents.reduce((sum, row) => sum + Math.max(0, row.peak - (current.get(row.pid) ?? 0)), 0);
          const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
          const participants = new Set(state.parents.flatMap(parent => [...idsFor(parent.pid)]));
          const used = rows.reduce((sum, row) => participants.has(row.pid) ? sum + row.rss : sum, 0);
          const free = Math.min(available(), Number.isFinite(hostMiB) && hostMiB > 0 ? Math.max(0, hostMiB * MIB - used) : Infinity);
          const priority = state.priority?.[0] ?? waiting.find(item => readerPublication(item.entry));
          const index = waiting.findIndex(item => {
            if (Date.now() >= item.deadline) return false;
            return inherited || ((!priority || priority.id === item.id) && free >= headroom + growth + reserve(item.entry));
          });
          if (index < 0) break;
          const [item] = waiting.splice(index, 1);
          state.priority = state.priority?.filter(row => row.id !== item!.id);
          const id = randomUUID();
          let reserved = reserve(item!.entry);
          const scope = publicationOutbox(item!.entry) ? "process" : "tree";
          if (!inherited) state.reservations.push({ id, owner: process.pid, pid: null, peak: reserved, entry: item!.entry, scope });
          active++;
          let released = false;
          let measured = 0;
          let sampler: ReturnType<typeof setInterval> | undefined;
          const key = measuredPeakKey(item!.entry);
          const release: WorkerMemoryRelease = Object.assign(() => {
            if (released) return;
            released = true; active--;
            clearInterval(sampler);
            if (!inherited) mutate(state => {
              state.reservations = state.reservations.filter(row => row.id !== id);
              if (key !== null && measured > 0) (state.peaks ??= {})[key] = [...state.peaks[key] ?? [], measured].slice(-MEASURED_PEAK_RUNS);
            });
            requestDrain();
          }, { observe: (pid: number) => {
            if (released || inherited) return;
            mutate(state => { const row = state.reservations.find(row => row.id === id); if (row) row.pid = pid; });
            if (platform() !== "linux") return;
            sampler = setInterval(() => void processTreePeakBytes(pid, scope).then(bytes => {
              if (bytes === null || released) { clearInterval(sampler); return; }
              measured = Math.max(measured, bytes);
              if (bytes <= reserved) return;
              reserved = bytes;
              mutate(state => { const row = state.reservations.find(row => row.id === id); if (row) row.peak = Math.max(row.peak, bytes); });
            }), PEAK_SAMPLE_MS);
            sampler.unref();
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
    new Promise<WorkerMemoryRelease>((resolve, reject) => {
      const id = randomUUID();
      waiting.push({ id, entry, deadline: deadlineMs, resolve, reject });
      if (readerPublication(entry)) mutate(state => { (state.priority ??= []).push({ id, owner: process.pid, deadline: deadlineMs }); });
      requestDrain();
    }) };
}

/** How often a wait for host memory says it is still waiting. */
export const MEMORY_WAIT_REPORT_EVERY_MS = 60_000;

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
  readonly rows: readonly WorkerProcessMemory[]; readonly state: { readonly reservations: readonly { pid: number | null; peak: number; entry: string; scope?: "process" | "tree" }[];
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
  const reservations = (input.state?.reservations ?? []).map(row => ({ entry: row.entry.split(/[\\/]/).at(-1) ?? row.entry, peakBytes: row.peak,
    rssBytes: row.scope === "process" ? input.rows.find(process => process.pid === row.pid)?.rss ?? 0 : treeRss(row.pid) }));
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
