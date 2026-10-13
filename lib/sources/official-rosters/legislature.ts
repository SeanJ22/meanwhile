import { createHash } from "node:crypto";
import type { OfficeholderSet, SeatVacancy } from "../../officials/types.ts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { decodeEntities } from "../http.ts";
import { parseAzLegislatureRoster } from "../az-legislature/roster.ts";
import { parseNjLegislatureRoster } from "../nj-legislature/roster.ts";
import { ancestor, first, hasClass, linkUrl, nodes, parseHtml, textOf, type HtmlNode, type StateRosterRecord } from "./html.ts";
import { officialRosterStateFips, type LegislatureChamber, type OfficialRosterTarget } from "./targets.ts";
import { parseResearchedLegislature } from "./researched-states.ts";
import { parseRecoveredLegislature } from "./recovered-states.ts";
import { ALASKA_DIRECTORY_URL, parseAlaskaRoster } from "./alaska.ts";

export interface OfficialRosterDocument { readonly url: string; readonly body: string; readonly retrievedAt?: string }
interface ParsedDocument { records: StateRosterRecord[]; complete: boolean; chambers: LegislatureChamber[]; unmatched?: { officeholderId: string; reason: string }[] }

function invalid(state: string, detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${state} official legislature roster: ${detail}`);
}
function statedDepartureDate(text: string): string | null {
  const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (!match) return null;
  const iso = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}
function statedShortSourceDate(value: string): string | null {
  const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(value);
  if (!match) return null;
  return statedDepartureDate(`${match[1]}/${match[2]}/${match[3]!.length === 2 ? `20${match[3]}` : match[3]}`);
}
function settleExplicitDepartures(records: StateRosterRecord[]): StateRosterRecord[] {
  const currentSeats = new Set(records.filter(record => !record.vacant).map(record => `${record.chamber}:${record.district}`));
  return records.filter(record => !record.vacant || !currentSeats.has(`${record.chamber}:${record.district}`));
}
function recordFromCard(card: HtmlNode, base: string, chamber: LegislatureChamber,
  member: HtmlNode | undefined, district: string | undefined, name?: string): StateRosterRecord {
  const publishedName = (name ?? (member ? textOf(member) : "")).trim();
  if (!publishedName || !district || !member?.attrs.href) invalid(new URL(base).hostname, "a published member lacks its exact name, district or native profile URL");
  const sourceUrl = linkUrl(member, base);
  const party = first(card, node => hasClass(node, "party"));
  return { name: publishedName, district, chamber, sourceUrl, party: party ? textOf(party) : null,
    vacant: /^(?:vacant|vacancy)(?:\s|$)/i.test(publishedName) };
}
function namedAnchor(root: HtmlNode, pattern: RegExp): HtmlNode | undefined {
  return first(root, node => node.tag === "a" && pattern.test(node.attrs.href ?? "") && textOf(node) !== "");
}

/** Header names, row boundaries and profile paths are observed publisher schemas. */
function tableRoster(root: HtmlNode, url: string, chamber: LegislatureChamber, state: string): StateRosterRecord[] {
  const output: StateRosterRecord[] = [];
  for (const table of nodes(root, node => node.tag === "table")) {
    const rows = nodes(table, node => node.tag === "tr");
    const header = rows.find(row => nodes(row, node => node.tag === "th").some(cell => /^(?:district|district number|district\/ home county)$/i.test(textOf(cell))));
    if (!header) continue;
    const labels = nodes(header, node => node.tag === "th").map(textOf);
    const districtIndex = labels.findIndex(label => /^(?:district|district number|district\/ home county)$/i.test(label));
    const nameIndex = labels.findIndex(label => /^(?:name|legislator|member|representative|senator)$/i.test(label));
    const partyIndex = labels.findIndex(label => /^party$/i.test(label));
    if (districtIndex < 0 || nameIndex < 0) continue;
    for (const row of rows) {
      const cells = row.children.filter((node): node is HtmlNode => typeof node !== "string" && node.tag === "td");
      if (cells.length !== labels.length) {
        if (state === "NV" ? hasClass(row, "listRow") : Boolean(namedAnchor(row, /lawmaker\.cfm\?member=/i))) invalid(state, "a member row no longer agrees with its table headers");
        continue;
      }
      const offset = 0;
      const nameCell = cells[nameIndex + offset]!;
      const name = state === "NV" ? nameCell.attrs["data-order"] ?? textOf(nameCell) : textOf(nameCell);
      const districtText = textOf(cells[districtIndex + offset]!);
      const district = (state === "WV" ? /^(\d+)\b/ : /^(?:No\.\s*)?(\d+[A-Za-z]?)$/).exec(districtText)?.[1];
      if (!district || !name) invalid(state, "a roster table row lost its name or district");
      const member = namedAnchor(nameCell, /(?:\/Current\/\d+|lawmaker\.cfm\?member=)/i);
      const vacant = /^(?:vacant|vacancy)(?:\s|$)/i.test(name);
      if (!member && !vacant) invalid(state, "a roster table row lost its publisher profile link");
      output.push({ name, district: district.replace(/^0+(?=\d)/, ""), chamber, sourceUrl: member ? linkUrl(member, url) : url,
        party: partyIndex < 0 ? null : textOf(cells[partyIndex + offset]!), vacant });
    }
  }
  return output;
}

function observedDocument(state: string, document: OfficialRosterDocument, defaultChamber: LegislatureChamber | undefined): ParsedDocument | null {
  const { url, body } = document;
  const root = parseHtml(body);
  let records: StateRosterRecord[] = [];
  let complete = true;
  if (state === "AR") {
    records = nodes(root, node => node.attrs.role === "row" && (hasClass(node, "tableRow") || hasClass(node, "tableRowAlt"))).map(card => {
      const cell = (number: string) => first(card, node => node.attrs["aria-colindex"] === number);
      const member = cell("1") ? namedAnchor(cell("1")!, /\/Legislators\/Detail\?member=/) : undefined;
      const chamberText = cell("2") ? textOf(cell("2")!).replace(/^Chamber:\s*/, "") : "";
      const chamber = chamberText === "House" ? "lower" : chamberText === "Senate" ? "upper" : invalid(state, "a member row has an unknown chamber");
      const district = cell("4") ? /^District:\s*(\d+)$/.exec(textOf(cell("4")!))?.[1] : undefined;
      const record = recordFromCard(card, url, chamber, member, district);
      return /\((?:Resigned|Deceased)\)/i.test(textOf(card)) ? { ...record, name: "Vacant", vacant: true, sourceUrl: url, since: null } : record;
    });
    records = settleExplicitDepartures(records);
  } else if (state === "ND") {
    records = nodes(root, node => hasClass(node, "member-item")).map(card => {
      const member = namedAnchor(card, /\/biography\//);
      const name = first(card, node => hasClass(node, "member-name"));
      const title = first(card, node => hasClass(node, "member-chamber"));
      const district = first(card, node => hasClass(node, "district"));
      const chamber = title && textOf(title) === "Representative" ? "lower" : title && textOf(title) === "Senator" ? "upper" : invalid(state, "a member row has an unknown chamber");
      const districtLabel = /^District\s+(\d+)\s*([AB])?\s*\|/i.exec(district ? textOf(district) : "");
      const record = recordFromCard(card, url, chamber, member, districtLabel ? `${districtLabel[1]}${districtLabel[2] ?? ""}` : undefined, name ? textOf(name) : undefined);
      const status = first(card, node => hasClass(node, "member-status") && /^(?:Resigned|Deceased)\s+/.test(textOf(node)));
      return status ? { ...record, name: "Vacant", vacant: true, sourceUrl: url, since: statedDepartureDate(textOf(status)) } : record;
    });
    // A page of the publisher's paginated roster does not retire omitted people.
    complete = !nodes(root, node => hasClass(node, "pager")).length;
  } else if (state === "OH") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => hasClass(node, "media-container-portrait")).map(card => {
      const member = first(card, node => node.tag === "a" && Boolean(node.attrs.href));
      const name = first(card, node => hasClass(node, "media-overlay-caption-text-line-1"));
      const seat = first(card, node => hasClass(node, "media-overlay-caption-text-line-2"));
      return recordFromCard(card, url, defaultChamber, member, /District (\d+)/.exec(seat ? textOf(seat) : "")?.[1], name ? textOf(name) : undefined);
    });
  } else if (state === "NC") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => hasClass(node, "member-info-col")).map(card => {
      const member = namedAnchor(card, /\/Members\/Biography\/[HS]\/\d+/i);
      const district = first(card, node => node.tag === "a" && /\/DistrictPlanMap\//.test(node.attrs.href ?? ""));
      const record = recordFromCard(card, url, defaultChamber, member, /^District (\d+)$/.exec(district ? textOf(district) : "")?.[1]);
      const departure = /\((?:Resigned|Deceased)\s+([^)]+)\)/i.exec(textOf(card));
      const appointment = /\(Appointed\s+([^)]+)\)/i.exec(textOf(card));
      return departure ? { ...record, name: "Vacant", vacant: true, sourceUrl: url, since: statedShortSourceDate(departure[1]!) }
        : appointment ? { ...record, termStart: statedShortSourceDate(appointment[1]!), sourceUrl: url, nativeId: member ? linkUrl(member, url) : undefined } : record;
    });
    records = settleExplicitDepartures(records);
  } else if (state === "PA") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => node.tag === "a" && /\/(house|senate)\/members\/bio\/\d+\//.test(node.attrs.href ?? "") && hasClass(node, "thumb-info-wrapper")).map(card => {
      const name = first(card, node => hasClass(node, "thumb-info-inner"));
      const seat = first(card, node => hasClass(node, "thumb-info-type"));
      return recordFromCard(card, url, defaultChamber, card, /District (\d+)/.exec(seat ? textOf(seat) : "")?.[1], name ? textOf(name) : undefined);
    });
  } else if (state === "SC") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => hasClass(node, "memberOutline")).map(card => {
      const member = first(card, node => node.tag === "a" && hasClass(node, "membername"));
      const district = first(card, node => hasClass(node, "district"));
      const name = member ? textOf(member).replace(/^(?:Representative|Senator)\s+/, "") : undefined;
      return recordFromCard(card, url, defaultChamber, member, /^District (\d+)$/.exec(district ? textOf(district) : "")?.[1], name);
    });
  } else if (state === "WA") {
    records = nodes(root, node => node.tag === "li" && Boolean(node.attrs["data-chamber"]) && Boolean(node.attrs["data-district"])).map(card => {
      const chamber = card.attrs["data-chamber"] === "House of Representatives" ? "lower" : card.attrs["data-chamber"] === "Senate" ? "upper" : invalid(state, "unknown roster chamber");
      const member = namedAnchor(card, /\/legislators\/member\//);
      return { ...recordFromCard(card, url, chamber, member, card.attrs["data-district"], member ? textOf(member).replace(/^(?:Representative|Senator)\s+/, "") : undefined), nativeId: card.attrs["data-id"], party: card.attrs["data-party"] ?? null };
    });
  } else if (state === "WI") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => node.tag === "div" && /^district\d+$/.test(node.attrs.id ?? "")).map(card => {
      const name = first(card, node => node.tag === "strong" && Boolean(first(node, child => child.tag === "a")));
      const member = name ? first(name, node => node.tag === "a") : undefined;
      return recordFromCard(card, url, defaultChamber, member, /^district(\d+)$/.exec(card.attrs.id ?? "")?.[1]);
    });
  } else if (state === "NY" && defaultChamber === "lower") {
    records = nodes(root, node => node.tag === "section" && hasClass(node, "mem-item")).map(card => {
      const heading = first(card, node => hasClass(node, "mem-name"));
      const member = heading ? namedAnchor(heading, /\/mem\//) : undefined;
      const name = member ? textOf(member).replace(/\s+District \d+$/, "") : undefined;
      const district = member ? /District (\d+)$/.exec(textOf(member))?.[1] : undefined;
      return recordFromCard(card, url, "lower", member, district, name);
    });
  } else if (state === "NY" && defaultChamber === "upper") {
    records = nodes(root, node => hasClass(node, "c-senator-block")).map(card => {
      const member = ancestor(card, node => node.tag === "a" && /\/senators\//.test(node.attrs.href ?? ""));
      const name = first(card, node => hasClass(node, "nys-senator--name"));
      const district = /(\d+)(?:st|nd|rd|th) District/.exec(textOf(card))?.[1];
      return recordFromCard(card, url, "upper", member, district, name ? textOf(name) : undefined);
    });
  } else if (state === "NE") {
    records = nodes(root, node => hasClass(node, "sen-list-item")).map(card => {
      const member = namedAnchor(card, /\/senators\/landing-pages\/index\.php\?District=\d+/);
      const district = member ? new URL(linkUrl(member, url)).searchParams.get("District") ?? undefined : undefined;
      const name = member ? first(member, node => hasClass(node, "col-9")) : undefined;
      return recordFromCard(card, url, "upper", member, district, name ? textOf(name) : undefined);
    });
  } else if (state === "NV" || state === "WV") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = tableRoster(root, url, defaultChamber, state);
  } else if (state === "TX" && defaultChamber === "upper") {
    records = nodes(root, node => hasClass(node, "mempicdiv")).map(card => {
      const member = namedAnchor(card, /member\.php\?d=\d+/);
      return recordFromCard(card, url, "upper", member, /District (\d+)/.exec(textOf(card))?.[1]);
    });
  } else if (state === "TX" && defaultChamber === "lower") {
    const component = first(root, node => node.tag === "get-members");
    let data: unknown;
    try { data = JSON.parse(component?.attrs[":members"] ?? ""); } catch { invalid(state, "the native get-members roster is absent or malformed"); }
    if (!Array.isArray(data)) invalid(state, "the native get-members roster is not an array");
    records = data.map((row: Record<string, unknown>) => {
      if (typeof row.member_name !== "string" || !Number.isInteger(row.id) || typeof row.link !== "string" || !Number.isInteger(row.member_bill_code) || ![0, 1].includes(Number(row.active))) invalid(state, "the native member record schema changed");
      return { name: decodeEntities(row.member_name), district: String(row.id), sourceUrl: row.link, nativeId: String(row.member_bill_code), chamber: "lower", vacant: row.active === 0 && /^District \d+$/.test(row.member_name) };
    });
  } else if (state === "OK" && defaultChamber === "lower") {
    const script = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(body);
    let data: { page?: string; isFallback?: boolean; props?: { pageProps?: { members?: Record<string, unknown> } } };
    try { data = JSON.parse(script?.[1] ?? ""); } catch { invalid(state, "the native Next roster payload is absent"); }
    const members = data.props?.pageProps?.members;
    if (data.page !== "/representatives" || data.isFallback !== false) invalid(state, "the native page payload does not identify the current representatives roster");
    const rows = members?.legislatureMembers;
    if (!Array.isArray(rows)) invalid(state, "the native members collection is absent");
    records = rows.map(value => {
      const row = value as { id?: unknown; attributes?: { slug?: unknown; firstName?: unknown; lastName?: unknown; suffix?: unknown; district?: { data?: { attributes?: { number?: unknown } } }; party?: { data?: { attributes?: { name?: unknown } } } } };
      const member = row.attributes;
      const district = member?.district?.data?.attributes?.number;
      if (typeof row.id !== "string" || typeof member?.slug !== "string" || typeof member.firstName !== "string" || typeof member.lastName !== "string" || !Number.isInteger(district)) invalid(state, "the native member identity or district is absent");
      return { name: [member.firstName, member.lastName, member.suffix].filter(value => typeof value === "string" && value).join(" "), nativeId: row.id,
        district: String(district), chamber: "lower", sourceUrl: new URL(`/representatives/${member.slug}`, url).href,
        party: typeof member.party?.data?.attributes?.name === "string" ? member.party.data.attributes.name : null };
    });
  } else if (state === "VA" && defaultChamber === "lower") {
    records = nodes(root, node => node.tag === "a" && /^\/members\/H\d+$/.test(node.attrs.href ?? "") && textOf(node) !== "").map(member => {
      const card = ancestor(member, node => node.tag === "article") ?? ancestor(member, node => Boolean(/District:\s+\d+/.exec(textOf(node))));
      if (!card) invalid(state, "the native member card is absent");
      return recordFromCard(card, url, "lower", member, /District:\s+(\d+)\b/.exec(textOf(card))?.[1]);
    });
  } else if (state === "VA" && defaultChamber === "upper") {
    records = nodes(root, node => hasClass(node, "senator-card")).map(card => {
      const title = first(card, node => hasClass(node, "card-title"));
      const member = title ? namedAnchor(title, /\/Senator\/memberpage\.php\?id=/i) : undefined;
      const district = first(card, node => hasClass(node, "senator-chip"));
      return recordFromCard(card, url, "upper", member, /^District (\d+)$/.exec(district ? textOf(district) : "")?.[1]);
    });
  } else if (state === "NM") {
    if (!defaultChamber) invalid(state, "source chamber is absent");
    records = nodes(root, node => node.tag === "a" && /Legislator\?SponCode=[HS]/.test(node.attrs.href ?? "") && hasClass(node, "thumbnail")).map(member => {
      const name = first(member, node => /_lblName_\d+$/.test(node.attrs.id ?? ""));
      const district = first(member, node => /_lblDistrict_\d+$/.test(node.attrs.id ?? ""));
      return recordFromCard(member, url, defaultChamber, member, /^District:\s*(\d+)$/.exec(district ? textOf(district) : "")?.[1], name ? textOf(name).replace(/\s*-\s*\([DRI]\)\s*$/, "") : undefined);
    });
  } else return null;
  const chambers = [...new Set(records.map(record => record.chamber))];
  if (!body.trimStart().startsWith("{") && !body.trimStart().startsWith("[")) {
    if (!/<\/html\s*>\s*$/i.test(body)) invalid(state, "the current source document is truncated");
    const headings = nodes(root, node => /^h[1-3]$/.test(node.tag)).map(textOf).join(" ");
    if (state !== "OK" && !/(?:legislator|member|senator|representative|delegate|house|senate|assembly)/i.test(headings)) invalid(state, "the current source roster heading is absent");
  }
  return { records, complete, chambers };
}

/** A partial chamber adds verified facts while its failed sibling stays open. */
export function parseLegislatureRoster(target: OfficialRosterTarget, documents: readonly OfficialRosterDocument[], retrievedAt: string): OfficeholderSet {
  const state = target.state;
  if (!state || target.kind !== "legislature") invalid(state ?? "unknown", "target is not a state legislature");
  const vacancies: SeatVacancy[] = [];
  const roster: OfficeholderSet = { scope: officialRosterStateFips(state), generatedAt: retrievedAt, officeholders: [], divisions: [], unmatched: [], vacancies, coveredChambers: [] };
  const covered = new Set<LegislatureChamber>();
  const ids = new Set<string>();
  const ndDepartures: StateRosterRecord[] = [];
  const parsingDocuments = state === "AK" ? [documents.find(document => document.url === ALASKA_DIRECTORY_URL) ?? documents[0]!].filter(Boolean) : documents;
  for (const document of parsingDocuments) {
    const at = document.retrievedAt ?? retrievedAt;
    if (!Number.isFinite(Date.parse(at)) || !document.body.trim()) invalid(state, "source document or retrieval instant is empty");
    const route = target.legislatureRoutes?.find(route => route.url === document.url);
    if (!route) invalid(state, "document is not an acquired target route");
    if (state === "AZ" || state === "NJ") {
      const az = state === "AZ" ? parseAzLegislatureRoster(document.body, at) : null;
      const parsed = az?.roster ?? parseNjLegislatureRoster(document.body, at).roster;
      roster.officeholders.push(...parsed.officeholders); roster.divisions.push(...parsed.divisions); roster.unmatched.push(...parsed.unmatched);
      const activeCounts = new Map<string, number>();
      for (const holder of parsed.officeholders) for (const membership of holder.memberships ?? []) activeCounts.set(`${membership.chamber}:${membership.district}`, (activeCounts.get(`${membership.chamber}:${membership.district}`) ?? 0) + 1);
      if (az) {
        const departed = new Map<string, (typeof az.excludedRecords)[number]>();
        for (const row of az.excludedRecords) departed.set(`${row.chamber}:${row.district}`, row);
        for (const [seat, row] of departed) {
          const capacity = row.chamber === "lower" ? 2 : 1;
          if ((activeCounts.get(seat) ?? 0) >= capacity) continue;
          const officeTitle = row.chamber === "lower" ? "State Representative" : "State Senator";
          vacancies.push({ id: `${target.jurisdiction}:${row.chamber}:${row.district}`, divisionId: `ocd-division/country:us/state:az/sld${row.chamber === "lower" ? "l" : "u"}:${row.district}`,
            officeTitle, state, chamber: row.chamber, since: statedDepartureDate(row.disposition), provenance: { sourceUrl: document.url, sourceOrg: target.publisher, collectedAt: at, verifiedAt: at } });
        }
      } else {
        const script = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(document.body);
        const source = JSON.parse(script![1]!) as { props: { pageProps: { legrosterData: [Record<string, unknown>[]] } } };
        for (const row of source.props.pageProps.legrosterData[0]) {
          if (row.VacantSort === 0) continue;
          const chamber = row.RosterHouseCode === "S" ? "upper" : row.RosterHouseCode === "A" ? "lower" : invalid(state, "a vacancy lacks its exact source chamber");
          const district = row.Roster_District;
          if (!Number.isInteger(district) || Number(district) < 1 || Number(district) > 40) invalid(state, "a vacancy lacks its exact source district");
          vacancies.push({ id: `${target.jurisdiction}:${chamber}:${district}`, divisionId: `ocd-division/country:us/state:nj/sld${chamber === "lower" ? "l" : "u"}:${district}`,
            officeTitle: chamber === "lower" ? "State Representative" : "State Senator", state, chamber, since: null,
            provenance: { sourceUrl: document.url, sourceOrg: target.publisher, collectedAt: at, verifiedAt: at } });
        }
      }
      const districts = state === "AZ" ? 30 : 40;
      for (const chamber of target.chambers ?? []) {
        const capacity = chamber === "lower" ? 2 : 1;
        if (Array.from({ length: districts }, (_, index) => index + 1).every(district =>
          (activeCounts.get(`${chamber}:${district}`) ?? 0) + vacancies.filter(vacancy => vacancy.id === `${target.jurisdiction}:${chamber}:${district}`).length === capacity)) covered.add(chamber);
      }
      continue;
    }
    const chamber = route.chamber === "both" ? undefined : route.chamber;
    const parsed: ParsedDocument | null = state === "AK" ? parseAlaskaRoster(documents, retrievedAt)
      : observedDocument(state, document, chamber) ?? parseResearchedLegislature(state, document, chamber) ?? parseRecoveredLegislature(state, document, chamber);
    if (!parsed || parsed.records.length === 0) invalid(state, "no source-enumerated member records were available; the source remains acquisition work");
    if (parsed.unmatched) roster.unmatched.push(...parsed.unmatched);
    for (const row of parsed.records) {
      if (!row.district || !row.sourceUrl || !row.name) invalid(state, "a source record lacks the seat, holder or source required for publication");
      const districtCode = /^\d+[A-Za-z]?$/.test(row.district) ? row.district.replace(/^0+(?=\d)/, "").toLowerCase() : null;
      const officeId = `${target.jurisdiction}:${row.chamber}:${districtCode ? districtCode.toUpperCase() : row.district}${row.seat ?? ""}`;
      const divisionId = row.divisionId ?? (districtCode ? `ocd-division/country:us/state:${state.toLowerCase()}/sld${row.chamber === "lower" ? "l" : "u"}:${districtCode}` : null);
      const rowAt = state === "AK" ? documents.find(document => document.url === row.sourceUrl)?.retrievedAt ?? at : at;
      const provenance = { sourceUrl: row.sourceUrl, sourceOrg: target.publisher, collectedAt: rowAt, verifiedAt: rowAt };
      const officeTitle = row.chamber === "lower" ? "State Representative" : "State Senator";
      if (row.vacant) {
        if (state === "ND") { ndDepartures.push(row); continue; }
        vacancies.push({ id: officeId, divisionId: divisionId ?? "", district: row.district, officeTitle, state, chamber: row.chamber, since: row.since ?? null, provenance });
        if (!divisionId) roster.unmatched.push({ officeholderId: officeId, reason: `The official source reports a vacancy in ${row.district}; its Census division is not mapped yet.` });
        continue;
      }
      const nativeId = row.nativeId ?? row.sourceUrl;
      const seatBound = row.seatBound ?? (row.sourceUrl === document.url && !row.nativeId || /(?:\/senators\/landing-pages\/index\.php\?District=|\/App\/Legislator\/A\/(?:Assembly|Senate)\/Current\/\d+|senate\.texas\.gov\/member\.php\?d=)/i.test(row.sourceUrl));
      const id = seatBound ? `official-roster-record:${state.toLowerCase()}:${createHash("sha256").update(JSON.stringify([row.sourceUrl, row.name, officeId])).digest("hex")}` : `official-legislature-${state.toLowerCase()}:${nativeId}`;
      if (ids.has(`${id}:${officeId}`)) continue;
      ids.add(`${id}:${officeId}`);
      const membershipId = `${id}:${officeId}`;
      roster.officeholders.push({ id, ...(seatBound ? {} : { personId: id, nativeIds: { [`official-legislature-${state.toLowerCase()}`]: [nativeId], "official-person-profile": [row.sourceUrl] } }), name: row.name,
        memberships: [{ id: membershipId, personId: id, officeId, jurisdiction: target.jurisdiction, chamber: row.chamber, district: row.district,
          officeTitle, level: "STATE", current: true, termStart: row.termStart ?? null, ...(divisionId ? { divisionId } : {}), sourceUrl: row.sourceUrl }],
        officeTitle, level: "STATE", termStart: row.termStart ?? "", termEnd: "", birthDate: null, partyLabel: row.party ?? null, websiteUrl: row.sourceUrl,
        profileUrls: [row.sourceUrl], contactFormUrl: null, phone: null, email: null, campaignUrl: null, photo: null, state, chamber: row.chamber, provenance });
      if (divisionId) roster.divisions.push({ officeholderId: id, membershipId, ocdId: divisionId, bodyId: null });
      else roster.unmatched.push({ officeholderId: id, reason: `The official source names district ${row.district}; its Census division is not mapped yet.` });
    }
    if (parsed.complete) for (const chamber of parsed.chambers) covered.add(chamber);
  }
  if (state === "ND") {
    const acquired = new Set(documents.map(document => document.url));
    const firstDocument = documents.find(document => new URL(document.url).searchParams.get("page") === null);
    const pageNumbers = firstDocument ? [...firstDocument.body.matchAll(/href=["']\?page=(\d+)["']/g)].map(match => Number(match[1])) : [];
    const lastPage = Math.max(0, ...pageNumbers);
    const allPages = !!firstDocument && Array.from({ length: lastPage + 1 }, (_, page) => page === 0 ? firstDocument.url : `${firstDocument.url}?page=${page}`).every(url => acquired.has(url));
    if (allPages) {
      for (const row of ndDepartures) {
        const officeId = `${target.jurisdiction}:${row.chamber}:${row.district.toUpperCase()}`;
        const capacity = row.chamber === "upper" || /[AB]$/i.test(row.district) ? 1 : 2;
        const current = roster.officeholders.filter(holder => holder.memberships?.some(membership => membership.officeId === officeId)).length;
        if (current >= capacity || vacancies.filter(vacancy => vacancy.id === officeId).length >= capacity - current) continue;
        vacancies.push({ id: officeId, divisionId: `ocd-division/country:us/state:nd/sld${row.chamber === "lower" ? "l" : "u"}:${row.district.toLowerCase()}`,
          officeTitle: row.chamber === "lower" ? "State Representative" : "State Senator", state, chamber: row.chamber, since: row.since ?? null,
          provenance: { sourceUrl: row.sourceUrl, sourceOrg: target.publisher, collectedAt: retrievedAt, verifiedAt: retrievedAt } });
      }
      covered.add("lower"); covered.add("upper");
    }
  }
  roster.coveredChambers = [...covered];
  roster.currentMembershipComplete = (target.chambers ?? []).every(chamber => covered.has(chamber));
  return roster;
}
