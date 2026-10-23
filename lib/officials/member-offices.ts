/**
 * A state legislator's capitol and district offices. Open States offices are carried as it states them; where the
 * legislature's own roster holds a value for the same office, the official value wins. An office no official page
 * confirms is `official: false` and stays open as standing work.
 */
import type { DirectoryOffice } from "./directory.ts";
import type { Officeholder } from "./types.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import type {PublishedOfficePoint} from "./office-points-publication.ts";
const readerOfficePoint = ({census:_evidence,...point}:PublishedOfficePoint):PublishedOfficePoint => point;

export type MemberOfficeKind = "CAPITOL" | "DISTRICT";
import { createHash } from "node:crypto";

export interface MemberOfficeRecord {
  readonly id: string;
  readonly kind: "MEMBER_OFFICE";
  /** The legislature's own roster id for the member the reader shows. */
  readonly officeholderId: string;
  readonly officeKind: MemberOfficeKind;
  readonly office: DirectoryOffice;
  /** The file or page this office was read from. */
  readonly sourceUrl: string;
  readonly sourceOrg: string;
  /** True only when an official government page states this office; false stays open as standing work. */
  readonly official: boolean;
  readonly collectedAt: string;
  readonly fieldSources?: Readonly<Record<string, import("../sources/types.ts").Provenance>>;
}

export const OPEN_STATES_ORG = "Open States (Plural, CC-0)";
export const openStatesUrl = (state: string) => `https://data.openstates.org/people/current/${state.toLowerCase()}.csv`;

/** "1 Main St Suite 2, Springfield, ST 00000" → street, city, state, ZIP. Unparsed text stays whole as the address. */
export function parseOfficeAddress(text: string): Pick<DirectoryOffice, "address" | "city" | "state" | "zip"> {
  const clean = text.replace(/\s*;\s*/g, ", ").replace(/\s+/g, " ").trim();
  const match = /^(.*?),\s*([^,]+?),\s*([A-Z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/.exec(clean);
  if (!match) return { address: clean || null, city: null, state: null, zip: null };
  return { address: match[1].trim(), city: match[2].trim(), state: match[3], zip: match[4] };
}

/** Rich native office arrays retain distinct district offices and per-field attribution. */
export function officeRecordsForHolder(holder: Officeholder, options:{readonly includePointEvidence?:boolean} = {}): readonly MemberOfficeRecord[] {
  const seen = new Set<string>();
  return (holder.offices ?? []).flatMap(office => {
    if (!office.address && !office.phone && !office.email) return [];
    const kind = /capitol|capital/i.test(office.name ?? "") ? "CAPITOL" : "DISTRICT";
    const officeKey = office.id ?? createHash("sha256").update(JSON.stringify([office.name ?? "",office.address ?? "",office.phone ?? "",...(office.email ? [office.email] : [])])).digest("hex").slice(0,20);
    if (seen.has(officeKey)) return [];
    seen.add(officeKey);
    const federal = holder.level === "FEDERAL";
    const officialPhone = !federal && kind === "CAPITOL" && holder.provenance.sourceOrg !== OPEN_STATES_ORG && !/plural|open states/i.test(holder.provenance.sourceOrg) ? holder.phone : null;
    return [{id:`member-office:${holder.id}:${officeKey}`,kind:"MEMBER_OFFICE" as const,officeholderId:holder.id,officeKind:kind,
      office:{...parseOfficeAddress(office.address ?? ""),phone:officialPhone || office.phone || null,...(office.email ? {email:office.email} : {}),lat:null,lng:null,
        ...(office.geocodedPoint ? {geocodedPoint:options.includePointEvidence ? office.geocodedPoint : readerOfficePoint(office.geocodedPoint)} : {}),
        ...(office.pointUnavailable ? {pointUnavailable:office.pointUnavailable} : {})},
      sourceUrl:office.sourceUrl,sourceOrg:federal ? holder.fieldSources?.offices?.sourceOrg ?? holder.provenance.sourceOrg : OPEN_STATES_ORG,
      official:federal && /^https:\/\/(?:[^/]+\.)?(?:house|senate|congress)\.gov\//.test(office.sourceUrl),collectedAt:office.collectedAt,
      ...(officialPhone ? {fieldSources:{phone:holder.fieldSources?.phone ?? holder.provenance}} : {})}];
  });
}

/** Native chamber offices and district-directory offices, from an already held state projection. */
export function federalOfficeRecordsForMember(value: FederalDirectoryReadModel, officeholderId: string): readonly MemberOfficeRecord[] {
  const holder = value.roster.officeholders.find(row => row.id === officeholderId);
  const source = holder?.fieldSources?.districtOffices;
  const district = (value.directory.byMember[officeholderId.slice(9)]?.districtOffices ?? []).map((office): MemberOfficeRecord => ({
    id:`member-office:${officeholderId}:${createHash("sha256").update(JSON.stringify(office)).digest("hex").slice(0,20)}`,
    kind:"MEMBER_OFFICE",officeholderId,officeKind:"DISTRICT",office:{...office,...(office.geocodedPoint?{geocodedPoint:readerOfficePoint(office.geocodedPoint)}:{})},
    sourceUrl:source?.sourceUrl ?? `https://raw.githubusercontent.com/unitedstates/congress-legislators/${value.directory.source.sha}/legislators-district-offices.yaml`,
    sourceOrg:source?.sourceOrg ?? value.directory.source.sourceOrg,official:false,
    collectedAt:source?.collectedAt ?? value.directory.source.collectedAt,
  }));
  return [...(holder ? officeRecordsForHolder(holder) : []),...district];
}

/** A member's offices from the held projection, capitol first. */
export function officesForMember(records: readonly MemberOfficeRecord[], officeholderId: string): readonly MemberOfficeRecord[] {
  return records.filter(row => row.officeholderId === officeholderId)
    .sort((a, b) => (a.officeKind === b.officeKind ? 0 : a.officeKind === "CAPITOL" ? -1 : 1));
}
