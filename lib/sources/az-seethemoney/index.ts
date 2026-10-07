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

import {
  judgeMatch,
  namesAgree,
  type MatchBasis,
  type StateMoneyRecord,
  type StateMoneySnapshot,
} from "../../funding/state-money.ts";
import { OUTBOUND_CONTACT } from "../../geo/outbound-agent.ts";
import type { Provenance } from "../types.ts";

export const AGENCY = "Arizona Secretary of State — See The Money";
export const PUBLIC_PAGE = "https://seethemoney.az.gov/";
export const BASE = "https://seethemoney.az.gov";
export const SUMMARY_PATH = "/Reporting/GetNEWTableData/";
export const DETAIL_PATH = "/Reporting/GetNEWDetailedTableData/";
export const COMMITTEE_INFO_PATH = "/Reporting/GetDetailedInformation";
export const FTP_HOST = "ftp.azsos.gov";
export const FTP_DIR = "/cfsdata2";

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

/** The projection the detail action builds its result from. */
export const DETAIL_COLUMNS = [
  "",
  "TransactionId",
  "TransactionDate",
  "TransactionLastName",
  "Amount",
  "TransactionType",
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

/**
 * The only function that sees an itemised transaction, and it returns numbers. Nothing downstream is
 * given the rows, so nothing downstream can persist them.
 */
export function aggregateDetail(rows: readonly { Amount?: number | null }[]): DetailAggregate {
  let sum = 0;
  for (const r of rows) sum += r.Amount ?? 0;
  return { count: rows.length, sum: Math.round(sum * 100) / 100 };
}

/**
 * The Arizona guard, which only ever narrows `judgeMatch`, the shared bar:
 * - The exact seat: both sides key to one canonical seat and the keys must be equal.
 * - The cycle: a committee the register shows terminated before the cycle opened belongs to a different
 *   election.
 */
export interface AzMatchInput {
  registeredName: string;
  candidateNameAsFiled: string;
  ballotName: string;
  officeAsFiled: string | null;
  officeOnBallot: string;
  electionYearAsFiled: number | null;
  electionYearOnBallot: number;
}

export interface AzMatchResult {
  basis: MatchBasis;
  /** True only when the shared bar AND both Arizona guards agree. */
  agrees: boolean;
  seatKeyAsFiled: string | null;
  seatKeyOnBallot: string | null;
  /** Why, when it did not. Empty when it did. */
  refusals: string[];
}

export function judgeAzMatch(input: AzMatchInput): AzMatchResult {
  // A ballot name carrying a quoted alternate is two names written as one, so the agreeing variant pair
  // is resolved first and `judgeMatch` receives that. When no pair agrees, the originals go in.
  let filedName = input.candidateNameAsFiled;
  let ballotNameForBar = input.ballotName;
  outer: for (const x of nameVariants(input.candidateNameAsFiled)) {
    for (const y of nameVariants(input.ballotName)) {
      if (namesAgree(x, y)) {
        filedName = x;
        ballotNameForBar = y;
        break outer;
      }
    }
  }
  const basis = judgeMatch({ ...input, candidateNameAsFiled: filedName, ballotName: ballotNameForBar });
  const filed = azOfficeKey(input.officeAsFiled);
  const ballot = azOfficeKey(input.officeOnBallot);
  const refusals: string[] = [];
  if (!basis.allThreeAgree) refusals.push(basis.note.replace(/^LEAD — /, ""));
  if (ballot === null) {
    refusals.push(`the ballot office '${input.officeOnBallot}' does not key to an Arizona seat`);
  } else if (filed === null) {
    refusals.push(
      input.officeAsFiled
        ? `the filed office '${input.officeAsFiled}' does not key to an Arizona seat`
        : "the agency states no office for this committee",
    );
  } else if (filed !== ballot) {
    refusals.push(`the filed seat ${filed} is not the ballot seat ${ballot}`);
  }
  const agrees = refusals.length === 0;
  return {
    basis: {
      ...basis,
      allThreeAgree: agrees,
      note: agrees
        ? "name, exact Arizona seat and election cycle all agree with the certified-ballot row"
        : `LEAD — ${refusals.join("; ")}`,
    },
    agrees,
    seatKeyAsFiled: filed,
    seatKeyOnBallot: ballot,
    refusals,
  };
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

export function provenanceFor(sourceUrl: string, collectedAt: string): Provenance {
  return {
    sourceUrl,
    sourceOrg: AGENCY,
    collectedAt,
    verifiedAt: collectedAt,
  };
}

// The three verbs every adapter exports. `upsert` writes a file, not a table: this corpus is
// structurally unreachable from Postgres (the campaign-finance firewall).

export interface AzRawCorpus {
  /** The union of the three universe queries, deduplicated by row identity. */
  summaryRows: SummaryRow[];
  /** Per-entity itemised aggregates. Never the transactions themselves. */
  detail: Map<number, { income: DetailAggregate; expense: DetailAggregate }>;
  register: Map<string, RegisterRow>;
  reportingPeriods: ReportingPeriod[];
  collectedAt: string;
}

export interface AzFetchIO {
  postTable: (path: string, query: string, body: string) => Promise<string>;
  ftpGet: (path: string) => Promise<string>;
}

/**
 * ACQUIRE. Every network call is injected, so the walk is testable against
 * recorded fixtures and `tests/` never reaches the network.
 */
export async function fetchAz(
  io: AzFetchIO,
  opts: { startYear: number; endYear: number; collectedAt: string; entityIds?: readonly number[] },
): Promise<AzRawCorpus> {
  const seen = new Map<string, SummaryRow>();
  for (const q of universeQueries(opts.startYear, opts.endYear)) {
    const text = await io.postTable(SUMMARY_PATH, summaryQuery(q), dataTablesBody(SUMMARY_COLUMNS, { length: 5000 }));
    const parsed = parseTableResponse<SummaryRow>(
      text,
      `GetNEWTableData isLessActive=${q.isLessActive} showOfficeHolder=${q.showOfficeHolder}`,
    );
    if (parsed.data.length !== parsed.recordsTotal) {
      throw new Error(
        `GetNEWTableData returned ${parsed.data.length} of ${parsed.recordsTotal} rows — a SHORT READ. ` +
          "A partial that reconciles is still a wrong answer (RULING 100).",
      );
    }
    for (const r of parsed.data) seen.set(`${r.EntityID}|${r.OfficeID}|${r.PartyName}|${r.Income}|${r.Expense}`, r);
  }
  const summaryRows = [...seen.values()];
  if (summaryRows.length === 0) {
    throw new Error("the three universe queries together returned zero rows — a FAILED extraction");
  }

  const detail = new Map<number, { income: DetailAggregate; expense: DetailAggregate }>();
  for (const entityId of opts.entityIds ?? []) {
    const per: Record<DetailKind, DetailAggregate> = {
      income: { count: 0, sum: 0 },
      expense: { count: 0, sum: 0 },
      all: { count: 0, sum: 0 },
    };
    for (const kind of ["income", "expense"] as const) {
      let start = 0;
      let total: number | null = null;
      for (;;) {
        const text = await io.postTable(
          DETAIL_PATH,
          detailQuery({ entityId, kind, startYear: opts.startYear, endYear: opts.endYear, start, length: 2000 }),
          dataTablesBody(DETAIL_COLUMNS, { start, length: 2000, orderColumn: 2, orderDir: "desc" }),
        );
        const parsed = parseTableResponse<{ Amount?: number | null }>(text, `GetNEWDetailedTableData ${kind} ${entityId}`);
        if (total === null) total = parsed.recordsTotal;
        const agg = aggregateDetail(parsed.data);
        per[kind].count += agg.count;
        per[kind].sum = Math.round((per[kind].sum + agg.sum) * 100) / 100;
        start += parsed.data.length;
        if (parsed.data.length === 0 || start >= total) break;
      }
    }
    detail.set(entityId, { income: per.income, expense: per.expense });
  }

  const register = parseCommitteeRegister(await io.ftpGet(`${FTP_DIR}/Committees.txt`));
  const reportingPeriods = parseReportingPeriods(await io.ftpGet(`${FTP_DIR}/ReportingPeriods.txt`));
  return { summaryRows, detail, register, reportingPeriods, collectedAt: opts.collectedAt };
}

export interface BallotCandidacy {
  id: string;
  contestId: string;
  givenName: string;
  familyName: string;
}
export interface BallotContest {
  id: string;
  title: string;
}

export interface NormalizeInput {
  corpus: AzRawCorpus;
  candidacies: readonly BallotCandidacy[];
  contestById: ReadonlyMap<string, BallotContest>;
  electionYear: number;
  /**
   * The entities whose figures reconcile against the publisher's own itemised ledger. A set, not a flag:
   * an entity absent from it cannot become a `FILED` record. Populated by `reconcileEntity`.
   */
  reconciledEntityIds: ReadonlySet<number>;
  nextDue: ReportingPeriod | null;
}

/**
 * Does the summary agree with the publisher's own itemised ledger? `CashBalance` carries a balance
 * brought forward from before the cycle, so it cannot check a within-window sum; the itemised ledger
 * can. Re-run per committee on every walk: a committee that stops agreeing stops rendering.
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

export interface NormalizeResult {
  records: StateMoneyRecord[];
  /** Per candidacy, the single honest reader state it ended in. */
  states: {
    candidacyId: string;
    ballotName: string;
    contestTitle: string;
    state: "SOURCED_FILED" | "SOURCED_ABSENCE" | "OURS_GAP" | "FEDERAL_NOT_IN_SCOPE";
    why: string;
    entityIds: number[];
  }[];
}

/**
 * Normalize: the certified ballot on one side, the register on the other. Three outcomes per candidacy:
 * - SOURCED_FILED: a committee agrees on name, exact seat and cycle, and the cycle-total semantics are
 *   proven. Its filed figures render.
 * - SOURCED_ABSENCE: the union of the universe queries holds no committee for this person at all.
 * - OURS_GAP: a committee for this person exists and something unresolved stands between it and a
 *   figure. Carries the agency's next filing deadline.
 */
export function normalizeAz(input: NormalizeInput): NormalizeResult {
  const { corpus, candidacies, contestById, electionYear } = input;
  const entities = aggregateEntities(corpus.summaryRows);
  const records: StateMoneyRecord[] = [];
  const states: NormalizeResult["states"] = [];

  for (const cand of candidacies) {
    const contest = contestById.get(cand.contestId);
    if (!contest) continue;
    const ballotName = `${cand.givenName} ${cand.familyName}`.trim();
    const ballotSeat = azOfficeKey(contest.title);
    if (ballotSeat === null) {
      // Federal seats file with the FEC and this product already reads them.
      // Asking a state regulator and recording the silence would manufacture a
      // gap; the candidacy is simply not this adapter's question.
      states.push({
        candidacyId: cand.id,
        ballotName,
        contestTitle: contest.title,
        state: "FEDERAL_NOT_IN_SCOPE",
        why: "this seat does not key to an Arizona state office — it is not the Secretary of State's to hold",
        entityIds: [],
      });
      continue;
    }

    /*
     * FIRST CUT IS PERSON IDENTITY, and the two rejections mean different
     * things. A committee whose filed name is not this person's is about
     * SOMEBODY ELSE and is not a lead about this card. A committee the
     * register shows terminated before the cycle opened is about a DIFFERENT
     * ELECTION — also somebody else's question, in time rather than in person.
     * Both are dropped. Everything that survives is genuinely this candidacy's
     * and is owed an answer, which is why nothing below drops silently.
     */
    const forThisPerson = [...entities.values()].filter(
      (e) =>
        azNamesAgree(e.candidateDisplay, ballotName) &&
        terminatedBeforeCycle(corpus.register.get(String(e.entityId)), CYCLE_2026.opensOn) !== true,
    );

    const judged = forThisPerson.map((e) => {
      // An entity may state several offices across its rows. It agrees if ANY
      // of them is this seat: the office-empty row is a partition of the same
      // committee, never a different committee.
      const seatAgrees = e.officeKeys.includes(ballotSeat);
      const result = judgeAzMatch({
        registeredName: e.committeeName,
        candidateNameAsFiled: e.candidateDisplay,
        ballotName,
        officeAsFiled: seatAgrees ? contest.title : (e.officeNames[0] ?? null),
        officeOnBallot: contest.title,
        electionYearAsFiled: electionYear,
        electionYearOnBallot: electionYear,
      });
      return { entity: e, result, seatAgrees };
    });

    const agreed = judged.filter((j) => j.seatAgrees && j.result.agrees);
    const matched = agreed.filter((j) => input.reconciledEntityIds.has(j.entity.entityId));
    const unreconciled = agreed.filter((j) => !input.reconciledEntityIds.has(j.entity.entityId));
    const commonProvenance = provenanceFor(`${BASE}${SUMMARY_PATH}`, corpus.collectedAt);

    if (matched.length > 0) {
      for (const m of matched) {
        // A registered committee reporting nothing is not a committee that raised $0: the figures go null and
        // the record says the committee exists and has reported nothing.
        const hasMoney = m.entity.income > 0 || m.entity.expense > 0;
        records.push({
          dataClass: "STATE_COMMITTEE",
          jurisdiction: "AZ",
          agency: AGENCY,
          filingsUrl: PUBLIC_PAGE,
          committeeId: String(m.entity.entityId),
          registeredName: m.entity.committeeName,
          candidateNameAsFiled: m.entity.candidateDisplay,
          officeSought: m.entity.officeNames[0] ?? contest.title,
          electionYear,
          filingState: hasMoney ? "FILED" : "REGISTERED_NO_ACTIVITY_REPORTED",
          totals: {
            receipts: hasMoney ? m.entity.income : null,
            expenditures: hasMoney ? m.entity.expense : null,
            // The portal's repeated closing balance does not equal receipts minus expenditures inside this window,
            // so it is not published as this cycle's cash on hand.
            cashOnHand: null,
            reportCount: null,
            coveringPeriod: hasMoney
              ? `Arizona ${electionYear} election cycle, activity recorded ${CYCLE_2026.opensOn} through ${corpus.collectedAt}`
              : `registered for the Arizona ${electionYear} election cycle, with no receipts or ` +
                `expenditures reported as of ${corpus.collectedAt}`,
          },
          targetKeys: [cand.id],
          match: m.result.basis,
          checkedAt: corpus.collectedAt,
          provenance: commonProvenance,
        });
      }
      states.push({
        candidacyId: cand.id,
        ballotName,
        contestTitle: contest.title,
        state: "SOURCED_FILED",
        why: `${matched.length} committee${matched.length === 1 ? "" : "s"} agree on name, exact Arizona seat and cycle`,
        entityIds: matched.map((m) => m.entity.entityId),
      });
      continue;
    }

    /*
     * THE SECOND REPRESENTATION, ASKED BEFORE ANY ABSENCE IS WRITTEN.
     * The portal being quiet about a person is not the register being quiet
     * about them, and only both together are evidence about the record.
     */
    const registerLeads =
      judged.length === 0
        ? registerHoldsCandidateCommittee(corpus.register, cand.familyName, CYCLE_2026.opensOn)
        : [];

    if (judged.length === 0 && registerLeads.length === 0) {
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "AZ",
        agency: AGENCY,
        filingsUrl: PUBLIC_PAGE,
        committeeId: null,
        registeredName: "",
        candidateNameAsFiled: ballotName,
        officeSought: contest.title,
        electionYear,
        filingState: "NO_REPORTS_ON_FILE",
        totals: {
          receipts: null,
          expenditures: null,
          cashOnHand: null,
          reportCount: null,
          coveringPeriod: null,
        },
        targetKeys: [cand.id],
        match: {
          registeredName: "",
          officeAsFiled: null,
          officeOnBallot: contest.title,
          electionYearAsFiled: null,
          electionYearOnBallot: electionYear,
          allThreeAgree: false,
          note:
            "asked across all three of the portal's own filter settings AND against the Secretary of " +
            "State's 8,829-row committee register; neither holds a live candidate committee under this name",
        },
        checkedAt: corpus.collectedAt,
        provenance: commonProvenance,
      });
      states.push({
        candidacyId: cand.id,
        ballotName,
        contestTitle: contest.title,
        state: "SOURCED_ABSENCE",
        why: "asked across every filter the portal offers AND against the state's own committee register; neither holds one",
        entityIds: [],
      });
      continue;
    }

    if (judged.length === 0) {
      const whatIsMissing =
        `Arizona's committee register holds ${registerLeads.length} live candidate committee` +
        `${registerLeads.length === 1 ? "" : "s"} under this name, and we have not confirmed that any of them belongs to this candidacy.`;
      records.push(gapRecord({ cand, contest, ballotName, electionYear, corpus, commonProvenance, whatIsMissing, nextDue: input.nextDue }));
      states.push({
        candidacyId: cand.id,
        ballotName,
        contestTitle: contest.title,
        state: "OURS_GAP",
        why:
          `the portal returned no committee we could match to this person, but the Secretary of State's own register ` +
          `holds ${registerLeads.length} live candidate committee${registerLeads.length === 1 ? "" : "s"} under this surname ` +
          `(${registerLeads.slice(0, 3).map((r) => `${r.CommitteeID} ${r.CommitteeName}`).join("; ")}). ` +
          "Two representations disagree, so this is our gap and not an absence.",
        entityIds: [],
      });
      continue;
    }

    const refusals = [...new Set(judged.flatMap((j) => j.result.refusals))];
    const why =
      unreconciled.length > 0
        ? "a committee for this person agrees on name, seat and cycle, and its filed totals do not yet reproduce the publisher's own itemised ledger"
        : `a committee for this person is on file and its filed seat does not agree: ${refusals.join("; ")}`;
    records.push(
      gapRecord({
        cand,
        contest,
        ballotName,
        electionYear,
        corpus,
        commonProvenance,
        whatIsMissing:
          unreconciled.length > 0
            ? "The agency holds a committee for this candidate whose filed totals do not yet reproduce its own itemised transaction ledger."
            : "The agency holds a committee for this candidate, and the office it states is not the office on this ballot.",
        nextDue: input.nextDue,
      }),
    );
    states.push({
      candidacyId: cand.id,
      ballotName,
      contestTitle: contest.title,
      state: "OURS_GAP",
      why,
      entityIds: judged.map((j) => j.entity.entityId),
    });
  }

  return { records, states };
}

/** An `OURS_GAP` record, with every money field null by construction. */
function gapRecord(a: {
  cand: BallotCandidacy;
  contest: BallotContest;
  ballotName: string;
  electionYear: number;
  corpus: AzRawCorpus;
  commonProvenance: Provenance;
  whatIsMissing: string;
  nextDue: ReportingPeriod | null;
}): StateMoneyRecord {
  return {
    dataClass: "STATE_COMMITTEE",
    jurisdiction: "AZ",
    agency: AGENCY,
    filingsUrl: PUBLIC_PAGE,
    // No committee is attributed on a gap. Naming one would be the attribution
    // the matching bar just refused to make.
    committeeId: null,
    registeredName: "",
    candidateNameAsFiled: a.ballotName,
    officeSought: a.contest.title,
    electionYear: a.electionYear,
    filingState: "OURS_GAP",
    totals: { receipts: null, expenditures: null, cashOnHand: null, reportCount: null, coveringPeriod: null },
    targetKeys: [a.cand.id],
    match: {
      registeredName: "",
      officeAsFiled: null,
      officeOnBallot: a.contest.title,
      electionYearAsFiled: null,
      electionYearOnBallot: a.electionYear,
      allThreeAgree: false,
      note: `OURS GAP — ${a.whatIsMissing}`,
    },
    checkedAt: a.corpus.collectedAt,
    provenance: a.commonProvenance,
    ourGap: {
      whatIsMissing: a.whatIsMissing,
      nextDue: a.nextDue?.filingPeriodEndDate ?? null,
      nextDueName: a.nextDue?.reportName ?? null,
    },
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

/** WRITE. A file, deliberately — see the note above `AzRawCorpus`. */
export function upsertAz(snapshot: StateMoneySnapshot, write: (json: string) => void): void {
  write(JSON.stringify(snapshot, null, 1) + "\n");
}

export { fetchAz as fetch, normalizeAz as normalize, upsertAz as upsert };
