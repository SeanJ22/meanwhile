/**
 * **RULING 87 — WIKIPEDIA AS A TIER A DISCOVERY SOURCE.**
 * (Built 2026-08-22, NJ Hunt 5 item 3.)
 *
 * ## The route six hunt sessions never walked
 *
 * A person with a browser types *2026 New Jersey elections*, clicks the second
 * result, clicks through to Rockaway Township, and reads the mayor, all nine
 * council members with party and ward, all seven Morris County commissioners,
 * the three county constitutional officers, the state legislative district, the
 * congressional district, and links to the township site, the school district,
 * NCES and the fire department — every fact footnoted to a primary source.
 *
 * Six sessions of this project walked increasingly sophisticated routes past
 * increasingly determined walls and never opened that page. RULING 85 is the
 * rule that came out of it and this module is the instrument.
 *
 * ## What this module is, and the line it may never cross
 *
 * **A DISCOVERY source, never a source of record.** Nothing here is a fact this
 * product will render. What comes out is a NAME plus the FOOTNOTE the
 * encyclopedia attached to it, and the footnote is then fetched and read before
 * the name means anything — `confirmAgainstCitation` is that step. Wikipedia
 * names the person; the citation proves them. A name whose citation cannot be
 * confirmed is a `LEAD`, and a `LEAD` is a thing for a session to go and work,
 * never a row in front of a reader.
 *
 * That is not caution about accuracy. It is the never-generate-a-position rule
 * and the transparency mandate's evidence standard, both of which require a
 * source record pointing at a specific statement, filing or roll-call — and *an
 * encyclopedia said so* is not one of those, however right it happens to be.
 *
 * ## Why one parser reads roughly 19,000 articles
 *
 * US municipality articles are templated to a degree that is easy to
 * underestimate. The Local government section carries a form-of-government
 * sentence, a body-composition sentence and a roster sentence, in that order, in
 * a small number of shapes. Four Morris County municipalities, four different
 * forms of government, and the same three sentences:
 *
 * - *Rockaway Township is governed within the Faulkner Act … (Plan F) … The
 *   township council is comprised of nine members, with one member elected from
 *   each of six wards and three elected on an at-large basis … Members of the
 *   Township Council are Council President Howard Morrison (R, 2027;
 *   At-large), …*
 * - *Rockaway is governed under the borough form … The borough council includes
 *   six members … Members of the Rockaway Borough Council are Council President
 *   Melissa Burnside (R, 2026), …*
 * - *Boonton Township is governed under the Township form … The Township
 *   Committee is comprised of five members … members of the Boonton Township
 *   Committee are Mayor Brian Honan (R, term on committee ends December 31,
 *   2026; term as mayor ends 2024), …*
 * - *Dover operates using the Town form … Members of the Town Council are
 *   Christopher Almada (Ward 3; D, 2027), …*
 *
 * The member shape varies in ways that matter and are finite: the seat can come
 * before or after the party, the term can be a bare year or a whole clause, the
 * first member usually carries an expanded party wikilink the rest abbreviate,
 * and an office title may be glued to the front of the name. All four are
 * handled below and each is named where it is handled, because the next state
 * will bring a fifth and the person adding it needs to see the seams.
 *
 * ## The form-of-government line is the twig enumerator
 *
 * RULING 57 says a body is NAMED FIRST and hunted second, and the hardest part
 * of naming is knowing what exists. The form-of-government sentence answers it
 * outright — *nine members, six wards, three at-large* is a prediction about the
 * registry that can be checked against the registry, and a disagreement is a
 * finding either way. `parseGoverningBody` extracts that prediction.
 *
 * ## Facts, not prose
 *
 * Names, parties, term dates and districts are facts and are not copyrightable.
 * This module extracts facts and follows footnotes. It never copies a sentence
 * through to a reader surface, and `blurb` and `photo` are `forbiddenFor` on
 * both Wikipedia routes in the manifest so that no later session can quietly
 * start.
 */

import { OUTBOUND_CONTACT } from "../geo/outbound-agent.ts";

/* ────────────────────────────── Retrieval ────────────────────────────────── */

/**
 * Identified, per the public-records rule's rate discipline.
 *
 * The address is COMPOSED from `lib/geo/outbound-agent.ts` rather than written
 * here. R40 removed the author's personal address from everything a browser can
 * reach and `tests/feedback.test.ts` holds that with exactly ONE exemption; this
 * module copied the literal and the guard caught it, which is the same mistake
 * `/api/voting-sites` made and the same fix.
 */
export const WIKI_USER_AGENT = `we-the-people/1.0 (civic data for a public-records product; contact: ${OUTBOUND_CONTACT})`;

export const WIKI_API = "https://en.wikipedia.org/w/api.php";

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
 * **Fetch one page's raw wikitext.** Rung 2 — a plain identified GET.
 *
 * The API is used rather than the rendered HTML for one reason that matters: the
 * rendered page throws the footnote markers away into superscripts and link
 * targets, and the footnote is the whole point. Wikitext keeps `<ref>` attached
 * to the sentence it belongs to.
 *
 * `redirects=1` is not a convenience. `Template:NJ Morris County Commissioners`
 * is a redirect to `Template:NJ Morris County commissioners`, and a session that
 * did not follow it would record seven county commissioners as unreachable on
 * the strength of a capital letter.
 */
export async function fetchWikitext(
  title: string,
  fetcher: WikiFetcher,
  now: string,
): Promise<WikiPage> {
  const url =
    `${WIKI_API}?action=query&redirects=1&prop=revisions&rvprop=content&rvslots=main` +
    `&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;

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
  if (res.status !== 200) return { ...base, missReason: `HTTP ${res.status}` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return { ...base, missReason: "the API did not answer with JSON" };
  }

  const pages = (parsed as { query?: { pages?: unknown[] } }).query?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    return { ...base, missReason: "the API answered with no pages" };
  }
  const page = pages[0] as {
    missing?: boolean;
    title?: string;
    pageid?: number;
    revisions?: { slots?: { main?: { content?: string } } }[];
  };
  if (page.missing === true) return { ...base, missReason: "no such article" };

  const content = page.revisions?.[0]?.slots?.main?.content;
  if (typeof content !== "string" || content.length === 0) {
    // RULING: a zero-row extraction is a FAILED extraction, never an empty document.
    return { ...base, missReason: "the article exists and returned no wikitext" };
  }

  return {
    ...base,
    title: page.title ?? title,
    pageId: page.pageid ?? null,
    wikitext: content,
    missReason: null,
  };
}

/* ─────────────────────────── Wikitext primitives ─────────────────────────── */

/**
 * One section's body, by heading text, at any heading depth.
 *
 * Headings are matched case-insensitively and tolerate the inconsistent
 * whitespace real articles carry — `== Government ==` and `==Government==` both
 * appear in Morris County, sometimes in the same article.
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
 * **Pull the `<ref>` footnotes out of a run of wikitext.**
 *
 * Three shapes, all live in Morris County: a full `<ref>body</ref>`, a
 * self-closing back-reference `<ref name=X />`, and a `{{cite web|url=…}}`
 * template inside a full ref. A named back-reference carries no URL of its own,
 * so `resolveRefNames` puts the body back before the URLs are read — otherwise
 * the second and later uses of `<ref name=Mayor />` would each look like a
 * citation with no source, which is indistinguishable from a fact with no
 * citation and would drag the confirmation rate down for no reason.
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
 * **The form-of-government prediction — RULING 87's twig enumerator.**
 *
 * What it reads, in the four shapes Morris County actually uses:
 *
 * - `governed within the [[Faulkner Act]] … under the … Mayor-Council system …
 *   (Plan F)` → form `Faulkner Act`, plan `F`
 * - `governed under the [[Borough (New Jersey)|borough]] form … used in 218
 *   municipalities of the 564 statewide` → form `borough`, 218 of 564
 * - `governed under the [[Township (New Jersey)|Township]] form … one of 141
 *   municipalities (of the 564) statewide` → form `Township`, 141 of 564
 * - `operates using the [[Town (New Jersey)|Town]] form … one of nine
 *   municipalities (of the 564)` → form `Town`, 9 of 564
 *
 * And the composition sentence, which is the part that predicts the registry:
 * *nine members, with one member elected from each of six wards and three
 * elected on an at-large basis* → 9 seats, 6 ward, 3 at-large.
 *
 * Every field is independently nullable on purpose. A partial read is worth
 * having and a missing clause is never guessed — the operation-count rule
 * applied to a parser: what it did not find, it says it did not find.
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
   * **The hyphenated form — `the seven-member township council`** (NJ Hunt 6).
   *
   * The composition pattern above wants *The X is comprised of N members*.
   * Denville writes *The governing body is comprised of the mayor and the
   * seven-member township council*, and Dover, Boonton Township and others use
   * the same construction. `seats` came back null for **eleven of thirty-nine**
   * Morris municipalities, and a null seat count is not a small loss: it is the
   * denominator the roster completeness gate checks against, so every one of
   * those bodies was unwirable for want of a hyphen.
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
 * Office titles that appear glued to the front of a name.
 *
 * **Longest-first is load-bearing** — `Deputy Director` must be tried before
 * `Director`, or Morris County's deputy director enters the record as a person
 * called *Director John Krickus*.
 *
 * The county row is the interesting half: a New Jersey county commissioners
 * template carries the seven commissioners AND the three constitutional
 * officers — Clerk, Sheriff, Surrogate — in one list, so stripping these titles
 * is what separates the county governing body from the row officers.
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
 * **Split a roster sentence into members.**
 *
 * The separators are `, ` and ` and `, and neither may be split inside a
 * parenthetical — `(R, 2029; Ward 5)` contains a comma that is not a separator,
 * and a naive split produces eighteen half-members from a nine-member council.
 * Quoted nicknames (`Emanuel "Manny" Friedlander`) contain neither, but are
 * respected anyway because `John "Jack, Jr." Quinn` is the shape that will
 * eventually appear.
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
         * **A closing parenthesis is a separator when nothing else is** (NJ
         * Hunt 6). Boonton's roster sentence runs
         * `Luisa F. Lopez (Ward 4; D, 2027) Kimberly Mazzei (Ward 3; D, 2027)
         * John P. Meehan (Ward 1; R, 2027) and Cy Wekilsky (…)` — three
         * members with no comma between them, in the article's own text. The
         * comma-and-`and` split produced ONE entry carrying three people, so
         * Mazzei and Meehan did not exist and Lopez inherited the wrong ward:
         * two sitting council members deleted and one misdescribed, from a
         * missing punctuation mark.
         *
         * A `)` that returns depth to zero, followed by whitespace and a
         * capital letter that is not a connective, therefore ends the entry.
         * Where the article DOES punctuate, the comma or ` and ` is consumed
         * next and the empty buffer is filtered out, so this never
         * double-splits a well-formed list.
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
          // `Marcos Tapia-Aguilar, Sr. (Ward 4; D, 2026)` — a generational
          // suffix is part of the name, and splitting on its comma produced a
          // council member called `Sr.` in Dover.
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
 * **Parse one member entry.**
 *
 * The four live shapes, and the seam each one exercises:
 *
 * | Shape | From | Exercises |
 * | --- | --- | --- |
 * | `Howard Morrison (R, 2027; At-large)` | Rockaway Township | party, year, seat |
 * | `Melissa Burnside (R, 2026)` | Rockaway Borough | no seat at all |
 * | `Christopher Almada (Ward 3; D, 2027)` | Dover | seat BEFORE party |
 * | `Brian Honan (R, term on committee ends December 31, 2026; term as mayor ends 2024)` | Boonton Township | a term CLAUSE, and two of them |
 *
 * The party is read as a single letter wherever one appears as its own token,
 * and as a word where the article spells it out — the first member of a roster
 * usually carries `[[Republican Party (United States)|R]]`, which `plain` has
 * already reduced to `R`, but some articles expand it to `Republican` instead.
 *
 * The term year is the LAST four-digit year in the parenthetical that is not
 * part of a seat, which is what makes the Boonton shape work: *term on committee
 * ends December 31, 2026; term as mayor ends 2024* is two years, and the one
 * this product wants is the seat's, not the chairmanship's. That is a judgement
 * call and it is stated here rather than left implicit — where the two disagree
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
    // The seat's term, not a chairmanship's. Dover writes the seat first
    // (`Ward 3; D, 2027`) and Boonton Township writes two term clauses
    // (`term on committee ends December 31, 2026; term as mayor ends 2024`), so
    // the clause is chosen for CARRYING A YEAR first, and among those the one
    // that is not about holding an office.
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
 * **Does this bare name look like a person?** (NJ Hunt 6.)
 *
 * Mount Olive's roster sentence ends `…John Mania (R, 2025), Mary Lalama, and
 * Raffaele Ruggiero.` — two sitting council members whom the article names
 * without a party or a term. The roster filter kept only entries carrying a
 * party, a year or a seat, so both were discarded as prose and a seven-member
 * council rendered as five.
 *
 * **The discarded ones are the members the encyclopedia says least about**,
 * which is the equal-effort failure exactly: a filter keyed on how much detail
 * an entry carries deletes the least-documented people first. So a bare entry
 * survives when it reads as a personal name — every token capitalised, an
 * initial, a particle or a suffix — and carries no word that names an office.
 * It is still only a NAME, and RULING 87 governs it from there: it is a `LEAD`
 * until its own citation is read, exactly like every other name on the page.
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
}

/**
 * The lead-in phrases that introduce a roster sentence. Ordered longest-first so
 * a specific one wins over a general one. **Append-only** — a phrase that stops
 * appearing costs nothing to keep, and deleting one is how the next state's
 * parse silently returns zero.
 */
export const ROSTER_LEAD_INS = [
  "members of the",
  "the members of the",
  "members of",
];

/**
 * **Find and parse the roster sentence.**
 *
 * The sentence is located by lead-in, then taken to the end of the sentence —
 * which is *not* simply the next full stop, because `Thomas J. Haynes III` and
 * `Marcos Tapia-Aguilar, Sr.` both contain one. The end is a full stop followed
 * by whitespace and a capital letter or end-of-text, with initials and common
 * abbreviations excluded.
 *
 * Refs are pulled from the ORIGINAL wikitext of that span before `plain`
 * removes them, so the citation set travels with the roster it belongs to.
 */
export function parseRoster(localGovernment: string, bodyName: string | null): RosterParse {
  const empty: RosterParse = { officials: [], sentence: null, leadIn: null, citationUrls: [] };

  /**
   * **A lead-in is not enough, and this is the defect that taught it.** The
   * composition sentence — *The members of the governing body are elected to
   * staggered four-year terms…* — starts with the same three words as the
   * roster sentence and contains no people at all. Matching the first lead-in
   * returned six fragments of prose for a nine-member council, with every field
   * null, and it looked like a successful parse.
   *
   * So every candidate sentence is PARSED and the best result wins, scored on
   * how many entries came back looking like a person: a name plus a
   * parenthetical carrying a party letter or a term year. Prose scores zero
   * because prose has no parentheticals.
   */
  let best: RosterParse | null = null;
  let bestScore = 1; // a roster names at least two people

  for (const s of sentences(localGovernment)) {
    /**
     * **The lead-in is REPORTED, never REQUIRED.** An earlier version gated on
     * a phrase list and lost Montville, whose roster sentence is *Montville's
     * Township Committee is comprised of Mayor Matthew S. Kayne (R, …)* — a
     * possessive with no `members of` anywhere in it. Four of thirty-nine
     * municipalities were lost the same way.
     *
     * Scoring makes the phrase list unnecessary: prose scores zero because
     * prose has no `(R, 2027; Ward 4)` in it, so every sentence can be tried
     * and the best one wins. The list survives only so the report can say which
     * shape matched, and so a genuinely new shape is visible rather than
     * silently absorbed.
     */
    const lower = s.text.toLowerCase();
    const leadIn = ROSTER_LEAD_INS.find((p) => lower.includes(p + " ")) ?? null;

    /**
     * **The past tense is a copula too** (NJ Hunt 6). Pequannock's roster
     * sentence is *As of 2023, Pequannock's Township Council was composed of
     * Mayor David G. Kohle (R, …)* — five sitting council members behind a
     * `was` where the list only knew `is`. The whole municipality parsed to
     * zero officials and reported as a body with no roster, which is the
     * zero-row-extraction failure: the parser had told us about itself, not
     * about the document. Append-only, like the lead-in list.
     */
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
       * Keep the entries that look like people. An entry carrying a party, a
       * term year or a seat is one; so is a bare personal name (NJ Hunt 6 —
       * see `looksLikePersonName`, and the two Mount Olive members the
       * stricter test deleted). A trailing clause is neither.
       *
       * The SCORE above stays on the strict test on purpose: a sentence full
       * of capitalised prose must not out-score a real roster.
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
    };
  }

  return best ?? empty;
}

/**
 * **Split a run of wikitext into sentences, keeping the RAW text of each.**
 *
 * This is what makes matching possible at all. The roster and mayor sentences
 * have to be located by their PLAIN text — `[[Mayor]] of Rockaway Township is`
 * does not match `mayor of` — while the footnotes have to be read out of the
 * RAW text, because `plain` deletes them. Splitting first and rendering each
 * sentence separately keeps both, and it is why an early version of this parser
 * read the composition sentence as a roster and returned six fragments of prose
 * where nine council members were sitting.
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
 * **Where the sentence ends.**
 *
 * Three things make this harder than finding the next full stop, and all three
 * cost real data before they were handled:
 *
 * 1. **A `<ref>` is full of sentences that are not this sentence.** *Mayor,
 *    Rockaway Township. Accessed April 27, 2023.* sits inside the footnote
 *    attached to the mayor sentence, so a naive split ended the sentence inside
 *    its own citation and every extracted person came back with zero citation
 *    URLs — which would have made the confirmation rate 0 of N for reasons that
 *    have nothing to do with Wikipedia.
 * 2. **The footnotes come AFTER the full stop and belong to the sentence.** So
 *    the end is pushed past any run of refs that immediately follows.
 * 3. **Names contain full stops.** `Thomas J. Haynes III`, `Marcos
 *    Tapia-Aguilar, Sr.`, `St. Clair`.
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
 * **The mayor sentence.**
 *
 * *the Mayor of Rockaway Township is Republican Joseph Jackson, whose term
 * expires on December 31, 2027* and *the mayor of Rockaway is Republican Thomas
 * Mulligan, whose term of office ends December 31, 2027* are the same sentence
 * with different verbs, and both appear in one county.
 *
 * Where the mayor is chosen BY the governing body rather than elected — the
 * Township Committee form — there is no such sentence, and the mayor appears in
 * the roster with a glued title instead. That returns `null` here and is not a
 * miss: `parseMunicipality` looks for the glued title before it concludes the
 * mayor is unnamed.
 */
export function parseMayor(localGovernment: string): WikiOfficial | null {
  // Located on the PLAIN text of each sentence — `[[Mayor]] of Rockaway
  // Township is` does not match `mayor of` until the wikilink is rendered — and
  // the footnotes are read off that same sentence's RAW text.
  const hit = sentences(localGovernment).find((s) =>
    /\bmayor\s+of\s+[^.]{2,60}?\s+is\s+/i.test(s.text),
  );
  if (hit === undefined) return null;
  const spanRefs = resolveRefNames(localGovernment, refs(hit.raw));
  const citationUrls = [...new Set(spanRefs.flatMap((r) => r.urls))];

  const text = hit.text;
  // The name may carry a middle initial — `Democrat James P. Dodd` — so the
  // full stop cannot be excluded from it. The name runs to the comma or to
  // `whose`, which is how every one of these sentences is built.
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

export interface Representation {
  congressionalDistrict: string | null;
  legislativeDistrict: string | null;
  /** The officeholder templates the section transcludes, by name. */
  officeholderTemplates: string[];
  citationUrls: string[];
}

/**
 * The Federal/state/county representation section: two district numbers and,
 * more valuably, the names of the templates that carry the actual officeholders.
 * `{{NJ Legislative 25}}` and `{{NJ Morris County Commissioners}}` are where the
 * senator, the two assembly members and the seven commissioners live, and they
 * are fetched as their own pages.
 */
export function parseRepresentation(sectionText: string): Representation {
  const text = plain(sectionText);
  const cd = /(\d+)(?:st|nd|rd|th)\s+Congressional District/i.exec(text);
  const ld =
    /(\d+)(?:st|nd|rd|th)\s+state\s+legislative\s+district/i.exec(text) ??
    /state\s+legislative\s+district\s+(\d+)/i.exec(text);

  const templates = transclusions(sectionText).filter((t) =>
    /^(NJ|AZ|NH|US)\s|Congress|Senate|Legislative|Commissioner|Freeholder/i.test(t),
  );
  const spanRefs = resolveRefNames(sectionText, refs(sectionText));

  return {
    congressionalDistrict: cd === null ? null : cd[1],
    legislativeDistrict: ld === null ? null : ld[1],
    officeholderTemplates: templates,
    citationUrls: [...new Set(spanRefs.flatMap((r) => r.urls))],
  };
}

export interface ExternalLink {
  url: string;
  label: string | null;
}

/**
 * The External links block. This is where the township site, the school
 * district, the NCES data page and the fire department are written down — four
 * Tier B starting points per municipality, handed over in one read.
 */
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
 * **The citation host map — the `press-outlet-map` route's raw material.**
 *
 * An article's reference list is a curated bibliography of who actually
 * publishes about this place, assembled by people with no stake in our hunt.
 * Counting hosts across a state's articles produces a ranked list of the outlets
 * worth querying directly, which is strictly better than asking a general engine
 * and hoping.
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
 * **Parse an officeholder template into named people.**
 *
 * These are prose templates, not tables: *the 25th legislative district … is
 * represented in the State Senate by Anthony M. Bucco (R, Boonton Township) and
 * in the General Assembly by Aura K. Dunn (R, Mendham Borough) and Marisa
 * Sweeney (D, Morristown).*
 *
 * The shape is `Name (P, Place)` — the same parenthetical grammar the roster
 * uses, with a place where the roster has a term and a seat, so `parseMember`
 * reads it correctly and simply returns `termEnds: null`. That is a real reuse
 * rather than a coincidence: both are the same house style.
 *
 * `<noinclude>` is cut first. It carries the template's own category links and
 * documentation, and its `{{PAGENAME}}` and category text otherwise parse as
 * people.
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

  // The Senate template spells the party once for both members: "represented in
  // the United States Senate by Democrats Cory Booker (Newark, term ends 2027)
  // and Andy Kim (Moorestown, term ends 2031)."
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
 * **One municipality article, read.**
 *
 * Every field is independently nullable and the headings are always returned:
 * an article whose Local government section is called something else produces a
 * null governing body AND the list of what it is actually called, which is a
 * work item rather than a mystery. A parser that returned nothing and said
 * nothing would be the zero-row extraction the constitution forbids.
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
  // The committee forms choose a mayor from among the members; the roster
  // carries the title instead of a sentence of its own.
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
 * **RULING 87's second clause, made mechanical: Wikipedia names the person, the
 * citation proves them.**
 *
 * The test is deliberately weak and deliberately stated as weak: the cited
 * primary source is fetched and asked whether it mentions the person's SURNAME.
 * That is not proof the source says what the article says it says — a session
 * reading the page is what settles that — but it is a real and cheap
 * discriminator, and it catches the failure that actually matters here, which is
 * a name attached to a citation that has nothing to do with them.
 *
 * `CONFIRMED` means a cited source was reached and mentions them. `LEAD` means a
 * source was reached and does not. `UNREACHABLE` means no citation could be
 * fetched — which is a fact about the fetch, never about the person, and never
 * an absence. `NO_CITATION` means the article asserted it with no footnote at
 * all, and that is a finding about the article.
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
