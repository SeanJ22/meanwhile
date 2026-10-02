"use client";

import { captureEvent } from "@/lib/events/client";
import { storeSafeId } from "@/lib/events/wire";
import {
  commitStorageWrite,
  publishStorageEvent,
  subscribeToStorageEvent,
} from "@/lib/state/subscribe-to-storage";

/**
 * Save-my-picks (4a, 2026-08-17). Kept on the device so the reader's ballot
 * card survives a visit, AND (October 1, 2026, Sean) recorded server-side from
 * that day on, anonymously, per contest: who the reader says they are voting
 * for, with "not sure" and "blank" as valid answers. Each change sends one
 * `BALLOT_PICK` event through the batcher (`lib/events/client.ts`) to the
 * event store; picks saved before that stay on their device only. What the site
 * collects is stated once, on /transparency.
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
  version: 2;
  picks: Record<string, StoredPick>;
  /**
   * **What a clear cleared** (F01-continued item 9, 2026-08-19), keyed by
   * contest, holding the DERIVED choice ids the reader asked to be rid of.
   *
   * A derived pick is computed at render from the device's own Yes answers
   * (`lib/ballot/derived-picks.ts`) and is written nowhere, so emptying
   * `picks` could not remove one — "Clear my picks" wiped the card and left
   * every derived pick standing on the page below it. The suppression lives
   * HERE rather than in the reaction record on purpose: `wtp.reactions` is
   * the copy that lets a reader change an answer they have already given,
   * and deleting it would take that away while removing nothing from the
   * anonymous totals it fed. The reader asked for no picks; no pick renders.
   *
   * It records the specific choices, not "derive nothing here ever". Say Yes
   * to somebody else and the sets differ, so the pick comes back — a new
   * answer, not the one that was cleared.
   */
  suppressedDerived: Record<string, string[]>;
  /** Contests the reader marked "not sure". A pick in the same contest replaces it. */
  unsure?: Record<string, true>;
}

const EMPTY: PicksFile = { version: 2, picks: {}, suppressedDerived: {} };

/** Cross-component change signal within this tab. */
const PICKS_EVENT = "wtp:ballot-picks-changed";

function read(): PicksFile {
  try {
    const raw = window.localStorage.getItem(PICKS_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Omit<Partial<PicksFile>, "version"> & {
      version?: number;
    };
    if (typeof parsed?.picks !== "object" || parsed.picks === null) return EMPTY;
    /*
     * v1 → v2 MIGRATION, and it is a READ, never a rewrite. A v1 file is a v2
     * file with nothing suppressed, which is exactly true of a device that
     * never had the clear this field records. Refusing to parse it would
     * silently discard a reader's stored ballot on upgrade — a v1 file is
     * good data, not a corrupt one, and the version says what shape it is
     * rather than whether it is welcome.
     */
    if (parsed.version !== 1 && parsed.version !== 2) return EMPTY;
    return {
      version: 2,
      picks: parsed.picks,
      suppressedDerived:
        typeof parsed.suppressedDerived === "object" && parsed.suppressedDerived !== null
          ? parsed.suppressedDerived
          : {},
      ...(typeof parsed.unsure === "object" && parsed.unsure !== null ? { unsure: parsed.unsure } : {}),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * **THE ANNOUNCEMENT USED TO SIT INSIDE THE `try`.** (`WGH-22` class audit,
 * 2026-08-31.)
 *
 * `dispatchEvent` was the line after `setItem`, in the same `try`, so a store
 * that refused the write skipped the announcement with it. Nothing had changed
 * in that case and no reader was told anything false — but the ordering is the
 * same ordering `WGH-22` was, and this is the file two ballot surfaces read
 * through. `commitStorageWrite` owns the ordering now: the announcement is
 * outside the write, always, and no call site here can put it back inside.
 */
function write(file: PicksFile) {
  commitStorageWrite(
    () => window.localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(file)),
    () => publishStorageEvent(PICKS_EVENT),
  );
}

export function getPick(contestId: string): StoredPick | null {
  if (typeof window === "undefined") return null;
  return read().picks[contestId] ?? null;
}

export function getAllPicks(): StoredPick[] {
  if (typeof window === "undefined") return [];
  return Object.values(read().picks);
}

/** The contests the reader marked "not sure". */
export function getUnsure(): Record<string, true> {
  if (typeof window === "undefined") return {};
  return read().unsure ?? {};
}

/** What a clear cleared, per contest. See `PicksFile.suppressedDerived`. */
export function getSuppressedDerived(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  return read().suppressedDerived;
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
  // A deliberate tap in this contest supersedes whatever a clear suppressed
  // here: the reader is answering the question again, and a stale suppression
  // would sit waiting to silence a derived pick they went on to earn.
  delete file.suppressedDerived[contestId];
  if (file.unsure) delete file.unsure[contestId];
  write(file);
  captureEvent({
    type: "BALLOT_PICK",
    ballotPick: { contestId: storeSafeId(contestId), candidateIds: next.map(storeSafeId), choice: next.length === 0 ? "BLANK" : "PICKED" },
  });
}

export function clearPick(contestId: string) {
  const file = read();
  delete file.picks[contestId];
  write(file);
  captureEvent({ type: "BALLOT_PICK", ballotPick: { contestId: storeSafeId(contestId), candidateIds: [], choice: "BLANK" } });
}

/** "Not sure yet" is an answer too: it replaces any pick here and is recorded as one. */
export function markUnsure(contestId: string) {
  const file = read();
  delete file.picks[contestId];
  file.unsure = { ...(file.unsure ?? {}), [contestId]: true };
  write(file);
  captureEvent({ type: "BALLOT_PICK", ballotPick: { contestId: storeSafeId(contestId), candidateIds: [], choice: "UNSURE" } });
}

/**
 * Clear every pick on this device (item 5, 2026-08-14 second session —
 * the tester's ask: most people can't reset browser storage). Callers
 * confirm first; this just clears. Device-local only, like everything
 * in this module.
 *
 * **F01-continued item 9: it used to clear only half of them.** The explicit
 * file was emptied and every DERIVED pick — one computed from a Yes the
 * reader gave on the reaction control — went on rendering, so the card
 * disappeared while the picks stayed on the page underneath it. A control
 * that reads as a delete has to be one.
 *
 * `derivedNow` is what the caller can see resolved on screen at the moment
 * the reader confirms, from `derivedToSuppress` in `./pick-tally.ts`. It is
 * recorded rather than acted on, because there is nothing to delete: a
 * derived pick is a rendering decision, and the honest way to stop rendering
 * it is to record that the reader said so.
 */
export function clearAllPicks(derivedNow: Record<string, string[]> = {}) {
  const before = read();
  write({ version: 2, picks: {}, suppressedDerived: derivedNow });
  for (const contestId of Object.keys(before.picks)) {
    captureEvent({ type: "BALLOT_PICK", ballotPick: { contestId: storeSafeId(contestId), candidateIds: [], choice: "BLANK" } });
  }
}

/**
 * Subscribe helper for `useSyncExternalStore`.
 *
 * Both halves are load-bearing: `PICKS_EVENT` carries same-tab writes and
 * `storage` carries the other tabs, which is exactly what
 * `subscribeToStorageEvent` wires — the shared half of the pair `write` calls.
 */
export function subscribePicks(callback: () => void): () => void {
  return subscribeToStorageEvent(PICKS_EVENT, callback);
}
