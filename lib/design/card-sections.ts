/** One reading order for officials and candidates, including thin records. */
export type PersonCardSectionId = "office" | "positions" | "committees" | "offices" | "money" | "record" | "confirmation" | "sources";
export interface PersonCardSectionSpec {
  id: PersonCardSectionId;
  title: string;
}
export const PERSON_CARD_SECTIONS: readonly PersonCardSectionSpec[] = [
  { id: "office", title: "What this office does" },
  { id: "positions", title: "Positions" },
  { id: "committees", title: "Committees" },
  { id: "offices", title: "Offices near you" },
  { id: "money", title: "Campaign money" },
  { id: "record", title: "Voting record" },
  { id: "sources", title: "Sources" },
];

/** The Senate confirms Cabinet secretaries, so only their cards have this section; it follows the office it describes. */
export const PERSON_CARD_READING_ORDER: readonly PersonCardSectionSpec[] = PERSON_CARD_SECTIONS.flatMap(section =>
  section.id === "office" ? [section, { id: "confirmation" as const, title: "Confirmation" }] : [section]);
