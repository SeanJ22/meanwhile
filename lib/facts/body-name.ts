import { normalizeText } from "./check.ts";

const GOVERNING = new RegExp(
  "\\b(?:(?:City|Town|Village|Borough|Township|County|Parish)\\s+(?:Council|Commission|Board of (?:Commissioners|Supervisors|Trustees|Aldermen|Selectmen|Selectpersons|Directors)|Selectboard|Select Board|Court|Legislature)" +
  "|Board of (?:County )?(?:Commissioners|Supervisors|Trustees|Aldermen|Selectmen|Selectpersons)|Board of Mayor and Aldermen|Mayor and (?:(?:City|Town|Village|Borough|Township) )?Council" +
  "|(?:City|Town|Village|Borough|Township) of [A-Z][A-Za-z.'’-]+(?: (?!(?:City|Town|Village|Borough|Township|County)\\b)[A-Z][A-Za-z.'’-]+)? (?:Council|Board of Trustees)|Commissioners Court|Common Council|Selectboard|Select Board|Board of Selectmen)\\b", "i");
const SCHOOL = /\b(?:School Board|Board of Education|Board of School Directors|Board of School Trustees|Board of Trustees|Governing Board|Board of Directors)\b/i;

/** How a page writes the name of a government's governing board, when it does: the words as written, with the sentence around them as the quote. */
export function governingBodyNameOn(pageText: string, bodyId: string): { readonly name: string; readonly quote: string } | null {
  const school = bodyId.endsWith("#board");
  if (!school && !bodyId.endsWith("#governing")) return null;
  const text = normalizeText(pageText);
  const pattern = school ? SCHOOL : GOVERNING;
  const seen = new Map<string, { readonly index: number; readonly name: string; count: number }>();
  for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
    if (!/^[A-Z]/.test(match[0])) continue;
    const held = seen.get(match[0].toLowerCase());
    if (held) held.count++; else seen.set(match[0].toLowerCase(), { index: match.index, name: match[0], count: 1 });
  }
  // The page's own usual name for the board: the one it writes most often, earliest first.
  const found = [...seen.values()].sort((a, b) => b.count - a.count || a.index - b.index)[0];
  if (!found) return null;
  const from = Math.max(0, found.index - 60), to = Math.min(text.length, found.index + found.name.length + 60);
  return { name: found.name, quote: text.slice(from, to).trim() };
}
