/**
 * The hourly check's first look. Each hot door's start page or feed is looked
 * at once an hour; a change is stored on the door (`validators.changedAt`) for
 * the publish-now lane to read at once. Every look asks the one per-website
 * count all readers share (`pacedProbeFetch`): a small publisher gets at most
 * ten requests an hour across every reader, and a look that cannot be made
 * now waits, oldest first. Several websites are looked at side by side, never
 * more than one request at a time to any one website. Plain code, no AI.
 */

import { websiteOf } from "../control-plane/website-pacing.ts";
import { doorPartitionIds } from "./mission-refresh.ts";
import { firstLook, probeUrlFor, recordProbe, type ProbeFetch } from "./probe.ts";
import { hotCheckMinutes } from "./overdue.ts";
import type { DoorRecord, DoorRepository, DoorValidators } from "./registry.ts";

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

function checkedAtMs(door: DoorRecord): number {
  const at = Date.parse(door.validators?.checkedAt ?? "");
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** Hot doors with a page to look at. */
function hotDoors(doors: readonly DoorRecord[], hotPartitions: ReadonlySet<string>): DoorRecord[] {
  return doors.filter((door) => door.status === "OPEN" && doorPartitionIds(door).some((id) => hotPartitions.has(id)) && probeUrlFor(door) !== null);
}

/** When a hot door's next look is due: its last look plus its hour, less the lead; at once when never looked at, or looked at in the future. */
function lookDueAtMs(door: DoorRecord, nowMs: number): number {
  const checked = checkedAtMs(door);
  return checked > nowMs ? Number.NEGATIVE_INFINITY : checked + (lookEveryMinutes(door) - PROBE_LEAD_MINUTES) * MINUTE_MS;
}

/**
 * Which hot doors get a first look now. A door is hot when a partition it is read through (`hotPartitions`) has a
 * sitting in the seven-day window either side. Pure: the clock is in the arguments.
 */
export function planProbes(doors: readonly DoorRecord[], hotPartitions: ReadonlySet<string>, now: string): ProbePlan {
  const nowMs = Date.parse(now);
  const hot = hotDoors(doors, hotPartitions);
  const due = hot
    .filter((door) => lookDueAtMs(door, nowMs) <= nowMs)
    .sort((a, b) => checkedAtMs(a) - checkedAtMs(b) || a.doorId.localeCompare(b.doorId));
  return { doors: due, deferred: hot.length - due.length };
}

/** A failed page is looked at again no sooner than this, so a broken page is never asked every round of a turn. */
export const PROBE_RETRY_MS = 10 * 60_000;

/**
 * What a turn learned it must wait for, kept across its rounds: failed pages and pages whose small publisher's hour is
 * used, by URL; websites that asked every reader to wait (or refuse us), by site. A small publisher's hour holds only its
 * own pages, since a vendor host can serve a larger government with no hourly cap beside it.
 */
export interface ProbeHolds {
  readonly failed: Map<string, number>;
  readonly allowance: Map<string, number>;
  readonly websites: Map<string, number>;
}

export function probeHolds(): ProbeHolds {
  return { failed: new Map(), allowance: new Map(), websites: new Map() };
}

const heldUntil = (held: ReadonlyMap<string, number>, key: string): number => held.get(key) ?? Number.NEGATIVE_INFINITY;

function siteOf(url: string): string {
  try { return websiteOf(url); } catch { return url; }
}

/** When the next look can start: the soonest hot door's due time, held back by its page's or website's wait. Infinity when nothing is hot. */
export function nextProbeAtMs(doors: readonly DoorRecord[], hotPartitions: ReadonlySet<string>, nowMs: number, holds: ProbeHolds = probeHolds()): number {
  let next = Number.POSITIVE_INFINITY;
  for (const door of hotDoors(doors, hotPartitions)) {
    const url = probeUrlFor(door)!;
    next = Math.min(next, Math.max(lookDueAtMs(door, nowMs), heldUntil(holds.failed, url), heldUntil(holds.allowance, url),
      heldUntil(holds.websites, siteOf(url))));
  }
  return next;
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

export interface ProbeRunOptions {
  /** No look starts at or after this instant; the doors not looked at stay owed. */
  readonly deadlineMs?: number;
  /** Websites looked at side by side. Each website has at most one request in flight, whatever this is. */
  readonly websites?: number;
  /** Asked before every look: false (a breaker pause, a release drain) starts no more looks. */
  readonly admitted?: () => boolean;
  /** Failed pages and waiting websites from earlier rounds of the same turn; this round adds its own. */
  readonly holds?: ProbeHolds;
  /** Each door a look was stored on, with what was stored. */
  readonly onRecorded?: (doorId: string, validators: DoorValidators) => void;
  readonly clock?: () => number;
}

/**
 * Make this minute's first looks and store what each saw on its door. One look per distinct page: the doors behind
 * one feed share it. Pages go oldest look first, up to `websites` at once and never two at once to one website. A
 * look that fails or waits stores nothing; a failed page is looked at again after `PROBE_RETRY_MS`, and a website
 * that waits is asked again when its wait ends.
 */
export async function runHourlyProbes(
  repo: DoorRepository,
  doors: readonly DoorRecord[],
  hotPartitions: ReadonlySet<string>,
  fetchFn: ProbeFetch,
  now: string,
  options: ProbeRunOptions = {},
): Promise<ProbeRunReport> {
  const clock = options.clock ?? Date.now;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const parallel = Math.max(1, Math.floor(options.websites ?? 1));
  const holds = options.holds ?? probeHolds();
  const plan = planProbes(doors, hotPartitions, now);
  const pages = new Map<string, DoorRecord[]>();
  for (const door of plan.doors) {
    const url = probeUrlFor(door)!;
    const sharing = pages.get(url);
    if (sharing) sharing.push(door);
    else pages.set(url, [door]);
  }
  const queue = [...pages.keys()];
  const sites = new Map(queue.map((url) => [url, siteOf(url)] as const));
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  const errors: unknown[] = [];
  let looked = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let waiting = 0;
  let requests = 0;
  let deferred = plan.deferred;

  const look = async (url: string, site: string): Promise<void> => {
    const sharing = pages.get(url)!;
    // Stamped when this look starts, so a look late in a long round falls due an hour after it was made.
    const at = options.clock ? new Date(clock()).toISOString() : now;
    const result = await firstLook(url, sharing[0]!.validators, fetchFn, at);
    requests += result.requests;
    if (result.verdict === "WAITING") {
      waiting += 1;
      const until = result.wait?.until ?? clock() + PROBE_RETRY_MS;
      if (result.wait?.why === "HOURLY_ALLOWANCE") holds.allowance.set(url, until);
      else holds.websites.set(site, Math.max(heldUntil(holds.websites, site), until));
      return;
    }
    if (result.verdict === "CHANGED") changed += 1;
    else if (result.verdict === "UNCHANGED") unchanged += 1;
    else failed += 1;
    holds.allowance.delete(url);
    if (result.verdict === "FAILED") holds.failed.set(url, clock() + PROBE_RETRY_MS);
    else holds.failed.delete(url);
    for (const door of sharing) {
      looked += 1;
      if (await recordProbe(repo, door.doorId, result, at) && result.validators) options.onRecorded?.(door.doorId, result.validators);
    }
  };

  for (;;) {
    const open = clock() < deadlineMs && (options.admitted?.() ?? true);
    const next = open && running.size < parallel ? queue.findIndex((url) => !busy.has(sites.get(url)!)) : -1;
    if (next >= 0) {
      const [url] = queue.splice(next, 1) as [string];
      const site = sites.get(url)!;
      if (heldUntil(holds.websites, site) > clock() || heldUntil(holds.allowance, url) > clock()) { waiting += 1; continue; }
      if (heldUntil(holds.failed, url) > clock()) { deferred += pages.get(url)!.length; continue; }
      busy.add(site);
      const task: Promise<void> = look(url, site).catch((error: unknown) => { errors.push(error); })
        .finally(() => { busy.delete(site); running.delete(task); });
      running.add(task);
      continue;
    }
    if (running.size === 0) break;
    await Promise.race(running);
  }
  for (const url of queue) deferred += pages.get(url)!.length;
  if (errors.length > 0) throw errors[0];
  return { looked, changed, unchanged, failed, waiting, deferred, requests };
}
