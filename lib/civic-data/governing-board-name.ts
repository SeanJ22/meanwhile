/**
 * Whether a name a page gives a body is the government's own governing board, and what that board is called.
 *
 * Governments name the same body a hundred ways: council, commission, assembly, board of aldermen, board of
 * supervisors, fiscal court, police jury, school board, "Mayor and Council", "Autauga County Commission". The name is
 * read as a governing phrase plus whatever surrounds it. The surroundings may be the government's own place, its class
 * (city, county, school district) and the words a page hangs on a board ("Home", "Policy", "Notice of ... Possible
 * Quorum"). A committee, commission or board of something else ("Planning Commission", "Library Board", "Student
 * Council", "Ethics Commission") has a function word around its phrase and is not the governing board.
 */

export interface GoverningContext {
  /** The government's name, as registered: "County of Autauga", "Gadsden City School District". */
  readonly name?: string | null;
  /** A school system, where a bare "board" ("Our Board", "The Board") is its governing board. */
  readonly school?: boolean;
  /** A special district or authority, where a bare "board" is its governing board. */
  readonly special?: boolean;
  /** A county or borough, where a bare "commission" or "assembly" is its governing board. */
  readonly county?: boolean;
}

type Tier = "strong" | "weak";
interface Phrase {
  readonly re: RegExp; readonly tier: Tier; readonly needs?: (context: GoverningContext) => boolean; readonly places?: true;
  /** Where the government is not of the kind that needs it, the phrase still counts when the government's own place stands in front of it ("Alamogordo Commission"). */
  readonly orPlace?: true;
  /** A body of general government: a school system's or a special district's own page names a city's or county's, not its own. */
  readonly civil?: true;
}

const CLASS = "(?:city|town|village|borough|township|county|parish|municipal|metro|metropolitan|common|tribal|consolidated|regional)";
const BOARD_OF = "board of (?:county |city |town |village |borough |school )?";

/** Ordered most specific first; the longest match wins, so "board of county commissioners" is one phrase, not two. */
const PHRASES: readonly Phrase[] = [
  { re: new RegExp(`mayor and (?:the )?(?:${CLASS} )?(?:council|commissioners|aldermen|alderpersons|trustees|board of (?:aldermen|alderpersons|trustees|commissioners|directors|selectmen|supervisors))`, "g"), tier: "strong", civil: true },
  { re: /mayor council/g, tier: "strong", civil: true },
  { re: new RegExp(`board of (?:county|city|town|village|borough) commissioners`, "g"), tier: "strong", civil: true },
  { re: new RegExp(`${BOARD_OF}(?:supervisors|aldermen|alderpersons|selectmen|selectpersons|freeholders|chosen freeholders|legislators|education|regents)`, "g"), tier: "strong" },
  { re: new RegExp(`${BOARD_OF}(?:trustees|directors|commissioners)`, "g"), tier: "weak" },
  { re: /board of school (?:directors|trustees|commissioners)/g, tier: "strong" },
  { re: /(?:county|city|town|village|borough|parish) commissioners/g, tier: "strong", civil: true },
  { re: /(?:city and borough |borough |municipal )?assembly/g, tier: "strong", civil: true },
  { re: new RegExp(`${CLASS} council`, "g"), tier: "strong", places: true, civil: true },
  { re: /(?:city|town|village|borough|township|county|parish) commission/g, tier: "strong", places: true, civil: true },
  // "County Board" is a school system's board too, but "County Board of Registrars" is another body.
  { re: /(?:village|town|county|city) board(?! of)/g, tier: "strong", places: true },
  { re: /(?:fiscal|quorum|levy|commissioners) court|police jury|county legislature|legislative council/g, tier: "strong" },
  { re: /select ?board|selectmen|selectpersons|school committee|aldermen|alderpersons|supervisors/g, tier: "strong" },
  { re: /(?:school|governing|education|district|trustee) board/g, tier: "strong" },
  { re: /(?:governing|school) board/g, tier: "strong" },
  { re: /council/g, tier: "weak", civil: true },
  { re: /board/g, tier: "weak", needs: context => context.school === true || context.special === true },
  { re: /commission/g, tier: "weak", needs: context => context.county === true, orPlace: true, civil: true },
  { re: /(?:trustees|directors|commissioners)/g, tier: "weak" },
];

/** What a page may hang on a board's name without making it another body. */
const DECORATION = new Set(("the of to for by and our your a an at in on with from about welcome meet members member home homepage page overview information info policy policies manual handbook bylaws rules procedures " +
  "meeting meetings agenda agendas minutes notice notices announcement announcements news calendar contact contacts directory roster staff officers officer officials elected request address speak comment comments public " +
  "presentation retreat strategic goals plan code conduct personal possible quorum special regular annual budget article section actions action governance joint statement function tips doing business " +
  "work session sessions schedule schedules video videos livestream watch live archive archives documents resources faq how what who why when where is are board boards governing school schools district districts " +
  "unified independent public consolidated charter sch dist current").split(" "));
const SYSTEM_WORDS = new Set("school schools district districts unified independent public".split(" "));
const STOP = new Set(["the", "of", "and"]);
const CLASS_WORDS = new Set("city town village borough township county parish municipal metro metropolitan common tribal consolidated regional and of the".split(" "));
/** A function word beside a board's phrase makes it another body. */
const FUNCTION = new Set(("planning zoning adjustment adjustments appeals ethics library libraries park parks recreation historic historical preservation housing airport utility utilities water sewer hospital health " +
  "cemetery arts art tourism industrial development redevelopment economic civil personnel finance audit advisory citizens citizen youth junior student students teen parent parents senior seniors human traffic safety " +
  "police fire election elections canvassing review equalization tax parking transit transportation beautification arbor abatement enforcement disability aging labor women homeless climate environment environmental " +
  "waste infrastructure peace justice oversight accountability redistricting campaign design loan site bulletin accreditation hearing nominating appointments selection search task technical steering standing " +
  "subcommittee committee foundation corporate general state alumni athletic athletics booster pta pto grievance discipline mental recovery downtown main street").split(" "));

interface Token { readonly text: string; readonly word: string; readonly start: number; readonly end: number }
function tokenize(name: string): Token[] {
  return [...name.matchAll(/[\p{L}\p{N}'’]+|&/gu)].map(match => ({ text: match[0], word: match[0] === "&" ? "and" : match[0].toLowerCase().replace(/['’]/g, ""), start: match.index!, end: match.index! + match[0].length }));
}

/** What its initials make of a run of the government's own words ("cws" for Community Water System, "vbha" for Van Buren Housing Authority). */
function initialsOf(name: string | null | undefined): ReadonlySet<string> {
  const words = name ? tokenize(name).map(token => token.word).filter(word => !CLASS_WORDS.has(word) && !DECORATION.has(word)) : [];
  const out = new Set<string>();
  for (let from = 0; from < words.length; from++) for (let to = from + 1; to < words.length; to++) out.add(words.slice(from, to + 1).map(word => word[0]).join(""));
  return out;
}

/** The words that name the government's place: its name without its class. */
function placeWords(name: string | null | undefined): ReadonlySet<string> {
  if (!name) return new Set();
  return new Set(tokenize(name).map(token => token.word).filter(word => !CLASS_WORDS.has(word) && !DECORATION.has(word) && word.length > 1));
}

/**
 * The governing board a name stands for, as the page names it, or null when the name is another body. The result is
 * the governing phrase with the place words in front of it ("Weaver City Council", "Autauga County Commission",
 * "Board of Education"), without what the page hangs around it.
 */
export function governingBoardName(raw: string, context: GoverningContext = {}): string | null {
  const tokens = tokenize(raw);
  if (!tokens.length || tokens.length > 16) return null;
  const joined = tokens.map(token => token.word).join(" ");
  // Where each token starts in the joined words, to turn a match into token positions.
  const at: number[] = [];
  tokens.reduce((offset, token) => { at.push(offset); return offset + token.word.length + 1; }, 0);
  const spans: { from: number; to: number; phrase: Phrase; ok: boolean }[] = [];
  // Another kind of government's body named on this one's page (a city council on a school district's).
  const others: { from: number; to: number }[] = [];
  for (const phrase of PHRASES) {
    const ok = !phrase.needs || phrase.needs(context);
    if (!ok && !phrase.orPlace) continue;
    const foreign = phrase.civil === true && (context.school === true || context.special === true);
    for (const match of joined.matchAll(phrase.re)) {
      const from = at.findIndex(offset => offset === match.index), last = match.index! + match[0].length;
      const to = at.findIndex((offset, index) => offset + tokens[index]!.word.length === last);
      // Whole words only.
      if (from < 0 || to < from) continue;
      if (foreign) { others.push({ from, to }); continue; }
      if (!spans.some(span => span.from <= from && to <= span.to)) {
        for (let i = spans.length - 1; i >= 0; i--) if (from <= spans[i]!.from && spans[i]!.to <= to) spans.splice(i, 1);
        spans.push({ from, to, phrase, ok });
      }
    }
  }
  if (!spans.length) return null;
  if (others.some(other => !spans.some(span => span.from <= other.from && other.to <= span.to))) return null;
  // Phrases that overlap ("county board" and "board of education" in "County Board of Education") are one board.
  const groups: { from: number; to: number; tier: Tier; places: boolean; ok: boolean }[] = [];
  for (const span of spans.sort((a, b) => a.from - b.from || b.to - a.to)) {
    const last = groups.at(-1);
    if (last && span.from <= last.to) { last.to = Math.max(last.to, span.to); if (span.phrase.tier === "strong") last.tier = "strong"; last.places &&= span.phrase.places === true; last.ok ||= span.ok; }
    else groups.push({ from: span.from, to: span.to, tier: span.phrase.tier, places: span.phrase.places === true, ok: span.ok });
  }
  if (groups.some(group => group.tier === "strong")) groups.splice(0, groups.length, ...groups.filter(group => group.tier === "strong"));
  // Two different boards in one name ("Board of Education and Borough Assembly Joint Work Session") is a meeting of both, not either.
  if (new Set(groups.map(group => tokens.slice(group.from, group.to + 1).map(token => token.word).join(" "))).size > 1) return null;
  const span = { ...groups[0]!, ok: groups[0]!.ok, phrase: { tier: groups[0]!.tier, places: groups[0]!.places ? true as const : undefined } };
  const place = placeWords(context.name), outside = tokens.filter((_, index) => index < span.from || index > span.to);
  const acronyms = initialsOf(context.name);
  const unknown = outside.filter(token => !acronyms.has(token.word) && !DECORATION.has(token.word) && !CLASS_WORDS.has(token.word) && !place.has(token.word) && !/^(?:fy)?\d+$|^[ivx]+$/.test(token.word));
  if (!span.ok && !outside.some(token => place.has(token.word))) return null;
  if (span.phrase.tier === "weak" && unknown.length) return null;
  if (outside.some(token => FUNCTION.has(token.word) && !place.has(token.word))) return null;
  // "Morgan County Commission" on another government's page names that county's board, not this one's.
  if (span.phrase.places && context.name && unknown.length && !outside.some(token => place.has(token.word))) return null;
  // The board is named with its place in front and nothing a page hung on it.
  let from = span.from;
  while (from > 0 && (place.has(tokens[from - 1]!.word) || (CLASS_WORDS.has(tokens[from - 1]!.word) || SYSTEM_WORDS.has(tokens[from - 1]!.word)) && !STOP.has(tokens[from - 1]!.word))) from--;
  while (from < span.from && !place.has(tokens[from]!.word)) from++;
  return raw.slice(tokens[from]!.start, tokens[span.to]!.end);
}

export const isGoverningBoardName = (raw: string, context: GoverningContext = {}): boolean => governingBoardName(raw, context) !== null;
