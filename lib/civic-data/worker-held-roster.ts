export interface HeldRosterRow {
  /** Display name. "Last, First" becomes "First Last"; `nameAsWritten` keeps the page's form. */
  readonly name: string;
  readonly nameAsWritten: string;
  readonly office: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly websiteUrl: string | null;
}

export interface HeldRoster {
  readonly rows: readonly HeldRosterRow[];
  readonly complete: boolean;
}

const PERSON = /^(name|names|staff|member|members|official|officials|council ?member|board ?member|commissioner|trustee|representative|elected official)s?$/i;
const SEAT = /\b(title|position|office|seat|role|district|ward)\b/i;
const PHONE = /\b(phone|telephone|tel)\b/i;
const EMAIL = /\be-?mail\b/i;

const decode = (text: string) => text
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
const visible = (html: string) => decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const cells = (row: string) => [...row.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => m[2]);
const hrefs = (html: string) => [...html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => decode(m[1] ?? m[2]));

function displayName(written: string): string {
  const parts = written.split(",").map((part) => part.trim()).filter(Boolean);
  // "McCaa II, Clea" → "Clea McCaa II"; a suffix after the comma ("Smith, Jr.") stays put.
  if (parts.length === 2 && !/^(jr|sr|ii|iii|iv|phd|esq)\.?$/i.test(parts[1])) return `${parts[1]} ${parts[0]}`;
  return written;
}

function absolute(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export function readHeldRoster(html: string, pageUrl: string): HeldRoster | null {
  const seen = new Map<string, HeldRosterRow>();
  let complete = true;
  let found = false;
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((m) => m[1]);
    const header = rows.findIndex((row) => /<th\b/i.test(row));
    const headings = header < 0 ? [] : cells(rows[header]).map(visible);
    const person = headings.findIndex((h) => PERSON.test(h));
    const seat = headings.findIndex((h, i) => i !== person && SEAT.test(h));
    if (person < 0 || seat < 0) continue;
    found = true;
    const phone = headings.findIndex((h) => PHONE.test(h));
    const email = headings.findIndex((h) => EMAIL.test(h));
    for (const row of rows.slice(header + 1)) {
      const values = cells(row);
      if (values.length !== headings.length) { complete = false; continue; }
      const nameAsWritten = visible(values[person]);
      const office = visible(values[seat]);
      if (!nameAsWritten || !office) { complete = false; continue; }
      const phoneText = phone < 0 ? "" : visible(values[phone]);
      const mail = email < 0 ? null : hrefs(values[email]).find((h) => /^mailto:/i.test(h))?.slice(7).split("?")[0]
        ?? (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.exec(visible(values[email]))?.[0] ?? null);
      const link = hrefs(values[person]).map((h) => absolute(h, pageUrl)).find((h): h is string => h !== null) ?? null;
      const parsed: HeldRosterRow = { name: displayName(nameAsWritten), nameAsWritten, office,
        phone: /\d{3}.*\d{4}/.test(phoneText) ? phoneText : null, email: mail, websiteUrl: link };
      seen.set(`${parsed.name}\n${parsed.office}`, parsed);
    }
  }
  return found ? { rows: [...seen.values()], complete: complete && seen.size > 0 } : null;
}
