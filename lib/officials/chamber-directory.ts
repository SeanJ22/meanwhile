import { decodeEntities } from "../extract/visible-text.ts";
import type { FederalDirectoryReadModel, OfficialChamberMember, OfficialChamberRoster } from "./federal-directory-data-plane.ts";
import type { Officeholder, OfficeholderSet, SeatVacancy } from "./types.ts";
import { districtIdentity, FIPS_TO_STATE } from "../ocd/fips.ts";

export const CHAMBER_DIRECTORY_URLS = {
  house: "https://clerk.house.gov/xml/lists/MemberData.xml",
  senate: "https://www.senate.gov/general/contact_information/senators_cfm.xml",
} as const;
export interface ChamberCapture {
  readonly finalUrl: string;
  readonly body: string;
  readonly retrievedAt: string;
}
const text = (xml: string, tag: string) => decodeEntities(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? "").trim();
const attribute = (xml: string, tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*\\b${name}=["']([^"']*)["']`).exec(xml)?.[1] ?? "";
const isoDate = (value: string) => /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
const publishedUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; } };
const buildings: Record<string, string> = { CHOB: "Cannon House Office Building", LHOB: "Longworth House Office Building", RHOB: "Rayburn House Office Building", FHOB: "Ford House Office Building" };
const NON_VOTING = new Set(["AS", "DC", "GU", "MP", "VI"]);

/** Explicit chamber identities join offices; an empty name alone never proves a vacancy. */
export function parseChamberDirectory(capture: ChamberCapture, state: string) {
  const jurisdiction = Object.entries(FIPS_TO_STATE).find(([, row]) => row.postal === state.replace(/^US-/i, "").toUpperCase());
  if (!jurisdiction) throw new Error("CHAMBER_DIRECTORY_STATE_INVALID");
  const house = capture.finalUrl === CHAMBER_DIRECTORY_URLS.house;
  if (!house && capture.finalUrl !== CHAMBER_DIRECTORY_URLS.senate) throw new Error("CHAMBER_DIRECTORY_SOURCE_INVALID");
  if (!capture.body.includes(house ? "<MemberData" : "<contact_information")) throw new Error("CHAMBER_DIRECTORY_XML_INVALID");
  const offices = new Map<string, NonNullable<Officeholder["offices"]>[number]>();
  const vacancies: SeatVacancy[] = [];
  const members: OfficialChamberMember[] = [];
  const occupied = new Set<string>();
  const sourceOrg = house ? "Office of the Clerk, U.S. House of Representatives" : "U.S. Senate";
  const stateDivision = `ocd-division/country:us/${jurisdiction[1].prefix}:${jurisdiction[1].postal.toLowerCase()}`;
  let rows = 0, stateRows = 0;
  for (const match of capture.body.matchAll(/<member(?:\s[^>]*)?>([\s\S]*?)<\/member>/g)) {
    rows++;
    const xml = match[1], district = text(xml, "statedistrict");
    // The Clerk's seat code for American Samoa is AQ00; its state field names the postal code.
    const postal = house ? attribute(xml, "state", "postal-code") || district.slice(0, 2) : text(xml, "state");
    if (postal !== jurisdiction[1].postal) continue;
    stateRows++;
    const id = text(xml, house ? "bioguideID" : "bioguide_id");
    const name = text(xml, house ? "official-name" : "member_full");
    const reason = text(xml, "footnote");
    const seat = house && /^[A-Z]{2}\d{2}$/.test(district) ? districtIdentity(jurisdiction[0], district.slice(2))?.ocdId ?? null : null;
    if (house && !id && !name && /^Vacancy due to /i.test(reason) && seat) {
      vacancies.push({ ocdId: seat, sourceUrl: capture.finalUrl, sourceOrg, collectedAt: capture.retrievedAt, reason,
        since: isoDate(attribute(xml, "pred-vacate-date", "date")), officeTitle: jurisdiction[1].postal === "PR" ? "Resident Commissioner"
          : NON_VOTING.has(jurisdiction[1].postal) ? "Delegate to the U.S. House" : "U.S. Representative" });
    }
    if (!/^[A-Z]\d{6}$/.test(id) || !name) continue;
    if (seat) occupied.add(seat);
    const ocdId = house ? seat : stateDivision;
    const fullName = house ? name : [text(xml, "first_name"), text(xml, "last_name")].filter(Boolean).join(" ");
    if (ocdId && fullName) members.push({ bioguide: id, name: fullName, ocdId, party: text(xml, "party") || null,
      phone: text(xml, "phone") || null, termStart: isoDate(attribute(xml, "sworn-date", "date")),
      websiteUrl: house ? null : publishedUrl(text(xml, "website")), contactFormUrl: house ? null : publishedUrl(text(xml, "email")) });
    const room = text(xml, "office-room"), building = text(xml, "office-building"), zip = text(xml, "office-zip");
    const address = house ? room && building && zip ? `${room} ${buildings[building] ?? building}, Washington, DC ${zip}` : "" : text(xml, "address");
    const phone = text(xml, "phone");
    if (address || phone) offices.set(`congress:${id}`, { id: `capitol:${id}`, name: "Capitol office", ...(address ? { address } : {}),
      ...(phone ? { phone } : {}), sourceUrl: capture.finalUrl, collectedAt: capture.retrievedAt });
  }
  if (!rows) throw new Error("CHAMBER_DIRECTORY_MEMBERS_MISSING");
  // Only a whole document checks seats; a cut-off list changes none.
  const whole = new RegExp(`</${house ? "MemberData" : "contact_information"}>\\s*$`).test(capture.body.trim());
  const roster: OfficialChamberRoster | null = stateRows && whole ? { chamber: house ? "house" : "senate", sourceUrl: capture.finalUrl, sourceOrg,
    collectedAt: capture.retrievedAt, members, vacantSeats: vacancies.map(row => row.ocdId) } : null;
  return { offices, vacancies, occupied, sourceOrg, roster };
}

function officialHolder(member: OfficialChamberMember, roster: OfficialChamberRoster, state: string): Officeholder {
  const id = `congress:${member.bioguide}`, provenance = { sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, collectedAt: roster.collectedAt, verifiedAt: roster.collectedAt, kind: "OFFICIAL" as const };
  const officeTitle = roster.chamber === "senate" ? "U.S. Senator" : state === "PR" ? "Resident Commissioner" : NON_VOTING.has(state) ? "Delegate to the U.S. House" : "U.S. Representative";
  const holder: Officeholder = { id, personId: id, nativeIds: { congress: [member.bioguide] }, name: member.name, officeTitle, level: "FEDERAL",
    termStart: member.termStart ?? "", termEnd: "", birthDate: null, partyLabel: member.party, websiteUrl: member.websiteUrl, contactFormUrl: member.contactFormUrl,
    phone: member.phone, email: null, campaignUrl: null, photo: null, state, chamber: roster.chamber, provenance };
  holder.fieldSources = Object.fromEntries((["name", "officeTitle", "termStart", "partyLabel", "websiteUrl", "contactFormUrl", "phone"] as const)
    .filter(field => holder[field]).map(field => [field, provenance]));
  return holder;
}

/** The chamber's own current list replaces the mirror's claim to a seat; it never joins two people by name. */
function withOfficialSeats(value: FederalDirectoryReadModel, state: string): FederalDirectoryReadModel {
  let roster: OfficeholderSet = value.roster;
  const byMember = { ...value.directory.byMember };
  for (const official of [value.chambers?.house, value.chambers?.senate]) {
    if (!official) continue;
    const seats = new Map<string, string | null>(official.vacantSeats.map(ocdId => [ocdId, null]));
    for (const member of official.members) seats.set(member.ocdId, member.bioguide);
    const current = new Set(official.members.map(member => `congress:${member.bioguide}`));
    const stale = new Set(roster.officeholders.filter(holder => holder.chamber === official.chamber && !current.has(holder.id) &&
      (official.chamber === "senate" || roster.divisions.some(link => link.officeholderId === holder.id && seats.has(link.ocdId)))).map(holder => holder.id));
    const held = new Set(roster.officeholders.map(holder => holder.id));
    const added = official.members.filter(member => !held.has(`congress:${member.bioguide}`)).map(member => officialHolder(member, official, state));
    for (const holder of added) byMember[holder.id.slice("congress:".length)] ??= { districtOffices: [], committees: [] };
    roster = { ...roster,
      officeholders: [...roster.officeholders.filter(holder => !stale.has(holder.id)), ...added],
      divisions: [...roster.divisions.filter(link => !stale.has(link.officeholderId)),
        ...added.map(holder => ({ officeholderId: holder.id, ocdId: official.members.find(member => `congress:${member.bioguide}` === holder.id)!.ocdId, bodyId: null }))],
      unmatched: roster.unmatched.filter(row => !stale.has(row.officeholderId)) };
  }
  return { ...value, roster, directory: { ...value.directory, byMember } };
}

/** Contacts, current seats and explicit vacancies attach independently; a failed feed retains each held fact. */
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
  const chambers = { ...value.chambers, ...prior?.chambers };
  for (const source of parsed) if (source.roster) chambers[source.roster.chamber] = source.roster;
  return withOfficialSeats({ ...value, roster: { ...value.roster, officeholders }, vacancies,
    ...(chambers.house || chambers.senate ? { chambers } : {}) }, state.replace(/^US-/i, "").toUpperCase());
}
