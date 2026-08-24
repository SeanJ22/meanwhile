/**
 * **NJ ELEC — the `filing-campaign-finance-local` route, walked.**
 * (Built 2026-08-22, NJ Hunt 5 item 2.4, closing the largest of `NH71`'s nine.)
 *
 * ## The wall was on a different host, and that is the whole finding
 *
 * `NH71` recorded this as *the single highest-value unwalked route in this
 * state*, with the reason: **`elec.nj.gov` answers 212 bytes to a plain client,
 * which is a JavaScript application shell — rung 6 is owed.**
 *
 * Two things in that sentence were wrong, and RULING 52 predicts both.
 *
 * 1. **It is not an application shell. It is an Imperva/Incapsula bot-management
 *    challenge** — `<META NAME="robots" CONTENT="noindex,nofollow">` and an
 *    `/_Incapsula_Resource` script, served identically for every path on the
 *    host. Rung 6 would have cleared it; nobody needed to.
 * 2. **The records are not on that host.** `elec.nj.gov` is the agency's
 *    brochure site. The filings live on `njelecefilesearch.com`, which answers
 *    **rung 2** at HTTP 200 with 166 KB of server-rendered HTML and no challenge
 *    at all. It was reached by walking rung 5 against the walled host — the
 *    reader-service rendering listed the search links — and then simply asking
 *    the host they pointed at.
 *
 * A wall on one host was recorded as a wall on the fact. It was one measurement
 * on one route, and the fact was one hop away.
 *
 * ## Rung 7 — the page's own network calls
 *
 * The search page drives a DataTables grid against `/api/VWEntity/Entities20`.
 * It is a **form-encoded** POST carrying the standard DataTables server-side
 * request (`draw`, `columns[i][data]`, `order`, `start`, `length`, `search`)
 * plus the filter fields, and the API rejects a JSON body with
 * `{"errors":{"Columns":["The Columns field is required."]}}` — which is a
 * useful error and is why the shape is worth writing down rather than
 * rediscovering.
 *
 * ## RULING 68 caught a false hit here, and it is worth stating exactly
 *
 * The first working request used `CountyCode`, which is the parameter the page
 * uses to POPULATE THE MUNICIPALITY DROPDOWN and is not a filter on the entity
 * search at all. The API accepted it, answered **HTTP 200 with 47,737 bytes and
 * `recordsTotal: 326271`**, and the first row was a union PAC from 1995.
 *
 * Without a control query that would have been recorded as *200 filed
 * campaign-finance entities for Rockaway Township*. The control — the same
 * request with a location code that cannot exist — returned **byte-identical**
 * output, which is what named it as an unfiltered statewide dump. The real
 * filter is `LocationCodes`, and with it the subject returns 8 rows, the sibling
 * municipality returns 11, and both controls return 0.
 *
 * So: **every call this module makes is paired with a control**, and a response
 * indistinguishable from the control is EMPTY rather than a hit.
 */

/** Rung 2. The records host — never `elec.nj.gov`, which is Incapsula-walled. */
export const ELEC_SEARCH_HOST = "https://www.njelecefilesearch.com";

/** The entity search the page's own grid calls. Rung 7. */
export const ELEC_ENTITY_ENDPOINT = `${ELEC_SEARCH_HOST}/api/VWEntity/Entities20`;

/** The page that carries the location-code option list. */
export const ELEC_LOCATION_PAGE = `${ELEC_SEARCH_HOST}/SearchEntityByLocation`;

/**
 * A location code that cannot exist. RULING 68 — the control identifier, kept
 * beside the route rather than invented per call site.
 */
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
}

/**
 * The DataTables server-side request body, form-encoded.
 *
 * Exported because the shape is the discovery — a session walking another
 * ASP.NET grid in another state should read this rather than re-deriving it
 * from a 400.
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
  p.set("start", "0");
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

/** The location codes for the two municipalities at 07866, read from the page. */
export const ELEC_LOCATION_CODES_MORRIS: Readonly<Record<string, string>> = {
  "ROCKAWAY TOWNSHIP": "1435",
  "ROCKAWAY BOROUGH": "1434",
};

/**
 * Parse the location-code option list out of the search page, so the codes are
 * READ rather than transcribed. A hand-kept code table is the separator-broken
 * allowlist defect waiting to happen.
 */
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
 * THE SECOND HOP — WHERE THE MONEY ACTUALLY IS.
 * (Added 2026-08-24, the state-campaign-money session. A NEW ROUTE: it did not
 * exist at session start, and it is recorded in `docs/expansion-log.md`.)
 *
 * ## The false zero this closes, and it would have shipped
 *
 * The entity listing above returns `TOT_CONT_AMT` and `TOT_EXP_AMT` on every
 * row. **They are ALWAYS ZERO.** Not sometimes, and not only for the current
 * cycle: measured across ROCKAWAY TOWNSHIP, RANDOLPH TOWNSHIP and MORRIS COUNTY
 * for 2026, 2025, 2024 and 2023 — twelve location-years, 158 rows — **every
 * single one reads 0**, including cycles that finished years ago and whose
 * candidates demonstrably raised six figures.
 *
 * The fields exist, they parse, they are numbers, and they mean nothing. A
 * reader would have been shown *raised $0* on 202 named candidates' cards.
 * That is not a missing figure; it is a **false claim about a real person's
 * campaign**, and every instrument in this repo would have called it healthy,
 * because the extraction returned a number.
 *
 * The money is one hop further on, per entity, at
 * `/api/VWEntity/GetEntityFilingData` — the same page's own network call
 * (ladder rung 7). Ann Grossi's 2019 committee returns 26 filings summing
 * $204,571.68 in receipts; the entity row for the same committee says $0.
 *
 * ## AMENDMENTS ARE WHY THIS CANNOT BE A `SUM()`
 *
 * A filed report can be amended, and the amendment is a SEPARATE ROW for the
 * same form and the same period. Ann Grossi's 2023 committee files `R-1`
 * period 3 twice — the same $9,265 in receipts, different disbursements — so a
 * naive sum reports $237,109 where the truth is lower. **A total that
 * reconciles is not a total that is correct** (RULING 100).
 *
 * So the rows are collapsed to one per `(FormName, PERIOD)`, keeping the
 * highest `AMEND_NO` and breaking ties on the latest `DATE_RECEIVED`, and the
 * surviving periods are summed.
 *
 * ## AND THE PERIOD/CUMULATIVE QUESTION IS ANSWERED BY MEASUREMENT
 *
 * Summing periods is only correct if each report states its OWN period rather
 * than a running total. It does, and the evidence is in the data rather than in
 * an assumption: Paul DeGroot's 2023 `R-1` period 5 reports $24,977.25 while
 * his period 3 reports $39,777.95. A cumulative series cannot decrease.
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
  amountReceived: number;
  amountDisbursed: number;
}

export const ELEC_FILING_ENDPOINT =
  `${ELEC_SEARCH_HOST}/api/VWEntity/GetEntityFilingData`;

export function elecFilingUrl(entityId: string, mode: "EntityOnly" | "CommitteeOnly" = "EntityOnly"): string {
  return `${ELEC_FILING_ENDPOINT}?ENTITY_S=${encodeURIComponent(entityId)}&${mode}=true`;
}

export function normalizeElecFiling(row: Record<string, unknown>): ElecFiling {
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    entityId: num(row.ENTITY_S),
    period: num(row.PERIOD),
    amendNo: num(row.AMEND_NO),
    dateReceived: typeof row.DATE_RECEIVED === "string" ? row.DATE_RECEIVED : null,
    formName: typeof row.FormName === "string" ? row.FormName : "",
    amountReceived: num(row.AMT_REC),
    amountDisbursed: num(row.AMT_DISB),
  };
}

export interface ElecMoneyTotal {
  receipts: number;
  disbursements: number;
  /** Reports counted AFTER amendments are collapsed. */
  reportsCounted: number;
  /**
   * Of those, how many are MONEY-BEARING — anything but a `D-1`.
   *
   * This is the difference between a committee that exists and a committee
   * that has reported. A `D-1` is a certificate of organization: it registers
   * the committee and says nothing whatever about money. A candidate whose
   * only filing is a D-1 has NOT reported raising nothing; they have reported
   * nothing at all, and rendering `$0` for them is the same false claim the
   * entity listing's always-zero columns would have made, one floor down.
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
 * Collapse amendments, then sum. See the amendment note above.
 *
 * `D-1` is the certificate of organization — it registers a committee and
 * reports no money — so it is counted as a report on file and contributes
 * nothing to the totals. Excluding it from the SUM but not from the COUNT is
 * the distinction between "has this committee filed anything" and "how much has
 * it reported", and those are different questions a card asks separately.
 */
export function totalElecMoney(filings: readonly ElecFiling[]): ElecMoneyTotal {
  const latestPerPeriod = new Map<string, ElecFiling>();
  for (const f of filings) {
    const key = `${f.formName}#${f.period}`;
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
    receipts: money.reduce((a, f) => a + f.amountReceived, 0),
    disbursements: money.reduce((a, f) => a + f.amountDisbursed, 0),
    reportsCounted: counted.length,
    moneyReports: money.length,
    reportsRead: filings.length,
    latestFiling: dates.length ? dates[dates.length - 1].slice(0, 10) : null,
    forms: [...new Set(counted.map((f) => f.formName))].filter(Boolean).sort(),
  };
}
