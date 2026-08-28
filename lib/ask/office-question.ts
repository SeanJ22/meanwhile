import {
  OFFICE_BLURBS,
  type OfficeBlurb,
  type OfficeType,
} from "../officials/office-blurbs.ts";

/**
 * **"WHAT DOES THE GOVERNOR DO?" — THE OFFICE THE READER NAMED.**
 * (ASK-14, the 2026-08-28 reader-feedback sweep.)
 *
 * ## The defect, and which of the two possible causes it actually was
 *
 * A reader typed *"What does the governor do"* into the ballot's Ask box and
 * got:
 *
 * > We have not recorded anything that answers that yet. Naming a government —
 * > a school district, a county board, a person on this ballot — is what this
 * > can answer from.
 *
 * There are two very different reasons that could happen, and they need
 * different repairs: either the canonical office-function data does not exist,
 * or it exists and Ask cannot reach it. **Measured on 2026-08-28, against the
 * running app, it is the second.**
 *
 * `lib/officials/office-blurbs.ts` holds TWENTY-SIX sourced office definitions
 * and `governor` is one of them, has been rendered on every battlecard under
 * "What this office does" since BC-6, and carries its basis in the Arizona
 * Constitution. Nothing needed writing. The grounded pipeline simply never
 * asked.
 *
 * The trace says exactly where it stopped:
 *
 * ```
 * interpretation  intent: CIVICS      <- the classifier was right
 * resolution      state: NONE         <- nothing to bind to
 * retrieval       recordCount: 0
 * answerMode      NO_EVIDENCE
 * ```
 *
 * `lib/ask/resolve.ts` turns ENTITY MENTIONS into a canonical government, and
 * "the governor" mentions no entity — it names an OFFICE. With no binding
 * there is no subject, with no subject there is no retrieval, and a store full
 * of the exact answer sat one function call away. The unnamed control behaves
 * identically: *"What does a county supervisor do?"* also classified CIVICS
 * and also resolved to nothing, so this was never about the governor.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is a lookup from the words a reader uses for an office to the office type
 * the product already has a sourced definition for. It is a VOCABULARY, in the
 * `CLAUDE.md` sense: what the project knows people call these jobs now, never
 * complete, and extended when a reader says something it does not know.
 *
 * It is **not** a civics generator. It returns a stored, sourced blurb or it
 * returns null. A question naming an office we hold no definition for gets
 * nothing from here, and the honest gap stands — the answer to a missing
 * definition is to read the statute and record it, never to have a model
 * describe the office from memory.
 *
 * ## Why matching is on whole words, longest first
 *
 * "county attorney" contains "attorney", and "superintendent of public
 * instruction" contains "superintendent" — two offices that are genuinely
 * different jobs. Matching the longest phrase first is what keeps a reader
 * asking about their county attorney from being told what the state attorney
 * general does. Substring matching without word boundaries is worse still:
 * "mayor" appears inside no other office, but "clerk" appears inside "county
 * clerk", and a bare `includes` would answer the wrong one roughly half the
 * time.
 */

/**
 * What readers call each office.
 *
 * Ordered longest-phrase-first at match time, not here. The plural and the
 * possessive are handled by the matcher rather than being enumerated.
 */
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

/**
 * The office a question is asking about, or null.
 *
 * Longest phrase wins, so "county attorney" beats "attorney general"'s
 * "attorney" and "superintendent of public instruction" beats
 * "superintendent". A tie cannot happen: the phrase list holds no duplicates,
 * and the length comparison is over the matched phrase rather than the office
 * name.
 */
export function officeInQuestion(question: string): OfficeMatch | null {
  const haystack = normalize(question);

  let best: { office: OfficeType; phrase: string } | null = null;
  for (const entry of OFFICE_VOCABULARY) {
    for (const phrase of entry.phrases) {
      // Whole-phrase, whole-word. The padding on both sides is what makes
      // "clerk" fail to match inside "county clerk" — see the module note.
      if (!haystack.includes(` ${phrase} `)) continue;
      if (best === null || phrase.length > best.phrase.length) {
        best = { office: entry.office, phrase };
      }
    }
  }

  if (best === null) return null;
  return { office: best.office, phrase: best.phrase, blurb: OFFICE_BLURBS[best.office] };
}

/**
 * Whether this question is one this module should answer at all.
 *
 * The intent classifier decides CIVICS; this is the second half of that
 * decision, and it is deliberately conservative. *"Who is the governor?"*
 * names an office but asks for a PERSON, and answering it with a job
 * description would be the product not listening. Only a question about what
 * the office DOES belongs here.
 */
const ASKS_WHAT_IT_DOES =
  /\b(what|which|how)\b[\s\S]*\b(do|does|doing|decide|decides|control|controls|responsible|power|powers|handle|handles|job|role|run|runs|oversee|oversees|in charge)\b/i;

export function asksWhatAnOfficeDoes(question: string): boolean {
  return ASKS_WHAT_IT_DOES.test(question);
}
