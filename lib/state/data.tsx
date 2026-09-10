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
 * The server's answer, plus everything derived from it once.
 *
 * Kept separate from UiProvider because they change for different reasons: this
 * changes when a search returns, that changes when a reader clicks something.
 * One component owning both is what makes a shell hard to extend.
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
  /**
   * Which divisions the reader's point is in — M81's jurisdiction badge.
   *
   * A SET, so a list row's membership test is O(1) rather than a scan per row
   * per render. `null` when the point could not be resolved at all, which is
   * not the same as an empty set: see `lib/meetings/jurisdiction-badge.ts` for
   * why that distinction is the whole safety of the badge.
   */
  governing: ReadonlySet<string> | null;
  /**
   * Divisions covering only PART of the zip on screen (`JUR-2`, 2026-08-23).
   *
   * `governing` says which divisions the resolved point is in. When that point
   * is a ZCTA centroid rather than an address the reader gave, membership is
   * one point standing in for an area that crosses every kind of line — and
   * the meeting card was printing "Governs your area" off it, with a tooltip
   * saying the reader's address is inside. This is what stops it.
   *
   * `null` means unmeasured, which is not an empty set. An empty set says the
   * lattice measured this zip and nothing about it is partial.
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
