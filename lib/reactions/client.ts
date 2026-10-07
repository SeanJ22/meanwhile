"use client";

import { getOrCreateBrowserKey } from "../state/browser-key.ts";
import {
  commitStorageWrite,
  publishStorageEvent,
  subscribeToStorageEvent,
} from "@/lib/state/subscribe-to-storage";
import type {
  ReactionTargetType,
  ReactionValue,
} from "@/lib/signal/reactions";

/**
 * The browser half of reaction capture. Two device-local localStorage keys, both disclosed on
 * /transparency:
 * - `wtp.reaction_key`: a random key minted on the first reaction (never at page load), sent with each
 *   reaction and stored hashed server-side so this browser can change its own answers and nothing else.
 * - `wtp.reactions`: this browser's own answers, display state only; never transmitted.
 * When storage is unavailable both fall back to in-memory for the session.
 */

const KEY_STORAGE = "wtp.reaction_key";
const SELECTION_STORAGE = "wtp.reactions";

const memorySelections = new Map<string, ReactionValue>();

/** Minted on first use — call only from a reaction tap, never on load. */
export function getOrCreateReactionKey(): string {
  // The storage key keeps this store apart from the others; see lib/state/browser-key.ts.
  return getOrCreateBrowserKey(KEY_STORAGE);
}

function selectionKey(targetType: ReactionTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

function readSelections(): Record<string, ReactionValue> {
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReactionValue>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return Object.fromEntries(memorySelections);
  }
}

export function getStoredReaction(
  targetType: ReactionTargetType,
  targetId: string,
): ReactionValue | null {
  return readSelections()[selectionKey(targetType, targetId)] ?? null;
}

/**
 * A same-tab change signal: `storage` fires only for other tabs, and a Yes must become a pick in a
 * different component the moment it is tapped.
 */
export const REACTIONS_EVENT = "wtp:reactions-changed";

function rememberReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
): void {
  const key = selectionKey(targetType, targetId);
  // `publishStorageEvent` guards the dispatch on `window`, so this also runs in Node.
  commitStorageWrite(
    () => {
      const all = readSelections();
      all[key] = reaction;
      window.localStorage.setItem(SELECTION_STORAGE, JSON.stringify(all));
    },
    () => publishStorageEvent(REACTIONS_EVENT),
    () => memorySelections.set(key, reaction),
  );
}

/** Subscribe to this device's own answer record. Read-only, device-local, joined to nothing. */
export function subscribeReactions(callback: () => void): () => void {
  return subscribeToStorageEvent(REACTIONS_EVENT, callback);
}

export interface ReactionViewContext {
  /** Five-digit zip when the view has one; orientation only. */
  zip: string | null;
  lat: number;
  lng: number;
}

/**
 * COUNTED only for the 204 that means a row landed in the store. Anything else, including a 202, is
 * NOT_COUNTED.
 */
export type ReactionSubmitOutcome = "COUNTED" | "NOT_COUNTED";

/**
 * The line for anything short of a 204. The device-local record still writes, but "counted" is a claim
 * about shared totals.
 */
export const NOT_COUNTED_LINE =
  "Couldn't reach the totals — your answer is saved on this device and wasn't counted.";

/**
 * Record the reader's answer locally and to the server. The local record writes unconditionally; the
 * returned outcome reports the server half truthfully. Not fire-and-forget, unlike the search log.
 */
export async function submitReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
  context: ReactionViewContext | null,
  /** The optional verbatim. Never required, and not remembered device-locally. */
  freeText?: string | null,
): Promise<ReactionSubmitOutcome> {
  rememberReaction(targetType, targetId, reaction);
  try {
    const response = await fetch("/api/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetId,
        reaction,
        reactionKey: getOrCreateReactionKey(),
        text: freeText ?? null,
        zip: context?.zip ?? null,
        lat: context?.lat ?? null,
        lng: context?.lng ?? null,
      }),
      keepalive: true,
    });
    return response.status === 204 ? "COUNTED" : "NOT_COUNTED";
  } catch {
    return "NOT_COUNTED";
  }
}
