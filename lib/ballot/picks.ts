"use client";

/**
 * Save-my-picks (4a, 2026-08-17) — DEVICE-LOCAL ONLY.
 *
 * A pick is the reader's private election-day note to themselves. It is
 * saved under `wtp.ballot_picks` in localStorage and NOWHERE else: never
 * transmitted, never logged, never aggregated, no server column could hold
 * it (`tests/db-schema.test.ts` bans pick-shaped column names schema-wide).
 * This is a DIFFERENT thing from the reaction buttons — reactions join
 * anonymous local totals (disclosed at the capture point); picks never
 * leave the device — and every pick surface says so in words.
 *
 * The stored shape carries display labels so the "My picks" view can render
 * without re-deriving contest data. Clearing browser storage clears picks;
 * that is the correct lifetime for a private note.
 */

export const PICKS_STORAGE_KEY = "wtp.ballot_picks";

export interface StoredPick {
  contestId: string;
  contestTitle: string;
  /** Selected choice ids, in tap order. Length ≤ voteFor. */
  choiceIds: string[];
  /** id → display label, for the My-picks view. */
  labels: Record<string, string>;
}

interface PicksFile {
  version: 1;
  picks: Record<string, StoredPick>;
}

const EMPTY: PicksFile = { version: 1, picks: {} };

/** Cross-component change signal within this tab. */
const PICKS_EVENT = "wtp:ballot-picks-changed";

function read(): PicksFile {
  try {
    const raw = window.localStorage.getItem(PICKS_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as PicksFile;
    if (parsed?.version !== 1 || typeof parsed.picks !== "object") return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

function write(file: PicksFile) {
  try {
    window.localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(file));
    window.dispatchEvent(new Event(PICKS_EVENT));
  } catch {
    // No storage — picks silently unavailable; the control renders but
    // cannot persist, and the reader sees their tap not stick. Survivable.
  }
}

export function getPick(contestId: string): StoredPick | null {
  if (typeof window === "undefined") return null;
  return read().picks[contestId] ?? null;
}

export function getAllPicks(): StoredPick[] {
  if (typeof window === "undefined") return [];
  return Object.values(read().picks);
}

/** Toggle a choice within a contest, honouring voteFor as the cap. */
export function togglePick(
  contestId: string,
  contestTitle: string,
  choiceId: string,
  choiceLabel: string,
  voteFor: number,
) {
  const file = read();
  const existing = file.picks[contestId] ?? {
    contestId,
    contestTitle,
    choiceIds: [],
    labels: {},
  };
  const has = existing.choiceIds.includes(choiceId);
  let next: string[];
  if (has) {
    next = existing.choiceIds.filter((id) => id !== choiceId);
  } else if (voteFor <= 1) {
    next = [choiceId];
  } else if (existing.choiceIds.length < voteFor) {
    next = [...existing.choiceIds, choiceId];
  } else {
    // At the cap: drop the oldest so the newest tap always registers.
    next = [...existing.choiceIds.slice(1), choiceId];
  }
  const labels = { ...existing.labels, [choiceId]: choiceLabel };
  if (next.length === 0) {
    delete file.picks[contestId];
  } else {
    file.picks[contestId] = { contestId, contestTitle, choiceIds: next, labels };
  }
  write(file);
}

export function clearPick(contestId: string) {
  const file = read();
  delete file.picks[contestId];
  write(file);
}

/** Subscribe helper for useSyncExternalStore. */
export function subscribePicks(callback: () => void): () => void {
  window.addEventListener(PICKS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PICKS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
