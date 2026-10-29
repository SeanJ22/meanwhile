import { createHash } from "node:crypto";
import type { BodyRoster, RosterMember } from "../../registry/body-rosters.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { fetchBodies, fetchOfficeRecords } from "./client.ts";
import { saveLegistarReading } from "./members-cache.ts";
import { validateLegistarMembers, termDate, memberProbe, memberName, currentMemberOffice, type LegistarMembers, type MemberBody, type MemberOffice } from "./members-model.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";

/** Each response is saved once by content hash. Unchanged tenants never open retained source bytes. */
export function makeLegistarMembersReader(vault: EvidenceStore, fetchImpl?: typeof fetch,
  initial: { readonly signature: string } | null = null, context = "") {
  let fingerprint = initial?.signature;
  return async (slug: string, signal?: AbortSignal): Promise<LegistarMembers | { readonly unchanged: true; readonly signature: string }> => {
    const readings: LegistarMembers["readings"] = [];
    const options = { fetchImpl, signal, onRead: async (reading: { url: string; text: string; retrievedAt: string; body: unknown }) => {
      readings.push(await saveLegistarReading(vault, slug, reading));
    } };
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const bodies = await fetchBodies<MemberBody>(slug, { ...options, select: ["BodyId", "BodyName", "BodyRowVersion"] });
    const offices = await fetchOfficeRecords<MemberOffice>(slug, { ...options,
      filter: `(OfficeRecordEndDate eq null or OfficeRecordEndDate ge datetime'${day}T00:00:00')`,
      select: ["OfficeRecordId", "OfficeRecordPersonId", "OfficeRecordBodyId", "OfficeRecordFullName", "OfficeRecordTitle",
        "OfficeRecordMemberType", "OfficeRecordStartDate", "OfficeRecordEndDate", "OfficeRecordRowVersion"] });
    const hash = createHash("sha256").update(context || day);
    for (const reading of readings) hash.update(reading.artifact.contentHash);
    const signature = hash.digest("hex");
    if (signature === fingerprint) return { unchanged: true, signature };
    const result: LegistarMembers = { slug, bodies, offices, persons: [], readings, signature, collectedAt: new Date().toISOString() };
    validateLegistarMembers(result);
    fingerprint = signature;
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
      if (!currentMemberOffice(office, today)) continue;
      const held = seats.get(office.OfficeRecordPersonId);
      if (!held || (termStart ?? "") > (held.termStart ?? "") || (termStart ?? "") === (held.termStart ?? "") && office.OfficeRecordId > held.office.OfficeRecordId) {
        seats.set(office.OfficeRecordPersonId, { office, termStart, termEnd });
      }
    }
    for (const { office, termStart, termEnd } of seats.values()) {
      if (pageUrl && memberSourceUrl(raw, "officerecords", "OfficeRecordId", office.OfficeRecordId) !== pageUrl) continue;
      const person = persons.get(office.OfficeRecordPersonId);
      const name = memberName(office);
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
