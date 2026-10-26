import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceAcquisitionSleep } from "./acquisition-deadline.ts";
import { operationalStatePath } from "../ops/operational-state-path.ts";

export interface HostState {
  nextAt: number;
  intervalMs: number;
  baseMs?: number;
  lastAt?: number;
  healthy: number;
  until: number;
  refused: Record<string, string>;
  routes: Record<string, number>;
}
export interface HostStateStore {
  withHost<T>(host: string, signal: AbortSignal | undefined, work: (state: HostState) => Promise<T>): Promise<T>;
}
const empty = (): HostState => ({ nextAt: 0, intervalMs: 0, healthy: 0, until: 0, refused: {}, routes: {} });

/** Test and embedded readers share state for the lifetime of their transport. */
export function memoryHostState(): HostStateStore {
  const states = new Map<string, HostState>(), turns = new Map<string, Promise<void>>();
  return { async withHost(host, signal, work) {
    const before = turns.get(host) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    turns.set(host, turn);
    await before;
    try {
      signal?.throwIfAborted();
      const state = states.get(host) ?? empty(); states.set(host, state);
      return await work(state);
    } finally { release(); if (turns.get(host) === turn) turns.delete(host); }
  } };
}

/** All source children on the runner share these small files; pacing spends no database transfer. */
export function fileHostState(root = join(process.env.WTP_WORKER_MEMORY_DIRECTORY ??
  (process.env.WTP_RUNTIME_MODE === "production" ? "/var/lib/meanwhile" : join(tmpdir(), "meanwhile-worker-memory")), "source-hosts")): HostStateStore {
  return new FileHostState(root);
}

class FileHostState implements HostStateStore {
  private readonly root: string;
  constructor(root: string) { this.root = operationalStatePath(root); }
  private key(host: string): string { return join(this.root, createHash("sha256").update(host).digest("hex")); }
  async withHost<T>(host: string, signal: AbortSignal | undefined, work: (state: HostState) => Promise<T>): Promise<T> {
    // Every write names its confined operational path, so the release firewall can see it stays outside the repository.
    await mkdir(operationalStatePath(this.root), { recursive: true });
    const key = this.key(host);
    const lock = operationalStatePath(`${key}.lock`);
    const lockOwner = operationalStatePath(join(lock, "owner"));
    const savedState = operationalStatePath(`${key}.source-host-state`);
    const temporaryState = operationalStatePath(`${key}.${process.pid}.tmp`);
    for (;;) {
      signal?.throwIfAborted();
      try { await mkdir(lock); await writeFile(lockOwner, String(process.pid)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // A killed child cannot hold a server forever. A live reader keeps its lock even during a long response.
        const held = await stat(lock).catch(() => null);
        const owner = Number(await readFile(lockOwner, "utf8").catch(() => ""));
        let alive = owner > 0;
        if (alive) try { process.kill(owner, 0); } catch (gone) { alive = (gone as NodeJS.ErrnoException).code !== "ESRCH"; }
        if (owner > 0 && !alive || !owner && held && Date.now() - held.mtimeMs > 300_000) await rm(lock, { recursive: true, force: true });
        await sourceAcquisitionSleep(25, signal);
      }
    }
    try {
      let state: HostState;
      try { state = JSON.parse(await readFile(savedState, "utf8")) as HostState; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = empty(); }
      state.healthy ??= 0;
      try { return await work(state); }
      finally {
        await writeFile(temporaryState, JSON.stringify(state));
        await rename(temporaryState, savedState);
      }
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
}
