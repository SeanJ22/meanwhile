import {decodeEntities,visibleText} from "../extract/visible-text.ts";
export const LINK_CAP=40;
export interface DerivedLink {
  readonly url: string;
  readonly text: string;
}

/** Absolute http(s) links, deduplicated, same-host first, capped. */
export function extractLinks(html: string, base: URL, cap: number = LINK_CAP): DerivedLink[] {
  const seen = new Set<string>();
  const same: DerivedLink[] = [];
  const other: DerivedLink[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const m of html.matchAll(re)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (href === "" || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = visibleText(m[4] ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    (resolved.host.toLowerCase() === base.host.toLowerCase() ? same : other).push({ url: key, text });
  }
  return [...same, ...other].slice(0, cap);
}
