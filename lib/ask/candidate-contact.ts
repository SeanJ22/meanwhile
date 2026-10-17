import { candidateContactForCandidacy } from "../ballot/candidate-contacts.ts";
import type { AskContact } from "./contacts.ts";

/** Server projection of the same sourced filing the candidate card displays. */
export function contactForCandidate(state: string, candidacyId: string, name: string, office: string): AskContact | null {
  const contact = candidateContactForCandidacy(state, candidacyId);
  if (!contact) return null;
  return { id: `candidate-contact:${contact.candidacyId}`, name, officeTitle: office,
    relationship: `Candidate for ${office} — contact published on the filing`, basis: "SUBJECT_OFFICE",
    email: contact.email, phone: null, websiteUrl: null,
    sourceUrl: contact.sourceUrl, sourceOrg: contact.sourceOrg, retrievedAt: contact.collectedAt };
}
