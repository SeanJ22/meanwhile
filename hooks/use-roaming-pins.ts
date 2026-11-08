"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchFile, loadStateIndex, placeById, placesForView, pinsOfPlaceFile, type StateIndex, type ViewBox } from "@/lib/map/place-index-client";
import type { Meeting } from "@/lib/sources/types";

export interface SettledView extends ViewBox { readonly zoom: number; readonly states: readonly string[] }

/**
 * Meeting pins for wherever the reader moves the map. A settled view loads its states' light indexes once and, close enough in, the files of the
 * places in view; a drag fetches nothing, and a view too wide for pins draws none and asks the reader to zoom in.
 */
export function useRoamingPins(): {
  pins: readonly Meeting[];
  /** The view is too wide for pins. */
  zoomIn: boolean;
  settle: (view: SettledView) => void;
  /** A tapped place's file is added to the pins. */
  open: (placeId: string, states: readonly string[]) => void;
} {
  const [state, setState] = useState<{ pins: readonly Meeting[]; zoomIn: boolean }>({ pins: [], zoomIn: false });
  const run = useRef<AbortController | null>(null);
  const indexes = useRef<StateIndex[]>([]);
  const opened = useRef(new Map<string, readonly Meeting[]>());
  useEffect(() => () => run.current?.abort(), []);

  const settle = useCallback((view: SettledView) => {
    run.current?.abort();
    const controller = run.current = new AbortController();
    void (async () => {
      const loaded = (await Promise.all(view.states.map(loadStateIndex))).filter((index): index is StateIndex => index !== null);
      indexes.current = loaded;
      const choice = placesForView(loaded, view, view.zoom);
      if (controller.signal.aborted) return;
      if (!choice.draw) { setState(held => held.pins.length === 0 && held.zoomIn === (loaded.length > 0) ? held : { pins: [], zoomIn: loaded.length > 0 }); return; }
      const read = await Promise.all(choice.places.map(place => fetchFile(place.file, controller.signal).then(file => ({ id: place.id, pins: file ? pinsOfPlaceFile(file) : [] }), () => ({ id: place.id, pins: [] as Meeting[] }))));
      if (controller.signal.aborted) return;
      for (const { id, pins } of read) opened.current.set(id, pins);
      setState({ pins: [...new Map(read.flatMap(row => row.pins).map(meeting => [meeting.id, meeting])).values()], zoomIn: false });
    })().catch(() => {});
  }, []);

  const open = useCallback((placeId: string, states: readonly string[]) => {
    void (async () => {
      const loaded = indexes.current.length ? indexes.current : (await Promise.all(states.map(loadStateIndex))).filter((index): index is StateIndex => index !== null);
      const place = placeById(loaded, placeId);
      if (!place || opened.current.has(place.id)) return;
      const file = await fetchFile(place.file);
      const whole = file ? pinsOfPlaceFile(file, true) : [];
      opened.current.set(place.id, whole);
      setState(held => ({ ...held, pins: [...new Map([...held.pins, ...whole].map(meeting => [meeting.id, meeting])).values()] }));
    })().catch(() => {});
  }, []);

  return { ...state, settle, open };
}
