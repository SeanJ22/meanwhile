"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * The reader's narrowing choices, device-local in exactly two localStorage
 * keys: `wtp.selected_divisions` and `wtp.selected_street`. Neither is ever
 * transmitted; the street index is a static per-zip file matched on the
 * device. Both carry their zip, so a new zip makes them inert. Read through
 * useSyncExternalStore, so a returning reader never sees them flash off.
 */

const DIVISIONS_KEY = "wtp.selected_divisions";
const STREET_KEY = "wtp.selected_street";

export interface NarrowingState {
  /** OCD-IDs the reader chose, scoped to the zip they chose them for. */
  divisions: string[];
  street: string | null;
  /** The reader declined narrowing for this zip; stored inside the divisions key, so asked once per zip. */
  declined: boolean;
}

const UNSET: NarrowingState = Object.freeze({
  divisions: [],
  street: null,
  declined: false,
});

const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedZip: string | null = null;
let cachedState: NarrowingState = UNSET;

function readFor(zip: string): NarrowingState {
  try {
    const rawDivisions = window.localStorage.getItem(DIVISIONS_KEY);
    const rawStreet = window.localStorage.getItem(STREET_KEY);
    const raw = `${rawDivisions}|${rawStreet}`;
    if (raw === cachedRaw && zip === cachedZip) return cachedState;

    let divisions: string[] = [];
    let street: string | null = null;
    let declined = false;

    if (rawDivisions) {
      const parsed = JSON.parse(rawDivisions) as {
        zip?: string;
        ocdIds?: string[];
        declined?: boolean;
      };
      if (parsed.zip === zip) {
        if (Array.isArray(parsed.ocdIds)) {
          divisions = parsed.ocdIds.filter((x) => typeof x === "string");
        }
        declined = parsed.declined === true;
      }
    }
    if (rawStreet) {
      const parsed = JSON.parse(rawStreet) as { zip?: string; street?: string };
      if (parsed.zip === zip && typeof parsed.street === "string") {
        street = parsed.street;
      }
    }

    cachedRaw = raw;
    cachedZip = zip;
    cachedState =
      divisions.length === 0 && street === null && !declined
        ? UNSET
        : Object.freeze({ divisions, street, declined });
    return cachedState;
  } catch {
    return UNSET;
  }
}

const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

function notify() {
  publishToListeners(listeners);
}

export function useNarrowing(zip: string) {
  const state = useSyncExternalStore(
    subscribe,
    () => readFor(zip),
    () => UNSET,
  );

  const setDivisions = useCallback(
    (ocdIds: string[]) => {
      // Not being able to remember is survivable; the notify is not optional.
      commitStorageWrite(() => {
        if (ocdIds.length === 0) window.localStorage.removeItem(DIVISIONS_KEY);
        else {
          window.localStorage.setItem(
            DIVISIONS_KEY,
            JSON.stringify({ zip, ocdIds }),
          );
        }
      }, notify);
    },
    [zip],
  );

  const setStreet = useCallback(
    (street: string | null) => {
      commitStorageWrite(() => {
        if (!street) window.localStorage.removeItem(STREET_KEY);
        else {
          window.localStorage.setItem(STREET_KEY, JSON.stringify({ zip, street }));
        }
      }, notify);
    },
    [zip],
  );

  const setDeclined = useCallback(() => {
    commitStorageWrite(
      () =>
        window.localStorage.setItem(
          DIVISIONS_KEY,
          JSON.stringify({ zip, ocdIds: [], declined: true }),
        ),
      notify,
    );
  }, [zip]);

  const clear = useCallback(() => {
    commitStorageWrite(() => {
      window.localStorage.removeItem(DIVISIONS_KEY);
      window.localStorage.removeItem(STREET_KEY);
    }, notify);
  }, []);

  return { ...state, setDivisions, setStreet, setDeclined, clear };
}
