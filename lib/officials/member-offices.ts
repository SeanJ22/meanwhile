/**
 * A state legislator's capitol and district offices. Open States offices are carried as it states them; where the
 * legislature's own roster holds a value for the same office, the official value wins. An office no official page
 * confirms is `official: false` and stays open as standing work.
 */
import type { DirectoryOffice } from "./directory.ts";
import type { Officeholder, OfficeholderDivision } from "./types.ts";
import { rowsToPeople, normalize, type PluralPerson } from "../sources/plural/index.ts";

export type MemberOfficeKind = "CAPITOL" | "DISTRICT";
import { createHash } from "node:crypto";
import { sameNativePerson } from "./people-identity.ts";

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

/** Join only declared person identifiers. District and surname are never person identity. */
export function memberOfficeRecords(input: {
  readonly state: string;
  readonly csv?: string;
  readonly people?: readonly PluralPerson[];
  readonly collectedAt: string;
  readonly officials: { readonly officeholders: readonly Officeholder[]; readonly divisions: readonly OfficeholderDivision[] };
}): { readonly records: readonly MemberOfficeRecord[]; readonly unmatched: readonly string[] } {
  const people = input.people ?? (input.csv ? rowsToPeople(input.csv,input.state.toLowerCase()) : []);
  const references = normalize([...people],new Map(),input.collectedAt,input.state.toLowerCase()).officeholders;
  const records: MemberOfficeRecord[] = [], unmatched: string[] = [];
  for (const person of people) {
    const reference = references.find(row => row.nativeIds?.["ocd-person"]?.includes(person.id));
    const candidates = reference ? input.officials.officeholders.filter(row => sameNativePerson(row,reference)) : [];
    if (candidates.length !== 1) { unmatched.push(person.id); continue; }
    const holder = candidates[0]!;
    const offices = person.offices ?? [
      {name:"capitol",address:person.capitol_address,voice:person.capitol_voice},
      {name:"district",address:person.district_address,voice:person.district_voice},
    ];
    records.push(...officeRecordsForHolder({...holder,offices:offices.map(office=>({name:office.name,address:office.address,phone:office.voice,sourceUrl:person.sourceUrl ?? openStatesUrl(input.state),collectedAt:input.collectedAt}))}));
  }
  return {records,unmatched};
}

/** Rich native office arrays retain distinct district offices and per-field attribution. */
export function officeRecordsForHolder(holder: Officeholder): readonly MemberOfficeRecord[] {
  const seen = new Set<string>();
  return (holder.offices ?? []).flatMap(office => {
    if (!office.address && !office.phone && !office.email) return [];
    const kind = /capitol|capital/i.test(office.name ?? "") ? "CAPITOL" : "DISTRICT";
    const officeKey = office.id ?? createHash("sha256").update(JSON.stringify([office.name ?? "",office.address ?? "",office.phone ?? "",...(office.email ? [office.email] : [])])).digest("hex").slice(0,20);
    if (seen.has(officeKey)) return [];
    seen.add(officeKey);
    const officialPhone = kind === "CAPITOL" && holder.provenance.sourceOrg !== OPEN_STATES_ORG && !/plural|open states/i.test(holder.provenance.sourceOrg) ? holder.phone : null;
    return [{id:`member-office:${holder.id}:${officeKey}`,kind:"MEMBER_OFFICE" as const,officeholderId:holder.id,officeKind:kind,
      office:{...parseOfficeAddress(office.address ?? ""),phone:officialPhone || office.phone || null,...(office.email ? {email:office.email} : {}),lat:null,lng:null},
      sourceUrl:office.sourceUrl,sourceOrg:OPEN_STATES_ORG,official:false,collectedAt:office.collectedAt,
      ...(officialPhone ? {fieldSources:{phone:holder.fieldSources?.phone ?? holder.provenance}} : {})}];
  });
}

/** A member's offices from the held projection, capitol first. */
export function officesForMember(records: readonly MemberOfficeRecord[], officeholderId: string): readonly MemberOfficeRecord[] {
  return records.filter(row => row.officeholderId === officeholderId)
    .sort((a, b) => (a.officeKind === b.officeKind ? 0 : a.officeKind === "CAPITOL" ? -1 : 1));
}
