import type { CandidateProfilesProjection } from "../civic-data/manual-projections.ts";

/** A reader projection, never a mutation of the saved filing or source evidence. */
export function readerCandidateProfiles(value: CandidateProfilesProjection): CandidateProfilesProjection {
  if (!value?.cards?.cards) return value;
  return { ...value, cards: { ...value.cards,
    // Older acquisition notes contain the same addresses as the filed fields.
    note: "", hunts: [],
    cards: Object.fromEntries(Object.entries(value.cards.cards).map(([key, card]) =>
      [key, { ...card, ...(Object.hasOwn(card, "filedAddress") ? { filedAddress: null } : {}),
        ...(Object.hasOwn(card, "filedAddressSource") ? { filedAddressSource: null } : {}) }])) } };
}
