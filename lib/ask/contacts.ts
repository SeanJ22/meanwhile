import type { EvidenceRecord } from "./evidence.ts";

/**
 * **WHO A READER CAN ACTUALLY CONTACT, AND WHY THEM.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## What this refuses to be
 *
 * It is not a ranking, a shortlist, or an answer to *"who matters most"*. The
 * product may not order people by influence, effectiveness, alignment or
 * likelihood of helping — and a contact list is exactly where such an ordering
 * would arrive without anybody deciding to build one, disguised as
 * helpfulness. So every entry here answers one question and only one:
 *
 * ```
 *   WHAT IS THE SOURCED, FACTUAL RELATIONSHIP BETWEEN THIS PERSON
 *   AND THE THING THE READER ASKED ABOUT?
 * ```
 *
 * "Board president of the district you asked about." "Superintendent, hired by
 * that board." "Your state senator." Each is read off a record with a
 * publisher and a read date. None of them is a claim that this person is the
 * right one to email, and none of them ranks anybody.
 *
 * ## Why they are EVIDENCE RECORDS rather than a separate field
 *
 * Because the synthesis rung may explain a contact and may never invent one,
 * and the only mechanism that enforces that is the evidence pack. A contact
 * arriving outside the pack would be a fact the model could see and validation
 * could not check. Inside it, a contact carries its own `sourceUrl` — which is
 * the same allow-list every other sentence in the answer is checked against.
 *
 * ## Order is alphabetical, deliberately
 *
 * Any other order is an ordering a reader can read meaning into, which is what
 * `indexByDivision` already decided for the same reason. Role order would rank;
 * source order would leak collection sequence.
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

/**
 * Titles that mark a roster entry as APPOINTED STAFF rather than a seated
 * member.
 *
 * The distinction is a fact a reader needs and it is already recorded — Vail's
 * roster carries John Carruth with `termNote: "Appointed by the Governing
 * Board, not elected"`. Calling him a board member would be false; leaving him
 * out would drop the single most useful contact for a question about a school
 * district. So he is included and correctly described.
 */
const STAFF_TITLES = /\b(superintendent|manager|administrator|clerk of the|director of)\b/i;

function isStaff(holder: SeatHolder): boolean {
  return STAFF_TITLES.test(holder.officeTitle);
}

/**
 * The verified people attached to one DIVISION's government.
 *
 * **Through the promoted server-side roster projection for the division's
 * exact governing body** — and not through the client representation helper.
 * That helper now consumes rosters already projected onto a coverage response;
 * Ask runs at the server request boundary and has no such response to borrow.
 *
 * That ban is right and it is worth restating rather than routing around: a
 * BODY's members come from `lib/registry/body-membership.ts` and from
 * nowhere else, because the convenient division fallback is what once gave a
 * Tucson advisory board the Mayor and Council as its membership. Ask is not
 * rendering a body's roster here; it is answering "who can I contact about this
 * district", which is the division question, and it asks the resolver that owns
 * it.
 *
 * Both recognized governing suffixes are exact keys. The first populated one
 * wins, so an advisory body sharing the division can never leak into the
 * answer and the promoted runtime roster remains the sole person authority.
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
 * **THE PEOPLE ON ONE EXACT BODY — and nobody, where we cannot say who.**
 * (2026-08-29, the exact-body-identity session.)
 *
 * `contactsForDivision` above answers *who represents this AREA*. That is a
 * different question from *who sits on THIS BODY*, and the two were one
 * function because Ask could only name divisions. Now that a reader can bind
 * the Tucson Design Review Board, the difference is load-bearing: the division
 * resolver would hand back Tucson's Mayor and Council, and the caller would
 * render them as *"Member on Design Review Board"* — a sourced-looking sentence
 * about real named people that is simply false.
 *
 * That is the exact failure this module's own doc block already warned about
 * one layer down, where `tests/body-composition.test.ts` bans
 * `governingRosterHoldersForDivision` outside two callers *because the
 * convenient division fallback is what once gave a Tucson advisory board the
 * Mayor and Council as its membership*. The ban was right; the division
 * question simply arrived through a different door.
 *
 * The canonical `membersOfBody` selector supplies direct rosters and explicitly
 * sourced legal aliases, exactly as on the map. A division's representatives
 * are offered only for the body that is that division's own government. A
 * neighboring advisory body inherits no contact from that geography.
 *
 * Returning nothing is the conservative direction and it is a REAL answer. The
 * alternative on offer is not "more contacts", it is wrong contacts.
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
  /*
   * The cast is to the registry's own vocabulary and it is safe in the only
   * direction that matters: `isDivisionsOwnGovernment` looks the value up in
   * `DERIVED_BODY_SUFFIX` and returns FALSE for anything it does not know. An
   * unrecognised division type therefore yields no contacts rather than the
   * wrong ones.
   */
  const known = divisionType as BodyDivisionType;
  if (!isDivisionsOwnGovernment(bodyId, ocdId, known)) return [];
  return contactsForDivision(ocdId, bodyName);
}

/**
 * A legislator who represents a division the reader is standing in.
 *
 * **The relationship claim is bounded by what a division membership proves.**
 * A reader whose ZIP reaches a state legislative district is *in that
 * district's territory*; that is what the geometry established and it is what
 * the sentence says. It is not an address-verified constituency, and
 * `lib/ask/residency.ts` holds the same distinction for the signal row. The
 * wording — "your state senator" — is the one the product already uses on the
 * who-governs card for exactly this relationship, so the two surfaces make the
 * same claim rather than two slightly different ones.
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

/**
 * **THE OFFICE THE QUESTION IS ABOUT, as its own contact.**
 *
 * For a question about a sitting officeholder this is the most relevant
 * contact there is, and it was the one missing: an answer about the Governor
 * listed the reader's state senator and not the Governor's own published
 * office. The relationship is the plainest one in the file — this is the office
 * you asked about — and the channels are the ones that office publishes.
 */
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

/**
 * **AN OFFICE AS A CONTACT** (CA-07): the address and hours a body, a member
 * or a campaign publishes for an office, carrying that page as its source.
 * The relationship says whose office it is; nothing is ranked.
 */
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
 * A contact as an evidence record.
 *
 * The text is a MECHANICAL READ of the fields — name, relationship, and the
 * channels the publisher actually printed. Nothing is summarised and no channel
 * is invented: a person with no published email carries no email, and the
 * sentence simply does not mention one. An absence here is a real absence, and
 * "contact them through the district office" would be us making one up.
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
