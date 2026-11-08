"use client";

import { createContext, useContext } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

/** The one map, handed to whatever draws on it from inside `MapCanvas`. */
export const MapInstance = createContext<MapLibreMap | null>(null);

export function useMapInstance(): MapLibreMap {
  const map = useContext(MapInstance);
  if (!map) throw new Error("useMapInstance is used inside MapCanvas, after the map has loaded");
  return map;
}
