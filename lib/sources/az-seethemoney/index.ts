/**
 * **ARIZONA STATE CAMPAIGN MONEY — the Secretary of State's own portal.**
 * (Session C2, 2026-08-31. RULING 126, RULING 205, RULING 206, RULING 207.)
 *
 * The route portfolio for `seethemoney.az.gov` and `ftp://ftp.azsos.gov/`,
 * which together are the Arizona Secretary of State's published campaign
 * finance record for statewide and legislative offices — the offices A.R.S.
 * § 16-928 makes the Secretary of State the filing officer for, quoted in
 * `data/campaign-finance/filing-regimes.json`.
 *
 * ## THE VENDOR IS NOT THE RECORD, AND ONE ROUTE IS NOT THE PORTFOLIO
 *
 * RULING 206 and RULING 207. There are FOUR materially distinct
 * representations here and each carries facts the others do not:
 *
 * | Route | Carries what nothing else does |
 * | --- | --- |
 * | `GetNEWTableData` | the per-office, per-party breakdown of a committee's cycle activity |
 * | `GetNEWDetailedTableData` | the ITEMISED transactions — the only independent statement of a total |
 * | `GetDetailedInformation` | the committee's filed officers, address, office sought and status |
 * | `ftp://ftp.azsos.gov/cfsdata2/` | the whole 8,829-row committee REGISTER with organization and termination dates, and the filing CALENDAR |
 *
 * A 200 from any one of them retires none of the others. The register in
 * particular is what separates a candidate's live 2026 committee from a
 * terminated committee for a different election, and no portal endpoint states
 * that.
 *
 * ## THE REQUEST SHAPE, WHICH IS THE PART NOBODY COULD GUESS
 *
 * Both table endpoints are **server-side DataTables actions**: the filters ride
 * in the QUERY STRING and the POST body must be the DataTables form encoding
 * INCLUDING its `columns[N][data]` array, because that array is the projection
 * the action builds its result from. A guessed body answers HTTP 200 with a
 * two-byte empty string, which is a statement about the request and never about
 * Arizona's records (RULING 100).
 *
 * **`GetNEWDetailedTableData` needs one parameter more than the summary does,
 * and its absence is silent.** Without `entityId` it answers HTTP 200 with
 * `recordsTotal: 0` — a well-formed, entirely empty, entirely wrong answer.
 * `Name=1~<id>` alone is NOT enough; `entityId=<id>` is the load-bearing one.
 * That is why `detailQuery` refuses to build a URL without it rather than
 * letting a caller receive a zero-row extraction and read it as an absence.
 *
 * ## WHAT THE FILTER DEFAULTS HIDE, AND WHY THAT MATTERS MORE THAN THE SHAPE
 *
 * The portal's default view is `IsLessActive=false`, and it returns **370 rows
 * in 255 entities** for the 2025-2026 cycle. `IsLessActive=true` returns **844
 * rows in 716 entities** — 461 entities the default query never shows. A
 * `ShowOfficeHolder=true` query returns a further disjoint 16.
 *
 * A candidate sitting behind either flag, asked for with the defaults, comes
 * back as nothing. Recording that as *no reports on file* would be an absence
 * manufactured by our own query — the exact failure RULING 100 names. So the
 * universe this adapter walks is the UNION of all three, never the default.
 *
 * ## THE PERSONAL DATA IN THE DETAIL ROWS NEVER LANDS
 *
 * Itemised transaction rows carry contributor name, occupation, employer, city
 * and zip — the schema RULING 167 is a standing rule about. This adapter reads
 * them to compute a SUM and returns aggregates. `aggregateDetail` is the only
 * function that sees a transaction row and it returns numbers; no caller can
 * obtain the rows themselves, so no caller can persist them.
 *
 * ## Permission, measured rather than assumed (2026-08-31)
 *
 * `seethemoney.az.gov/robots.txt` — **HTTP 404, identically to a bare client,
 * to an identified client and to a browser-identified client**, so the 404 is
 * about the host and not about us. No terms document (404). No challenge, no
 * credential, no authentication of any kind. `apps.azsos.gov/robots.txt` — HTTP
 * 200, `Crawl-delay: 5`, disallowing `/apps/`, `/scripts/`, `/poll/`,
 * `/election/EOC2015/` and `/cptest/`; no rule reaches the FTP service. The FTP
 * is anonymous and the Secretary of State's own Bulk Filing Guide publishes the
 * path.
 *
 * **An absence of stated restriction is not a grant**, and the standing limits
 * govern regardless: no authentication, no circumvention, no rate that degrades
 * service, nothing not already published.
 */

import {
  judgeMatch,
  namesAgree,
  type MatchBasis,
  type StateMoneyRecord,
  type StateMoneySnapshot,
} from "../../funding/state-money.ts";
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

/**
 * Identification the host serves. We are not pretending to be anyone: the
 * headers name a person and a purpose. No credential is sent and none is
 * needed.
 */
export const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  accept: "application/json, text/javascript, */*; q=0.01",
  "x-requested-with": "XMLHttpRequest",
  origin: BASE,
  referer: `${BASE}/Reporting/Explore`,
  from: "seanj22@gmail.com",
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
 * THE THREE QUERIES THAT TOGETHER ARE THE UNIVERSE.
 *
 * Stated as data rather than as a comment, so a caller cannot walk one of them
 * and believe it walked the source. Measured 2026-08-31 at `JurisdictionId=0`
 * for 2025-2026: 370 rows / 255 entities, 844 / 716, and 16 / 16.
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
 * THE DETAIL QUERY, AND THE PARAMETER WHOSE ABSENCE IS SILENT.
 *
 * Without `entityId` this endpoint answers HTTP 200 and `recordsTotal: 0`. A
 * zero-row extraction is a FAILED extraction, never an empty document, and the
 * only defence against reading one as an absence is refusing to build the
 * request that produces it.
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
 * Parse a DataTables reply, and REFUSE anything that is not one.
 *
 * The two-byte `""` this API returns for a malformed request is valid JSON, so
 * a bare `JSON.parse` succeeds and a caller reading `.data ?? []` gets an empty
 * array and no error. That is the shape RULING 100 exists for: an operation
 * that can return nothing must be asked what it returned.
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
 * `"Accalia, Jayme <br>(102162)"` → `{ family: "Accalia", given: "Jayme" }`.
 *
 * The id is already carried in `EntityID`, so it is stripped rather than
 * re-parsed: two sources for one fact is how they come to disagree.
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
 * THE OFFICE KEY, AND WHY IT IS AN EXACT SEAT RATHER THAN A CLASS.
 *
 * `officesAgree` in `lib/funding/state-money.ts` compares office CLASSES, and
 * every Arizona office on this ballot is class `STATE`. That is correct for the
 * shared bar and nowhere near enough here: it would let a Governor candidate's
 * name match a State Senate committee for a person of the same name.
 *
 * So this adapter adds a guard that NARROWS. Both vocabularies map onto one
 * canonical seat key and the keys must be EQUAL. Arizona's two sides speak
 * differently — the ballot says `State Senator, District 19` and the filing
 * says `State Senator - District No. 19` — and an office neither side can key
 * is `null`, which never agrees with anything.
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
 * THE NEXT DUE DATE, READ FROM THE STATE'S OWN CALENDAR.
 *
 * An OURS GAP is only honest when a reader can be told when it will next be
 * worked, and a date this product invented would not be that. This returns the
 * next filing deadline the Secretary of State publishes for candidate
 * committees in the cycle, or `null` when the calendar states none after the
 * given day — which is a fact about the calendar and is reported as one.
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
 * FOLD THE PER-OFFICE, PER-PARTY ROWS INTO ONE ENTITY.
 *
 * A candidate returns up to three rows sharing one `EntityID`: office and party
 * both stated, office stated and party null, and office empty with party
 * stated. `CashBalance` repeats identically on all of them — measured over the
 * 94 multi-row entities in the 2025-2026 cycle, 94 of 94 — which is what makes
 * it an ENTITY attribute rather than a partition, and `Income`/`Expense` the
 * partitions.
 *
 * **That much is structure. Whether the partitions SUM to the cycle total is a
 * question about the data and it is answered by measurement, not by this
 * function** — see `scripts/state-money-az.mts` and
 * `data/campaign-finance/az-seethemoney-2026-reconciliation.json`.
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
 * THE ONLY FUNCTION THAT SEES AN ITEMISED TRANSACTION, AND IT RETURNS NUMBERS.
 *
 * Detail rows carry `TransactionFirstName`, `TransactionLastName`,
 * `TransactionOccupation`, `TransactionEmployer`, `TransactionCity` and
 * `TransactionZipCode` — the contributor schema RULING 167 is a standing rule
 * about. Nothing downstream is given the rows, so nothing downstream can
 * persist them.
 */
export function aggregateDetail(rows: readonly { Amount?: number | null }[]): DetailAggregate {
  let sum = 0;
  for (const r of rows) sum += r.Amount ?? 0;
  return { count: rows.length, sum: Math.round(sum * 100) / 100 };
}

/**
 * THE ARIZONA GUARD, AND IT ONLY EVER NARROWS.
 *
 * `judgeMatch` is the shared bar and stays exactly where it is — this cannot
 * lower it, because it demands `judgeMatch` agree AND adds two conditions of
 * its own:
 *
 * - **The exact seat.** Both sides key to one canonical Arizona seat and the
 *   keys must be equal, so a Governor candidate cannot inherit a State Senate
 *   committee belonging to somebody with the same name.
 * - **The cycle.** A committee the state's own register shows TERMINATED before
 *   the cycle opened is a committee for a DIFFERENT ELECTION. It is not a weak
 *   lead about this candidacy; it is a strong fact about another one.
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
  /*
   * THE SHARED BAR IS APPLIED TO THE NAME FORMS THE PUBLISHERS ACTUALLY WROTE.
   *
   * `judgeMatch` calls `namesAgree` on the strings it is handed, and a ballot
   * name carrying a quoted alternate — `Rachel "Jones" Keshel` — is two names
   * written as one. Handing that string in unparsed makes the shared test
   * refuse a person it would otherwise recognise, which is a defect in the
   * INPUT, not a reason to soften the test.
   *
   * So the agreeing variant pair is resolved first and `judgeMatch` receives
   * that. When no pair agrees, the originals go in and it reports the honest
   * failure in the words a reviewer needs.
   */
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
 * **AN ABSENCE NEEDS TWO REPRESENTATIONS TO AGREE, NOT ONE TO BE QUIET.**
 *
 * RULING 206: the portal is a filing cabinet and the register is another. If
 * the Secretary of State's own 8,829-row `Committees.txt` holds a live
 * candidate committee under this surname, then our failure to match it in the
 * portal is OUR gap — and writing *no reports on file* on a candidate's card
 * would be asserting an absence out of our own empty result, which is the one
 * thing the transparency mandate forbids outright.
 *
 * The surname is deliberately the whole test. It is coarse, and coarse is the
 * safe direction here: a false hit costs an OURS GAP, which is honest, while a
 * false miss costs a false claim about a named person's campaign.
 *
 * Returns the register rows that stand in the way, empty when none do.
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

/*
 * ---------------------------------------------------------------------------
 * THE THREE VERBS EVERY ADAPTER EXPORTS.
 *
 * `upsert` writes a FILE rather than a table, and that is the design: this
 * corpus lives in `data/funding/` and is structurally unreachable from
 * Postgres, which is wall 1 of the campaign-finance firewall
 * (`tests/campaign-finance-firewall.test.ts`). An adapter that could write it
 * to a database would be a hole in that wall.
 * ---------------------------------------------------------------------------
 */

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
   * THE ENTITIES WHOSE FIGURES HAVE BEEN RECONCILED AGAINST THE PUBLISHER'S OWN
   * ITEMISED LEDGER, one by one.
   *
   * A `FILED` record puts a dollar figure under a named person's photograph,
   * and a wrong one there is a worse failure than an empty drop-down by a wide
   * margin. So this is a SET rather than a flag: the licence to publish is
   * granted per committee by a measurement of that committee, and an entity
   * absent from this set cannot become a `FILED` record no matter what else
   * agrees.
   *
   * Populated by `reconcileEntity` from the itemised ledger.
   */
  reconciledEntityIds: ReadonlySet<number>;
  nextDue: ReportingPeriod | null;
}

/**
 * DOES THE SUMMARY AGREE WITH THE PUBLISHER'S OWN ITEMISED LEDGER?
 *
 * The summary endpoint returns a candidate as several rows partitioned by
 * office and party. Session C tested whether those rows are PARTS by checking
 * `sum(Income) - sum(Expense) == CashBalance`, found it held for 134 of 255 and
 * broke for 121, and correctly refused to ship anything on it.
 *
 * **That test could not have succeeded, and the reason is a fact about the
 * data rather than about the effort.** `CashBalance` is repeated identically on
 * every row of an entity and does not move with the query window: it carries a
 * balance brought forward from before the cycle. Checking a within-window sum
 * against an across-window balance compares two different quantities, and the
 * 134 that agreed were the committees that happened to start from nothing.
 *
 * The independent statement that CAN settle it is the itemised transaction
 * ledger, which is the same publisher listing the same money one line at a
 * time. Measured 2026-08-31 over all 255 entities and 370 rows of the
 * 2025-2026 cycle: **`sum(summary Income) == sum(itemised income)` holds for
 * 255 of 255 and breaks for 0**, and the same for expense. The rows are parts
 * and their sum is the cycle total.
 *
 * This function is what keeps that a MEASUREMENT rather than a belief: it is
 * re-run per committee on every walk, and a committee that stops agreeing
 * stops rendering.
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
 * NORMALIZE — the certified ballot on one side, the register on the other.
 *
 * Three outcomes and no fourth, per candidacy:
 *
 * - **SOURCED_FILED.** A committee agrees on name, exact seat and cycle, and
 *   the cycle-total semantics are proven. Its filed figures render.
 * - **SOURCED_ABSENCE.** The union of all three universe queries holds no
 *   committee for this person at all. The agency was asked, on a stated date,
 *   and holds nothing. That is a fact about the records.
 * - **OURS_GAP.** A committee for this person exists and something we have not
 *   resolved stands between it and a figure — the seat disagrees, or the
 *   semantics of the figure are not established. This is OUR gap, it says so,
 *   and it carries the agency's own next filing deadline.
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
        /*
         * **A REGISTERED COMMITTEE REPORTING NOTHING IS NOT A COMMITTEE THAT
         * RAISED $0, AND IT IS NOT A REGISTRY HOLDING NOTHING EITHER.**
         *
         * `REGISTERED_NO_ACTIVITY_REPORTED` was added to the shared contract on
         * 2026-08-31 after this exact shape rendered *"No reports on file"* for
         * six named New Hampshire candidates whose committees the state had
         * named, with an id, an office and a cycle. Arizona hits the same shape
         * — Duwayne Collier's Secretary of State committee is registered,
         * reconciles against an itemised ledger of zero transactions, and has
         * reported no money.
         *
         * So the figures go null rather than zero and the record says what the
         * agency actually published: this committee exists and has reported
         * nothing. `$0` would be a claim about his campaign.
         */
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
            // The portal repeats one closing balance on every row of an
            // entity, and it does NOT equal receipts minus expenditures inside
            // this window — measured, and recorded in the reconciliation
            // artifact. It carries something the window does not contain, so
            // it is not published as this cycle's cash on hand.
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

/**
 * An `OURS_GAP` record, and every money field is null by construction.
 *
 * It is built here rather than at each call site so no branch can add a figure
 * to one: the shape of the function is the guarantee, and
 * `tests/state-money-az.test.ts` asserts it over the shipped snapshot as well.
 */
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
 * **A QUOTED SEGMENT IN A NAME IS AN ALTERNATE NAME, NOT A NAME TOKEN.**
 *
 * Both sides of this join annotate names the same way and nothing was reading
 * the annotation. Arizona's certified ballot carries `Rachel "Jones" Keshel`,
 * `Nicholas "Nick" Myers`, `Hollace "Holly" Lyon` and `Walter "Les" Presmyk`;
 * the Secretary of State's register carries `Slawson, Fred "Ryan"` and
 * `Presmyk, Walter "Les"`. The quotes are the publisher saying *also known as*.
 *
 * Treated as ordinary text, the quoted word becomes a token that can never
 * match anything, and `namesAgree` — correctly, on the input it was given —
 * refuses. **Measured on this ballot, that turned five live committees into
 * five manufactured absences**, including Rachel Keshel's, which had filed
 * $47,878.92 and would have rendered as *no reports on file*.
 *
 * So a name with a quoted segment expands into the two names it actually
 * states, and `namesAgree` is applied UNCHANGED to the pairs. This does not
 * loosen the bar by a hair: every variant still has to satisfy the shared test
 * in full. It stops handing that test a string the publisher never meant as one
 * name.
 *
 * `Tom Horne` against the filed `Horne, Thomas Chalres` is the control. There
 * is no annotation there — it is a diminutive, and no rule here invents one. He
 * stays unmatched, which is the correct outcome and the honest one.
 */
export function nameVariants(name: string): string[] {
  const cleaned = name.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  const quoted = [...cleaned.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1].trim()).filter(Boolean);
  const withoutQuoted = cleaned.replace(/["“”][^"“”]+["“”]/g, " ").replace(/\s+/g, " ").trim();
  if (quoted.length === 0) return [cleaned];
  /*
   * THE QUOTED PART CAN STAND IN FOR EITHER END OF THE NAME, and which one it
   * is differs across this very ballot:
   *
   *   Nicholas "Nick" Myers    the quoted part replaces the GIVEN name
   *   Rachel "Jones" Keshel    the quoted part replaces the FAMILY name
   *
   * Both appear, the publisher marks them identically, and nothing in the
   * string says which is meant. So both readings are generated and the shared
   * `namesAgree` decides — a variant that describes nobody simply matches
   * nobody, while assuming one reading would have dropped whichever candidate
   * used the other.
   */
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
 * Person identity, using the SHARED test rather than an Arizona one.
 *
 * `namesAgree` demands every token of the shorter name appear in the longer and
 * refuses a single shared token, so `Smith` is not a person. Arizona files
 * `SURNAME, FORENAME` and the ballot carries `Forename Surname`; the token-set
 * comparison answers that without a fuzzy threshold nobody could defend under a
 * candidate's photograph. What this adds is `nameVariants` on both sides —
 * parsing, not fuzz.
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
