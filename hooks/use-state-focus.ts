"use client";

import { useCallback, useEffect, useState } from "react";

import { STATE_OUTLINES_URL, outlineFor, stateContainsPoint, stateOcdIdAt, type StateOutlines } from "@/lib/map/state-focus";

export function useStateFocus(point: { lat: number; lng: number; kind: "zip" | "settled" } | null) {
  const [outlines, setOutlines] = useState<StateOutlines | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastState, setLastState] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [crossing, setCrossing] = useState<{ toName: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(STATE_OUTLINES_URL, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`State outlines: ${response.status}`);
        return response.json() as Promise<StateOutlines>;
      })
      .then(data => { if (!controller.signal.aborted) setOutlines(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  const stateAt = useCallback((lat: number, lng: number) => stateOcdIdAt(outlines, lat, lng), [outlines]);
  const activeOcdId = point ? stateAt(point.lat, point.lng) : null;
  const activeOutline = outlineFor(outlines, activeOcdId);
  const contains = useCallback((lat: number, lng: number) => stateContainsPoint(activeOutline, lat, lng), [activeOutline]);
  const stateName = activeOutline?.properties.name ?? null;
  if (activeOcdId !== previous) {
    setPrevious(activeOcdId);
    if (activeOcdId) setLastState(activeOcdId);
    setCrossing(lastState && lastState !== activeOcdId && activeOcdId && stateName && point?.kind === "settled"
      ? { toName: stateName } : null);
  }
  const dismissCrossing = useCallback(() => setCrossing(null), []);
  return { activeOcdId, stateName, crossing, dismissCrossing, stateAt, contains, failed };
}
