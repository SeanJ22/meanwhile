import { createHash } from "node:crypto";
import { isoTermDate } from "../../civic-data/term-dates.ts";
import type { Artifact } from "../../control-plane/evidence/artifact.ts";

export interface MemberReading { readonly artifact: Artifact; readonly ids: readonly number[] }

export interface MemberBody { BodyId: number; BodyName: string; BodyRowVersion: string; BodyTypeName?: string | null; }
export interface MemberPerson { PersonId: number; PersonFullName: string; PersonRowVersion: string }
export interface MemberOffice {
  OfficeRecordId: number; OfficeRecordPersonId: number; OfficeRecordBodyId: number;
  OfficeRecordFullName: string; OfficeRecordTitle: string | null; OfficeRecordMemberType: string | null;
  OfficeRecordStartDate: string | null; OfficeRecordEndDate: string | null; OfficeRecordRowVersion: string;
}
export interface LegistarMembers {
  slug: string; bodies: MemberBody[]; persons: MemberPerson[]; offices: MemberOffice[];
  signature: string; collectedAt: string;
  readings: MemberReading[];
}
export interface CachedLegistarMembers {
  readonly signature: string;
  readonly collectedAt: string;
  read(): Promise<LegistarMembers>;
}

export function legistarMemberSignature(raw: Pick<LegistarMembers, "bodies" | "persons" | "offices">): string {
  const hash = createHash("sha256");
  hash.update("body-types/1");
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

export function validateLegistarMembers(raw: LegistarMembers): void {
  const bodies = new Set(raw.bodies.map(body => body.BodyId)), persons = new Set(raw.persons.map(person => person.PersonId));
  if (bodies.size !== raw.bodies.length || persons.size !== raw.persons.length || new Set(raw.offices.map(office => office.OfficeRecordId)).size !== raw.offices.length) throw new Error("LEGISTAR_MEMBERS_DUPLICATE_ID");
  for (const body of raw.bodies) if (!body.BodyName?.trim()) throw new Error("LEGISTAR_MEMBERS_BODY_NAME_MISSING");
  for (const office of raw.offices) {
    const start = termDate(office.OfficeRecordStartDate), end = termDate(office.OfficeRecordEndDate);
    if (start && end && start > end) throw new Error("LEGISTAR_MEMBERS_TERM_REVERSED");
  }
}

export function termDate(value: string | null): string | null {
  if (!value) return null;
  const date = isoTermDate(value.slice(0, 10));
  if (!date) throw new Error("LEGISTAR_MEMBERS_TERM_INVALID");
  return date;
}

export function memberDay(now: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function currentMemberOffice(office: MemberOffice, today: string): boolean {
  const start = termDate(office.OfficeRecordStartDate), end = termDate(office.OfficeRecordEndDate);
  return (!start || start <= today) && (!end || end >= today);
}

export function memberName(office: MemberOffice): string | null {
  const name = office.OfficeRecordFullName?.trim();
  return !name || /^(?:vacant|vacancy|unfilled|tbd|to be (?:appointed|determined))$/i.test(name) ? null : name;
}

export function memberReading(artifact: Artifact, rows: unknown): MemberReading {
  const url = new URL(artifact.canonicalUrl), collection = url.pathname.split("/").at(-1);
  const key = collection === "bodies" ? "BodyId" : collection === "persons" ? "PersonId" : "OfficeRecordId";
  if (!Array.isArray(rows)) throw new Error("LEGISTAR_MEMBERS_SOURCE_PAGE_INVALID");
  const ids = rows.map(row => row[key]);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("LEGISTAR_MEMBERS_SOURCE_PAGE_INVALID");
  return { artifact, ids };
}

export function memberProbe(url: URL): boolean {
  const selected = url.searchParams.get("$select");
  return selected !== null && !selected.split(",").some(field => ["BodyName", "PersonFullName", "OfficeRecordFullName"].includes(field));
}
