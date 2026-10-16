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
export interface CachedLegistarMembers {
  readonly signature: string;
  readonly collectedAt: string;
  read(): Promise<LegistarMembers>;
}

export function legistarMemberSignature(raw: Pick<LegistarMembers, "bodies" | "persons" | "offices">): string {
  const hash = createHash("sha256");
  for (const [rows, idKey, versionKey] of [[raw.bodies, "BodyId", "BodyRowVersion"], [raw.persons, "PersonId", "PersonRowVersion"],
    [raw.offices, "OfficeRecordId", "OfficeRecordRowVersion"]] as const) {
    hash.update("[");
    for (const row of rows) {
      const fields = row as unknown as Record<string, unknown>, version = fields[versionKey];
      if (typeof version !== "string" || !version) throw new Error("LEGISTAR_MEMBERS_VERSION_MISSING");
      hash.update(JSON.stringify([fields[idKey], version]));
    }
    hash.update("]");
  }
  return hash.digest("hex");
}

export function makeLegistarMembersReader(fetchImpl?: typeof fetch, initial: CachedLegistarMembers | null = null) {
  let held = initial;
  return async (slug: string, signal?: AbortSignal): Promise<LegistarMembers> => {
    const readings: LegistarMembers["readings"] = [];
    const options = { fetchImpl, signal, onRead: (reading: LegistarMembers["readings"][number]) => readings.push(reading) };
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const officeFilter = `(OfficeRecordEndDate eq null or OfficeRecordEndDate ge datetime'${day}T00:00:00')`;
    const people = async (personIds: readonly number[], select?: readonly string[]) => {
      const persons: MemberPerson[] = [];
      for (let offset = 0; offset < Math.max(1, personIds.length); offset += 100) {
        const ids = personIds.slice(offset, offset + 100);
        persons.push(...await fetchPersons<MemberPerson>(slug, { ...options, select,
          filter: `(${ids.length ? ids.map(id => `PersonId eq ${id}`).join(" or ") : "PersonId eq 0"})` }));
      }
      return persons.sort((a, b) => a.PersonId - b.PersonId);
    };
    const probe = async () => {
      const bodies = await fetchBodies<MemberBody>(slug, { ...options, select: ["BodyId", "BodyRowVersion"] });
      const offices = await fetchOfficeRecords<MemberOffice>(slug, { ...options, filter: officeFilter,
        select: ["OfficeRecordId", "OfficeRecordPersonId", "OfficeRecordRowVersion"] });
      const personIds = [...new Set(offices.map(office => office.OfficeRecordPersonId))].sort((a, b) => a - b);
      if (personIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("LEGISTAR_MEMBERS_PERSON_ID_MISSING");
      const persons = await people(personIds, ["PersonId", "PersonRowVersion"]);
      return { signature: legistarMemberSignature({ bodies, persons, offices }), personIds };
    };
    const { signature, personIds } = await probe();
    if (held?.signature === signature) {
      const previous = await held.read();
      if (previous.slug !== slug) throw new Error("LEGISTAR_MEMBERS_CACHE_TENANT_INVALID");
      previous.readings = previous.readings.filter(reading => !new URL(reading.url).searchParams.has("$select"));
      previous.readings.push(...readings);
      return previous;
    }
    held = null;
    readings.length = 0;
    const result = { slug, signature, collectedAt: new Date().toISOString(), readings,
      bodies: await fetchBodies<MemberBody>(slug, options),
      persons: await people(personIds),
      offices: await fetchOfficeRecords<MemberOffice>(slug, { ...options, filter: officeFilter }) };
    validateLegistarMembers(result);
    if (legistarMemberSignature(result) !== signature) throw new Error("LEGISTAR_MEMBERS_CHANGED_DURING_READ");
    held = { signature, collectedAt: result.collectedAt, read: async () => result };
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

const sourcePages = new WeakMap<LegistarMembers, Map<string, string>>();

export function memberSourceUrl(raw: LegistarMembers, collection: string, key: string, id?: number): string {
  let pages = sourcePages.get(raw);
  if (!pages) {
    pages = new Map();
    for (const reading of raw.readings) {
      const url = new URL(reading.url), collection = url.pathname.split("/").at(-1)!;
      if (url.pathname !== `/v1/${raw.slug}/${collection}` || url.searchParams.has("$select")) continue;
      const rows = JSON.parse(reading.text);
      if (!Array.isArray(rows)) throw new Error("LEGISTAR_MEMBERS_SOURCE_PAGE_INVALID");
      if (!pages.has(collection)) pages.set(collection, reading.url);
      for (const row of rows) for (const key of ["BodyId", "PersonId", "OfficeRecordId"]) {
        if (row[key] !== undefined) pages.set(`${collection}:${key}:${row[key]}`, reading.url);
      }
    }
    sourcePages.set(raw, pages);
  }
  const url = pages.get(id === undefined ? collection : `${collection}:${key}:${id}`);
  if (!url) throw new Error("LEGISTAR_MEMBERS_SOURCE_PAGE_MISSING");
  return url;
}

export function* legistarMemberRosters(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string, pageUrl?: string): Generator<BodyRoster> {
  validateLegistarMembers(raw);
  const persons = new Map(raw.persons.map(person => [person.PersonId, person]));
  for (const wiring of rows.filter(row => row.config.slug === raw.slug)) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: wiring.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const nativeId = Number(wiring.config.eventBodyId);
    const body = raw.bodies.find(body => body.BodyId === nativeId);
    if (!body) throw new Error(`LEGISTAR_MEMBERS_BODY_UNBOUND:${wiring.bodyId}`);
    const sourceUrl = memberSourceUrl(raw, "officerecords", "OfficeRecordId");
    const members: RosterMember[] = [];
    for (const office of raw.offices) {
      if (office.OfficeRecordBodyId !== nativeId || pageUrl && memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId) !== pageUrl) continue;
      const termStart = termDate(office.OfficeRecordStartDate), termEnd = termDate(office.OfficeRecordEndDate);
      if ((termStart && termStart > today) || (termEnd && termEnd < today)) continue;
      const person = persons.get(office.OfficeRecordPersonId);
      const name = office.OfficeRecordFullName?.trim();
      const officeTitle = office.OfficeRecordTitle?.trim() || office.OfficeRecordMemberType?.trim();
      if (!name || !officeTitle) throw new Error("LEGISTAR_MEMBERS_MINIMUMS_MISSING");
      const source = { kind: "OFFICIAL" as const, sourceUrl: memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId), sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, verifiedAt: raw.collectedAt };
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
    yield { bodyId: wiring.bodyId, bodyName: body.BodyName, members, sourceUrl,
      sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, kind: "OFFICIAL", partisanship: "UNDETERMINED" };
  }
}
