import { personCardSources, type CardSource } from "@/lib/officials/card-sources";
import { indexByOfficeholderId } from "@/lib/officials/lookup";
import { completeNationalExecutiveRoster, readNationalPresident } from "@/lib/reader/national";

export interface NationalCard {
  readonly id: string;
  readonly office: string;
  readonly title: string;
  readonly holder: string | null;
  readonly sources: readonly CardSource[];
  /** Set by the national executive data when every section the office has is filled and sourced. */
  readonly complete: boolean;
}

/** The National section shows a card only when its data marks it complete. */
export const completeNationalCards = (cards: readonly NationalCard[]): readonly NationalCard[] => cards.filter(card => card.complete === true);

/** Recheck the resident national roster's sourced floor before listing each card. */
export async function readNationalCards(): Promise<readonly NationalCard[]> {
  const roster = completeNationalExecutiveRoster(await readNationalPresident());
  if (!roster) return [];
  const holders = indexByOfficeholderId([roster]);
  return roster.officeholders.map(person => ({
    id: person.id,
    office: "National government",
    title: person.officeTitle,
    holder: person.name,
    sources: personCardSources({ ...holders.get(person.id)!, executive: person.executive }),
    complete: true,
  }));
}
