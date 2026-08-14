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
 * Record the reader's answer: locally (so the control stays honest about
 * what this browser said) and to the server (where it joins the anonymous
 * store). The network half is fire-and-forget — a failed write must never
 * cost the reader their tap, and the local record is the device's truth
 * either way.
 */
export function submitReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
  context: ReactionViewContext | null,
): void {
  rememberReaction(targetType, targetId, reaction);
  try {
    void fetch("/api/reactions", {
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
    }).catch(() => {});
  } catch {
    /* never the reader's problem */
  }
}
