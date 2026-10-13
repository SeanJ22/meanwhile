import { createHash } from "node:crypto";
import type { BodyRoster, RosterMember } from "../../registry/body-rosters.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { isoTermDate } from "../../civic-data/term-dates.ts";
import { fetchBodies, fetchPersons, fetchOfficeRecords } from "./client.ts";

export interface MemberBody { BodyId: number; BodyName: string; BodyRowVersion: string; BodyActiveFlag?: number; BodyTypeName: string }
export interface MemberPerson { PersonId: number; PersonFullName: string; PersonRowVersion: string }
export interface MemberOffice {
  OfficeRecordId: number; OfficeRecordPersonId: number; OfficeRecordBodyId: number;
  OfficeRecordFullName: string; OfficeRecordTitle: string | null; OfficeRecordMemberType: string | null;
  OfficeRecordStartDate: string | null; OfficeRecordEndDate: string | null; OfficeRecordRowVersion: string;
}
export interface LegistarMembers {
  slug: string; bodies: MemberBody[]; persons: MemberPerson[]; offices: MemberOffice[];
  signature: string; collectedAt: string;
  readings: { url: string; text: string; retrievedAt: string }[];
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function legistarMemberSignature(raw: Pick<LegistarMembers, "bodies" | "persons" | "offices">): string {
  const versions = [raw.bodies.map(row => [row.BodyId, row.BodyRowVersion]), raw.persons.map(row => [row.PersonId, row.PersonRowVersion]),
    raw.offices.map(row => [row.OfficeRecordId, row.OfficeRecordRowVersion])];
  if (versions.flat().some(([, version]) => typeof version !== "string" || !version)) throw new Error("LEGISTAR_MEMBERS_VERSION_MISSING");
  return hash(versions);
}

export function makeLegistarMembersReader(fetchImpl?: typeof fetch, initial: LegistarMembers | null = null) {
  let held: LegistarMembers | null = initial;
  return async (slug: string, signal?: AbortSignal): Promise<LegistarMembers> => {
    const readings: LegistarMembers["readings"] = [];
    const options = { fetchImpl, signal, onRead: (reading: LegistarMembers["readings"][number]) => readings.push(reading) };
    const bodies = await fetchBodies<MemberBody>(slug, { ...options, select: ["BodyId", "BodyRowVersion"] });
    const persons = await fetchPersons<MemberPerson>(slug, { ...options, select: ["PersonId", "PersonRowVersion"] });
    const offices = await fetchOfficeRecords<MemberOffice>(slug, { ...options, select: ["OfficeRecordId", "OfficeRecordRowVersion"] });
    const signature = legistarMemberSignature({ bodies, persons, offices });
    const previous = held?.slug === slug ? held : null;
    const collectedAt = new Date().toISOString();
    if (previous?.signature === signature) {
      held = { ...previous, readings: [...previous.readings.filter(reading => !new URL(reading.url).searchParams.has("$select")), ...readings] };
      return held;
    }
    const result = { slug, signature, collectedAt, readings,
      bodies: await fetchBodies<MemberBody>(slug, options),
      persons: await fetchPersons<MemberPerson>(slug, options),
      offices: await fetchOfficeRecords<MemberOffice>(slug, options) };
    validateLegistarMembers(result);
    if (legistarMemberSignature(result) !== signature) throw new Error("LEGISTAR_MEMBERS_CHANGED_DURING_READ");
    held = result;
    return result;
  };
}

export function validateLegistarMembers(raw: LegistarMembers): void {
  const bodies = new Set(raw.bodies.map(body => body.BodyId)), persons = new Set(raw.persons.map(person => person.PersonId));
  if (bodies.size !== raw.bodies.length || persons.size !== raw.persons.length || new Set(raw.offices.map(office => office.OfficeRecordId)).size !== raw.offices.length) throw new Error("LEGISTAR_MEMBERS_DUPLICATE_ID");
  for (const body of raw.bodies) if (!body.BodyName?.trim()) throw new Error("LEGISTAR_MEMBERS_BODY_NAME_MISSING");
  for (const office of raw.offices) {
    const start = termDate(office.OfficeRecordStartDate), end = termDate(office.OfficeRecordEndDate);
    if (start && end && start > end) throw new Error("LEGISTAR_MEMBERS_TERM_REVERSED");
  }
}

function termDate(value: string | null): string | null {
  if (!value) return null;
  const date = isoTermDate(value.slice(0, 10));
  if (!date) throw new Error("LEGISTAR_MEMBERS_TERM_INVALID");
  return date;
}

export function memberSourceUrl(raw: LegistarMembers, collection: string, key: string, id?: number): string {
  const read = raw.readings.find(reading => {
    const url = new URL(reading.url);
    if (url.pathname !== `/v1/${raw.slug}/${collection}` || url.searchParams.has("$select")) return false;
    const rows = JSON.parse(reading.text);
    return Array.isArray(rows) && (id === undefined || rows.some(row => row[key] === id));
  });
  if (!read) throw new Error("LEGISTAR_MEMBERS_SOURCE_PAGE_MISSING");
  return read.url;
}

export function legistarMemberRosters(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string): BodyRoster[] {
  validateLegistarMembers(raw);
  const persons = new Map(raw.persons.map(person => [person.PersonId, person]));
  const rosters: BodyRoster[] = [];
  for (const wiring of rows.filter(row => row.config.slug === raw.slug)) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: wiring.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const nativeId = Number(wiring.config.eventBodyId);
    const body = raw.bodies.find(body => body.BodyId === nativeId);
    if (!body) throw new Error(`LEGISTAR_MEMBERS_BODY_UNBOUND:${wiring.bodyId}`);
    const sourceUrl = memberSourceUrl(raw, "officerecords", "OfficeRecordId");
    const members: RosterMember[] = [];
    for (const office of raw.offices.filter(office => office.OfficeRecordBodyId === nativeId)) {
      const termStart = termDate(office.OfficeRecordStartDate), termEnd = termDate(office.OfficeRecordEndDate);
      if ((termStart && termStart > today) || (termEnd && termEnd < today)) continue;
      const person = persons.get(office.OfficeRecordPersonId);
      const name = office.OfficeRecordFullName?.trim();
      const officeTitle = office.OfficeRecordTitle?.trim() || office.OfficeRecordMemberType?.trim();
      if (!name || !officeTitle) throw new Error("LEGISTAR_MEMBERS_MINIMUMS_MISSING");
      const source = { kind: "OFFICIAL" as const, sourceUrl: memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId), sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, verifiedAt: now };
      if (!Number.isSafeInteger(office.OfficeRecordPersonId) || office.OfficeRecordPersonId <= 0) throw new Error("LEGISTAR_MEMBERS_PERSON_ID_MISSING");
      const personId = `legistar:${raw.slug}:person:${office.OfficeRecordPersonId}`;
      members.push({ id: `${personId}:office:${office.OfficeRecordId}`, personId,
        sourceRecordId: `${sourceUrl}/${office.OfficeRecordId}`, nativeIds: { [`legistar:${raw.slug}`]: [String(office.OfficeRecordPersonId)] },
        name, officeTitle, termStart, termEnd, termNote: null, email: null, phone: null, websiteUrl: null,
        fieldSources: { name: { ...source, quote: office.OfficeRecordFullName },
          ...(person?.PersonFullName === name ? { personId: { ...source, sourceUrl: memberSourceUrl(raw, "persons", "PersonId", person.PersonId), quote: String(person.PersonId) } } : {}),
          officeTitle: { ...source, quote: officeTitle }, ...(termStart ? { termStart: { ...source, quote: office.OfficeRecordStartDate! } } : {}),
          ...(termEnd ? { termEnd: { ...source, quote: office.OfficeRecordEndDate! } } : {}) } });
    }
    rosters.push({ bodyId: wiring.bodyId, bodyName: body.BodyName, members, sourceUrl,
      sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, kind: "OFFICIAL", partisanship: "UNDETERMINED" });
  }
  return rosters;
}
