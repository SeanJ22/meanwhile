import { createHash } from "node:crypto";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { mergeVotingSiteRows, type SiteKind, type VotingOfficeContact, type VotingSite, type VotingSource } from "./voting-sites.ts";
import type { VotingChangeNotice, VotingDoorScope, VotingColumn, VotingExtraction, VotingPlatform, VotingSourceDoor, VotingSourceRead, VotingSourceRuntime } from "./voting-source-types.ts";
import { isVotingSiteKind } from "./voting-source-types.ts";
import { decodeVotingBytes, delimitedVotingRows, htmlVotingTables, pdfVotingTables, sourceText, tableFromRows, votingArchiveMember, xlsxVotingTables, type VotingTable } from "./voting-source-tables.ts";
import { readVotingPages } from "./voting-source-pages.ts";
import { votingFetchSession, type VotingCapture, type VotingFetchSession } from "./voting-source-fetch.ts";
import { readVotingBoundaries } from "./voting-source-boundaries.ts";
import { votingPdfText } from "./voting-source-extraction.ts";

const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Partial<Record<VotingColumn, string[]>> = {
  id: ["id", "objectid", "siteid"], name: ["name", "location", "pollinglocation", "pollingplace", "sitename", "centername", "facilityname", "building", "earlyvotinglocation"],
  address: ["address", "streetaddress", "locationaddress", "centeraddress", "pollingaddress"], room: ["room", "roomlocation"],
  date: ["date", "scheduledate", "votingdate"], days: ["days", "dates", "day", "votingdates"], hours: ["hours", "pollinghours", "votinghours", "hoursofoperation", "earlyvotingdateandtimes"],
  precinct: ["precinct", "precinctname", "precinctnumber"], town: ["town", "municipality", "city"], countyName: ["county", "countyname"], countyFips: ["countyfips", "countyfp"],
  countySubdivisionGeoid: ["countysubdivisiongeoid", "cousubgeoid"], ward: ["ward"], phone: ["phone", "clerkphone", "countyauditorphone", "telephone"],
  email: ["email"], officeName: ["officename", "clerk"], officeAddress: ["officeaddress"],
  locationNotes: ["locationnotes", "notes", "locationdescription", "comments"], accessibilityNotes: ["accessibility", "accessibilitynotes", "accessible"],
  rules: ["rules", "returnrules", "restrictions"], tribalNation: ["tribe", "tribalnation"], reservation: ["reservation"], election: ["election", "electionname", "electiondate"],
  lastUpdated: ["lastupdated", "updated", "updatedat"], kind: ["kind", "sitetype", "locationtype"], lat: ["latitude", "lat"], lng: ["longitude", "lng", "lon"],
};
export function fingerprintVotingPlatform(url: string, html = ""): VotingPlatform | undefined {
  const clue = `${url}\n${html}`;
  if (/voterfocus\.com|PrecinctFinder\/precinctDirectory/i.test(clue)) return "voterfocus";
  if (/voterview|voter view|election systems (?:&amp;|&) software/i.test(clue)) return "voterview";
  if (/WhereToVote\.aspx/i.test(clue)) return "where-to-vote";
  if (/civix|gcrinc\.com/i.test(clue)) return "civix";
  if (/powerbi\.com|power-bi|querydata/i.test(clue)) return "power-bi";
  return undefined;
}
function electionDateNamed(text: string, date: string): boolean {
  const [year, month, day] = date.split("-");
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(month) - 1]!;
  return text.includes(date) || new RegExp(`(?:${monthName}|${monthName.slice(0, 3)}\\.?)\\s+0?${Number(day)}(?:st|nd|rd|th)?(?:,|\\s)*${year}|0?${Number(month)}[/-]0?${Number(day)}[/-]${year}`, "i").test(text);
}
function publishedElectionDatesIn(text: string): string[] {
  const dates: string[] = [];
  const add = (year: string, month: number, day: number) => {
    const parsed = new Date(Date.UTC(Number(year), month - 1, day));
    if (parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) dates.push(parsed.toISOString().slice(0, 10));
  };
  for (const match of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(match[1]!, Number(match[2]), Number(match[3]));
  for (const match of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g)) add(match[3]!, Number(match[1]), Number(match[2]));
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const match of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(20\d{2})\b/gi)) add(match[3]!, months.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1, Number(match[2]));
  return [...new Set(dates)];
}
function votingScheduleDate(text: string): string | undefined {
  const day = text.trim().replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?[,]?\s+/i, "");
  // A date range or a recurring weekday stays in the publisher's `days` text.
  if (!/^(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2}|[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)20\d{2})$/.test(day)) return undefined;
  return publishedElectionDatesIn(day)[0];
}
function activeCmsElectionContent(html: string): { article: string; title: string; links: string[] }[] {
  // CivicPlus sends the current widgets as a quoted JSON state, before the
  // browser renders their articles. Read only the items in active widget columns.
  const quoted = html.match(/\bwindow\.__PRELOADED_STATE__\s*=\s*'((?:\\.|[^'\\])*)'/)?.[1];
  if (!quoted) return [];
  try {
    const state = JSON.parse(quoted.replace(/\\([\\'"])/g, "$1")) as { widgets?: { universal?: Record<string, { columns?: unknown; contentItems?: Record<string, { data?: { name?: { en?: string }; article?: { en?: string } }; link?: string }> }> } };
    const contents: { article: string; title: string; links: string[] }[] = [];
    const idsIn = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(idsIn) : typeof value === "string" ? [value] : [];
    for (const widget of Object.values(state.widgets?.universal ?? {})) {
      for (const id of idsIn(widget.columns)) {
        const item = widget.contentItems?.[id];
        if (!item) continue;
        if (typeof item.data?.article?.en === "string") contents.push({ article: item.data.article.en, title: item.data.name?.en ?? "", links: [] });
        if (typeof item.link === "string") contents.push({ article: "", title: "", links: [item.link] });
      }
    }
    return contents;
  } catch { return []; }
}
function officialElectionLinkMatches(html: string, pageUrl: string, door: VotingSourceDoor): boolean {
  const cms = activeCmsElectionContent(html);
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const [year, month, day] = door.electionDate.split("-");
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(month) - 1]!;
  const sameArticleDate = cms.some(content => {
    if (electionDateNamed(sourceText(content.article), door.electionDate)) return true;
    // A publisher's explicit event year and its day heading belong to the same
    // active article; an archived item elsewhere in the state cannot supply it.
    const years = content.title.match(/\b20\d{2}\b/g) ?? [];
    return years.length === 1 && years[0] === year && /election/i.test(content.title) &&
      [...content.article.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].some(heading =>
        new RegExp(`\\b(?:${monthName}|${monthName.slice(0, 3)}\\.?)\\s+0?${Number(day)}(?:st|nd|rd|th)?\\b`, "i").test(sourceText(heading[1]!)));
  });
  const activeDate = [...visible.matchAll(/<time\b[^>]*\bdatetime=["']([^"']+)["'][^>]*>/gi)]
    .some(match => match[1]!.slice(0, 10) === door.electionDate) ||
    [...visible.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
      .some(match => match[1]!.includes(`iso${door.electionDate}T`)) ||
    [...html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .some(match => [...match[1]!.matchAll(/["']startDate["']\s*:\s*["']([^"']+)["']/g)]
        .some(date => date[1]!.slice(0, 10) === door.electionDate));
  if (!electionDateNamed(sourceText(visible), door.electionDate) && !activeDate && !sameArticleDate) return false;
  if (pageUrl === door.url) return true;
  const links = [...[visible, ...cms.map(content => content.article)].flatMap(document => [...document.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map(match => match[1]!)), ...cms.flatMap(content => content.links)];
  return links.some(link => {
    try { return new URL(link.replace(/&amp;/g, "&"), pageUrl).href.split("#")[0] === door.url.split("#")[0]; } catch { return false; }
  });
}
const kindFrom = (value: string, fallback: SiteKind): SiteKind => /drop|ballot.?box/i.test(value) ? "DROP_BOX" : /satellite/i.test(value) ? "SATELLITE" : /early/i.test(value) ? "EARLY_VOTING" : /vote.?cent[er]{2}/i.test(value) ? "VOTE_CENTER" : /mobile/i.test(value) ? "MOBILE" : fallback;
function tableRecords(table: VotingTable): Record<string, unknown>[] {
  return table.rows.map(row => Object.fromEntries([...row.flatMap((value, index) => [[table.headers[index] ?? String(index), value], [String(index), value]]), ["__tableTitle", table.title ?? ""], ["__fileTitle", table.documentTitle ?? ""], ["__documentText", table.documentText ?? ""], ["__fileUpdatedAt", table.lastUpdated ?? ""]]));
}
function readValue(row: Record<string, unknown>, field: VotingColumn, config: VotingExtraction): string {
  if (config.templates?.[field]) return config.templates[field]!.replace(/\{([^}]+)\}/g, (_, column: string) => String(row[column] ?? "").trim());
  const transform = config.transforms?.[field];
  if (transform) return String(row[transform.column] ?? "").match(new RegExp(transform.pattern, "is"))?.[transform.group]?.trim() ?? "";
  if (config.constants?.[field] !== undefined) return config.constants[field]!;
  const key = config.columns?.[field];
  if (key) return (Array.isArray(key) ? key : [key]).map(k => String(row[k] ?? "").trim()).filter(Boolean).join(", ");
  const alias = ALIASES[field] ?? [normalized(field)];
  const match = Object.keys(row).find(k => alias.includes(normalized(k)));
  return match ? String(row[match] ?? "").trim() : "";
}
export function votingRowsToSites(rows: Record<string, unknown>[], door: VotingSourceDoor, source: VotingSource): { sites: VotingSite[]; office?: VotingOfficeContact; missingRows: string[]; missingRowPlaces: { countyName: string; town: string }[]; officeRows: { label: string; countyName: string; office: VotingOfficeContact }[] } {
  const config = door.extraction ?? {}, sites: VotingSite[] = [], missingRows: string[] = [], missingRowPlaces: { countyName: string; town: string }[] = [], officeRows: { label: string; countyName: string; office: VotingOfficeContact }[] = []; const office = door.office;
  for (const row of rows) {
    if (Object.entries(config.filters ?? {}).some(([key, value]) => String(row[key] ?? "") !== value)) continue;
    const get = (field: VotingColumn) => readValue(row, field, config);
    const recordMissing = (detail: string) => { missingRows.push(detail); missingRowPlaces.push({ countyName: get("countyName"), town: get("town") }); };
    if (row.__extractionWarning) recordMissing(String(row.__extractionWarning));
    const phone = get("phone"), email = get("email");
    const rowOffice = phone || email ? { name: get("officeName") || get("town") || get("countyName") || door.publisher, ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(get("officeAddress") ? { address: get("officeAddress") } : {}), url: source.url } : undefined;
    if (rowOffice) officeRows.push({ label: get("town") || get("countyName") || door.scope.name, countyName: get("countyName"), office: rowOffice });
    const name = get("name"), address = get("address");
    if (!name || !address) { if ((name || address || phone || email) && !(rowOffice && !door.covers.some(isVotingSiteKind))) recordMissing(`${get("town") || get("countyName") || name || address || door.scope.name}: ${!name ? "site name" : ""}${!name && !address ? " and " : ""}${!address ? "site address" : ""}`); continue; }
    const rowEvidence = Object.values(row).filter(value => typeof value === "string" || typeof value === "number").map(String);
    const stated = (field: VotingColumn) => !config.constants?.[field] || (row.__verifiedConstants as string[] | undefined)?.includes(field) || rowEvidence
      .some(text => normalized(text).includes(normalized(config.constants![field]!)));
    if (!stated("name") || !stated("address")) { recordMissing(`${name}: configured location value is absent from the saved page`); continue; }
    const election = stated("election") ? get("election") : "";
    if (get("election") && !election) recordMissing(`${name}: configured election is absent from the saved page`);
    const rowSource = { ...source,
      ...(typeof row.__captureHash === "string" ? { documentHash: row.__captureHash } : {}),
      ...(typeof row.__captureUrl === "string" ? { documentUrl: row.__captureUrl } : {}) };
    const kind = kindFrom(get("kind") || String(row.__tableTitle ?? ""), config.kind ?? door.covers.find(isVotingSiteKind) ?? "ELECTION_DAY");
    const id = `voting-${createHash("sha256").update([door.scope.state, get("countyFips") || door.scope.countyFips || get("countyName") || door.scope.ocdId,
      get("countySubdivisionGeoid") || door.scope.countySubdivisionGeoid || get("town"), address, get("room")].map(normalized).join("\0")).digest("hex").slice(0, 24)}`;
    const site: VotingSite = { id, name, address, room: get("room") || null, lat: null, lng: null, kind, election: election || door.title || null, electionDate: door.electionAssociationVerified === true || (electionDateNamed(election, door.electionDate) || /general/i.test(election) && election.includes(door.electionDate.slice(0, 4))) ? door.electionDate : undefined, serves: get("precinct") || get("ward") || null, sources: [rowSource] };
    const stringFields = ["days", "hours", "precinct", "town", "countyName", "countyFips", "countySubdivisionGeoid", "ward", "tribalNation", "reservation", "aiannhGeoid", "locationNotes", "accessibilityNotes", "lastUpdated"] as const;
    for (const field of stringFields) { const value = get(field); if (value && stated(field as VotingColumn)) site[field] = value;
      else if (value) recordMissing(`${name}: published ${field}`); }
    site.countyFips ??= door.scope.countyFips; site.countySubdivisionGeoid ??= door.scope.countySubdivisionGeoid;
    if (get("districtOcdIds")) site.districtOcdIds = get("districtOcdIds").split(/[;|]/).map(s => s.trim()).filter(Boolean);
    if (rowOffice) site.office = rowOffice;
    if (door.matchingUnit) site.matchingUnit = door.matchingUnit;
    if (get("rules") && stated("rules")) site.rules = [{ text: get("rules"), source: rowSource }];
    site.kinds = [kind];
    if (site.precinct) {
      const printed = site.precinct.trim().replace(/^(\S+)\s+\1$/, "$1");
      site.precincts = /^(?:(?:precincts?|districts?|pcts?\.?)\s+)?\d+(?:\s*[,;&]\s*\d+)+$/i.test(printed)
        ? printed.replace(/^(?:precincts?|districts?|pcts?\.?)\s+/i, "").split(/\s*[,;&]\s*/)
        : [printed];
      site.assignments = site.precincts.map(precinct => ({ precinct, ward: site.ward, name, room: site.room, locationNotes: site.locationNotes, source: rowSource }));
    }
    const date = get("date");
    if (date && !stated("date")) recordMissing(`${name}: published schedule date`);
    site.schedules = [{ kind, date: votingScheduleDate(date && stated("date") ? date : site.days ?? ""),
      days: site.days, hours: site.hours, electionDate: site.electionDate, source: rowSource }];
    const latitude = get("lat"), longitude = get("lng");
    if (latitude && longitude && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
      Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180) {
      site.lat = Number(latitude); site.lng = Number(longitude); site.geocodeSource = "PUBLISHER";
    }
    const prior = sites.findIndex(s => s.id === id);
    if (prior < 0) sites.push(site);
    else sites[prior] = mergeVotingSiteRows(sites[prior], site);
  }
  return { sites, office, missingRows, missingRowPlaces, officeRows };
}
/** Decode the public querydata response used by embedded Power BI maps. */
function powerBiVotingRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const envelope = value as Record<string, unknown>;
  if (Array.isArray(envelope.results)) return envelope.results.flatMap(powerBiVotingRows);
  if (envelope.result) return powerBiVotingRows(envelope.result);
  if (envelope.data) return powerBiVotingRows(envelope.data);
  const dsr = envelope.dsr as { DS?: unknown[] } | undefined;
  if (!Array.isArray(dsr?.DS)) return [];
  const descriptor = envelope.descriptor as { Select?: { Value?: string; Name?: string }[] } | undefined;
  const names = new Map((descriptor?.Select ?? []).map(item => [item.Value, item.Name]));
  const out: Record<string, unknown>[] = [];
  for (const rawDataset of dsr.DS) {
    const dataset = rawDataset as { PH?: Record<string, unknown>[]; ValueDicts?: Record<string, unknown[]> };
    for (const partition of dataset.PH ?? []) for (const matrix of Object.values(partition)) {
      if (!Array.isArray(matrix)) continue;
      let schema: { N: string; DN?: string }[] = [], prior: unknown[] = [];
      for (const row of matrix as { S?: { N: string; DN?: string }[]; C?: unknown[]; R?: number; M?: number }[]) {
        if (row.S) schema = row.S;
        if (!schema.length) continue;
        const values: unknown[] = []; let cursor = 0;
        for (let column = 0; column < schema.length; column++) {
          const bit = 2 ** column;
          if (Math.floor((row.R ?? 0) / bit) % 2) values[column] = prior[column];
          else if (Math.floor((row.M ?? 0) / bit) % 2) values[column] = null;
          else {
            const raw = row.C?.[cursor++], dictionary = schema[column]!.DN;
            values[column] = dictionary && typeof raw === "number" ? dataset.ValueDicts?.[dictionary]?.[raw] ?? raw : raw;
          }
        }
        prior = values;
        out.push(Object.fromEntries(schema.flatMap((column, index) => {
          const name = names.get(column.N) ?? column.N;
          return [[name, values[index]], [name.split(".").at(-1)!, values[index]]];
        })));
      }
    }
  }
  return out;
}
function jsonRecords(value: unknown, path?: string): Record<string, unknown>[] {
  if (!path) { const powerBi = powerBiVotingRows(value); if (powerBi.length) return powerBi; }
  if (path) for (const key of path.split(".").filter(Boolean)) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  if (Array.isArray(value)) return value.flatMap(v => v && typeof v === "object" && !Array.isArray(v) ? [(v as Record<string, unknown>).attributes as Record<string, unknown> ?? v as Record<string, unknown>] : []);
  if (value && typeof value === "object") {
    for (const key of ["features", "data", "results", "locations", "sites", "rows", "value"]) {
      const found = (value as Record<string, unknown>)[key]; if (Array.isArray(found)) return jsonRecords(found);
    }
  }
  return [];
}
export async function arcgisVotingRows(layerUrl: string, session: VotingFetchSession, where = "1=1"): Promise<Record<string, unknown>[]> {
  const base = layerUrl.replace(/\/query\/?(?:\?.*)?$/, "").replace(/\/$/, "");
  const queryUrl = (params: Record<string, string>) => {
    const url = new URL(`${base}/query`); for (const [key, value] of Object.entries({ f: "json", where, ...params })) url.searchParams.set(key, value);
    return url;
  };
  const query = async (params: Record<string, string>) => {
    const url = queryUrl(params);
    const capture = await session.get(url.href), value = JSON.parse(new TextDecoder().decode(capture.bytes));
    if (value.error) throw new Error(`ArcGIS: ${value.error.message ?? JSON.stringify(value.error)}`);
    return { ...value, captureHash: createHash("sha256").update(capture.bytes).digest("hex"), captureUrl: capture.url } as {
      objectIds?: number[]; features?: { attributes: Record<string, unknown> }[]; exceededTransferLimit?: boolean; captureHash: string; captureUrl: string;
    };
  };
  const ids = await query({ returnIdsOnly: "true" });
  if (!Array.isArray(ids.objectIds)) throw new Error("ArcGIS did not provide all object IDs; acquire the layer's paginated public route");
  const unique = [...new Set(ids.objectIds)], rows: Record<string, unknown>[] = [];
  const readBatch = async (batch: number[]): Promise<void> => {
    const params = { objectIds: batch.join(","), outFields: "*", returnGeometry: "false" };
    // IIS-backed public map services reject a long query URL with HTTP 404 before ArcGIS sees it.
    if (batch.length > 1 && queryUrl(params).href.length > 1800) {
      const mid = Math.ceil(batch.length / 2); await readBatch(batch.slice(0, mid)); await readBatch(batch.slice(mid)); return;
    }
    const result = await query(params);
    if (result.exceededTransferLimit && batch.length > 1) { const mid = Math.ceil(batch.length / 2); await readBatch(batch.slice(0, mid)); await readBatch(batch.slice(mid)); return; }
    if (result.exceededTransferLimit || !Array.isArray(result.features) || result.features.length !== batch.length) throw new Error("ArcGIS returned an incomplete object-ID batch; retain prior data and retry");
    rows.push(...result.features.map(f => ({ ...f.attributes, __captureHash: result.captureHash, __captureUrl: result.captureUrl })));
  };
  for (let at = 0; at < unique.length; at += 500) await readBatch(unique.slice(at, at + 500));
  return rows;
}
function embeddedJson(html: string): unknown[] {
  return [...html.matchAll(/<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => { try { return [JSON.parse(m[1]!)]; } catch { return []; } });
}
/** Precinct directory cards use the same heading/address layout across this platform. */
function voterfocusRows(html: string): Record<string, unknown>[] {
  const text = sourceText(html.replace(/<\/(?:h[1-6]|p|div|li|section)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n"));
  const blocks = text.split(/(?:^|\n)\s*(?:#{1,6}\s*)?Precinct\s+([\w-]+)[^\n]*\n/gi);
  const rows: Record<string, unknown>[] = [];
  for (let at = 1; at + 1 < blocks.length; at += 2) {
    const lines = blocks[at + 1]!.split("\n").map(line => line.replace(/【\d+†([^†】]+)(?:†[^】]*)?】/g, "$1").trim()).filter(Boolean);
    const addressIndex = lines.findIndex(line => /^\d+\s+/.test(line));
    const address = addressIndex < 0 ? undefined : /\b[A-Z]{2}\s+\d{5}/.test(lines[addressIndex]!) ? lines[addressIndex] : /\b[A-Z]{2}\s+\d{5}/.test(lines[addressIndex + 1] ?? "") ? `${lines[addressIndex]}, ${lines[addressIndex + 1]}` : undefined;
    const name = lines.find(line => !/^(?:Image:|Summary of|\d+\s)/i.test(line));
    if (name && address) rows.push({ precinct: blocks[at], name, address });
  }
  return rows;
}
/** One reader per recognizable platform shares public tables/JSON, never voter identity forms. */
const platformReaders: Record<VotingPlatform, (html: string, config: VotingExtraction) => Record<string, unknown>[]> = {
  voterfocus: (html, config) => htmlVotingTables(html).flatMap(tableRecords).concat(embeddedJson(html).flatMap(value => jsonRecords(value, config.jsonPath)), voterfocusRows(html)),
  voterview: (html, config) => embeddedJson(html).flatMap(value => jsonRecords(value, config.jsonPath)).concat(htmlVotingTables(html).flatMap(tableRecords)),
  "where-to-vote": (html, config) => htmlVotingTables(html).flatMap(tableRecords).concat(embeddedJson(html).flatMap(value => jsonRecords(value, config.jsonPath))),
  civix: (html, config) => embeddedJson(html).flatMap(value => jsonRecords(value, config.jsonPath)).concat(htmlVotingTables(html).flatMap(tableRecords)),
  "power-bi": (html, config) => embeddedJson(html).flatMap(value => jsonRecords(value, config.jsonPath)),
};
function splitVotingRows(rows: Record<string, unknown>[], config: VotingExtraction): Record<string, unknown>[] {
  const split = config.splitRows; if (!split) return rows;
  return rows.flatMap(row => {
    const values = String(row[split.column] ?? "").split(new RegExp(split.pattern)).map(s => s.trim()).filter(Boolean);
    if (values.length <= 1) return [row];
    const aligned = new Map((split.alignedColumns ?? []).map(column => [column, String(row[column] ?? "").split(new RegExp(split.alignedPattern ?? split.pattern)).map(s => s.trim()).filter(Boolean)]));
    return values.map((value, index) => {
      const out = { ...row, [split.column]: value };
      for (const [column, pieces] of aligned) {
        if (pieces.length === values.length) out[column] = pieces[index];
        else { out[column] = ""; out.__extractionWarning = `Published ${column} could not be aligned with the individual locations`; }
      }
      return out;
    });
  });
}
function configuredVotingRecords(text: string, config: VotingExtraction): Record<string, unknown>[] {
  if (config.textAssertions?.some(assertion => !sourceText(text).replace(/\s+/g, " ").toLowerCase().includes(assertion.replace(/\s+/g, " ").toLowerCase()))) throw new Error("The list's published assertions no longer match");
  const recordConfig = config.records!;
  const fields = (block: string, mapping: Record<string, { pattern: string; group: number }>) => Object.fromEntries(
    Object.entries(mapping).map(([field, extraction]) => [field, sourceText(block.match(new RegExp(extraction.pattern, "is"))?.[extraction.group] ?? "")]));
  const sections = recordConfig.within ? [...text.matchAll(new RegExp(recordConfig.within.pattern, "gis"))]
    .map(match => ({ block: match[recordConfig.within!.group ?? 0] ?? "", inherited: fields(match[0], recordConfig.within!.fields ?? {}) }))
    : [{ block: text, inherited: {} }];
  return sections.flatMap(section => [...section.block.matchAll(new RegExp(recordConfig.pattern, "gis"))].map(match => {
    let block = match[recordConfig.group ?? 0] ?? "";
    if (recordConfig.jsonString) block = JSON.parse(block) as string;
    return { ...section.inherited, ...fields(block, recordConfig.fields), __documentText: text };
  }));
}
async function parseVotingCaptureRows(capture: VotingCapture, door: VotingSourceDoor): Promise<Record<string, unknown>[]> {
  const text = decodeVotingBytes(capture.bytes), config = door.extraction ?? {};
  const format = config.format ?? (/\.xlsx(?:\?|$)/i.test(capture.url) || capture.bytes[0] === 80 && capture.bytes[1] === 75 ? "xlsx" : /\.pdf(?:\?|$)/i.test(capture.url) || text.startsWith("%PDF") ? "pdf" : /json/.test(capture.contentType) || /^[\s]*[\[{]/.test(text) ? "json" : /\.tsv(?:\?|$)|tab-separated/i.test(`${capture.url} ${capture.contentType}`) ? "tsv" : /\.csv(?:\?|$)|text\/csv/i.test(`${capture.url} ${capture.contentType}`) ? "csv" : "html");
  if (format === "json") return jsonRecords(JSON.parse(text), config.jsonPath);
  if (format === "csv" || format === "tsv") return tableRecords(tableFromRows(delimitedVotingRows(text.replace(/^\uFEFF/, ""), config.delimiter ?? (format === "tsv" || text.split(/\r?\n/, 1)[0]!.includes("\t") ? "\t" : ",")), config));
  if (format === "xlsx") return xlsxVotingTables(capture.bytes, config).flatMap(tableRecords);
  if (format === "pdf") {
    if (config.records) {
      const extracted = await votingPdfText(capture.bytes, capture.url);
      return configuredVotingRecords(extracted.text, config).map(row => ({ ...row, __extractionMethod: extracted.method }));
    }
    if (config.textAssertions?.length) {
      const extracted = await votingPdfText(capture.bytes, capture.url);
      const text = extracted.text.replace(/\s+/g, " ").toLowerCase();
      if (config.textAssertions.every(assertion => text.includes(assertion.replace(/\s+/g, " ").toLowerCase()))) return [{ __documentText: text }];
      throw new Error("The PDF's published location assertions no longer match; retain prior facts and re-extract this notice");
    }
    return (await pdfVotingTables(capture.bytes, config)).flatMap(tableRecords);
  }
  if (config.records) {
    return configuredVotingRecords(text, config);
  }
  if (config.textAssertions?.length && config.textAssertions.every(assertion => sourceText(text).toLowerCase().includes(assertion.toLowerCase()))) return [{}];
  if (config.tableIndex !== undefined) {
    const tables = htmlVotingTables(text);
    if (!Number.isInteger(config.tableIndex) || config.tableIndex < 0 || !tables[config.tableIndex]) throw new Error("The configured voting table is absent from this page");
    return tableRecords(tables[config.tableIndex]!);
  }
  const platform = door.platform ?? fingerprintVotingPlatform(capture.url, text);
  if (platform) return platformReaders[platform](text, config);
  const tables = htmlVotingTables(text);
  return tables.flatMap(tableRecords).concat(embeddedJson(text).flatMap(value => jsonRecords(value, config.jsonPath)));
}
/** Every extracted value retains the exact saved document that supplied its row. */
export async function parseVotingCapture(capture: VotingCapture, door: VotingSourceDoor): Promise<Record<string, unknown>[]> {
  const member = door.extraction?.archiveMember;
  const document = member ? { ...capture, bytes: votingArchiveMember(capture.bytes, member),
    contentType: /\.pdf$/i.test(member) ? "application/pdf" : /\.xlsx$/i.test(member) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain" } : capture;
  const rows = splitVotingRows(await parseVotingCaptureRows(document, door), door.extraction ?? {});
  const hash = createHash("sha256").update(capture.bytes).digest("hex");
  const documentText = rows.find(row => row.__documentText)?.__documentText;
  const words = normalized(sourceText(typeof documentText === "string" ? documentText : decodeVotingBytes(document.bytes)));
  const verifiedConstants = Object.entries(door.extraction?.constants ?? {}).filter(([, value]) => words.includes(normalized(value))).map(([field]) => field);
  return rows.map(row => {
    const { __documentText: _documentText, ...fields } = row;
    return { ...fields, __verifiedConstants: verifiedConstants, __captureHash: hash, __captureUrl: capture.url };
  });
}

export function applyVotingChangeNotices(sites: VotingSite[], notices: VotingChangeNotice[]): VotingSite[] {
  return sites.map(site => {
    const matching = notices.filter(n => Object.entries(n.match).length > 0 && Object.entries(n.match).every(([key, value]) => site[key as "id" | "precinct" | "name"] === value)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const changes: Record<string, unknown> = {}, sources = [...site.sources ?? []];
    for (const notice of matching) { for (const [key, value] of Object.entries(notice.changes)) if (!(key in changes)) changes[key] = value; sources.push(notice.source); }
    return { ...site, ...changes, sources };
  });
}
export async function readVotingSource(door: VotingSourceDoor, runtime: VotingSourceRuntime): Promise<VotingSourceRead> {
  const session = votingFetchSession(runtime), now = runtime.now?.() ?? new Date().toISOString();
  const source: VotingSource = { publisher: door.publisher, url: door.url, title: door.title, lastUpdated: door.fileUpdatedAt, checkedAt: now,
    official: isOfficialSource(door.url, door.officialLinkingPage) };
  const result: VotingSourceRead = { doorId: door.id, sites: [], office: door.office, rules: [], sources: [], blanks: [], attempts: session.attempts, rawBodies: session.rawBodies, fileTitle: door.title, fileUpdatedAt: door.fileUpdatedAt, publicationMessage: door.publicationMessage };
  const blank = (reason: VotingSourceRead["blanks"][number]["reason"], owed: string, tried: string[], scope: VotingDoorScope = door.scope) => result.blanks.push({ id: `${door.id}:${reason}:${createHash("sha256").update(`${scope.ocdId}\n${owed}`).digest("hex").slice(0, 12)}`, doorId: door.id, scope, status: "open", reason, owed, tried, next: ["Follow the chief election office's current election files and map services", "Read the delegated county or town election office's public lists and files"] });
  const siteScope = (site: Pick<VotingSite, "countyName" | "town" | "matchingUnit">): VotingDoorScope => {
    // A site's physical city is not its election jurisdiction unless the publisher matches by town.
    const town = site.matchingUnit === "TOWN" && site.town ? runtime.resolveScope?.(site.town, door.url, door.scope) : null;
    const county = site.countyName ? runtime.resolveScope?.(site.countyName, door.url, door.scope) : null;
    return town ?? county ?? door.scope;
  };
  if (door.shape === "identity-locked-lookup" || door.access?.status === "identity-locked") { blank("access", "Public voting sites from county lists; the voter identity lookup is closed", ["Identity-locked route recorded without requesting it"]); return result; }
  if (door.shape === "address-lookup") {
    blank("missing-sites", "Public bulk location lists and precinct boundaries for the address-only lookup", [door.url]);
    return result;
  }
  const officeDirectory = ["officeAddress", "phone", "email"].some(field => door.extraction?.columns?.[field as VotingColumn]);
  if (door.scopeUnresolved || door.covers.length === 0 && !officeDirectory && !door.boundaryLayer && !door.rules?.length && !door.publication) return result;
  let readStage: "access" | "extraction" = "access";
  try {
    if (door.boundaryLayer) {
      result.boundaries = await readVotingBoundaries(door, session, source);
      result.sources.push(source);
      return result;
    }
    if (door.covers.length && !door.covers.some(isVotingSiteKind)) {
      await session.get(door.url);
      result.sources.push(source);
      return result;
    }
    let rows: Record<string, unknown>[];
    let effectiveDoor = door;
    let electionPage: VotingCapture | undefined;
    if (door.electionAssociationVerified && (door.electionPageUrl !== door.url || door.extraction?.dataUrl)) {
      try {
        const page = await session.get(door.electionPageUrl);
        const verified = officialElectionLinkMatches(new TextDecoder().decode(page.bytes), page.url, door);
        effectiveDoor = { ...door, electionAssociationVerified: verified };
        if (verified) electionPage = page;
        if (!verified) blank("missing-sites", "Current official election-page association for this list", [door.electionPageUrl, door.url]);
      } catch (error) {
        effectiveDoor = { ...door, electionAssociationVerified: false };
        blank("access", "Re-read the official election page linking this list", [door.electionPageUrl, String(error)]);
      }
    }
    const mapUrl = door.extraction?.dataUrl ?? door.url;
    if (door.shape === "map-service" && /(?:FeatureServer|MapServer)\/\d+/i.test(mapUrl)) rows = await arcgisVotingRows(mapUrl, session, door.extraction?.where);
    else {
      const extraction = door.extraction ?? {}, target = new URL(extraction.dataUrl ?? door.url, door.url);
      const init: RequestInit = extraction.dataBody ? { method: extraction.dataMethod ?? "POST", headers: { "content-type": "application/json", ...extraction.requestHeaders }, body: JSON.stringify(extraction.dataBody) } : {};
      const capture = await session.get(target.href, init); readStage = "extraction"; rows = await parseVotingCapture(capture, door);
      if (rows.some(row => row.__extractionMethod === "OCR")) result.attempts.push({ url: capture.url, route: "direct", outcome: "Saved scanned PDF read with the installed OCR engine" });
      const text = new TextDecoder().decode(capture.bytes);
      if (/html/.test(capture.contentType) && door.electionPageUrl === door.url) effectiveDoor = { ...door, electionAssociationVerified: officialElectionLinkMatches(text, capture.url, door) };
      if (/html/.test(capture.contentType)) {
        const pages = await readVotingPages(capture, session);
        for (const page of pages.captures) rows.push(...await parseVotingCapture(page, door));
        rows = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
        for (const failure of pages.failures) blank("missing-sites", "Remaining pages of the published location list", [failure]);
      }
      if (/html/.test(capture.contentType)) result.fileTitle = sourceText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || result.fileTitle;
    }
    if (typeof rows[0]?.__fileTitle === "string" && rows[0].__fileTitle) result.fileTitle = rows[0].__fileTitle;
    if (typeof rows[0]?.__fileUpdatedAt === "string" && rows[0].__fileUpdatedAt) result.fileUpdatedAt = rows[0].__fileUpdatedAt;
    source.title = result.fileTitle; source.lastUpdated = result.fileUpdatedAt;
    result.sources.push(source); result.rules = door.rules ?? [];
    const linkedScheduleFields = electionPage ? Object.entries(door.extraction?.constants ?? {})
      .filter(([field, value]) => ["hours", "days", "date", "election", "rules"].includes(field) &&
        normalized(sourceText(new TextDecoder().decode(electionPage!.bytes))).includes(normalized(value)))
      .map(([field]) => field) : [];
    if (linkedScheduleFields.length) rows = rows.map(row => ({ ...row,
      __verifiedConstants: [...new Set([...(row.__verifiedConstants as string[] | undefined ?? []), ...linkedScheduleFields])] }));
    const parsed = votingRowsToSites(rows, effectiveDoor, source);
    if (electionPage) {
      const linkingSource: VotingSource = { publisher: door.publisher, url: electionPage.url, checkedAt: now,
        official: isOfficialSource(electionPage.url, door.officialLinkingPage), documentUrl: electionPage.url,
        documentHash: createHash("sha256").update(electionPage.bytes).digest("hex") };
      result.sources.push(linkingSource);
      for (const site of parsed.sites) {
        site.sources = [...site.sources ?? [], linkingSource];
        if (linkedScheduleFields.length) site.schedules = site.schedules?.map(schedule => ({ ...schedule, source: linkingSource }));
        if (linkedScheduleFields.includes("rules")) site.rules = site.rules?.map(rule => ({ ...rule, source: linkingSource }));
      }
    }
    parsed.missingRows.forEach((missing, index) => blank("missing-sites", `Published ${missing}`, [door.url], siteScope({ ...parsed.missingRowPlaces[index], matchingUnit: door.matchingUnit })));
    result.contacts = [];
    for (const row of parsed.officeRows) {
      const scope = runtime.resolveScope?.(row.label, door.url, door.scope) ?? (row.countyName ? runtime.resolveScope?.(row.countyName, door.url, door.scope) : null) ?? (door.scope.countyFips || door.scope.countySubdivisionGeoid ? door.scope : null);
      if (scope) {
        const contact = { scope, office: row.office, source };
        if (!result.contacts.some(c => c.scope.ocdId === scope.ocdId && c.office.phone === row.office.phone && c.office.email === row.office.email)) result.contacts.push(contact);
      } else blank("missing-sites", `Registered office match for the published ${row.label} contact`, [door.url]);
    }
    for (const site of parsed.sites) if (site.countyName && !site.countyFips) {
      site.countyFips = runtime.resolveCountyFips?.(site.countyName, door.scope.state) ?? undefined;
      if (!site.countyFips) blank("missing-sites", `Registered county match for ${site.countyName}`, [door.url, site.name], siteScope(site));
    }
    for (const site of parsed.sites) if (site.tribalNation && !/^(?:na|n\/a)$/i.test(site.tribalNation) && !site.aiannhGeoid) {
      site.aiannhGeoid = runtime.resolveAiannhGeoid?.(site.tribalNation, site.reservation ?? "", door.scope.state) ?? undefined;
      if (!site.aiannhGeoid) blank("missing-sites", `Census tribal area for ${site.tribalNation} satellite office`, [site.reservation ?? "", door.url], siteScope(site));
    }
    result.sites = applyVotingChangeNotices(parsed.sites, door.changeNotices ?? []); result.office = parsed.office;
    if (runtime.geocode) for (const site of result.sites.filter(site => site.lat === null || site.lng === null)) {
      if (runtime.deadlineMs !== undefined && Date.now() >= runtime.deadlineMs) break;
      try { const point = await runtime.geocode(site.address); if (point) { site.lat = point.lat; site.lng = point.lng; site.geocodeSource = "CENSUS"; } else blank("geocode", `Census coordinates for ${site.name}`, [site.address], siteScope(site)); }
      catch (error) { blank("geocode", `Census coordinates for ${site.name}`, [String(error)], siteScope(site)); }
    }
    if (!result.sites.length && !result.contacts?.length && !result.rules.length && door.publication?.status !== "NO_GENERAL_ELECTION") blank(door.publicationMessage ? "unpublished" : "missing-sites", door.publicationMessage ?? `Published ${door.covers.join(", ")} sites and hours`, result.attempts.map(a => `${a.url}: ${a.outcome}`));
    const publishedElectionDates = [...new Set(rows.flatMap(row => publishedElectionDatesIn(readValue(row, "election", door.extraction ?? {}))))];
    if (publishedElectionDates.length && publishedElectionDates.every(date => date < door.electionDate)) blank("earlier-election", "A newer election list; retain the official archive's currently published list", publishedElectionDates);
    const titleDates = publishedElectionDatesIn(result.fileTitle ?? "");
    const currentRows = result.sites.length > 0 && result.sites.every(site => site.electionDate === door.electionDate);
    if (!currentRows && titleDates.length && titleDates.every(date => date < door.electionDate)) blank("earlier-election", "A newer election list; continue showing the file linked by the current official election page", [result.fileTitle ?? "", ...titleDates]);
    const years = [...(result.fileTitle ?? "").matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
    if (years.length && Math.max(...years) < Number(door.electionDate.slice(0, 4))) blank("earlier-election", "A newer election list; continue showing the file linked by the current official election page", [result.fileTitle ?? ""]);
  } catch (error) { blank(readStage, `Published ${door.covers.join(", ")} sites and hours`, [...result.attempts.map(a => `${a.url}: ${a.outcome}`), String(error)]); }
  result.blanks = [...new Map(result.blanks.map(blank => [blank.id, blank])).values()];
  return result;
}
