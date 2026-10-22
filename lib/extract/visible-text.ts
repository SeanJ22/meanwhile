const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", times: "×",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** An address a page hides from scrapers with Cloudflare's `data-cfemail` is still the address the page shows its readers; the first byte is the key. */
export function revealProtectedEmails(html: string): string {
  return html.replace(/<a\b[^>]*\bdata-cfemail=["']([0-9a-f]{4,})["'][^>]*>[\s\S]*?<\/a>/gi, (_, hex: string) => {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let at = 2; at + 1 < hex.length; at += 2) out += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16) ^ key);
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) ? out : " ";
  });
}

/** Visible text: scripts, styles, noscript, templates and comments removed; block ends become newlines. */
export function visibleText(html: string): string {
  const stripped = revealProtectedEmails(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol|\/header|\/footer|\/nav|\/dd|\/dt|\/blockquote|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .split(/\n/)
    .map((line) => line.replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
