import { fromBodyOffice, fromMemberOffice, addressKey, type OfficeLocation } from "../officials/office-locations.ts";
import type { CoveredBody } from "../registry/coverage.ts";
import type { MemberDirectory } from "../../hooks/use-member-directory.ts";

export interface NamedOffice extends OfficeLocation { readonly name: string; readonly id: string }
export interface OfficePin extends NamedOffice { readonly lat: number; readonly lng: number }

/** Keys name the owner and published office, never a list position or a home. */
export function namedOffice(location: OfficeLocation, name: string): NamedOffice {
  return { ...location, name, id: `${location.ownerId}:${location.kind}:${addressKey(location.address)}` };
}
export function bodyOffice(body: CoveredBody): NamedOffice | null {
  const contact = body.officeContact;
  const location = contact && fromBodyOffice({ bodyId: body.bodyId, address: contact.address,
    phone: contact.phone, ...contact.provenance });
  return location ? namedOffice(location, body.name ?? body.divisionLabel) : null;
}
/** Only the office directory is consumed; candidate filing/mailing fields are not inputs. */
export function directoryOffices(ownerId: string, name: string, directory: MemberDirectory): NamedOffice[] {
  return directory.districtOffices.flatMap((office, index) => {
    const detail = directory.officeDetails?.[index];
    const source = detail ?? directory.source;
    if (!source) return [];
    const location = fromMemberOffice({ id: `${ownerId}:office:${index}`, kind: "MEMBER_OFFICE", officeholderId: ownerId,
      officeKind: detail?.officeKind ?? "DISTRICT", office, official: detail?.official ?? false,
      sourceUrl: detail?.sourceUrl ?? directory.source?.repoUrl ?? "", sourceOrg: source.sourceOrg, collectedAt: source.collectedAt });
    return location ? [namedOffice(location, name)] : [];
  });
}
export const OFFICE_KIND_LABEL = {
  DISTRICT_OFFICE: "District office", CAPITOL_OFFICE: "Capitol office", CAMPAIGN_OFFICE: "Campaign office",
  BODY_OFFICE: "Office", MEETING_PLACE: "Meeting place",
} as const;

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
