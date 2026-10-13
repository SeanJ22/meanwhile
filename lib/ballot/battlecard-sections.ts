import { PERSON_CARD_SECTIONS, type PersonCardSectionId } from "../design/card-sections.ts";
export { PERSON_CARD_SECTIONS as BATTLECARD_SECTIONS } from "../design/card-sections.ts";
export type { PersonCardSectionId as BattlecardSectionId, PersonCardSectionSpec as BattlecardSectionSpec } from "../design/card-sections.ts";

export function battlecardSectionTitle(id: PersonCardSectionId): string {
  return PERSON_CARD_SECTIONS.find(section => section.id === id)?.title ?? "";
}
