/** An appointed role is never labelled "Incumbent": the label claims the reader chose this person and can unchoose them. */

/** Titles a body hires rather than a public elects. Where a jurisdiction elects one, record that per jurisdiction. */
const APPOINTED_TITLES: RegExp[] = [
  /\bsuperintendent\b/i,
  /\b(business |school )?administrator\b/i,
  /\b(town|city|county|borough|township|village|district) manager\b/i,
  /\bexecutive director\b/i,
  /\bdistrict clerk\b/i,
  /\b(chief|deputy chief) of staff\b/i,
  /\bcommissioner of\b/i,
  /\bacting director\b/i,
  /\bprincipal\b/i,
];

/** Titles that are elected even though an appointed pattern might reach them; kept small on purpose. */
const ELECTED_EXCEPTIONS: RegExp[] = [
  /\bcounty clerk\b/i,
  /\bcounty surrogate\b/i,
  /\bsheriff\b/i,
  /\bsuperintendent of public instruction\b/i,
];

export type RoleSelection = "ELECTED" | "APPOINTED";

/** Whether the public elects this role. A null or empty title reads as elected. */
export function roleSelectionFor(officeTitle: string | null | undefined): RoleSelection {
  const title = (officeTitle ?? "").trim();
  if (title === "") return "ELECTED";
  if (ELECTED_EXCEPTIONS.some((re) => re.test(title))) return "ELECTED";
  return APPOINTED_TITLES.some((re) => re.test(title)) ? "APPOINTED" : "ELECTED";
}

/** May an `Incumbent` / `Challenger` chip attach to this role at all? */
export function standingChipMayAttach(officeTitle: string | null | undefined): boolean {
  return roleSelectionFor(officeTitle) === "ELECTED";
}
