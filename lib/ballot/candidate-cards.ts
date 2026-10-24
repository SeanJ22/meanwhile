import { currentCandidateProfilesProjection, candidateProfilesReadState } from "../civic-data/manual-read-models.ts";
import { currentDerivedCandidatePortraits, type DerivedCandidatePortraitRecord } from "../civic-data/derived-campaign-sites.ts";
import type { PortraitVerification } from "../photos/binding.ts";
import { officialPhotoForPerson } from "../photos/person.ts";
import { candidateKeysForState } from "./person-keys.ts";

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

const portraitIndexes = new WeakMap<readonly DerivedCandidatePortraitRecord[], ReadonlyMap<string, DerivedCandidatePortraitRecord>>();
function portraitFor(state: string, key: string) {
  const records = currentDerivedCandidatePortraits(state);
  let index = portraitIndexes.get(records);
  if (!index) { index = new Map(records.map(record => [record.id, record])); portraitIndexes.set(records, index); }
  return index.get(key)?.portrait;
}

function cardForKey(state: string, key: string): CandidateCardData | null {
  const read = candidateProfilesReadState(state);
  const cards = read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? load(state).cards : {};
  const keys = [...new Set([key, ...candidateKeysForState(state, key)])];
  const held = keys.flatMap(id => Object.hasOwn(cards, id) ? [cards[id]] : []);
  const combined = held.length ? held.reduce((kept, other) => Object.fromEntries(
    [...new Set([...Object.keys(kept), ...Object.keys(other)])].map(field =>
      [field, kept[field as keyof CandidateCardData] ?? other[field as keyof CandidateCardData]])) as unknown as CandidateCardData) : null;
  const photoCard = held.find(row => row.photoUrl), bioCard = held.find(row => row.bio), phoneCard = held.find(row => row.phone);
  const card = combined ? { ...combined,
    ...(photoCard ? { photoUrl: photoCard.photoUrl, photoSource: photoCard.photoSource,
      photoVerification: photoCard.photoVerification, personId: photoCard.personId } : {}),
    ...(bioCard ? { bio: bioCard.bio, bioSourceUrl: bioCard.bioSourceUrl, bioSourceLabel: bioCard.bioSourceLabel } : {}),
    ...(phoneCard ? { phone: phoneCard.phone, phoneSource: phoneCard.phoneSource, phoneLabel: phoneCard.phoneLabel } : {}),
  } : null;
  if (card?.photoUrl) return card;
  const portrait = keys.map(id => portraitFor(state, id)).find(Boolean);
  const official = officialPhotoForPerson(card?.personId ?? key);
  const photo = portrait ?? (official ? { personId: official.verification?.personId ?? card?.personId,
    photoUrl: official.url, photoSource: official.source, photoVerification: official.verification } : null);
  if (!photo) return card;
  const base = card ?? { bio: null, bioSourceUrl: null, bioSourceLabel: null, email: null, phone: null, phoneLabel: null,
    filedAddress: null, filedAddressSource: null };
  return { ...base, ...photo };
}

export function cardForCandidacy(state: string, candidacyId: string): CandidateCardData | null {
  return cardForKey(state, candidacyId);
}

export function allCandidateCards(state: string): CandidateCardsFile {
  return load(state);
}
