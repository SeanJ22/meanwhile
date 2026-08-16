"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { MeetingSearchResult } from "@/lib/meetings/query";
import type { Venue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";
import type { StoredLocation } from "@/hooks/use-stored-zip";
import type { DrawnDistrict } from "@/lib/map/districts";

/**
 * The server's answer, plus everything derived from it once.
 *
 * Kept separate from UiProvider because they change for different reasons: this
 * changes when a search returns, that changes when a reader clicks something.
 * One component owning both is what makes a shell hard to extend.
 */

export interface ShellData {
  /** Everything the cascade returned, before UI filters. */
  allMeetings: Meeting[];
  /** After the active tier, scope, chips, date window and radius. */
  meetings: Meeting[];
  /** Venues for the filtered set — one pin per venue, not per meeting. */
  venues: Venue[];
  result: MeetingSearchResult | null;
  location: StoredLocation | null;
  /** The districts currently drawn — the stats card counts this list and
   *  the districts door renders it: one denominator for both (3g). */
  drawnDistricts: DrawnDistrict[];
  /** Meetings the adapter could not place. Surfaced, never silent. */
  dropped: number;
  searchFailed: boolean;
  /**
   * True when the answer on screen was resolved from a street address the
   * reader gave, rather than from a zip centroid.
   *
   * The districts counter is the first surface that needs to know: "you are
   * in N districts" is only sayable about a real point, because a ZCTA
   * centroid crosses city, county and school lines and can sit in another
   * town entirely.
   */
  atAddress: boolean;
}

const DataContext = createContext<ShellData | null>(null);

export function DataProvider({
  value,
  children,
}: {
  value: ShellData;
  children: ReactNode;
}) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useShellData(): ShellData {
  const data = useContext(DataContext);
  if (!data) throw new Error("useShellData must be used inside <DataProvider>");
  return data;
}
