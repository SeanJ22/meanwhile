/** One reading order for officials and candidates, including thin records. */
export type PersonCardSectionId = "office" | "positions" | "committees" | "offices" | "money" | "record" | "sources";
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
