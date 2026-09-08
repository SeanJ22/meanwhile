"use client";

import { FREE_TEXT_CLOSED_HEADER } from "@/lib/signal/reactions";
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

interface StoredReactionSelection {
  value: ReactionValue;
  /** Device-local write order. Used only to resolve "newest Yes wins". */
  order: number;
}

const memorySelections = new Map<string, StoredReactionSelection>();


/** Minted on first use — call only from a reaction tap, never on load. */
export function getOrCreateReactionKey(): string {
  // NH79: one audited implementation. The STORAGE KEY is what keeps this
  // store apart from the other one — see lib/state/browser-key.ts, which
  // carries why the in-memory fallback must not be shared.
  return getOrCreateBrowserKey(KEY_STORAGE);
}

function selectionKey(targetType: ReactionTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

function readSelections(): Record<string, StoredReactionSelection> {
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      ReactionValue | StoredReactionSelection
    >;
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, selection]) => {
        // v1 stored the reaction string directly. It remains valid, with an
        // unknown order that loses to the next answer this device records.
        if (typeof selection === "string") {
          return [[key, { value: selection as ReactionValue, order: 0 }]];
        }
        if (
          typeof selection?.value === "string" &&
          typeof selection.order === "number" &&
          Number.isFinite(selection.order)
        ) {
          return [[key, selection]];
        }
        return [];
      }),
    );
  } catch {
    return Object.fromEntries(memorySelections);
  }
}

export function getStoredReaction(
  targetType: ReactionTargetType,
  targetId: string,
): ReactionValue | null {
  return readSelections()[selectionKey(targetType, targetId)]?.value ?? null;
}

/**
 * Device-local answer order, never sent to the server. Zero identifies a
 * pre-ordering v1 entry; the first new tap deterministically outranks it.
 */
export function getStoredReactionOrder(
  targetType: ReactionTargetType,
  targetId: string,
): number {
  return readSelections()[selectionKey(targetType, targetId)]?.order ?? 0;
}

/**
 * Clear earlier device-local Yes states in one single-winner contest.
 *
 * This changes only the browser's display record. The shared reaction totals
 * are a separate, write-only product and cannot truthfully be described as
 * deleted here; server-side pick persistence needs its own approved contract.
 */
export function clearStoredYesReactions(
  targetType: ReactionTargetType,
  targetIds: readonly string[],
  keepTargetId: string,
): void {
  const clearedKeys = targetIds
    .filter((targetId) => targetId !== keepTargetId)
    .map((targetId) => selectionKey(targetType, targetId));
  if (clearedKeys.length === 0) return;
  commitStorageWrite(
    () => {
      const all = readSelections();
      for (const key of clearedKeys) {
        if (all[key]?.value === "YES") delete all[key];
      }
      window.localStorage.setItem(SELECTION_STORAGE, JSON.stringify(all));
    },
    () => publishStorageEvent(REACTIONS_EVENT),
    () => {
      for (const key of clearedKeys) {
        if (memorySelections.get(key)?.value === "YES") {
          memorySelections.delete(key);
        }
      }
    },
  );
}

/**
 * M134: a cross-component change signal within this tab, the sibling of the
 * picks file's own. A Yes has to become a pick the moment it is tapped, and
 * the pick control is a different component in a different part of the tree —
 * `storage` fires only for OTHER tabs, so without this the two would agree
 * only after a reload.
 */
export const REACTIONS_EVENT = "wtp:reactions-changed";

function rememberReaction(
  targetType: ReactionTargetType,
  targetId: string,
  reaction: ReactionValue,
): void {
  const key = selectionKey(targetType, targetId);
  // The dispatch is guarded on `window` inside `publishStorageEvent`: the suite
  // calls `submitReaction` in Node, where the write falls to the memory map and
  // there is nothing to signal on. An unguarded dispatch turned three passing
  // reaction tests red — the signal is a browser convenience, and in Node there
  // is no subscriber to miss it.
  commitStorageWrite(
    () => {
      const all = readSelections();
      const newest = Object.values(all).reduce(
        (highest, selection) => Math.max(highest, selection.order),
        0,
      );
      // Milliseconds alone can tie during quick taps. Scaling leaves room for
      // a monotonic increment while staying below Number.MAX_SAFE_INTEGER.
      const order = Math.max(Date.now() * 1_000, newest + 1);
      all[key] = { value: reaction, order };
      window.localStorage.setItem(SELECTION_STORAGE, JSON.stringify(all));
    },
    () => publishStorageEvent(REACTIONS_EVENT),
    () => {
      const newest = [...memorySelections.values()].reduce(
        (highest, selection) => Math.max(highest, selection.order),
        0,
      );
      memorySelections.set(key, {
        value: reaction,
        order: Math.max(Date.now() * 1_000, newest + 1),
      });
    },
  );
}

/**
 * Subscribe to this device's own answer record. Read-only, device-local, and
 * joined to nothing — the same store `getStoredReaction` already reads, with a
 * way to be told when it changes.
 */
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
 * What actually happened to the reader's answer server-side. COUNTED is
 * earned by exactly one thing: the 204 that means a row landed in the
 * store. Everything else — a 500, a network failure, and the 202
 * accepted-not-stored state (a never-happens state now that DATABASE_URL
 * is live in production; if it ever reappears it renders as failure, not
 * success) — is NOT_COUNTED, and the control says so.
 */
/**
 * TEXT_DROPPED (P03, 2026-08-18) is the third outcome and it is a SUCCESS
 * with a caveat: the binary landed, and the verbatim did not, because
 * `ripcord.reactionFreeText` is out. It exists so a pulled ripcord cannot
 * render as "saved" over words that went nowhere.
 */
export type ReactionSubmitOutcome = "COUNTED" | "NOT_COUNTED" | "TEXT_DROPPED";

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
  /**
   * The optional verbatim (P03). Never required, and a reader who never
   * opens the box submits exactly the payload they always did.
   *
   * NOT remembered device-locally, unlike the binary. The binary is
   * remembered so the control can render what this browser answered
   * without asking the server; a verbatim has nothing to render back —
   * reactions are write-only from the reader's side, text included — and
   * keeping a person's typed words in their browser after they submitted
   * them buys nothing and leaves them lying around.
   */
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
    if (response.status !== 204) return "NOT_COUNTED";
    // The route sets this only when it actually dropped a verbatim, so a
    // reader who typed nothing never sees the comments-are-off line.
    return response.headers.get(FREE_TEXT_CLOSED_HEADER) === "closed"
      ? "TEXT_DROPPED"
      : "COUNTED";
  } catch {
    return "NOT_COUNTED";
  }
}
