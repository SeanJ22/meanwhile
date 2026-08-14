"use client";

import type {
  ReactionTargetType,
  ReactionValue,
} from "@/lib/signal/reactions";

/**
 * The browser half of reaction capture.
 *
 * Two localStorage keys, both device-local and disclosed on /transparency:
 *
 * - `wtp.reaction_key` — a random key minted on the browser's FIRST
 *   reaction (never at page load: a reader who never reacts never gets
 *   one). Sent with each reaction and stored hashed server-side, it lets
 *   this browser change its own answers and nothing else. Clearing it
 *   orphans prior reactions as plain anonymous rows.
 * - `wtp.reactions` — this browser's own answers, kept locally so the
 *   control can show "you said Yes" across popups and visits. Display
 *   state only; never transmitted anywhere.
 *
 * When storage is unavailable (private mode, blocked), both fall back to
 * in-memory: reactions still work for the session, continuity just doesn't
 * survive the tab.
 */

const KEY_STORAGE = "wtp.reaction_key";
const SELECTION_STORAGE = "wtp.reactions";

let memoryKey: string | null = null;
const memorySelections = new Map<string, ReactionValue>();

function mintKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Minted on first use — call only from a reaction tap, never on load. */
export function getOrCreateReactionKey(): string {
  try {
    const existing = window.localStorage.getItem(KEY_STORAGE);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const minted = mintKey();
    window.localStorage.setItem(KEY_STORAGE, minted);
    return minted;
  } catch {
    memoryKey ??= mintKey();
    return memoryKey;
  }
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

function rememberReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
): void {
  const key = selectionKey(targetType, targetId);
  try {
    const all = readSelections();
    all[key] = reaction;
    window.localStorage.setItem(SELECTION_STORAGE, JSON.stringify(all));
  } catch {
    memorySelections.set(key, reaction);
  }
}

export interface ReactionViewContext {
  /** Five-digit zip when the view has one; orientation only. */
  zip: string | null;
  lat: number;
  lng: number;
}

/**
 * What actually happened to the reader's answer server-side. COUNTED is
 * earned by exactly one thing: the 204 that means a row landed in the
 * store. Everything else — a 500, a network failure, and the 202
 * accepted-not-stored state (a never-happens state now that DATABASE_URL
 * is live in production; if it ever reappears it renders as failure, not
 * success) — is NOT_COUNTED, and the control says so.
 */
export type ReactionSubmitOutcome = "COUNTED" | "NOT_COUNTED";

/**
 * The honest line for anything short of a 204. The device-local half of
 * the record still writes — the device's own memory is the reader's,
 * always — but "counted" is a claim about the shared totals and only the
 * store's own confirmation can make it.
 */
export const NOT_COUNTED_LINE =
  "Couldn't reach the totals — your answer is saved on this device and wasn't counted.";

/**
 * Record the reader's answer: locally (so the control stays honest about
 * what this browser said) and to the server (where it joins the anonymous
 * store). The local record writes unconditionally; the returned outcome
 * reports the server half truthfully so the control can render success
 * only when a row actually landed.
 *
 * This is deliberately NOT fire-and-forget, unlike the search log
 * (`lib/log/client.ts`): a reaction is a promise made to the reader at the
 * capture point — "your answer joins anonymous local totals" — and a
 * promise needs its outcome. A log row is our bookkeeping; losing one
 * costs the reader nothing and is silently dropped by design.
 */
export async function submitReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
  context: ReactionViewContext | null,
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
