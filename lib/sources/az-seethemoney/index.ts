/**
 * Arizona state campaign money, from the Secretary of State's own portal (`seethemoney.az.gov`) and
 * FTP (`ftp://ftp.azsos.gov/`): the published record for statewide and legislative offices, for which
 * A.R.S. § 16-928 makes the Secretary of State the filing officer. Filings are never sold.
 *
 * Four distinct representations, each carrying facts the others do not; a 200 from one retires none of
 * the others:
 *
 * | Route | Carries what nothing else does |
 * | --- | --- |
 * | `GetNEWTableData` | the per-office, per-party breakdown of a committee's cycle activity |
 * | `GetNEWDetailedTableData` | the itemised transactions, the only independent statement of a total |
 * | `GetDetailedInformation` | the committee's filed officers, address, office sought and status |
 * | `ftp://ftp.azsos.gov/cfsdata2/` | the whole committee register with organization and termination dates, and the filing calendar |
 *
 * Both table endpoints are server-side DataTables actions: filters ride in the query string and the POST
 * body must include the `columns[N][data]` array. A malformed body answers HTTP 200 with an empty string.
 * `GetNEWDetailedTableData` also needs `entityId`, or it answers `recordsTotal: 0`.
 *
 * The portal's default view (`IsLessActive=false`) hides most entities, so the universe walked is the
 * union of the default, `IsLessActive=true` and `ShowOfficeHolder=true` queries.
 *
 * Itemised rows carry contributor personal data; `aggregateDetail` is the only function that sees them,
 * and it returns numbers only.
 */

import { namesAgree } from "../../funding/state-money.ts";
import { OUTBOUND_CONTACT } from "../../geo/outbound-agent.ts";

export const AGENCY = "Arizona Secretary of State — See The Money";
export const BASE = "https://seethemoney.az.gov";
export const SUMMARY_PATH = "/Reporting/GetNEWTableData/";

/**
 * The jurisdiction whose filing officer is the Secretary of State.
 * A.R.S. § 16-928. County and municipal filers sit under other ids, and this
 * adapter deliberately does not claim to answer for them.
 */
export const JURISDICTION_ID = 0;

/** Identification the host serves: the headers name a person and a purpose. No credential is sent. */
export const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  accept: "application/json, text/javascript, */*; q=0.01",
  "x-requested-with": "XMLHttpRequest",
  origin: BASE,
  referer: `${BASE}/Reporting/Explore`,
  // Composed from `lib/geo/outbound-agent.ts`, never a copied literal.
  from: OUTBOUND_CONTACT,
  "x-purpose": "civic campaign-finance index for a public-records product",
});

/** The projection the summary action builds its result from. Order matters. */
export const SUMMARY_COLUMNS = [
  "EntityLastName",
  "CommitteeName",
  "OfficeName",
  "PartyName",
  "Income",
  "Expense",
  "CashBalance",
  "IESupport",
  "IEOpposition",
] as const;

/** Which detail table. 20 income, 21 expense, 24 every transaction. */
export const DETAIL_PAGE = { income: 20, expense: 21, all: 24 } as const;
export type DetailKind = keyof typeof DETAIL_PAGE;

export interface SummaryRow {
  EntityID: number;
  EntityFirstName: string | null;
  EntityLastName: string | null;
  CommitteeName: string | null;
  OfficeName: string | null;
  OfficeID: number | null;
  PartyName: string | null;
  EntityTypeName: string | null;
  Income: number | null;
  Expense: number | null;
  CashBalance: number | null;
}

export interface TableResponse<T> {
  data: T[];
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
}

/**
 * The DataTables form body.
 *
 * The column array is not decoration. Omit it and the action projects nothing
 * and returns a two-byte empty string with HTTP 200.
 */
export function dataTablesBody(
  columns: readonly string[],
  opts: { start?: number; length?: number; orderColumn?: number; orderDir?: "asc" | "desc" } = {},
): string {
  const p = new URLSearchParams();
  p.set("draw", "1");
  columns.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c);
    p.set(`columns[${i}][name]`, "");
    p.set(`columns[${i}][searchable]`, "true");
    p.set(`columns[${i}][orderable]`, c === "" ? "false" : "true");
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });
  p.set("order[0][column]", String(opts.orderColumn ?? 0));
  p.set("order[0][dir]", opts.orderDir ?? "asc");
  p.set("start", String(opts.start ?? 0));
  p.set("length", String(opts.length ?? 500));
  p.set("search[value]", "");
  p.set("search[regex]", "false");
  return p.toString();
}

export interface SummaryQueryOptions {
  startYear: number;
  endYear: number;
  /** The default view HIDES these. Walking with `false` manufactures absences. */
  isLessActive: boolean;
  showOfficeHolder: boolean;
  length?: number;
  jurisdictionId?: number;
}

export function summaryQuery(o: SummaryQueryOptions): string {
  return new URLSearchParams({
    Page: "1",
    startYear: String(o.startYear),
    endYear: String(o.endYear),
    JurisdictionId: String(o.jurisdictionId ?? JURISDICTION_ID),
    TablePage: "1",
    TableLength: String(o.length ?? 5000),
    IsLessActive: String(o.isLessActive),
    ShowOfficeHolder: String(o.showOfficeHolder),
    ChartName: "1",
  }).toString();
}

/**
 * The three queries that together are the universe, stated as data so a caller cannot walk one and
 * believe it walked the source.
 */
export function universeQueries(startYear: number, endYear: number): SummaryQueryOptions[] {
  return [
    { startYear, endYear, isLessActive: false, showOfficeHolder: false },
    { startYear, endYear, isLessActive: true, showOfficeHolder: false },
    { startYear, endYear, isLessActive: true, showOfficeHolder: true },
  ];
}

export interface DetailQueryOptions {
  entityId: number;
  kind: DetailKind;
  startYear: number;
  endYear: number;
  start?: number;
  length?: number;
  jurisdictionId?: number;
}

/**
 * The detail query. Without `entityId` this endpoint answers HTTP 200 and `recordsTotal: 0`, so the
 * request is refused rather than built.
 */
export function detailQuery(o: DetailQueryOptions): string {
  if (!Number.isInteger(o.entityId) || o.entityId <= 0) {
    throw new Error(
      `detailQuery refuses to build a URL without a positive entityId (got ${String(o.entityId)}). ` +
        "Without it the endpoint answers HTTP 200 with zero rows, which is a failed extraction " +
        "that looks exactly like an absence.",
    );
  }
  const length = o.length ?? 2000;
  const start = o.start ?? 0;
  return new URLSearchParams({
    JurisdictionId: String(o.jurisdictionId ?? JURISDICTION_ID),
    Page: String(DETAIL_PAGE[o.kind]),
    startYear: String(o.startYear),
    endYear: String(o.endYear),
    IsLessActive: "true",
    ShowOfficeHolder: "false",
    Name: `1~${o.entityId}`,
    entityId: String(o.entityId),
    TablePage: String(Math.floor(start / Math.max(1, length)) + 1),
    TableLength: String(length),
  }).toString();
}

/**
 * Parse a DataTables reply, and refuse anything that is not one. The empty-string reply to a malformed
 * request is valid JSON, so a bare `JSON.parse` would succeed.
 */
export function parseTableResponse<T>(text: string, what: string): TableResponse<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${what}: response is not JSON (${text.length} bytes, starts ${JSON.stringify(text.slice(0, 60))})`);
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as TableResponse<T>).data)) {
    throw new Error(
      `${what}: HTTP 200 but the payload is not a DataTables result — ${JSON.stringify(text.slice(0, 120))}. ` +
        "This is a statement about our request, never about Arizona's records.",
    );
  }
  const r = parsed as TableResponse<T>;
  if (typeof r.recordsTotal !== "number") {
    throw new Error(`${what}: DataTables result carries no recordsTotal`);
  }
  return r;
}

/**
 * `"Family, Given <br>(102162)"` → `{ family, given }`. The id is already carried in `EntityID`, so it
 * is stripped rather than re-parsed.
 */
export function parseEntityName(raw: string | null): { family: string; given: string; display: string } {
  const cleaned = (raw ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const comma = cleaned.indexOf(",");
  if (comma < 0) return { family: cleaned, given: "", display: cleaned };
  const family = cleaned.slice(0, comma).trim();
  const given = cleaned.slice(comma + 1).trim();
  return { family, given, display: `${given} ${family}`.trim() };
}

/** `"Jackie Anderson for AZ House<br>(Clean Elections)"` → its registered name. */
export function cleanCommitteeName(raw: string | null): string {
  return (raw ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The office key: an exact seat, not a class. Both vocabularies (`State Senator, District 19` on the
 * ballot, `State Senator - District No. 19` in filings) map onto one canonical seat key; an office
 * neither side can key is `null`, which never agrees with anything.
 */
export function azOfficeKey(office: string | null | undefined): string | null {
  if (!office) return null;
  const s = office.toLowerCase().replace(/\s+/g, " ").trim();
  const senate = /state senat(?:e|or)\b.*?\b(?:district\s*(?:no\.?\s*)?)?(\d{1,2})\b/.exec(s);
  if (senate) return `az:state-senate:${Number(senate[1])}`;
  const house = /state (?:representative|house)\b.*?\b(?:district\s*(?:no\.?\s*)?)?(\d{1,2})\b/.exec(s);
  if (house) return `az:state-house:${Number(house[1])}`;
  const statewide: readonly [RegExp, string][] = [
    [/\bgovernor\b/, "az:governor"],
    [/\bsecretary of state\b/, "az:secretary-of-state"],
    [/\battorney general\b/, "az:attorney-general"],
    [/\bstate treasurer\b/, "az:state-treasurer"],
    [/\bsuperintendent of public instruction\b/, "az:superintendent-of-public-instruction"],
    [/\bstate mine inspector\b/, "az:state-mine-inspector"],
    [/\bcorporation commissioner\b/, "az:corporation-commissioner"],
  ];
  for (const [pattern, key] of statewide) if (pattern.test(s)) return key;
  return null;
}

/** The Arizona 2026 cycle window, as `ReportingPeriods.txt` itself defines it. */
export const CYCLE_2026 = { cycle: 2026, startYear: 2025, endYear: 2026, opensOn: "2025-01-01" } as const;

export interface RegisterRow {
  CommitteeID: string;
  CommitteeName: string;
  City: string;
  State: string;
  ZipCode: string;
  CommitteeType: string;
  OrganizationDate: string;
  TerminationDate: string;
}

/** `Committees.txt` is a tab-separated file with a header row. */
export function parseCommitteeRegister(text: string): Map<string, RegisterRow> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error(`Committees.txt held ${lines.length} lines — a failed retrieval, not an empty register`);
  }
  const head = lines[0].split("\t");
  const out = new Map<string, RegisterRow>();
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    const row = Object.fromEntries(head.map((h, i) => [h, (f[i] ?? "").trim()])) as unknown as RegisterRow;
    if (row.CommitteeID) out.set(row.CommitteeID, row);
  }
  return out;
}

export interface ReportingPeriod {
  cycle: number;
  reportName: string;
  filingPeriodEndDate: string;
  reportType: string;
}

export function parseReportingPeriods(text: string): ReportingPeriod[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error(`ReportingPeriods.txt held ${lines.length} lines — a failed retrieval, not an empty calendar`);
  }
  const head = lines[0].split("\t");
  const idx = (name: string) => head.indexOf(name);
  const iCycle = idx("Cycle");
  const iName = idx("ReportName");
  const iEnd = idx("FilingPeriodEndDate");
  const iType = idx("ReportType");
  if (iCycle < 0 || iName < 0 || iEnd < 0 || iType < 0) {
    throw new Error(`ReportingPeriods.txt header did not carry the four expected columns: ${head.join(", ")}`);
  }
  return lines.slice(1).map((line) => {
    const f = line.split("\t");
    return {
      cycle: Number(f[iCycle]),
      reportName: f[iName],
      filingPeriodEndDate: (f[iEnd] ?? "").slice(0, 10),
      reportType: f[iType],
    };
  });
}

/**
 * The next filing deadline the Secretary of State publishes for candidate committees in the cycle, or
 * `null` when the calendar states none after the given day.
 */
export function nextFilingDue(periods: readonly ReportingPeriod[], after: string, cycle = CYCLE_2026.cycle): ReportingPeriod | null {
  const eligible = periods
    .filter((p) => p.cycle === cycle && p.reportType === "Standing Reports" && p.filingPeriodEndDate > after)
    .sort((a, b) => a.filingPeriodEndDate.localeCompare(b.filingPeriodEndDate));
  return eligible[0] ?? null;
}

export interface EntityTotals {
  entityId: number;
  committeeName: string;
  candidateFamily: string;
  candidateGiven: string;
  candidateDisplay: string;
  entityTypeName: string | null;
  /** Every office the entity's rows name, keyed. An entity may state none. */
  officeKeys: string[];
  officeNames: string[];
  partyNames: string[];
  income: number;
  expense: number;
  /** Repeated identically on every row of an entity, so it is entity-level. */
  cashBalance: number | null;
  rowCount: number;
}

/**
 * Fold the per-office, per-party rows into one entity. A candidate returns up to three rows sharing one
 * `EntityID`; `CashBalance` repeats identically on all of them (an entity attribute), while
 * `Income`/`Expense` are the partitions. Whether the partitions sum to the cycle total is checked by
 * `reconcileEntity`.
 */
export function aggregateEntities(rows: readonly SummaryRow[]): Map<number, EntityTotals> {
  const out = new Map<number, EntityTotals>();
  for (const r of rows) {
    const name = parseEntityName(r.EntityLastName);
    let e = out.get(r.EntityID);
    if (!e) {
      e = {
        entityId: r.EntityID,
        committeeName: cleanCommitteeName(r.CommitteeName),
        candidateFamily: name.family,
        candidateGiven: name.given,
        candidateDisplay: name.display,
        entityTypeName: r.EntityTypeName ?? null,
        officeKeys: [],
        officeNames: [],
        partyNames: [],
        income: 0,
        expense: 0,
        cashBalance: r.CashBalance ?? null,
        rowCount: 0,
      };
      out.set(r.EntityID, e);
    }
    e.income += r.Income ?? 0;
    e.expense += r.Expense ?? 0;
    e.rowCount += 1;
    const key = azOfficeKey(r.OfficeName);
    if (key && !e.officeKeys.includes(key)) e.officeKeys.push(key);
    const office = (r.OfficeName ?? "").trim();
    if (office && !e.officeNames.includes(office)) e.officeNames.push(office);
    const party = (r.PartyName ?? "").trim();
    if (party && !e.partyNames.includes(party)) e.partyNames.push(party);
  }
  // Round the accumulated floats to cents. Summing IEEE doubles produces
  // 2015.8799999999999 for 686.91 + 205 + 1123.97, and a reconciliation that
  // compares that to 2015.88 reports a disagreement that is ours, not theirs.
  for (const e of out.values()) {
    e.income = Math.round(e.income * 100) / 100;
    e.expense = Math.round(e.expense * 100) / 100;
  }
  return out;
}

export interface DetailAggregate {
  count: number;
  sum: number;
}

/** Committee types in the register that are a CANDIDATE'S own committee. */
const CANDIDATE_COMMITTEE_TYPES = /^(candidate|\$500 threshold \(candidate\))/i;

/**
 * An absence needs two representations to agree. If the register holds a live candidate committee
 * under this surname, failing to match it in the portal is our gap, never "no reports on file". The
 * surname alone is the test: coarse, in the safe direction. Returns the register rows that stand in the
 * way.
 */
export function registerHoldsCandidateCommittee(
  register: ReadonlyMap<string, RegisterRow>,
  familyName: string,
  cycleOpensOn: string,
): RegisterRow[] {
  const surname = familyName.toLowerCase().replace(/["“”]/g, "").trim();
  if (surname.length < 3) return [];
  const needle = new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const out: RegisterRow[] = [];
  for (const row of register.values()) {
    if (!CANDIDATE_COMMITTEE_TYPES.test(row.CommitteeType)) continue;
    if (terminatedBeforeCycle(row, cycleOpensOn) === true) continue;
    if (needle.test(row.CommitteeName)) out.push(row);
  }
  return out;
}

/**
 * A committee the register shows terminated before the cycle opened belongs to
 * a different election. Returns `null` when the register does not hold the
 * committee, which is a gap in the register and never a licence to assume.
 */
export function terminatedBeforeCycle(row: RegisterRow | undefined, cycleOpensOn: string): boolean | null {
  if (!row) return null;
  const t = (row.TerminationDate ?? "").slice(0, 10);
  if (!t) return false;
  return t < cycleOpensOn;
}

/**
 * Does the summary agree with the publisher's own itemised ledger? `CashBalance` carries a balance
 * brought forward from before the cycle, so it cannot check a within-window sum; the itemised ledger
 * can. This diagnostic never gates an independently sourced official summary amount.
 */
export function reconcileEntity(
  totals: EntityTotals,
  ledger: { income: DetailAggregate; expense: DetailAggregate } | undefined,
): { agrees: boolean; note: string; incomeDelta: number | null; expenseDelta: number | null } {
  if (!ledger) {
    return {
      agrees: false,
      note: "the itemised ledger for this committee was not read on this walk, so its total is unverified",
      incomeDelta: null,
      expenseDelta: null,
    };
  }
  const incomeDelta = Math.round((totals.income - ledger.income.sum) * 100) / 100;
  const expenseDelta = Math.round((totals.expense - ledger.expense.sum) * 100) / 100;
  const agrees = Math.abs(incomeDelta) < 0.005 && Math.abs(expenseDelta) < 0.005;
  return {
    agrees,
    note: agrees
      ? `summary totals reproduce the publisher's own itemised ledger exactly (${ledger.income.count} income and ${ledger.expense.count} expense transactions)`
      : `summary totals do NOT reproduce the itemised ledger — income off by ${incomeDelta}, expense off by ${expenseDelta}`,
    incomeDelta,
    expenseDelta,
  };
}

/**
 * A quoted segment in a name is an alternate name ("also known as"), not a name token. A name with a
 * quoted segment expands into the names it states, and `namesAgree` is applied unchanged to the pairs.
 * No rule here invents diminutives.
 */
export function nameVariants(name: string): string[] {
  const cleaned = name.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  const quoted = [...cleaned.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1].trim()).filter(Boolean);
  const withoutQuoted = cleaned.replace(/["“”][^"“”]+["“”]/g, " ").replace(/\s+/g, " ").trim();
  if (quoted.length === 0) return [cleaned];
  // The quoted part can stand in for either the given or the family name, and nothing in the string says
  // which, so both readings are generated and `namesAgree` decides.
  const variants = new Set<string>([withoutQuoted]);
  const parts = withoutQuoted.split(" ").filter(Boolean);
  for (const alt of quoted) {
    if (parts.length >= 2) {
      variants.add([alt, ...parts.slice(1)].join(" "));
      variants.add([...parts.slice(0, -1), alt].join(" "));
    } else {
      variants.add(`${alt} ${parts[0] ?? ""}`.trim());
    }
  }
  return [...variants].filter((v) => v.length > 0);
}

/**
 * Person identity, using the shared `namesAgree` test plus `nameVariants` on both sides: parsing, not
 * fuzz.
 */
export function azNamesAgree(a: string, b: string): boolean {
  for (const x of nameVariants(a)) for (const y of nameVariants(b)) if (namesAgree(x, y)) return true;
  return false;
}
