import type { CandidateProfilesProjection } from "../civic-data/manual-projections.ts";
import { portraitBindingMatches } from "../photos/evidence.ts";
import type { CandidateCardData } from "./candidate-cards.ts";

const STORED_CANDIDATE_PORTRAIT = "/api/portraits/candidates/";

/**
 * CA-08: a portrait stored from a campaign's own page shows only while its
 * saved sources still bind to the exact stored image. Portraits published
 * before the store (committed files) are untouched.
 */
function boundPortrait(card: CandidateCardData): CandidateCardData {
  if (!card.photoUrl?.startsWith(STORED_CANDIDATE_PORTRAIT)) return card;
  const verification = card.photoVerification;
  if (verification && portraitBindingMatches(verification.name, { url: card.photoUrl, sourceUrl: verification.imageUrl, verification }, "candidates")) return card;
  return { ...card, photoUrl: null, photoSource: null };
}

/** A reader projection, never a mutation of the saved filing or source evidence. */
export function readerCandidateProfiles(value: CandidateProfilesProjection): CandidateProfilesProjection {
  if (!value?.cards?.cards) return value;
  return { ...value, cards: { ...value.cards,
    // Older acquisition notes contain the same addresses as the filed fields.
    note: "", hunts: [],
    cards: Object.fromEntries(Object.entries(value.cards.cards).map(([key, card]) =>
      [key, boundPortrait({ ...card, ...(Object.hasOwn(card, "filedAddress") ? { filedAddress: null } : {}),
        ...(Object.hasOwn(card, "filedAddressSource") ? { filedAddressSource: null } : {}) })])) } };
}
