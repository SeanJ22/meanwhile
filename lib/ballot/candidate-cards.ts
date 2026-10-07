import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import type { PortraitVerification } from "../photos/evidence.ts";
import { officialPhotoForPerson } from "../photos/person.ts";

export interface CandidateCardData {
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

function withPersonPhoto(
  card: CandidateCardData | null,
  personName: string,
): CandidateCardData | null {
  if (!card) return card;
  const official = officialPhotoForPerson(personName);
  const merged =
    !official || official.url === card.photoUrl
      ? card
      : { ...card, photoUrl: official.url, photoSource: official.source };
  return merged;
}

function nameFromCandidacyId(candidacyId: string): string {
  const tail = candidacyId.split(":").pop() ?? "";
  return tail.split("-").reverse().join(" ");
}

export function cardForCandidacy(candidacyId: string): CandidateCardData | null {
  return withPersonPhoto(
    load().cards[candidacyId] ?? null,
    nameFromCandidacyId(candidacyId),
  );
}

export function cardForNominee(
  contestId: string,
  name: string,
): CandidateCardData | null {
  return withPersonPhoto(load().cards[`${contestId}|${name}`] ?? null, name);
}

export function allCandidateCards(): CandidateCardsFile {
  return load();
}
