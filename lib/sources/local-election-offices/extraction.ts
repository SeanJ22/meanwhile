import { decodeVotingBytes, delimitedVotingRows, htmlTableFragments, htmlVotingTables, pdfVotingTables, sourceText, tableFromRows, xlsxVotingTables, type VotingTable } from "../../ballot/voting-source-tables.ts";
import { votingPdfText } from "../../ballot/voting-source-extraction.ts";
import { sha256 } from "../../civic-data/candidate-builders.ts";
import { LOCAL_ELECTION_OFFICE_FIELDS, type LocalElectionOffice, type LocalElectionOfficeBlank, type LocalElectionOfficeSource } from "./model.ts";
import { localElectionOfficeIdentityKey, type LocalElectionOfficeColumn, type LocalElectionOfficeRoute } from "./routes.ts";
import { localElectionOfficeHours } from "./enrichment.ts";
import { extractHtmlText } from "../../extract/html-text.ts";
import { isPostalOnlyAddress } from "./address.ts";

export interface LocalElectionOfficeCapture {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly checkedAt: string;
}
export interface LocalElectionOfficeDocument extends LocalElectionOfficeCapture {
  readonly text: string;
  readonly documentHash: string;
}
const spaces = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();
export function decodeLocalOfficeEmails(value: string): string {
  const email = (hex: string) => {
    if (!/^(?:[a-f\d]{2}){2,}$/i.test(hex)) return "";
    const key = parseInt(hex.slice(0, 2), 16);
    return Array.from({ length: hex.length / 2 - 1 }, (_, at) => String.fromCharCode(parseInt(hex.slice(at * 2 + 2, at * 2 + 4), 16) ^ key)).join("");
  };
  return value.replace(/<[^>]*\bdata-cfemail=["']([a-f\d]+)["'][^>]*>[^<]*<\/[^>]+>/gi, (_, hex: string) => email(hex))
    .replace(/\/cdn-cgi\/l\/email-protection#([a-f\d]+)/gi, (_, hex: string) => `mailto:${email(hex)}`);
}
const decoded = (value: string) => decodeLocalOfficeEmails(value.replace(/<!--[\s\S]*?-->/g, "")).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'")
  .replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—").replace(/&lsquo;|&rsquo;/gi, "’").replace(/&ldquo;|&rdquo;/gi, '"').replace(/&hellip;/gi, "…");
const documentQuotes = new WeakMap<LocalElectionOfficeDocument, string[]>();
export function localOfficeQuoteAppears(document: LocalElectionOfficeDocument, quote: string): boolean {
  const needle = spaces(decoded(quote));
  let haystacks = documentQuotes.get(document);
  if (!haystacks) {
    haystacks = [document.text, decodeVotingBytes(document.bytes)].flatMap(text => [spaces(decoded(text)), spaces(sourceText(decoded(text))), spaces(extractHtmlText(decoded(text)))]);
    documentQuotes.set(document, haystacks);
  }
  const renderedNeedle = spaces(sourceText(decoded(quote)));
  return !!needle && haystacks.some(text => text.includes(needle) || !!renderedNeedle && text.includes(renderedNeedle));
}
export function localOfficeValueAppears(value: string, quote: string, sourceUrl: string): boolean {
  if (/^https?:\/\//i.test(value)) {
    const sameUrl = (native: string) => {
      const published = sourceText(native).trim();
      if (!published) return false;
      try { return new URL(/^www\./i.test(published) ? `https://${published}` : published, sourceUrl).href === value; } catch { return false; }
    };
    if (sameUrl(sourceText(decoded(quote)).trim())) return true;
    for (const native of sourceText(decoded(quote)).matchAll(/\bwww\.[^\s<>"']+/gi)) if (sameUrl(native[0])) return true;
    for (const native of sourceText(decoded(quote)).matchAll(/https?:\/\/[^\s<>"']+/gi)) if (sameUrl(native[0])) return true;
    for (const found of quote.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      if (sameUrl(decoded(found[1] ?? found[2]))) return true;
    }
    if (/^[\[{]/.test(quote.trim())) {
      try {
        const values = (item: unknown): string[] => typeof item === "string" ? [item] : item && typeof item === "object" ? Object.values(item).flatMap(values) : [];
        if (values(JSON.parse(quote)).some(sameUrl)) return true;
      } catch { /* Structured values need valid publisher JSON. */ }
    }
    return false;
  }
  if (spaces(sourceText(decoded(quote))).includes(spaces(value)) || spaces(decoded(quote)).includes(spaces(value))) return true;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && spaces(sourceText(decoded(quote))).replace(/\s*@\s*/g, "@").includes(value)) return true;
  if (/^[\[{]/.test(quote.trim())) {
    try {
      const strings = (item: unknown): string[] => typeof item === "string" || typeof item === "number" ? [String(item)] : item && typeof item === "object" ? Object.values(item).flatMap(strings) : [];
      if (spaces(strings(JSON.parse(quote)).join(" ")).includes(spaces(value))) return true;
    } catch { /* A source block that is not JSON still uses the literal checks. */ }
  }
  return false;
}

function fieldValue(route: LocalElectionOfficeRoute, key: LocalElectionOfficeColumn, row: Record<string, string>, block: string): string | undefined {
  const spec = route.extraction.fields[key];
  if (!spec) return undefined;
  let value: string | undefined;
  if (spec.literal !== undefined) value = spec.literal;
  else if (spec.column !== undefined) {
    value = (typeof spec.column === "string" ? [spec.column] : spec.column).map(column => row[column] ?? "").filter(Boolean).join(" ");
    if (spec.pattern) value = new RegExp(spec.pattern, "is").exec(value)?.[spec.group ?? 1];
  } else if (spec.pattern) value = new RegExp(spec.pattern, "is").exec(spec.text ? extractHtmlText(decoded(block)) : decoded(block))?.[spec.group ?? 1];
  value = value === undefined ? undefined : sourceText(decoded(value)).trim();
  if (!value) return undefined;
  if (key === "website" || key === "pollingPlaceLookup") {
    try { const native = decoded(value); const url = new URL(/^www\./i.test(native) ? `https://${native}` : native, route.url); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
  }
  if (key === "email") return value.replace(/^mailto:/i, "").split("?")[0].replace(/\s*@\s*/g, "@");
  if (key === "phone") return value.replace(/^tel:/i, "");
  return value;
}

/** All formats share the existing voting-document readers; this adapter only names office fields. */
export async function extractLocalElectionOffices(route: LocalElectionOfficeRoute, capture: LocalElectionOfficeCapture): Promise<{ offices: LocalElectionOffice[]; blanks: LocalElectionOfficeBlank[]; document: LocalElectionOfficeDocument }> {
  if (capture.bytes.length === 0 || !Number.isFinite(Date.parse(capture.checkedAt))) throw new Error("Local election-office source capture is empty or undated.");
  const raw = decodeVotingBytes(capture.bytes);
  let text = raw;
  let tables: VotingTable[] = [];
  if (route.format === "pdf") {
    text = (await votingPdfText(capture.bytes, capture.url)).text;
    if (!route.extraction.records) tables = await pdfVotingTables(capture.bytes, route.extraction.table);
  } else if (route.format === "xlsx") tables = xlsxVotingTables(capture.bytes, route.extraction.table);
  else if (route.format === "csv" || route.format === "tsv") tables = [tableFromRows(delimitedVotingRows(raw, route.extraction.table?.delimiter ?? (route.format === "tsv" ? "\t" : ",")), route.extraction.table)];
  else if (route.format === "html" && !route.extraction.records && !route.scope) tables = htmlVotingTables(decoded(raw));
  const document = { ...capture, text: route.format === "html" ? extractHtmlText(decoded(raw)) : text, documentHash: sha256(capture.bytes) };
  const blocks: { row: Record<string, string>; quote: string }[] = [];
  if (route.extraction.records) {
    const pattern = new RegExp(route.extraction.records.pattern, "gis");
    for (const match of text.matchAll(pattern)) blocks.push({ row: {}, quote: match[route.extraction.records.group ?? 0] ?? "" });
  } else if (route.format === "json") {
    const json = route.extraction.jsonPattern ? new RegExp(route.extraction.jsonPattern, "is").exec(raw)?.[1] : raw;
    if (!json) throw new Error("Local election-office inline JSON value is missing.");
    let root: unknown = JSON.parse(json);
    for (const part of (route.extraction.jsonPath ?? "").split(".").filter(Boolean)) root = (root as Record<string, unknown>)?.[part];
    if (!Array.isArray(root)) throw new Error("Local election-office JSON route did not return an array.");
    document.text = JSON.stringify(JSON.parse(json));
    for (const item of root) {
      if (!item || typeof item !== "object") continue;
      const flatten = (value: unknown, prefix = ""): [string, string][] => value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
        : typeof value === "string" || typeof value === "number" ? [[prefix, String(value)]] : [];
      blocks.push({ row: Object.fromEntries(flatten(item)), quote: JSON.stringify(item) });
    }
  } else if (tables.length) {
    const tableIndex = route.extraction.tableIndex ?? 0, table = tables[tableIndex];
    if (!table) throw new Error(`Local election-office table ${tableIndex} is missing.`);
    const native = route.format === "html" ? [...(htmlTableFragments(raw.replace(/<!--[\s\S]*?-->/g, ""))[tableIndex]?.body ?? "").matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].slice(1) : [];
    table.rows.forEach((cells, index) => blocks.push({ row: Object.fromEntries(cells.flatMap((cell, at) => [[String(at), cell], [table.headers[at] ?? String(at), cell]])), quote: native[index]?.[0] ?? cells.join("\n") }));
    if (["xlsx", "pdf", "csv", "tsv"].includes(route.format)) document.text = `${text}\n${tables.map(table => [table.headers, ...table.rows].map(row => row.join("\n")).join("\n")).join("\n")}`;
  } else if (route.scope) blocks.push({ row: {}, quote: text });
  else throw new Error("Local election-office route needs a table, JSON array or record-block extraction.");

  const offices: LocalElectionOffice[] = [], blanks: LocalElectionOfficeBlank[] = [];
  for (const { row, quote } of blocks) {
    const values: Partial<Record<LocalElectionOfficeColumn, string>> = {};
    for (const key of Object.keys(route.extraction.fields) as LocalElectionOfficeColumn[]) {
      const value = fieldValue(route, key, row, quote);
      if (value !== undefined) values[key] = value;
    }
    const hours = route.extraction.officeHours ? localElectionOfficeHours(decoded(raw)) : null;
    if (hours) values.hours = hours.value;
    const identity = route.scope ?? route.identities?.[localElectionOfficeIdentityKey(values)];
    if (!identity || identity.state !== route.state) {
      blanks.push({ id: `${route.id}:unjoined:${sha256(quote).slice(0, 16)}`, divisionId: `ocd-division/country:us/state:${route.state.toLowerCase()}`, field: "directory", reason: `The directory's ${values.countyName ?? values.town ?? "office"} row has no exact held jurisdiction join.`, sourceUrl: route.url, status: "OPEN" });
      continue;
    }
    if (route.scope && (!route.jurisdictionQuote || !localOfficeQuoteAppears(document, route.jurisdictionQuote))) throw new Error(`Local election-office source does not identify its jurisdiction: ${route.id}.`);
    const fields: Partial<Record<typeof LOCAL_ELECTION_OFFICE_FIELDS[number], LocalElectionOfficeSource>> = {};
    const facts: Partial<Record<typeof LOCAL_ELECTION_OFFICE_FIELDS[number], string>> = {};
    for (const field of LOCAL_ELECTION_OFFICE_FIELDS) {
      const value = values[field];
      if (!value) continue;
      if (field === "address" && isPostalOnlyAddress(value)) {
        blanks.push({ id: `${identity.id}:address`, divisionId: identity.divisionId, officeId: identity.id, field: "address", reason: "The source publishes a mailing box; the office's street address has not been acquired.", sourceUrl: route.url, status: "OPEN" });
        continue;
      }
      const spec = route.extraction.fields[field]!;
      let fieldQuote = field === "hours" && hours ? hours.quote : spec.literal && (route.scope || spec.documentHeading) ? spec.literal : route.scope && spec.pattern ? new RegExp(spec.pattern, "is").exec(spec.text ? extractHtmlText(decoded(quote)) : decoded(quote))?.[0] ?? quote : quote;
      if (route.format === "html") {
        if (field === "website" || field === "pollingPlaceLookup") fieldQuote = [...quote.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(match => match[0]).find(anchor => localOfficeValueAppears(value, anchor, route.url)) ?? fieldQuote;
        else {
          const rendered = extractHtmlText(decoded(fieldQuote));
          fieldQuote = localOfficeValueAppears(value, rendered, route.url) ? rendered : [...quote.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(match => match[0]).find(anchor => localOfficeValueAppears(value, anchor, route.url)) ?? fieldQuote;
        }
      }
      if (!localOfficeQuoteAppears(document, fieldQuote) || !localOfficeValueAppears(value, fieldQuote, route.url)) {
        blanks.push({ id: `${identity.id}:${field}`, divisionId: identity.divisionId, officeId: identity.id, field, reason: "The extracted value is not present in its saved source block.", sourceUrl: route.url, status: "OPEN" });
        continue;
      }
      facts[field] = value;
      fields[field] = { sourceUrl: route.url, publisher: route.publisher, quote: fieldQuote, checkedAt: capture.checkedAt, documentHash: document.documentHash,
        ...((route.scope ? route.jurisdictionQuote : values.town ?? values.countyName) ? { jurisdictionQuote: route.scope ? route.jurisdictionQuote : values.town ?? values.countyName } : {}),
        ...(spec.documentHeading && ["office", "hours", "pollingPlaceLookup"].includes(field) ? { directoryWide: true as const } : {}) };
    }
    // A supplemental local page can carry just hours. Refresh merges it onto the
    // directory-established office before publication checks the minimum name.
    offices.push({ ...identity, office: facts.office ?? "", ...facts, fields, directoryUrl: route.directoryUrl,
      ...(!route.scope || route.url === route.directoryUrl && !!facts.office ? { directorySource: { sourceUrl: route.url, publisher: route.publisher, quote: route.format === "html" ? quote.replace(/<svg\b[\s\S]*?<\/svg>/gi, "") : quote, checkedAt: capture.checkedAt, documentHash: document.documentHash }, directoryJurisdiction: values.town ?? values.countyName ?? route.jurisdictionQuote } : {}),
      checkedAt: capture.checkedAt });
  }
  const joined = new Set(offices.map(office => office.id));
  for (const identity of Object.values(route.identities ?? {})) if (!joined.has(identity.id)) blanks.push({ id: `${identity.id}:directory`, divisionId: identity.divisionId, officeId: identity.id, field: "directory", reason: "This held jurisdiction's row was not returned by the state directory extraction.", sourceUrl: route.url, status: "OPEN" });
  return { offices, blanks, document };
}
