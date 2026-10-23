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
  readonly stateName: string | null;
  /** Registered official hosts for this entity and its parents. */
  readonly hosts: readonly string[];
  readonly externalIds: readonly string[];
}

export interface Claim {
  readonly entity: CheckEntity;
  readonly fieldKind: FieldKind;
  /** A campaign site describing anyone but itself is OTHER. */
  readonly provenance: Provenance;
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
  if (!site.includes("/")) return host === site || host.endsWith(`.${site}`);
  const { pathname } = new URL(url);
  const at = `${host}${pathname}`.toLowerCase(), own = site.toLowerCase();
  return at === own || at.startsWith(`${own}/`);
}

/** Any .gov site is official; so is a site an official page or door registered for this entity or a parent. */
export function isOfficialUrl(url: string, entitySites: readonly string[]): boolean {
  const host = hostOf(url);
  return host === "gov" || host.endsWith(".gov") || entitySites.some(site => ownSite(url, site));
}

/** Judgment calls: matching one person across sources, an unofficial portrait, and anything a third party says about someone else. */
export function needsSecondSource(kind: FieldKind, provenance: Provenance, url: string): boolean {
  if (kind === "same_person_link") return true;
  if (kind === "portrait") return provenance !== "OFFICIAL" && provenance !== "CAMPAIGN" && provenance !== "OWNER" && hostOf(url) !== "commons.wikimedia.org";
  return provenance === "OTHER";
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

/** A link's own address is on the saved copy when the sentence beside it does not spell it out. */
export const linkQuote = (value: string, quote: string): string =>
  /^https?:\/\//i.test(value) && boundedIndexOf(normalizeText(quote), value) === -1 ? value : quote;

/** A place as people write it on its own pages: "City Of Coolidge" and "Coolidge city governing" are "Coolidge", "Eloy School District 11" is "Eloy". */
const placeCore = (name: string): string => name.replace(/^(city|town|village|borough|township|county|municipality)\s+of\s+/i, "")
  .replace(/\s+((city|town|village|borough|township|county)\s+)?governing$|\s+school board$/i, "")
  .replace(/\s+((elementary|unified|union|high|joint)\s+)*(school\s+)?district(\s+(no\.?\s*)?\d+)?$/i, "").trim();

/** The page is on a .gov host or the entity's own site, carries one of its ids, or names it with its state spelled out or abbreviated. */
function aboutEntity(entity: CheckEntity, copy: SavedCopy): boolean {
  if (isOfficialUrl(copy.finalUrl, entity.hosts)) return true;
  const text = copyText(copy);
  if (entity.externalIds.some(id => boundedIndexOf(text, id) !== -1)) return true;
  const lower = text.toLowerCase();
  const named = [entity.fullName, placeCore(entity.fullName)].some(name => name !== "" && boundedIndexOf(lower, name.toLowerCase()) !== -1);
  const code = entity.stateName === null ? null : stateCodeOf(entity.stateName);
  return named && (entity.stateName === null || boundedIndexOf(lower, entity.stateName.toLowerCase()) !== -1 ||
    code !== null && boundedIndexOf(text, code) !== -1);
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
