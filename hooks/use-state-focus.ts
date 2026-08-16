"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  STATE_OUTLINES_URL,
  stateOcdIdAt,
  type StateOutlines,
} from "@/lib/map/state-focus";

/**
 * Which state is ACTIVE, and when to say the reader has crossed a line —
 * e's 6b2, built in g3 item 10 (M91).
 *
 * ## Activation
 *
 * A resolved zip activates its state. Nothing before that: a reader who has
 * not said where they are has no "here" to mark, and raising a state they did
 * not ask about would be the map guessing.
 *
 * ## The g3 amendment to e's spec, recorded because it is a conflict
 *
 * e's 6b2 said **zooming out RELEASES focus** — "surveying the country is
 * browsing". g3's brief says the opposite, twice and as the author's own
 * test: "looking at 85701 and zooming ALL THE WAY OUT, Arizona still reads
 * raised and everything else still reads muted and slightly blurred — the
 * effect holds at every zoom level", and "the EFFECT never disappears."
 *
 * **The later, explicit instruction wins**, and the release rule is not
 * implemented. Both are defensible designs and this is the author's call, not
 * a build decision — it is flagged in the standing report so he can restore
 * the release if the zoom-invariance test was about the EDGE's subtlety
 * rather than about the treatment's existence. Only the shadow spread scales
 * with zoom, which is the part of e's intent that survives either reading.
 *
 * ## Crossing
 *
 * Fired when the settled viewport's centre sits in a DIFFERENT covered state
 * from the active one. Once per ordered pair per session — a clarification,
 * not a toll booth on every wobble across the line. Device-local, session
 * scoped, logged nowhere.
 *
 * **Coverage honesty:** the prompt names its destination, so it fires only
 * where we hold an outline to name. Panning into a state the product does not
 * cover changes nothing and claims nothing, rather than announcing a border
 * whose far side we cannot describe.
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
        // Ambient. A map with no focus treatment is a working map.
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
      const ocdId = stateOcdIdAt(outlines, lat, lng);
      if (!ocdId) return;
      setActiveOcdId(ocdId);
      // A zip in a new state IS the context switch, and the reader performed
      // it deliberately by typing — so it activates, and does not also stop
      // to ask whether they meant it.
      setCrossing(null);
    },
    [outlines],
  );

  const noteCentre = useCallback(
    (lat: number, lng: number) => {
      if (!activeOcdId) return;
      const here = stateOcdIdAt(outlines, lat, lng);
      // Null means "somewhere we hold no outline for" — the ocean, a state
      // the product does not cover. Not a crossing we can describe.
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

  return {
    activeOcdId,
    crossing,
    acceptCrossing,
    dismissCrossing,
    activateAt,
    noteCentre,
  };
}
