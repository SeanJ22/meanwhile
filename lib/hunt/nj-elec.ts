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
