/**
 * Reader-ready names, from one formatter. Portals, registries and adapters
 * hand over the same body in different shapes ("GOVERNING BOARD AGENDA REGULAR
 * MEETING", "New York city", "Board Of Supervisors", "… (RAC)"); every surface
 * that prints a body or a party asks here. The rules are about the SHAPE of a
 * name, never about one body.
 *
 * Pure and client-safe: no registry, no geometry, no fetch.
 */

const SMALL_WORDS = new Set(["of", "and", "the", "for", "on", "in", "to", "at", "by", "a", "an", "or", "as", "but", "nor", "with", "from"]);

/** The shared, deliberately short list of acronyms readers should still see. */
export const READER_ACRONYMS: ReadonlySet<string> = new Set([
  "FEMA", "YMCA", "BART", "PAC", "LLC", "US", "USA", "FEC", "CISA", "PRL",
  "EPA", "IRS", "HUD", "FBI", "NASA", "NAACP", "ACLU", "ADA", "PTA", "PTO", "CAP", "SAM", "UEI", "ZIP", "ID",
  "ESA", "BCYF", "IBA", "BESE", "CCD", "HTTP", "HTTPS", "HTML", "PDF",
  "SD", "ISD", "CISD", "USD", "CUSD", "CSD", "UFSD", "ESD", "HSD", "UHSD",
  "EST", "EDT", "CST", "CDT", "MST", "MDT", "PST", "PDT", "AKST", "AKDT", "HST",
]);

const NAME_SUFFIXES = new Set(["II", "III", "IV", "V", "VI"]);
/** Acronyms that are also given names ("SAM GRAVES", "ADA SMITH"); a person's name cases them as words. */
const NAME_LIKE_ACRONYMS = new Set(["SAM", "ADA", "CAP"]);
const POSTAL_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split(" "));
const NAME_SPELLINGS: Readonly<Record<string, string>> = {
  DECROCE: "DeCroce", DIMAIO: "DiMaio", DELGAUDIO: "DelGaudio", LAVECCHIA: "LaVecchia",
  MACARTHUR: "MacArthur", MACDONALD: "MacDonald", MACDOUGALL: "MacDougall",
  MACGREGOR: "MacGregor", MACINTOSH: "MacIntosh", MACKENZIE: "MacKenzie",
  MACLEOD: "MacLeod", MACPHERSON: "MacPherson", MACINTYRE: "MacIntyre",
  MACLEAN: "MacLean", MACNEIL: "MacNeil", MACMILLAN: "MacMillan", MACKAY: "MacKay",
};

export type ReaderTextMode = "name" | "title" | "address" | "sentence";

function nameWord(word: string): string {
  const spelling = NAME_SPELLINGS[word.toUpperCase()];
  if (spelling) return spelling;
  if (/^mc\p{L}/iu.test(word)) return `Mc${titleCaseWord(word.slice(2))}`;
  if (/^[odl]['’]\p{L}/iu.test(word)) return `${word[0].toUpperCase()}${word[1]}${nameWord(word.slice(2))}`;
  return titleCaseWord(word);
}

/**
 * Display only. Case each shouting word, even when the rest is mixed case.
 * Sentence text keeps existing mixed-case spellings and restores held names
 * supplied by the card; no source record or quotation is ever rewritten.
 */
export function readerText(raw: string, mode: ReaderTextMode = "title", knownNames: readonly string[] = []): string {
  // A lone capital in mixed-case text ("Hearing Room A") is a label the source chose, not shouting.
  const mixedCase = /\p{Ll}/u.test(raw);
  // Licence names such as "CC BY 4.0" and "CC BY-SA" are codes, written as published.
  const kept = [...raw.matchAll(/\bCC(?:[ -](?:BY|SA|NC|ND|0))+\b/g)].map(match => [match.index, match.index + match[0].length]);
  let first = true;
  let sentenceStart = true;
  let previousEnd = 0;
  let text = raw.replace(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu, (word, offset: number) => {
    const between = raw.slice(previousEnd, offset);
    if (/[.!?](?:[\s\u201d\u2019"')\]]+|$)|\n\s*\n/.test(between)) sentenceStart = true;
    previousEnd = offset + word.length;
    if (kept.some(([start, end]) => offset >= start && offset < end)) return word;
    const upper = word.toUpperCase();
    const shouting = word === upper && word !== word.toLowerCase();
    const namePrefix = /^(?:Mc|Mac)[A-Z]{2,}$/.test(word);
    const atStart = first;
    first = false;
    const startsSentence = sentenceStart;
    sentenceStart = false;
    if (word.length === 1 && (mode === "name" || raw[previousEnd] === "." || mixedCase
      || /^[\s.,;:)\]]*$/.test(raw.slice(previousEnd)))) return word;
    if (/^(?:AM|PM)$/.test(word) && /\d\s*$/.test(raw.slice(0, offset))) return word;
    if (/\d$/.test(raw.slice(0, offset)) && /^(?:ST|ND|RD|TH)$/.test(word)) return word.toLowerCase();
    // Case-sensitive identifiers such as a federal entity's UEI are not words.
    if (/\d/.test(raw[offset - 1] ?? "") || /\d/.test(raw[previousEnd] ?? "")) return word;
    if (word === "I" && mode === "sentence") return word;
    if ((READER_ACRONYMS.has(word) && !(mode === "name" && NAME_LIKE_ACRONYMS.has(word))) || NAME_SUFFIXES.has(word)) return word;
    if (shouting) {
      const plural = /^(.*?)(['’]?S)$/.exec(word);
      if (plural && READER_ACRONYMS.has(plural[1])) return `${plural[1]}${plural[2].toLowerCase()}`;
    }
    // A state after a comma or a "State:" label ("Morris County, NJ", "Vail, AZ 85641") is a postal code in every mode.
    if (POSTAL_CODES.has(word) && /(?:,|\bstate:)\s*$/i.test(raw.slice(0, offset))
      && /^(?:\s*\d{5}(?:-\d{4})?)?(?:[\s,]+USA)?\s*(?:$|[—–·|(),;.]|\s-\s)/.test(raw.slice(previousEnd))) return word;
    // Party-state and district codes: "(R-TX)", "TX-23".
    if (POSTAL_CODES.has(word) && (/(?:^|[\s(])[A-Z]-$/.test(raw.slice(0, offset)) || /^-\d/.test(raw.slice(previousEnd)))) return word;
    if (mode === "address" && (word === "PO" || /^(?:N|S|E|W|NE|NW|SE|SW)$/.test(word)
      || (POSTAL_CODES.has(word) && /^[\s,]*(?:\d{5}(?:-\d{4})?)?(?:[\s,]+USA)?\s*$/i.test(raw.slice(previousEnd))))) return word;
    // A phrase opened by a bracket, colon, dash or new sentence starts capitalised: "campaign money (The source …)".
    const phraseStart = atStart || /(?:[([:—–]|[.!?]\s)\s*$/.test(raw.slice(0, offset));
    if (mode !== "sentence" && !phraseStart && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    if (!shouting && !namePrefix) return word;
    if (mode === "sentence") return startsSentence ? titleCaseWord(word) : word.toLowerCase();
    return nameWord(word);
  });
  if (mode === "sentence" && knownNames.length) {
    // Match complete names longest first, so a held "New York City" beats "New York".
    const names = [...new Set(knownNames.filter(name => name.trim()))].sort((a, b) => b.length - a.length);
    const spellings = new Map(names.map(name => [name.toLowerCase(), readerText(name, "title")]));
    const pattern = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "giu"), name => spellings.get(name.toLowerCase()) ?? name);
  }
  return text;
}

/** Words a portal appends to a body's name to describe the SITTING, not the body. */
const SITTING_WORDS = new Set([
  "agenda",
  "agendas",
  "regular",
  "special",
  "executive",
  "session",
  "study",
  "meeting",
  "meetings",
  "public",
  "virtual",
  "only",
  "hearing",
  "workshop",
  "work",
]);

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_NOISE = [
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
];

/** An acronym in brackets abbreviates the body ("(RAC)"); it never names it. */
const ACRONYM_PAREN = /\s*\([A-Z0-9&/.-]{2,12}\)/g;
/** A bracket that describes the sitting: "(Virtual Only)", "(Cancelled)". */
const SITTING_PAREN =
  /\s*\([^)]*\b(?:virtual|hybrid|online|in[- ]person|only|cancel+ed|rescheduled|special|regular)\b[^)]*\)/gi;

/** Census legal-area suffixes a derived label keeps in lower case ("New York city"). */
const PLACE_SUFFIX = /\s(city|town|village|borough|township|county|parish)$/;

function titleCaseWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "New York city" -> "New York City": the suffix is part of the name. */
function capitaliseSuffix(text: string): string {
  const match = PLACE_SUFFIX.exec(text);
  if (!match) return text;
  const stem = text.slice(0, match.index);
  // Only a name that is otherwise capitalised; "the city" in a sentence is not one.
  if (!/^[A-Z]/.test(stem)) return text;
  return `${stem} ${titleCaseWord(match[1])}`;
}

/**
 * A body's name as a reader would say it.
 *
 * Strips what a portal adds about the SITTING (agenda, regular meeting, a
 * date, "(Virtual Only)", an acronym in brackets), title-cases a shouting
 * name, and puts the small words back in lower case. A name that is nothing
 * but sitting words comes back cleaned of case only, never emptied.
 */
export function readerBodyName(raw: string): string {
  const original = raw.replace(/\s+/g, " ").trim();
  if (original === "") return original;

  let text = original.replace(ACRONYM_PAREN, "").replace(SITTING_PAREN, "");
  for (const pattern of DATE_NOISE) text = text.replace(pattern, "");
  text = text.replace(/\s+[-–—:]\s*$/, "").replace(/\s{2,}/g, " ").trim();

  // Trailing sitting words, one at a time, so "Audit Committee Meeting Agenda"
  // is a committee and "Public Housing Authority Board" keeps its "Public".
  const words = text.split(" ");
  while (words.length > 1 && SITTING_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ""))) {
    words.pop();
  }
  // A leading "Virtual" describes the sitting too ("Virtual Governing Board").
  while (words.length > 1 && /^virtual$/i.test(words[0])) words.shift();
  text = words.join(" ").replace(/\s+[-–—:,]\s*$/, "").trim();

  // Nothing but sitting words left means the portal gave us no body at all.
  if (text.length < 2 || words.every((w) => SITTING_WORDS.has(w.toLowerCase()))) text = original;
  return capitaliseSuffix(readerText(text));
}

/**
 * The government a derived body stands for, when the registry holds no name for
 * the body itself: a county ("<Name>" → "<Name> County"), "New York city" →
 * "New York City", and a Census "<Name> Unified District" → "<Name> Unified
 * School District".
 */
export function readerGovernmentName(label: string, divisionType: string | null): string {
  let name = readerText(label.replace(/\s+/g, " ").trim());
  name = name.replace(/\bcmty\b/gi, "Community").replace(/\bsch(?:l)?\b/gi, "School")
    .replace(/\bdist\b\.?/gi, "District").replace(/\bcnty\b/gi, "County")
    .replace(/\bcoll\b\.?/gi, "College").replace(/\b(\d+)([a-z]{1,2})\b/gi, (_all, number, letters) => `${number}${letters.toUpperCase()}`);
  // Census uses both "County Of Multnomah" and "Multnomah county".
  name = name.replace(/^(county|parish|borough) of (.+)$/i, (_all, kind, place) => `${place} ${titleCaseWord(kind)}`);
  name = capitaliseSuffix(name);
  if (name === "") return name;
  if (divisionType === "county" && !/\b(county|parish|borough)$/i.test(name) && !/^(?:county|parish|borough) of\b/i.test(name)) {
    name = `${name} County`;
  } else if (divisionType === "school_district" && /\sDistrict$/.test(name) && !/\b(?:School|College|Education)\b/i.test(name)) {
    name = name.replace(/\sDistrict$/, " School District");
  }
  return name;
}

/** What every surface prints for a covered body: its name, else the government it is. */
export function bodyDisplayName(body: {
  name: string | null;
  divisionLabel: string;
  divisionType: string | null;
  bodyClass?: string;
}): string {
  return body.name !== null && body.name.trim() !== ""
    ? body.bodyClass === "MEETING_TYPE" ? readerGovernmentName(body.name, null) : readerBodyName(body.name)
    : readerGovernmentName(body.divisionLabel, body.divisionType);
}

/**
 * A search answer with every body name formatted, applied once as it arrives so
 * the list, the popup, the search box, the filters and the who-governs card all
 * read the same name. Only names change; ids, counts and order do not.
 */
export function withReaderNames<
  R extends {
    meetings: ReadonlyArray<{ bodyName: string; jurisdiction?: string }>;
    coverage: { bodies: ReadonlyArray<{ name: string | null; divisionLabel?: string; divisionType?: string | null; bodyClass?: string }>; governments?: ReadonlyArray<{name:string}> } | null;
  },
>(result: R): R {
  return {
    ...result,
    meetings: result.meetings.map((m) => ({ ...m, bodyName: readerBodyName(m.bodyName),
      ...(m.jurisdiction ? { jurisdiction:readerGovernmentName(m.jurisdiction,null) } : {}) })),
    coverage: result.coverage
      ? {
          ...result.coverage,
          bodies: result.coverage.bodies.map((b) => ({ ...b, ...(b.name === null ? {} : { name: b.bodyClass === "MEETING_TYPE" ? readerGovernmentName(b.name, null) : readerBodyName(b.name) }),
            ...(b.divisionLabel ? { divisionLabel: readerGovernmentName(b.divisionLabel,b.divisionType ?? null) } : {}) })),
          ...(result.coverage.governments ? { governments:result.coverage.governments.map(g => ({...g,name:readerGovernmentName(g.name,null)})) } : {}),
        }
      : null,
  };
}

/*
 * PARTY LABELS. Open States says "Democratic", a campaign page says "Democrat",
 * the FEC says "DEM" and a state filing says "Democratic Party": one card carried
 * two of them. One label per party, in the adjective the ballot itself uses.
 */
const PARTY_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:d|dem|democrat|democratic|democratic party|democrat party)$/i, "Democratic"],
  [/^(?:r|rep|republican|republican party|gop)$/i, "Republican"],
  [/^(?:i|ind|independent|independent party)$/i, "Independent"],
  [/^(?:l|lib|libertarian|libertarian party)$/i, "Libertarian"],
  [/^(?:g|grn|green|green party)$/i, "Green"],
  [/^(?:npa|np|nonpartisan|non-partisan|non partisan|no party|no party affiliation|unaffiliated)$/i, "Nonpartisan"],
  [/^(?:pnd|party not designated)$/i, "Party Not Designated"],
];

export function readerPartyLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.split(/\s*\/\s*/).map(party => {
    for (const [pattern, label] of PARTY_FAMILIES) if (pattern.test(party)) return label;
    return readerText(party);
  }).join(" / ");
}
