import type { GeoFeature } from "../registry/resolve.ts";

export interface PlaceMembership {
  readonly placeId: string;
  readonly name: string;
  readonly state: string | null;
  readonly layer: string;
  readonly boundaryYear: number;
  readonly version: string;
  readonly share: number | null;
  readonly shareBasis: string;
  readonly partial: boolean;
  readonly fringe: boolean;
  readonly countyAttachment: boolean;
  readonly hostCountyId: string | null;
}

export interface PlaceBoundary {
  readonly placeId: string;
  readonly boundaryYear: number;
  readonly layer: string;
  readonly version: string;
  readonly geometry: GeoFeature["geometry"] | null;
  readonly hostCountyId: string | null;
  readonly countyAttachment: boolean;
  readonly sourceUrls: readonly string[];
  readonly checkedAt: string;
}

export interface PlaceMapResult {
  readonly memberships: readonly PlaceMembership[];
  /** Point lookups derive these from the state polygon, never a ZIP centroid. */
  readonly states: readonly string[];
}
