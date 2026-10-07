import {
  OFFICE_BLURBS,
  type OfficeBlurb,
  type OfficeType,
} from "../officials/office-blurbs.ts";

/**
 * "What does the governor do?": a question naming an office, not an entity,
 * looked up in the words readers use for offices and answered from the stored,
 * sourced definitions in `lib/officials/office-blurbs.ts`. Never a civics
 * generator: an office with no stored definition returns null. Matching is on
 * whole words, longest phrase first, so "county attorney" is not read as
 * "attorney general" and "clerk" does not match inside "county clerk".
 */

/** What readers call each office. Ordered longest first at match time; plurals and possessives are the matcher's. */
const OFFICE_VOCABULARY: ReadonlyArray<{
  office: OfficeType;
  phrases: readonly string[];
}> = [
  { office: "governor", phrases: ["governor"] },
  {
    office: "us-senator",
    phrases: ["us senator", "u s senator", "united states senator", "senator in congress", "federal senator"],
  },
  {
    office: "us-representative",
    phrases: [
      "us representative",
      "u s representative",
      "member of congress",
      "congressman",
      "congresswoman",
      "congressperson",
      "house representative",
    ],
  },
  { office: "state-senator", phrases: ["state senator", "state senate member"] },
  {
    office: "state-representative",
    phrases: ["state representative", "state house member", "assemblymember", "assemblyman", "assemblywoman"],
  },
  {
    office: "county-commissioner",
    phrases: ["county supervisor", "county commissioner", "board of supervisors member", "supervisor"],
  },
  {
    office: "school-board",
    phrases: ["school board", "school board member", "governing board member", "board of education member"],
  },
  {
    office: "superintendent-public-instruction",
    phrases: ["superintendent of public instruction", "state superintendent"],
  },
  { office: "superintendent", phrases: ["school superintendent", "superintendent"] },
  { office: "mayor", phrases: ["mayor"] },
  { office: "city-council", phrases: ["city council", "city councilmember", "council member", "councilmember", "alderman"] },
  { office: "select-board", phrases: ["select board", "selectboard", "selectman", "selectwoman", "selectperson"] },
  { office: "executive-councilor", phrases: ["executive councilor", "executive council"] },
  { office: "secretary-of-state", phrases: ["secretary of state"] },
  { office: "attorney-general", phrases: ["attorney general"] },
  { office: "state-treasurer", phrases: ["state treasurer"] },
  { office: "mine-inspector", phrases: ["mine inspector"] },
  { office: "corporation-commissioner", phrases: ["corporation commissioner", "corporation commission"] },
  { office: "county-sheriff", phrases: ["county sheriff", "sheriff"] },
  { office: "county-attorney", phrases: ["county attorney", "district attorney", "prosecutor"] },
  { office: "county-treasurer", phrases: ["county treasurer", "treasurer"] },
  { office: "register-of-deeds", phrases: ["register of deeds", "recorder of deeds", "county recorder"] },
  { office: "register-of-probate", phrases: ["register of probate"] },
  { office: "county-surrogate", phrases: ["county surrogate", "surrogate"] },
  { office: "county-clerk", phrases: ["county clerk", "clerk of the board", "county clerk of court"] },
];

/** Lowercase, strip punctuation, collapse spaces. Never changes word order. */
function normalize(question: string): string {
  return ` ${question
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export interface OfficeMatch {
  office: OfficeType;
  /** The exact phrase the reader used, for the trace. */
  phrase: string;
  blurb: OfficeBlurb;
}

/** The office a question asks about, or null. Longest phrase wins. */
export function officeInQuestion(question: string): OfficeMatch | null {
  const haystack = normalize(question);

  let best: { office: OfficeType; phrase: string } | null = null;
  for (const entry of OFFICE_VOCABULARY) {
    for (const phrase of entry.phrases) {
      // Whole phrase, whole word: the padding keeps "clerk" from matching inside "county clerk".
      if (!haystack.includes(` ${phrase} `)) continue;
      if (best === null || phrase.length > best.phrase.length) {
        best = { office: entry.office, phrase };
      }
    }
  }

  if (best === null) return null;
  return { office: best.office, phrase: best.phrase, blurb: OFFICE_BLURBS[best.office] };
}

/** Only a question about what the office does belongs here; "Who is the governor?" asks for a person. */
const ASKS_WHAT_IT_DOES =
  /\b(what|which|how)\b[\s\S]*\b(do|does|doing|decide|decides|control|controls|responsible|power|powers|handle|handles|job|role|run|runs|oversee|oversees|in charge)\b/i;

export function asksWhatAnOfficeDoes(question: string): boolean {
  return ASKS_WHAT_IT_DOES.test(question);
}
