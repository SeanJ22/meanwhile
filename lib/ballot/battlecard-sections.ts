import { copy } from "../design/copy.ts";
import { PERSON_CARD_SECTIONS, type PersonCardSectionId } from "../design/card-sections.ts";
/** Compatibility names for existing ballot builders; PersonCard owns the schema. */
export { PERSON_CARD_SECTIONS as BATTLECARD_SECTIONS } from "../design/card-sections.ts";
export type { PersonCardSectionId as BattlecardSectionId, PersonCardSectionSpec as BattlecardSectionSpec } from "../design/card-sections.ts";

/** Missing records describe our collection; incumbency never changes the gap. */
export function votingRecordEmptyLine(_holdsOrHeldTheOffice: boolean): string { return copy("copy.working"); }
export function battlecardSectionTitle(id: PersonCardSectionId): string {
  return PERSON_CARD_SECTIONS.find(section => section.id === id)?.title ?? "";
}
