/**
 * When a method succeeds, `planSpread` lists every place, in every state, whose door matches it: a door of the
 * method's kind or platform (Legistar's InSite portal is Legistar), or a door any of whose websites is on it.
 * Plain-code tries go to every matching place within each small publisher's hourly allowance; paid tries go only to places inside a Send where the plain try could not decide, within the budget dial. The order is
 * a fixed shuffle keyed by method and place, never queue position. A place with a result for the method is not tried
 * again here. Pure.
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
  readonly doors: readonly DoorRecord[];
  /** Platforms detected on the door's websites, by door id, lower case. */
  readonly detectedPlatforms?: (doorId: string) => readonly string[];
  /** The fix map's rows for this method. */
  readonly fixMapRows: readonly FixMapRow[];
  /** What is known of a place's publisher; unknown means full speed. */
  readonly sizeFor?: (host: string) => WebsiteSize | null | undefined;
  /** Places inside a Send; null means none is sent. */
  readonly sendPlaceIds: ReadonlySet<string> | null;
  /** How many paid tries the budget dial leaves for this round. */
  readonly paidTriesLeft: number;
}

const shuffleKey = (methodId: string, placeId: string): string => createHash("sha256").update(`${methodId}\u0000${placeId}`).digest("hex");

export function planSpread(input: SpreadInput): SpreadPlan {
  const method = input.method;
  const platforms = new Set((method.platforms ?? []).map((p) => p.toLowerCase()));
  const rows = input.fixMapRows.filter((r) => r.methodId === method.methodId);
  const tried = new Set(rows.filter((r) => r.state !== "UNTRIED").map((r) => r.placeId));
  const marked = (...ids: string[]) => new Set(rows.filter((r) => r.state === "UNTRIED" && ids.includes(r.attemptId ?? "")).map((r) => r.placeId));
  const plainTried = marked(SPREAD_ATTEMPT.PLAIN_TRIED, SPREAD_ATTEMPT.PAID);
  const paidQueued = marked(SPREAD_ATTEMPT.PAID);
  const matching: SpreadPlace[] = [];
  const seenPlaces = new Set<string>();
  let matchingDoors = 0;
  for (const door of input.doors) {
    if (door.status !== "OPEN" || door.ocdId === null) continue;
    const byKind = (method.doorKind != null && door.kind === method.doorKind) || platforms.has(doorKindPlatform(door.kind));
    const byPlatform = (input.detectedPlatforms?.(door.doorId) ?? []).some((p) => platforms.has(p.toLowerCase()));
    if (!byKind && !byPlatform) continue;
    matchingDoors += 1;
    if (seenPlaces.has(door.ocdId)) continue;
    seenPlaces.add(door.ocdId);
    matching.push({ placeId: door.ocdId, doorId: door.doorId, host: door.hosts[0] ?? null, why: byKind ? "door kind" : "platform detected" });
  }
  const fresh = matching.filter((p) => !tried.has(p.placeId)).sort((a, b) => {
    const ka = shuffleKey(method.methodId, a.placeId);
    const kb = shuffleKey(method.methodId, b.placeId);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Plain code goes everywhere, within pacing: a small publisher's host takes its hourly allowance per round.
  const allowance = new Map<string, number>();
  const plain: SpreadPlace[] = [];
  const plainWaiting: SpreadPlace[] = [];
  for (const place of fresh.filter((p) => !plainTried.has(p.placeId))) {
    const cap = place.host === null ? null : websiteRequestLimit(input.sizeFor?.(place.host));
    if (cap === null || place.host === null) {
      plain.push(place);
      continue;
    }
    const used = allowance.get(place.host) ?? 0;
    if (used < cap) {
      allowance.set(place.host, used + 1);
      plain.push(place);
    } else plainWaiting.push(place);
  }

  // Paid tries only where the plain try could not decide, inside a Send, and only as many as the dial leaves.
  const paid: SpreadPlace[] = [];
  const paidSkipped: { place: SpreadPlace; reason: string }[] = [];
  let left = Math.max(0, Math.floor(input.paidTriesLeft));
  for (const place of fresh.filter((p) => plainTried.has(p.placeId) && !paidQueued.has(p.placeId))) {
    if (input.sendPlaceIds === null || !input.sendPlaceIds.has(place.placeId)) {
      paidSkipped.push({ place, reason: "this place is not inside a Send" });
    } else if (left <= 0) {
      paidSkipped.push({ place, reason: "the budget dial leaves no paid tries this round" });
    } else {
      paid.push(place);
      left -= 1;
    }
  }
  return { plain, plainWaiting, paid, paidSkipped, alreadyTried: matching.length - fresh.length, matching: matching.length, matchingDoors };
}
