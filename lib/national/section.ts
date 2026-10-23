import type { CardSource } from "@/lib/officials/card-sources";

export const NATIONAL_PATH = "/national";
export const NATIONAL_LINK_LABEL = "National government, coming soon";

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

/** The cards the national executive data has marked complete; the data connects here. */
export async function readNationalCards(): Promise<readonly NationalCard[]> {
  return [];
}
