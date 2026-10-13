import type { Officeholder, OfficeholderSet, PersonMembership, SeatVacancy } from "../../officials/types.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { Provenance } from "../types.ts";
import { SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL, HOUSE_ROSTER_URL } from "./targets.ts";
import { parseSenateServiceTable } from "./senate-vacancies.ts";
export { OFFICIAL_FEDERAL_TARGETS, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL, HOUSE_ROSTER_URL } from "./targets.ts";

export interface OfficialRosterDocument { readonly url: string; readonly body: string; readonly retrievedAt?: string; readonly checkedAt?: string }
function invalid(detail: string): never { throw new Error(`OFFICIAL_FEDERAL_ROSTER_INVALID:${detail}`); }
function decoded(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) =>
    String.fromCodePoint(n.startsWith("x") ? Number.parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}
function tag(row: string, key: string): string {
  const matches = [...row.matchAll(new RegExp(`<${key}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${key}\\s*>|<${key}(?:\\s[^>]*)?\\s*\\/>`, "g"))];
  if (matches.length > 1) invalid(`duplicate ${key}`);
  return decoded(matches[0]?.[1] ?? "");
}
function xmlRows(body: string, root: string, container?: string): string[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || !new RegExp(`<${root}(?:\\s[^>]*)?>`).test(body) ||
    !new RegExp(`<\\/${root}\\s*>\\s*$`).test(body)) invalid(`missing complete ${root} document`);
  const section = container ? new RegExp(`<${container}>([\\s\\S]*?)<\\/${container}>`).exec(body)?.[1] : body;
  if (!section) invalid(`missing ${container}`);
  const rows = [...section.matchAll(/<member>([\s\S]*?)<\/member>/g)].map(match => match[1]!);
  if (!rows.length || rows.length !== (section.match(/<member(?:\s|>)/g)?.length ?? 0)) invalid("member enumeration does not reconcile");
  return rows;
}
function stateDivision(state: string): string {
  const entry = Object.values(FIPS_TO_STATE).find(value => value.postal === state);
  if (!entry) invalid(`unknown source state ${state}`);
  return `ocd-division/country:us/${entry.prefix}:${state.toLowerCase()}`;
}
function source(url: string, publisher: string, at: string): Provenance {
  return { sourceUrl: url, sourceOrg: publisher, collectedAt: at, verifiedAt: at };
}
function publishedUrl(value: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function member(input: {bioguide: string; name: string; state: string; chamber: "senate" | "house";
  officeId: string; divisionId: string; party: string; phone: string; sourceUrl: string; publisher: string; at: string;
  termStart?: string; website?: string | null; contactForm?: string | null; district?: string}): Officeholder {
  if (!/^[A-Z]\d{6}$/.test(input.bioguide) || !input.name) invalid(`missing official identity for ${input.officeId}`);
  const id = `congress:${input.bioguide}`;
  const provenance = source(input.sourceUrl, input.publisher, input.at);
  const officeTitle = input.chamber === "senate" ? "U.S. Senator" : input.state === "PR" ? "Resident Commissioner"
    : ["AS", "DC", "GU", "MP", "VI"].includes(input.state) ? "Delegate to the U.S. House" : "U.S. Representative";
  return { id, personId: id, nativeIds: { bioguide: [input.bioguide], congress: [input.bioguide],
    [input.chamber === "senate" ? "us-senate" : "us-house-clerk"]: [input.bioguide] },
    memberships: [{ id: `${input.officeId}:${input.bioguide}`, personId: id, officeId: input.officeId,
      jurisdiction: "US", chamber: input.chamber === "senate" ? "sen" : "rep", district: input.district,
      divisionId: input.divisionId, officeTitle, level: "FEDERAL", current: true,
      termStart: input.termStart || null, sourceUrl: input.sourceUrl }],
    name: input.name, officeTitle, level: "FEDERAL", termStart: input.termStart ?? "", termEnd: "", birthDate: null,
    partyLabel: input.party || null, websiteUrl: input.website ?? null, contactFormUrl: input.contactForm ?? null,
    phone: input.phone || null, email: null, campaignUrl: null, photo: null, state: input.state, chamber: input.chamber, provenance };
}
function exactDate(value: string): string | null {
  const date = /^\d{8}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date ? date : null;
}
function xmlDate(row: string, key: string): string | null {
  const date = new RegExp(`<${key}\\b[^>]*\\bdate=["']([^"']*)["']`).exec(row)?.[1];
  if (date && !exactDate(date)) invalid(`invalid official ${key}`);
  return date ? exactDate(date) : null;
}
/** Current appointees join only by the Senate's exact Bioguide ID. An older
 * appointment followed by election does not describe the current term. */
export function parseSenateAppointments(body: string): ReadonlyMap<string, { appointed: string; sworn: string | null }> {
  const table = /<table\b[^>]*\bid=["']SortableData_table["'][^>]*>([\s\S]*?)<\/table>/i.exec(body)?.[1];
  if (!table || !/appointment/i.test(body)) invalid("Senate appointment table missing");
  const result = new Map<string, { appointed: string; sworn: string | null }>();
  const months: Record<string, string> = {Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
  const date = (cell: string): string | null => {
    // Hidden sort values are not dates: the publisher currently has 20260334
    // behind a visible Mar 24, 2026. Read its displayed date instead.
    const visible = decoded(cell.replace(/<span\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/span>/gi, "").replace(/<[^>]*>/g, " "));
    const match = /\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\b/.exec(visible);
    return match && months[match[1]!] ? exactDate(`${match[3]}-${months[match[1]!]}-${match[2]!.padStart(2,"0")}`) : null;
  };
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(value=>value[1]!);
    const id = /(?:index=|[/?])([A-Z]\d{6})(?:["'&<>]|$)/.exec(cells[0] ?? "")?.[1];
    if (!id || cells.length !== 4) continue;
    const subsequentlyElected = decoded(cells[3]!.replace(/<[^>]*>/g, " ")).replace(/\s+/g," ");
    if (!/font-weight\s*:\s*bold/i.test(cells[0]!) || subsequentlyElected !== "--") continue;
    const appointed = date(cells[1]!);
    if (!appointed) continue;
    result.set(id, { appointed, sworn: date(cells[2]!) });
  }
  if (!result.size) invalid("Senate appointment table has no exact identities and dates");
  return result;
}
export function parseSenateRoster(documents: readonly OfficialRosterDocument[], retrievedAt: string): OfficeholderSet {
  const document = documents.find(row=>row.url === SENATE_ROSTER_URL);
  if (!document) invalid("Senate XML missing");
  const at = document.retrievedAt ?? retrievedAt;
  const rows = xmlRows(document.body, "contact_information");
  const appointmentDocument = documents.find(row=>row.url === SENATE_APPOINTMENTS_URL);
  const appointments = appointmentDocument ? parseSenateAppointments(appointmentDocument.body) : new Map();
  let officeholders: Officeholder[] = [];
  const vacancies: SeatVacancy[] = [], divisions: OfficeholderSet["divisions"] = [], endedMemberships: PersonMembership[] = [];
  const seats = new Set<string>(), ids = new Set<string>();
  for (const row of rows) {
    const state = tag(row,"state"), classMatch = /^Class (I|II|III)$/.exec(tag(row,"class"));
    if (!classMatch || !Object.values(FIPS_TO_STATE).some(value=>value.postal===state && value.prefix==="state")) invalid("Senate row lacks exact state and class");
    const seatClass = {I:1,II:2,III:3}[classMatch[1] as "I"|"II"|"III"];
    const officeId = `US:sen:${state}:${seatClass}`, divisionId = stateDivision(state);
    if (seats.has(officeId)) invalid(`duplicate Senate seat ${officeId}`);
    seats.add(officeId);
    const bioguide = tag(row,"bioguide_id"), name = [tag(row,"first_name"),tag(row,"last_name")].filter(Boolean).join(" ");
    if (!bioguide && /\bvacan(?:t|cy)\b/i.test(decoded(row.replace(/<[^>]*>/g," ")))) {
      vacancies.push({id:officeId,divisionId,officeTitle:"U.S. Senator",state,chamber:"senate",since:null,provenance:source(document.url,"United States Senate",at)});
      continue;
    }
    const appointment = appointments.get(bioguide);
    const person = member({bioguide,name,state,chamber:"senate",officeId,divisionId,party:tag(row,"party"),phone:tag(row,"phone"),
      sourceUrl:document.url,publisher:"United States Senate",at,website:publishedUrl(tag(row,"website")),
      contactForm:publishedUrl(tag(row,"email")),termStart:appointment?.sworn ?? appointment?.appointed ?? ""});
    if (appointment && appointmentDocument) person.fieldSources = {termStart:source(appointmentDocument.url,"United States Senate",appointmentDocument.retrievedAt ?? retrievedAt)};
    if (ids.has(person.id)) invalid(`duplicate Senate identity ${person.id}`);
    ids.add(person.id); officeholders.push(person); divisions.push({officeholderId:person.id,ocdId:divisionId,bodyId:null,membershipId:person.memberships![0]!.id});
  }
  const asOf=documents.flatMap(row=>row.checkedAt?[row.checkedAt]:[]).sort().at(-1) ?? retrievedAt;
  for(const service of documents.filter(row=>/^https:\/\/www\.senate\.gov\/states\/[A-Z]{2}\/senators\.htm$/.test(row.url))){
    const evidence=parseSenateServiceTable(service,asOf);
    endedMemberships.push(...evidence.endedMemberships);
    for(const seat of evidence.seats){
      if(!seat.present || !seat.bioguide || !seat.name || !seat.since)continue;
      const successorId=`congress:${seat.bioguide}`;
      const incumbent=officeholders.find(row=>row.memberships?.some(membership=>membership.officeId===seat.officeId));
      if(incumbent?.id===successorId)continue;
      const existingVacancy=vacancies.findIndex(row=>row.id===seat.officeId);
      if(incumbent){
        const departed=evidence.endedMemberships.find(row=>row.officeId===seat.officeId && row.personId===incumbent.id && row.termEnd && row.termEnd<=seat.since!);
        // The exact former person may have returned for a newer tenure.
        const incumbentStart=incumbent.memberships?.find(row=>row.officeId===seat.officeId)?.termStart;
        if(!departed || incumbentStart && incumbentStart>departed.termEnd!)continue;
      }else if(existingVacancy<0 || (vacancies[existingVacancy]!.since
        ? vacancies[existingVacancy]!.since!>=seat.since
        : Date.parse(service.retrievedAt ?? retrievedAt)<Date.parse(at)))continue;
      if(officeholders.some(row=>row.id===successorId))invalid(`duplicate Senate identity ${successorId}`);
      const appointment=appointments.get(seat.bioguide);
      const divisionId=stateDivision(seat.state);
      const successor=member({bioguide:seat.bioguide,name:seat.name,state:seat.state,chamber:"senate",officeId:seat.officeId,divisionId,
        party:"",phone:"",sourceUrl:service.url,publisher:"United States Senate",at:service.retrievedAt ?? retrievedAt,
        termStart:appointment?.sworn ?? appointment?.appointed ?? seat.since});
      successor.provenance.evidenceExcerpt=seat.excerpt;
      if(appointment && appointmentDocument)successor.fieldSources={termStart:source(appointmentDocument.url,"United States Senate",appointmentDocument.retrievedAt ?? retrievedAt)};
      if(incumbent)officeholders=officeholders.filter(row=>row.id!==incumbent.id);
      if(existingVacancy>=0)vacancies.splice(existingVacancy,1);
      officeholders.push(successor);
      divisions.push({officeholderId:successor.id,ocdId:divisionId,bodyId:null,membershipId:successor.memberships![0]!.id});
    }
    for(const vacancy of evidence.vacancies){
      const departed=evidence.endedMemberships.filter(row=>row.officeId===vacancy.id).map(row=>row.personId);
      const incumbent=officeholders.find(row=>row.memberships?.some(membership=>membership.officeId===vacancy.id));
      // A newer occupant in the exact seat closes an older service-table gap.
      if(incumbent && !departed.includes(incumbent.id))continue;
      if(incumbent)officeholders=officeholders.filter(row=>row.id!==incumbent.id);
      const existing=vacancies.findIndex(row=>row.id===vacancy.id);
      if(existing<0)vacancies.push(vacancy);else vacancies[existing]=vacancy;
    }
  }
  const currentIds=new Set(officeholders.map(row=>row.id));
  const currentSeats=new Set([...officeholders.flatMap(row=>row.memberships?.map(membership=>membership.officeId) ?? []),...vacancies.map(row=>row.id)]);
  const complete=currentSeats.size===100 && Object.values(FIPS_TO_STATE).filter(value=>value.prefix==="state").every(value=>
    [...currentSeats].filter(id=>id.startsWith(`US:sen:${value.postal}:`)).length===2);
  return {scope:"us",generatedAt:at,officeholders,divisions:divisions.filter(row=>currentIds.has(row.officeholderId)),vacancies,endedMemberships,unmatched:[],currentMembershipComplete:complete,coveredChambers:complete?["senate"]:[]};
}

export function parseHouseRoster(documents: readonly OfficialRosterDocument[], retrievedAt: string): OfficeholderSet {
  const document = documents.find(row=>row.url === HOUSE_ROSTER_URL);
  if (!document) invalid("House member XML missing");
  const at = document.retrievedAt ?? retrievedAt, rows = xmlRows(document.body,"MemberData","members");
  const officeholders: Officeholder[] = [], vacancies: SeatVacancy[] = [], divisions: OfficeholderSet["divisions"] = [], endedMemberships: PersonMembership[] = [];
  const seats = new Set<string>(), ids = new Set<string>(), stateDistricts = new Map<string, Set<number>>();
  for (const row of rows) {
    const statedistrict = /^([A-Z]{2})(\d{2})$/.exec(tag(row,"statedistrict"));
    const info = /<member-info>([\s\S]*?)<\/member-info>/.exec(row)?.[1];
    if (!statedistrict || !info) invalid("House row lacks member-info and exact state/district");
    // The Clerk's American Samoa seat code is AQ00; its state field explicitly
    // supplies AS. Preserve that exact published crosswalk rather than joining
    // any territory by its displayed name.
    const state = statedistrict[1] === "AQ" ? "AS" : statedistrict[1]!, district = Number(statedistrict[2]);
    const postal = /<state\s+postal-code=["']([A-Z]{2})["']/.exec(info)?.[1];
    if (postal!==state) invalid("House state/district disagrees with state field");
    const divisionId = `${stateDivision(state)}/cd:${district===0 || ["AS","DC","GU","MP","PR","VI"].includes(state)?"at-large":district}`;
    const officeId = `US:rep:${state}:${district}`;
    if (seats.has(officeId)) invalid(`duplicate House seat ${officeId}`);
    seats.add(officeId);
    const districts = stateDistricts.get(state) ?? new Set<number>(); districts.add(district); stateDistricts.set(state,districts);
    const predecessor = /<predecessor-info\b[^>]*>([\s\S]*?)<\/predecessor-info>/.exec(row)?.[1];
    const vacatedAt = predecessor ? xmlDate(predecessor,"pred-vacate-date") : null;
    const departed = predecessor ? tag(predecessor,"pred-memindex") : "";
    if (departed && /^[A-Z]\d{6}$/.test(departed) && vacatedAt) endedMemberships.push({id:`${officeId}:${departed}`,personId:`congress:${departed}`,officeId,
      jurisdiction:"US",chamber:"rep",district:String(district),divisionId,current:false,termEnd:vacatedAt,sourceUrl:document.url});
    const bioguide = tag(info,"bioguideID"), name = tag(info,"official-name");
    if (!bioguide && !name) {
      if (!/\bvacancy\b/i.test(tag(info,"footnote")) || !vacatedAt || !departed) invalid(`blank House identity lacks explicit vacancy evidence for ${officeId}`);
      const provenance = {...source(document.url,"Clerk of the United States House of Representatives",at),evidenceExcerpt:tag(info,"footnote")};
      vacancies.push({id:officeId,divisionId,officeTitle:"U.S. Representative",state,chamber:"house",since:vacatedAt,provenance});
      continue;
    }
    const person = member({bioguide,name,state,chamber:"house",officeId,divisionId,district:String(district),party:tag(info,"party"),phone:tag(info,"phone"),
      sourceUrl:document.url,publisher:"Clerk of the United States House of Representatives",at,termStart:xmlDate(info,"sworn-date") ?? ""});
    if (ids.has(person.id)) invalid(`duplicate House identity ${person.id}`);
    ids.add(person.id); officeholders.push(person); divisions.push({officeholderId:person.id,ocdId:divisionId,bodyId:null,membershipId:person.memberships![0]!.id});
  }
  // The Clerk publishes each of the 435 voting seats and six delegate seats,
  // including explicit blank vacancy records. A truncated subset can add
  // independently identified facts, but cannot retire omitted members.
  const complete = rows.length===441 && [...stateDistricts.values()].every(districts=>districts.has(0)?districts.size===1:
    [...districts].every(district=>district>=1 && district<=districts.size)) &&
    Object.values(FIPS_TO_STATE).every(value=>stateDistricts.has(value.postal));
  return {scope:"us",generatedAt:at,officeholders,divisions,vacancies,endedMemberships,unmatched:[],currentMembershipComplete:complete,coveredChambers:complete?["house"]:[]};
}
