/**
 * The hourly check's first look. Each hot door's start page or feed is looked
 * at once an hour; a change is stored on the door (`validators.changedAt`) for
 * the publish-now lane to read at once. Every look asks the one per-website
 * count all readers share (`pacedProbeFetch`): a small publisher gets at most
 * ten requests an hour across every reader, and a look that cannot be made
 * now waits, oldest first. Plain code, no AI.
 */

import { doorPartitionIds } from "./mission-refresh.ts";
import { firstLook, probeUrlFor, recordProbe, type ProbeFetch, type ProbeResult } from "./probe.ts";
import { hotCheckMinutes } from "./overdue.ts";
import type { DoorRecord, DoorRepository } from "./registry.ts";

/** A look is made this long before the hour is up, so the check lands on the hour rather than after it. */
export const PROBE_LEAD_MINUTES = 5;

const MINUTE_MS = 60_000;

/** The minutes between looks for a hot door: its own setting where it is faster than the hour, else the hour. */
function lookEveryMinutes(door: DoorRecord): number {
  return door.checkEveryMinutes !== null && door.checkEveryMinutes < hotCheckMinutes() ? door.checkEveryMinutes : hotCheckMinutes();
}

export interface ProbePlan {
  /** The doors to look at now: one list, oldest look first. */
  readonly doors: readonly DoorRecord[];
  /** Hot doors with a page to look at that are not due yet. */
  readonly deferred: number;
}

/**
 * Which hot doors get a first look now. A door is hot when a partition it is read through (`hotPartitions`) has a
 * sitting in the seven-day window either side. Pure: the clock is in the arguments.
 */
export function planProbes(doors: readonly DoorRecord[], hotPartitions: ReadonlySet<string>, now: string): ProbePlan {
  const nowMs = Date.parse(now);
  const checkedAtMs = (door: DoorRecord): number => {
    const at = Date.parse(door.validators?.checkedAt ?? "");
    return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
  };
  const hot = doors.filter((door) => door.status === "OPEN" && doorPartitionIds(door).some((id) => hotPartitions.has(id)) && probeUrlFor(door) !== null);
  const due = hot
    .filter((door) => nowMs - checkedAtMs(door) >= (lookEveryMinutes(door) - PROBE_LEAD_MINUTES) * MINUTE_MS || checkedAtMs(door) > nowMs)
    .sort((a, b) => checkedAtMs(a) - checkedAtMs(b) || a.doorId.localeCompare(b.doorId));
  return { doors: due, deferred: hot.length - due.length };
}

export interface ProbeRunReport {
  readonly looked: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
  /** Pages the shared count said could not be asked now: a small publisher's hour is used, or the website asked to wait. */
  readonly waiting: number;
  readonly deferred: number;
  readonly requests: number;
}

/**
 * Make this minute's first looks and store what each saw on its door. One look per distinct page: the doors behind
 * one feed share it. A look that fails or waits stores nothing and the door is looked at again on a later minute.
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
  let waiting = 0;
  let requests = 0;
  for (const door of plan.doors) {
    const url = probeUrlFor(door)!;
    if (!byUrl.has(url)) byUrl.set(url, firstLook(url, door.validators, fetchFn, now));
    const result = await byUrl.get(url)!;
    if (!counted.has(url)) {
      counted.add(url);
      requests += result.requests;
      if (result.verdict === "CHANGED") changed += 1;
      else if (result.verdict === "UNCHANGED") unchanged += 1;
      else if (result.verdict === "WAITING") waiting += 1;
      else failed += 1;
    }
    if (result.verdict === "WAITING") continue;
    looked += 1;
    await recordProbe(repo, door.doorId, result, now);
  }
  return { looked, changed, unchanged, failed, waiting, deferred: plan.deferred, requests };
}
