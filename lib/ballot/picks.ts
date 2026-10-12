"use client";

import { captureEvent } from "@/lib/events/client";
import { storeSafeId } from "@/lib/events/wire";
import {
  commitStorageWrite,
  publishStorageEvent,
  subscribeToStorageEvent,
} from "@/lib/state/subscribe-to-storage";

export const PICKS_STORAGE_KEY = "wtp.ballot_picks";

export interface StoredPick {
  contestId: string;
  contestTitle: string;
  /** Selected choice ids, in tap order. Length ≤ voteFor. */
  choiceIds: string[];
  labels: Record<string, string>;
}

interface PicksFile {
  version: 2;
  picks: Record<string, StoredPick>;
  suppressedDerived: Record<string, string[]>;
  unsure?: Record<string, true>;
}

const EMPTY: PicksFile = { version: 2, picks: {}, suppressedDerived: {} };

const PICKS_EVENT = "wtp:ballot-picks-changed";

function read(): PicksFile {
  try {
    const raw = window.localStorage.getItem(PICKS_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Omit<Partial<PicksFile>, "version"> & {
      version?: number;
    };
    if (typeof parsed?.picks !== "object" || parsed.picks === null) return EMPTY;
    // A v1 file reads as v2 with nothing suppressed.
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

export function getUnsure(): Record<string, true> {
  if (typeof window === "undefined") return {};
  return read().unsure ?? {};
}

export function getSuppressedDerived(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  return read().suppressedDerived;
}

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

export function markUnsure(contestId: string) {
  const file = read();
  delete file.picks[contestId];
  file.unsure = { ...(file.unsure ?? {}), [contestId]: true };
  write(file);
  captureEvent({ type: "BALLOT_PICK", ballotPick: { contestId: storeSafeId(contestId), candidateIds: [], choice: "UNSURE" } });
}

export function clearAllPicks(derivedNow: Record<string, string[]> = {}) {
  const before = read();
  write({ version: 2, picks: {}, suppressedDerived: derivedNow });
  for (const contestId of Object.keys(before.picks)) {
    captureEvent({ type: "BALLOT_PICK", ballotPick: { contestId: storeSafeId(contestId), candidateIds: [], choice: "BLANK" } });
  }
}

export function subscribePicks(callback: () => void): () => void {
  return subscribeToStorageEvent(PICKS_EVENT, callback);
}
