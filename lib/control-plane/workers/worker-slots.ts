import { freemem, platform, tmpdir, totalmem } from "node:os";
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const MIB = 1024 * 1024;
/** Measured RSS floors; host observations may raise these, never lower them. */
export const WORKER_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = { route: 285, scout: 248, lease: 544, national: 3648 };
const SCOPED_DATA_PEAK_MIB = 1258;
/** Rounded up from the ordinary staging research parent's 3,069,235,200-byte peak. */
export const RESEARCH_PARENT_PEAK_MIB = 2928;
/** The promoter's own peak. Its national child takes a separate reservation. */
export const NATIONAL_PLACE_PEAK_MIB = 1923;
/** Parent high-water observations, rounded up with room for sampling. */
export const RUNNER_PARENT_PEAK_MIB: Readonly<Record<string, number>> = {
  "pilot-runner.mts": 384,
  "routine-civic-data-runner.mts": 640,
  "publish-now-runner.mts": 704,
  "freshness-shadow.mts": RESEARCH_PARENT_PEAK_MIB,
  "hunter-lane.mts": RESEARCH_PARENT_PEAK_MIB,
};
const STATE_PUBLICATION_PEAK_MIB = 512;
/** Bulk data families use the retained data-worker bound until their own runs are measured on this host. */
export const ROUTINE_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = {
  // A fresh frozen install, including postinstall, peaked at 1,295 MiB across three processes (100 ms samples).
  "runtime-release-install.mjs": 1536,
  "runtime-release-command.mjs": 342,
  // A complete 113 MiB Illinois session peaked at 3,013 MiB;
  // the host observer also accounts for each worker's descendants.
  "openstates-votes-refresh.mts": 3072,
  "legiscan-votes-refresh.mts": 3072,
  "federal-money-refresh.mts": 768,
  "fetch-fec.mts": 448,
  "state-campaign-finance.mts": 704,
  "state-money-az.mts": 416,
  "state-money-nh.mts": 342,
  "state-money-nj.mts": 768,
  "state-legislators.mts": 384,
  "nh-gencourt-members.mts": 512,
  "openstates-people-refresh.mts": 1024,
  "open-data-refresh.mts": 1792,
  "registration-refresh.mts": 1344,
  "fetch-dotgov.mts": 544,
  "derive-meeting-body-crosswalk.mts": 640,
  "derive-meeting-source-wiring.mts": 1024,
  "publish-meeting-doors.mts": 512,
  "publish-member-offices.mts": 960,
  "platform-census-runner.mts": 512,
  "src-cg-refresh.mts": 512,
  "fetch-votes.mts": 512,
  "fetch-key-vote-positions.mts": 512,
  "census-geography-refresh.mts": SCOPED_DATA_PEAK_MIB,
  "promote-manual-civic-projection.mts": SCOPED_DATA_PEAK_MIB,
  "ingest.ts": SCOPED_DATA_PEAK_MIB,
  "state-rollcalls.mts": SCOPED_DATA_PEAK_MIB,
  "legistar-outcomes-ingest.mts": 640,
  "legistar-insite-minutes-ingest.mts": 768,
  "acs-population-promote.mts": SCOPED_DATA_PEAK_MIB,
  "fetch-congress-legislators.mts": 652,
  "national-people-refresh.mts": 3575,
  "people-portraits-refresh.mts": 640,
  "campaign-finance-az-pima-transactions.mts": 640,
  "assemble-ballot-package.mts": STATE_PUBLICATION_PEAK_MIB,
  "fetch-voting-sites.mts": 640,
  "derive-candidate-campaign-sites.mts": STATE_PUBLICATION_PEAK_MIB,
  "promote-registry-runtime.mts": 768,
  "routine-civic-data-reader-repair.mts": 544,
  "retire-state-authorities.mts": STATE_PUBLICATION_PEAK_MIB,
  "loss-study-pass.mts": 544,
  "look-pass.mts": 800,
  "resident-tasks.mts": 1280,
};
export const WORKER_MEMORY_HEADROOM_MIB = 768;

export function availableWorkerMemoryBytes(): number {
  let available = freemem();
  if (platform() === "linux") {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
      if (match) available = Number(match[1]) * 1024;
    } catch { /* os.freemem remains conservative. */ }
    // MemAvailable describes the machine, which may be larger than this runner's cgroup.
    for (const [limitPath, usedPath] of [
      ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"],
      ["/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"],
    ]) {
      try {
        const limit = Number(readFileSync(limitPath!, "utf8").trim());
        const used = Number(readFileSync(usedPath!, "utf8").trim());
        if (Number.isFinite(limit) && limit > 0 && Number.isFinite(used)) available = Math.min(available, Math.max(0, limit - used));
      } catch { /* This cgroup interface is not mounted. */ }
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
          rows.push({ pid: Number(name), parentPid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0),
            rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
            peakRss: Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
        } catch { /* A process can exit while the host is sampled. */ }
      }
    } else if (platform() === "win32") {
      const source = await new Promise<string>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PeakWorkingSetSize | ConvertTo-Json -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4 * MIB },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); }));
      const values = JSON.parse(source) as { ProcessId: number; ParentProcessId: number; WorkingSetSize: string | number; PeakWorkingSetSize: string | number }[];
      for (const row of values) {
        const rss = Number(row.WorkingSetSize), peakKiB = Number(row.PeakWorkingSetSize);
        rows.push({ pid: row.ProcessId, parentPid: row.ParentProcessId, rss, peakRss: Number.isFinite(peakKiB) ? peakKiB * 1024 : rss });
      }
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
interface HostState { reservations: MemoryReservation[]; parents: { pid: number; peak: number }[]; peaks?: Record<string, number[]> }

/** Every managed process owns its unmanaged descendants; separately admitted children own their own memory. */
function memoryOwners(state: { readonly reservations: readonly { readonly pid: number | null }[]; readonly parents: readonly { readonly pid: number }[] }, rows: readonly WorkerProcessMemory[]) {
  const roots = new Set([...state.parents.map(row => row.pid), ...state.reservations.flatMap(row => row.pid === null ? [] : [row.pid])]);
  const trees = new Map<number, Set<number>>();
  const tree = (pid: number): Set<number> => {
    let ids = trees.get(pid);
    if (!ids) { ids = descendants(pid, rows); trees.set(pid, ids); }
    return ids;
  };
  const memoryFor = (pid: number | null, peak: boolean): number => {
    if (pid === null) return 0;
    const ids = new Set(tree(pid));
    for (const other of roots) if (other !== pid && ids.has(other)) for (const child of tree(other)) ids.delete(child);
    return rows.reduce((sum, row) => sum + (ids.has(row.pid) ? peak ? Math.max(row.rss, row.peakRss ?? 0) : row.rss : 0), 0);
  };
  return { roots, tree, rss: (pid: number | null) => memoryFor(pid, false), peak: (pid: number | null) => memoryFor(pid, true) };
}

/** How often a running reserved child's high-water memory is read. */
const PEAK_SAMPLE_MS = 2000;
/** The script an entry runs ("…/national-people-refresh.mts"); entries that name no script keep their table peak. */
let loadedCommit: string | undefined;
function peakCodeIdentity(): string {
  if (process.env.WTP_WORKER_MEMORY_RELEASE) return process.env.WTP_WORKER_MEMORY_RELEASE;
  if (loadedCommit !== undefined) return loadedCommit;
  try {
    let git = join(process.cwd(), ".git");
    try { const pointer = readFileSync(git, "utf8"); if (pointer.startsWith("gitdir:")) git = resolve(process.cwd(), pointer.slice(7).trim()); } catch { /* Ordinary .git directory. */ }
    const head = readFileSync(join(git, "HEAD"), "utf8").trim();
    if (/^[a-f0-9]{40}$/.test(head)) return loadedCommit = head;
    const ref = head.replace(/^ref:\s*/, "");
    let common = git;
    try { common = resolve(git, readFileSync(join(git, "commondir"), "utf8").trim()); } catch { /* Main checkout. */ }
    for (const directory of [git, common]) {
      try { const sha = readFileSync(join(directory, ref), "utf8").trim(); if (/^[a-f0-9]{40}$/.test(sha)) return loadedCommit = sha; } catch { /* Packed reference. */ }
      try { const line = readFileSync(join(directory, "packed-refs"), "utf8").split("\n").find(line => line.endsWith(` ${ref}`)); if (line) return loadedCommit = line.slice(0, 40); } catch { /* No packed references. */ }
    }
  } catch { /* Isolated workers retain the declared table version. */ }
  return loadedCommit = "isolated";
}
export function workerMemoryPeakKey(entry: string): string | null {
  const script = entry.split(/[\\/]/).at(-1)!;
  const table = createHash("sha256").update(JSON.stringify([WORKER_ENTRY_PEAK_MIB, ROUTINE_ENTRY_PEAK_MIB, RUNNER_PARENT_PEAK_MIB])).digest("hex").slice(0, 16);
  return /[.](?:mts|ts|mjs|js)$/.test(script) ? `${peakCodeIdentity()}:${table}:${script}` : null;
}
/** The measured peak, 5% over and rounded up to a whole MiB. */
function measuredReservationBytes(peaks: readonly number[]): number {
  return Math.ceil(Math.max(...peaks) * 1.05 / MIB) * MIB;
}
export interface WorkerMemoryHost {
  transact(operation: (state: HostState, processes: readonly WorkerProcessMemory[]) => void, sampleProcesses?: boolean): boolean | Promise<boolean>;
}
/** Transient host reservations, shared by independent research/routine parents.
 * No work, receipt, spending or publication state is written here. */
export function workerMemoryHost(input: { readonly shared?: boolean; readonly processes?: () => readonly WorkerProcessMemory[] | PromiseLike<readonly WorkerProcessMemory[]> } = {}): WorkerMemoryHost {
  let local: HostState = { reservations: [], parents: [] };
  const sample = input.processes ?? hostProcesses;
  let sampling: Promise<readonly WorkerProcessMemory[]> | undefined;
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
    const rows = sampling ?? sample();
    // Sampling may wait on the OS; the shared lock only protects the state update.
    if (Array.isArray(rows)) return apply(operation, rows);
    sampling ??= Promise.resolve(rows).finally(() => { sampling = undefined; });
    return sampling.then(values => apply(operation, values));
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
  acquire(entry?: string, deadlineMs?: number, signal?: AbortSignal): Promise<WorkerMemoryRelease>;
}

function statePublicationPeakBytes(entry: string): number {
  const script = entry.split(/[\\/]/).at(-1)!;
  const family = /^(?:worker-publication:|candidate-findings:)?(ballot-contests|candidate-profiles|candidate-corpus|voting-sites|candidate-campaign-sites-derived|registry-runtime):[A-Z]{2}(?=[:/]|$)/.exec(entry)?.[1];
  const scripted = ["assemble-ballot-package.mts", "fetch-voting-sites.mts", "derive-candidate-campaign-sites.mts", "promote-registry-runtime.mts", "retire-state-authorities.mts"].includes(script);
  return Math.max(family ? STATE_PUBLICATION_PEAK_MIB : 0, family || scripted ? ROUTINE_ENTRY_PEAK_MIB[script] ?? 0 : 0) * MIB;
}

export function routineProcessSlots(memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  return workerProcessSlots(() => Number.MAX_SAFE_INTEGER, { ...memory,
    parentPeakBytes: memory.parentPeakBytes ?? (RUNNER_PARENT_PEAK_MIB[process.argv[1]?.split(/[\\/]/).at(-1) ?? ""] ?? 0) * MIB,
    minimumPeakBytes: memory.minimumPeakBytes ?? statePublicationPeakBytes,
    peakBytes: memory.peakBytes ?? (entry => {
      if (entry.startsWith("national-place:")) return NATIONAL_PLACE_PEAK_MIB * MIB;
      const script = entry.split(/[\\/]/).at(-1)!;
      return Math.max(statePublicationPeakBytes(entry), (RUNNER_PARENT_PEAK_MIB[script] ?? ROUTINE_ENTRY_PEAK_MIB[script] ??
        (/^state-money-.+[.]mts$/.test(script) ? SCOPED_DATA_PEAK_MIB : WORKER_ENTRY_PEAK_MIB.lease!)) * MIB);
    }) });
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
  const mutate = (operation: (state: HostState, processes: readonly WorkerProcessMemory[]) => void, sampleProcesses = false): void => {
    try {
      void Promise.resolve(host.transact(operation, sampleProcesses)).then(applied => {
        if (!applied) setTimeout(() => mutate(operation, sampleProcesses), 50).unref();
      }, () => { setTimeout(() => mutate(operation, sampleProcesses), 1000).unref(); });
    } catch { setTimeout(() => mutate(operation, sampleProcesses), 1000).unref(); }
  };
  const registerParent = (state: HostState) => {
    const reservation = state.reservations.find(row => row.pid === process.pid);
    if (reservation) {
      reservation.peak = Math.max(reservation.peak, memory.parentPeakBytes ?? 0);
      state.parents = state.parents.filter(parent => parent.pid !== process.pid);
      return;
    }
    const parent = state.parents.find(row => row.pid === process.pid);
    if (parent) parent.peak = Math.max(parent.peak, memory.parentPeakBytes ?? 0);
    else state.parents.push({ pid: process.pid, peak: memory.parentPeakBytes ?? 0 });
  };
  if ((memory.parentPeakBytes ?? 0) > 0) mutate(registerParent);
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
        registerParent(state);
        const owners = memoryOwners(state, rows);
        const rssFor = owners.rss;
        // The OS high-water value survives a brief peak between observer samples.
        for (const row of state.reservations) row.peak = Math.max(row.peak, owners.peak(row.pid));
        for (const row of state.parents) row.peak = Math.max(row.peak, owners.peak(row.pid));
        const reserve = (entry: string): number => {
          const measured = state.peaks?.[workerMemoryPeakKey(entry) ?? ""];
          return Math.max(peakFor(entry), measured?.length ? measuredReservationBytes(measured) : 0, memory.minimumPeakBytes?.(entry) ?? 0);
        };
        while (active < maximum && waiting.length) {
          const growth = state.reservations.reduce((sum, row) => sum + Math.max(0, row.peak - rssFor(row.pid)), 0) +
            state.parents.reduce((sum, row) => sum + Math.max(0, row.peak - rssFor(row.pid)), 0);
          const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
          const participants = new Set([...owners.roots].flatMap(pid => [...owners.tree(pid)]));
          const used = rows.reduce((sum, row) => participants.has(row.pid) ? sum + row.rss : sum, 0);
          const free = Math.min(available(), Number.isFinite(hostMiB) && hostMiB > 0 ? Math.max(0, hostMiB * MIB - used) : Infinity);
          const index = waiting.findIndex(item => {
            if (Date.now() >= item.deadline) return false;
            return free >= headroom + growth + reserve(item.entry);
          });
          if (index < 0) break;
          const [item] = waiting.splice(index, 1);
          const id = randomUUID();
          let reserved = reserve(item!.entry);
          state.reservations.push({ id, owner: process.pid, pid: null, peak: reserved, entry: item!.entry });
          active++;
          let released = false;
          let measured = 0;
          let sampler: ReturnType<typeof setInterval> | undefined;
          const key = workerMemoryPeakKey(item!.entry);
          const release: WorkerMemoryRelease = Object.assign(() => {
            if (released) return;
            released = true; active--;
            clearInterval(sampler);
            mutate(state => {
              state.reservations = state.reservations.filter(row => row.id !== id);
              if (key !== null && measured > 0) (state.peaks ??= {})[key] = [Math.max(measured, ...state.peaks[key] ?? [])];
            });
            requestDrain();
          }, { observe: (pid: number) => {
            if (released) return;
            mutate(state => { const row = state.reservations.find(row => row.id === id); if (row) row.pid = pid; });
            const samplePeak = () => mutate((state, processes) => {
              if (released) return;
              if (!processes.some(row => row.pid === pid)) { clearInterval(sampler); return; }
              const bytes = memoryOwners(state, processes).peak(pid);
              measured = Math.max(measured, bytes);
              reserved = Math.max(reserved, bytes);
              const row = state.reservations.find(row => row.id === id);
              if (row) row.peak = Math.max(row.peak, reserved);
            }, true);
            samplePeak();
            sampler = setInterval(samplePeak, PEAK_SAMPLE_MS);
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
  return { acquire: (entry = "lease-worker.ts", deadlineMs = Date.now() + (memory.waitMs ?? 120_000), signal) =>
    new Promise<WorkerMemoryRelease>((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const item = { entry, deadline: deadlineMs,
        resolve: (release: WorkerMemoryRelease) => { cleanup(); resolve(release); },
        reject: (error: Error) => { cleanup(); reject(error); } };
      const abort = () => {
        const index = waiting.indexOf(item);
        if (index < 0) return;
        waiting.splice(index, 1);
        item.reject(signal!.reason instanceof Error ? signal!.reason : new Error(String(signal!.reason)));
        requestDrain();
      };
      waiting.push(item);
      signal?.addEventListener("abort", abort, { once: true });
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
  return { acquire: (entry, deadlineMs, signal) => {
    const wait = ++waits;
    const started = Date.now();
    const kind = (entry ?? "lease-worker.ts").split(/[\\/]/).at(-1);
    const limit = deadlineMs === undefined || !Number.isFinite(deadlineMs) ? null : Math.max(1, Math.ceil((deadlineMs - started) / minuteMs));
    const timer = setInterval(() => {
      const minutes = Math.max(1, Math.round((Date.now() - started) / minuteMs));
      write(`  waiting for memory: wait ${wait} (${kind}) ${minutes}${limit === null ? "" : ` of ${limit}`} min; the work stays owed`);
    }, everyMs);
    timer.unref?.();
    const settled = slots.acquire(entry, deadlineMs, signal);
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
  const owners = memoryOwners(input.state ?? { parents: [], reservations: [] }, input.rows);
  const runner = descendants(input.rootPid, input.rows);
  const parents = (input.state?.parents ?? []).map(row => ({ pid: row.pid, peakBytes: row.peak,
    rssBytes: owners.rss(row.pid) }));
  const reservations = (input.state?.reservations ?? []).map(row => ({ entry: row.entry.split(/[\\/]/).at(-1) ?? row.entry, peakBytes: row.peak, rssBytes: owners.rss(row.pid) }));
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
  const live = state === null ? null : { reservations: (state.reservations ?? []).filter(row => row.pid === null ? alive(row.owner) : alive(row.pid) || alive(row.owner)),
    parents: (state.parents ?? []).filter(row => alive(row.pid)) };
  const rows = await hostProcesses();
  const owners = memoryOwners(live ?? { reservations: [], parents: [] }, rows);
  const participants = new Set([...descendants(process.pid, rows), ...[...owners.roots].flatMap(pid => [...owners.tree(pid)])]);
  const used = rows.reduce((sum, row) => participants.has(row.pid) ? sum + row.rss : sum, 0);
  return memoryReading({ at, totalBytes: Number.isFinite(hostMiB) && hostMiB > 0 ? hostMiB * MIB : totalmem(),
    availableBytes: Math.min(availableWorkerMemoryBytes(), Number.isFinite(hostMiB) && hostMiB > 0 ? Math.max(0, hostMiB * MIB - used) : Infinity),
    rootPid: process.pid, rows, state: live });
}
