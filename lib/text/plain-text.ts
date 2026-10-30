/**
 * Publisher text with markup (an iCalendar `LOCATION` pasted from an editor,
 * a title with `&amp;`) as plain readable text. Display only: the held value
 * keeps the publisher's bytes, and nothing here ever renders HTML.
 *
 * Block tags become line breaks, other tags vanish, entities decode once, and
 * a link keeps its words with its address beside them when the address is
 * short enough to read. Text with no markup comes back untouched.
 */

const MARKUP = /<\/?[a-z!][^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);/i;
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const LINK_LENGTH = 120;

function decode(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
    if (code === null) return ENTITIES[name!.toLowerCase()] ?? whole;
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export function plainText(raw: string): string {
  if (!MARKUP.test(raw)) return raw;
  const text = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_all, double?: string, single?: string, inner = "") => {
      const href = decode(double ?? single ?? "").trim(), words = decode(inner.replace(/<[^>]*>/g, "")).trim();
      if (!/^https?:\/\//i.test(href) || href.length > LINK_LENGTH || words === href) return words || href;
      return words ? `${words} (${href})` : href;
    })
    .replace(/<\/?(?:p|div|br|li|ul|ol|tr|table|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?[a-z!][^>]*>/gi, "");
  return decode(text).split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
