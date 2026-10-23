import { createHash } from "node:crypto";
import { parquetMetadataAsync, parquetRead, type AsyncBuffer, type ColumnData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { Officeholder } from "../../officials/types.ts";
import type { ExecutiveText } from "../../officials/national-executive.ts";
import { parseExecutiveProfile } from "./profile.ts";
import { publicFederalUrl } from "../congress/acquire.ts";

export interface CabinetPage { readonly url: string; readonly body: string; readonly retrievedAt: string }
export type CabinetReader = (url: string) => Promise<CabinetPage>;
interface Citation { readonly sourceUrl: string; readonly collectedAt: string }
export interface CabinetDepartment {
  readonly name: string;
  readonly spendingNames: readonly string[];
  readonly registerSlug: string;
  readonly opmNames: readonly string[];
  readonly senateConfirmed: boolean;
}
export interface DepartmentBudget extends Citation { readonly amount: number; readonly fiscalYear: number; readonly label: "Budgetary resources" }
export interface DepartmentHeadcount extends Citation { readonly count: number; readonly asOf: string; readonly label: "Federal civilian employees"; readonly rawSourceRefs?: readonly OpmRangeReference[] }
export interface DepartmentAction extends Citation {
  readonly id: string; readonly title: string; readonly date: string; readonly kind: string; readonly documentUrl: string | null;
  readonly evidenceSourceUrl: string;
}
export interface CabinetConfirmation extends Citation {
  readonly date: string; readonly yeas: number | null; readonly nays: number | null; readonly method: string; readonly quote: string;
  readonly evidenceSourceUrl: string;
}
export interface CabinetRecords {
  readonly department?: Citation & { readonly name: string; readonly budget?: DepartmentBudget; readonly headcount?: DepartmentHeadcount; readonly actions: readonly DepartmentAction[] };
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
export function spendingAgency(page: CabinetPage, own: CabinetDepartment): { code: string; name: string } | null {
  source(page, "api.usaspending.gov", /^\/api\/v2\/references\/toptier_agencies\/$/);
  const root = parsed(page);
  if (!Array.isArray(root.results)) throw new Error("CABINET_SPENDING_AGENCY_LIST_INVALID");
  const names = new Set(own.spendingNames.map(key));
  const matches = list(root.results).filter(row => names.has(key(text(row.agency_name))));
  if (matches.length > 1) throw new Error("CABINET_SPENDING_AGENCY_AMBIGUOUS");
  if (!matches.length) return null;
  const code = text(matches[0].toptier_code);
  if (!/^\d{3}$/.test(code)) throw new Error("CABINET_SPENDING_AGENCY_CODE_INVALID");
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
  return row ? { amount: row.agency_budgetary_resources as number, fiscalYear: row.fiscal_year as number, label: "Budgetary resources", ...cite(page) } : null;
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
export function cabinetConfirmation(page: CabinetPage, person: Pick<Officeholder, "name" | "officeTitle">, actionsPage?: CabinetPage): CabinetConfirmation | null {
  const url = source(page, "api.congress.gov", /^\/v3\/nomination\/\d+\/[\d-]+\/?$/);
  const root = parsed(page), row = object(root.nomination), description = key(text(row.description));
  const aliases = person.officeTitle === "Secretary of War" ? ["Secretary of War", "Secretary of Defense"] : [person.officeTitle];
  if (!description.includes(key(person.name)) || !aliases.some(title => description.includes(key(title)))) throw new Error("CABINET_NOMINATION_PERSON_OFFICE_MISMATCH");
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
    sourceUrl: `https://www.congress.gov/nomination/${identity[1]}th-congress/${identity[2]}`, evidenceSourceUrl: actionsPage?.url ?? page.url, collectedAt: actionsPage?.retrievedAt ?? page.retrievedAt };
}

export const OPM_EMPLOYMENT_URL = "https://data.opm.gov/api/v1/files/employment?current=true";
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
  return { ...snapshot, rawSourceRefs };
}

const sharedReads = new WeakMap<CabinetReader, Map<string, Promise<CabinetPage>>>();
function shared(read: CabinetReader, url: string): Promise<CabinetPage> {
  url = publicFederalUrl(url);
  let cache = sharedReads.get(read);
  if (!cache) { cache = new Map(); sharedReads.set(read, cache); }
  let held = cache.get(url);
  if (!held) { held = read(url); cache.set(url, held); }
  return held;
}
async function nominationFor(person: Officeholder, read: CabinetReader, signal?: AbortSignal): Promise<CabinetConfirmation | undefined> {
  const year = new Date().getUTCFullYear(), congress = Math.floor((year - 1789) / 2) + 1;
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
        if (!description.includes(key(person.name))) continue;
        const detailUrl = text(row.url);
        if (!detailUrl) continue;
        try {
          const detail = await shared(read, detailUrl), nomination = object(parsed(detail).nomination), actionsUrl = text(object(nomination.actions).url);
          const confirmation = cabinetConfirmation(detail, person, actionsUrl ? await shared(read, actionsUrl) : undefined);
          if (confirmation) return confirmation;
        } catch (error) {
          if (error instanceof Error && error.message === "CABINET_NOMINATION_PERSON_OFFICE_MISMATCH") continue;
          throw error;
        }
      }
      const next = text(object(root.pagination).next) ? publicFederalUrl(text(object(root.pagination).next)) : "";
      if (next && (new URL(next).hostname !== "api.congress.gov" || !new URL(next).pathname.startsWith(`/v3/nomination/${term}`))) throw new Error("CABINET_NOMINATION_NEXT_HOST_INVALID");
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
  let departmentSource: Citation | undefined, actionsRead = false;
  const budgetWork = (async () => {
    try {
      const index = await shared(read, USA_AGENCIES_URL), agency = spendingAgency(index, own);
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
    try { confirmation = await nominationFor(person, read, input.signal); if (!confirmation) gaps.push("Senate confirmation has not yet been acquired."); else sources.push(confirmation); }
    catch (error) { gaps.push(`Confirmation: ${error instanceof Error ? error.message : "source unavailable"}`); }
  })();
  await Promise.all([budgetWork, registerWork, confirmationWork]);
  input.signal?.throwIfAborted();
  let headcount: DepartmentHeadcount | undefined;
  if (input.opm) {
    const matched = Object.keys(input.opm.counts).filter(name => own.opmNames.some(alias => key(alias) === key(name)));
    if (matched.length === 1) headcount = { count: input.opm.counts[matched[0]], asOf: input.opm.snapshot, label: "Federal civilian employees", sourceUrl: input.opm.sourceUrl, collectedAt: input.opm.collectedAt, ...(input.opm.rawSourceRefs ? { rawSourceRefs: input.opm.rawSourceRefs } : {}) };
    else gaps.push("OPM has no unique published employment count matched to this department.");
  } else gaps.push("OPM employment is not yet acquired.");
  if (headcount) sources.push(headcount);
  const currentDepartment = departmentSource ? { name: own.name, ...departmentSource, budget, headcount, actions } : undefined;
  return { department: currentDepartment, confirmation, priorOffices: [...new Map(priorOffices.map(row => [row.text, row])).values()], sources,
    gaps, coverage: { department: Boolean(currentDepartment), budget: Boolean(budget), headcount: Boolean(headcount),
      confirmation: Boolean(confirmation && (confirmation.yeas !== null && confirmation.nays !== null || ["Voice vote", "Unanimous consent"].includes(confirmation.method))), priorOffices: priorOffices.length > 0, departmentActions: actionsRead } };
}
