import { decodeEntities } from "../http.ts";

/**
 * A district's Board Actions index: one PDF per Governing Board sitting. Each
 * link's visible text is the sitting's date (`August 25, 2026`) and its target
 * a PDF on the same host (`/_theme/files/GovBoard/Docs/actions/08-25-2026S.pdf`)
 * whose first line is `GOVERNING BOARD AGENDA <KIND> MEETING – Board Actions`:
 * every numbered agenda item with the action taken. It exists only after the
 * sitting, so it is a CONCLUDED sitting's agenda record.
 *
 * Keyed by ISO day. The first link for a day wins; the page lists newest first
 * and never two sittings on one day.
 */
export function parseBoardActions(html: string, pageUrl: string): Map<string, string> {
  const out = new Map<string, string>();
  const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  for (const a of html.matchAll(/<a\b[^>]*href="([^"]*\/Docs\/actions\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeEntities(a[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const m = /^([A-Za-z]+)\s*(\d{1,2}),\s*(\d{4})$/.exec(label);
    if (!m) continue;
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (month === 0) continue;
    const key = `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    if (!out.has(key)) out.set(key, new URL(decodeEntities(a[1]), pageUrl).toString());
  }
  return out;
}
