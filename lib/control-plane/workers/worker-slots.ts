import { freemem, platform } from "node:os";
import { readFileSync } from "node:fs";

const MIB = 1024 * 1024;
/** Rounded-up measured RSS peaks of each entry; free memory already excludes running work. */
export const WORKER_ENTRY_PEAK_MIB: Readonly<Record<string, number>> = { route: 248, scout: 248, lease: 342, national: 1258 };
/** Sean's 0.75 GiB margin on the 8 GiB host (7,424 MiB maximum total use). */
export const WORKER_MEMORY_HEADROOM_MIB = 768;

export function availableWorkerMemoryBytes(): number {
  let available = freemem();
  if (platform() === "linux") {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
      if (match) available = Number(match[1]) * 1024;
    } catch { /* os.freemem remains the conservative fallback. */ }
  }
  // Staging can exercise the production host size while still respecting real OS availability.
  const hostMiB = Number(process.env.WTP_WORKER_HOST_MEMORY_MIB);
  return Number.isFinite(hostMiB) && hostMiB > 0 ? Math.min(available, hostMiB * MIB) : available;
}

export interface WorkerMemoryLimit {
  /** Existing release reconciliation closes only new admissions; running workers finish. */
  readonly admissionsOpen?: () => boolean;
  readonly availableBytes?: () => number;
  readonly headroomBytes?: number;
  readonly peakBytes?: (entry: string) => number;
}

/** Shared budget/provider slots plus OS memory admission; ready work remains queued. */
export interface WorkerProcessSlots {
  acquire(entry?: string): Promise<() => void>;
}

export function workerProcessSlots(capacity: () => number, memory: WorkerMemoryLimit = {}): WorkerProcessSlots {
  let active = 0;
  let reservedBytes = 0;
  let wake: ReturnType<typeof setTimeout> | undefined;
  const available = memory.availableBytes ?? availableWorkerMemoryBytes;
  const headroom = memory.headroomBytes ?? WORKER_MEMORY_HEADROOM_MIB * MIB;
  const peakFor = memory.peakBytes ?? (entry => {
    const kind = /(?:^|\/|\\)(route|scout|lease|national)-worker[.]ts$/.exec(entry)?.[1] ?? "lease";
    return WORKER_ENTRY_PEAK_MIB[kind]! * MIB;
  });
  const waiting: Array<{ entry: string; resolve: (release: () => void) => void; reject: (error: Error) => void; queuedAt?: number }> = [];
  const drain = (): void => {
    clearTimeout(wake); wake = undefined;
    if (memory.admissionsOpen?.() === false) {
      for (const item of waiting.splice(0)) item.reject(new Error("RUNTIME_RELEASE_DRAINED: queued work remains owed for the next runtime"));
      return;
    }
    const maximum = capacity();
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
    while (active < maximum && waiting.length) {
      const item = waiting[0]!;
      const peak = peakFor(item.entry);
      const free = available();
      if (free < headroom + reservedBytes + peak) {
        if (item.queuedAt === undefined) {
          item.queuedAt = Date.now();
          console.log(`  worker process queued for memory: ${item.entry}; available ${Math.floor(free / MIB)} MiB; reserved ${Math.ceil(reservedBytes / MIB)} MiB; entry ${Math.ceil(peak / MIB)} MiB; headroom ${headroom / MIB} MiB; ${waiting.length} ready`);
        }
        // Another process can release memory even when none of our children exits.
        wake = setTimeout(drain, 1000);
        break;
      }
      waiting.shift();
      active++;
      reservedBytes += peak;
      if (item.queuedAt !== undefined) console.log(`  worker memory queue released: ${item.entry}; waited ${Date.now() - item.queuedAt}ms; ${active} live, ${waiting.length} ready`);
      let released = false;
      item.resolve(() => {
        if (released) return;
        released = true;
        active--;
        reservedBytes -= peak;
        drain();
      });
    }
  };
  return { acquire: (entry = "lease-worker.ts") => new Promise<() => void>((resolve, reject) => { waiting.push({ entry, resolve, reject }); drain(); }) };
}
