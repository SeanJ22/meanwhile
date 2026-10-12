/**
 * Where the single Ballot/zip+Ask pill cluster renders: at the top of
 * who-governs when it is open; else at the top of the sidebar when the
 * sidebar is open; else as the map's top-right pill. Only which of the sidebar
 * and who-governs is open decides; the battlecard is deliberately not a
 * parameter. Total over its inputs.
 */

export type AskPillPlacement = "map" | "sidebar" | "wgh";

export function clusterPlacement(open: {
  wgh: boolean;
  sidebar: boolean;
}): AskPillPlacement {
  if (open.wgh) return "wgh";
  if (open.sidebar) return "sidebar";
  return "map";
}
