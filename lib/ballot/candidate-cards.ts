import { currentCandidateProfilesProjection, candidateProfilesReadState } from "../civic-data/manual-read-models.ts";
import type { PortraitVerification } from "../photos/binding.ts";
import { photoForPerson } from "../photos/person.ts";

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

function load(state: string): CandidateCardsFile {
  return currentCandidateProfilesProjection(state).cards;
}

function cardForKey(state: string, key: string): CandidateCardData | null {
  const read = candidateProfilesReadState(state);
  const cards = read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? load(state).cards : {};
  const card = Object.hasOwn(cards, key) ? cards[key] : null;
  const personPhoto = photoForPerson(card?.personId ?? key,state);
  const photo = personPhoto ? {personId:card?.personId,photoUrl:personPhoto.url,photoSource:personPhoto.source,photoVerification:personPhoto.verification} : null;
  if (!photo) return card;
  const base = card ?? { bio: null, bioSourceUrl: null, bioSourceLabel: null, email: null, phone: null, phoneLabel: null,
    filedAddress: null, filedAddressSource: null };
  return { ...base, ...photo };
}

export function cardForCandidacy(state: string, candidacyId: string): CandidateCardData | null {
  return cardForKey(state, candidacyId);
}

export function cardForNominee(state: string, contestId: string, name: string): CandidateCardData | null {
  return cardForKey(state, `${contestId}|${name}`);
}

export function allCandidateCards(state: string): CandidateCardsFile {
  return load(state);
}
