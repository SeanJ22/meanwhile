import { first, nodes, parseHtml, type StateRosterRecord } from "./html.ts";

type Chamber = "lower" | "upper";
type Document = { readonly url: string; readonly body: string; readonly retrievedAt?: string };
type Result = { records: StateRosterRecord[]; complete: boolean; chambers: Chamber[] };
type Row = Record<string, unknown>;

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: official record schema changed`);
  return value as Row;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: official roster array is absent`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}: official value is absent`);
  return value.trim();
}
function id(value: unknown, label: string): string {
  if (!(typeof value === "string" && value.trim()) && !(typeof value === "number" && Number.isInteger(value))) throw new Error(`${label}: native person ID is absent`);
  return String(value);
}
function chamber(value: unknown, lower: string, upper: string, label: string): Chamber {
  if (value === lower) return "lower";
  if (value === upper) return "upper";
  throw new Error(`${label}: unknown official chamber`);
}
function joinedName(row: Row, fields: string[]): string {
  for (const field of fields) if (row[field] !== null && row[field] !== undefined && typeof row[field] !== "string") throw new Error(`Official name field ${field} changed schema`);
  return fields.map(field => typeof row[field] === "string" ? row[field].trim() : "").filter(Boolean).join(" ");
}
function result(records: StateRosterRecord[], chambers: Chamber[], complete = true): Result {
  if (!records.length) throw new Error("Official current roster contains no publishable member records");
  return { records, complete, chambers };
}

function alabama(document: Document): Result {
  const payload = object(JSON.parse(document.body), "Alabama response");
  if (payload.errors) throw new Error("Alabama official roster query returned errors");
  const roster = object(object(payload.data, "Alabama data").legislativeMembers, "Alabama legislativeMembers");
  const rows = array(roster.data, "Alabama legislativeMembers");
  if (!Number.isInteger(roster.count) || roster.count !== rows.length) throw new Error("Alabama official roster was truncated");
  const records = rows.map(value => {
    const row = object(value, "Alabama member");
    const body = chamber(row.body, "House", "Senate", "Alabama member");
    const publishedDistrict = string(row.district, "Alabama district");
    const match = /^(House|Senate) District (\d+)$/.exec(publishedDistrict);
    if (!match || match[1] !== row.body) throw new Error("Alabama official district no longer agrees with the member chamber");
    return { name: string(row.fullName, "Alabama member name"), district: match[2]!, chamber: body,
      sourceUrl: document.url, nativeId: id(row.id, "Alabama member"), party: typeof row.affiliation === "string" ? row.affiliation : null };
  });
  return result(records, ["lower", "upper"]);
}

function southDakota(document: Document): Result {
  const rows = array(JSON.parse(document.body), "South Dakota roster");
  const records: StateRosterRecord[] = [];
  let complete = true;
  for (const value of rows) {
    const row = object(value, "South Dakota member");
    const body = chamber(row.MemberType, "H", "S", "South Dakota member");
    const district = string(row.District, "South Dakota district");
    if (!/^\d+[AB]?$/.test(district)) throw new Error("South Dakota official district schema changed");
    if (row.InactiveDate !== null && row.InactiveDate !== undefined) {
      // The source has no person-to-seat identifier in its two-member House districts.
      // A departure is never published as a holder or assigned to a guessed seat.
      if (typeof row.InactiveDate !== "string" || !Number.isFinite(Date.parse(row.InactiveDate))) throw new Error("South Dakota departure date schema changed");
      complete = false;
      continue;
    }
    records.push({ name: string(row.Name, "South Dakota name"), district, chamber: body,
      sourceUrl: new URL(`/Legislators/Profile/${id(row.SessionMemberId, "South Dakota session member")}`, document.url).href,
      nativeId: id(row.PersonId, "South Dakota person"), party: typeof row.Politics === "string" ? row.Politics : null });
  }
  return result(records, ["lower", "upper"], complete);
}

function vermont(document: Document): Result {
  const payload = object(JSON.parse(document.body), "Vermont response");
  const rows = array(payload.data, "Vermont roster");
  const year = /\/people\/loadAll\/(\d{4})(?:\/|\?|$)/.exec(document.url)?.[1];
  if (!year) throw new Error("Vermont official roster year is absent");
  const records: StateRosterRecord[] = [];
  for (const value of rows) {
    const row = object(value, "Vermont member");
    const body = chamber(row.PersonTypeID, "H", "S", "Vermont member");
    const title = string(row.Title, "Vermont member title");
    if (title !== (body === "lower" ? "Representative" : "Senator")) throw new Error("Vermont official title and chamber disagree");
    if (typeof row.TerminationReason !== "string") throw new Error("Vermont official termination schema changed");
    if (row.TerminationReason.trim()) {
      if (!/^(Resigned|Deceased|Died)\b/i.test(row.TerminationReason.trim())) throw new Error("Vermont official termination reason is unrecognized");
      continue;
    }
    const district = string(row.District, "Vermont district").replace(/ District$/, "");
    const name = joinedName(row, ["FirstName", "LastName", "NameSuffix"]);
    if (!name || typeof row.FirstName !== "string" || typeof row.LastName !== "string") throw new Error("Vermont official member name is absent");
    const nativeId = id(row.PersonID, "Vermont person");
    records.push({ name, district, chamber: body, nativeId,
      sourceUrl: new URL(`/people/single/${year}/${nativeId}`, document.url).href,
      party: typeof row.Party === "string" ? row.Party : null });
  }
  return result(records, ["lower", "upper"]);
}

function wyoming(document: Document, defaultChamber?: Chamber): Result {
  const body = defaultChamber ?? (/\/H(?:\?|$)/.test(document.url) ? "lower" : /\/S(?:\?|$)/.test(document.url) ? "upper" : undefined);
  if (!body) throw new Error("Wyoming official roster chamber is absent");
  const rows = array(JSON.parse(document.body), "Wyoming roster");
  const records: StateRosterRecord[] = [];
  let complete = true;
  for (const value of rows) {
    const row = object(value, "Wyoming member");
    const publishedDistrict = string(row.district, "Wyoming district");
    const match = /^([HS])(\d+)$/.exec(publishedDistrict);
    if (!match || match[1] !== (body === "lower" ? "H" : "S")) throw new Error("Wyoming official district and source chamber disagree");
    if (row.legStatus !== "C") { complete = false; continue; }
    const nativeId = id(row.legID, "Wyoming member");
    const year = /\/Legislator\/(\d{4})\//i.exec(document.url)?.[1];
    if (!year) throw new Error("Wyoming official roster year is absent");
    records.push({ name: string(row.name, "Wyoming name"), district: match[2]!, chamber: body, nativeId,
      sourceUrl: new URL(`/Legislators/${year}/${body === "lower" ? "H" : "S"}/${nativeId}`, document.url).href,
      party: typeof row.party === "string" ? row.party : null });
  }
  return result(records, [body], complete);
}

function michigan(document: Document, defaultChamber?: Chamber): Result | null {
  if (defaultChamber === "lower") return null;
  const component = first(parseHtml(document.body), node => node.tag === "senator-list");
  if (!component) return null;
  const rows = array(JSON.parse(component.attrs.senatorinfo ?? ""), "Michigan senators");
  const records = rows.map(value => {
    const row = object(value, "Michigan senator");
    const district = string(row.district, "Michigan district");
    if (!/^\d+$/.test(district)) throw new Error("Michigan official senator district schema changed");
    if (typeof row.firstName !== "string" || typeof row.lastName !== "string") throw new Error("Michigan official senator name is absent");
    return { name: joinedName(row, ["firstName", "middleInitial", "lastName", "suffix"]), district, chamber: "upper" as const,
      sourceUrl: document.url, nativeId: id(row.id, "Michigan senator"), party: typeof row.party === "string" ? row.party : null };
  });
  return result(records, ["upper"]);
}

function rhodeIsland(document: Document): Result {
  const root = parseHtml(document.body);
  const data = first(root, node => node.tag === "rs:data");
  if (!data || first(root, node => node.tag === "soap:fault")) throw new Error("Rhode Island official SOAP roster is absent");
  const rows = nodes(data, node => node.tag === "z:row");
  if (!rows.length || Number(data.attrs.itemcount) !== rows.length) throw new Error("Rhode Island official roster rows disagree with the declared count");
  const records: StateRosterRecord[] = [];
  const inactive = new Map<string, { chamber: Chamber; district: string }>();
  for (const row of rows) {
    const body = chamber(row.attrs.ows_chamber, "House", "Senate", "Rhode Island member");
    if (!/^[01]$/.test(row.attrs.ows_activeflag ?? "")) throw new Error("Rhode Island official current-holder flag changed schema");
    const district = row.attrs.ows_district;
    if (!district || !/^\d+(?:\.0+)?$/.test(district)) throw new Error("Rhode Island official district schema changed");
    if (row.attrs.ows_activeflag === "0") {
      inactive.set(`${body}:${Number(district)}`, { chamber: body, district: String(Number(district)) });
      continue;
    }
    const name = string(row.attrs.ows_legislator_name, "Rhode Island name");
    const url = string(row.attrs.ows_legislator_biourl, "Rhode Island member biography").split(",")[0]!.trim();
    records.push({ name, district: String(Number(district)), chamber: body, sourceUrl: new URL(url, document.url).href,
      nativeId: id(row.attrs.ows_id, "Rhode Island member"), party: row.attrs.ows_political_party ?? null });
  }
  const complete = !data.attrs.listitemcollectionpositionnext;
  if (complete) {
    const held = new Set(records.map(row => `${row.chamber}:${row.district}`));
    for (const [seat, row] of inactive) if (!held.has(seat)) records.push({ name: "Vacant", district: row.district,
      chamber: row.chamber, sourceUrl: document.url, vacant: true, since: null, seatBound: true });
  }
  return result(records, ["lower", "upper"], complete);
}

function montana(document: Document): Result {
  const payload = object(JSON.parse(document.body), "Montana response");
  const rows = array(payload.content, "Montana roster");
  const at = (document.retrievedAt ?? new Date().toISOString()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new Error("Montana official roster retrieval date is absent");
  const records: StateRosterRecord[] = [];
  for (const value of rows) {
    const row = object(value, "Montana member");
    const legislature = object(row.legislature, "Montana legislature");
    const legislatureStart = string(legislature.startDate, "Montana legislature start date");
    if (legislatureStart > at) throw new Error("Montana current-session roster mixes future legislature assignments with current seats");
    const body = chamber(row.chamber, "HOUSE", "SENATE", "Montana member");
    const district = object(row.district, "Montana district");
    if (district.name === "Inactive Temp Fix" && district.number === 999) continue;
    if (!Number.isInteger(district.number) || Number(district.number) < 1 || Number(district.number) > (body === "lower" ? 100 : 50)) throw new Error("Montana official district schema changed");
    for (const field of ["startDate", "endDate"]) if (row[field] !== null && (typeof row[field] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row[field]))) throw new Error("Montana official term date schema changed");
    if (typeof row.startDate === "string" && row.startDate > at || typeof row.endDate === "string" && row.endDate < at) continue;
    const nativeId = id(row.id, "Montana member");
    const politicalParty = object(row.politicalParty, "Montana party");
    const name = typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : joinedName(row, ["namePrefix", "firstName", "middleName", "lastName", "nameSuffix"]);
    if (!name || typeof row.firstName !== "string" || typeof row.lastName !== "string") throw new Error("Montana official member name is absent");
    records.push({ name, district: String(district.number), chamber: body, nativeId, sourceUrl: document.url,
      party: typeof politicalParty.code === "string" ? politicalParty.code : null });
  }
  // Never choose a name when the publisher supplies overlapping current holders.
  const counts = new Map<string, number>();
  for (const row of records) counts.set(`${row.chamber}:${row.district}`, (counts.get(`${row.chamber}:${row.district}`) ?? 0) + 1);
  if ([...counts.values()].some(count => count !== 1)) throw new Error("Montana current-session roster has contradictory holders for a seat");
  return result(records, ["lower", "upper"], payload.last === true && payload.totalElements === rows.length);
}

/** Only schemas inspected in the committed current official-source documents. */
export function parseRecoveredLegislature(state: string, document: Document, defaultChamber?: Chamber): Result | null {
  switch (state) {
    case "AL": return /^\s*\{/.test(document.body) ? alabama(document) : null;
    case "SD": return /^\s*\[/.test(document.body) ? southDakota(document) : null;
    case "VT": return /^\s*\{/.test(document.body) ? vermont(document) : null;
    case "WY": return /^\s*\[/.test(document.body) ? wyoming(document, defaultChamber) : null;
    case "MI": return michigan(document, defaultChamber);
    case "RI": return /<GetListItemsResponse\b/.test(document.body) ? rhodeIsland(document) : null;
    case "MT": return /^\s*\{/.test(document.body) ? montana(document) : null;
    default: return null;
  }
}
