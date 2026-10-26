import type { RegistryProvenance } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import { isOnlineOnly } from "./online.ts";
import { readerBodyName, readerGovernmentName } from "../text/reader-names.ts";
import { censusAddressQuery } from "../geo/address-query.ts";

export interface MeetingPinBody {
  bodyId: string;
  name: string | null;
  officeContact?: {
    address: string | null;
    phone: string | null;
    provenance: RegistryProvenance;
  } | null;
  governmentOffice?: {
    name: string;
    address: string;
    provenance: RegistryProvenance;
  };
  governmentOfficeAlternatives?: NonNullable<MeetingPinBody["governmentOffice"]>[];
  meetingAddresses?: MeetingPinAddress[];
  postalAliases?: {address:string;provenance:RegistryProvenance}[];
}

export type PinBasis = "MEETING" | "BODY_OFFICE" | "GOVERNMENT_OFFICE";
export interface MeetingPinAddress {
  meetingId: string;
  bodyId?: string;
  name: string;
  address: string;
  basis: PinBasis;
  provenance: RegistryProvenance;
  geocodingAddress?:string;
  addressAlias?:{sourceAddress:string;provenance:RegistryProvenance};
}
export interface MeetingPinLocation extends MeetingPinAddress {
  lat: number;
  lng: number;
  coordinateSourceUrl?: string;
  coordinateCheckedAt?: string;
  matchedAddress?: string;
  /** The source text tried before this saved point, including an absent venue. */
  publishedLocation?: string | null;
  /** Normalized board-address inputs tried before a government-office fallback. */
  boardAddressQuery?: string | null;
}

/** Keep the current attendance text while reusing a checked point and any still-needed street address. */
export function publishedVenueDescription<T extends string|null>(text:string,previousAddress:T) {
  return {name:text,address:/^\d+[a-z]?(?:-\d+)?\s/i.test(censusAddressQuery(text))?text:previousAddress};
}

export function withPublishedPin(meeting: Meeting, pin: MeetingPinLocation): Meeting {
  if(pin.basis==="MEETING" && pin.publishedLocation && pin.publishedLocation!==pin.name && pin.publishedLocation!==pin.address) {
    const text=pin.publishedLocation;
    pin={...pin,...publishedVenueDescription(text,pin.address)};
  }
  return pin.basis === "MEETING" && !meeting.online
    ? {...meeting,mapPin:pin,location:{name:pin.name,address:pin.address,lat:pin.lat,lng:pin.lng},venueGap:undefined}
    : {...meeting,mapPin:pin};
}

/** Pins arrive with the published meeting. Reader visits perform no meeting-address lookups. */
export function publishedMeetingPins(
  meetings: readonly Meeting[],
): readonly MeetingPinLocation[] {
  return meetings.flatMap((meeting) =>
    meeting.mapPin ? [{ ...meeting.mapPin, meetingId: meeting.id }] : [],
  );
}

/** Published addresses in precedence order. A mailing address never substitutes for an office. */
export function meetingPinAddresses(
  meeting: Meeting,
  body?: MeetingPinBody,
): MeetingPinAddress[] {
  const addresses: MeetingPinAddress[] = [];
  const published =
    meeting.venueGap?.kind === "STATED_NOT_PLACED"
      ? meeting.venueGap.publishedText
      : null;
  if (!isOnlineOnly(meeting) && published?.trim())
    addresses.push({
      meetingId: meeting.id,
      bodyId: meeting.bodyId,
      name: published,
      address: published,
      basis: "MEETING",
      provenance: meeting.fieldSources?.location ?? meeting.provenance,
    });
  if(!isOnlineOnly(meeting))
    addresses.push(...body?.meetingAddresses?.filter(address=>address.meetingId===meeting.id)??[]);
  if (body?.officeContact?.address)
    addresses.push({
      meetingId: meeting.id,
      bodyId: meeting.bodyId,
      name: readerBodyName(body.name ?? meeting.bodyName),
      address: body.officeContact.address,
      basis: "BODY_OFFICE",
      provenance: body.officeContact.provenance,
    });
  for (const office of [body?.governmentOffice, ...body?.governmentOfficeAlternatives ?? []]) {
    if (!office) continue;
    addresses.push({
      meetingId: meeting.id,
      bodyId: meeting.bodyId,
      name: readerGovernmentName(office.name, null),
      address: office.address,
      basis: "GOVERNMENT_OFFICE",
      provenance: office.provenance,
    });
  }
  return addresses;
}

export function pinBasisLabel(basis: PinBasis): string {
  return basis === "MEETING"
    ? "Published meeting location"
    : basis === "BODY_OFFICE"
      ? "Board’s office"
      : "Government’s office";
}
