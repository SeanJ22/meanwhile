import { createHash } from "node:crypto";
import { parquetMetadataAsync, parquetRead, type AsyncBuffer, type ColumnData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { Officeholder } from "../../officials/types.ts";
import type { ExecutiveText } from "../../officials/national-executive.ts";
import { parseExecutiveProfile } from "./profile.ts";
import { publicFederalUrl } from "../congress/acquire.ts";
import { statewidePageText } from "../statewide/parse.ts";

export interface CabinetPage { readonly url: string; readonly body: string; readonly retrievedAt: string; readonly request?: CabinetReadRequest }
export interface CabinetReadRequest { readonly method: "POST"; readonly body: Readonly<Record<string, unknown>> }
export type CabinetReader = (url: string, request?: CabinetReadRequest) => Promise<CabinetPage>;
interface Citation { readonly sourceUrl: string; readonly collectedAt: string; readonly checkedAt?: string }
export interface CabinetDepartment {
  readonly name: string;
  readonly spendingNames: readonly string[];
  readonly registerSlug: string;
  readonly opmNames: readonly string[];
  readonly senateConfirmed: boolean;
}
export interface DepartmentBudget extends Citation {
  readonly amount: number; readonly fiscalYear: number; readonly label: "Budgetary resources"; readonly scope: "DEPARTMENT" | "ACCOUNT";
  readonly accountNumber?: string; readonly accountName?: string;
}
export interface DepartmentHeadcount extends Citation {
  readonly count: number; readonly asOf: string; readonly label: "OPM-covered civilian employees";
  readonly rawSourceRefs?: readonly OpmRangeReference[]; readonly coverageSource?: OpmCoverage;
}
export interface DepartmentAction extends Citation {
  readonly id: string; readonly title: string; readonly date: string; readonly kind: string; readonly documentUrl: string | null;
  readonly evidenceSourceUrl: string;
}
export interface CabinetConfirmation extends Citation {
  readonly date: string; readonly yeas: number | null; readonly nays: number | null; readonly method: string; readonly quote: string;
  readonly evidenceSourceUrl: string;
  readonly aliasSources?: readonly CommitteeNomineeAlias[];
}
export interface CommitteeNomineeAlias extends Citation { readonly publishedName: string; readonly nominationName: string; readonly quote: string }
export interface CabinetRecords {
  readonly department?: Citation & { readonly name: string; readonly budget?: DepartmentBudget; readonly budgets?: readonly DepartmentBudget[]; readonly budgetNote?: ExecutiveText;
    readonly headcount?: DepartmentHeadcount; readonly headcountNote?: ExecutiveText; readonly actions: readonly DepartmentAction[] };
  readonly confirmation?: CabinetConfirmation;
  readonly priorOffices: readonly ExecutiveText[];
  readonly sources: readonly Citation[];
  readonly gaps: readonly string[];
  readonly coverage: Readonly<Record<string, boolean>>;
}
const key = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const department = (name: string, registerSlug: string, aliases: readonly string[] = []): CabinetDepartment => ({
  name, registerSlug, spendingNames: [name, ...aliases], opmNames: [name, ...aliases], senateConfirmed: true,
});
const DEPARTMENTS: Readonly<Record<string, CabinetDepartment>> = {
  "secretary of state": department("Department of State", "state-department"),
  "secretary of the treasury": department("Department of the Treasury", "treasury-department"),
  "secretary of defense": department("Department of Defense", "defense-department", ["Department of War"]),
  "secretary of war": department("Department of Defense", "defense-department", ["Department of War"]),
  "attorney general": department("Department of Justice", "justice-department"),
  "secretary of the interior": department("Department of the Interior", "interior-department"),
  "secretary of agriculture": department("Department of Agriculture", "agriculture-department"),
  "secretary of commerce": department("Department of Commerce", "commerce-department"),
  "secretary of labor": department("Department of Labor", "labor-department"),
  "secretary of health and human services": department("Department of Health and Human Services", "health-and-human-services-department"),
  "secretary of housing and urban development": department("Department of Housing and Urban Development", "housing-and-urban-development-department"),
  "secretary of transportation": department("Department of Transportation", "transportation-department"),
  "secretary of energy": department("Department of Energy", "energy-department"),
  "secretary of education": department("Department of Education", "education-department"),
  "secretary of veterans affairs": department("Department of Veterans Affairs", "veterans-affairs-department"),
  "secretary of homeland security": department("Department of Homeland Security", "homeland-security-department"),
  "administrator of the environmental protection agency": department("Environmental Protection Agency", "environmental-protection-agency"),
  "administrator of the small business administration": department("Small Business Administration", "small-business-administration"),
  "director of the office of management and budget": department("Office of Management and Budget", "management-and-budget-office"),
  "united states trade representative": department("Office of the United States Trade Representative", "trade-representative-office-of-united-states", ["Office of the U.S. Trade Representative"]),
  "director of national intelligence": department("Office of the Director of National Intelligence", "national-intelligence-office-of-the-director"),
  "director of the central intelligence agency": department("Central Intelligence Agency", "central-intelligence-agency"),
};
/** Office identity chooses the agency; a holder's name never chooses someone else's department. */
export const cabinetDepartment = (officeTitle: string): CabinetDepartment | null => DEPARTMENTS[key(officeTitle)] ?? null;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown): string => typeof v === "string" ? v : "";
const parsed = (page: CabinetPage) => object(JSON.parse(page.body));
const cite = (page: CabinetPage): Citation => ({ sourceUrl: page.url, collectedAt: page.retrievedAt });
function source(page: CabinetPage, host: string, path?: RegExp): URL {
  const url = new URL(page.url);
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || path && !path.test(url.pathname) || !Number.isFinite(Date.parse(page.retrievedAt))) throw new Error("CABINET_SOURCE_IDENTITY_INVALID");
  return url;
}
function iso(value: unknown): string {
  const v = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new Error("CABINET_SOURCE_DATE_INVALID");
  return v;
}

export const USA_AGENCIES_URL = "https://api.usaspending.gov/api/v2/references/toptier_agencies/";
export const CIA_FAQ_URL = "https://www.cia.gov/faqs/";
/** CIA explicitly withholds both figures; absence from another publisher alone cannot establish this. */
export function ciaResourcesDisclosure(page: CabinetPage): ExecutiveText {
  source(page, "www.cia.gov", /^\/faqs\/?$/);
  const body = statewidePageText(page.body);
  const question = "How many people work for CIA and what is its budget?";
  const quote = "Neither the number of employees nor the size of the Agency's budget can, at present, be publicly disclosed.";
  const at = body.indexOf(question);
  if (at < 0 || !body.slice(at, at + 1000).includes(quote)) throw new Error("CIA_RESOURCES_DISCLOSURE_UNVERIFIED");
  return { text: quote, ...cite(page) };
}
export function spendingAgency(page: CabinetPage, own: CabinetDepartment): { code: string; name: string } | null {
  source(page, "api.usaspending.gov", /^\/api\/v2\/references\/toptier_agencies\/$/);
  const root = parsed(page);
  if (!Array.isArray(root.results)) throw new Error("CABINET_SPENDING_AGENCY_LIST_INVALID");
  const names = new Set(own.spendingNames.map(key));
  const matches = list(root.results).filter(row => names.has(key(text(row.agency_name))));
  if (matches.length > 1) throw new Error("CABINET_SPENDING_AGENCY_AMBIGUOUS");
  if (!matches.length) return null;
  const code = text(matches[0].toptier_code);
  if (!/^\d{3,4}$/.test(code)) throw new Error("CABINET_SPENDING_AGENCY_CODE_INVALID");
  return { code, name: text(matches[0].agency_name) };
}
/** Agency resources are not whole-government resources, obligations, outlays, or a proposed appropriation. */
export function departmentBudget(page: CabinetPage, toptierCode: string): DepartmentBudget | null {
  source(page, "api.usaspending.gov", new RegExp(`^/api/v2/agency/${toptierCode}/budgetary_resources/$`));
  const root = parsed(page);
  if (root.toptier_code !== toptierCode || !Array.isArray(root.agency_data_by_year)) throw new Error("CABINET_BUDGET_AGENCY_MISMATCH");
  const rows = list(root.agency_data_by_year).filter(row => Number.isInteger(row.fiscal_year) && typeof row.agency_budgetary_resources === "number" && Number.isFinite(row.agency_budgetary_resources) && row.agency_budgetary_resources >= 0)
    .sort((a, b) => Number(b.fiscal_year) - Number(a.fiscal_year));
  const row = rows[0];
  return row ? { amount: row.agency_budgetary_resources as number, fiscalYear: row.fiscal_year as number, label: "Budgetary resources", scope: "DEPARTMENT", ...cite(page) } : null;
}

export const USA_FEDERAL_ACCOUNTS_URL = "https://api.usaspending.gov/api/v2/federal_accounts/";
/** These are separately filed account resources. Transfers and trust funds never become an invented office-wide total. */
export function executiveOfficeAccountBudgets(page: CabinetPage, own: CabinetDepartment, fiscalYear: number): DepartmentBudget[] {
  source(page, "api.usaspending.gov", /^\/api\/v2\/federal_accounts\/$/);
  const root = parsed(page);
  if (String(root.fy) !== String(fiscalYear) || !Array.isArray(root.results)) throw new Error("EXECUTIVE_OFFICE_ACCOUNTS_YEAR_INVALID");
  if (page.request && (page.request.method !== "POST" || String(object(page.request.body.filters).fy) !== String(fiscalYear) ||
    String(object(page.request.body.filters).agency_identifier) !== "1100")) throw new Error("EXECUTIVE_OFFICE_ACCOUNTS_REQUEST_MISMATCH");
  const names = own.spendingNames.map(key);
  return list(root.results).filter(row => key(text(row.managing_agency)) === "executive office of the president" &&
    names.some(name => key(text(row.account_name)).includes(name)) && row.budgetary_resources !== null).map(row => {
    if (!/^011-\d{4}$/.test(text(row.account_number)) || typeof row.budgetary_resources !== "number" || !Number.isFinite(row.budgetary_resources) || row.budgetary_resources < 0) throw new Error("EXECUTIVE_OFFICE_ACCOUNT_RESOURCES_INVALID");
    return { amount: row.budgetary_resources as number, fiscalYear, label: "Budgetary resources", scope: "ACCOUNT",
      accountNumber: text(row.account_number), accountName: text(row.account_name), ...cite(page) };
  });
}

/** The result keeps department actions separate from actions personally signed by the Secretary. */
export function departmentRegisterActions(page: CabinetPage, own: CabinetDepartment, from?: string): DepartmentAction[] {
  const url = source(page, "www.federalregister.gov", /^\/api\/v1\/documents(?:\.json)?$/);
  if (!url.searchParams.getAll("conditions[agencies][]").includes(own.registerSlug)) throw new Error("CABINET_REGISTER_QUERY_AGENCY_MISMATCH");
  const root = parsed(page);
  if (!Array.isArray(root.results)) throw new Error("CABINET_REGISTER_RESULTS_INVALID");
  return list(root.results).map(row => {
    if (!list(row.agencies).some(agency => agency.slug === own.registerSlug || text(agency.url).endsWith(`/agencies/${own.registerSlug}`))) throw new Error("CABINET_REGISTER_ROW_AGENCY_MISMATCH");
    const date = iso(row.publication_date), id = text(row.document_number), title = text(row.title), url = text(row.html_url);
    if (!/^\d{4}-\d+$/.test(id) || !title || new URL(url).hostname !== "www.federalregister.gov") throw new Error("CABINET_REGISTER_ROW_INVALID");
    return { id: `federal-register:${id}`, title, date, kind: text(row.type), documentUrl: text(row.pdf_url) || null,
      sourceUrl: url, evidenceSourceUrl: page.url, collectedAt: page.retrievedAt };
  }).filter(row => !from || row.date >= from);
}

/** A Congress nomination must explicitly bind this person to this office before its final confirmation is read. */
export const SENATE_INTELLIGENCE_URL = "https://www.intelligence.senate.gov/";
const unsuffixedName = (value: string): string => key(value).replace(/\s+(?:jr|sr|ii|iii|iv|v)$/, "");
/** A quoted nickname in a hearing's own office-bound heading is evidence, rather than a guessed name equivalence. */
export function committeeNomineeAliases(page: CabinetPage, person: Pick<Officeholder, "name" | "officeTitle">): CommitteeNomineeAlias[] {
  source(page, "www.intelligence.senate.gov");
  const aliases: CommitteeNomineeAlias[] = [];
  for (const heading of page.body.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const quote = statewidePageText(heading[2]);
    const nomination = /\bNomination(?: for| of)?(?: the)?(?: Honorable)?\s+(.+?)\s+to be\s+(.+?)\.?$/i.exec(quote);
    if (!nomination || key(nomination[2]) !== key(person.officeTitle)) continue;
    const named = /^(.+?)\s+[“"‘']([^”"’']+)[”"’']\s+(.+)$/.exec(nomination[1]);
    if (!named || unsuffixedName(`${named[2]} ${named[3]}`) !== unsuffixedName(person.name)) continue;
    aliases.push({ publishedName: person.name, nominationName: `${named[1]} ${named[3]}`, quote, ...cite(page) });
  }
  return [...new Map(aliases.map(alias => [unsuffixedName(alias.nominationName), alias])).values()];
}
export function cabinetConfirmation(page: CabinetPage, person: Pick<Officeholder, "name" | "officeTitle">, actionsPage?: CabinetPage,
  aliasPages: readonly CabinetPage[] = []): CabinetConfirmation | null {
  const url = source(page, "api.congress.gov", /^\/v3\/nomination\/\d+\/[\d-]+\/?$/);
  const root = parsed(page), row = object(root.nomination), description = key(text(row.description));
  const aliases = person.officeTitle === "Secretary of War" ? ["Secretary of War", "Secretary of Defense"] : [person.officeTitle];
  const titles = list(row.nominees).map(nominee => key(text(nominee.positionTitle))).filter(Boolean);
  // The department's deputy is a different office even when its name contains the Cabinet title.
  const namedOffice = /\bto be (.+)/.exec(description)?.[1] ?? "";
  const officeMatches = aliases.some(title => titles.length ? titles.includes(key(title))
    : namedOffice === key(title) || [" vice ", " for ", " with "].some(suffix => namedOffice.startsWith(`${key(title)}${suffix}`)));
  const aliasSources = aliasPages.flatMap(aliasPage => committeeNomineeAliases(aliasPage, person));
  if (new Set(aliasSources.map(alias => unsuffixedName(alias.nominationName))).size > 1) throw new Error("CABINET_NOMINEE_ALIAS_AMBIGUOUS");
  const directName = description.includes(key(person.name));
  const matchingAliases = aliasSources.filter(alias => description.includes(unsuffixedName(alias.nominationName)));
  if ((!directName && !matchingAliases.length) || !officeMatches) throw new Error("CABINET_NOMINATION_PERSON_OFFICE_MISMATCH");
  const identity = /^\/v3\/nomination\/(\d+)\/([\d-]+)/.exec(url.pathname)!;
  if (Number(row.congress) !== Number(identity[1]) || String(row.number) !== identity[2].split("-")[0] ||
    row.partNumber !== undefined && Number(row.partNumber) !== Number(identity[2].split("-")[1] ?? 0)) throw new Error("CABINET_NOMINATION_ID_MISMATCH");
  let actions = [object(row.latestAction)];
  if (actionsPage) {
    source(actionsPage, "api.congress.gov", new RegExp(`^/v3/nomination/${identity[1]}/${identity[2]}/actions/?$`));
    const actionsRoot = parsed(actionsPage);
    if (!Array.isArray(actionsRoot.actions)) throw new Error("CABINET_NOMINATION_ACTIONS_INVALID");
    const request = object(actionsRoot.request);
    if (String(request.congress) !== identity[1] || String(request.number) !== identity[2]) throw new Error("CABINET_NOMINATION_ACTIONS_ID_MISMATCH");
    actions = [...list(actionsRoot.actions), ...actions];
  }
  const confirmed = actions.filter(action => /^Confirmed by the Senate\b/i.test(text(action.text))).sort((a, b) => text(b.actionDate).localeCompare(text(a.actionDate)))[0];
  if (!confirmed) return null;
  const quote = text(confirmed.text), tally = /(?:Yea[\s-]*Nay(?: Vote)?[\s.:]*)?(\d+)\s*-\s*(\d+)/i.exec(quote);
  const method = /voice vote/i.test(quote) ? "Voice vote" : /unanimous consent/i.test(quote) ? "Unanimous consent" : tally ? "Recorded vote" : "Confirmation recorded; tally not yet acquired";
  return { date: iso(confirmed.actionDate), yeas: tally ? Number(tally[1]) : null, nays: tally ? Number(tally[2]) : null, method, quote,
    ...(!directName && matchingAliases.length ? { aliasSources: matchingAliases } : {}),
    sourceUrl: `https://www.congress.gov/nomination/${identity[1]}th-congress/${identity[2]}`, evidenceSourceUrl: actionsPage?.url ?? page.url, collectedAt: actionsPage?.retrievedAt ?? page.retrievedAt };
}

export const OPM_EMPLOYMENT_URL = "https://data.opm.gov/api/v1/files/employment?current=true";
export const OPM_COVERAGE_URL = "https://data.opm.gov/resources/data-sources";
export interface OpmCoverage extends Citation { readonly quote: string; readonly exclusions: readonly string[] }
/** The publisher states these exclusions; a missing agency row alone never establishes non-publication. */
export function opmEmploymentCoverage(page: CabinetPage): OpmCoverage {
  source(page, "data.opm.gov", /^\/resources\/data-sources\/?$/);
  const body = statewidePageText(page.body), first = body.indexOf("EHRI covers all federal civilian employees of the Executive branch, except for the following:");
  const end = first < 0 ? -1 : body.indexOf("Legislative branch", first);
  if (first < 0 || end < 0) throw new Error("OPM_EMPLOYMENT_COVERAGE_UNREAD");
  const quote = body.slice(first, end).trim();
  const exclusions = ["Central Intelligence Agency", "Office of the Director of National Intelligence", "Foreign service personnel at the Department of State"]
    .filter(name => quote.includes(name));
  if (exclusions.length !== 3) throw new Error("OPM_EMPLOYMENT_EXCLUSIONS_UNREAD");
  return { ...cite(page), quote, exclusions };
}
export interface OpmRelease extends Citation { readonly snapshot: string; readonly version: number; readonly url: string }
export function currentOpmRelease(page: CabinetPage): OpmRelease {
  source(page, "data.opm.gov", /^\/api\/v1\/files\/employment\/?$/);
  const root: unknown = JSON.parse(page.body);
  if (!Array.isArray(root)) throw new Error("OPM_FILE_LIST_INVALID");
  const files = list(root).filter(row => row.current === true && /^\d{4}$/.test(text(row.year)) && /^(?:0[1-9]|1[0-2])$/.test(text(row.month)) && Number.isInteger(row.version) && Number(row.version) > 0)
    .sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`) || Number(b.version) - Number(a.version));
  if (!files.length) throw new Error("OPM_CURRENT_EMPLOYMENT_FILE_MISSING");
  const row = files[0], snapshot = `${row.year}-${row.month}`, version = Number(row.version);
  return { snapshot, version, url: `https://data.opm.gov/api/v1/files/employment/${row.year}/${row.month}/${version}/download`, ...cite(page) };
}
export interface OpmRange { readonly start: number; readonly end: number; readonly bytes: Uint8Array; readonly sha256: string }
export interface OpmRangeReference extends Citation { readonly start: number; readonly end: number; readonly byteLength: number; readonly sha256: string }
export interface OpmHeadcountSnapshot extends Citation {
  readonly snapshot: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly rawSourceRefs?: readonly OpmRangeReference[];
  readonly coverage?: OpmCoverage;
  readonly coverageGap?: string;
}
/** Read only OPM's agency, department and count columns; never transpose the country's employee records into objects. */
export async function opmHeadcountsFromParquet(file: AsyncBuffer, release: OpmRelease): Promise<OpmHeadcountSnapshot> {
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: 16 * 1024 });
  const columns = ["department", "agency", "count"];
  if (!columns.every(name => metadata.schema.some(s => s.name === name))) throw new Error("OPM_REQUIRED_COLUMNS_MISSING");
  const counts: Record<string, number> = {};
  for (const group of metadata.row_groups) {
    // Restrict each read to one source row group. The aggregate persists; employee arrays do not.
    const start = metadata.row_groups.slice(0, metadata.row_groups.indexOf(group)).reduce((n, row) => n + Number(row.num_rows), 0);
    const chunks = new Map<string, ColumnData[]>();
    await parquetRead({ file, metadata, columns, compressors, rowStart: start, rowEnd: start + Number(group.num_rows), onChunk: chunk => { chunks.set(chunk.columnName, [...chunks.get(chunk.columnName) ?? [], chunk]); } });
    const cursors = new Map<string, number>();
    for (const name of columns) {
      const pages = (chunks.get(name) ?? []).sort((a, b) => a.rowStart - b.rowStart);
      let next = start;
      for (const chunk of pages) {
        if (chunk.rowStart !== next || chunk.columnData.length !== chunk.rowEnd - chunk.rowStart) throw new Error("OPM_EMPLOYMENT_COLUMN_LENGTH_MISMATCH");
        next = chunk.rowEnd;
      }
      if (next !== start + Number(group.num_rows)) throw new Error("OPM_EMPLOYMENT_COLUMN_LENGTH_MISMATCH");
      cursors.set(name, 0);
    }
    const atRow = (name: string, at: number): unknown => {
      const pages = chunks.get(name)!, cursor = cursors.get(name)!;
      const next = pages[cursor].rowEnd <= at ? cursor + 1 : cursor;
      cursors.set(name, next);
      return pages[next].columnData[at - pages[next].rowStart];
    };
    for (let at = start; at < start + Number(group.num_rows); at++) {
      const count = Number(atRow("count", at));
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("OPM_EMPLOYMENT_COUNT_INVALID");
      for (const name of new Set([text(atRow("department", at)), text(atRow("agency", at))].filter(Boolean))) counts[name] = (counts[name] ?? 0) + count;
    }
  }
  return { snapshot: release.snapshot, counts, sourceUrl: release.url, collectedAt: release.collectedAt };
}
/** Saved ranges are replayable evidence; the callback lets the standing run vault their original bytes. */
export async function acquireOpmHeadcounts(input: { readonly read: CabinetReader; readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal;
  readonly now?: () => string; readonly saveRange?: (url: string, range: OpmRange, byteLength: number, retrievedAt: string) => Promise<void> }): Promise<OpmHeadcountSnapshot> {
  const release = currentOpmRelease(await input.read(OPM_EMPLOYMENT_URL));
  const coverageRead = input.read(OPM_COVERAGE_URL).then(opmEmploymentCoverage)
    .then(coverage => ({ coverage, coverageGap: undefined as string | undefined }))
    .catch((error: unknown) => ({ coverage: undefined, coverageGap: error instanceof Error ? error.message : "OPM employment coverage has not yet been acquired." }));
  const fetcher = input.fetchImpl ?? fetch, retrievedAt = (input.now ?? (() => new Date().toISOString()))();
  const rawSourceRefs: OpmRangeReference[] = [];
  const head = await fetcher(release.url, { method: "HEAD", signal: input.signal });
  const byteLength = Number(head.headers.get("content-length"));
  if (!head.ok || !Number.isSafeInteger(byteLength) || byteLength < 12) throw new Error("OPM_EMPLOYMENT_LENGTH_UNAVAILABLE");
  const file: AsyncBuffer = { byteLength, async slice(start, end = byteLength) {
    const response = await fetcher(release.url, { headers: { Range: `bytes=${start}-${end - 1}` }, signal: input.signal });
    if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${start}-${end - 1}/${byteLength}`) throw new Error("OPM_EMPLOYMENT_RANGE_INCOMPLETE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== end - start) throw new Error("OPM_EMPLOYMENT_RANGE_TRUNCATED");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await input.saveRange?.(release.url, { start, end, bytes, sha256 }, byteLength, retrievedAt);
    rawSourceRefs.push({ sourceUrl: release.url, start, end, byteLength, sha256, collectedAt: retrievedAt });
    return bytes.buffer;
  } };
  const snapshot = await opmHeadcountsFromParquet(file, { ...release, collectedAt: retrievedAt });
  return { ...snapshot, rawSourceRefs, ...await coverageRead };
}

const sharedReads = new WeakMap<CabinetReader, Map<string, Promise<CabinetPage>>>();
function shared(read: CabinetReader, url: string, request?: CabinetReadRequest): Promise<CabinetPage> {
  url = publicFederalUrl(url);
  const requestKey = `${url}|${request ? JSON.stringify(request) : "GET"}`;
  let cache = sharedReads.get(read);
  if (!cache) { cache = new Map(); sharedReads.set(read, cache); }
  let held = cache.get(requestKey);
  if (!held) { held = read(url, request); cache.set(requestKey, held); }
  return held;
}
async function nominationFor(person: Officeholder, read: CabinetReader, signal?: AbortSignal, aliasPages: readonly CabinetPage[] = []): Promise<CabinetConfirmation | undefined> {
  const year = new Date().getUTCFullYear(), congress = Math.floor((year - 1789) / 2) + 1;
  const names = [key(person.name), ...aliasPages.flatMap(page => committeeNomineeAliases(page, person)).map(alias => unsuffixedName(alias.nominationName))];
  // The previous Congress covers unchanged holders who were confirmed before this Congress began.
  for (const term of [congress, congress - 1]) {
    let url: string | null = `https://api.congress.gov/v3/nomination/${term}?format=json&limit=250`;
    const visited = new Set<string>();
    while (url) {
      signal?.throwIfAborted();
      if (visited.has(url)) throw new Error("CABINET_NOMINATION_PAGINATION_LOOP");
      visited.add(url);
      const page = await shared(read, url);
      source(page, "api.congress.gov", new RegExp(`^/v3/nomination/${term}/?$`));
      const root = parsed(page);
      if (!Array.isArray(root.nominations)) throw new Error("CABINET_NOMINATION_LIST_INVALID");
      for (const row of list(root.nominations)) {
        const description = key(text(row.description));
        if (!names.some(name => description.includes(name))) continue;
        const detailUrl = text(row.url);
        if (!detailUrl) continue;
        try {
          const detail = await shared(read, detailUrl), nomination = object(parsed(detail).nomination), actionsUrl = text(object(nomination.actions).url);
          const confirmation = cabinetConfirmation(detail, person, actionsUrl ? await shared(read, actionsUrl) : undefined, aliasPages);
          if (confirmation) return confirmation;
        } catch (error) {
          if (error instanceof Error && error.message === "CABINET_NOMINATION_PERSON_OFFICE_MISMATCH") continue;
          throw error;
        }
      }
      const next = text(object(root.pagination).next) ? publicFederalUrl(text(object(root.pagination).next)) : "";
      if (next) {
        const nextUrl = new URL(next);
        if (nextUrl.hostname !== "api.congress.gov" || !nextUrl.pathname.startsWith(`/v3/nomination/${term}`)) throw new Error("CABINET_NOMINATION_NEXT_HOST_INVALID");
      }
      url = next || null;
    }
  }
  return undefined;
}

/** One standing source run shares its reader and OPM snapshot across all current Cabinet members. */
export async function acquireCabinetRecords(input: { readonly person: Officeholder; readonly read: CabinetReader; readonly opm?: OpmHeadcountSnapshot;
  readonly biographyPages?: readonly CabinetPage[]; readonly signal?: AbortSignal }): Promise<CabinetRecords> {
  const { person, read } = input, own = cabinetDepartment(person.officeTitle), gaps: string[] = [], sources: Citation[] = [];
  const priorOffices = [...(person.executive?.priorOffices ?? [])];
  for (const page of input.biographyPages ?? []) {
    try { priorOffices.push(...parseExecutiveProfile({ person, page: { url: page.url, html: page.body, retrievedAt: page.retrievedAt } }).priorOffices); } catch { gaps.push(`Biography identity or office did not match: ${page.url}`); }
  }
  if (!own) return { priorOffices, gaps: ["Department mapping is not yet held for this Cabinet office."], sources, coverage: {} };
  let budget: DepartmentBudget | undefined, confirmation: CabinetConfirmation | undefined, actions: DepartmentAction[] = [];
  const budgets: DepartmentBudget[] = [];
  let resourceDisclosure: ExecutiveText | undefined;
  let departmentSource: Citation | undefined, actionsRead = false;
  const budgetWork = (async () => {
    try {
      const index = await shared(read, USA_AGENCIES_URL), agency = spendingAgency(index, own);
      if (!agency && ["Office of Management and Budget", "Office of the United States Trade Representative"].includes(own.name)) {
        const parent = list(parsed(index).results).find(row => row.agency_name === "Executive Office of the President");
        const fiscalYear = Number(parent?.active_fy), toptierCode = text(parent?.toptier_code);
        if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || !/^\d{3,4}$/.test(toptierCode)) throw new Error("EXECUTIVE_OFFICE_PARENT_AGENCY_UNRESOLVED");
        // The current year can be present but not yet reported. Read the previous year when all current account resources are null.
        for (const year of [fiscalYear, fiscalYear - 1]) {
          const request = { method: "POST" as const, body: { filters: { agency_identifier: toptierCode, fy: String(year) }, limit: 100, page: 1, sort: { direction: "asc", field: "account_name" } } };
          const pages: CabinetPage[] = [], seen = new Set<number>();
          for (let pageNumber = 1; ; pageNumber++) {
            if (seen.has(pageNumber)) throw new Error("EXECUTIVE_OFFICE_ACCOUNT_PAGINATION_LOOP");
            seen.add(pageNumber);
            const page = await shared(read, USA_FEDERAL_ACCOUNTS_URL, { ...request, body: { ...request.body, page: pageNumber } });
            pages.push(page); sources.push(cite(page));
            const root = parsed(page);
            if (Number(root.page) !== pageNumber || typeof root.hasNext !== "boolean") throw new Error("EXECUTIVE_OFFICE_ACCOUNT_PAGINATION_INVALID");
            if (root.hasNext !== true) break;
          }
          const heldAccounts = pages.flatMap(page => executiveOfficeAccountBudgets(page, own, year));
          if (heldAccounts.length) {
            budgets.push(...heldAccounts);
            budget = heldAccounts.find(row => row.accountName?.startsWith("Salaries and Expenses,")) ?? heldAccounts[0];
            departmentSource = cite(pages[0]);
            break;
          }
        }
        if (!budget) throw new Error("Office account budgetary resources have not yet been reported.");
        gaps.push("Office account resources are held separately; an all-office budget total has not been established.");
        return;
      }
      if (!agency) throw new Error("USAspending has no separately reported top-tier budget for this office.");
      departmentSource = cite(index); sources.push(cite(index));
      const page = await shared(read, `https://api.usaspending.gov/api/v2/agency/${agency.code}/budgetary_resources/`);
      budget = departmentBudget(page, agency.code) ?? undefined; sources.push(cite(page));
      if (!budget) gaps.push("Agency budgetary resources are not yet acquired.");
    } catch (error) { gaps.push(`Budget: ${error instanceof Error ? error.message : "source unavailable"}`); }
  })();
  const registerWork = (async () => {
    try {
      const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
      url.searchParams.set("conditions[agencies][]", own.registerSlug); url.searchParams.set("order", "newest"); url.searchParams.set("per_page", "20");
      const page = await shared(read, url.href); actions = departmentRegisterActions(page, own, person.termStart || undefined); actionsRead = true; sources.push(cite(page));
      departmentSource ??= cite(page);
    } catch (error) { gaps.push(`Department actions: ${error instanceof Error ? error.message : "source unavailable"}`); }
  })();
  const confirmationWork = (async () => {
    try {
      const aliasPages: CabinetPage[] = [];
      if (own.name === "Office of the Director of National Intelligence") {
        try { aliasPages.push(await shared(read, SENATE_INTELLIGENCE_URL)); }
        catch (error) { gaps.push(`Nominee alias: ${error instanceof Error ? error.message : "source unavailable"}`); }
      }
      confirmation = await nominationFor(person, read, input.signal, aliasPages);
      if (!confirmation) gaps.push("Senate confirmation has not yet been acquired.");
      else { sources.push(confirmation, ...confirmation.aliasSources ?? []); }
    }
    catch (error) { gaps.push(`Confirmation: ${error instanceof Error ? error.message : "source unavailable"}`); }
  })();
  const disclosureWork = (async () => {
    if (own.name !== "Central Intelligence Agency") return;
    try { resourceDisclosure = ciaResourcesDisclosure(await shared(read, CIA_FAQ_URL)); sources.push(resourceDisclosure); }
    catch (error) { gaps.push(`CIA disclosure: ${error instanceof Error ? error.message : "source unavailable"}`); }
  })();
  await Promise.all([budgetWork, registerWork, confirmationWork, disclosureWork]);
  input.signal?.throwIfAborted();
  let headcount: DepartmentHeadcount | undefined;
  let headcountNote: ExecutiveText | undefined;
  if (input.opm) {
    if (input.opm.coverageGap) gaps.push(`OPM coverage: ${input.opm.coverageGap}`);
    const matched = Object.keys(input.opm.counts).filter(name => own.opmNames.some(alias => key(alias) === key(name)));
    if (matched.length === 1) headcount = { count: input.opm.counts[matched[0]], asOf: input.opm.snapshot, label: "OPM-covered civilian employees", sourceUrl: input.opm.sourceUrl, collectedAt: input.opm.collectedAt,
      ...(input.opm.rawSourceRefs ? { rawSourceRefs: input.opm.rawSourceRefs } : {}), ...(input.opm.coverage ? { coverageSource: input.opm.coverage } : {}) };
    else {
      const excluded = input.opm.coverage?.exclusions.find(name => own.opmNames.some(alias => key(alias) === key(name)));
      if (excluded && input.opm.coverage) {
        headcountNote = { text: `OPM excludes the ${excluded} from its EHRI workforce data.`, sourceUrl: input.opm.coverage.sourceUrl, collectedAt: input.opm.coverage.collectedAt };
        sources.push(input.opm.coverage); gaps.push(headcountNote.text);
      } else gaps.push("OPM has no unique published employment count matched to this department.");
    }
  } else gaps.push("OPM employment is not yet acquired.");
  if (headcount) sources.push(headcount);
  if (headcount?.coverageSource) sources.push(headcount.coverageSource);
  if (resourceDisclosure) { headcountNote ??= resourceDisclosure; gaps.push(resourceDisclosure.text); }
  // An officially excluded intelligence office still carries the source's explicit coverage note.
  departmentSource ??= headcountNote ? { sourceUrl: headcountNote.sourceUrl, collectedAt: headcountNote.collectedAt } : undefined;
  const currentDepartment = departmentSource ? { name: own.name, ...departmentSource, budget, ...(budgets.length ? { budgets } : {}),
    ...(resourceDisclosure ? { budgetNote: resourceDisclosure } : {}), headcount, headcountNote, actions } : undefined;
  return { department: currentDepartment, confirmation, priorOffices: [...new Map(priorOffices.map(row => [row.text, row])).values()], sources,
    gaps, coverage: { department: Boolean(currentDepartment), budget: Boolean(budget?.scope === "DEPARTMENT"), headcount: Boolean(headcount),
      confirmation: Boolean(confirmation && (confirmation.yeas !== null && confirmation.nays !== null || ["Voice vote", "Unanimous consent"].includes(confirmation.method))), priorOffices: priorOffices.length > 0, departmentActions: actionsRead } };
}
