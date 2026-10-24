import { pageWords } from "../control-plane/promotion/section3.ts";
import { translationSourceNames } from "./records.ts";

/** What names one measure on a page: the same names the writer step requires of its source. */
export function measureLabels(input: {
  readonly title: string;
  readonly questionText?: string | null;
  readonly officialNumber?: string | null;
  readonly analysisText?: string | null;
}): readonly string[] {
  const designation = input.officialNumber && /[a-z]/i.test(input.officialNumber) && /\d/.test(input.officialNumber) ? input.officialNumber : null;
  const labels = [input.title, input.questionText, input.analysisText, designation].filter((value): value is string => Boolean(value?.trim()));
  // Ballots combine the designation and act title; election-office links often
  // use only the designation, and the bill itself uses only its act title.
  for (const label of designation ? [designation] : [input.title ?? ""]) {
    const numbered = /^(ballot measure|proposition|prop\.?|(?:statewide )?(?:constitutional )?amendment|question|issue|measure|initiative|referendum)\s+(?:no\.?\s*|number\s+|#\s*)?([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s:—–])/i.exec(label);
    if (numbered) labels.push(`${numbered[1]} ${numbered[2]}`, `${numbered[1]} No.${numbered[2]}`, `${numbered[1]} No. ${numbered[2]}`);
  }
  const act = (input.title ?? "").split(/\s+[—–]\s+/).slice(1).join(" — ").replace(/^[a-z0-9]+\s+-\s+/i, "").trim();
  if (act) labels.push(act);
  return [...new Set(labels)];
}

export const pageNamesMeasure = (text: string, labels: readonly string[]): boolean =>
  labels.some(label => translationSourceNames(text, label));

/** The short names a link to this measure would use: its designation or title, never the long question. */
export function measureLinkNames(labels: readonly string[], title: string): readonly string[] {
  const names = new Set<string>();
  for (const label of labels) {
    if (label.length > 140) continue;
    names.add(label);
    const numbered = /^(proposition|prop\.?|amendment|question|issue|measure|initiative|referendum|ballot measure|constitutional amendment)\s+([a-z0-9-]+)$/i.exec(label.trim());
    if (numbered) for (const kind of ["Proposition", "Prop", "Amendment", "Question", "Issue", "Measure", "Initiative", "Referendum"]) names.add(`${kind} ${numbered[2]}`);
  }
  if (title.trim()) names.add(title);
  return [...names];
}

export interface PageLink { readonly url: string; readonly text: string }

/** Every https link on a saved page, resolved against the page's own address. */
export function pageLinks(html: string, base: string): readonly PageLink[] {
  const links = new Map<string, PageLink>();
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/g, "&").trim();
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.protocol !== "https:") continue;
    url.hash = "";
    const key = url.toString();
    if (!links.has(key)) links.set(key, { url: key, text: pageWords(match[4]) });
  }
  return [...links.values()];
}

const HUB = /ballot[\s_-]*(?:measure|question|issue)|proposition|amendment|initiative|referend|measures?\b|voter[\s_-]*(?:information[\s_-]*)?guide|blue[\s_-]*book|ballot[\s_-]*information/i;

const decoded = (url: string): string => { try { return decodeURIComponent(url).replace(/[-_/.+]+/g, " "); } catch { return url; } };

/** Links on held pages that name this measure and lead to an official page, best match first. */
export function measureLinks(pages: readonly { readonly url: string; readonly html: string }[], names: readonly string[], exclude: ReadonlySet<string>,
  official: (url: string) => boolean): readonly PageLink[] {
  const scored = new Map<string, { link: PageLink; score: number }>();
  for (const page of pages) for (const link of pageLinks(page.html, page.url)) {
    if (exclude.has(link.url) || !official(link.url)) continue;
    const text = pageWords(link.text), address = decoded(link.url);
    const score = names.reduce((best, name) => Math.max(best, translationSourceNames(text, name) ? 3 : translationSourceNames(address, name) ? 2 : 0), 0);
    if (score > 0 && score > (scored.get(link.url)?.score ?? 0)) scored.set(link.url, { link, score });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).map(row => row.link);
}

/** Official links on held pages that lead to the election office's lists of measures, for one more step toward each measure's own page. */
export function hubLinks(pages: readonly { readonly url: string; readonly html: string }[], exclude: ReadonlySet<string>,
  official: (url: string) => boolean): readonly PageLink[] {
  const found = new Map<string, PageLink>();
  for (const page of pages) for (const link of pageLinks(page.html, page.url)) {
    if (exclude.has(link.url) || found.has(link.url) || !official(link.url)) continue;
    if (HUB.test(link.text) || HUB.test(decoded(link.url))) found.set(link.url, link);
  }
  return [...found.values()];
}

/** Searches for the measure's page on the election office's own site. */
export function measureSearchQueries(input: { readonly state: string; readonly year: string; readonly designation: string | null; readonly title: string }): readonly string[] {
  const place = `${input.state} ${input.year}`.trim();
  const named = input.designation && input.designation !== input.title ? `${input.designation} ${input.title}` : input.title;
  return [`${place} ballot measure ${named} official election office`, `${place} ${named} secretary of state voter guide`];
}
