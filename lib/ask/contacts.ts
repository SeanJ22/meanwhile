import type { EvidenceRecord } from "./evidence.ts";

/**
 * Who a reader can contact, and why them. Every entry states one sourced,
 * factual relationship between the person and what the reader asked about,
 * read off a record with a publisher and read date; nothing ranks anybody.
 * Contacts are evidence records, so validation checks their `sourceUrl` like
 * any other sentence. Order is alphabetical.
 */

export { contactReadLine } from "./contact-render.ts";
import { rosterForBody, rosterHoldersForBody } from "../registry/body-rosters.ts";
import { membersOfBody } from "../registry/body-membership.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { isDivisionsOwnGovernment } from "../officials/division-government.ts";
import type { BodyDivisionType } from "../officials/body-description.ts";
import { officeLocationLine, type OfficeLocation } from "../officials/office-locations.ts";

/** Where a contact came from, so the answer can say the relationship out loud. */
export type ContactBasis =
  /** A seat on the body the reader asked about. */
  | "BODY_MEMBER"
  /** Hired by that body — a superintendent, a manager, a clerk. */
  | "BODY_STAFF"
  /** Represents the reader's own division in a legislature. */
  | "READER_REPRESENTATIVE"
  /** The officeholder the question is ABOUT, and their own published office. */
  | "SUBJECT_OFFICE";

export interface AskContact {
  id: string;
  name: string;
  officeTitle: string;
  /** The RELATIONSHIP, in plain language. Never an assessment of the person. */
  relationship: string;
  basis: ContactBasis;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  sourceOrg: string | null;
  retrievedAt: string | null;
  /** Where the office is and when it is open, as its own page publishes them. */
  office?: { address: string; hours: string | null; kind: string } | null;
}

/** Titles that mark a roster entry as appointed staff rather than a seated member. */
const STAFF_TITLES = /\b(superintendent|manager|administrator|clerk of the|director of)\b/i;

function isStaff(holder: SeatHolder): boolean {
  return STAFF_TITLES.test(holder.officeTitle);
}

/**
 * The verified people attached to one division's government, through the
 * promoted server-side roster projection for that division's exact governing
 * body. Both governing suffixes are exact keys; the first populated wins, so an
 * advisory body sharing the division never leaks in.
 */
export function contactsForDivision(ocdId: string, bodyName: string): AskContact[] {
  const governing = rosterHoldersForBody(`${ocdId}#governing`);
  const holders = governing.length > 0
    ? governing
    : rosterHoldersForBody(`${ocdId}#board`);
  if (holders.length === 0) return [];

  const roster =
    rosterForBody(`${ocdId}#governing`) ?? rosterForBody(`${ocdId}#board`);

  return holders
    .map((holder): AskContact => {
      const staff = isStaff(holder);
      return {
        id: holder.id,
        name: holder.name,
        officeTitle: holder.officeTitle,
        relationship: staff
          ? `${holder.officeTitle} of ${bodyName}`
          : `${holder.officeTitle} on ${bodyName}`,
        basis: staff ? "BODY_STAFF" : "BODY_MEMBER",
        email: holder.email,
        phone: holder.phone,
        websiteUrl: holder.websiteUrl,
        sourceUrl: holder.sourceUrl ?? roster?.sourceUrl ?? null,
        sourceOrg: holder.provenance?.sourceOrg ?? roster?.sourceOrg ?? null,
        retrievedAt: holder.provenance?.collectedAt ?? roster?.collectedAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The people on one exact body, from `membersOfBody` (direct rosters and
 * sourced legal aliases). A division's representatives are offered only for
 * the body that is that division's own government. Returning nothing is a real
 * answer.
 */
export function contactsForBody(
  body: { bodyId: string; ocdId: string | null; divisionType: string | null },
  bodyName: string,
): AskContact[] {
  const { bodyId, ocdId, divisionType } = body;
  const composition = membersOfBody(bodyId);
  if (!composition.unknown) {
    return composition.members.map((holder): AskContact => ({
      id: holder.id,
      name: holder.name,
      officeTitle: holder.officeTitle,
      relationship: `${holder.officeTitle} ${isStaff(holder) ? "of" : "on"} ${bodyName}`,
      basis: isStaff(holder) ? "BODY_STAFF" : "BODY_MEMBER",
      email: holder.email,
      phone: holder.phone,
      websiteUrl: holder.websiteUrl,
      sourceUrl: composition.authority?.sourceUrl ?? holder.sourceUrl,
      sourceOrg: composition.authority?.sourceOrg ?? holder.provenance.sourceOrg,
      retrievedAt: composition.authority?.collectedAt ?? holder.provenance.collectedAt,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!ocdId || !divisionType) return [];
  /* `isDivisionsOwnGovernment` returns false for an unknown division type, so it yields no contacts. */
  const known = divisionType as BodyDivisionType;
  if (!isDivisionsOwnGovernment(bodyId, ocdId, known)) return [];
  return contactsForDivision(ocdId, bodyName);
}

/**
 * A legislator for a division the reader's ZIP reaches. The claim is
 * territorial ("your state senator"), not an address-verified constituency.
 */
export function contactsForRepresentatives(
  holders: readonly {
    id: string;
    name: string;
    officeTitle: string;
    email: string | null;
    phone: string | null;
    websiteUrl: string | null;
    sourceUrl: string | null;
    sourceOrg?: string | null;
    collectedAt?: string | null;
  }[],
): AskContact[] {
  return holders
    .map(
      (holder): AskContact => ({
        id: holder.id,
        name: holder.name,
        officeTitle: holder.officeTitle,
        relationship: `Your ${holder.officeTitle.toLowerCase()}`,
        basis: "READER_REPRESENTATIVE",
        email: holder.email,
        phone: holder.phone,
        websiteUrl: holder.websiteUrl,
        sourceUrl: holder.sourceUrl,
        sourceOrg: holder.sourceOrg ?? null,
        retrievedAt: holder.collectedAt ?? null,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The office the question is about, as its own contact with the channels it publishes. */
export function contactForOfficeholder(seat: {
  id: string;
  name: string;
  officeTitle: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  contactFormUrl?: string | null;
  sourceUrl: string | null;
  provenance?: { sourceOrg?: string | null; collectedAt?: string | null } | null;
}): AskContact {
  return {
    id: `office:${seat.id}`,
    name: seat.name,
    officeTitle: seat.officeTitle,
    relationship: `${seat.officeTitle} — the office this question is about`,
    basis: "SUBJECT_OFFICE",
    email: seat.email,
    phone: seat.phone,
    websiteUrl: seat.contactFormUrl ?? seat.websiteUrl,
    sourceUrl: seat.sourceUrl,
    sourceOrg: seat.provenance?.sourceOrg ?? null,
    retrievedAt: seat.provenance?.collectedAt ?? null,
  };
}

/** An office as a contact: the address and hours its page publishes, with that page as source. */
export function contactForOfficeLocation(location: OfficeLocation, name: string, relationship: string): AskContact {
  return {
    id: `office-location:${location.ownerId}:${location.kind.toLowerCase()}`,
    name,
    officeTitle: relationship,
    relationship,
    basis: "SUBJECT_OFFICE",
    email: null,
    phone: location.phone,
    websiteUrl: null,
    sourceUrl: location.sourceUrl,
    sourceOrg: location.sourceOrg,
    retrievedAt: location.collectedAt,
    office: { address: location.address, hours: location.hours, kind: location.kind },
  };
}

/**
 * A contact as an evidence record: a mechanical read of name, relationship
 * and the channels the publisher printed. No channel is invented.
 */
export function contactRecord(contact: AskContact): EvidenceRecord {
  const channels: string[] = [];
  if (contact.email) channels.push(`email ${contact.email}`);
  if (contact.phone) channels.push(`phone ${contact.phone}`);
  const tail = channels.length > 0 ? ` Published contact: ${channels.join(", ")}.` : "";
  const where = contact.office
    ? ` ${officeLocationLine({ ownerId: contact.id, kind: contact.office.kind as OfficeLocation["kind"], address: contact.office.address,
        hours: contact.office.hours, phone: null, sourceUrl: contact.sourceUrl ?? "", sourceOrg: null, collectedAt: null })}`
    : "";
  return {
    kind: "CONTACT",
    id: contact.id,
    text: `${contact.name} — ${contact.relationship}.${tail}${where}`,
    sourceUrl: contact.sourceUrl,
    sourceOrg: contact.sourceOrg,
    retrievedAt: contact.retrievedAt,
  };
}

/**
 * **THE PROVENANCE OF A SOURCED RELATIONSHIP, AS A READER-SAFE LINE.**
 * (ASK-05, 2026-08-28.)
 *
 * `AskContact` has always carried `sourceOrg` and `retrievedAt`, and **both
 * client copies of the contact type dropped them** — so the publisher and the
 * read date of a claim about a named person's role travelled on the wire and
 * were unrenderable by declaration. A relationship sentence with no source
 * behind it is exactly what this module's own doc block says a contact must
 * never be.
 *
 * What it returns is the publisher and the day we read them, spelled out.
 * **`basis` is deliberately NOT in it**: `BODY_MEMBER` and
 * `READER_REPRESENTATIVE` are enum values, no enum value reaches a reader, and
 * the plain-language version of that fact is already the `relationship`
 * string. The basis stays on the wire as the audit discriminant it is.
 *
 * Null where nothing is held — never "source unknown", which reads as an
 * attribution and is not one.
 */
