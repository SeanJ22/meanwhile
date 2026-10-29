/**
 * The hourly check's first look. Each hot door's start page or feed is looked
 * at once an hour; a change is stored on the door (`validators.changedAt`) for
 * the publish-now lane to read at once. Every look asks the one per-website
 * count all readers share (`pacedProbeFetch`): a small publisher gets at most
 * ten requests an hour across every reader, and a look that cannot be made
 * now waits, oldest first. Several publishers are looked at side by side, never
 * more than one request at a time on one publisher's request clock. Plain code, no AI.
 */

import { websiteOf } from "../control-plane/website-pacing.ts";
import { sourceHost } from "../sources/http.ts";
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

/** A failed page, or a look whose result could not be stored, is looked at again no sooner than this. */
export const PROBE_RETRY_MS = 10 * 60_000;

/**
 * What a turn learned it must wait for, kept for the whole turn: failed pages and pages whose small publisher's hour is
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
  /** Request clocks looked at side by side. Each has at most one request in flight, whatever this is. */
  readonly websites?: number;
  /** Asked before every look: false (a breaker pause, a release drain) starts no more looks. */
  readonly admitted?: () => boolean;
  /** Failed pages and waiting websites from earlier looks of the same turn; these looks add their own. */
  readonly holds?: ProbeHolds;
  /** Each door a look was stored on, with what was stored. */
  readonly onRecorded?: (doorId: string, validators: DoorValidators) => void;
  readonly clock?: () => number;
}

/**
 * The request clock a page waits on: every reader's requests to one publisher's servers go one at a time through the
 * shared host clock (`sourceHost`, lib/sources/http.ts), so InSite calendars on their many `*.legistar.com` names and
 * Legistar's web API are one clock. A turn keeps one look in flight per clock: a second would only wait in that line
 * while holding a place another publisher's page could use.
 */
function probeClockOf(url: string): string {
  try { return sourceHost(url); } catch { return url; }
}

/** A page, and the due doors read through it. */
export interface ProbePage {
  readonly url: string;
  readonly doors: readonly DoorRecord[];
}

/** Due doors by page, oldest look first: the doors behind one feed share its look. */
export function probePages(due: readonly DoorRecord[]): readonly ProbePage[] {
  const pages = new Map<string, DoorRecord[]>();
  for (const door of due) {
    const url = probeUrlFor(door)!;
    const sharing = pages.get(url);
    if (sharing) sharing.push(door);
    else pages.set(url, [door]);
  }
  return [...pages].map(([url, doors]) => ({ url, doors }));
}

/** OPEN: a look may start. WAITING: its website or its small publisher's hour holds it. RETRY: it failed a moment ago. */
export function probeHoldOf(url: string, holds: ProbeHolds, nowMs: number): "OPEN" | "WAITING" | "RETRY" {
  if (heldUntil(holds.websites, siteOf(url)) > nowMs || heldUntil(holds.allowance, url) > nowMs) return "WAITING";
  return heldUntil(holds.failed, url) > nowMs ? "RETRY" : "OPEN";
}

/** Where the looks come from. */
export interface ProbeSource {
  /** The next page to look at now, among those `free` allows (its clock idle, no look of it running); null when none can start. */
  next(free: (url: string) => boolean): Promise<ProbePage | null>;
  /** No look is running and none can start: wait for the next, and say whether to go on. */
  idle(): Promise<boolean>;
}

export interface ProbeTally {
  looked: number;
  changed: number;
  unchanged: number;
  failed: number;
  waiting: number;
  requests: number;
}

/**
 * Look at pages as `source` names them, up to `websites` request clocks side by side and never two looks at once on one
 * clock. A look starts the moment a place is free, so a long line on one publisher's clock never holds back another
 * publisher's due page. A look that fails, or whose result cannot be stored, holds its page for `PROBE_RETRY_MS`; a
 * website that waits is asked again when its wait ends. Looks that throw are returned, never lost.
 */
export async function runProbeLooks(repo: DoorRepository, fetchFn: ProbeFetch, source: ProbeSource, tally: ProbeTally,
  options: ProbeRunOptions & { readonly stamp?: string } = {}): Promise<readonly unknown[]> {
  const clock = options.clock ?? Date.now;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const parallel = Math.max(1, Math.floor(options.websites ?? 1));
  const holds = options.holds ?? probeHolds();
  const busy = new Set<string>();
  const looking = new Set<string>();
  const running = new Set<Promise<void>>();
  const errors: unknown[] = [];

  const look = async (page: ProbePage): Promise<void> => {
    const { url } = page;
    // Stamped when this look starts, so a look late in a long line falls due an hour after it was made.
    const at = options.stamp ?? new Date(clock()).toISOString();
    let recorded = false;
    try {
      const result = await firstLook(url, page.doors[0]!.validators, fetchFn, at);
      tally.requests += result.requests;
      if (result.verdict === "WAITING") {
        tally.waiting += 1;
        const site = siteOf(url);
        const until = result.wait?.until ?? clock() + PROBE_RETRY_MS;
        if (result.wait?.why === "HOURLY_ALLOWANCE") holds.allowance.set(url, until);
        else holds.websites.set(site, Math.max(heldUntil(holds.websites, site), until));
        recorded = true;
        return;
      }
      if (result.verdict === "CHANGED") tally.changed += 1;
      else if (result.verdict === "UNCHANGED") tally.unchanged += 1;
      else tally.failed += 1;
      holds.allowance.delete(url);
      for (const door of page.doors) {
        tally.looked += 1;
        if (await recordProbe(repo, door.doorId, result, at) && result.validators) {
          recorded = true;
          options.onRecorded?.(door.doorId, result.validators);
        }
      }
    } finally {
      if (recorded) holds.failed.delete(url);
      else holds.failed.set(url, clock() + PROBE_RETRY_MS);
    }
  };

  const free = (url: string): boolean => !busy.has(probeClockOf(url)) && !looking.has(url);
  for (;;) {
    const open = clock() < deadlineMs && (options.admitted?.() ?? true);
    if (open && running.size < parallel) {
      let page: ProbePage | null;
      try { page = await source.next(free); }
      catch (error) { await Promise.allSettled(running); throw error; }
      if (page) {
        const lane = probeClockOf(page.url);
        busy.add(lane);
        looking.add(page.url);
        const task: Promise<void> = look(page).catch((error: unknown) => { errors.push(error); })
          .finally(() => { busy.delete(lane); looking.delete(page.url); running.delete(task); });
        running.add(task);
        continue;
      }
    }
    if (running.size > 0) { await Promise.race(running); continue; }
    if (!open || !(await source.idle())) break;
  }
  return errors;
}

/**
 * Make this minute's first looks and store what each saw on its door: the pages due now, oldest look first, each looked
 * at once (the doors behind one feed share it). The doors not looked at by the deadline stay owed.
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
  const holds = options.holds ?? probeHolds();
  const plan = planProbes(doors, hotPartitions, now);
  const queue = [...probePages(plan.doors)];
  const tally: ProbeTally = { looked: 0, changed: 0, unchanged: 0, failed: 0, waiting: 0, requests: 0 };
  let deferred = plan.deferred;
  const source: ProbeSource = {
    next: async (free) => {
      for (let index = 0; index < queue.length; index += 1) {
        const page = queue[index]!;
        if (!free(page.url)) continue;
        queue.splice(index, 1);
        index -= 1;
        const hold = probeHoldOf(page.url, holds, clock());
        if (hold === "WAITING") tally.waiting += 1;
        else if (hold === "RETRY") deferred += page.doors.length;
        else return page;
      }
      return null;
    },
    idle: async () => false,
  };
  const errors = await runProbeLooks(repo, fetchFn, source, tally, { ...options, holds, ...(options.clock ? {} : { stamp: now }) });
  for (const page of queue) deferred += page.doors.length;
  if (errors.length > 0) throw errors[0];
  return { ...tally, deferred };
}
