/**
 * One office-location fact for every kind of owner. An address counts only when a page presents it as an office; a
 * campaign address never counts when it equals the candidate's filed mailing address.
 */
import type { MemberOfficeRecord } from "./member-offices.ts";

export type OfficeLocationKind = "DISTRICT_OFFICE" | "CAPITOL_OFFICE" | "CAMPAIGN_OFFICE" | "BODY_OFFICE" | "MEETING_PLACE";

export interface OfficeLocation {
  readonly ownerId: string;
  readonly kind: OfficeLocationKind;
  readonly address: string;
  readonly hours: string | null;
  readonly phone: string | null;
  readonly email?:string | null;
  readonly sourceUrl: string;
  readonly sourceOrg: string | null;
  readonly collectedAt: string | null;
}

const KINDS: readonly OfficeLocationKind[] = ["DISTRICT_OFFICE", "CAPITOL_OFFICE", "CAMPAIGN_OFFICE", "BODY_OFFICE", "MEETING_PLACE"];
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Comparable form of an address: case, punctuation and "Suite"/"Ste" spelling removed. */
export function addressKey(address: string): string {
  return address.toLowerCase().replace(/\b(suite|ste|unit|room|rm|floor|fl)\b\.?/g, " ").replace(/#/g, " ")
    .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\broad\b/g, "rd").replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr").replace(/\bnorth\b/g, "n").replace(/\bsouth\b/g, "s").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** A street or box address with a number in it, long enough to be an address and not a heading. */
export function looksLikeAddress(text: string): boolean {
  const value = clean(text);
  return value.length >= 8 && value.length <= 200 && /\d/.test(value) && /[A-Za-z]{3}/.test(value);
}

/** An office location, or null when the address is not one a page could present as an office. */
export function officeLocation(input: {
  readonly ownerId: string;
  readonly kind: string;
  readonly address: string | null | undefined;
  readonly hours?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly sourceUrl: string | null | undefined;
  readonly sourceOrg?: string | null;
  readonly collectedAt?: string | null;
}): OfficeLocation | null {
  if (!input.ownerId || !KINDS.includes(input.kind as OfficeLocationKind)) return null;
  const address = clean(input.address ?? "");
  if (!looksLikeAddress(address) || !input.sourceUrl?.startsWith("https://")) return null;
  return { ownerId: input.ownerId, kind: input.kind as OfficeLocationKind, address,
    hours: input.hours ? clean(input.hours) || null : null, phone: input.phone ? clean(input.phone) || null : null,
    sourceUrl: input.sourceUrl, sourceOrg: input.sourceOrg ?? null, collectedAt: input.collectedAt ?? null,
    ...(input.email?.trim() ? {email:input.email.trim()} : {}) };
}

const joinAddress = (office: MemberOfficeRecord["office"]) =>
  [office.address, [office.city, [office.state, office.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

/** The stored member offices, as the one shape. */
export function fromMemberOffice(record: MemberOfficeRecord): OfficeLocation | null {
  return officeLocation({ ownerId: record.officeholderId, kind: record.officeKind === "CAPITOL" ? "CAPITOL_OFFICE" : "DISTRICT_OFFICE",
    address: joinAddress(record.office), phone: record.office.phone, email:record.office.email, sourceUrl: record.sourceUrl, sourceOrg: record.sourceOrg, collectedAt: record.collectedAt });
}

/** A body's office, as its own page states it. */
export function fromBodyOffice(input: {
  readonly bodyId: string;
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly sourceUrl?: string | null;
  readonly sourceOrg?: string | null;
  readonly collectedAt?: string | null;
}): OfficeLocation | null {
  return officeLocation({ ownerId: input.bodyId, kind: "BODY_OFFICE", address: input.address, phone: input.phone,
    sourceUrl: input.sourceUrl, sourceOrg: input.sourceOrg, collectedAt: input.collectedAt });
}

const HOURS = /\b(?:office\s+)?hours\s*[:\-–]\s*([^\n]{4,120})|\b((?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?)\b[^\n]{0,24}?(?:–|-|to|through)\s*(?:mon|tue|wed|thu|fri)[a-z]*\.?,?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*(?:–|-|to)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/i;

/** Hours exactly as the page writes them, only when the page labels them or gives days and times. */
export function officeHoursFrom(text: string): string | null {
  const match = HOURS.exec(text);
  const found = clean(match?.[1] ?? match?.[2] ?? "");
  return found && /\d/.test(found) ? found : null;
}

const CAMPAIGN_LABEL = /^\s*(?:our\s+|the\s+)?(?:campaign\s+(?:office|headquarters|hq)|headquarters|hq|office|visit\s+our\s+office)\s*[:\-–]\s*(.+)$/i;

/** A campaign office from the campaign's own page: only a line labelled office or headquarters counts. */
export function campaignOfficeFrom(input: {
  readonly ownerId: string;
  readonly pageText: string;
  readonly sourceUrl: string;
  readonly sourceOrg?: string | null;
  readonly collectedAt?: string | null;
  readonly filedMailingAddress?: string | null;
}): OfficeLocation | null {
  const lines = input.pageText.split(/\n/);
  const filed = input.filedMailingAddress ? addressKey(input.filedMailingAddress) : null;
  for (let i = 0; i < lines.length; i += 1) {
    const labeled = CAMPAIGN_LABEL.exec(lines[i]);
    if (!labeled) continue;
    const address = clean(labeled[1]);
    if (!looksLikeAddress(address) || (filed && addressKey(address) === filed)) continue;
    const near = lines.slice(i, i + 3).join("\n");
    return officeLocation({ ownerId: input.ownerId, kind: "CAMPAIGN_OFFICE", address, hours: officeHoursFrom(near),
      sourceUrl: input.sourceUrl, sourceOrg: input.sourceOrg, collectedAt: input.collectedAt });
  }
  return null;
}

/** Plain-language line for a card or an answer: address, hours, phone as published. */
export function officeLocationLine(location: OfficeLocation): string {
  const label = { DISTRICT_OFFICE: "District office", CAPITOL_OFFICE: "Capitol office", CAMPAIGN_OFFICE: "Campaign office",
    BODY_OFFICE: "Office", MEETING_PLACE: "Meets at" }[location.kind];
  return [`${label}: ${location.address}`, location.hours ? `Hours: ${location.hours}` : null, location.phone ? `Phone: ${location.phone}` : null,location.email ? `Email: ${location.email}` : null]
    .filter(Boolean).join(". ") + ".";
}

/** One owner's locations, kinds in a fixed order and nothing ranked. */
export function locationsForOwner(all: readonly OfficeLocation[], ownerId: string): readonly OfficeLocation[] {
  return all.filter(row => row.ownerId === ownerId).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.address.localeCompare(b.address));
}
