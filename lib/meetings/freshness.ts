/**
 * Client-safe shapes for the snapshot freshness surface.
 *
 * `lib/meetings/snapshot.ts` owns the file and imports `node:fs`, so client
 * components must not touch it; these are the types the API route serializes
 * for them. A stale snapshot rendering as though it were current is the
 * silent-fallback failure this project has recorded twice (the raster
 * basemap, the vector tiles) — the freshness line is what keeps it loud.
 */

export interface SnapshotFailureNote {
  source: string;
  /** Divisions whose calendars this source serves — the bodies now dark. */
  ocdIds: string[];
}

export interface SnapshotStatus {
  generatedAt: string;
  sources: Array<{ source: string; ok: boolean; error: string | null }>;
  failed: SnapshotFailureNote[];
}

/** "3 minutes ago" / "2 hours ago" / "4 days ago", coarse on purpose. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
