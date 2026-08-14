"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The reader's narrowing choices — M26/4.6.3c, device-local by design.
 *
 * Exactly two localStorage keys, per the approved spec:
 * `wtp.selected_divisions` (the divisions the reader picked) and
 * `wtp.selected_street` (the street they typed). **Neither value is ever
 * transmitted or tied to an account** — the street index is fetched as a
 * static per-zip file and matched against on the device, so the server only
 * ever sees a zip-level request it already knew about. Both values carry
 * the zip they were made for: a new zip makes them silently inert rather
 * than misapplying one town's choice to another.
 *
 * Same useSyncExternalStore shape as use-stored-zip: the server renders
 * unset, and a returning reader never sees their narrowing flash off.
 */

const DIVISIONS_KEY = "wtp.selected_divisions";
const STREET_KEY = "wtp.selected_street";

export interface NarrowingState {
  /** OCD-IDs the reader chose, scoped to the zip they chose them for. */
  divisions: string[];
  street: string | null;
}

const UNSET: NarrowingState = Object.freeze({ divisions: [], street: null });

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

    if (rawDivisions) {
      const parsed = JSON.parse(rawDivisions) as { zip?: string; ocdIds?: string[] };
      if (parsed.zip === zip && Array.isArray(parsed.ocdIds)) {
        divisions = parsed.ocdIds.filter((x) => typeof x === "string");
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
      divisions.length === 0 && street === null
        ? UNSET
        : Object.freeze({ divisions, street });
    return cachedState;
  } catch {
    return UNSET;
  }
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function useNarrowing(zip: string) {
  const state = useSyncExternalStore(
    subscribe,
    () => readFor(zip),
    () => UNSET,
  );

  const setDivisions = useCallback(
    (ocdIds: string[]) => {
      try {
        if (ocdIds.length === 0) window.localStorage.removeItem(DIVISIONS_KEY);
        else {
          window.localStorage.setItem(
            DIVISIONS_KEY,
            JSON.stringify({ zip, ocdIds }),
          );
        }
      } catch {
        // Not being able to remember is survivable.
      }
      notify();
    },
    [zip],
  );

  const setStreet = useCallback(
    (street: string | null) => {
      try {
        if (!street) window.localStorage.removeItem(STREET_KEY);
        else {
          window.localStorage.setItem(STREET_KEY, JSON.stringify({ zip, street }));
        }
      } catch {
        // Same.
      }
      notify();
    },
    [zip],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(DIVISIONS_KEY);
      window.localStorage.removeItem(STREET_KEY);
    } catch {
      // Same.
    }
    notify();
  }, []);

  return { ...state, setDivisions, setStreet, clear };
}
