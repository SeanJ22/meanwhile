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
import { OUTBOUND_CONTACT } from "../geo/outbound-agent.ts";

/* ────────────────────────────── Retrieval ────────────────────────────────── */

/** Identified User-Agent, with the contact composed from `lib/geo/outbound-agent.ts`. */
export const WIKI_USER_AGENT = `we-the-people/1.0 (civic data for a public-records product; contact: ${OUTBOUND_CONTACT})`;

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

/** Serialized, spaced. A hunt may never become a load test. */
export const WIKI_SPACING_MS = 400;

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

/* ─────────────────────────── Wikitext primitives ─────────────────────────── */

/**
 * One section's body, by heading text, at any heading depth. Matched
 * case-insensitively, tolerating `== Government ==` and `==Government==`.
 */
export function section(wikitext: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(={2,5})\\s*${escaped}\\s*\\1\\s*$`, "im");
  const m = re.exec(wikitext);
  if (m === null) return null;
  const start = m.index + m[0].length;
  const rest = wikitext.slice(start);
  const next = /^={2,5}[^=\n]/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

/** Every heading in the article, in order. Used to report where a parse missed. */
export function headings(wikitext: string): string[] {
  return (wikitext.match(/^={2,5}[^=\n]+={2,5}\s*$/gm) ?? []).map((h) =>
    h.replace(/^=+\s*|\s*=+\s*$/g, ""),
  );
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

/** Every `{{Template}}` transcluded in a run of wikitext, by name. */
export function transclusions(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([^{}|\n]+?)\s*(?:\||\}\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name.length > 0 && !out.includes(name)) out.push(name);
  }
  return out;
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

/**
 * The mayor sentence (`the Mayor of <Place> is Republican <Name>, whose term
 * expires …`). Where the governing body chooses the mayor there is no such
 * sentence and this returns null; `parseMunicipality` then looks for the
 * roster's glued title.
 */
export function parseMayor(localGovernment: string): WikiOfficial | null {
  // Located on each sentence's plain text; footnotes read off its raw text.
  const hit = sentences(localGovernment).find((s) =>
    /\bmayor\s+of\s+[^.]{2,60}?\s+is\s+/i.test(s.text),
  );
  if (hit === undefined) return null;
  const spanRefs = resolveRefNames(localGovernment, refs(hit.raw));
  const citationUrls = [...new Set(spanRefs.flatMap((r) => r.urls))];

  const text = hit.text;
  // The name may carry a middle initial, so it runs to the comma or `whose`.
  const m =
    /\bmayor\s+of\s+[^,]{2,60}?\s+is\s+(Republican|Democrat|Democratic|Independent)?\s*([A-Z][^,]{2,60}?)(?=,|\s+whose\b|\s*$)/i.exec(
      text,
    );
  if (m === null) return null;
  const name = m[2].trim();
  if (name.length < 3) return null;

  const years = text.match(/\b(19|20)\d{2}\b/g) ?? [];
  return {
    name,
    title: "Mayor",
    party: m[1] === undefined ? null : (PARTY_WORDS[m[1].toLowerCase()] ?? null),
    termEnds: years.length > 0 ? Number(years[years.length - 1]) : null,
    seat: null,
    body: "Mayor",
    rawParenthetical: null,
    citationUrls,
  };
}

/* ─────────────────── Representation, links, citation hosts ───────────────── */

/**
 * Districts are plural because a municipality is a polygon and can span
 * several. The arrays hold what the section names, in order, deduplicated; an
 * empty array means the section named none, never that the municipality has
 * no district. Boundary overlap is answered by a boundary walk, not here.
 */
export interface Representation {
  /**
   * Every congressional district the section names, in the order it names them,
   * deduplicated. Empty means the SECTION named none.
   */
  congressionalDistricts: string[];
  /** Every state legislative district the section names. Same reading. */
  legislativeDistricts: string[];
  /** The officeholder templates the section transcludes, by name. */
  officeholderTemplates: string[];
  citationUrls: string[];
}

/** All matches of `re` at capture group 1, deduplicated, in first-seen order. */
function allCaptures(text: string, patterns: RegExp[]): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    // A fresh RegExp per call: a shared `g` literal would carry `lastIndex` across calls.
    for (const m of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      if (m[1] !== undefined) out.add(m[1]);
    }
  }
  return [...out];
}

/**
 * The Federal/state/county representation section: the district numbers and
 * the names of the templates that carry the officeholders (fetched as their
 * own pages). Every match is captured, not only the first.
 */
export function parseRepresentation(sectionText: string): Representation {
  const text = plain(sectionText);

  const templates = transclusions(sectionText).filter((t) =>
    /^(NJ|AZ|NH|US)\s|Congress|Senate|Legislative|Commissioner|Freeholder/i.test(t),
  );
  const spanRefs = resolveRefNames(sectionText, refs(sectionText));

  return {
    congressionalDistricts: allCaptures(text, [
      /(\d+)(?:st|nd|rd|th)\s+Congressional District/i,
    ]),
    // Both spellings, each scanned in full.
    legislativeDistricts: allCaptures(text, [
      /(\d+)(?:st|nd|rd|th)\s+state\s+legislative\s+district/i,
      /state\s+legislative\s+district\s+(\d+)/i,
    ]),
    officeholderTemplates: templates,
    citationUrls: [...new Set(spanRefs.flatMap((r) => r.urls))],
  };
}

export interface ExternalLink {
  url: string;
  label: string | null;
}

/** The External links block: the municipality's own site, school district and other starting points. */
export function parseExternalLinks(wikitext: string): ExternalLink[] {
  const sec = section(wikitext, "External links");
  if (sec === null) return [];
  const out: ExternalLink[] = [];
  const seen = new Set<string>();
  const re = /\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sec)) !== null) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: m[2] === undefined ? null : plain(m[2]).trim() || null });
  }
  return out;
}

/**
 * The citation host map: counting reference hosts across a state's articles
 * gives a ranked list of outlets that publish about those places.
 */
export function citationHosts(wikitext: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const url of urlsIn(wikitext)) {
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return counts;
}

/* ───────────────────────── Officeholder templates ────────────────────────── */

/**
 * Parse an officeholder template into named people. These are prose templates
 * of the shape `Name (P, Place)`, the same parenthetical grammar as the roster.
 * `<noinclude>` is cut first; its category text would otherwise parse as people.
 */
export function parseOfficeholderTemplate(
  templateWikitext: string,
  bodyName: string,
): WikiOfficial[] {
  const body = templateWikitext.split(/<noinclude>/i)[0];
  const spanRefs = resolveRefNames(body, refs(body));
  const citationUrls = [...new Set(spanRefs.flatMap((r) => r.urls))];
  const text = plain(body);

  const out: WikiOfficial[] = [];
  const seen = new Set<string>();
  // A person is a capitalised name immediately followed by a parenthetical that
  // opens with a party letter or party word.
  const re =
    /([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]*\.?){0,3})\s+\((R|D|I|Republican|Democrat|Democratic|Independent)(?:,\s*([^)]*))?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const { title, name } = splitTitle(m[1].trim());
    if (name.length < 3 || seen.has(name)) continue;
    seen.add(name);
    const party = /^[RDI]$/.test(m[2]) ? m[2] : (PARTY_WORDS[m[2].toLowerCase()] ?? null);
    const tail = m[3] ?? "";
    const years = tail.match(/\b(19|20)\d{2}\b/g) ?? [];
    out.push({
      name,
      title,
      party,
      termEnds: years.length > 0 ? Number(years[years.length - 1]) : null,
      seat: tail.replace(/term ends\s*\d{4}/i, "").replace(/[,;]\s*$/, "").trim() || null,
      body: bodyName,
      rawParenthetical: m[2] + (m[3] === undefined ? "" : ", " + m[3]),
      citationUrls,
    });
  }

  // A Senate template may spell the party once for both members
  // ("by Democrats Name (Place, term ends 2027) and Name (…)").
  if (out.length === 0) {
    const shared = /\bby\s+(Republicans|Democrats|Independents)\s+/.exec(text);
    const party =
      shared === null ? null : (PARTY_WORDS[shared[1].toLowerCase().replace(/s$/, "")] ?? null);
    const re2 = /([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]*\.?){0,3})\s+\(([^)]*term ends[^)]*)\)/g;
    while ((m = re2.exec(text)) !== null) {
      const { title, name } = splitTitle(m[1].trim());
      if (name.length < 3 || seen.has(name)) continue;
      seen.add(name);
      const years = m[2].match(/\b(19|20)\d{2}\b/g) ?? [];
      out.push({
        name,
        title,
        party,
        termEnds: years.length > 0 ? Number(years[years.length - 1]) : null,
        seat: null,
        body: bodyName,
        rawParenthetical: m[2],
        citationUrls,
      });
    }
  }

  return out;
}

/* ───────────────────────────── The whole page ────────────────────────────── */

export interface MunicipalityParse {
  requested: string;
  title: string | null;
  fetchedAt: string;
  /** Non-null when nothing could be parsed, with the reason. */
  missReason: string | null;
  governingBody: GoverningBody | null;
  mayor: WikiOfficial | null;
  council: WikiOfficial[];
  representation: Representation | null;
  externalLinks: ExternalLink[];
  /** Headings found, so a failed section lookup is diagnosable, not mysterious. */
  headings: string[];
}

/**
 * One municipality article, read. Every field is independently nullable and
 * the headings are always returned, so a differently named section is
 * diagnosable.
 */
export function parseMunicipality(page: WikiPage): MunicipalityParse {
  const base: MunicipalityParse = {
    requested: page.requested,
    title: page.title,
    fetchedAt: page.fetchedAt,
    missReason: page.missReason,
    governingBody: null,
    mayor: null,
    council: [],
    representation: null,
    externalLinks: [],
    headings: [],
  };
  if (page.wikitext === null) return base;

  const w = page.wikitext;
  base.headings = headings(w);
  base.externalLinks = parseExternalLinks(w);

  const lg = section(w, "Local government") ?? section(w, "Government");
  if (lg === null) {
    return { ...base, missReason: "no Local government or Government section" };
  }

  const gb = parseGoverningBody(lg);
  const roster = parseRoster(lg, gb.bodyName);
  let mayor = parseMayor(lg);
  // Committee forms choose the mayor from the members; the roster carries the title.
  if (mayor === null) mayor = roster.officials.find((o) => o.title === "Mayor") ?? null;

  const repSection =
    section(w, "Federal, state, and county representation") ??
    section(w, "Federal, state and county representation") ??
    section(w, "Federal, state, and local representation");

  return {
    ...base,
    governingBody: gb,
    mayor,
    council: roster.officials,
    representation: repSection === null ? null : parseRepresentation(repSection),
  };
}

/* ─────────────────────── Confirming against the citation ─────────────────── */

export type CitationVerdict = "CONFIRMED" | "LEAD" | "UNREACHABLE" | "NO_CITATION";

export interface CitationCheck {
  person: string;
  verdict: CitationVerdict;
  /** The URL that confirmed it, where one did. */
  confirmedBy: string | null;
  /** Every citation URL tried, with what each returned. */
  attempts: { url: string; status: number | string; mentioned: boolean }[];
  checkedAt: string;
}

/**
 * Wikipedia names the person; the citation proves them. Deliberately weak:
 * the cited primary source is fetched and asked whether it mentions the
 * person's surname.
 *
 * `CONFIRMED`: a cited source was reached and mentions them. `LEAD`: reached
 * and does not. `UNREACHABLE`: no citation could be fetched (a fact about the
 * fetch, never the person). `NO_CITATION`: the article gave no footnote.
 */
export async function confirmAgainstCitation(
  official: WikiOfficial,
  fetcher: WikiFetcher,
  now: string,
): Promise<CitationCheck> {
  const surname = surnameOf(official.name);
  const attempts: CitationCheck["attempts"] = [];

  if (official.citationUrls.length === 0) {
    return { person: official.name, verdict: "NO_CITATION", confirmedBy: null, attempts, checkedAt: now };
  }

  let reachedAny = false;
  for (const url of official.citationUrls) {
    let res: { status: number; body: string };
    try {
      res = await fetcher(url);
    } catch (err) {
      attempts.push({ url, status: (err as Error).message, mentioned: false });
      continue;
    }
    const ok = res.status === 200;
    if (ok) reachedAny = true;
    const mentioned = ok && mentions(res.body, surname);
    attempts.push({ url, status: res.status, mentioned });
    if (mentioned) {
      return { person: official.name, verdict: "CONFIRMED", confirmedBy: url, attempts, checkedAt: now };
    }
  }

  return {
    person: official.name,
    verdict: reachedAny ? "LEAD" : "UNREACHABLE",
    confirmedBy: null,
    attempts,
    checkedAt: now,
  };
}

/** The surname, which is the last token that is not a generational suffix. */
export function surnameOf(name: string): string {
  const tokens = name
    .replace(/"[^"]*"/g, " ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v", "esq"]);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (suffixes.has(t.toLowerCase())) continue;
    if (t.length >= 2) return t;
  }
  return tokens[tokens.length - 1] ?? name;
}

/** Case- and entity-tolerant mention test against a fetched document's text. */
export function mentions(body: string, surname: string): boolean {
  if (surname.length < 3) return false;
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return text.includes(surname.toLowerCase());
}
