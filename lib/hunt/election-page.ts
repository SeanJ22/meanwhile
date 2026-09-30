import { cellText, decodeEntities } from "./roster-page.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import type { HeldSourcePage } from "../sources/plural/place.ts";

export interface ElectionFieldCandidate {
  readonly divisionId: string;
  readonly kind: "registration_deadline" | "early_voting" | "polling_lookup" | "registration_lookup" | "ballot_lookup" | "certified_outcome";
  readonly sourceUrl: string;
  readonly value: string;
  readonly quote: string;
  readonly dates: readonly string[];
  readonly document: HeldSourcePage;
}

const MONTHS = "January February March April May June July August September October November December".split(" ");
const DATE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi");

/** Read source words only. An office locator is navigation, never an assigned
 * polling place; a dated line is not yet a published election fact. */
export function electionPageFields(page: HeldSourcePage, divisionId: string, linkingPage?: OfficialLinkingPage): ElectionFieldCandidate[] {
  if (!isOfficialSource(page.url, linkingPage)) return [];
  const out: ElectionFieldCandidate[] = [];
  const add = (kind: ElectionFieldCandidate["kind"], value: string, quote: string, dates: string[] = []) => {
    out.push({ kind, divisionId, sourceUrl: page.url, value, quote, dates, document: page });
  };
  const headings = [...page.text.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => cellText(m[1]));
  const datedHeading = headings.find(h => /\b20\d{2}\b/.test(h) && /vot|election|schedule|calendar/i.test(h));
  const year = datedHeading ? Number(/\b(20\d{2})\b/.exec(datedHeading)![1]) : null;
  const lines = cellText(page.text).split("\n").map(l => l.replace(/\s+/g, " ").trim());
  for (const line of lines) {
    const dates = [...line.matchAll(DATE)].flatMap(m => {
      const y = m[3] ? Number(m[3]) : year;
      if (!y) return [];
      const month = MONTHS.findIndex(name => name.toLowerCase() === m[1].toLowerCase());
      const date = new Date(Date.UTC(y, month, Number(m[2])));
      return date.getUTCMonth() === month && date.getUTCDate() === Number(m[2]) ? [date.toISOString().slice(0, 10)] : [];
    });
    // A header can state the year for its schedule. Keep that explicit context
    // in the quote; never fill a missing year from the acquisition clock.
    const quote = datedHeading && [...line.matchAll(DATE)].some(m => !m[3]) ? `${datedHeading}\n${line}` : line;
    if (dates.length && /registration|register to vote/i.test(line) && /deadline|last day|close/i.test(line)) add("registration_deadline", line, quote, dates);
    if (dates.length && /early.*(?:in.person|voting)|in.person.*(?:early|absentee)|absentee.*in.person/i.test(line)) add("early_voting", line, quote, dates);
    if (/\bcertified\b/i.test(line) && /\b(?:results|votes|canvass)\b/i.test(line)) add("certified_outcome", line, line);
  }
  for (const match of page.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = cellText(match[2]).replace(/\s+/g, " ").trim();
    const kind = /(?:find|look.?up|search).*(?:polling|voting (?:place|location))|polling.*(?:look.?up|search)/i.test(label) ? "polling_lookup"
      : /(?:check|confirm|look.?up).*(?:registration)|registration.*(?:status|look.?up)/i.test(label) ? "registration_lookup"
      : /(?:sample )?ballot.*(?:look.?up|search)/i.test(label) ? "ballot_lookup" : null;
    if (!kind) continue;
    try {
      const url = new URL(decodeEntities(match[1]), page.url);
      if (isOfficialSource(url.href, { url: page.url, html: page.text, linkingPage })) add(kind, url.href, label);
    } catch { /* An invalid link is left open, never fabricated. */ }
  }
  return out;
}
