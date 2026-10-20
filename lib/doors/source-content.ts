import { readableContent } from "../extract/html-content.ts";
import { sourceText } from "../ballot/voting-source-tables.ts";
import { pageAddress } from "./page-address.ts";

type SourceFamily = "meetings" | "agendas" | "results" | "rosters" | "channels" | "voting" | "funding" | "boundaries" | "contacts" | "public-records";
interface SourceContent {
  url: string;
  text: string;
  contentType: string;
  names: readonly string[];
  owed: readonly SourceFamily[];
  belongsToPlace?: boolean;
}
export interface SourceDisposition {
  kind: "DOOR" | "EVIDENCE" | "SKIP";
  family: SourceFamily | null;
  recordClass: string | null;
  reason: string;
  quote: string;
  belongs: boolean;
}
const words = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const CLASSES: Record<SourceFamily, string> = {
  meetings: "MEETING", agendas: "MEETING_OUTCOME", results: "ELECTION_RESULT",
  rosters: "OFFICIAL_ROSTER", channels: "OFFICIAL_STATEMENT", voting: "VOTING_SITE",
  funding: "GOVERNMENT_FINANCE", boundaries: "SPECIAL_DISTRICT_BOUNDARIES", contacts: "SERVICE_CONTACT", "public-records": "PUBLIC_RECORD",
};
const TOPICS: Record<SourceFamily, RegExp> = {
  meetings: /\b(?:meetings?|calendar|sittings?)\b/i,
  agendas: /\b(?:agendas?|minutes|meeting results|roll calls?)\b/i,
  results: /\b(?:election results|certified results|canvass|vote totals)\b/i,
  rosters: /\b(?:members|roster|officials|town clerk|city clerk|staff directory|council members)\b/i,
  channels: /\b(?:channels?|posts|followers|subscribers|statements?|videos?|remarks|announcement|said)\b/i,
  voting: /\b(?:elections?|vot(?:e|ing|er)|polling|precinct|ballots?|drop box|clerk)\b/i,
  funding: /\b(?:budget|campaign finance|financial disclosure|contributions)\b/i,
  boundaries: /\b(?:district boundaries|zoning map|jurisdiction boundaries)\b/i,
  contacts: /\b(?:contact|office hours|phone|email)\b/i,
  "public-records": /\b(?:ordinances?|permits?|bylaws?|resolutions?|public records|policies|government reports)\b/i,
};
export const SOURCE_FAMILIES = Object.keys(TOPICS) as SourceFamily[];

export function sourceBody(html: string): { text: string; html: string; title: string; single: boolean } {
  const articleBodies = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  const content = readableContent(articleBodies.length > 1 ? `<main>${articleBodies.map(article => article[1]).join(" ")}</main>` : html).html;
  const title = sourceText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const articles = [...html.matchAll(/<article\b([^>]*)>/gi)];
  const single = articles.length === 1 && /class=["'][^"']*\btype-post\b/.test(articles[0]![1]!) ||
    /<meta\b[^>]*property=["']og:type["'][^>]*content=["'](?:article|video)[^"']*["']/i.test(html);
  return { text: sourceText(content).replace(/\s+/g, " ").trim(), html: content, title, single };
}

export function sourceLinks(html: string, base: string): { url: string; label: string }[] {
  const links = new Map<string, { url: string; label: string }>();
  const tags = [...html.matchAll(/<(a|iframe)\b([^>]*?)(?:href|src)=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi),
    ...html.matchAll(/<(link)\b([^>]*?)(?:href)=["']([^"']+)["']([^>]*)>()/gi)];
  for (const match of tags) {
    if (match[1]!.toLowerCase() === "link" && !/rel=["']alternate["']/i.test(match[2]! + match[4]!)) continue;
    try {
      const address = pageAddress(new URL(match[3]!.replace(/&amp;/g, "&"), base).href);
      if (!address) continue;
      links.set(address.url, { url: address.url, label: sourceText(match[5]!).trim() || (match[2]! + match[4]!).match(/(?:title|aria-label)=["']([^"']*)["']/i)?.[1] || "" });
    } catch { /* A malformed link carries no source address. */ }
  }
  for (const match of html.matchAll(/["']((?:https?:\/\/|\/)[^"'\s<>]+(?:FeatureServer\/\d+|MapServer\/\d+|\.json(?:\?[^"'\s<>]*)?))["']/gi)) {
    try { const address = pageAddress(new URL(match[1]!, base).href); if (address) links.set(address.url, { url: address.url, label: "Published data" }); } catch { /* Invalid source configuration. */ }
  }
  return [...links.values()];
}

export function classifySourceContent(source: SourceContent): SourceDisposition {
  const isHtml = /html/i.test(source.contentType) || /<(?:html|main|article|title|h[1-6]|div|p|table|section|ul)\b/i.test(source.text);
  const body = isHtml ? sourceBody(source.text) : { text: source.text, html: "", title: "", single: false };
  const visible = `${body.title} ${body.text}`, normalized = ` ${words(visible)} `;
  const belongs = source.belongsToPlace === true || source.names.some(name => {
    const key = words(name).replace(/\b(?:city|town|township|county|state|of)\b/g, "").replace(/\s+/g, " ").trim();
    return key.length > 2 && normalized.includes(` ${key} `);
  });
  const result = (kind: SourceDisposition["kind"], family: SourceFamily | null, reason: string): SourceDisposition => ({
    kind, family, recordClass: family ? CLASSES[family] : null, reason, belongs, quote: visible.trim().slice(0, 400),
  });
  if (/name=["']password["']|\b(?:sign in to continue|log in to continue|captcha)\b/i.test(source.text)) return result("SKIP", null, "Login or access-control page");
  if (!belongs) return result("SKIP", null, "The captured content does not name this place or one of its bodies or officials");
  if (isHtml && /\b(?:search results|results for your search)\b/i.test(body.title)) return result("SKIP", null, "Generic search results; underlying sources carry the facts");
  const family = source.owed.includes("voting") && /clerk/i.test(body.title) ? "voting" : source.owed.find(family => TOPICS[family].test(body.title)) ??
    (source.owed.includes("voting") && /ballot|polling|voter/i.test(visible) ? "voting" : source.owed.find(family => TOPICS[family].test(visible))) ?? null;
  if (!family) return result("SKIP", null, "The captured content holds none of this place's owed information");
  if (/pdf/i.test(source.contentType) || body.single || /\b(?:filing (?:number|id)|statement by|press release)\b/i.test(body.title) ||
      /\b20\d{2}\b/.test(body.title) && /\b(?:remember|notice|closed|statement|minutes|agenda)\b/i.test(body.title) ||
      /video\//i.test(source.contentType)) {
    return result("EVIDENCE", family, "A single published statement, notice, video, or filing");
  }
  const feed = /BEGIN:VCALENDAR|<(?:rss|feed)\b/i.test(source.text);
  const dated = [...body.text.matchAll(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}/gi)].length;
  const data = /json|csv|tab-separated|spreadsheet/i.test(source.contentType) && /[\[{\t,]/.test(source.text);
  const contact = /\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(body.text);
  const ownedChannel = family === "channels" && /\b(?:followers|subscribers|posts|channel)\b/i.test(visible);
  const collection = dated > 1 && [...body.html.matchAll(/<a\b/gi)].length > 1 || /<(?:table|ul|ol)\b/i.test(body.html) &&
    /\b(?:agendas?|minutes|results|members|officials|directory|polling places|election|voting)\b/i.test(body.title);
  if (feed || data || collection || ownedChannel || contact && /\b(?:clerk|directory|members|officials)\b/i.test(body.title)) {
    return result("DOOR", family, "An ongoing calendar, list, roster, published dataset, or owned channel");
  }
  if (dated || contact || /\b(?:ballot|polling|filing|said|statement)\b/i.test(body.text)) return result("EVIDENCE", family, "A captured fact without an ongoing publishing collection");
  return result("SKIP", null, "Navigation or a generic landing page without the place's facts");
}
