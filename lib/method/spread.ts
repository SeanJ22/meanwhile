/**
 * When a method first succeeds, `planSpread` lists every place whose door matches it (by door kind, or by the platform
 * detected on a held page). Plain-code tries go to every matching place within each small publisher's hourly allowance;
 * paid tries go only to places inside a Send, within the budget dial. The order is a fixed shuffle keyed by method and
 * place, never queue position. A place with a result for the method is not tried again here. Pure.
 */

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
  /** Paid tries to run now: inside a Send and inside the budget dial. */
  readonly paid: readonly SpreadPlace[];
  /** Paid tries not made, each with the plain reason. */
  readonly paidSkipped: readonly { readonly place: SpreadPlace; readonly reason: string }[];
  /** Matching places that already have a result for this method. */
  readonly alreadyTried: number;
  readonly matching: number;
}

export interface SpreadInput {
  readonly method: SpreadMethod;
  readonly doors: readonly DoorRecord[];
  /** Platform detected on a held page, by door id, lower case. */
  readonly detectedPlatform?: (doorId: string) => string | null | undefined;
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
  const tried = new Set(input.fixMapRows.filter((r) => r.methodId === method.methodId && r.state !== "UNTRIED").map((r) => r.placeId));
  const matching: SpreadPlace[] = [];
  const seenPlaces = new Set<string>();
  for (const door of input.doors) {
    if (door.status !== "OPEN" || door.ocdId === null) continue;
    const byKind = method.doorKind != null && door.kind === method.doorKind;
    const detected = input.detectedPlatform?.(door.doorId)?.toLowerCase();
    const byPlatform = detected !== undefined && detected !== "" && platforms.has(detected);
    if (!byKind && !byPlatform) continue;
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
  for (const place of fresh) {
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

  // Paid tries only inside a Send, and only as many as the dial leaves.
  const paid: SpreadPlace[] = [];
  const paidSkipped: { place: SpreadPlace; reason: string }[] = [];
  let left = Math.max(0, Math.floor(input.paidTriesLeft));
  for (const place of fresh) {
    if (input.sendPlaceIds === null || !input.sendPlaceIds.has(place.placeId)) {
      paidSkipped.push({ place, reason: "this place is not inside a Send" });
    } else if (left <= 0) {
      paidSkipped.push({ place, reason: "the budget dial leaves no paid tries this round" });
    } else {
      paid.push(place);
      left -= 1;
    }
  }
  return { plain, plainWaiting, paid, paidSkipped, alreadyTried: matching.length - fresh.length, matching: matching.length };
}
