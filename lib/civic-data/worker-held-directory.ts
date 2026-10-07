import { scheduleSentences } from "./worker-held-meetings.ts";

export interface HeldDirectoryRow {
  readonly bodyName: string;
  readonly bodyClass: "Commission" | "Advisory";
  readonly meetingCadence?: string;
  readonly officeAddress?: string;
  readonly officePhone?: string;
}

const DIRECTORY_PAGE = /\b(boards|commissions|committees)\b/i;
const BODY_NAME = /(\b(board|commission|committee|council|trust|authority|corporation|panel)$)|(^(board|commission|committee|council) (of|on|for)\b)/i;
/** A bare noun is a heading, not a body. */
const BARE = /^(the )?(city |town |county )?(board|commission|committee|council)s?$/i;

const STREET = "(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Ct|Court|Pkwy|Parkway|Hwy|Highway|Pl|Place|Plaza|Sq|Square|Cir|Circle)";
const ADDRESS = new RegExp(`\\b\\d{1,6}\\s+(?:[A-Z0-9][\\w.'-]*\\s+){0,5}?${STREET}\\b\\.?(?:,?\\s+(?:Suite|Ste|Room|Rm|Floor|Fl|Unit|#)\\.?\\s*[\\w-]+)?,?\\s+[A-Z][A-Za-z.' -]{1,30},?\\s+[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?\\b`);
const PHONE = /\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/;

const decode = (text: string) => text
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
const visible = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function readHeldDirectory(html: string): readonly HeldDirectoryRow[] | null {
  const title = visible(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  if (!DIRECTORY_PAGE.test(title)) return null;
  // Site navigation repeats every page's name; only the page's own content lists its bodies.
  const content = html.replace(/<(script|style|template|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const rows = new Map<string, HeldDirectoryRow>();
  const titles = [...content.matchAll(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1\s*>|<(div|span|button|summary)\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?(?:title|accordion-title|accordion-header)(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/\3\s*>/gi)];
  titles.forEach((match, index) => {
    const name = visible(match[2] ?? match[4] ?? "");
    if (name.length < 4 || name.length > 90 || !/^[A-Z]/.test(name) || BARE.test(name) || !BODY_NAME.test(name)) return;
    const section = content.slice((match.index ?? 0) + match[0].length, titles[index + 1]?.index ?? content.length);
    const meetingCadence = scheduleSentences(section);
    const text = visible(section);
    const officeAddress = ADDRESS.exec(text)?.[0];
    const officePhone = PHONE.exec(text)?.[0];
    rows.set(name.toLowerCase(), { bodyName: name, bodyClass: /\bcommission\b/i.test(name) ? "Commission" : "Advisory", ...(meetingCadence ? { meetingCadence } : {}),
      ...(officeAddress ? { officeAddress } : {}), ...(officePhone ? { officePhone } : {}) });
  });
  return rows.size ? [...rows.values()] : null;
}
