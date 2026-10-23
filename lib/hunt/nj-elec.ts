/**
 * NJ ELEC local campaign finance. The filings live on `njelecefilesearch.com`
 * (plain identified fetch, server-rendered), not on the agency's walled
 * brochure host `elec.nj.gov`.
 *
 * The search page drives a DataTables grid against `/api/VWEntity/Entities20`:
 * a form-encoded POST with the standard DataTables server-side request
 * (`draw`, `columns[i][data]`, `order`, `start`, `length`, `search`) plus the
 * filter fields. A JSON body is rejected.
 *
 * `CountyCode` is not an entity filter: it returns an unfiltered statewide
 * dump. The filter is `LocationCodes`. Every call is paired with a control
 * using a location code that cannot exist, and a response indistinguishable
 * from the control is EMPTY, never a hit.
 */

/** The records host; never `elec.nj.gov`, which is walled. */
export const ELEC_SEARCH_HOST = "https://www.njelecefilesearch.com";

/** The entity search the page's own grid calls. */
export const ELEC_ENTITY_ENDPOINT = `${ELEC_SEARCH_HOST}/api/VWEntity/Entities20`;

/** The page that carries the location-code option list. */
export const ELEC_LOCATION_PAGE = `${ELEC_SEARCH_HOST}/SearchEntityByLocation`;

/** A location code that cannot exist: the control identifier. */
export const ELEC_CONTROL_LOCATION = "999999";

/** The grid's columns, in the order the page declares them. */
export const ELEC_COLUMNS = [
  "ENTITYNAME",
  "LOCATION",
  "OFFICE",
  "PARTY",
  "ELECTIONTYPE",
  "ELECTIONYEAR",
  "ENTITY_S",
] as const;

export interface ElecEntity {
  entityId: string;
  /** As filed: `SURNAME, GIVEN`. Never reformatted here. */
  entityName: string;
  office: string;
  party: string;
  location: string;
  electionYear: string;
  electionType: string;
  totalContributions: number;
  totalExpenditures: number;
}

export interface ElecQuery {
  /** A code from the location dropdown. Municipality codes are four digits. */
  locationCode: string;
  electionYear: string;
  /** Candidate committees rather than PACs. */
  nonPacOnly?: boolean;
  length?: number;
  start?: number;
}

/**
 * The DataTables server-side request body, form-encoded. Exported as the
 * reference shape for other ASP.NET grids.
 */
export function elecRequestBody(q: ElecQuery): string {
  const p = new URLSearchParams();
  p.set("draw", "1");
  ELEC_COLUMNS.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c);
    p.set(`columns[${i}][name]`, c);
    p.set(`columns[${i}][searchable]`, "true");
    p.set(`columns[${i}][orderable]`, "true");
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });
  p.set("order[0][column]", "0");
  p.set("order[0][dir]", "asc");
  p.set("start", String(q.start ?? 0));
  p.set("length", String(q.length ?? 500));
  p.set("search[value]", "");
  p.set("search[regex]", "false");
  if (q.nonPacOnly !== false) p.set("NONPACOnly", "true");
  p.set("LocationCodes", q.locationCode);
  p.set("ElectionYears", q.electionYear);
  return p.toString();
}

export function normalizeElecRow(row: Record<string, unknown>): ElecEntity {
  const str = (k: string): string => (typeof row[k] === "string" ? (row[k] as string) : "");
  const n = (k: string): number => (typeof row[k] === "number" ? (row[k] as number) : 0);
  return {
    entityId: str("ENTITY_S"),
    entityName: str("ENTITYNAME"),
    office: str("OFFICE"),
    party: str("PARTY"),
    location: str("LOCATION"),
    electionYear: str("ELECTIONYEAR"),
    electionType: str("ELECTIONTYPE"),
    totalContributions: n("TOT_CONT_AMT"),
    totalExpenditures: n("TOT_EXP_AMT"),
  };
}

/** Parse the location-code option list out of the search page, so codes are read, not transcribed. */
export function parseLocationCodes(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<option value="(\d+)">\s*-*\s*([^<]+?)\s*<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[2].trim();
    if (name.length > 0) out.set(name.toUpperCase(), m[1]);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The second hop: where the money is.
 *
 * The entity listing's `TOT_CONT_AMT` and `TOT_EXP_AMT` are always zero and
 * must never be shown. The money is per entity at
 * `/api/VWEntity/GetEntityFilingData`.
 *
 * An amended report is a separate row for the same form and period, so rows
 * are collapsed to one per `(FormName, PERIOD)`, keeping the highest
 * `AMEND_NO` and breaking ties on the latest `DATE_RECEIVED`, and the
 * surviving periods are summed. Each report states its own period, not a
 * running total, so summing periods is correct.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One filed report, as ELEC's own filing endpoint returns it. */
export interface ElecFiling {
  entityId: number;
  /** Reporting period within the form. */
  period: number;
  /** 0 is the original; higher numbers are amendments of the same period. */
  amendNo: number;
  dateReceived: string | null;
  formName: string;
  amountReceived: number | null;
  amountDisbursed: number | null;
}

export const ELEC_FILING_ENDPOINT =
  `${ELEC_SEARCH_HOST}/api/VWEntity/GetEntityFilingData`;

export function elecFilingUrl(entityId: string, mode: "EntityOnly" | "CommitteeOnly" = "EntityOnly"): string {
  return `${ELEC_FILING_ENDPOINT}?ENTITY_S=${encodeURIComponent(entityId)}&${mode}=true`;
}

export function normalizeElecFiling(row: Record<string, unknown>): ElecFiling {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const entity = num(row.ENTITY_S), period = num(row.PERIOD), amendment = num(row.AMEND_NO);
  if (!Number.isSafeInteger(entity) || entity! <= 0 || !Number.isSafeInteger(period) || !Number.isSafeInteger(amendment) || amendment! < 0) throw new Error("ELEC_FILING_IDENTITY_INVALID");
  return {
    entityId: entity!,
    period: period!,
    amendNo: amendment!,
    dateReceived: typeof row.DATE_RECEIVED === "string" ? row.DATE_RECEIVED : null,
    formName: typeof row.FormName === "string" ? row.FormName : "",
    amountReceived: num(row.AMT_REC),
    amountDisbursed: num(row.AMT_DISB),
  };
}

export interface ElecMoneyTotal {
  receipts: number | null;
  disbursements: number | null;
  /** Reports counted AFTER amendments are collapsed. */
  reportsCounted: number;
  /**
   * Of those, how many are money-bearing: anything but a `D-1`, which only
   * registers the committee. A committee whose only filing is a D-1 has
   * reported nothing, not raised nothing.
   */
  moneyReports: number;
  /** Reports read before collapsing — the pair, so the collapse is visible. */
  reportsRead: number;
  /** The most recent `DATE_RECEIVED` among the counted reports. */
  latestFiling: string | null;
  /** Forms that contributed, so the figure can be checked against ELEC. */
  forms: string[];
}

/**
 * Collapse amendments, then sum. `D-1` counts as a report on file and
 * contributes nothing to the totals.
 */
export function totalElecMoney(filings: readonly ElecFiling[]): ElecMoneyTotal {
  const latestPerPeriod = new Map<string, ElecFiling>();
  for (const f of filings) {
    const key = `${f.entityId}#${f.formName}#${f.period}`;
    const held = latestPerPeriod.get(key);
    if (
      !held ||
      f.amendNo > held.amendNo ||
      (f.amendNo === held.amendNo && (f.dateReceived ?? "") > (held.dateReceived ?? ""))
    ) {
      latestPerPeriod.set(key, f);
    }
  }
  const counted = [...latestPerPeriod.values()];
  const money = counted.filter((f) => f.formName !== "D-1");
  const dates = counted.map((f) => f.dateReceived).filter((d): d is string => Boolean(d)).sort();
  return {
    receipts: money.length && money.every(f => f.amountReceived !== null) ? money.reduce((a, f) => a + f.amountReceived!, 0) : null,
    disbursements: money.length && money.every(f => f.amountDisbursed !== null) ? money.reduce((a, f) => a + f.amountDisbursed!, 0) : null,
    reportsCounted: counted.length,
    moneyReports: money.length,
    reportsRead: filings.length,
    latestFiling: dates.length ? dates[dates.length - 1].slice(0, 10) : null,
    forms: [...new Set(counted.map((f) => f.formName))].filter(Boolean).sort(),
  };
}
