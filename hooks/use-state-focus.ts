"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  STATE_OUTLINES_URL,
  stateOcdIdAt,
  type StateOutlines,
} from "@/lib/map/state-focus";

/**
 * Which state is active, and when the reader has crossed a line. A resolved
 * zip activates its state; the focus holds at every zoom level. A crossing
 * fires when the settled centre sits in a different covered state, once per
 * ordered pair per session, device-local and never logged. States with no
 * outline change nothing.
 */

export interface StateFocus {
  /** The OCD-ID of the state that rises out of the map, or null. */
  activeOcdId: string | null;
  /** Non-null while the crossing clarification is on screen. */
  crossing: { fromName: string; toName: string; toOcdId: string } | null;
  /** The reader took the crossing: the new state becomes active. */
  acceptCrossing: () => void;
  /** The reader stayed: panning stays free and the neighbour stays muted. */
  dismissCrossing: () => void;
  /** A resolved zip activates its state. */
  activateAt: (lat: number, lng: number) => void;
  /** A settled viewport centre — the crossing detector's only input. */
  noteCentre: (lat: number, lng: number) => void;
}

export function useStateFocus(): StateFocus {
  const [outlines, setOutlines] = useState<StateOutlines | null>(null);
  const [activeOcdId, setActiveOcdId] = useState<string | null>(null);
  const [crossing, setCrossing] = useState<StateFocus["crossing"]>(null);
  /** Ordered pairs already clarified this session — "from→to". */
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(STATE_OUTLINES_URL);
        if (!response.ok) return;
        const data = (await response.json()) as StateOutlines;
        if (live) setOutlines(data);
      } catch {
        // A map with no focus treatment still works.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const nameOf = useCallback(
    (ocdId: string | null) =>
      outlines?.features.find((f) => f.properties.ocdId === ocdId)?.properties
        .name ?? null,
    [outlines],
  );

  const activateAt = useCallback(
    (lat: number, lng: number) => {
      /*
       * The raised region always equals the current resolved state; a null
       * resolution publishes null. Only before the outlines load is the
       * current mask kept, since no point can resolve yet.
       */
      if (!outlines) return;
      setActiveOcdId(stateOcdIdAt(outlines, lat, lng));
      // A typed zip in a new state activates it without asking.
      setCrossing(null);
    },
    [outlines],
  );

  const noteCentre = useCallback(
    (lat: number, lng: number) => {
      if (!activeOcdId) return;
      const here = stateOcdIdAt(outlines, lat, lng);
      // Null: somewhere we hold no outline for.
      if (!here || here === activeOcdId) return;
      const key = `${activeOcdId}→${here}`;
      if (seen.current.has(key)) return;
      const fromName = nameOf(activeOcdId);
      const toName = nameOf(here);
      if (!fromName || !toName) return;
      seen.current.add(key);
      setCrossing({ fromName, toName, toOcdId: here });
    },
    [activeOcdId, nameOf, outlines],
  );

  const acceptCrossing = useCallback(() => {
    setCrossing((current) => {
      if (current) setActiveOcdId(current.toOcdId);
      return null;
    });
  }, []);

  const dismissCrossing = useCallback(() => setCrossing(null), []);

  /*
   * Memoized for correctness: consumers list it in effect dependencies, and a
   * fresh object every render re-ran the zip activation, undoing an accepted
   * crossing and clearing the prompt.
   */
  return useMemo(
    () => ({
      activeOcdId,
      crossing,
      acceptCrossing,
      dismissCrossing,
      activateAt,
      noteCentre,
    }),
    [
      activeOcdId,
      crossing,
      acceptCrossing,
      dismissCrossing,
      activateAt,
      noteCentre,
    ],
  );
}
