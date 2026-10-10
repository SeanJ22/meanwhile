/** An office is not a geography: a canonical office key, so incumbency matches a seat by office as well as division. */

/**
 * A canonical office. Two titles carrying the same key name the same office.
 *
 * The keys are internal join keys and never reach a reader — the reader sees
 * the source's own title, which is the one their government publishes.
 */
export type OfficeKey = string;

interface OfficeRule {
  key: OfficeKey;
  /** Matched against the title with district/ward/term furniture stripped. */
  pattern: RegExp;
  /** Why this rule exists, where the mapping is not self-evident. */
  note?: string;
}

/** Strip everything that names which seat rather than which office (district, ward, unexpired term). */
export function stripSeatFurniture(title: string): string {
  return String(title ?? "")
    .replace(/—|–/g, "-")
    .replace(/\s*\(\s*\d+\s*(?:st|nd|rd|th)?\s*(?:congressional\s+)?district[^)]*\)/gi, " ")
    .replace(/\s*\([^)]*seats?[^)]*\)/gi, " ")
    .replace(/[,\-\s]*\b(?:district|ward|position|seat|division)\b[\s:#]*[0-9ivxlc]+\b/gi, " ")
    .replace(/[,\-\s]*\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+district\b/gi, " ")
    .replace(/\bunexpired\s+term\b/gi, " ")
    .replace(/\bat[-\s]large\b/gi, " ")
    .replace(/[\s,\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The rules, most specific first; order matters. */
const RULES: OfficeRule[] = [
  {
    key: "us_senator",
    pattern: /^(?:member of the )?(?:u\.?s\.?|united states) senat(?:or|e)$/i,
    note: "AZ/NH write 'United States Senator'; NJ writes 'Member of the United States Senate'; the officeholder index writes 'U.S. Senator'. One office.",
  },
  {
    key: "us_representative",
    pattern:
      /^(?:member of the )?(?:u\.?s\.?|united states) (?:representative|house of representatives)$|^representative in congress$|^member of the house of representatives$/i,
    note: "NH writes 'Representative in Congress', NJ 'Member of the House of Representatives', AZ 'U.S. Representative'.",
  },

  { key: "governor", pattern: /^governor$/i },
  { key: "lieutenant_governor", pattern: /^lieutenant governor$/i },
  { key: "secretary_of_state", pattern: /^secretary of state$/i },
  { key: "attorney_general", pattern: /^(?:state )?attorney general$/i },
  { key: "state_treasurer", pattern: /^(?:state )?treasurer$/i },
  {
    key: "superintendent_of_public_instruction",
    pattern: /^superintendent of public instruction$/i,
    note: "ELECTED statewide in Arizona. Checked before any generic superintendent rule; see elected-role.ts, where the plain title is on the APPOINTED list.",
  },
  {
    key: "state_mine_inspector",
    pattern: /^(?:arizona )?(?:state )?mine inspector$/i,
    note: "The BALLOT writes 'State Mine Inspector' and the OFFICE writes both 'Arizona State Mine Inspector' (asmi.az.gov masthead) and, on its own team page, the bare role. `State` was required here until 2026-08-28, so a holder recorded under the office's own shorter spelling classified as null and silently failed to join its own seat — the failure mode this vocabulary exists to make loud.",
  },
  { key: "corporation_commissioner", pattern: /^corporation commissioner$/i },
  { key: "state_auditor", pattern: /^state auditor$/i },
  { key: "state_comptroller", pattern: /^(?:state )?comptroller$/i },
  { key: "insurance_commissioner", pattern: /^insurance commissioner$/i },
  { key: "chief_election_officer", pattern: /^chief election officer$/i },

  {
    key: "state_senator",
    pattern: /^state senator$/i,
  },
  {
    key: "state_lower_house",
    pattern: /^(?:state representative|state assembly ?(?:member|man|woman)?|assembly ?member|member of the (?:general )?assembly|state representative, [a-z ]+ county)$/i,
    note: "The lower chamber, whatever the state calls it. NJ's officeholder index records 'Assemblymember'; NH and AZ record 'State Representative'. A New Jersey assembly seat and an Arizona house seat are never compared to each other — they cannot share a division — so one key is safe and stops NJ failing to match its own members.",
  },
  {
    key: "executive_councilor",
    pattern: /^executive council(?:or|lor)$/i,
    note: "New Hampshire's Executive Council. It shares place divisions with county offices, which is exactly why it needs its own key.",
  },

  { key: "county_commissioner", pattern: /^(?:member of the )?(?:board of )?county commissioners?$|^[a-z ]+ county commissioner$/i },
  { key: "county_supervisor", pattern: /^(?:member of the )?(?:board of )?(?:county )?supervisors?$|^county supervisor$/i },
  { key: "county_sheriff", pattern: /^(?:[a-z ]+ county )?sheriff$/i },
  { key: "county_attorney", pattern: /^(?:[a-z ]+ county )?(?:county )?attorney$/i },
  { key: "county_treasurer", pattern: /^[a-z ]+ county treasurer$/i },
  { key: "register_of_deeds", pattern: /^(?:[a-z ]+ county )?register of deeds$/i },
  { key: "register_of_probate", pattern: /^(?:[a-z ]+ county )?register of probate$/i },
  { key: "county_clerk", pattern: /^(?:[a-z ]+ county )?(?:county )?clerk$/i },
  { key: "county_assessor", pattern: /^(?:[a-z ]+ county )?assessor$/i },
  { key: "county_recorder", pattern: /^(?:[a-z ]+ county )?recorder$/i },

  { key: "mayor", pattern: /^mayor$/i },
  {
    key: "municipal_council",
    pattern:
      /^(?:member of the )?(?:borough|town|township|city|village|common) council$|^(?:member of the )?(?:township|town) committee$|^council ?(?:member|man|woman)$|^alder(?:man|woman|person)$|^(?:member of the )?board of (?:selectmen|aldermen|trustees)$|^select ?(?:board|man|woman|person)$/i,
    note: "New Jersey alone writes this five ways across Morris County: Borough Council, Town Council, Township Council, Township Committee, and Board of Education is deliberately NOT among them. All five are the municipality's governing council, and a mayor is not one of them — that separation is Red Control 1's municipal half.",
  },

  {
    key: "school_board",
    pattern: /^(?:member of the )?(?:regional )?board of education$|^(?:member of the )?school (?:board|committee)$|^(?:member of the )?governing board$/i,
  },
];

/** The canonical office a title names, or null (rendered UNKNOWN). A ballot measure is not an office. */
export function officeIdentity(title: string | null | undefined): OfficeKey | null {
  const stripped = stripSeatFurniture(title ?? "");
  if (!stripped) return null;
  // A ballot measure must not fall through to an office rule on a stray word in its long title.
  if (/^(?:proposition|question|measure|referendum|public question|amendment|bond)\b/i.test(stripped)) {
    return null;
  }
  for (const rule of RULES) {
    if (rule.pattern.test(stripped)) return rule.key;
  }
  return null;
}

/** True when two titles name the same office. Neither may be unclassified. */
export function sameOffice(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = officeIdentity(a);
  if (left === null) return false;
  return left === officeIdentity(b);
}

/** Which titles the vocabulary does not classify: the offices whose incumbency renders UNKNOWN until a rule exists. */
export function unclassifiedOfficeTitles(titles: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of titles) {
    const stripped = stripSeatFurniture(t ?? "");
    if (!stripped) continue;
    if (officeIdentity(t) === null && !/^(?:proposition|question|measure|referendum|public question|amendment|bond)\b/i.test(stripped)) {
      out.add(stripped);
    }
  }
  return [...out].sort();
}

/** Every office key the vocabulary currently knows. */
export function knownOfficeKeys(): OfficeKey[] {
  return [...new Set(RULES.map((r) => r.key))].sort();
}
