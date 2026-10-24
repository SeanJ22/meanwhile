/**
 * Reader-ready names, from one formatter. Portals, registries and adapters
 * hand over the same body in different shapes ("GOVERNING BOARD AGENDA REGULAR
 * MEETING", "New York city", "Board Of Supervisors", "… (RAC)"); every surface
 * that prints a body or a party asks here. The rules are about the SHAPE of a
 * name, never about one body.
 *
 * Pure and client-safe: no registry, no geometry, no fetch.
 */

const SMALL_WORDS = new Set(["of", "and", "the", "for", "on", "in", "to", "at", "by", "a", "an", "or"]);

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

function isAllCaps(text: string): boolean {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}

/** Capitalise a shouting name and lower the small words everywhere but first. */
function titleCase(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part, index, parts) => {
      if (/^\s+$/.test(part) || part === "") return part;
      const first = parts.slice(0, index).every((p) => /^\s*$/.test(p));
      const lower = part.toLowerCase();
      if (!first && SMALL_WORDS.has(lower)) return lower;
      // Hyphen and slash joined words capitalise each piece ("Lake-Ridge").
      return part
        .split(/([-/])/)
        .map((piece) => (/^[-/]$/.test(piece) ? piece : titleCaseWord(piece)))
        .join("");
    })
    .join("");
}

/** "Board Of Supervisors" -> "Board of Supervisors", without touching the rest. */
function lowerSmallWords(text: string): string {
  return text.replace(/(\S)(\s+)(Of|And|The|For|On|In|To|At|By|A|An|Or)(?=\s)/g, (_m, before, space, word) => {
    return `${before}${space}${word.toLowerCase()}`;
  });
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
  if (isAllCaps(text)) text = titleCase(text);
  return capitaliseSuffix(lowerSmallWords(text));
}

/**
 * The government a derived body stands for, when the registry holds no name for
 * the body itself: a county ("<Name>" → "<Name> County"), "New York city" →
 * "New York City", and a Census "<Name> Unified District" → "<Name> Unified
 * School District".
 */
export function readerGovernmentName(label: string, divisionType: string | null): string {
  let name = label.replace(/\s+/g, " ").trim();
  if (isAllCaps(name)) name = titleCase(name);
  name = capitaliseSuffix(name);
  if (name === "") return name;
  if (divisionType === "county" && !/\b(county|parish|borough)$/i.test(name) && !/^(?:county|parish|borough) of\b/i.test(name)) {
    name = `${name} County`;
  } else if (divisionType === "school_district" && /\sDistrict$/.test(name) && !/\bSchool\b/i.test(name)) {
    name = name.replace(/\sDistrict$/, " School District");
  }
  return lowerSmallWords(name);
}

/** What every surface prints for a covered body: its name, else the government it is. */
export function bodyDisplayName(body: {
  name: string | null;
  divisionLabel: string;
  divisionType: string | null;
}): string {
  return body.name !== null && body.name.trim() !== ""
    ? readerBodyName(body.name)
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
    coverage: { bodies: ReadonlyArray<{ name: string | null; divisionLabel?: string; divisionType?: string | null }>; governments?: ReadonlyArray<{name:string}> } | null;
  },
>(result: R): R {
  return {
    ...result,
    meetings: result.meetings.map((m) => ({ ...m, bodyName: readerBodyName(m.bodyName),
      ...(m.jurisdiction ? { jurisdiction:readerGovernmentName(m.jurisdiction,null) } : {}) })),
    coverage: result.coverage
      ? {
          ...result.coverage,
          bodies: result.coverage.bodies.map((b) => ({ ...b, ...(b.name === null ? {} : { name: readerBodyName(b.name) }),
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
];

export function readerPartyLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  for (const [pattern, label] of PARTY_FAMILIES) if (pattern.test(text)) return label;
  return isAllCaps(text) ? titleCase(text) : text;
}
