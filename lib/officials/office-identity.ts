/**
 * **AN OFFICE IS NOT A GEOGRAPHY.**
 * (2026-08-27, the coverage-truth session. Red Control 1.)
 *
 * ## The defect
 *
 * Ballot incumbency asked `seatHoldersForDivision(contest.ocdId)` — *who holds
 * something in this division?* — and treated the answer as *who holds THIS
 * SEAT?*. Those are the same question only when a division hosts exactly one
 * elected office, and the pilot ballots say otherwise everywhere:
 *
 * ```
 * ocd-division/country:us/state:az      Governor · Secretary of State · Attorney General
 *                                       State Treasurer · Superintendent of Public Instruction
 *                                       State Mine Inspector · Corporation Commissioner
 *                                       ... and the officeholder index holds the two U.S. SENATORS
 * ocd-division/country:us/state:nh      Governor · United States Senator
 * .../state:nj/place:butler             Mayor · Member of the Borough Council
 * .../place:newbury_town                Executive Councilor · Merrimack County Commissioner
 * .../county:merrimack                  Sheriff · Attorney · Treasurer · Register of Deeds
 *                                       · Register of Probate
 * ```
 *
 * The reader-visible consequence, measured on `main` at `9e75bea`:
 * `seatHoldersForDivision("ocd-division/country:us/state:az")` returns **Mark
 * Kelly and Ruben Gallego**. Katie Hobbs — the sitting Governor, whose office,
 * party, phone, email and official page this repository already holds and
 * renders on her map card — matched neither name, so the Governor contest
 * labelled her **Challenger**. Two surfaces, one person, opposite claims.
 *
 * And it was never only Hobbs: every AZ statewide candidate on that ballot was
 * being judged against two U.S. Senators, and a council member running for
 * mayor in Butler or Chester would have been handed the council's incumbency.
 *
 * ## What this module is
 *
 * The canonical identity of an OFFICE, derived from the title a source
 * publishes. It is deliberately the smallest thing that fixes the class: a
 * contest and an officeholder resolve to the same office key, or they do not
 * describe the same seat.
 *
 * ```
 * SEAT = (division, office)          <- what a ballot contest names
 *      + the sitting members of it   <- what the officeholder index answers
 * ```
 *
 * The DISTRICT is already carried by the division (`sldl:17` is District 17),
 * so it is not part of the office key — putting it there would make "State
 * Representative, District 17" fail to match a holder recorded as "State
 * Representative" on that same division, which is how every one of them is
 * recorded. Multi-member seats need no special case for the same reason: both
 * sitting members of `sldl:17` carry the same office on the same division, so
 * both are returned, and both resolve as incumbents.
 *
 * ## The unrecognised title is a NAMED GAP, never a fallback
 *
 * `officeIdentity` returns `null` for a title it cannot classify, and every
 * caller must treat that as UNKNOWN. It must never fall back to the
 * division-wide list — that is the defect, restored — and it must never fall
 * back to `Challenger`, which is a claim about a named person.
 *
 * **This vocabulary is what the project knows now.** It is built from the 52
 * distinct office titles on the four pilot ballots and the 6 distinct titles in
 * the officeholder index, and a 53rd will arrive with the next jurisdiction.
 * `unclassifiedOfficeTitles` exists so a session can ask what the vocabulary is
 * currently missing rather than discovering it as a silent UNKNOWN.
 */

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

/**
 * Strip everything that names WHICH seat rather than WHICH office.
 *
 * `State Representative, District 17` and `State Representative` are the same
 * office; the district is the division's job. `Member of the Township Council
 * Unexpired Term` is the same office as `Member of the Township Council` — an
 * unexpired term is a term length, not a different job — and treating them as
 * different offices would make a sitting member of that council fail to match
 * their own seat.
 */
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

/**
 * The rules, most specific first.
 *
 * ORDER MATTERS and the first two prove why: `Superintendent of Public
 * Instruction` is an ELECTED statewide office in Arizona and is on this ballot,
 * while `superintendent` is on `elected-role.ts`'s appointed list. The specific
 * rule is checked before anything generic can reach it.
 */
const RULES: OfficeRule[] = [
  /* ---------------------------------------------------------------- federal */
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

  /* --------------------------------------------------- statewide executives */
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

  /* ------------------------------------------------------------ legislature */
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

  /* ---------------------------------------------------------------- county */
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

  /* ------------------------------------------------------------- municipal */
  { key: "mayor", pattern: /^mayor$/i },
  {
    key: "municipal_council",
    pattern:
      /^(?:member of the )?(?:borough|town|township|city|village|common) council$|^(?:member of the )?(?:township|town) committee$|^council ?(?:member|man|woman)$|^alder(?:man|woman|person)$|^(?:member of the )?board of (?:selectmen|aldermen|trustees)$|^select ?(?:board|man|woman|person)$/i,
    note: "New Jersey alone writes this five ways across Morris County: Borough Council, Town Council, Township Council, Township Committee, and Board of Education is deliberately NOT among them. All five are the municipality's governing council, and a mayor is not one of them — that separation is Red Control 1's municipal half.",
  },

  /* ---------------------------------------------------------------- school */
  {
    key: "school_board",
    pattern: /^(?:member of the )?(?:regional )?board of education$|^(?:member of the )?school (?:board|committee)$|^(?:member of the )?governing board$/i,
  },
];

/**
 * The canonical office a title names, or `null` when the vocabulary does not
 * classify it.
 *
 * `null` is a real answer and callers must render it as UNKNOWN. It is returned
 * for a ballot MEASURE too — a proposition has no officeholder, and asking who
 * holds Proposition 141 is not a question.
 */
export function officeIdentity(title: string | null | undefined): OfficeKey | null {
  const stripped = stripSeatFurniture(title ?? "");
  if (!stripped) return null;
  /*
   * A ballot measure is not an office and must not fall through to the
   * municipal-council rule on the strength of a stray word in its long title.
   * Checked before the rules rather than inside them, because the shape is the
   * disqualifier, not any particular wording.
   */
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

/**
 * Which of these titles the vocabulary does not classify.
 *
 * **A taxonomy is never complete** (CLAUDE.md), so the useful question is not
 * "is it finished" but "what is it currently missing". A session adding a
 * jurisdiction runs this over that jurisdiction's contest titles and gets the
 * list of offices whose incumbency will render UNKNOWN until a rule exists —
 * before a reader finds out instead.
 */
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
