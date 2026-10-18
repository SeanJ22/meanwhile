import { decodeEntities } from "../extract/visible-text.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import type { Officeholder } from "./types.ts";
import { districtIdentity, FIPS_TO_STATE } from "../ocd/fips.ts";

export const CHAMBER_DIRECTORY_URLS = {
  house: "https://clerk.house.gov/xml/lists/MemberData.xml",
  senate: "https://www.senate.gov/general/contact_information/senators_cfm.xml",
} as const;
export interface FederalVacancy {
  readonly ocdId: string;
  readonly sourceUrl: string;
  readonly sourceOrg: string;
  readonly collectedAt: string;
  readonly reason: string;
}
export interface ChamberCapture {
  readonly finalUrl: string;
  readonly body: string;
  readonly retrievedAt: string;
}
const text = (xml: string, tag: string) => decodeEntities(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? "").trim();
const buildings: Record<string, string> = { CHOB: "Cannon House Office Building", LHOB: "Longworth House Office Building", RHOB: "Rayburn House Office Building", FHOB: "Ford House Office Building" };

/** Explicit chamber identities join offices; an empty name alone never proves a vacancy. */
export function parseChamberDirectory(capture: ChamberCapture, state: string) {
  const jurisdiction = Object.entries(FIPS_TO_STATE).find(([, row]) => row.postal === state.replace(/^US-/i, "").toUpperCase());
  if (!jurisdiction) throw new Error("CHAMBER_DIRECTORY_STATE_INVALID");
  const house = capture.finalUrl === CHAMBER_DIRECTORY_URLS.house;
  if (!house && capture.finalUrl !== CHAMBER_DIRECTORY_URLS.senate) throw new Error("CHAMBER_DIRECTORY_SOURCE_INVALID");
  if (!capture.body.includes(house ? "<MemberData" : "<contact_information")) throw new Error("CHAMBER_DIRECTORY_XML_INVALID");
  const offices = new Map<string, NonNullable<Officeholder["offices"]>[number]>();
  const vacancies: FederalVacancy[] = [];
  const occupied = new Set<string>();
  let rows = 0;
  for (const match of capture.body.matchAll(/<member(?:\s[^>]*)?>([\s\S]*?)<\/member>/g)) {
    rows++;
    const xml = match[1], district = text(xml, "statedistrict");
    const postal = house ? district.slice(0, 2) : text(xml, "state");
    if (postal !== jurisdiction[1].postal) continue;
    const id = text(xml, house ? "bioguideID" : "bioguide_id");
    const name = text(xml, house ? "official-name" : "member_full");
    const sourceOrg = house ? "Office of the Clerk, U.S. House of Representatives" : "U.S. Senate";
    const reason = text(xml, "footnote");
    if (house && !id && !name && /^Vacancy due to /i.test(reason) && /^[A-Z]{2}\d{2}$/.test(district)) {
      vacancies.push({ ocdId: districtIdentity(jurisdiction[0], district.slice(2))!.ocdId,
        sourceUrl: capture.finalUrl, sourceOrg, collectedAt: capture.retrievedAt, reason });
    }
    if (!/^[A-Z]\d{6}$/.test(id) || !name) continue;
    if (house && /^[A-Z]{2}\d{2}$/.test(district)) occupied.add(districtIdentity(jurisdiction[0], district.slice(2))!.ocdId);
    const room = text(xml, "office-room"), building = text(xml, "office-building"), zip = text(xml, "office-zip");
    const address = house ? room && building && zip ? `${room} ${buildings[building] ?? building}, Washington, DC ${zip}` : "" : text(xml, "address");
    const phone = text(xml, "phone");
    if (address || phone) offices.set(`congress:${id}`, { id: `capitol:${id}`, name: "Capitol office", ...(address ? { address } : {}),
      ...(phone ? { phone } : {}), sourceUrl: capture.finalUrl, collectedAt: capture.retrievedAt });
  }
  if (!rows) throw new Error("CHAMBER_DIRECTORY_MEMBERS_MISSING");
  return { offices, vacancies, occupied, sourceOrg: house ? "Office of the Clerk, U.S. House of Representatives" : "U.S. Senate" };
}

/** Contacts and explicit vacancies attach independently; a failed feed retains each held fact. */
export function withChamberDirectories(value: FederalDirectoryReadModel, state: string, captures: readonly ChamberCapture[], prior?: FederalDirectoryReadModel | null): FederalDirectoryReadModel {
  const parsed = captures.map(capture => ({ capture, ...parseChamberDirectory(capture, state) }));
  const priorById = new Map(prior?.roster.officeholders.map(holder => [holder.id, holder]));
  const officeholders = value.roster.officeholders.map(holder => {
    const old = priorById.get(holder.id);
    let next = { ...holder, ...(old?.offices ? { offices: old.offices, fieldSources: { ...holder.fieldSources, ...(old.fieldSources?.offices ? { offices: old.fieldSources.offices } : {}) } } : {}) };
    for (const source of parsed) {
      const office = source.offices.get(holder.id);
      if (!office || (holder.chamber === "senate") !== (source.capture.finalUrl === CHAMBER_DIRECTORY_URLS.senate)) continue;
      const offices = [...next.offices ?? []].filter(row => row.id !== office.id);
      const previous = next.offices?.find(row => row.id === office.id);
      offices.push({ ...previous, ...office });
      next = { ...next, offices, fieldSources: { ...next.fieldSources, offices: { sourceUrl: source.capture.finalUrl,
        sourceOrg: source.sourceOrg, collectedAt: source.capture.retrievedAt, verifiedAt: source.capture.retrievedAt } } };
    }
    return next;
  });
  const house = parsed.find(source => source.capture.finalUrl === CHAMBER_DIRECTORY_URLS.house);
  const heldVacancies = prior?.vacancies ?? value.vacancies ?? [];
  const vacancies = house ? [...heldVacancies.filter(row => !house.occupied.has(row.ocdId) && !house.vacancies.some(fresh => fresh.ocdId === row.ocdId)), ...house.vacancies] : heldVacancies;
  return { ...value, roster: { ...value.roster, officeholders }, vacancies };
}
