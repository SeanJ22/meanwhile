import { fetchSource } from "../sources/fetch-source.ts";
import { createHash } from "node:crypto";

import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import { resolveVenue, venueResolutionRecordId, type VenueEntry } from "./venue-cache.ts";

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const words = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasWords = (whole: string, part: string): boolean => ` ${whole} `.includes(` ${part} `);
// Census names parts of an address in USPS form (W, ST, AZ); a publisher spells them out (West, Street, Arizona).
const USPS_WORDS: Readonly<Record<string, string>> = {
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", boulevard: "blvd", court: "ct", circle: "cir",
  place: "pl", parkway: "pkwy", highway: "hwy", terrace: "ter", trail: "trl", square: "sq", way: "way",
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct",
  delaware: "de", florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi",
  minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", ohio: "oh",
  oklahoma: "ok", oregon: "or", pennsylvania: "pa", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", wisconsin: "wi", wyoming: "wy",
};
const TWO_WORD_STATES: ReadonlyArray<readonly [string, string]> = [
  ["new hampshire", "nh"], ["new jersey", "nj"], ["new mexico", "nm"], ["new york", "ny"], ["north carolina", "nc"],
  ["north dakota", "nd"], ["south carolina", "sc"], ["south dakota", "sd"], ["west virginia", "wv"], ["rhode island", "ri"],
];
const usps = (value: string): string => TWO_WORD_STATES.reduce((text, [name, code]) => ` ${text} `.replace(` ${name} `, ` ${code} `).trim(), words(value))
  .split(" ").map((word) => USPS_WORDS[word] ?? word).join(" ");
/** Resolve a relative event citation against the exact promoted publisher route. */
export function absolutePublisherMeetingUrl(citation: string | null, route: string): string {
  try {
    const base = new URL(route);
    const resolved = new URL(citation ?? "", base);
    return base.protocol === "https:" && resolved.protocol === "https:" ? resolved.toString() : route;
  } catch { return route; }
}

export function normalizeFamilyMeetingCitations(meetings: readonly Meeting[], routes: ReadonlyMap<string, string>): readonly Meeting[] {
  return meetings.map((meeting): Meeting => {
    const sourceId = meeting.id.split(":", 1)[0] ?? "";
    const route = routes.get(`${sourceId}:${meeting.bodyId}`);
    if (!route) return meeting;
    const sourceUrl = absolutePublisherMeetingUrl(meeting.provenance.sourceUrl, route);
    return sourceUrl === meeting.provenance.sourceUrl ? meeting
      : { ...meeting, provenance: { ...meeting.provenance, sourceUrl } };
  });
}
function samePublisherRoute(citation: string | null, acquired: string): boolean {
  if (!citation) return false;
  try {
    const cited = new URL(citation, acquired);
    const actual = new URL(acquired);
    const params = (url: URL): string => [...url.searchParams].sort(([ak, av], [bk, bv]) =>
      ak.localeCompare(bk) || av.localeCompare(bv)).map(([key, value]) => `${key}=${value}`).join("&");
    return cited.protocol === "https:" && cited.origin === actual.origin && cited.pathname === actual.pathname && params(cited) === params(actual);
  } catch { return false; }
}

interface CensusMatch {
  readonly matchedAddress?: string;
  readonly coordinates?: { readonly x?: number; readonly y?: number };
  readonly addressComponents?: {
    readonly city?: string; readonly state?: string; readonly zip?: string;
    readonly streetName?: string; readonly preDirection?: string; readonly suffixType?: string;
  };
}

export function verifiedCensusVenuePoint(published: string, response: unknown): { lat: number; lng: number; address: string } | null {
  const matches = (response as { result?: { addressMatches?: CensusMatch[] } })?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  const components = match.addressComponents;
  const address = match.matchedAddress ?? "";
  const house = /^\s*(\d+)\b/.exec(address)?.[1];
  if (!house || !components?.streetName || !components.city || !components.state) return null;
  const folded = usps(published);
  const street = usps([house, components.preDirection, components.streetName, components.suffixType].filter(Boolean).join(" "));
  if (!hasWords(folded, street) || !hasWords(folded, usps(components.city)) ||
      !hasWords(folded, usps(components.state))) return null;
  const publishedZip = /\b\d{5}\b/.exec(published)?.[0];
  if (publishedZip && components.zip !== publishedZip) return null;
  const lat = match.coordinates?.y;
  const lng = match.coordinates?.x;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < 18 || lat > 72 || lng < -180 || lng > -65) return null;
  return { lat, lng, address };
}

/** Reapply only exact promoted source/body/location resolutions to this same acquired family. */
export function placeMeetingsFromVerifiedVenues(meetings: readonly Meeting[], reviewed: readonly VenueEntry[]): {
  readonly meetings: readonly Meeting[]; readonly placedCount: number;
} {
  let placedCount = 0;
  const placed = meetings.map((meeting): Meeting => {
    const gap = meeting.venueGap;
    if (meeting.location || !meeting.ocdId || gap?.kind !== "STATED_NOT_PLACED" || !gap.publishedText) return meeting;
    const sourceName = meeting.id.split(":", 1)[0] ?? "";
    const venue = resolveVenue(sourceName, meeting.ocdId, gap.publishedText, null, reviewed);
    if (!venue) return meeting;
    placedCount++;
    const { venueGap: _gap, ...rest } = meeting;
    return { ...rest, location: { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } };
  });
  return { meetings: placed, placedCount };
}

/** Keep an already promoted point only while a fresh read repeats that exact sitting and address. */
export function retainPreviouslyVerifiedVenuePoints(meetings: readonly Meeting[], previous: readonly Meeting[]): readonly Meeting[] {
  const byId = new Map(previous.map((meeting) => [meeting.id, meeting]));
  return meetings.map((meeting): Meeting => {
    const prior = byId.get(meeting.id);
    if (meeting.location || meeting.venueGap?.kind !== "STATED_NOT_PLACED" || !prior?.location ||
        meeting.bodyId !== prior.bodyId || meeting.ocdId !== prior.ocdId ||
        meeting.provenance.sourceUrl !== prior.provenance.sourceUrl ||
        meeting.venueGap.publishedText?.trim() !== prior.location.address?.trim()) return meeting;
    const { venueGap: _gap, ...rest } = meeting;
    return { ...rest, location: prior.location };
  });
}

export async function automaticVenuePackage(input: {
  readonly snapshot: MeetingsSnapshot;
  readonly existingIds: ReadonlySet<string>;
  /** The promoted family wiring's exact source/body routes, never a guessed event link. */
  readonly memberRoutes: ReadonlyMap<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => string;
}): Promise<{ readonly package: ManualProjectionPackage | null; readonly held: readonly string[] }> {
  const fetchImpl = input.fetchImpl ?? fetchSource;
  const clock = input.clock ?? (() => new Date().toISOString());
  const rows: Array<Readonly<Record<string, unknown>> & { readonly id: string }> = [];
  const sources = new Map<string, ManualSourceReview>();
  const held: string[] = [];
  const pending = new Map<string, Meeting>();
  for (const meeting of input.snapshot.meetings) {
    const gap = meeting.venueGap;
    if (meeting.location || meeting.online || gap?.kind !== "STATED_NOT_PLACED" || !gap.publishedText?.trim() || !meeting.ocdId) continue;
    const sourceId = meeting.id.split(":", 1)[0] ?? "";
    const id = venueResolutionRecordId({ sourceId, bodyOcdId: meeting.ocdId, match: gap.publishedText });
    if (input.existingIds.has(id)) continue;
    const generation = Date.parse(input.snapshot.generatedAt);
    const collected = Date.parse(meeting.provenance.collectedAt);
    if (meeting.carried || !Number.isFinite(generation) || !Number.isFinite(collected) || Math.abs(generation - collected) > 3_600_000) {
      held.push(`${id}: the address was not freshly read in this family pass`);
      continue;
    }
    if (!pending.has(id)) pending.set(id, meeting);
  }
  const keys = [...pending.keys()].sort();
  // Federal sites are read at full speed: every new address is matched in the pass.
  for (const id of keys) {
    const meeting = pending.get(id)!;
    const gap = meeting.venueGap!;
    const published = gap.publishedText!;
    const bodyOcdId = meeting.ocdId!;
    const sourceId = meeting.id.split(":", 1)[0] ?? "";
    const memberRoute = input.memberRoutes.get(`${sourceId}:${meeting.bodyId}`);
    if (!memberRoute) { held.push(`${id}: no promoted route for this exact source and body`); continue; }
    const acquisition = input.snapshot.sources.find((source) => source.source === sourceId)?.acquisitions?.find((evidence) =>
      samePublisherRoute(memberRoute, evidence.finalUrl) && evidence.source === sourceId && /^[a-f0-9]{64}$/.test(evidence.rawHash) &&
      evidence.httpStatus >= 200 && evidence.httpStatus < 300
    );
    if (!acquisition) {
      held.push(`${id}: no exact verified publisher acquisition for the stated address`);
      continue;
    }
    const url = new URL(CENSUS_URL);
    url.searchParams.set("address", published);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "MeanwhileUSA/1.0 (public civic meeting venue verification)" } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) { held.push(`${id}: Census geocoder HTTP ${response.status}`); continue; }
      const point = verifiedCensusVenuePoint(published, JSON.parse(new TextDecoder().decode(bytes)));
      if (!point) { held.push(`${id}: Census returned no single exact house/street/city/state/ZIP match`); continue; }
      const finalUrl = response.url || url.toString();
      if (new URL(finalUrl).hostname !== "geocoding.geo.census.gov") { held.push(`${id}: geocoder redirected off the Census host`); continue; }
      const retrievedAt = clock();
      rows.push({ sourceId, bodyOcdId, match: published, id,
        name: published.trim(), address: published.trim(), lat: point.lat, lng: point.lng,
        addressSourceUrl: acquisition.finalUrl, coordinateSourceUrl: finalUrl, verifiedAt: retrievedAt });
      sources.set(acquisition.finalUrl, {
        requestedUrl: acquisition.requestedUrl, finalUrl: acquisition.finalUrl, publisher: gap.publisher,
        sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: meeting.provenance.collectedAt,
        httpStatus: acquisition.httpStatus, rawHash: acquisition.rawHash,
        reviewedEvidence: `Previously promoted meeting ${meeting.id} states the exact venue; its acquired publisher bytes remain the address authority.`,
      });
      sources.set(finalUrl, {
        requestedUrl: url.toString(), finalUrl, publisher: "United States Census Bureau",
        sourceClass: "REFERENCE_PUBLISHER", retrievedAt, httpStatus: response.status, rawHash: hash(bytes),
        reviewedEvidence: `One Census match agrees with the publisher's house number, street, city, state and ZIP; the coordinate is a street-address point.`,
      });
    } catch (error) {
      held.push(`${id}: geocoder read failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (rows.length === 0) return { package: null, held };
  const reviewedAt = clock();
  return {
    package: {
      contractId: "venue-resolutions", version: reviewedAt, sourceThrough: reviewedAt,
      sourceReceipt: { contractVersion: 1, reviewedAt, reviewedBy: "automatic-census-venue-reviewer/1", sources: [...sources.values()] },
      payload: { kind: "venue-resolutions", records: rows },
    }, held,
  };
}

/** What the Census match adds to one acquired set of meetings: placed rows and the receipts that prove each pin. */
export interface CensusVenuePlacement {
  readonly meetings: readonly Meeting[];
  readonly placedCount: number;
  readonly held: readonly string[];
  readonly venueReferenceEvidence: readonly Readonly<Record<string, unknown>>[];
  /** The new matches as a `venue-resolutions` package, or null when nothing new was matched. */
  readonly package: ManualProjectionPackage | null;
}

export async function placeMeetingsFromCensusVenues(input: {
  readonly snapshot: MeetingsSnapshot;
  readonly existingIds: ReadonlySet<string>;
  readonly memberRoutes: ReadonlyMap<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => string;
}): Promise<CensusVenuePlacement> {
  const proposed = await automaticVenuePackage(input);
  const newRows = (proposed.package?.payload as { records?: VenueEntry[] } | undefined)?.records ?? [];
  const placed = placeMeetingsFromVerifiedVenues(input.snapshot.meetings, newRows);
  const references = (proposed.package?.sourceReceipt.sources ?? []).filter((source) => source.sourceClass === "REFERENCE_PUBLISHER");
  const venueReferenceEvidence = newRows.map((row) => {
    const reference = references.find((source) => source.finalUrl === row.coordinateSourceUrl);
    if (!reference || reference.httpStatus < 200 || reference.httpStatus >= 300 || !/^[a-f0-9]{64}$/.test(reference.rawHash)) {
      throw new Error(`AUTOMATIC_VENUE_REFERENCE_MISSING:${venueResolutionRecordId(row)}`);
    }
    return { venueId: venueResolutionRecordId(row), addressSourceUrl: row.addressSourceUrl,
      censusRequestedUrl: reference.requestedUrl, censusFinalUrl: reference.finalUrl,
      censusRawSha256: reference.rawHash, retrievedAt: reference.retrievedAt,
      publishedAddress: row.address, lat: row.lat, lng: row.lng };
  });
  return { meetings: placed.meetings, placedCount: placed.placedCount, held: proposed.held, venueReferenceEvidence, package: proposed.package };
}
