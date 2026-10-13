import { first, hasClass, linkUrl, nodes, parseHtml, textOf, type HtmlNode, type StateRosterRecord } from "./html.ts";

export const ALASKA_DIRECTORY_URL = "https://www.akleg.gov/basis/mbr_info.asp";
type Chamber = "lower" | "upper";
export interface AlaskaRosterDocument { readonly url: string; readonly body: string; readonly retrievedAt?: string }
export interface AlaskaRosterRecords { records: StateRosterRecord[]; complete: boolean; chambers: Chamber[]; unmatched?: { officeholderId: string; reason: string }[] }
interface DirectoryEntry { url: string; label: string; district: string; chamber: Chamber; party: string; disposition: string }

function officialProfileUrl(value: string): string {
  const url = new URL(value, ALASKA_DIRECTORY_URL);
  if (!["akleg.gov", "www.akleg.gov"].includes(url.hostname) || !/^\/basis\/Member\/Detail\/\d+$/i.test(url.pathname) || !/^[A-Z]{3}$/i.test(url.searchParams.get("code") ?? "")) throw new Error("Alaska directory profile is not its published official member URL");
  // The publisher emits HTTP links, and serves the same exact paths over HTTPS.
  url.protocol = "https:";
  url.hostname = "www.akleg.gov";
  return url.href;
}

function directoryEntries(body: string): DirectoryEntry[] {
  if (!/<\/html\s*>/i.test(body)) throw new Error("Alaska official directory document is truncated");
  const root = parseHtml(body);
  const rows = nodes(root, node => node.tag === "tr" && !!first(node, child => child.tag === "a" && /\/basis\/Member\/Detail\//i.test(child.attrs.href ?? "")));
  const records: DirectoryEntry[] = [];
  for (const row of rows) {
    const columns = row.children.filter((node): node is HtmlNode => typeof node !== "string" && node.tag === "td");
    if (columns.length !== 5) throw new Error("Alaska official member row no longer agrees with its observed directory columns");
    const anchor = first(columns[0]!, node => node.tag === "a" && /\/basis\/Member\/Detail\//i.test(node.attrs.href ?? ""));
    if (!anchor) throw new Error("Alaska official directory row lost its member profile");
    const label = textOf(anchor);
    const role = /^(Representative|Senator)\s+\S/.exec(label)?.[1];
    if (!role) throw new Error("Alaska official member row lost its stated chamber");
    const chamber = role === "Representative" ? "lower" : "upper";
    const district = textOf(columns[1]!);
    if (chamber === "lower" ? !/^(?:[1-9]|[1-3]\d|40)$/.test(district) : !/^[A-T]$/.test(district)) throw new Error("Alaska official member row lost its published district");
    records.push({ url: officialProfileUrl(linkUrl(anchor, ALASKA_DIRECTORY_URL)), label, district, chamber, party: textOf(columns[2]!), disposition: textOf(columns[4]!) });
  }
  if (!records.length) throw new Error("Alaska official directory lacks its observed member table");
  return records;
}

function superseded(entry: DirectoryEntry): boolean {
  return /^(?:Resigned|Deceased|Name Changed)\b/i.test(entry.disposition);
}

export function alaskaCurrentProfileRoutes(directoryBody: string): readonly string[] {
  return [...new Set(directoryEntries(directoryBody).filter(entry => !superseded(entry)).map(entry => entry.url))];
}

function fieldValue(root: HtmlNode, label: string): string {
  const field = first(root, node => node.tag === "strong" && textOf(node) === label);
  if (!field?.parent) return "";
  const siblings = field.parent.children;
  const following: string[] = [];
  for (let index = siblings.indexOf(field) + 1; index < siblings.length; index++) {
    const child = siblings[index]!;
    if (typeof child !== "string" && (child.tag === "br" || child.tag === "strong")) break;
    following.push(typeof child === "string" ? child : textOf(child));
  }
  return following.join(" ").replace(/\s+/g, " ").trim();
}

function englishDate(value: string): string | null {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(value);
  if (!match) return null;
  const month = months.findIndex(name => name.toLowerCase() === match[1]!.toLowerCase()) + 1;
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function parseAlaskaProfile(body: string, url: string): StateRosterRecord {
  const sourceUrl = officialProfileUrl(url);
  if (!/<\/html\s*>/i.test(body)) throw new Error("Alaska official member profile is truncated");
  const root = parseHtml(body);
  const contact = first(root, node => hasClass(node, "bioright"));
  if (!contact) throw new Error("Alaska official profile lacks its published contact and identity section");
  const formal = first(contact, node => hasClass(node, "formal_name"));
  const name = formal ? /^(Representative|Senator)\s+(.+)$/.exec(textOf(formal)) : null;
  if (!name) throw new Error("Alaska official profile lacks its stated full name and chamber");
  const chamber = name[1] === "Representative" ? "lower" : "upper";
  const district = fieldValue(contact, "District:");
  if (chamber === "lower" ? !/^(?:[1-9]|[1-3]\d|40)$/.test(district) : !/^[A-T]$/.test(district)) throw new Error("Alaska official profile lacks its published district");
  const status = first(contact, node => hasClass(node, "leadership_title"));
  const disposition = status ? textOf(status) : "";
  const vacant = /^(?:Resigned|Deceased)\b/.test(disposition);
  return {
    name: vacant ? "Vacant" : name[2]!, district, chamber, sourceUrl,
    nativeId: sourceUrl, party: fieldValue(contact, "Party:") || null,
    vacant, since: vacant ? englishDate(disposition) : null,
    termStart: /^Oath Taken\b/.test(disposition) ? englishDate(disposition) : null,
    ...(chamber === "upper" ? { divisionId: `ocd-division/country:us/state:ak/sldu:${district.toLowerCase()}` } : {}),
  };
}

export function alaskaProfileIssue(body: string, url: string): string | null {
  try { parseAlaskaProfile(body, url); return null; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** An inventory supplies membership; each exact linked profile supplies its verified full name. */
export function parseAlaskaRoster(documents: readonly AlaskaRosterDocument[], at: string): AlaskaRosterRecords {
  if (!Number.isFinite(Date.parse(at))) throw new Error("Alaska source check requires a valid retrieval instant");
  const routed = documents.map(document => ({ document, pathname: new URL(document.url).pathname }));
  const directory = routed.find(row => /^\/basis\/mbr_info\.asp$/i.test(row.pathname))?.document;
  const profiles = routed.filter(row => /^\/basis\/Member\/Detail\//i.test(row.pathname)).map(row => row.document);
  if (!directory) {
    const records = profiles.map(document => parseAlaskaProfile(document.body, document.url));
    return { records, complete: false, chambers: [...new Set(records.map(row => row.chamber))] };
  }
  const entries = directoryEntries(directory.body);
  const current = entries.filter(entry => !superseded(entry));
  const sourceDocuments = new Map(profiles.map(document => [officialProfileUrl(document.url), document]));
  const records: StateRosterRecord[] = [];
  const unmatched: { officeholderId: string; reason: string }[] = [];
  for (const entry of current) {
    const document = sourceDocuments.get(entry.url);
    if (!document) {
      unmatched.push({ officeholderId: `official-legislature-ak:${entry.url}`, reason: `The Alaska directory lists ${entry.label} in district ${entry.district}; its exact linked profile has not been acquired.` });
      continue;
    }
    const record = parseAlaskaProfile(document.body, document.url);
    if (record.chamber !== entry.chamber || record.district !== entry.district || record.vacant) unmatched.push({ officeholderId: `official-legislature-ak:${record.nativeId}`,
      reason: `Official source disagreement: the Alaska directory lists ${entry.label} in ${entry.chamber} district ${entry.district}, while its linked profile reports ${record.name} in ${record.chamber} district ${record.district}${record.since ? ` since ${record.since}` : ""}. The profile's independently sourced record publishes; the directory claim remains disagreement work.` });
    records.push(record);
  }
  const held = new Set(current.map(entry => `${entry.chamber}:${entry.district}`));
  const departed = new Map<string, DirectoryEntry>();
  for (const entry of entries.filter(entry => /^(?:Resigned|Deceased)\b/.test(entry.disposition))) {
    const key = `${entry.chamber}:${entry.district}`;
    if (!held.has(key) && (englishDate(entry.disposition) ?? "") > (englishDate(departed.get(key)?.disposition ?? "") ?? "")) departed.set(key, entry);
  }
  for (const entry of departed.values()) records.push({ name: "Vacant", district: entry.district, chamber: entry.chamber, sourceUrl: directory.url,
    vacant: true, since: englishDate(entry.disposition), ...(entry.chamber === "upper" ? { divisionId: `ocd-division/country:us/state:ak/sldu:${entry.district.toLowerCase()}` } : {}) });
  const occupied = new Set(records.filter(row => !row.vacant).map(row => `${row.chamber}:${row.district}`));
  const currentRecords = records.filter(row => !row.vacant || !occupied.has(`${row.chamber}:${row.district}`));
  const seats = new Set(currentRecords.map(row => `${row.chamber}:${row.district}`));
  const allSeats = [...Array.from({ length: 40 }, (_, index) => `lower:${index + 1}`), ...Array.from({ length: 20 }, (_, index) => `upper:${String.fromCharCode(65 + index)}`)];
  const complete = !unmatched.length && current.every(entry => sourceDocuments.has(entry.url)) && currentRecords.length === 60 && allSeats.every(seat => seats.has(seat));
  return { records: currentRecords, complete, chambers: ["lower", "upper"], unmatched };
}
