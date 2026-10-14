import { currentCandidateProfilesProjection, candidateProfilesReadState } from "../civic-data/manual-read-models.ts";
import { currentDerivedCandidatePortraits } from "../civic-data/derived-campaign-sites.ts";
import type { PortraitVerification } from "../photos/binding.ts";
import { officialPhotoForPerson } from "../photos/person.ts";

export interface CandidateCardData {
  personId?: string;
  photoUrl: string | null;
  photoSource: string | null;
  photoVerification?: PortraitVerification;
  bio: string | null;
  bioSourceUrl: string | null;
  bioSourceLabel: string | null;
  email: string | null;
  phone: string | null;
  phoneSource?: string | null;
  phoneLabel: string | null;
  /** @deprecated Filed addresses are evidence only; reader projections always clear them. */
  filedAddress: string | null;
  /** @deprecated Kept nullable while the Ask lane removes its legacy field contract. */
  filedAddressSource: string | null;
}

export interface CandidateCardsFile {
  readonly curatedAt: string;
  readonly note: string;
  readonly cards: Readonly<Record<string, CandidateCardData>>;
  readonly hunts: readonly { readonly key: string; readonly name: string; readonly note: string; readonly attemptedAt: string }[];
}

function load(): CandidateCardsFile {
  return currentCandidateProfilesProjection().cards;
}

function cardForKey(key: string): CandidateCardData | null {
  const state = candidateProfilesReadState();
  const cards = state.kind === "PROMOTED" || state.kind === "BOOTSTRAP" ? load().cards : {};
  const card = Object.hasOwn(cards, key) ? cards[key] : null;
  if (card?.photoUrl) return card;
  const portrait = currentDerivedCandidatePortraits().find(record => record.id === key)?.portrait;
  const official = officialPhotoForPerson(card?.personId ?? key);
  const photo = portrait ?? (official ? { personId: official.verification?.personId ?? card?.personId,
    photoUrl: official.url, photoSource: official.source, photoVerification: official.verification } : null);
  if (!photo) return card;
  const base = card ?? { bio: null, bioSourceUrl: null, bioSourceLabel: null, email: null, phone: null, phoneLabel: null,
    filedAddress: null, filedAddressSource: null };
  return { ...base, ...photo };
}

export function cardForCandidacy(candidacyId: string): CandidateCardData | null {
  return cardForKey(candidacyId);
}

export function cardForNominee(contestId: string, name: string): CandidateCardData | null {
  return cardForKey(`${contestId}|${name}`);
}

export function allCandidateCards(): CandidateCardsFile {
  return load();
}
