import { freemem, platform, tmpdir, totalmem } from "node:os";
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
const STATE_PUBLICATION_PEAK_MIB = 512;
/** Bulk data families use the retained data-worker bound until their own runs are measured on this host. */
export const ROUTINE_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = {
  // RH-01 complete native publication peaks: 3,403 MiB Open States and
  // 1,249 MiB LegiScan, each with 5% and rounded up to a whole MiB.
  "openstates-votes-refresh.mts": 3574,
  "legiscan-votes-refresh.mts": 1312,
  "federal-money-refresh.mts": 768,
  "state-campaign-finance.mts": 384,
  "census-geography-refresh.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "promote-manual-civic-projection.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "state-rollcalls.mts": WORKER_ENTRY_PEAK_MIB.national!,
  "legistar-outcomes-ingest.mts": 355,
  "legistar-members-refresh.mts": 512,
  // RH-01 measured complete native ACS peak: 3,922,288,640 bytes.
  "acs-population-promote.mts": 3928,
  "fetch-congress-legislators.mts": 384,
  "national-people-refresh.mts": WORKER_ENTRY_PEAK_MIB.national!,
  // One state's portrait pass at full size peaked at 390 MiB (New Hampshire, 407 people); the federal pass at 354 MiB.
  "people-portraits-refresh.mts": 448,
  "campaign-finance-az-pima-transactions.mts": 368,
  "assemble-ballot-package.mts": STATE_PUBLICATION_PEAK_MIB,
  "fetch-voting-sites.mts": STATE_PUBLICATION_PEAK_MIB,
  "derive-candidate-campaign-sites.mts": STATE_PUBLICATION_PEAK_MIB,
  "promote-registry-runtime.mts": STATE_PUBLICATION_PEAK_MIB,
  "retire-state-authorities.mts": STATE_PUBLICATION_PEAK_MIB,
};
/**
 * One state's calendar program before its own runs are measured on this host: the retained data-worker bound. Every
 * finished program records its measured peak under the calendar-read job, and the largest of its last five runs
 * (5% over) replaces this number, so a single board read and a state's whole list are reserved the same way.
 */
export const CALENDAR_READ_PEAK_MIB = WORKER_ENTRY_PEAK_MIB.national!;
export const CALENDAR_READ_JOB = "calendar-read";
export const WORKER_MEMORY_HEADROOM_MIB = 768;

/** Only clean inactive disk pages are available without freeing a job's memory. */
function reclaimableInactiveFileBytes(source: string, version: 1 | 2, hierarchical: boolean): number {
  const values = new Map<string, number>();
  for (const line of source.trim().split("\n")) {
    const match = /^(\S+)\s+(\d+)$/.exec(line);
    if (!match || values.has(match[1]!)) return 0;
    values.set(match[1]!, Number(match[2]));
  }
  const prefix = hierarchical ? "total_" : "";
  const fields = [version === 2 ? "file" : "cache", "shmem", "inactive_file",
    version === 2 ? "file_dirty" : "dirty", version === 2 ? "file_writeback" : "writeback", "unevictable"];
  const bytes = fields.map(field => values.get(prefix + field));
  if (bytes.some(value => value === undefined || !Number.isSafeInteger(value) || value < 0)) return 0;
  const [file, shmem, inactive, dirty, writeback, unevictable] = bytes as number[];
  // Dirty, writeback and unevictable pages may overlap other file counters; subtracting them whole is conservative.
  return Math.max(0, Math.min(inactive!, Math.max(0, file! - shmem!)) - dirty! - writeback! - unevictable!);
}

export function availableWorkerMemoryBytes(): number {
  let available = freemem();
  if (platform() === "linux") {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
      if (match) available = Number(match[1]) * 1024;
    } catch { /* os.freemem remains conservative. */ }
    // MemAvailable describes the machine, which may be larger than this runner's cgroup.
    for (const [version, directory, limitName, usedName] of [
      [2, "/sys/fs/cgroup", "memory.max", "memory.current"],
      [1, "/sys/fs/cgroup/memory", "memory.limit_in_bytes", "memory.usage_in_bytes"],
    ] as const) {
      try {
        const limit = Number(readFileSync(join(directory, limitName), "utf8").trim());
        const used = Number(readFileSync(join(directory, usedName), "utf8").trim());
        if (Number.isFinite(limit) && limit > 0 && Number.isFinite(used) && used >= 0) {
          let reclaimable = 0;
          try {
            // v1 usage follows use_hierarchy; never mix local and descendant counters.
            const hierarchy = version === 1 ? readFileSync(join(directory, "memory.use_hierarchy"), "utf8").trim() : "0";
            if (hierarchy === "0" || hierarchy === "1") reclaimable = reclaimableInactiveFileBytes(
              readFileSync(join(directory, "memory.stat"), "utf8"), version, hierarchy === "1");
          } catch { /* Missing cache evidence keeps the complete usage charged. */ }
          available = Math.min(available, Math.max(0, limit - used + Math.min(used, reclaimable)));
        }
      } catch { /* This cgroup interface is not mounted, or has no limit ("max"). */ }
    }
  }
  const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
  return Number.isFinite(hostMiB) && hostMiB > 0
    ? Math.min(available, Math.max(0, hostMiB * MIB - process.memoryUsage.rss())) : available;
}

export interface WorkerProcessMemory { readonly pid: number; readonly parentPid: number; readonly rss: number; readonly peakRss?: number }
async function hostProcesses(): Promise<readonly WorkerProcessMemory[]> {
  const rows: WorkerProcessMemory[] = [];
  try {
    if (platform() === "linux") {
      for (const name of (await readdir("/proc")).filter(name => /^\d+$/.test(name))) {
        try {
          // Async reads reserve oversized buffers for these zero-length proc files.
          const status = readFileSync(`/proc/${name}/status`, "utf8");
          const highWater = /^VmHWM:\s+(\d+)/m.exec(status);
          rows.push({ pid: Number(name), parentPid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0),
            rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
            ...(highWater ? { peakRss: Number(highWater[1]) * 1024 } : {}) });
        } catch { /* A process can exit while the host is sampled. */ }
      }
    } else if (platform() === "win32") {
      const source = await new Promise<string>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PeakWorkingSetSize | ConvertTo-Json -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4 * MIB },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); }));
      const values = JSON.parse(source) as { ProcessId: number; ParentProcessId: number; WorkingSetSize: string | number; PeakWorkingSetSize?: string | number }[];
      for (const row of values) rows.push({ pid: row.ProcessId, parentPid: row.ParentProcessId, rss: Number(row.WorkingSetSize),
        ...(row.PeakWorkingSetSize === undefined ? {} : { peakRss: Number(row.PeakWorkingSetSize) * 1024 }) });
    }
  } catch { /* Unobserved children keep their complete peak reserved. */ }
  if (!rows.some(row => row.pid === process.pid)) rows.push({ pid: process.pid, parentPid: process.ppid, rss: process.memoryUsage.rss(),
    peakRss: process.resourceUsage().maxRSS * 1024 });
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
  if (platform() === "linux") try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // A zombie still answers kill(pid,0), but has no process memory left to reserve.
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    if (state === "Z" || state === "X") return false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; }
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

interface MemoryReservation { id: string; owner: number; pid: number | null; peak: number; entry: string }
interface HostState { reservations: MemoryReservation[]; parents: { pid: number; peak: number; entry?: string }[]; peaks?: Record<string, number[]> }

function parentMemoryEntry(): string {
  const script = process.argv[1]?.split(/[\\/]/).at(-1) ?? "node";
  const state = process.argv.find(arg => /^--state=(?:[a-z]{2}|system)$/i.test(arg));
  return script === "freshness-shadow.mts" ? `${script}:${state?.slice(8).toLowerCase() ?? "round"}` : script;
}

/** How often a running reserved child's peak is read, and how many recent run peaks set its job's reservation. */
const PEAK_SAMPLE_MS = 2000;
const MEASURED_PEAK_RUNS = 5;
/**
 * The job an entry ("<task id>/<script>") runs, which its measured memory is filed under: every calendar read is one
 * job, whatever script reads it; a statewide job is its family, the task id with its two-letter state segment set
 * aside; a job with no task id is its script. Entries that name no script keep their table peak.
 */
export function workerJobType(entry: string): string | null {
  const parts = entry.split(/[\\/]/);
  const script = parts.at(-1)!;
  if (!/[.](?:mts|ts|mjs|js)$/.test(script)) return null;
  const task = parts.slice(0, -1).join("/");
  if (/^meetings(?:-state)?:/.test(task)) return CALENDAR_READ_JOB;
  if (!task) return script;
  const family = task.split(/([-:/])/).map(part => /^[a-z]{2}$/i.test(part) ? "*" : part).join("");
  return `${family}/${script}`;
}
/** The largest recent measured peak, 5% over and rounded up to a whole MiB. */
function measuredReservationBytes(peaks: readonly number[]): number {
  return Math.ceil(Math.max(...peaks) * 1.05 / MIB) * MIB;
}
/** Linux high-water RSS of a process and its live descendants; null once the process is gone. */
async function processTreePeakBytes(root: number): Promise<number | null> {
  let total = 0;
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    const pid = pending[index]!;
    try { total += Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024; }
    catch { if (pid === root) return null; continue; }
    try { pending.push(...readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").split(/\s+/).filter(Boolean).map(Number)); }
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

interface WorkerMemoryLimit {
  readonly admissionsOpen?: () => boolean;
  readonly availableBytes?: () => number;
  readonly headroomBytes?: number;
  readonly peakBytes?: (entry: string) => number;
  readonly minimumPeakBytes?: (entry: string) => number;
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
  acquire(entry?: string, deadlineMs?: number, order?: WorkerMemoryOrder): Promise<WorkerMemoryRelease>;
}

/** A lower priority is offered memory first; equal priorities keep their arrival order. A held waiter that does not
 * fit keeps later waiters out for up to MEMORY_HOLD_MS, so the memory a finishing child frees is not taken first. */
export interface WorkerMemoryOrder { readonly priority: number; readonly hold?: boolean }
export const MEMORY_HOLD_MS = 5 * 60_000;

function statePublicationPeakBytes(entry: string): number {
  const script = entry.split(/[\\/]/).at(-1)!;
  const family = /^(?:worker-publication:|candidate-findings:)?(ballot-contests|candidate-profiles|candidate-corpus|voting-sites|candidate-campaign-sites-derived|registry-runtime):[A-Z]{2}(?=[:/]|$)/.exec(entry)?.[1];
  if (family) return STATE_PUBLICATION_PEAK_MIB * MIB;
  return ["assemble-ballot-package.mts", "fetch-voting-sites.mts", "derive-candidate-campaign-sites.mts", "promote-registry-runtime.mts", "retire-state-authorities.mts"].includes(script) ? ROUTINE_ENTRY_PEAK_MIB[script]! * MIB : 0;
}

function routineMinimumPeakBytes(entry: string): number {
  const script = entry.split(/[\\/]/).at(-1)!;
  return statePublicationPeakBytes(entry) || (["openstates-votes-refresh.mts", "legiscan-votes-refresh.mts", "acs-population-promote.mts"].includes(script)
    ? ROUTINE_ENTRY_PEAK_MIB[script]! * MIB : 0);
}

export function routineProcessSlots(memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  return workerProcessSlots(() => Number.MAX_SAFE_INTEGER, { ...memory,
    // Recent small-state runs cannot lower the full-state publication reservation.
    minimumPeakBytes: memory.minimumPeakBytes ?? routineMinimumPeakBytes,
    peakBytes: memory.peakBytes ?? (entry => statePublicationPeakBytes(entry) || (entry.startsWith("national-place:") ? NATIONAL_PLACE_PEAK_MIB * MIB : workerJobType(entry) === CALENDAR_READ_JOB ? CALENDAR_READ_PEAK_MIB * MIB : (/^state-money-.+[.]mts$/.test(entry.split(/[\\/]/).at(-1)!)
          ? WORKER_ENTRY_PEAK_MIB.national! : ROUTINE_ENTRY_PEAK_MIB[entry.split(/[\\/]/).at(-1)!] ?? WORKER_ENTRY_PEAK_MIB.lease!) * MIB)) });
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
  const waiting: { entry: string; deadline: number; priority: number; holdUntil: number; resolve: (release: WorkerMemoryRelease) => void; reject: (error: Error) => void }[] = [];
  const mutate = (operation: (state: HostState, processes: readonly WorkerProcessMemory[]) => void): void => {
    try {
      void Promise.resolve(host.transact(operation, false)).then(applied => {
        if (!applied) setTimeout(() => mutate(operation), 50).unref();
      }, () => { setTimeout(() => mutate(operation), 1000).unref(); });
    } catch { setTimeout(() => mutate(operation), 1000).unref(); }
  };
  if ((memory.parentPeakBytes ?? 0) > 0) mutate(state => {
    const parent = state.parents.find(row => row.pid === process.pid);
    if (parent) { parent.peak = Math.max(parent.peak, memory.parentPeakBytes!); parent.entry = parentMemoryEntry(); }
    else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes!, entry: parentMemoryEntry() });
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
          if (parent) { parent.peak = Math.max(parent.peak, memory.parentPeakBytes ?? 0); parent.entry = parentMemoryEntry(); }
          else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes ?? 0, entry: parentMemoryEntry() });
        }
        // A child past its reserved peak has shown it can reach that size again.
        for (const row of state.reservations) row.peak = Math.max(row.peak, rssFor(row.pid));
        const reserve = (entry: string): number => {
          const measured = state.peaks?.[workerJobType(entry) ?? ""];
          return Math.max(measured?.length ? measuredReservationBytes(measured) : peakFor(entry), memory.minimumPeakBytes?.(entry) ?? 0);
        };
        while (active < maximum && waiting.length) {
          const growth = state.reservations.reduce((sum, row) => sum + Math.max(0, row.peak - rssFor(row.pid)), 0) +
            state.parents.reduce((sum, row) => sum + Math.max(0, row.peak - (current.get(row.pid) ?? 0)), 0);
          const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
          const participants = new Set(state.parents.flatMap(parent => [...idsFor(parent.pid)]));
          const used = rows.reduce((sum, row) => participants.has(row.pid) ? sum + row.rss : sum, 0);
          const free = Math.min(available(), Number.isFinite(hostMiB) && hostMiB > 0 ? Math.max(0, hostMiB * MIB - used) : Infinity);
          let index = -1;
          for (const [at, item] of waiting.entries()) {
            if (Date.now() >= item.deadline) continue;
            if (inherited || free >= headroom + growth + reserve(item.entry)) { index = at; break; }
            if (item.holdUntil > Date.now()) break;
          }
          if (index < 0) break;
          const [item] = waiting.splice(index, 1);
          const id = randomUUID();
          let reserved = reserve(item!.entry);
          if (!inherited) state.reservations.push({ id, owner: process.pid, pid: null, peak: reserved, entry: item!.entry });
          active++;
          let released = false;
          let measured = 0;
          let sampler: ReturnType<typeof setInterval> | undefined;
          const key = workerJobType(item!.entry);
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
            sampler = setInterval(() => void processTreePeakBytes(pid).then(bytes => {
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
  return { acquire: (entry = "lease-worker.ts", deadlineMs = Date.now() + (memory.waitMs ?? 120_000), order) =>
    new Promise<WorkerMemoryRelease>((resolve, reject) => {
      // A child that starts late in a pass, the next read in a serial lane, keeps the place its pass gave it.
      const priority = order?.priority ?? Number.POSITIVE_INFINITY;
      const at = waiting.findIndex(item => item.priority > priority);
      waiting.splice(at < 0 ? waiting.length : at, 0,
        { entry, deadline: deadlineMs, priority, holdUntil: order?.hold ? Date.now() + MEMORY_HOLD_MS : 0, resolve, reject });
      requestDrain();
    }) };
}

/** How often a wait for host memory says it is still waiting. */
export const MEMORY_WAIT_REPORT_EVERY_MS = 60_000;

/** Report pending admission so the runner's no-output timeout does not mistake a wait for a crash. */
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
  return { acquire: (entry, deadlineMs, order) => {
    const wait = ++waits;
    const started = Date.now();
    const kind = (entry ?? "lease-worker.ts").split(/[\\/]/).at(-1);
    const limit = deadlineMs === undefined || !Number.isFinite(deadlineMs) ? null : Math.max(1, Math.ceil((deadlineMs - started) / minuteMs));
    const timer = setInterval(() => {
      const minutes = Math.max(1, Math.round((Date.now() - started) / minuteMs));
      write(`  waiting for memory: wait ${wait} (${kind}) ${minutes}${limit === null ? "" : ` of ${limit}`} min; the work stays owed`);
    }, everyMs);
    timer.unref?.();
    const settled = slots.acquire(entry, deadlineMs, order);
    void settled.then(() => clearInterval(timer), () => clearInterval(timer));
    return settled;
  } };
}

/** Heartbeat reads the atomically replaced reservation file without taking the admission lock. */
export interface HostMemoryReading {
  readonly at: string;
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly headroomBytes: number;
  /** The runner and every process under it. */
  readonly runnerTreeRssBytes: number;
  readonly runnerTreeProcesses: number;
  readonly parents: readonly { readonly pid: number; readonly peakBytes: number; readonly rssBytes: number;
    readonly peakRssBytes?: number | null; readonly entry?: string | null }[];
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
    readonly parents: readonly { pid: number; peak: number; entry?: string }[] } | null;
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
    rssBytes: input.rows.find(r => r.pid === row.pid)?.rss ?? 0,
    peakRssBytes: input.rows.find(r => r.pid === row.pid)?.peakRss ?? null, entry: row.entry ?? null }));
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
