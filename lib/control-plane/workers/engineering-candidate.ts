/**
 * The bounded compiler's implementation payload, never evidence-supplied code.
 * It emits routes to investigate, not civic facts or a complete meeting universe.
 */
export const STREAMLINE_INVENTORY_SOURCE = String.raw`/**
 * Review candidate generated from streamline-sitemap-is-a-dated-meeting-inventory.
 * Input: { xml, subjectId, publisherOrigin }. Output: captured-sitemap route inventory.
 * No I/O, implicit clock, inferred canonical identity, or publication completeness claim.
 */
export function inventoryStreamlineSitemap(input) {
  if (!input || typeof input.xml !== "string" || input.xml.length > 1500000 ||
      typeof input.subjectId !== "string" || !input.subjectId ||
      !/^https:\/\/[a-z0-9.-]+$/.test(input.publisherOrigin)) throw new Error("INPUT_REFUSED");
  const xml = input.xml;
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) throw new Error("XML_SHAPE_UNSUPPORTED");
  const root = /^\s*(?:<\?xml[^?]*\?>\s*)?<urlset(?:\s[^>]*)?>([\s\S]*)<\/urlset>\s*$/.exec(xml);
  if (!root) throw new Error("SITEMAP_URLSET_REQUIRED");
  const decode = value => value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (_, key) => {
    if (key[0] !== "#") return ({amp:"&",quot:'"',apos:"'",lt:"<",gt:">"})[key.toLowerCase()];
    const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    if (code < 32 || code > 1114111 || (code >= 55296 && code <= 57343)) throw new Error("XML_ENTITY_REFUSED");
    return String.fromCodePoint(code);
  });
  const validDate = text => {
    const [year, month, day] = text.split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= days[month-1];
  };
  const body = root[1];
  const bodyStart = xml.indexOf(">", xml.indexOf("<urlset")) + 1;
  const blocks = [...body.matchAll(/<url(?:\s[^>]*)?>[\s\S]*?<\/url>/g)];
  if (body.replace(/<url(?:\s[^>]*)?>[\s\S]*?<\/url>/g, "").trim()) throw new Error("SITEMAP_PARTIAL_OR_UNSUPPORTED");
  const byUrl = new Map();
  const excluded = [];
  for (const block of blocks) {
    const inner = block[0].replace(/^<url(?:\s[^>]*)?>/, "").replace(/<\/url>$/, "");
    if (inner.replace(/<(loc|lastmod|changefreq|priority)(?:\s[^>]*)?>[^<]*<\/\1>/g, "").trim()) {
      throw new Error("SITEMAP_PARTIAL_OR_UNSUPPORTED");
    }
    const locs = [...block[0].matchAll(/<loc(?:\s[^>]*)?>([^<]*)<\/loc>/g)];
    if (locs.length !== 1) throw new Error("EXACTLY_ONE_LOC_REQUIRED");
    const loc = locs[0];
    if (/&(?!(?:#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);)/i.test(loc[1])) throw new Error("XML_ENTITY_REFUSED");
    const sourceUrl = decode(loc[1].trim());
    const parsed = /^(https?):\/\/([^/?#]+)([^?#]*)(?:[?#].*)?$/.exec(sourceUrl);
    if (!parsed || parsed[1] + "://" + parsed[2] !== input.publisherOrigin || /[\\\s]/.test(sourceUrl)) {
      excluded.push({ sourceUrl, reason: "OFF_PUBLISHER_OR_INVALID_URL" }); continue;
    }
    const dated = /^\/(\d{4}-\d{2}-\d{2})-([^/]+)\/?$/.exec(parsed[3]);
    if (!dated) { excluded.push({ sourceUrl, reason: "NOT_A_DATED_PATH" }); continue; }
    if (!validDate(dated[1])) { excluded.push({ sourceUrl, reason: "INVALID_DATE" }); continue; }
    const start = bodyStart + block.index + loc.index + loc[0].indexOf(">") + 1;
    const span = { start, end: start + loc[1].length, quote: loc[1], offsetUnit: "UTF16_CODE_UNITS" };
    const existing = byUrl.get(sourceUrl);
    if (existing) { existing.spans.push(span); continue; }
    byUrl.set(sourceUrl, { sourceUrl, subjectId: input.subjectId, publisherOrigin: input.publisherOrigin,
      dateFromPath: dated[1], pathTail: dated[2], identityStatus: "PAGE_VERIFICATION_REQUIRED", spans: [span] });
  }
  const entries = [...byUrl.values()].sort((a,b) => a.sourceUrl < b.sourceUrl ? -1 : a.sourceUrl > b.sourceUrl ? 1 : 0);
  return { scope: "CAPTURED_SITEMAP_ONLY", sourceUrlCount: blocks.length, datedPageCount: entries.length,
    entries, excluded, nextAction: "Acquire each dated page and verify subject, meeting date, and document links from its content." };
}
`;
