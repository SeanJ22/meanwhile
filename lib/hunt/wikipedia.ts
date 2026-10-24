/**
 * Wikipedia as a discovery source, never a source of record. What comes out
 * is a name plus the footnote the encyclopedia attached to it; the footnote is
 * fetched and read (`confirmAgainstCitation`) before the name means anything.
 * A name whose citation cannot be confirmed is a `LEAD` for further work,
 * never a row in front of a reader.
 *
 * US municipality articles are heavily templated: the Local government
 * section carries a form-of-government sentence, a body-composition sentence
 * and a roster sentence, in a small number of shapes. Member shapes vary in
 * finite ways (seat before or after party, a bare year or a whole term clause,
 * an expanded party wikilink on the first member, an office title glued to the
 * name), each handled and named below.
 *
 * The composition sentence ("nine members, six wards, three at-large") is a
 * prediction about the registry, checkable against it (`parseGoverningBody`).
 *
 * Only facts are extracted; no sentence is copied through to a reader surface.
 */

import {
  assertCount,
  statedCountIn,
  type CountAssertion,
} from "../extract/count-assertion.ts";

/**
 * `/w/api.php`, which robots.txt disallows under `User-agent: *`. Recorded,
 * not blocking; the `/wiki/<Title>?action=raw` representation is used because
 * it returns the same wikitext. Exported as the recorded rule's path.
 */
export const WIKI_API_DISALLOWED = "https://en.wikipedia.org/w/api.php";

/**
 * The representation in use: `/wiki/` carries no blanket `Disallow`, only
 * specific non-article pages do.
 */
export const WIKI_RAW_BASE = "https://en.wikipedia.org/wiki/";

/** The title as it appears in a `/wiki/` path. */
export function wikiRawUrl(title: string): string {
  /*
   * Underscores first, then component-encoding; the host accepts the encoded
   * colon in `Template:…`.
   */
  return `${WIKI_RAW_BASE}${encodeURIComponent(title.replace(/ /g, "_"))}?action=raw`;
}

export interface WikiPage {
  /** The title asked for. */
  requested: string;
  /** The title actually served, after redirects. */
  title: string | null;
  pageId: number | null;
  wikitext: string | null;
  /** `null` on a hit; the reason on a miss. Never an empty string. */
  missReason: string | null;
  fetchedAt: string;
}

export type WikiFetcher = (url: string) => Promise<{ status: number; body: string }>;

/**
 * Fetch one page's raw wikitext with a plain identified GET. Wikitext rather
 * than rendered HTML because it keeps each `<ref>` attached to its sentence.
 */
export async function fetchWikitext(
  title: string,
  fetcher: WikiFetcher,
  now: string,
  depth = 0,
): Promise<WikiPage> {
  const url = wikiRawUrl(title);

  const base: WikiPage = {
    requested: title,
    title: null,
    pageId: null,
    wikitext: null,
    missReason: null,
    fetchedAt: now,
  };

  let res: { status: number; body: string };
  try {
    res = await fetcher(url);
  } catch (err) {
    return { ...base, missReason: `fetch threw: ${(err as Error).message}` };
  }
  /* A missing article answers 404. */
  if (res.status === 404) return { ...base, missReason: "no such article" };
  if (res.status !== 200) return { ...base, missReason: `HTTP ${res.status}` };

  const body = res.body ?? "";
  if (body.length === 0) {
    // A zero-row extraction is a FAILED extraction, never an empty document.
    return { ...base, missReason: "the article exists and returned no wikitext" };
  }

  /*
   * Redirects (`#REDIRECT [[Target]]`) are followed explicitly, because
   * template names often redirect on capitalisation. One hop, then stop.
   */
  const redirect = /^\s*#\s*REDIRECT\s*\[\[([^\]|#]+)/i.exec(body);
  if (redirect) {
    const target = redirect[1].trim();
    if (depth >= 1) {
      return { ...base, missReason: `redirect chain deeper than one hop, at "${target}"` };
    }
    const followed = await fetchWikitext(target, fetcher, now, depth + 1);
    return { ...followed, requested: title };
  }

  return {
    ...base,
    title,
    /* The raw route carries no page id, and none is invented. */
    pageId: null,
    wikitext: body,
    missReason: null,
  };
}

export interface WikiRef {
  /** `name=` where the ref carries one, else null. */
  name: string | null;
  /** The raw ref body. */
  raw: string;
  /** Every external URL inside the ref, in order. */
  urls: string[];
}

/**
 * Pull the `<ref>` footnotes out of a run of wikitext: a full
 * `<ref>body</ref>`, a self-closing back-reference `<ref name=X />`, and a
 * `{{cite web|url=…}}` inside a full ref. `resolveRefNames` restores a
 * back-reference's body so later uses carry their URLs.
 */
export function refs(text: string): WikiRef[] {
  const out: WikiRef[] = [];
  const full = /<ref([^>/]*)>([\s\S]*?)<\/ref>/g;
  let m: RegExpExecArray | null;
  while ((m = full.exec(text)) !== null) {
    out.push({ name: refName(m[1]), raw: m[2], urls: urlsIn(m[2]) });
  }
  const selfClosing = /<ref([^>]*)\/>/g;
  while ((m = selfClosing.exec(text)) !== null) {
    out.push({ name: refName(m[1]), raw: "", urls: [] });
  }
  return out;
}

function refName(attrs: string): string | null {
  const m = /name\s*=\s*"?([^"|>/\s]+)"?/.exec(attrs);
  return m === null ? null : m[1];
}

/**
 * Every external URL in a run of wikitext — bare, bracketed, or inside a
 * `{{cite}}` template's `url=`. Trailing wiki punctuation is trimmed, because
 * `[http://x.gov/page Title]` and `url=http://x.gov/page|title=` both leave
 * characters that are not part of the address.
 */
export function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s\]|}<"']+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:)]+$/, "");
    if (url.length > 0 && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Put a named back-reference's body back, so `<ref name=Mayor />` carries the
 * same URLs the first `<ref name=Mayor>…</ref>` did.
 */
export function resolveRefNames(pageWikitext: string, found: WikiRef[]): WikiRef[] {
  const byName = new Map<string, WikiRef>();
  for (const r of refs(pageWikitext)) {
    if (r.name !== null && r.raw.length > 0 && !byName.has(r.name)) byName.set(r.name, r);
  }
  return found.map((r) => {
    if (r.raw.length > 0 || r.name === null) return r;
    const full = byName.get(r.name);
    return full === undefined ? r : { ...r, raw: full.raw, urls: full.urls };
  });
}

/** Strip refs, wikilinks, templates, comments and bold/italic to plain text. */
export function plain(text: string): string {
  return text
    .replace(/<ref[^>/]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[(?:[^[\]|]*\|)?([^[\]|]*)\]\]/g, "$1")
    .replace(/\{\{[Aa]s of\|(\d{4})[^}]*\}\}/g, "As of $1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/* ─────────────────────── The Local government section ────────────────────── */

export interface GoverningBody {
  /** e.g. "Faulkner Act", "borough", "Township", "Town", "Village". */
  form: string | null;
  /** e.g. "F" from "Plan F". Null where the form has no plans. */
  plan: string | null;
  /** How many municipalities statewide use this form, per the article. */
  usingFormStatewide: number | null;
  /** The statewide denominator the article states — 564 in New Jersey. */
  statewideTotal: number | null;
  /** Seats on the governing body, where the composition sentence states one. */
  seats: number | null;
  /** Ward seats, where the composition sentence distinguishes them. */
  wardSeats: number | null;
  /** At-large seats, where the composition sentence distinguishes them. */
  atLargeSeats: number | null;
  /** The name the article gives the body — "Township Council", "Borough Council". */
  bodyName: string | null;
  /** The sentence(s) this was read out of, for a human to check. */
  evidence: string | null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
};

function num(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.trim().toLowerCase().replace(/,/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}

/**
 * The form-of-government prediction, from shapes such as:
 *
 * - `governed within the [[Faulkner Act]] … (Plan F)` → form `Faulkner Act`, plan `F`
 * - `governed under the [[Borough (New Jersey)|borough]] form … used in 218
 *   municipalities of the 564 statewide` → form `borough`, 218 of 564
 * - `operates using the [[Town (New Jersey)|Town]] form … one of nine
 *   municipalities (of the 564)` → form `Town`, 9 of 564
 *
 * and the composition sentence: *nine members, with one member elected from
 * each of six wards and three elected on an at-large basis* → 9 seats, 6
 * ward, 3 at-large. Every field is independently nullable; a missing clause
 * is never guessed.
 */
export function parseGoverningBody(localGovernment: string): GoverningBody {
  const text = plain(localGovernment);

  let form: string | null = null;
  let plan: string | null = null;
  const faulkner = /Faulkner Act/i.exec(text);
  if (faulkner !== null) {
    form = "Faulkner Act";
    const p = /\(Plan\s+([A-Z]{1,2})\)/.exec(text);
    plan = p === null ? null : p[1];
  } else {
    const f =
      /(?:governed under|operates under|operates using|governed by)\s+the\s+([A-Za-z][A-Za-z\- ]{2,30}?)\s+form\b/i.exec(
        text,
      );
    form = f === null ? null : f[1].trim();
  }

  const share =
    /(?:one of|used in)\s+([\w-]+)\s+municipalities\s*\(?(?:of\s+the)?\s*([\d,]+)?\)?/i.exec(text);
  const usingFormStatewide = share === null ? null : num(share[1]);
  const statewideTotal = share === null ? null : num(share[2]);

  const comp =
    /(?:The\s+([A-Z][A-Za-z' ]{2,40}?)\s+(?:is comprised of|includes|consists of|is composed of|comprises)\s+([\w-]+)\s+members)/i.exec(
      text,
    );
  let bodyName = comp === null ? null : comp[1].trim();
  let seats = comp === null ? null : num(comp[2]);

  /**
   * The hyphenated form: `the seven-member township council`. Without it the
   * seat count, the denominator the roster check uses, is null.
   */
  if (seats === null) {
    const hyphenated =
      /\b(?:the\s+)?([\w-]+)-member\s+((?:[a-z]+\s+)?(?:council|committee|board|commission))/i.exec(
        text,
      );
    if (hyphenated !== null) {
      seats = num(hyphenated[1]);
      if (bodyName === null) bodyName = hyphenated[2].trim();
    }
  }

  let wardSeats: number | null = null;
  let atLargeSeats: number | null = null;
  const wards =
    /([\w-]+)\s+members?\s+elected\s+from\s+each\s+of\s+(?:the\s+)?([\w-]+)\s+wards?/i.exec(text) ??
    /elected\s+from\s+each\s+of\s+(?:the\s+)?([\w-]+)\s+wards?/i.exec(text);
  if (wards !== null) {
    const perWard = wards.length === 3 ? (num(wards[1]) ?? 1) : 1;
    const wardCount = num(wards[wards.length - 1]);
    wardSeats = wardCount === null ? null : perWard * wardCount;
  }
  const atLarge = /([\w-]+)\s+elected\s+(?:on\s+an?\s+)?at-large/i.exec(text);
  if (atLarge !== null) atLargeSeats = num(atLarge[1]);

  const evidence = text.split(/(?<=\.)\s+/).slice(0, 3).join(" ").slice(0, 700);

  return {
    form,
    plan,
    usingFormStatewide,
    statewideTotal,
    seats,
    wardSeats,
    atLargeSeats,
    bodyName,
    evidence: evidence.length > 0 ? evidence : null,
  };
}

/* ────────────────────────────── The roster ───────────────────────────────── */

export interface WikiOfficial {
  /** The person's name, with any office title stripped off the front. */
  name: string;
  /** "Mayor", "Council President", "Deputy Mayor" — null where none was glued on. */
  title: string | null;
  /** "R", "D", "I" — the single-letter party the roster line carries. */
  party: string | null;
  /** The year the term ends, where the entry states one. */
  termEnds: number | null;
  /** "Ward 4", "At-large" — where the entry distinguishes a seat. */
  seat: string | null;
  /** The body this person sits on, as the article names it. */
  body: string | null;
  /** The parenthetical exactly as the article wrote it, for a human to check. */
  rawParenthetical: string | null;
  /** Every URL from the footnotes attached to the sentence this came from. */
  citationUrls: string[];
}

/**
 * Office titles that appear glued to the front of a name. Longest-first:
 * `Deputy Director` before `Director`. Includes county row officers (Clerk,
 * Sheriff, Surrogate), which share a list with the county governing body.
 */
const GLUED_TITLES = [
  "Council President",
  "Council Vice President",
  "Board President",
  "Board Vice President",
  "Committee Chair",
  "Commissioner Director",
  "Freeholder Director",
  "Deputy Director",
  "Deputy Mayor",
  "Vice Mayor",
  "Mayor",
  "Chairperson",
  "Chairman",
  "Chairwoman",
  "Chair",
  "President",
  "Director",
  "County Clerk",
  "Clerk",
  "Sheriff",
  "Surrogate",
  "Register",
  "Prosecutor",
  "Assessor",
  "Treasurer",
  "Comptroller",
  "Recorder",
  "Superintendent",
  "Commissioner",
  "Freeholder",
  "Selectman",
  "Selectwoman",
  "Moderator",
];

/** Strip a glued office title off the front of a name. */
export function splitTitle(head: string): { title: string | null; name: string } {
  let name = head.trim();
  for (const t of GLUED_TITLES) {
    if (name.toLowerCase().startsWith(t.toLowerCase() + " ")) {
      return { title: t, name: name.slice(t.length).trim() };
    }
  }
  // A party word can lead a shared-party list: "Democrats Cory Booker".
  const party = /^(Republicans?|Democrats?|Independents?)\s+/i.exec(name);
  if (party !== null) name = name.slice(party[0].length).trim();
  return { title: null, name };
}

const PARTY_WORDS: Record<string, string> = {
  republican: "R",
  democrat: "D",
  democratic: "D",
  independent: "I",
};

/**
 * Split a roster sentence into members on `, ` and ` and `, never inside a
 * parenthetical (`(R, 2029; Ward 5)`) or quotes (`Given "Nick" Surname`).
 */
export function splitMembers(sentence: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let buf = "";
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0) {
        /**
         * A `)` returning depth to zero, followed by whitespace and a capital
         * that is not a connective, ends the entry: some articles list
         * members with no comma between them. Where the article punctuates,
         * the empty buffer is filtered out.
         */
        if (ch === ")") {
          const rest = sentence.slice(i + 1);
          if (/^\s+[A-Z]/.test(rest) && !/^\s+(?:and|or|with|of|in)\b/i.test(rest)) {
            parts.push(buf + ch);
            buf = "";
            continue;
          }
        }
        if (ch === ",") {
          // A generational suffix (`Name, Sr. (Ward 4; D, 2026)`) is part of the name.
          if (/^,\s*(?:Sr|Jr|II|III|IV|V|Esq|Ph\.?D|M\.?D)\b\.?/i.test(sentence.slice(i))) {
            buf += ch;
            continue;
          }
          parts.push(buf);
          buf = "";
          continue;
        }
        if (sentence.startsWith(" and ", i)) {
          parts.push(buf);
          buf = "";
          i += 4;
          continue;
        }
      }
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Parse one member entry. Live shapes:
 *
 * | Shape | Exercises |
 * | --- | --- |
 * | `Name (R, 2027; At-large)` | party, year, seat |
 * | `Name (R, 2026)` | no seat at all |
 * | `Name (Ward 3; D, 2027)` | seat before party |
 * | `Name (R, term on committee ends December 31, 2026; term as mayor ends 2024)` | a term clause, two of them |
 *
 * The party is a single-letter token or a spelled-out word. The term year is
 * the last four-digit year in the parenthetical that is not part of a seat;
 * the raw parenthetical is kept so a human can check.
 */
export function parseMember(entry: string, body: string | null): WikiOfficial | null {
  const trimmed = entry.trim().replace(/\.$/, "");
  if (trimmed.length === 0) return null;

  const open = trimmed.indexOf("(");
  const head = (open >= 0 ? trimmed.slice(0, open) : trimmed).trim();
  const paren =
    open >= 0 && trimmed.endsWith(")") ? trimmed.slice(open + 1, trimmed.length - 1).trim() : null;

  const split = splitTitle(head);
  const title = split.title;
  const name = split.name.replace(/^[,;\s]+|[,;\s]+$/g, "");
  if (name.length < 3 || !/[A-Za-z]/.test(name)) return null;
  // A trailing lower-case connective means this was prose, not a member entry.
  if (/^(and|the|of|in|to|is|are|who|which)\b/i.test(name)) return null;

  let party: string | null = null;
  let termEnds: number | null = null;
  let seat: string | null = null;

  if (paren !== null) {
    const clauses = paren.split(";").map((c) => c.trim());
    for (const clause of clauses) {
      const seatMatch = /\b(Ward\s+[\w-]+|At[- ]large|at[- ]large)\b/.exec(clause);
      if (seatMatch !== null && seat === null) {
        seat = /^at[- ]large$/i.test(seatMatch[1]) ? "At-large" : seatMatch[1];
      }
      for (const token of clause.split(/[\s,]+/)) {
        if (party === null && /^[RDI]$/.test(token)) party = token;
        if (party === null) {
          const word = PARTY_WORDS[token.toLowerCase().replace(/[^a-z]/g, "")];
          if (word !== undefined) party = word;
        }
      }
    }
    // The seat's term, not a chairmanship's: the clause carrying a year and not
    // about holding an office wins.
    const withYear = clauses.filter((c) => /\b(?:19|20)\d{2}\b/.test(c));
    const seatClause =
      withYear.find((c) => /\bterm\b/i.test(c) && !/\bas\b/i.test(c)) ??
      withYear.find((c) => !/\bas\b/i.test(c)) ??
      withYear[0];
    const years = seatClause === undefined ? [] : (seatClause.match(/\b(19|20)\d{2}\b/g) ?? []);
    if (years.length > 0) termEnds = Number(years[years.length - 1]);
  }

  return {
    name,
    title,
    party,
    termEnds,
    seat,
    body,
    rawParenthetical: paren,
    citationUrls: [],
  };
}

/**
 * Words that mean an entry is an OFFICE or a clause, never a person, however
 * capitalised it is. Append-only — each one costs nothing to keep.
 */
const NOT_A_PERSON =
  /\b(?:council|committee|board|township|borough|town|city|county|manager|administrator|clerk|attorney|department|commission|authority|district|term|seat|election|meeting|office|position|member|members|vacancy|resident|residents)\b/i;

/**
 * Does this bare name look like a person? Some rosters name members without a
 * party or term; a filter keyed on detail would delete the least-documented
 * people first. A bare entry survives when every token is capitalised (or an
 * initial, particle or suffix) and no word names an office. It is still only a
 * name: a `LEAD` until its own citation is read.
 */
export function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim().replace(/\.$/, "");
  if (trimmed.length < 5 || NOT_A_PERSON.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  const PARTICLE = /^(?:van|von|de|del|della|di|da|la|le|du|of|bin|al)$/i;
  const SUFFIX = /^(?:Sr|Jr|II|III|IV|V|Esq)\.?$/i;
  let capitalised = 0;
  for (const token of tokens) {
    const bare = token.replace(/^["'(]+|["')]+$/g, "");
    if (bare.length === 0) return false;
    if (PARTICLE.test(bare) || SUFFIX.test(bare)) continue;
    if (!/^[A-Z]/.test(bare)) return false;
    if (!/^[A-Z][A-Za-z'’.-]*$/.test(bare)) return false;
    capitalised++;
  }
  return capitalised >= 2;
}

export interface RosterParse {
  officials: WikiOfficial[];
  /** The sentence the roster was read out of, in plain text. */
  sentence: string | null;
  /** Which lead-in matched, so a new state's shape can be added by name. */
  leadIn: string | null;
  citationUrls: string[];
  /**
   * What the article says the body's size is, against what parsed.
   * `NOT_ASSERTABLE` where the article states no size.
   */
  count: CountAssertion;
}

/**
 * The lead-in phrases that introduce a roster sentence, longest-first.
 * Append-only.
 */
export const ROSTER_LEAD_INS = [
  "members of the",
  "the members of the",
  "members of",
];

/**
 * Find and parse the roster sentence. A sentence ends at a full stop followed
 * by whitespace and a capital or end-of-text, excluding initials and common
 * abbreviations. Refs are pulled from the original wikitext of that span
 * before `plain` removes them.
 */
export function parseRoster(localGovernment: string, bodyName: string | null): RosterParse {
  /*
   * The denominator, read before the roster: `parseGoverningBody`'s composition
   * sentence, then the generic membership shapes in
   * `lib/extract/count-assertion.ts`. Neither is guessed at.
   */
  const seats = parseGoverningBody(localGovernment).seats;
  const generic = statedCountIn(plain(localGovernment));
  const stated = seats ?? generic?.count ?? null;
  const statedBy =
    seats !== null
      ? "the article's composition sentence, via parseGoverningBody"
      : generic !== null
        ? `${generic.shape}: “${generic.evidence}”`
        : "the article states no size for this body";

  const empty: RosterParse = {
    officials: [],
    sentence: null,
    leadIn: null,
    citationUrls: [],
    count: assertCount(0, stated, statedBy),
  };

  /**
   * The composition sentence starts like a roster sentence and names nobody,
   * so every candidate sentence is parsed and the best wins, scored on entries
   * carrying a party letter, term year or seat. Prose scores zero.
   */
  let best: RosterParse | null = null;
  let bestScore = 1; // a roster names at least two people

  for (const s of sentences(localGovernment)) {
    /**
     * The lead-in is reported, never required: some rosters are introduced by
     * a possessive (`<Place>'s Township Committee is comprised of …`).
     */
    const lower = s.text.toLowerCase();
    const leadIn = ROSTER_LEAD_INS.find((p) => lower.includes(p + " ")) ?? null;

    /** Past-tense copulas (`was composed of`) count too. Append-only. */
    const copula =
      /\b(?:are|were|is comprised of|was comprised of|is composed of|was composed of|consists of|consisted of|comprises|comprised|includes|included|is|was)\b/i.exec(
        s.text,
      );
    if (copula === null) continue;
    const listText = s.text.slice(copula.index + copula[0].length).trim();

    const officials = splitMembers(listText)
      .map((e) => parseMember(e, bodyName))
      .filter((o): o is WikiOfficial => o !== null);

    const score = officials.filter(
      (o) => o.party !== null || o.termEnds !== null || o.seat !== null,
    ).length;
    if (score === 0 || score <= bestScore) continue;

    const spanRefs = resolveRefNames(localGovernment, refs(s.raw));
    const citationUrls = [...new Set(spanRefs.flatMap((r) => r.urls))];
    bestScore = score;
    best = {
      /**
       * Keep entries carrying a party, term year or seat, or a bare personal
       * name (`looksLikePersonName`). The score above stays on the strict test
       * so capitalised prose cannot out-score a real roster.
       */
      officials: officials
        .filter(
          (o) =>
            o.party !== null ||
            o.termEnds !== null ||
            o.seat !== null ||
            looksLikePersonName(o.name),
        )
        .map((o) => ({ ...o, citationUrls })),
      sentence: s.text,
      leadIn,
      citationUrls,
      // Placeholder; the assertion is made once for the winning parse.
      count: assertCount(0, stated, statedBy),
    };
  }

  if (best === null) return empty;
  return { ...best, count: assertCount(best.officials.length, stated, statedBy) };
}

/**
 * Split a run of wikitext into sentences, keeping each one's raw text: sentences
 * are matched on their plain text, while footnotes are read from the raw text.
 */
export function sentences(raw: string): { raw: string; text: string }[] {
  const out: { raw: string; text: string }[] = [];
  let start = 0;
  while (start < raw.length) {
    const end = sentenceEnd(raw.slice(start));
    const chunk = raw.slice(start, start + end);
    const text = plain(chunk);
    if (text.length > 0) out.push({ raw: chunk, text });
    start += end;
    // Skip the whitespace between sentences.
    while (start < raw.length && /\s/.test(raw[start])) start++;
    if (end === 0) break;
  }
  return out;
}

/**
 * Where the sentence ends:
 *
 * 1. A `<ref>` contains sentences that are not this one, so ref bodies are masked.
 * 2. Footnotes after the full stop belong to the sentence, so the end is pushed
 *    past any run of refs that immediately follows.
 * 3. Names contain full stops (`Name J. Surname III`, `Name, Sr.`, `St. Clair`).
 */
function sentenceEnd(text: string): number {
  // Mask ref bodies so no period inside one can end the sentence, keeping the
  // string the same length so every index still refers to the original.
  const masked = text
    .replace(/<ref[^>/]*>[\s\S]*?<\/ref>/g, (s) => " ".repeat(s.length))
    .replace(/<ref[^>]*\/>/g, (s) => " ".repeat(s.length));

  const re = /\.(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const before = masked.slice(Math.max(0, m.index - 5), m.index);
    if (/(?:^|\s)[A-Z]$/.test(before)) continue; // a middle initial
    if (/(?:Sr|Jr|St|Mr|Ms|Dr|Rev|Hon|Gov|Sen|Rep|Esq)$/i.test(before)) continue;

    // Take the footnotes that follow the full stop with it.
    let end = m.index + 1;
    for (;;) {
      const rest = text.slice(end);
      const ref = /^\s*(?:<ref[^>/]*>[\s\S]*?<\/ref>|<ref[^>]*\/>)/.exec(rest);
      if (ref === null) break;
      end += ref[0].length;
    }
    return end;
  }
  return text.length;
}
