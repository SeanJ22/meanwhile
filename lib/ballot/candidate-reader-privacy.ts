import type { CandidateProfilesProjection } from "../civic-data/manual-projections.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import type { CandidateCardData } from "./candidate-cards.ts";

const STORED_CANDIDATE_PORTRAIT = "/api/portraits/candidates/";

function readerCard(card: CandidateCardData, subjectId: string): CandidateCardData {
  const verification = card.photoVerification;
  const removePortrait = card.photoUrl?.startsWith(STORED_CANDIDATE_PORTRAIT) &&
    !(verification && portraitBindingMatches(card.personId ?? subjectId, { url: card.photoUrl, sourceUrl: verification.imageUrl, verification }, "candidates"));
  const removeAddress = Object.hasOwn(card, "filedAddress") && card.filedAddress !== null;
  const removeAddressSource = Object.hasOwn(card, "filedAddressSource") && card.filedAddressSource !== null;
  return removePortrait || removeAddress || removeAddressSource ? { ...card,
    ...(removePortrait ? { photoUrl: null, photoSource: null } : {}),
    ...(removeAddress ? { filedAddress: null } : {}),
    ...(removeAddressSource ? { filedAddressSource: null } : {}) } : card;
}

export function readerCandidateProfiles(value: CandidateProfilesProjection): CandidateProfilesProjection {
  if (!value?.cards?.cards) return value;
  let cards: Record<string, CandidateCardData> | undefined;
  for (const key of Object.keys(value.cards.cards)) {
    const original = value.cards.cards[key];
    const card = readerCard(original, key);
    if (card !== original) { cards ??= { ...value.cards.cards }; cards[key] = card; }
  }
  if (!cards && value.cards.note === "" && value.cards.hunts?.length === 0) return value;
  return { ...value, cards: { ...value.cards, note: "", hunts: [], cards: cards ?? value.cards.cards } };
}
