import { htmlEvidenceBlocks } from "../html-evidence.ts";
import { sourceText } from "../../ballot/voting-source-tables.ts";
import type { LocalElectionOffice } from "./model.ts";
import type { LocalElectionOfficeRoute } from "./routes.ts";

const officeHoursLabel = /\b(?:office|business|department|clerk|counter|regular)\s+hours\b/i;
const weekdays = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const clock = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i;

/** A small office-hours block is independent of election-day polling schedules. */
export function localElectionOfficeHours(html: string): { value: string; quote: string } | null {
  html = html.replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—");
  const candidates = htmlEvidenceBlocks(html).flatMap(block => {
    const quote = sourceText(block.html);
    if (quote.length > 1_200 || !officeHoursLabel.test(quote) || !weekdays.test(quote) || !clock.test(quote)) return [];
    const at = html.indexOf(block.html), before = html.slice(Math.max(0, at - 500), at);
    const heading = [...before.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].at(-1)?.[1] ?? "";
    const context = `${sourceText(heading)} ${quote}`;
    if (/\b(?:summer|winter|seasonal|branch|satellite)\b|extended\s+(?:office\s+)?hours/i.test(context) || /\b(?:court|county office|county business|hotline|voter assistance)\s+hours\b/i.test(quote)) return [];
    if ([...quote.matchAll(/\b(?:office|business|department|clerk|counter|regular)\s+hours\b/gi)].length > 1) return [];
    const start = quote.search(officeHoursLabel), value = quote.slice(start).replace(/^(?:office|business|department|clerk|counter|regular)\s+hours\s*:?\s*/i, "").split(/\b(?:phone|telephone|fax|e-?mail|contact|court hours|directions|closed on|upcoming|extended hours)\s*:?/i)[0].trim();
    return value && value.length <= 800 ? [{ value, quote, regular: /\bregular\s+(?:office\s+)?hours\b/i.test(quote) }] : [];
  }).sort((a, b) => Number(b.regular) - Number(a.regular) || a.quote.length - b.quote.length);
  if (!candidates.length) return null;
  const preferred = candidates.filter(candidate => candidate.regular === candidates[0].regular);
  if (preferred.some(candidate => candidate.value !== preferred[0].value)) return null;
  return { value: preferred[0].value, quote: preferred[0].quote };
}

export function localElectionOfficeHoursRoute(office: LocalElectionOffice): LocalElectionOfficeRoute | null {
  if (!office.website) return null;
  const label = (office.town ?? office.countyName ?? "").replace(/^(?:Town|City|Village|Township) of\s+/i, "").replace(/\s+(?:County|Parish|Borough|Census Area|Municipality)$/i, "");
  if (!label) return null;
  return { id: `own-office-hours:${office.id}`, state: office.state, url: office.website, publisher: `${office.office} (${office.town ?? office.countyName ?? office.state})`, directoryUrl: office.directoryUrl,
    format: "html", scope: { id: office.id, state: office.state, divisionId: office.divisionId, ...(office.countyFips ? { countyFips: office.countyFips } : {}), ...(office.countyName ? { countyName: office.countyName } : {}), ...(office.town ? { town: office.town } : {}), ...(office.municipalityType ? { municipalityType: office.municipalityType } : {}), ...(office.countySubdivisionGeoid ? { countySubdivisionGeoid: office.countySubdivisionGeoid } : {}) },
    jurisdictionQuote: label, extraction: { officeHours: true, fields: { hours: {} } } };
}

/** Follow the publisher's own election/clerk links when its directory points at the home page. */
export function localElectionOfficePageLinks(html: string, base: string): string[] {
  const links: { url: string; rank: number }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = sourceText(match[2]);
    if (!/\b(?:elections?|voter(?:s| registration)?|town clerk|city clerk|county clerk|registrar|canvass(?:ers|ing)?)\b/i.test(label)) continue;
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base);
      if (url.hostname !== new URL(base).hostname || !["http:", "https:"].includes(url.protocol) || url.href === base || url.hash) continue;
      links.push({ url: url.href, rank: /elections?|voter/i.test(label) ? 0 : 1 });
    } catch { /* Invalid links establish no acquisition route. */ }
  }
  return [...new Map(links.sort((a, b) => a.rank - b.rank || a.url.length - b.url.length).map(link => [link.url, link.url])).values()];
}
