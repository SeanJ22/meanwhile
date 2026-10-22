import type { BodyRoster, RosterMember } from "../../registry/body-rosters.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { fetchBodies, fetchPersons, fetchOfficeRecords } from "./client.ts";
import { saveLegistarReading } from "./members-cache.ts";
import { legistarMemberSignature, validateLegistarMembers, termDate, memberProbe, type LegistarMembers, type CachedLegistarMembers, type MemberBody, type MemberPerson, type MemberOffice } from "./members-model.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";

/** Legistar refuses a filter of more than 100 expression nodes; 15 ids stay under it with the paging clause. */
const PERSON_IDS_PER_REQUEST = 15;

export function makeLegistarMembersReader(vault: EvidenceStore, fetchImpl?: typeof fetch, initial: CachedLegistarMembers | null = null) {
  let held = initial;
  return async (slug: string, signal?: AbortSignal): Promise<LegistarMembers> => {
    const readings: LegistarMembers["readings"] = [];
    const options = { fetchImpl, signal, onRead: async (reading: { url: string; text: string; retrievedAt: string; body: unknown }) => { readings.push(await saveLegistarReading(vault, slug, reading)); } };
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const officeFilter = `(OfficeRecordEndDate eq null or OfficeRecordEndDate ge datetime'${day}T00:00:00')`;
    const people = async (personIds: readonly number[], select?: readonly string[]) => {
      const persons: MemberPerson[] = [];
      for (let offset = 0; offset < Math.max(1, personIds.length); offset += PERSON_IDS_PER_REQUEST) {
        const ids = personIds.slice(offset, offset + PERSON_IDS_PER_REQUEST);
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
      previous.readings = previous.readings.filter(reading => !memberProbe(new URL(reading.artifact.canonicalUrl)));
      previous.readings.push(...readings);
      return previous;
    }
    held = null;
    readings.length = 0;
    const result = { slug, signature, collectedAt: new Date().toISOString(), readings,
      bodies: await fetchBodies<MemberBody>(slug, { ...options, select: ["BodyId", "BodyName", "BodyRowVersion"] }),
      persons: await people(personIds, ["PersonId", "PersonFullName", "PersonRowVersion"]),
      offices: await fetchOfficeRecords<MemberOffice>(slug, { ...options, filter: officeFilter,
        select: ["OfficeRecordId", "OfficeRecordPersonId", "OfficeRecordBodyId", "OfficeRecordFullName", "OfficeRecordTitle",
          "OfficeRecordMemberType", "OfficeRecordStartDate", "OfficeRecordEndDate", "OfficeRecordRowVersion"] }) };
    validateLegistarMembers(result);
    if (legistarMemberSignature(result) !== signature) throw new Error("LEGISTAR_MEMBERS_CHANGED_DURING_READ");
    held = { signature, collectedAt: result.collectedAt, read: async () => result };
    return result;
  };
}

const sourcePages = new WeakMap<LegistarMembers, Map<string, string>>();

export function memberSourceUrl(raw: LegistarMembers, collection: string, key: string, id?: number): string {
  let pages = sourcePages.get(raw);
  if (!pages) {
    pages = new Map();
    for (const reading of raw.readings) {
      const url = new URL(reading.artifact.canonicalUrl), collection = url.pathname.split("/").at(-1)!;
      if (url.pathname !== `/v1/${raw.slug}/${collection}` || memberProbe(url)) continue;
      const key = collection === "bodies" ? "BodyId" : collection === "persons" ? "PersonId" : "OfficeRecordId";
      if (!pages.has(collection)) pages.set(collection, reading.artifact.canonicalUrl);
      for (const id of reading.ids) pages.set(`${collection}:${key}:${id}`, reading.artifact.canonicalUrl);
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
  const days = new Map<string, string>();
  for (const wiring of rows.filter(row => row.config.slug === raw.slug)) {
    let today = days.get(wiring.timeZone);
    if (!today) {
      today = new Intl.DateTimeFormat("en-CA", { timeZone: wiring.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
      days.set(wiring.timeZone, today);
    }
    const nativeId = Number(wiring.config.eventBodyId);
    const body = raw.bodies.find(body => body.BodyId === nativeId);
    if (!body) throw new Error(`LEGISTAR_MEMBERS_BODY_UNBOUND:${wiring.bodyId}`);
    const sourceUrl = memberSourceUrl(raw, "officerecords", "OfficeRecordId");
    const members: RosterMember[] = [];
    // One seat per person on a body: when several current records overlap, the most recently started one speaks for the person.
    const seats = new Map<number, { office: MemberOffice; termStart: string | null; termEnd: string | null }>();
    for (const office of raw.offices) {
      if (office.OfficeRecordBodyId !== nativeId) continue;
      const termStart = termDate(office.OfficeRecordStartDate), termEnd = termDate(office.OfficeRecordEndDate);
      if ((termStart && termStart > today) || (termEnd && termEnd < today)) continue;
      const held = seats.get(office.OfficeRecordPersonId);
      if (!held || (termStart ?? "") > (held.termStart ?? "") || (termStart ?? "") === (held.termStart ?? "") && office.OfficeRecordId > held.office.OfficeRecordId) {
        seats.set(office.OfficeRecordPersonId, { office, termStart, termEnd });
      }
    }
    for (const { office, termStart, termEnd } of seats.values()) {
      if (pageUrl && memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId) !== pageUrl) continue;
      const person = persons.get(office.OfficeRecordPersonId);
      const name = office.OfficeRecordFullName?.trim();
      const officeTitle = office.OfficeRecordTitle?.trim() || office.OfficeRecordMemberType?.trim() || "";
      if (!name) continue;
      const source = { kind: "OFFICIAL" as const, sourceUrl: memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId), sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, verifiedAt: raw.collectedAt };
      if (!Number.isSafeInteger(office.OfficeRecordPersonId) || office.OfficeRecordPersonId <= 0) throw new Error("LEGISTAR_MEMBERS_PERSON_ID_MISSING");
      const personId = `legistar:${raw.slug}:person:${office.OfficeRecordPersonId}`;
      members.push({ id: `${personId}:office:${office.OfficeRecordId}`, personId,
        sourceRecordId: `${sourceUrl}/${office.OfficeRecordId}`, nativeIds: { [`legistar:${raw.slug}`]: [String(office.OfficeRecordPersonId)] },
        name, officeTitle, termStart, termEnd, termNote: null, email: null, phone: null, websiteUrl: null,
        fieldSources: { name: { ...source, quote: office.OfficeRecordFullName },
          ...(person?.PersonFullName === name ? { personId: { ...source, sourceUrl: memberSourceUrl(raw, "persons", "PersonId", person.PersonId), quote: String(person.PersonId) } } : {}),
          ...(officeTitle ? { officeTitle: { ...source, quote: officeTitle } } : {}), ...(termStart ? { termStart: { ...source, quote: office.OfficeRecordStartDate! } } : {}),
          ...(termEnd ? { termEnd: { ...source, quote: office.OfficeRecordEndDate! } } : {}) } });
    }
    yield { bodyId: wiring.bodyId, bodyName: body.BodyName, members, sourceUrl,
      sourceOrg: wiring.publishingOrg, collectedAt: raw.collectedAt, kind: "OFFICIAL", partisanship: "UNDETERMINED" };
  }
}
