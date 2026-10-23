/**
 * Research-window decisions over pipeline state; no reader door and no civic-data promotion.
 * The lock is a CAS lease in `leases`, never `repos.locks`: the Postgres advisory lock is released
 * by the HTTP driver before the guarded section runs.
 */

import { claim, isExpired, release, type ExecutionLease } from "../attempt.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { retryStartupRead, type StartupReadRetryOptions } from "../startup-read-retry.ts";
import type { WindowRunRecord } from "./types.ts";
import { WINDOW_FORMAT_VERSION } from "./types.ts";
export const WINDOW_LEASE_ID = "nightly-window";
export const WINDOW_LEASE_TTL_MS = 90 * 60_000;

export class WindowLockHeld extends Error {
  readonly holder: string;
  readonly until: string;

  constructor(holder: string, until: string) {
    super(
      `the nightly-window lease is held by ${holder} until ${until}. A second window, or a cycle ` +
        "under a window, is refused rather than interleaved.",
    );
    this.name = "WindowLockHeld";
    this.holder = holder;
    this.until = until;
  }
}

/** The aggregate id is fixed so the slot is the race; the value's own id moves per claim. */
export async function acquireWindowLease(
  repos: ControlPlaneRepositories,
  holder: string,
  now: string,
  ttlMs: number = WINDOW_LEASE_TTL_MS,
  readRetry?: StartupReadRetryOptions,
): Promise<{ readonly lease: ExecutionLease; readonly revision: number }> {
  // Retry only the idempotent read. An uncertain put/CAS response must never
  // re-run the claim or allow work to start without a confirmed lease.
  const existing = readRetry
    ? await retryStartupRead(() => repos.leases.read(WINDOW_LEASE_ID), () => null, readRetry)
    : await repos.leases.read(WINDOW_LEASE_ID);
  if (existing !== null && !isExpired(existing.value, now) && existing.value.holder !== holder) {
    throw new WindowLockHeld(existing.value.holder, existing.value.expiresAt);
  }
  const lease = claim(WINDOW_LEASE_ID, holder, now, ttlMs, existing?.value ?? null);
  if (existing === null) {
    const put = await repos.leases.put(WINDOW_LEASE_ID, lease, now);
    return { lease: put.persisted.value, revision: put.persisted.revision };
  }
  const persisted = await repos.leases.compareAndSet(WINDOW_LEASE_ID, existing.revision, lease, now);
  return { lease: persisted.value, revision: persisted.revision };
}

export async function releaseWindowLease(
  repos: ControlPlaneRepositories,
  holder: string,
  now: string,
): Promise<boolean> {
  const current = await repos.leases.read(WINDOW_LEASE_ID);
  if (current === null || current.value.holder !== holder || current.value.released) return false;
  await repos.leases.compareAndSet(WINDOW_LEASE_ID, current.revision, release(current.value), now);
  return true;
}

/** The process a window-lease holder id names: `<role>@<host>#<pid>`, e.g. `cycle@HOST#1234`. */
export function windowLeaseHolderProcess(
  holder: string,
): { readonly role: string; readonly host: string; readonly pid: number } | null {
  const match = /^([a-z][a-z-]*)@([^#@]+)#(\d+)$/.exec(holder);
  if (match === null) return null;
  const pid = Number(match[3]);
  return Number.isSafeInteger(pid) && pid > 0 ? { role: match[1]!, host: match[2]!, pid } : null;
}

export type ExitedHolderRecovery =
  | { readonly state: "RELEASED"; readonly holder: string; readonly expiresAt: string }
  | { readonly state: "NOT_NEEDED" | "KEPT"; readonly holder: string | null; readonly reason: string };

/**
 * Releases a lease whose holder names a process on this host that no longer exists, through the same
 * compare-and-set as `releaseWindowLease`. Keeps it when another host holds it, the holder names no
 * process, or the pid is live or unreadable.
 */
export async function releaseWindowLeaseOfExitedLocalHolder(
  repos: ControlPlaneRepositories,
  input: { readonly host: string; readonly now: string; readonly processExists: (pid: number) => boolean },
): Promise<ExitedHolderRecovery> {
  const current = await repos.leases.read(WINDOW_LEASE_ID);
  if (current === null || isExpired(current.value, input.now)) {
    return { state: "NOT_NEEDED", holder: current?.value.holder ?? null, reason: "no live window lease stands" };
  }
  const holder = current.value.holder;
  const held = windowLeaseHolderProcess(holder);
  if (held === null) return { state: "KEPT", holder, reason: "the holder does not name a process" };
  if (held.host.toLowerCase() !== input.host.toLowerCase()) {
    return { state: "KEPT", holder, reason: `held on host ${held.host}, whose processes this host cannot see` };
  }
  if (input.processExists(held.pid)) return { state: "KEPT", holder, reason: `process ${held.pid} still exists` };
  await repos.leases.compareAndSet(WINDOW_LEASE_ID, current.revision, release(current.value), input.now);
  return { state: "RELEASED", holder, expiresAt: current.value.expiresAt };
}

/** A window record this module wrote, as opposed to a foreign row under the same log. */
export function isWindowRunRecord(value: unknown): value is WindowRunRecord {
  if (value === null || typeof value !== "object") return false;
  const r = value as { formatVersion?: unknown; windowId?: unknown; localDate?: unknown; finishedAt?: unknown; stages?: unknown };
  return (
    r.formatVersion === WINDOW_FORMAT_VERSION &&
    typeof r.windowId === "string" &&
    typeof r.localDate === "string" &&
    typeof r.finishedAt === "string" &&
    Array.isArray(r.stages)
  );
}
