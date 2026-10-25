import { personCardSources, type CardSource } from "@/lib/officials/card-sources";
import { indexByOfficeholderId } from "@/lib/officials/lookup";
import { liveNationalExecutiveRoster, readNationalPresident } from "@/lib/reader/national";

export interface NationalCard {
  readonly id: string;
  readonly office: string;
  readonly title: string;
  readonly holder: string | null;
  readonly photoUrl: string | null;
  readonly sources: readonly CardSource[];
}

/** Every current national executive whose seat, name and source page are verified, with its Sources. */
export async function readNationalCards(): Promise<readonly NationalCard[]> {
  const roster = liveNationalExecutiveRoster(await readNationalPresident());
  if (!roster) return [];
  const holders = indexByOfficeholderId([roster]);
  return roster.officeholders.map(person => ({
    id: person.id,
    office: "National government",
    title: person.officeTitle,
    holder: person.name,
    photoUrl: holders.get(person.id)?.photoUrl ?? null,
    sources: personCardSources({ ...holders.get(person.id)!, executive: person.executive }),
  }));
}
