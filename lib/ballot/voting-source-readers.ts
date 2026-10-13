import { createHash } from "node:crypto";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { SiteKind, VotingOfficeContact, VotingSite, VotingSource } from "./voting-sites.ts";
import type { VotingChangeNotice, VotingColumn, VotingExtraction, VotingPlatform, VotingSourceDoor, VotingSourceRead, VotingSourceRuntime } from "./voting-source-types.ts";
import { delimitedVotingRows, htmlVotingTables, pdfVotingTables, sourceText, tableFromRows, xlsxVotingTables, type VotingTable } from "./voting-source-tables.ts";
import { votingFetchSession, type VotingCapture, type VotingFetchSession } from "./voting-source-fetch.ts";

const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Partial<Record<VotingColumn, string[]>> = {
  id: ["id", "objectid", "siteid"], name: ["name", "location", "pollinglocation", "pollingplace", "sitename", "centername", "facilityname", "building", "earlyvotinglocation"],
  address: ["address", "streetaddress", "locationaddress", "centeraddress", "pollingaddress"], room: ["room", "roomlocation"],
  days: ["days", "dates", "day", "votingdates"], hours: ["hours", "pollinghours", "votinghours", "hoursofoperation", "earlyvotingdateandtimes"],
  precinct: ["precinct", "precinctname", "precinctnumber"], town: ["town", "municipality", "city"], countyName: ["county", "countyname"], countyFips: ["countyfips", "countyfp"],
  countySubdivisionGeoid: ["countysubdivisiongeoid", "cousubgeoid"], ward: ["ward"], phone: ["phone", "clerkphone", "countyauditorphone", "telephone"],
  email: ["email"], officeName: ["officename", "clerk"], officeAddress: ["officeaddress"],
  locationNotes: ["locationnotes", "notes", "locationdescription", "comments"], accessibilityNotes: ["accessibility", "accessibilitynotes", "accessible"],
  rules: ["rules", "returnrules", "restrictions"], election: ["election", "electionname", "electiondate"],
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
export function officialElectionLinkMatches(html: string, pageUrl: string, door: VotingSourceDoor): boolean {
  if (!electionDateNamed(sourceText(html), door.electionDate)) return false;
  if (pageUrl === door.url) return true;
  return [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].some(match => {
    try { return new URL(match[1]!.replace(/&amp;/g, "&"), pageUrl).href.split("#")[0] === door.url.split("#")[0]; } catch { return false; }
  });
}
const kindFrom = (value: string, fallback: SiteKind): SiteKind => /drop|ballot.?box/i.test(value) ? "DROP_BOX" : /satellite/i.test(value) ? "SATELLITE" : /early/i.test(value) ? "EARLY_VOTING" : /vote.?cent[er]{2}/i.test(value) ? "VOTE_CENTER" : /mobile/i.test(value) ? "MOBILE" : fallback;
function tableRecords(table: VotingTable): Record<string, unknown>[] {
  return table.rows.map(row => Object.fromEntries([...row.flatMap((value, index) => [[table.headers[index] ?? String(index), value], [String(index), value]]), ["__tableTitle", table.title ?? ""], ["__fileTitle", table.documentTitle ?? ""], ["__fileUpdatedAt", table.lastUpdated ?? ""]]));
}
function readValue(row: Record<string, unknown>, field: VotingColumn, config: VotingExtraction): string {
  const transform = config.transforms?.[field];
  if (transform) return String(row[transform.column] ?? "").match(new RegExp(transform.pattern, "is"))?.[transform.group]?.trim() ?? "";
  if (config.constants?.[field] !== undefined) return config.constants[field]!;
  const key = config.columns?.[field];
  if (key) return (Array.isArray(key) ? key : [key]).map(k => String(row[k] ?? "").trim()).filter(Boolean).join(", ");
  const alias = ALIASES[field] ?? [normalized(field)];
  const match = Object.keys(row).find(k => alias.includes(normalized(k)));
  return match ? String(row[match] ?? "").trim() : "";
}
export function votingRowsToSites(rows: Record<string, unknown>[], door: VotingSourceDoor, source: VotingSource): { sites: VotingSite[]; office?: VotingOfficeContact; missingRows: string[]; officeRows: { label: string; countyName: string; office: VotingOfficeContact }[] } {
  const config = door.extraction ?? {}, sites: VotingSite[] = [], missingRows: string[] = [], officeRows: { label: string; countyName: string; office: VotingOfficeContact }[] = []; const office = door.office;
  for (const row of rows) {
    if (Object.entries(config.filters ?? {}).some(([key, value]) => String(row[key] ?? "") !== value)) continue;
    const get = (field: VotingColumn) => readValue(row, field, config);
    const phone = get("phone"), email = get("email");
    const rowOffice = phone || email ? { name: get("officeName") || get("town") || get("countyName") || door.publisher, ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(get("officeAddress") ? { address: get("officeAddress") } : {}), url: source.url } : undefined;
    if (rowOffice) officeRows.push({ label: get("town") || get("countyName") || door.scope.name, countyName: get("countyName"), office: rowOffice });
    const name = get("name"), address = get("address");
    if (!name || !address) { if (name || address || phone || email) missingRows.push(`${get("town") || get("countyName") || name || address || door.scope.name}: ${!name ? "site name" : ""}${!name && !address ? " and " : ""}${!address ? "site address" : ""}`); continue; }
    const kind = kindFrom(get("kind") || String(row.__tableTitle ?? ""), config.kind ?? door.covers[0] ?? "ELECTION_DAY");
    const id = `${door.id}-${createHash("sha256").update([kind, get("id"), name, address, get("precinct")].join("\0")).digest("hex").slice(0, 16)}`;
    const site: VotingSite = { id, name, address, room: get("room") || null, lat: null, lng: null, kind, election: get("election") || door.title || null, electionDate: door.electionAssociationVerified === true || (electionDateNamed(get("election"), door.electionDate) || /general/i.test(get("election")) && get("election").includes(door.electionDate.slice(0, 4))) ? door.electionDate : undefined, serves: get("precinct") || get("ward") || null, sources: [source] };
    const stringFields = ["days", "hours", "precinct", "town", "countyName", "countyFips", "countySubdivisionGeoid", "ward", "aiannhGeoid", "locationNotes", "accessibilityNotes", "lastUpdated"] as const;
    for (const field of stringFields) { const value = get(field); if (value) site[field] = value; }
    site.countyFips ??= door.scope.countyFips; site.countySubdivisionGeoid ??= door.scope.countySubdivisionGeoid;
    if (get("districtOcdIds")) site.districtOcdIds = get("districtOcdIds").split(/[;|]/).map(s => s.trim()).filter(Boolean);
    if (rowOffice) site.office = rowOffice;
    if (door.matchingUnit) site.matchingUnit = door.matchingUnit;
    if (get("rules")) site.rules = [{ text: get("rules"), source }];
    // Published coordinates are evidence, but every site is placed by Census below.
    const prior = sites.find(s => s.id === id);
    if (!prior) sites.push(site);
    else {
      if (site.days && site.hours) { prior.hours = `${prior.hours?.includes("\n") ? prior.hours : `${prior.days ?? ""}: ${prior.hours ?? ""}`}\n${site.days}: ${site.hours}`; prior.days = [prior.days, site.days].filter(Boolean).join("; "); }
      else if (site.hours && !prior.hours?.includes(site.hours)) prior.hours = [prior.hours, site.hours].filter(Boolean).join("\n");
    }
  }
  return { sites, office, missingRows, officeRows };
}
/** Decode the public querydata response used by embedded Power BI maps. */
export function powerBiVotingRows(value: unknown): Record<string, unknown>[] {
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
export async function arcgisVotingRows(layerUrl: string, session: VotingFetchSession): Promise<Record<string, unknown>[]> {
  const base = layerUrl.replace(/\/query\/?(?:\?.*)?$/, "").replace(/\/$/, "");
  const query = async (params: Record<string, string>) => {
    const url = new URL(`${base}/query`); for (const [key, value] of Object.entries({ f: "json", where: "1=1", ...params })) url.searchParams.set(key, value);
    const capture = await session.get(url.href), value = JSON.parse(new TextDecoder().decode(capture.bytes));
    if (value.error) throw new Error(`ArcGIS: ${value.error.message ?? JSON.stringify(value.error)}`);
    return value as { objectIds?: number[]; features?: { attributes: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
  };
  const ids = await query({ returnIdsOnly: "true" });
  if (!Array.isArray(ids.objectIds)) throw new Error("ArcGIS did not provide all object IDs; acquire the layer's paginated public route");
  const unique = [...new Set(ids.objectIds)], rows: Record<string, unknown>[] = [];
  const readBatch = async (batch: number[]): Promise<void> => {
    const result = await query({ objectIds: batch.join(","), outFields: "*", returnGeometry: "false" });
    if (result.exceededTransferLimit && batch.length > 1) { const mid = Math.ceil(batch.length / 2); await readBatch(batch.slice(0, mid)); await readBatch(batch.slice(mid)); return; }
    if (result.exceededTransferLimit || !Array.isArray(result.features) || result.features.length !== batch.length) throw new Error("ArcGIS returned an incomplete object-ID batch; retain prior data and retry");
    rows.push(...result.features.map(f => f.attributes));
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
    const address = lines.find(line => /^\d+\s+/.test(line) && /\b[A-Z]{2}\s+\d{5}/.test(line));
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
export async function parseVotingCapture(capture: VotingCapture, door: VotingSourceDoor): Promise<Record<string, unknown>[]> {
  const text = new TextDecoder().decode(capture.bytes), config = door.extraction ?? {};
  const format = config.format ?? (/\.xlsx(?:\?|$)/i.test(capture.url) || capture.bytes[0] === 80 && capture.bytes[1] === 75 ? "xlsx" : /\.pdf(?:\?|$)/i.test(capture.url) || text.startsWith("%PDF") ? "pdf" : /json/.test(capture.contentType) || /^[\s]*[\[{]/.test(text) ? "json" : /\.tsv(?:\?|$)|tab-separated/i.test(`${capture.url} ${capture.contentType}`) ? "tsv" : /\.csv(?:\?|$)|text\/csv/i.test(`${capture.url} ${capture.contentType}`) ? "csv" : "html");
  if (format === "json") return jsonRecords(JSON.parse(text), config.jsonPath);
  if (format === "csv" || format === "tsv") return tableRecords(tableFromRows(delimitedVotingRows(text.replace(/^\uFEFF/, ""), config.delimiter ?? (format === "tsv" ? "\t" : ",")), config));
  if (format === "xlsx") return xlsxVotingTables(capture.bytes, config).flatMap(tableRecords);
  if (format === "pdf") return (await pdfVotingTables(capture.bytes, config)).flatMap(tableRecords);
  if (config.textAssertions?.length && config.textAssertions.every(assertion => sourceText(text).toLowerCase().includes(assertion.toLowerCase()))) return [{}];
  const platform = door.platform ?? fingerprintVotingPlatform(capture.url, text);
  return platform ? platformReaders[platform](text, config) : htmlVotingTables(text).flatMap(tableRecords).concat(embeddedJson(text).flatMap(value => jsonRecords(value, config.jsonPath)));
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
  const source: VotingSource = { publisher: door.publisher, url: door.url, title: door.title, lastUpdated: door.fileUpdatedAt, checkedAt: now };
  const result: VotingSourceRead = { doorId: door.id, sites: [], office: door.office, rules: [], sources: [], blanks: [], attempts: session.attempts, rawBodies: session.rawBodies, fileTitle: door.title, fileUpdatedAt: door.fileUpdatedAt, publicationMessage: door.publicationMessage };
  const blank = (reason: VotingSourceRead["blanks"][number]["reason"], owed: string, tried: string[]) => result.blanks.push({ id: `${door.id}:${reason}:${createHash("sha256").update(owed).digest("hex").slice(0, 12)}`, doorId: door.id, scope: door.scope, status: "open", reason, owed, tried, next: ["Follow the chief election office's current election files and map services", "Read the delegated county or town election office's public lists and files"] });
  if (door.shape === "identity-locked-lookup" || door.access?.status === "identity-locked") { blank("access", "Public voting sites from county lists; the voter identity lookup is closed", ["Identity-locked route recorded without requesting it"]); return result; }
  if (door.shape === "address-lookup" && !runtime.readerAddress) return result;
  if (door.scopeUnresolved || door.covers.length === 0 && !door.rules?.length && !door.publication) return result;
  let readStage: "access" | "extraction" = "access";
  try {
    let rows: Record<string, unknown>[];
    let effectiveDoor = door;
    if (door.electionAssociationVerified && door.electionPageUrl !== door.url && door.shape !== "address-lookup") {
      try {
        const page = await session.get(door.electionPageUrl);
        const verified = officialElectionLinkMatches(new TextDecoder().decode(page.bytes), page.url, door);
        effectiveDoor = { ...door, electionAssociationVerified: verified };
        if (!verified) blank("missing-sites", "Current official election-page association for this list", [door.electionPageUrl, door.url]);
      } catch (error) {
        effectiveDoor = { ...door, electionAssociationVerified: false };
        blank("access", "Re-read the official election page linking this list", [door.electionPageUrl, String(error)]);
      }
    }
    if (door.shape === "map-service" && /(?:FeatureServer|MapServer)\/\d+/i.test(door.url)) rows = await arcgisVotingRows(door.url, session);
    else {
      const extraction = door.extraction ?? {}, target = new URL(extraction.dataUrl ?? door.url, door.url);
      let init: RequestInit = extraction.dataBody ? { method: extraction.dataMethod ?? "POST", headers: { "content-type": "application/json", ...extraction.requestHeaders }, body: JSON.stringify(extraction.dataBody) } : {};
      if (door.shape === "address-lookup") {
        if (!isOfficialSource(target.href, door.officialLinkingPage)) throw new Error("An address lookup must have an official election-office source");
        if (target.hostname !== new URL(door.url).hostname && !target.hostname.endsWith(".gov")) throw new Error("The address endpoint is not the recorded election office");
        const fields = extraction.addressFields; if (!fields || !Object.keys(fields).length) throw new Error("The official address-only form inputs have not been recorded");
        const params = new URLSearchParams();
        for (const [field, name] of Object.entries(fields)) {
          if (/^(?:name|first.?name|last.?name|full.?name|voter.?name|user.?name)$|birth|dob|ssn|social|password/i.test(name)) throw new Error("Identity input is forbidden");
          const value = runtime.readerAddress?.[field as keyof NonNullable<VotingSourceRuntime["readerAddress"]>]; if (value) params.set(name, value);
        }
        if (!params.size) throw new Error("The address input cannot answer this official form");
        if (extraction.dataMethod === "POST") init = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() };
        else for (const [key, value] of params) target.searchParams.set(key, value);
      }
      const capture = await session.get(target.href, init); readStage = "extraction"; rows = await parseVotingCapture(capture, door);
      const text = new TextDecoder().decode(capture.bytes);
      if (/html/.test(capture.contentType)) result.fileTitle = sourceText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || result.fileTitle;
    }
    if (typeof rows[0]?.__fileTitle === "string" && rows[0].__fileTitle) result.fileTitle = rows[0].__fileTitle;
    if (typeof rows[0]?.__fileUpdatedAt === "string" && rows[0].__fileUpdatedAt) result.fileUpdatedAt = rows[0].__fileUpdatedAt;
    source.title = result.fileTitle; source.lastUpdated = result.fileUpdatedAt;
    result.sources.push(source); result.rules = door.rules ?? [];
    const parsed = votingRowsToSites(rows, effectiveDoor, source);
    for (const missing of parsed.missingRows) blank("missing-sites", `Published ${missing}`, [door.url]);
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
      if (!site.countyFips) blank("missing-sites", `Registered county match for ${site.countyName}`, [door.url, site.name]);
    }
    result.sites = applyVotingChangeNotices(parsed.sites, door.changeNotices ?? []); result.office = parsed.office;
    if (runtime.geocode) for (const site of result.sites) {
      try { const point = await runtime.geocode(site.address); if (point) { site.lat = point.lat; site.lng = point.lng; site.geocodeSource = "CENSUS"; } else blank("geocode", `Census coordinates for ${site.name}`, [site.address]); }
      catch (error) { blank("geocode", `Census coordinates for ${site.name}`, [String(error)]); }
    }
    if (!result.sites.length && !result.rules.length && door.publication?.status !== "NO_GENERAL_ELECTION") blank(door.publicationMessage ? "unpublished" : "missing-sites", door.publicationMessage ?? `Published ${door.covers.join(", ")} sites and hours`, result.attempts.map(a => `${a.url}: ${a.outcome}`));
    const years = [...(result.fileTitle ?? "").matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
    if (years.length && Math.max(...years) < Number(door.electionDate.slice(0, 4))) blank("earlier-election", "A newer election list; continue showing the file linked by the current official election page", [result.fileTitle ?? ""]);
  } catch (error) { blank(readStage, `Published ${door.covers.join(", ")} sites and hours`, [...result.attempts.map(a => `${a.url}: ${a.outcome}`), String(error)]); }
  return result;
}
