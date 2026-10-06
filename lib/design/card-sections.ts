import { copy } from "./copy.ts";

/** One reading order for officials and candidates, including thin records. */
export type PersonCardSectionId = "office" | "positions" | "committees" | "offices" | "money" | "record" | "sources";
export interface PersonCardSectionSpec {
  id: PersonCardSectionId;
  title: string;
  /** Compatibility for data builders; rendered gaps use WorkingOnIt. */
  emptyLine: string;
}
export const PERSON_CARD_SECTIONS: readonly PersonCardSectionSpec[] = [
  { id: "office", title: "What this office does", emptyLine: copy("copy.working") },
  { id: "positions", title: "Positions", emptyLine: copy("copy.working") },
  { id: "committees", title: "Committees", emptyLine: copy("copy.working") },
  { id: "offices", title: "Offices near you", emptyLine: copy("copy.working") },
  { id: "money", title: "Campaign money", emptyLine: copy("copy.working") },
  { id: "record", title: "Voting record", emptyLine: copy("copy.working") },
  { id: "sources", title: "Sources", emptyLine: copy("copy.working") },
];
