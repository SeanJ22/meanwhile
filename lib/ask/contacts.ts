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

import { rosterForBody } from "../registry/body-rosters.ts";
import { representationForDivision } from "../registry/representation.ts";
import type { SeatHolder } from "../officials/lookup.ts";

/** Where a contact came from, so the answer can say the relationship out loud. */
export type ContactBasis =
  /** A seat on the body the reader asked about. */
  | "BODY_MEMBER"
  /** Hired by that body — a superintendent, a manager, a clerk. */
  | "BODY_STAFF"
  /** Represents the reader's own division in a legislature. */
  | "READER_REPRESENTATIVE";

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
 * **Through `representationForDivision`, which is the sanctioned resolver for
 * this exact question** — *who represents or governs this division* — and not
 * through `governingRosterHoldersForDivision`, which
 * `tests/body-composition.test.ts` bans outside two named callers.
 *
 * That ban is right and it is worth restating rather than routing around: a
 * BODY's members come from `lib/registry/body-composition.ts` and from
 * nowhere else, because the convenient division fallback is what once gave a
 * Tucson advisory board the Mayor and Council as its membership. Ask is not
 * rendering a body's roster here; it is answering "who can I contact about this
 * district", which is the division question, and it asks the resolver that owns
 * it.
 *
 * `null` coverage is deliberate: the route has divisions and no coverage
 * summary, and the resolver's legislative-seat branch is the one that needs one.
 * With none it falls through to the curated governing roster, which is the
 * branch a school district or a county board answers on anyway.
 */
export function contactsForBody(ocdId: string, bodyName: string): AskContact[] {
  const holders = representationForDivision(null, ocdId);
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
  return {
    kind: "CONTACT",
    id: contact.id,
    text: `${contact.name} — ${contact.relationship}.${tail}`,
    sourceUrl: contact.sourceUrl,
    sourceOrg: contact.sourceOrg,
    retrievedAt: contact.retrievedAt,
  };
}

/** How many contacts one answer may carry. A directory is not an answer. */
export const MAX_ASK_CONTACTS = 8;
