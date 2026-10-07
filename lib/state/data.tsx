"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { MeetingSearchResult } from "@/lib/meetings/query";
import type { MeetingListingIdentityReadback } from "@/lib/meetings/listing-identity";
import type { Venue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";
import type { StoredLocation } from "@/hooks/use-stored-zip";
import type { DrawnDistrict } from "@/lib/map/districts";
import type { JurisdictionBasis } from "@/lib/meetings/jurisdiction-badge";
import type { CommentAccess } from "@/lib/registry/comment-access-client";
import type { EverydayRoutingProjection } from "@/lib/routing/everyday";

/**
 * The server's answer, plus everything derived from it once. Kept separate from
 * UiProvider: this changes when a search returns, that when a reader clicks.
 */

export interface ShellData {
  /** Everything the cascade returned, before UI filters. */
  allMeetings: Meeting[];
  /** Owner-reviewed canonical rules returned with the meeting projection. */
  commentAccess?: readonly CommentAccess[];
  /** Direct-owner routing projection returned by the server data plane. */
  everydayRouting?: EverydayRoutingProjection | null;
  /** After the active tier, scope, chips, date window and radius. */
  meetings: Meeting[];
  /** Identity diagnostic belonging to these rows, including same-area carry-forward. */
  listingIdentity?: MeetingListingIdentityReadback;
  /** Venues for the filtered set — one pin per venue, not per meeting. */
  venues: Venue[];
  result: MeetingSearchResult | null;
  location: StoredLocation | null;
  /** The districts currently drawn — the stats card counts this list and
   *  the districts door renders it: one denominator for both. */
  drawnDistricts: DrawnDistrict[];
  /** Meetings the adapter could not place. Surfaced, never silent. */
  dropped: number;
  searchFailed: boolean;
  /**
   * True when the answer on screen was resolved from a street address the
   * reader gave, rather than from a zip centroid. "You are in N districts" is
   * only sayable about a real point.
   */
  atAddress: boolean;
  /**
   * Which divisions the reader's point is in, for the jurisdiction badge.
   * `null` when the point could not be resolved at all, which is not the same
   * as an empty set (see `lib/meetings/jurisdiction-badge.ts`).
   */
  governing: ReadonlySet<string> | null;
  /**
   * Divisions covering only PART of the zip on screen. When the point is a
   * ZCTA centroid, membership stands in for an area that crosses every kind of
   * line, so these divisions must not be shown as governing the reader's
   * address. `null` means unmeasured, which is not an empty set.
   */
  zipPartial: ReadonlySet<string> | null;
  /**
   * The basis for `governing` — `ADDRESS` when the reader gave a street,
   * `ZIP` otherwise. Derived from `atAddress` rather than carried separately,
   * so the two cannot disagree.
   */
  basis: JurisdictionBasis;
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

export function useMeetingListingIdentity(): MeetingListingIdentityReadback | undefined {
  const data = useShellData();
  return data.listingIdentity ?? data.result?.listingIdentity;
}
