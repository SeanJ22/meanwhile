import { stateCodeOf } from "./entity-read.ts";

export type FieldKind =
  | "officeholder" | "contact" | "comment_rule" | "meeting" | "agenda" | "outcome" | "vote"
  | "money" | "statement" | "portrait" | "ballot" | "law" | "news" | "same_person_link";

export const FIELD_KINDS: readonly FieldKind[] = ["officeholder", "contact", "comment_rule", "meeting", "agenda", "outcome",
  "vote", "money", "statement", "portrait", "ballot", "law", "news", "same_person_link"];

export type Provenance = "OWNER" | "OFFICIAL" | "FILING" | "CAMPAIGN" | "REFERENCE" | "NEWS" | "OTHER";

export interface SavedCopy {
  readonly id: number;
  readonly finalUrl: string;
  readonly text: string;
  readonly fetchedAt: Date;
  readonly isArchive: boolean;
}

export interface CheckEntity {
  readonly id: string;
  readonly fullName: string;
  /** Published spellings retained under this same subject id. */
  readonly names?: readonly string[];
  readonly stateName: string | null;
  /** Registered official hosts for this entity and its parents. */
  readonly hosts: readonly string[];
  readonly externalIds: readonly string[];
}

export interface Claim {
  readonly entity: CheckEntity;
  readonly fieldKind: FieldKind;
  readonly provenance: Provenance;
  /** The subject whose campaign or advocacy site this is, established during acquisition. */
  readonly sourceSubjectId?: string;
  /** The value exactly as written on the page. */
  readonly valueText: string;
  readonly quote: string;
  /** A plain-English rewrite of the page: each sentence with the exact passage of the page it was written from. The value is those sentences, and every passage is on the page. */
  readonly derived?: readonly { readonly text: string; readonly quote: string }[];
  readonly copy: SavedCopy;
  readonly second?: { readonly copy: SavedCopy; readonly quote: string } | null;
}

type CheckReason =
  | "ARCHIVE_NEVER_PROVES_PRESENT" | "QUOTE_NOT_ON_SAVED_COPY" | "VALUE_NOT_IN_QUOTE" | "PAGE_NOT_ABOUT_ENTITY"
  | "COPY_OUTSIDE_FRESHNESS_WINDOW" | "SECOND_SOURCE_REQUIRED" | "SECOND_SOURCE_NOT_INDEPENDENT"
  | `SECOND_${"ARCHIVE_NEVER_PROVES_PRESENT" | "QUOTE_NOT_ON_SAVED_COPY" | "VALUE_NOT_IN_QUOTE" | "PAGE_NOT_ABOUT_ENTITY" | "COPY_OUTSIDE_FRESHNESS_WINDOW"}`;

export type CheckResult = { readonly ok: true; readonly quoteStart: number } | { readonly ok: false; readonly reason: CheckReason };

export const normalizeText = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();
const copyTexts = new WeakMap<SavedCopy, string>();
function copyText(copy: SavedCopy): string {
  let text = copyTexts.get(copy);
  if (text === undefined) { text = normalizeText(copy.text); copyTexts.set(copy, text); }
  return text;
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds needle only when it is not part of a longer word or number: "500" never matches inside "$1,500". */
export function boundedIndexOf(hay: string, needle: string): number {
  if (!needle) return -1;
  if (hay === needle) return 0;
  const re = new RegExp(`(?<![\\p{L}\\p{N}]|\\p{N}[.,])${escapeRegExp(needle)}(?![\\p{L}\\p{N}]|[.,]\\p{N})`, "u");
  const m = re.exec(hay);
  return m ? m.index : -1;
}

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** An entity's own site is a host, or a host and path for a channel its door reads on a shared platform. */
function ownSite(url: string, site: string): boolean {
  const host = hostOf(url);
  const { pathname } = new URL(url);
  site = site.toLowerCase().replace(/^www\./, "");
  // A registered CivicClerk API and its public portal are the same tenant's publication.
  const civicClerk = /^([a-z0-9-]+)\.api\.civicclerk\.com(?:\/v1(?:\/.*)?)?$/i.exec(site);
  if (civicClerk && host === `${civicClerk[1]!.toLowerCase()}.portal.civicclerk.com`) return true;
  const legistar = /^webapi\.legistar\.com\/v1\/([a-z0-9_-]+)(?:\/.*)?$/i.exec(site)
    ?? /^([a-z0-9_-]+)\.legistar\.com(?:\/.*)?$/i.exec(site);
  if (legistar && ["legistar.com", "legistar1.com"].some(domain => host === `${legistar[1]!.toLowerCase()}.${domain}`)) return true;
  if (legistar && /^legistar\d*\.granicus\.com$/.test(host)
    && pathname.toLowerCase().startsWith(`/${legistar[1]!.toLowerCase()}/meetings/`)) return true;
  if (!site.includes("/")) return host === site || host.endsWith(`.${site}`);
  const at = `${host}${pathname}`.toLowerCase(), own = site.toLowerCase();
  return at === own || at.startsWith(`${own}/`);
}

/** Any .gov site is official; so is a site an official page or door registered for this entity or a parent. */
export function isOfficialUrl(url: string, entitySites: readonly string[]): boolean {
  const host = hostOf(url);
  return host === "gov" || host.endsWith(".gov") || entitySites.some(site => ownSite(url, site));
}

/** Judgment calls: matching one person across sources and an unofficial portrait. */
export function needsSecondSource(kind: FieldKind, provenance: Provenance, url: string): boolean {
  if (kind === "same_person_link") return true;
  if (kind === "portrait") return provenance !== "OFFICIAL" && provenance !== "CAMPAIGN" && provenance !== "OWNER" && hostOf(url) !== "commons.wikimedia.org";
  return false;
}

function quoteHolds(copy: SavedCopy, quote: string, valueText: string, kind: FieldKind): "ARCHIVE_NEVER_PROVES_PRESENT" | "QUOTE_NOT_ON_SAVED_COPY" | "VALUE_NOT_IN_QUOTE" | number {
  if (copy.isArchive) return "ARCHIVE_NEVER_PROVES_PRESENT";
  const q = normalizeText(quote);
  const start = q ? copyText(copy).indexOf(q) : -1;
  if (start === -1) return "QUOTE_NOT_ON_SAVED_COPY";
  const value = normalizeText(valueText);
  if (boundedIndexOf(q, value) === -1 && (kind !== "officeholder" || boundedIndexOf(q.toLowerCase(),value.toLowerCase()) === -1)) return "VALUE_NOT_IN_QUOTE";
  return start;
}

/** The line of the saved copy that shows a value, exactly as saved (a long line is cut to the words around the value), to quote for it; null when the copy does not show the value on its own. */
export function lineOf(copy: SavedCopy, valueText: string): string | null {
  const value = normalizeText(valueText), raw = copy.text, at = boundedIndexOf(raw, value), end = raw.indexOf("\n", at);
  const line = at === -1 ? copyText(copy) : normalizeText(raw.slice(raw.lastIndexOf("\n", at) + 1, end === -1 ? undefined : end));
  const found = boundedIndexOf(line, value);
  if (found === -1) return null;
  if (line.length <= 240) return line;
  const reach = 80, from = found <= reach ? 0 : line.indexOf(" ", found - reach) + 1, to = line.lastIndexOf(" ", found + value.length + reach);
  return line.slice(Math.min(from, found), Math.max(to, found + value.length));
}

const csvCells = (row: string): string[] => {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (quoted) { if (ch !== '"') cell += ch; else if (row[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  return [...cells, cell];
};

/** A string or bare token as JSON writes it, starting at `at`: where it ends and what it says. */
function jsonToken(text: string, at: number): { readonly end: number; readonly says: string } | null {
  if (text[at] === '"') {
    for (let end = at + 1; end < text.length; end++) {
      if (text[end] === "\\") end++;
      else if (text[end] === '"') { try { return { end: end + 1, says: String(JSON.parse(text.slice(at, end + 1))) }; } catch { return null; } }
    }
    return null;
  }
  const end = at + (/^[^\s,}\]]+/.exec(text.slice(at, at + 64))?.[0].length ?? 0);
  return end > at ? { end, says: text.slice(at, end) } : null;
}

/**
 * The exact text of a saved API or filing copy that shows one field's value, to quote for a fact from it:
 * `"amount": 113895` in JSON, `<amount>113895</amount>` in XML, the row of a CSV whose `amount` column holds it.
 * Null when the copy has no such field with that value.
 */
export function exactLine(text: string, field: string, valueText: string): string | null {
  if (/^\s*[[{]/.test(text)) {
    for (const key of text.matchAll(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*`, "g"))) {
      const token = jsonToken(text, key.index + key[0].length);
      if (token?.says === valueText) return text.slice(key.index, token.end);
    }
    return null;
  }
  if (/^\s*</.test(text)) {
    const shown = [valueText, valueText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")].map(escapeRegExp).join("|");
    const tag = escapeRegExp(field);
    return new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?(?:${shown})(?:\\]\\]>)?\\s*</${tag}>`).exec(text)?.[0] ?? null;
  }
  const header = text.indexOf("\n"), column = csvCells((header === -1 ? text : text.slice(0, header)).replace(/\r$/, "")).indexOf(field);
  if (column === -1 || !valueText) return null;
  for (let at = text.indexOf(valueText); at !== -1; at = text.indexOf(valueText, at + 1)) {
    const end = text.indexOf("\n", at), row = text.slice(text.lastIndexOf("\n", at) + 1, end === -1 ? undefined : end).replace(/\r$/, "");
    if (csvCells(row)[column] === valueText) return row;
  }
  return null;
}

/** A link's own address is on the saved copy when the sentence beside it does not spell it out. */
export const linkQuote = (value: string, quote: string): string =>
  /^https?:\/\//i.test(value) && boundedIndexOf(normalizeText(quote), value) === -1 ? value : quote;

/** A place as people write it on its own pages: "City Of Coolidge" and "Coolidge city governing" are "Coolidge", "Eloy School District 11" is "Eloy". */
const placeCore = (name: string): string => name.replace(/^(city|town|village|borough|township|county|municipality)\s+of\s+/i, "")
  .replace(/\s+((city|town|village|borough|township|county)\s+)?governing(?: board)?$|\s+school board$/i, "")
  .replace(/\s+((elementary|unified|union|high|joint)\s+)*(school\s+)?district(\s+(no\.?\s*)?\d+)?$/i, "").trim();

/** The page carries one of this entity's ids or names it in its state. */
export function pageNamesEntity(entity: CheckEntity, copy: SavedCopy): boolean {
  const text = copyText(copy);
  if (entity.externalIds.some(id => boundedIndexOf(text, id) !== -1)) return true;
  const lower = text.toLowerCase();
  const named = [entity.fullName, ...entity.names ?? []].flatMap(name => [name, placeCore(name)])
    .some(name => name !== "" && boundedIndexOf(lower, name.toLowerCase()) !== -1);
  const code = entity.stateName === null ? null : stateCodeOf(entity.stateName);
  return named && (entity.stateName === null || boundedIndexOf(lower, entity.stateName.toLowerCase()) !== -1 ||
    code !== null && boundedIndexOf(text, code) !== -1);
}

/** Whether this is a registered site for the entity, independent of the host's .gov status. */
export const isOwnUrl = (url: string, entitySites: readonly string[]): boolean => entitySites.some(site => ownSite(url, site));

function aboutEntity(entity: CheckEntity, copy: SavedCopy): boolean {
  return isOfficialUrl(copy.finalUrl, entity.hosts) || pageNamesEntity(entity, copy);
}

/** The value is on a saved page about this entity, captured inside its freshness window, and nothing more. */
function derivedHolds(copy: SavedCopy, derived: NonNullable<Claim["derived"]>, valueText: string): "ARCHIVE_NEVER_PROVES_PRESENT" | "QUOTE_NOT_ON_SAVED_COPY" | "VALUE_NOT_IN_QUOTE" | number {
  if (copy.isArchive) return "ARCHIVE_NEVER_PROVES_PRESENT";
  if (!derived.length || derived.map(part => part.text).join(" ") !== valueText) return "VALUE_NOT_IN_QUOTE";
  const page = normalizeText(copy.text);
  const starts = derived.map(part => normalizeText(part.quote)).map(quote => quote ? page.indexOf(quote) : -1);
  return starts.includes(-1) ? "QUOTE_NOT_ON_SAVED_COPY" : starts[0]!;
}

export function checkFact(c: Claim, now: Date, windowHours: (k: FieldKind) => number): CheckResult {
  const held = c.derived ? derivedHolds(c.copy, c.derived, c.valueText) : quoteHolds(c.copy, c.quote, c.valueText, c.fieldKind);
  if (typeof held === "string") return { ok: false, reason: held };
  if (!aboutEntity(c.entity, c.copy)) return { ok: false, reason: "PAGE_NOT_ABOUT_ENTITY" };
  const fresh = (copy: SavedCopy) => {
    const age = (now.getTime()-copy.fetchedAt.getTime())/3_600_000;
    return Number.isFinite(age) && age >= 0 && age <= windowHours(c.fieldKind);
  };
  if (!fresh(c.copy)) return { ok: false, reason: "COPY_OUTSIDE_FRESHNESS_WINDOW" };
  if (needsSecondSource(c.fieldKind, c.provenance, c.copy.finalUrl)) {
    if (!c.second) return { ok: false, reason: "SECOND_SOURCE_REQUIRED" };
    if (c.copy.finalUrl === c.second.copy.finalUrl || hostOf(c.copy.finalUrl) === hostOf(c.second.copy.finalUrl) ||
        normalizeText(c.copy.text) === normalizeText(c.second.copy.text)) return { ok: false, reason: "SECOND_SOURCE_NOT_INDEPENDENT" };
    const second = quoteHolds(c.second.copy, c.second.quote, c.valueText,c.fieldKind);
    if (typeof second === "string") return { ok: false, reason: `SECOND_${second}` };
    if (!aboutEntity(c.entity,c.second.copy)) return { ok: false,reason: "SECOND_PAGE_NOT_ABOUT_ENTITY" };
    if (!fresh(c.second.copy)) return { ok: false,reason: "SECOND_COPY_OUTSIDE_FRESHNESS_WINDOW" };
  }
  return { ok: true, quoteStart: held };
}
