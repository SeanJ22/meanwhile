/**
 * Where a ZIP-playbook step that names no place applies. A step that names a
 * state, or a website that belongs to one state, applies to that state. A
 * generic search method (a query pattern, a site: or inurl: pattern, a
 * national source) is offered anywhere it fits. The rest name no place and
 * wait on the review list for the state profiles. Pure: reads only the
 * step's own words.
 */

import type { FieldManualEntry } from "./field-manual.ts";

export const RUNG_KIND = "PLAYBOOK_RUNG";

const STATES: Readonly<Record<string, string>> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  dc: "District of Columbia", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah",
  vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

/** A state's name as a word, in any case; Washington only as the state, since towns and counties share the name; Virginia never inside West Virginia. */
const NAME_PATTERNS: readonly (readonly [string, RegExp])[] = Object.entries(STATES).map(([code, name]) => [code,
  code === "wa" ? /\b(?:Washington State|State of Washington)\b/i
    : code === "va" ? /(?<!West\s)\bVirginia\b/i
      : new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i")] as const);

const CODES = Object.keys(STATES).join("|");
/**
 * A website that belongs to one state: `*.nh.gov` or `*.nh.us`, a state office named for it (`azsos.gov`), or a
 * town that signs its own website with its state (`suttonnh.gov`). Federal sites whose names happen to end that way are not.
 */
const STATE_HOST = new RegExp(`(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*(${CODES})\\.(?:gov|us)\\b|(?<![a-z0-9.-])(${CODES})(?:sos|leg|elections)\\.gov\\b|(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*([a-z]{4,})(${CODES})\\.(?:gov|us)\\b`, "gi");
const FEDERAL_HOSTS = new Set(["va.gov", "interior.gov", "labor.gov"]);
/** The two-letter code beside a ZIP code ("AZ 85641"), an id that carries the state ("state:nh", "US-AZ"), or a session label ("NJ2"). */
const STATE_CODE = /\b([A-Z]{2}) \d{5}\b|\bstate:([a-z]{2})\b|\bUS-([A-Z]{2})\b|^([A-Z]{2})\d+\b/g;

/** A way of finding things that works the same anywhere: a search pattern, or a source that covers the whole country. */
const GENERIC_SEARCH = /\b(?:site|inurl|intitle|filetype):|\bsearch (?:query|queries|engine|results?)\b|\bliteral query\b|\bweb search\b|\bGoogle\b|\bBing\b|\bDuckDuckGo\b|\bMarginalia\b|\bCensus of Governments\b|\.gov registry\b|\bLegiScan\b|\bcongress\.gov\b|\bBallotpedia\b|\bWikipedia\b|\bOpen States\b|\bnationally\b|\bevery zip in the country\b/i;

/** The words of a step: its title, summary and recorded text. */
export function rungText(entry: Pick<FieldManualEntry, "title" | "summary" | "url" | "payload">): string {
  return [entry.title, entry.summary, entry.url ?? "", JSON.stringify(entry.payload ?? null)].join(" ");
}

/** The states a step names, by name, by one of their websites, or by code beside a ZIP code. */
export function rungStates(text: string): string[] {
  const out = new Set<string>();
  for (const [code, pattern] of NAME_PATTERNS) if (pattern.test(text)) out.add(code);
  for (const match of text.matchAll(STATE_HOST)) {
    if (FEDERAL_HOSTS.has(match[0].toLowerCase().replace(/^.*?([a-z0-9-]+\.(?:gov|us))$/, "$1"))) continue;
    out.add((match[1] ?? match[2] ?? match[4])!.toLowerCase());
  }
  for (const match of text.matchAll(STATE_CODE)) {
    const code = (match[1] ?? match[2] ?? match[3] ?? match[4])!.toLowerCase();
    if (code in STATES) out.add(code);
  }
  return [...out].sort();
}

export const isGenericSearchMethod = (text: string): boolean => GENERIC_SEARCH.test(text);

export type RungSort = "STATE" | "METHOD" | "REVIEW";

/** Whether a step still names no place, state or platform and so needs sorting. */
export function unsortedRung(entry: FieldManualEntry): boolean {
  return entry.kind === RUNG_KIND && entry.states.length === 0 && entry.platforms.length === 0 && (entry.ocdIds?.length ?? 0) === 0
    && (entry.bodyIds?.length ?? 0) === 0 && entry.portable !== true && entry.reach?.method !== true;
}

/** A step sorted by its own words: given its states, offered anywhere it fits, or left as it was for review. */
export function sortRung(entry: FieldManualEntry): { readonly entry: FieldManualEntry; readonly sort: RungSort } | null {
  if (!unsortedRung(entry)) return null;
  const text = rungText(entry);
  const states = rungStates(text);
  if (states.length > 0) return { entry: { ...entry, states }, sort: "STATE" };
  if (isGenericSearchMethod(text)) {
    return { entry: { ...entry, reach: { places: [], states: [], platforms: [], everywhere: false, ...entry.reach, method: true } }, sort: "METHOD" };
  }
  return { entry, sort: "REVIEW" };
}
