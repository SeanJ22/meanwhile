import { officeIdentity } from "./office-identity.ts";
import { whiteHouseOffice } from "./white-house-offices.ts";
import type { PersonCardSectionId } from "../design/card-sections.ts";

/** What an office is, for deciding which card sections it can have at all. */
export type OfficeFamily = "president" | "cabinet" | "executive" | "legislative" | "other";

const COUNTRY = "ocd-division/country:us";

/** Offices whose holders vote on a body's business: the voting record, committees and offices near you are theirs. */
const LEGISLATIVE = new Set([
  "us_senator", "us_representative", "state_senator", "state_lower_house", "county_commissioner", "county_supervisor",
  "municipal_council", "school_board", "library_trustee", "public_service_commissioner", "corporation_commissioner", "executive_councilor",
]);

/** Offices that run something or hold a single post; they act, they do not vote as one of many. */
const EXECUTIVE = new Set([
  "governor", "lieutenant_governor", "governor_and_lieutenant_governor", "secretary_of_state", "attorney_general", "state_treasurer",
  "superintendent_of_public_instruction", "state_mine_inspector", "state_auditor", "state_comptroller", "insurance_commissioner",
  "chief_election_officer", "agriculture_commissioner", "public_lands_commissioner", "labor_commissioner", "county_sheriff",
  "county_attorney", "county_treasurer", "register_of_deeds", "register_of_probate", "county_surrogate", "county_clerk",
  "county_assessor", "county_recorder", "county_coroner", "county_engineer", "county_tax_collector", "mayor", "school_superintendent",
]);

export function officeFamily(holder: { id: string; officeTitle: string; officeJurisdictionOcdId?: string | null }): OfficeFamily {
  // A state's "Secretary of State" is not a Cabinet title; only a national holder is read against the White House list.
  const national = holder.id.startsWith("white-house:") || holder.officeJurisdictionOcdId === COUNTRY;
  const house = national ? whiteHouseOffice(holder.officeTitle) : null;
  if (house === "president" || house === "vice-president") return "president";
  if (house) return "cabinet";
  if (holder.id.startsWith("congress:")) return "legislative";
  const key = officeIdentity(holder.officeTitle);
  if (key && LEGISLATIVE.has(key)) return "legislative";
  if (key && EXECUTIVE.has(key)) return "executive";
  return "other";
}

/** "Confirmation" exists only for an office the Senate confirms; no other card has it. */
const SECTIONS: Record<OfficeFamily, readonly PersonCardSectionId[]> = {
  president: ["office", "positions", "money", "sources"],
  cabinet: ["office", "confirmation", "sources"],
  executive: ["office", "positions", "money", "sources"],
  legislative: ["office", "positions", "committees", "offices", "money", "record", "sources"],
  other: ["office", "positions", "committees", "offices", "money", "record", "sources"],
};

/** The sections this office has; "still gathering" is only ever said about one of these. */
export function officeCardSections(holder: Parameters<typeof officeFamily>[0]): readonly PersonCardSectionId[] {
  return SECTIONS[officeFamily(holder)];
}

/** Whether the card's "Official actions" belongs to this office; a legislator's actions are their votes and bills. */
export function officeHasActions(holder: Parameters<typeof officeFamily>[0]): boolean {
  return officeFamily(holder) !== "legislative";
}
