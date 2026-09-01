"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

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
  /**
   * The reader answered "no thanks, show me everything" (3b, 2026-08-16).
   * Persisted INSIDE the divisions key's value — still exactly two
   * localStorage keys — so the modal asks once per zip, never on every
   * visit. A recorded decline is a response, not a narrowing.
   */
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
