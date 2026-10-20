/**
 * When a method succeeds, `planSpread` lists every place, in every state, whose door matches it: a door of the
 * method's kind or platform (Legistar's InSite portal is Legistar), or a door any of whose websites is on it.
 * Plain-code tries go to every matching place within each small publisher's hourly allowance; paid tries go only to
 * places inside a Send where the plain try could not decide, within the budget dial. The order is a fixed shuffle
 * keyed by method and place, never queue position. A place with a result for the method is not tried again here. Pure.
 */

/** A queued place's fix-map row says how far its try got, in its attempt id. */
export const SPREAD_ATTEMPT = {
  /** Queued; the free try has not run yet. */
  QUEUED: "spread:free",
  /** The free try ran and could not decide; a worker there is offered the method. */
  PLAIN_TRIED: "spread:plain",
  /** As PLAIN_TRIED, and a paid try is allowed here. */
  PAID: "spread:paid",
} as const;

import { createHash } from "node:crypto";
import { DiskRows } from "../control-plane/scheduler/disk-rows.ts";
import { plannerMap, plannerSet, type PlannerSpool } from "../control-plane/scheduler/planner-spool.ts";
import { websiteRequestLimit, type WebsiteSize } from "../control-plane/scheduler/host-supervision.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { FixMapRow } from "./fix-map.ts";

export interface SpreadMethod {
  readonly methodId: string;
  /** The door kind the method reads, when it is tied to one. */
  readonly doorKind?: string | null;
  /** Platforms the method is about, lower case (what platform detection on a held page names). */
  readonly platforms?: readonly string[];
}

export interface SpreadPlace {
  /** The place id the fix map keys on (a division id). */
  readonly placeId: string;
  readonly doorId: string;
  readonly host: string | null;
  readonly why: "door kind" | "platform detected";
}

export interface SpreadPlan {
  /** Plain-code tries to run now. */
  readonly plain: readonly SpreadPlace[];
  /** Plain-code tries held for the next round by a small publisher's hourly allowance. */
  readonly plainWaiting: readonly SpreadPlace[];
  /** Paid tries allowed now: where the plain try could not decide, inside a Send and inside the budget dial. */
  readonly paid: readonly SpreadPlace[];
  /** Paid tries not made, each with the plain reason. */
  readonly paidSkipped: readonly { readonly place: SpreadPlace; readonly reason: string }[];
  /** Matching places that already have a result for this method. */
  readonly alreadyTried: number;
  /** Matching places: one try each, however many of its doors match. */
  readonly matching: number;
  /** Matching doors, in every state. */
  readonly matchingDoors: number;
}

/** The platform a door kind is a route of: Legistar's InSite portal is Legistar. */
export function doorKindPlatform(kind: string): string {
  const k = kind.toLowerCase();
  return k === "legistar-insite" ? "legistar" : k;
}

export interface SpreadInput {
  readonly method: SpreadMethod;
  readonly doors: Iterable<DoorRecord>;
  readonly planner?: PlannerSpool;
  readonly detectedPlatformsFor?: (door: DoorRecord) => readonly string[];
  /** Platforms detected on the door's websites, by door id, lower case. */
  readonly detectedPlatforms?: (doorId: string) => readonly string[];
  /** The fix map's rows for this method. */
  readonly fixMapRows: Iterable<FixMapRow>;
  /** What is known of a place's publisher; unknown means full speed. */
  readonly sizeFor?: (host: string) => WebsiteSize | null | undefined;
  /** Places inside a Send; null means none is sent. */
  readonly sendPlaceIds: ReadonlySet<string> | null;
  /** How many paid tries the budget dial leaves for this round. */
  readonly paidTriesLeft: number;
}

const shuffleKey = (methodId: string, placeId: string): string => createHash("sha256").update(`${methodId}\u0000${placeId}`).digest("hex");

type SpooledSpreadPlan = Omit<SpreadPlan, "plain" | "plainWaiting" | "paid" | "paidSkipped"> & {
  readonly plain: DiskRows<SpreadPlace>;
  readonly plainWaiting: DiskRows<SpreadPlace>;
  readonly paid: DiskRows<SpreadPlace>;
  readonly paidSkipped: DiskRows<{ readonly place: SpreadPlace; readonly reason: string }>;
};
let nextSpread = 0;
export function planSpread(input: SpreadInput & { readonly planner: PlannerSpool }): SpooledSpreadPlan;
export function planSpread(input: SpreadInput): SpreadPlan;
export function planSpread(input: SpreadInput): SpreadPlan | SpooledSpreadPlan {
  const method = input.method, planner = input.planner, prefix = `spread-${nextSpread++}`;
  const rows = planner ? plannerMap<FixMapRow>(planner, `${prefix}-fixes`) : new Map<string, FixMapRow>();
  for (const row of input.fixMapRows) if (row.methodId === method.methodId) rows.set(row.placeId, row);
  const platforms = new Set((method.platforms ?? []).map(p => p.toLowerCase()));
  const matching = planner ? planner.table<{ place: SpreadPlace; sort: string }>(`${prefix}-matching`, row => row.place.placeId) : null;
  const native: { place: SpreadPlace; sort: string }[] = [];
  const seenPlaces = planner ? plannerSet(planner, `${prefix}-seen`) : new Set<string>();
  let matchingDoors = 0, alreadyTried = 0;
  for (const door of input.doors) {
    if (door.status !== "OPEN" || door.ocdId === null) continue;
    const byKind = (method.doorKind != null && door.kind === method.doorKind) || platforms.has(doorKindPlatform(door.kind));
    const byPlatform = (input.detectedPlatformsFor?.(door) ?? input.detectedPlatforms?.(door.doorId) ?? []).some(p => platforms.has(p.toLowerCase()));
    if (!byKind && !byPlatform) continue;
    matchingDoors += 1;
    if (seenPlaces.has(door.ocdId)) continue;
    seenPlaces.add(door.ocdId);
    if (rows.get(door.ocdId)?.state !== undefined && rows.get(door.ocdId)?.state !== "UNTRIED") { alreadyTried += 1; continue; }
    const row = { place: { placeId: door.ocdId, doorId: door.doorId, host: door.hosts[0] ?? null, why: byKind ? "door kind" as const : "platform detected" as const }, sort: shuffleKey(method.methodId, door.ocdId) };
    if (matching) matching.add(row); else native.push(row);
  }
  const fresh: Iterable<SpreadPlace> = matching ? matching.rowsBy([["sort"], ["place", "placeId"]]).map(row => row.place) : native.sort((a, b) => a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0).map(row => row.place);
  const collect = <T>(name: string) => {
    if (!planner) { const values: T[] = []; return { values, add: (value: T) => { values.push(value); } }; }
    let at = 0; const table = planner.table<T>(`${prefix}-${name}`, () => String(at++));
    return { values: table.rows, add: (value: T) => table.add(value) };
  };
  const plain = collect<SpreadPlace>("plain"), plainWaiting = collect<SpreadPlace>("plain-waiting"), paid = collect<SpreadPlace>("paid"), paidSkipped = collect<{ place: SpreadPlace; reason: string }>("paid-skipped");
  const allowance = planner ? plannerMap<number>(planner, `${prefix}-allowance`) : new Map<string, number>();
  let left = Math.max(0, Math.floor(input.paidTriesLeft));
  for (const place of fresh) {
    const attempt = rows.get(place.placeId)?.attemptId;
    const plainTried = attempt === SPREAD_ATTEMPT.PLAIN_TRIED || attempt === SPREAD_ATTEMPT.PAID;
    if (!plainTried) {
      const cap = place.host === null ? null : websiteRequestLimit(input.sizeFor?.(place.host));
      const used = place.host === null ? 0 : allowance.get(place.host) ?? 0;
      if (cap === null || place.host === null || used < cap) { plain.add(place); if (place.host !== null && cap !== null) allowance.set(place.host, used + 1); }
      else plainWaiting.add(place);
    } else if (attempt !== SPREAD_ATTEMPT.PAID) {
      if (!input.sendPlaceIds?.has(place.placeId)) paidSkipped.add({ place, reason: "the owner has sent no money to this place (it is in no Send and no budgeted area)" });
      else if (left <= 0) paidSkipped.add({ place, reason: "the budget dial leaves no paid tries this round" });
      else { paid.add(place); left -= 1; }
    }
  }
  return { plain: plain.values, plainWaiting: plainWaiting.values, paid: paid.values, paidSkipped: paidSkipped.values,
    alreadyTried, matching: seenPlaces.size, matchingDoors } as SpreadPlan | SpooledSpreadPlan;
}
