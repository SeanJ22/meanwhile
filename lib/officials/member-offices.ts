/**
 * A state legislator's capitol and district offices. Open States offices are carried as it states them; where the
 * legislature's own roster holds a value for the same office, the official value wins. An office no official page
 * confirms is `official: false` and stays open as standing work.
 */
import type { DirectoryOffice } from "./directory.ts";
import type { Officeholder, OfficeholderDivision } from "./types.ts";
import { designationKey, rowsToPeople } from "../sources/plural/index.ts";

export type MemberOfficeKind = "CAPITOL" | "DISTRICT";

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

const familyName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, "").split(/\s+/).at(-1) ?? "";
const chamberOf = (ocdId: string) => /\/sldu:/.test(ocdId) ? "upper" : /\/sldl:/.test(ocdId) ? "lower" : null;
const districtOf = (ocdId: string) => /\/sld[ul]:([^/]+)$/.exec(ocdId)?.[1] ?? null;

/**
 * Open States offices joined to the legislature's own roster for one state.
 * `officials` is the roster the reader serves (its officeholders and their
 * divisions); its phone wins over Open States' for the capitol office.
 */
export function memberOfficeRecords(input: {
  readonly state: string;
  readonly csv: string;
  readonly collectedAt: string;
  readonly officials: { readonly officeholders: readonly Officeholder[]; readonly divisions: readonly OfficeholderDivision[] };
}): { readonly records: readonly MemberOfficeRecord[]; readonly unmatched: readonly string[] } {
  const state = input.state.toUpperCase();
  const seats = new Map<string, Officeholder[]>();
  for (const division of input.officials.divisions) {
    const chamber = chamberOf(division.ocdId), district = districtOf(division.ocdId);
    const holder = input.officials.officeholders.find(row => row.id === division.officeholderId);
    if (!chamber || !district || !holder) continue;
    const key = `${chamber}|${designationKey(district)}`;
    seats.set(key, [...seats.get(key) ?? [], holder]);
  }
  const records: MemberOfficeRecord[] = [], unmatched: string[] = [];
  for (const person of rowsToPeople(input.csv, input.state.toLowerCase())) {
    const offices = ([["CAPITOL", person.capitol_address, person.capitol_voice], ["DISTRICT", person.district_address, person.district_voice]] as const)
      .map(([kind, address, phone]) => ({ kind, address: address.trim(), phone: phone.trim() }))
      .filter(office => office.address || office.phone);
    if (!person.name || offices.length === 0) continue;
    // Same seat and the same family name: two members of one district are told apart by name, never guessed.
    const candidates = (seats.get(`${person.current_chamber}|${designationKey(person.current_district)}`) ?? [])
      .filter(holder => familyName(holder.name) === familyName(person.name));
    if (candidates.length !== 1) { unmatched.push(`${person.name} (${person.current_chamber} ${person.current_district})`); continue; }
    const holder = candidates[0];
    for (const office of offices) {
      // The legislature's own number wins for its capitol office.
      const officialPhone = office.kind === "CAPITOL" ? holder.phone : null;
      // One capitol and one district office per member, so the id names the office, never a list position.
      records.push({ id: `member-office:${holder.id}:${office.kind.toLowerCase()}`, kind: "MEMBER_OFFICE", officeholderId: holder.id,
        officeKind: office.kind, office: { ...parseOfficeAddress(office.address), phone: officialPhone || office.phone || null, lat: null, lng: null },
        sourceUrl: openStatesUrl(state), sourceOrg: OPEN_STATES_ORG, official: false, collectedAt: input.collectedAt });
    }
  }
  return { records, unmatched };
}

/** A member's offices from the held projection, capitol first. */
export function officesForMember(records: readonly MemberOfficeRecord[], officeholderId: string): readonly MemberOfficeRecord[] {
  return records.filter(row => row.officeholderId === officeholderId)
    .sort((a, b) => (a.officeKind === b.officeKind ? 0 : a.officeKind === "CAPITOL" ? -1 : 1));
}
