/**
 * The hourly check's first look. Each hot door's start page or feed is looked
 * at once an hour; a change is stored on the door (`validators.changedAt`) for
 * the publish-now lane to read at once. One host gets at most ten requests an
 * hour, counting looks already made; a look that cannot be made now waits,
 * oldest first. Plain code, no AI.
 */

import { doorPartitionIds } from "./mission-refresh.ts";
import { firstLook, probeUrlFor, recordProbe, type ProbeFetch, type ProbeResult } from "./probe.ts";
import { HOT_CHECK_MINUTES } from "./overdue.ts";
import type { DoorRecord, DoorRepository } from "./registry.ts";

/** At most this many requests to one website in an hour. */
export const PROBE_HOST_HOURLY_LIMIT = 10;
/** A look is made this long before the hour is up, so the check lands on the hour rather than after it. */
export const PROBE_LEAD_MINUTES = 5;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Off by default: the routine pass alone reads doors until probes are switched on. */
export const DOOR_PROBE_SWITCH = "WTP_DOOR_PROBES";
export function doorProbesOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[DOOR_PROBE_SWITCH]?.trim().toLowerCase() === "on";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The minutes between looks for a hot door: its own setting where it is faster than the hour, else the hour. */
function lookEveryMinutes(door: DoorRecord): number {
  return door.checkEveryMinutes !== null && door.checkEveryMinutes < HOT_CHECK_MINUTES ? door.checkEveryMinutes : HOT_CHECK_MINUTES;
}

export interface ProbePlan {
  /** The doors to look at now: one list, oldest look first. */
  readonly doors: readonly DoorRecord[];
  /** Hot doors with a page to look at that are not due, or wait for a host's hourly allowance. */
  readonly deferred: number;
}

/**
 * Which hot doors get a first look now. A door is hot when a partition it is read through (`hotPartitions`) has a
 * sitting in the seven-day window either side. Pure: the clock and the host counts are all in the arguments.
 */
export function planProbes(doors: readonly DoorRecord[], hotPartitions: ReadonlySet<string>, now: string): ProbePlan {
  const nowMs = Date.parse(now);
  const checkedAtMs = (door: DoorRecord): number => {
    const at = Date.parse(door.validators?.checkedAt ?? "");
    return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
  };
  const hot = doors.filter((door) => door.status === "OPEN" && doorPartitionIds(door).some((id) => hotPartitions.has(id)) && probeUrlFor(door) !== null);
  // The looks each host has had in the last hour, one per distinct page: doors behind one feed share one request.
  const spent = new Map<string, Set<string>>();
  for (const door of doors) {
    const url = probeUrlFor(door);
    const host = url === null ? null : hostOf(url);
    if (url === null || host === null || nowMs - checkedAtMs(door) >= HOUR_MS || checkedAtMs(door) > nowMs) continue;
    (spent.get(host) ?? spent.set(host, new Set()).get(host)!).add(url);
  }
  const due = hot
    .filter((door) => nowMs - checkedAtMs(door) >= (lookEveryMinutes(door) - PROBE_LEAD_MINUTES) * MINUTE_MS || checkedAtMs(door) > nowMs)
    .sort((a, b) => checkedAtMs(a) - checkedAtMs(b) || a.doorId.localeCompare(b.doorId));
  const chosen: DoorRecord[] = [];
  const planned = new Map<string, Set<string>>();
  for (const door of due) {
    const url = probeUrlFor(door)!;
    const host = hostOf(url);
    if (host === null) continue;
    const used = spent.get(host) ?? new Set<string>();
    const mine = planned.get(host) ?? planned.set(host, new Set()).get(host)!;
    // A page already planned this minute is the same request.
    if (!mine.has(url) && used.size + mine.size >= PROBE_HOST_HOURLY_LIMIT) continue;
    mine.add(url);
    chosen.push(door);
  }
  return { doors: chosen, deferred: hot.length - chosen.length };
}

export interface ProbeRunReport {
  readonly looked: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly deferred: number;
  readonly requests: number;
}

/**
 * Make this minute's first looks and store what each saw on its door. One look per distinct page: the doors behind
 * one feed share it. A look that fails stores nothing and the door is looked at again on a later minute.
 */
export async function runHourlyProbes(
  repo: DoorRepository,
  doors: readonly DoorRecord[],
  hotPartitions: ReadonlySet<string>,
  fetchFn: ProbeFetch,
  now: string,
): Promise<ProbeRunReport> {
  const plan = planProbes(doors, hotPartitions, now);
  const byUrl = new Map<string, Promise<ProbeResult>>();
  const counted = new Set<string>();
  let looked = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let requests = 0;
  for (const door of plan.doors) {
    const url = probeUrlFor(door)!;
    if (!byUrl.has(url)) byUrl.set(url, firstLook(url, door.validators, fetchFn, now));
    const result = await byUrl.get(url)!;
    looked += 1;
    if (!counted.has(url)) {
      counted.add(url);
      requests += result.requests;
      if (result.verdict === "CHANGED") changed += 1;
      else if (result.verdict === "UNCHANGED") unchanged += 1;
      else failed += 1;
    }
    await recordProbe(repo, door.doorId, result, now);
  }
  return { looked, changed, unchanged, failed, deferred: plan.deferred, requests };
}
