import type { RegistryProvenance } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import { isOnlineOnly } from "./online.ts";
import { readerBodyName, readerGovernmentName } from "../text/reader-names.ts";

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
}

export type PinBasis = "MEETING" | "BODY_OFFICE" | "GOVERNMENT_OFFICE";
export interface MeetingPinAddress {
  meetingId: string;
  bodyId?: string;
  name: string;
  address: string;
  basis: PinBasis;
  provenance: RegistryProvenance;
}
export interface MeetingPinLocation extends MeetingPinAddress {
  lat: number;
  lng: number;
  coordinateSourceUrl?: string;
  coordinateCheckedAt?: string;
  matchedAddress?: string;
  /** The source text tried before this saved point, including an absent venue. */
  publishedLocation?: string | null;
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
  if (body?.officeContact?.address)
    addresses.push({
      meetingId: meeting.id,
      bodyId: meeting.bodyId,
      name: readerBodyName(body.name ?? meeting.bodyName),
      address: body.officeContact.address,
      basis: "BODY_OFFICE",
      provenance: body.officeContact.provenance,
    });
  if (body?.governmentOffice)
    addresses.push({
      meetingId: meeting.id,
      bodyId: meeting.bodyId,
      name: readerGovernmentName(body.governmentOffice.name, null),
      address: body.governmentOffice.address,
      basis: "GOVERNMENT_OFFICE",
      provenance: body.governmentOffice.provenance,
    });
  return addresses;
}

export function pinBasisLabel(basis: PinBasis): string {
  return basis === "MEETING"
    ? "Published meeting location"
    : basis === "BODY_OFFICE"
      ? "Board’s office"
      : "Government’s office";
}
