import { addressWords as usps } from "./address-words.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { censusAddressQuery } from "./address-query.ts";

const hasWords = (whole: string, part: string): boolean =>
  ` ${whole} `.includes(` ${part} `);
interface CensusMatch {
  readonly matchedAddress?: string;
  readonly coordinates?: { readonly x?: number; readonly y?: number };
  readonly addressComponents?: {
    readonly city?: string;
    readonly state?: string;
    readonly zip?: string;
    readonly streetName?: string;
    readonly preDirection?: string;
    readonly suffixType?: string;
  };
}

/**
 * A single Census match must repeat the published house, street and city.
 * A state or ZIP the source states must agree; an omitted state is not a mismatch.
 */
export function verifiedCensusVenuePoint(
  published: string,
  response: unknown,
): { lat: number; lng: number; address: string } | null {
  const matches = (response as { result?: { addressMatches?: CensusMatch[] } })
    ?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  const components = match.addressComponents;
  const address = match.matchedAddress ?? "";
  const house = /^\s*(\d+)\b/.exec(address)?.[1];
  if (
    !house ||
    !components?.streetName ||
    !components.city ||
    !components.state
  )
    return null;
  const folded = usps(published);
  const street = usps(
    [
      house,
      components.preDirection,
      components.streetName,
      components.suffixType,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (!hasWords(folded, street) || !hasWords(folded, usps(components.city)))
    return null;
  const query = censusAddressQuery(published);
  const foldedQuery = usps(query);
  const stateTail = /\b([a-z]{2})(?:\s+\d{5}(?:\s+\d{4})?)?$/.exec(
    foldedQuery,
  )?.[1];
  if (
    stateTail &&
    US_JURISDICTIONS.some((state) => state.slug === stateTail) &&
    stateTail !== components.state.toLowerCase()
  )
    return null;
  const zipPattern = new RegExp(
    `\\b${usps(components.state)}\\s+(\\d{5})\\b`,
    "g",
  );
  const publishedZip =
    [...foldedQuery.matchAll(zipPattern)].at(-1)?.[1] ??
    /\b(\d{5})(?:-\d{4})?\s*$/.exec(query)?.[1];
  if (publishedZip && components.zip !== publishedZip) return null;
  const lat = match.coordinates?.y;
  const lng = match.coordinates?.x;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return null;
  return { lat, lng, address };
}
