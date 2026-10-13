import { fromMemberOffice, addressKey, type OfficeLocation } from "../officials/office-locations.ts";
import { tierForOcdId, TIER_LABEL } from "../ocd/tiers.ts";
import type { CoverageSummary } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type { MemberDirectory } from "../../hooks/use-member-directory.ts";

/** Only the reader's own representatives have office pins; a level is the owner's, from the OCD tier table. */
export type OfficeTier = "state" | "national";
export type OfficeRole = "US House" | "US Senate" | "State office";

/** A representative whose district offices the map may pin. */
export interface OfficeOwner {
  readonly holder: SeatHolder;
  readonly tier: OfficeTier;
  readonly role: OfficeRole;
  readonly seatLabel: string | null;
}

export interface NamedOffice extends OfficeLocation {
  readonly id: string;
  /** The owner's name. */
  readonly name: string;
  readonly tier: OfficeTier;
  readonly role: OfficeRole;
  readonly seatLabel: string | null;
  /** The directory's own coordinate, when it publishes one. */
  readonly point?: { readonly lat: number; readonly lng: number };
}
export interface OfficePin extends NamedOffice { readonly lat: number; readonly lng: number }

const OWNER_SEAT_TYPES = new Set(["cd", "sldu", "sldl", "state"]);
const SENATE_DIVISION = "ocd-division/country:us";

function ownerTier(ocdId: string): OfficeTier | null {
  const tier = tierForOcdId(ocdId);
  return tier === "state" || tier === "national" ? tier : null;
}

/**
 * The reader's US House member, two US senators and state legislators. Bodies, body rosters and local seats
 * never own an office pin; their offices belong to the venue and battlecards.
 */
export function officeOwners(coverage: Pick<CoverageSummary, "seats" | "senators"> | null): OfficeOwner[] {
  const owners = new Map<string, OfficeOwner>();
  for (const seat of coverage?.seats ?? []) {
    const tier = OWNER_SEAT_TYPES.has(seat.divisionType) ? ownerTier(seat.ocdId) : null;
    if (!tier) continue;
    const role: OfficeRole = tier === "national" ? "US House" : "State office";
    for (const holder of seat.representatives) {
      if (!owners.has(holder.id)) owners.set(holder.id, { holder, tier, role, seatLabel: seat.label || null });
    }
  }
  const senateTier = ownerTier(SENATE_DIVISION);
  for (const holder of coverage?.senators ?? []) {
    if (senateTier && !owners.has(holder.id)) owners.set(holder.id, { holder, tier: senateTier, role: "US Senate", seatLabel: "U.S. Senator" });
  }
  return [...owners.values()];
}

/** Keys name the owner and published office, never a list position or a home. */
export function officeId(location: OfficeLocation): string {
  return `${location.ownerId}:${location.kind}:${addressKey(location.address)}`;
}

/** A Washington office is a capitol office, whatever the directory row calls it. */
const WASHINGTON = /,\s*(?:washington,?\s*)?d\.?c\.?\s*(?:2\d{4}(?:-\d{4})?)?\s*$/i;

/**
 * An owner's district offices from the office directory. Capitol and Washington offices stay on the battlecard;
 * candidate filing and mailing fields are never inputs.
 */
export function directoryOffices(owner: OfficeOwner, directory: MemberDirectory): NamedOffice[] {
  const ownerId = owner.holder.id;
  return directory.districtOffices.flatMap((office, index) => {
    const detail = directory.officeDetails?.[index];
    const source = detail ?? directory.source;
    if (!source || detail?.officeKind === "CAPITOL") return [];
    const location = fromMemberOffice({ id: `${ownerId}:office:${index}`, kind: "MEMBER_OFFICE", officeholderId: ownerId,
      officeKind: "DISTRICT", office, official: detail?.official ?? false,
      sourceUrl: detail?.sourceUrl ?? directory.source?.repoUrl ?? "", sourceOrg: source.sourceOrg, collectedAt: source.collectedAt });
    if (!location || WASHINGTON.test(location.address)) return [];
    const point = office.lat !== null && office.lng !== null && Number.isFinite(office.lat) && Number.isFinite(office.lng)
      && Math.abs(office.lat) <= 90 && Math.abs(office.lng) <= 180 ? { point: { lat: office.lat, lng: office.lng } } : {};
    return [{ ...location, id: officeId(location), name: owner.holder.name, tier: owner.tier, role: owner.role, seatLabel: owner.seatLabel, ...point }];
  });
}

/** What a screen reader hears for one office. */
export function officeAriaLabel(office: Pick<NamedOffice, "name" | "role" | "tier">): string {
  return `${office.name}, ${office.role === "State office" ? "state legislator" : office.role} district office, ${TIER_LABEL[office.tier]} office`;
}

export interface MapBounds { readonly west: number; readonly south: number; readonly east: number; readonly north: number }
export interface VenuePoint { readonly key: string; readonly address: string | null; readonly lat: number; readonly lng: number }

const inBounds = (pin: OfficePin, bounds: MapBounds) =>
  pin.lat >= bounds.south && pin.lat <= bounds.north && pin.lng >= bounds.west && pin.lng <= bounds.east;

/** Metres between two points; plenty accurate across one block. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}

/** One building: the published street line matches and the points sit on the same block. */
const SAME_BUILDING_METRES = 150;
export function officeAtVenue(office: OfficePin, venue: VenuePoint): boolean {
  if (!venue.address || metres(office, venue) > SAME_BUILDING_METRES) return false;
  const street = addressKey((office.address.split(",")[0] ?? "").replace(/\s*(?:\b(?:suite|ste|unit|room|rm|floor|fl)\b|#).*$/i, ""));
  return /^\d/.test(street) && ` ${addressKey(venue.address)} `.includes(` ${street} `);
}

export interface OfficePinSet {
  /** Offices drawn as their own pins. */
  readonly pins: readonly OfficePin[];
  /** Offices in a meeting venue's building, listed on that venue's card instead, by venue key. */
  readonly atVenue: ReadonlyMap<string, readonly OfficePin[]>;
}

/**
 * Which offices get a pin. A senator's offices show only inside the current view (none until the view is known);
 * an office in a meeting venue's building folds into that venue.
 */
export function officePinSet(pins: readonly OfficePin[], options: { bounds: MapBounds | null; venues: readonly VenuePoint[] }): OfficePinSet {
  const drawn: OfficePin[] = [];
  const atVenue = new Map<string, OfficePin[]>();
  for (const pin of pins) {
    if (pin.role === "US Senate" && !(options.bounds && inBounds(pin, options.bounds))) continue;
    const venue = options.venues.find(value => officeAtVenue(pin, value));
    if (!venue) { drawn.push(pin); continue; }
    const rows = atVenue.get(venue.key) ?? [];
    if (!rows.some(row => row.id === pin.id)) rows.push(pin);
    atVenue.set(venue.key, rows);
  }
  return { pins: drawn, atVenue };
}

export interface OfficeSite {
  readonly id: string; readonly name: string; readonly address: string | null;
  readonly lat: number; readonly lng: number; readonly offices: readonly OfficePin[];
}
/** Shared buildings get one reachable pin, preserving every owner's office. */
export function groupOfficePins(pins: readonly OfficePin[]): OfficeSite[] {
  const sites = new Map<string, OfficePin[]>();
  for (const pin of pins) {
    const id = `${pin.lat}:${pin.lng}`;
    const rows = sites.get(id) ?? [];
    if (!rows.some(row => row.id === pin.id)) rows.push(pin);
    sites.set(id, rows);
  }
  return [...sites].map(([id, offices]) => {
    offices.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const first = offices[0];
    const sameAddress = offices.every(office => addressKey(office.address) === addressKey(first.address));
    return { id, name: offices.length === 1 ? first.name : sameAddress ? `Offices at ${first.address}` : "Offices",
      address: sameAddress ? first.address : null, lat: first.lat, lng: first.lng, offices };
  });
}
