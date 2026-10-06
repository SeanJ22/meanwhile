/**
 * **PROVIDER TWO — CAMPAIGN FINANCE.** (Session C, PART D1/D2, 2026-08-31.)
 *
 * ## Why this file exists, stated as the defect it closes
 *
 * `lib/control-plane/campaign-finance/obligations.ts` models a genuinely local
 * campaign-finance obligation against a real committed ballot. Before this
 * provider, every caller was either its own definition or a test. **A domain
 * obligation reachable only from tests is a failure**: the tests were written
 * beside the model and cannot disagree with it, and no unattended process ever
 * opened one of its routes.
 *
 * This provider puts campaign-finance records into the same scheduler the
 * research corpus goes through, so a due Arizona or New Hampshire route opens
 * an occurrence, a WorkItem, a RouteTask, an Attempt, a disposition, debt and a
 * persisted next-due exactly as a body's calendar does — with no operator
 * choosing a finance hunt.
 *
 * ## THE PORTFOLIO IS THE POINT (RULING 207)
 *
 * Each record below carries SEVERAL routes and every one of them is scheduled
 * independently. `ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE` is not a
 * slogan a report satisfies; it is a property of the schedule. A 200 from the
 * SeeTheMoney DataTables action does not mark the FTP bulk drop worked, does
 * not clear its debt, and does not move its clock — because they are different
 * scheduled units over one record.
 *
 * ## What each descriptor rests on, and what it does not claim
 *
 * ```
 *   az-sos-seethemoney-datatables   MEASURED 2026-08-31: recordsTotal 370 for
 *                                   the 2025-2026 cycle at JurisdictionId=0.
 *                                   Registered on the parameter shape the
 *                                   method store records. AWAITING ADAPTER —
 *                                   the row semantics are UNDETERMINED and
 *                                   nothing here publishes a per-person total
 *   az-sos-cfs-bulk-ftp             RULING 166's rung ZERO. Anonymous, live
 *                                   2026-08-26, 8,828 committees and 109
 *                                   filing jurisdictions. This process holds
 *                                   NO FTP CLIENT, so it disposes
 *                                   REQUIRES_NEW_ADAPTER — a fact about our
 *                                   tooling, never about the record
 *   az-pima-easyvote-public-filings The county portal recorded UNWALKED on
 *                                   2026-08-26. A GET, and the first reading
 *                                   of it is this scheduler's
 *   nh-cfs-filing-entity-details    PROVEN 2026-08-31 by `pnpm money:nh`: a
 *                                   plain server-side POST answers 200 with
 *                                   JSON. CORS bound the browser, not us
 *   nh-cfs-transaction-detail       The contribution and expenditure detail
 *                                   sits behind endpoints nobody has derived.
 *                                   A SCOUT's job, and it says so
 *   nh-sos-lobbyist-registry        A source class this product holds nothing
 *                                   of in any state except Arizona, on a host
 *                                   whose permission is now ANSWERED
 *   nh-sos-records-request          Rung 13. PUBLIC RECORD STILL OWED —
 *                                   HUMAN/OFFLINE ACCESS REQUIRED. It keeps a
 *                                   clock so it cannot be forgotten, and it
 *                                   can never be discharged by a machine
 * ```
 *
 * ## The 403 that was our own name
 *
 * `www.sos.nh.gov` answers 200 to a bare client and 403 to the identical
 * request carrying this project's name in the User-Agent. Until 2026-09-25 the
 * lobbyist-registry descriptor left the name out of the User-Agent to get past
 * that filter. The owner decision of 2026-09-25 rules that out (access
 * controls are never bypassed; a filter that refuses an identified client is
 * one), so every descriptor here sends the route executor's identified
 * User-Agent, with `From:` and `X-Purpose:` added beside it. A 403 is a
 * technical failure of the route, pursued by other public routes.
 *
 * ## HOW LANE AZ AND LANE NH SLOT IN — by CONTRACT, not by conversation
 *
 * `data/campaign-finance/route-descriptors/*.json` is read FIRST when present.
 * Each file is `{ "records": ProvidedObligationSpec[] }` using the same
 * `RouteDescriptor` shape as the built-ins, minus nothing. A file that lands
 * replaces the built-in record with the SAME `subjectId` wholesale, so a lane
 * that confirms a live route ships one JSON file and changes no code here.
 * A file that parses to zero records is a FAILED read and is reported as one.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { arizonaLocalObligation } from "../../campaign-finance/obligations.ts";
import { ballotFinanceObligations, ballotFinanceScheduledId, type BallotFinanceInputs } from "../../campaign-finance/obligations.ts";

import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const CAMPAIGN_FINANCE_PROVIDER_ID = "campaign-finance";

/** Where a lane drops a confirmed route descriptor file. The contract path. */
export const DESCRIPTOR_DIR = ["data", "campaign-finance", "route-descriptors"] as const;

/**
 * Identification the New Hampshire host family actually serves.
 *
 * `INGEST_CONTACT_EMAIL` is the repository's existing contact variable and is
 * read by NAME. Unset, the header is omitted and `X-Purpose` still says why we
 * are here — a slower route to a conversation, never a disguise.
 */
function identifiedHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  return {
    "x-purpose": "civic campaign-finance index for a public-records product",
    ...(from ? { from } : {}),
  };
}

/* ------------------------------------------------------- Arizona, statewide */

/**
 * The DataTables request the Arizona portal actually answers.
 *
 * The filters ride in the QUERY STRING and the body is the standard DataTables
 * form encoding INCLUDING `columns[N][data]`, because that array is the
 * projection the action builds its result from. Recorded in the method store as
 * `datatables-endpoint-needs-its-column-array`; the three filters that were
 * missing until 2026-08-31 are `IsLessActive`, `ShowOfficeHolder` and
 * `ChartName`.
 */
/*
 * MEASURED FROM THE RESPONSE, not guessed. A live cycle on 2026-08-31 returned
 * `recordsTotal` 370 and rows carrying exactly these keys, so the projection is
 * written from what the action actually emits rather than from a plausible
 * guess at what it might. `EntityLastName` arrives as
 * `"Accalia, Jayme <br>(102162)"` — presentation markup inside a data field,
 * which the normalizer carries verbatim and names rather than silently
 * stripping.
 */
const AZ_DATATABLE_COLUMNS = [
  "EntityID",
  "EntityFirstName",
  "EntityLastName",
  "CommitteeName",
  "EntityTypeName",
  "OfficeName",
  "PartyName",
  "Income",
  "Expense",
  "IESupport",
  "IEOpposition",
  "CashBalance",
] as const;

function azDataTablesBody(): string {
  const form = new URLSearchParams();
  form.set("draw", "1");
  AZ_DATATABLE_COLUMNS.forEach((name, i) => {
    form.set(`columns[${i}][data]`, name);
    form.set(`columns[${i}][name]`, name);
    form.set(`columns[${i}][searchable]`, "true");
    form.set(`columns[${i}][orderable]`, "true");
    form.set(`columns[${i}][search][value]`, "");
    form.set(`columns[${i}][search][regex]`, "false");
  });
  form.set("order[0][column]", "0");
  form.set("order[0][dir]", "asc");
  form.set("start", "0");
  form.set("length", "500");
  form.set("search[value]", "");
  form.set("search[regex]", "false");
  return form.toString();
}

const AZ_DATATABLES_QUERY = new URLSearchParams({
  Page: "1",
  startYear: "2025",
  endYear: "2026",
  JurisdictionId: "0",
  TablePage: "1",
  TableLength: "500",
  TableSearch: "",
  Name: "",
  NameId: "",
  CommitteeId: "",
  BallotMeasureId: "",
  OfficeID: "",
  PartyID: "",
  ShowAllYears: "false",
  IsLessActive: "false",
  ShowOfficeHolder: "false",
  ChartName: "1",
  URLHash: "",
  ExportOptions: "",
}).toString();

const AZ_ROUTES: readonly RouteDescriptor[] = [
  {
    routeId: "az-sos-cfs-bulk-ftp",
    label: "ftp://ftp.azsos.gov/cfsdata2/ — Arizona's own bulk campaign-finance drop",
    executorClass: "DETERMINISTIC",
    executorReason:
      "an anonymous FTP LIST and RETR is deterministic once a client exists; no model is needed " +
      "to read a directory the state's own Bulk Filing Guide names",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "ftp://ftp.azsos.gov/cfsdata2/",
      reason:
        "THIS PROCESS HOLDS NO FTP CLIENT. The drop was walked 2026-08-26 and is anonymous, live, " +
        "and carries 8,828 Arizona campaign committees and the state's 109 filing jurisdictions. " +
        "That is RULING 166's rung ZERO and it outranks every page-by-page route below it. The " +
        "missing piece is an adapter in this repository, which is a fact about OUR tooling and is " +
        "never a fact about the record — REQUIRES_NEW_ADAPTER, and the obligation stays live.",
    },
    citation:
      "docs/governance/policies/discovery.md — RULING 166, measured 2026-08-26; " +
      "docs/body-or-intermediary-audit.md — 'The FTP: YES, 2026-08-26. 8,828 committees.'",
    awaitingAdapter:
      "an FTP client. Until one exists this route disposes REQUIRES_NEW_ADAPTER on a clock rather " +
      "than being forgotten, which is the difference between a named next move and an absence.",
  },
  {
    routeId: "az-sos-seethemoney-datatables",
    label: "seethemoney.az.gov /Reporting/GetNEWTableData — the statewide filer index",
    executorClass: "DETERMINISTIC",
    executorReason:
      "the request shape is WRITTEN DOWN in the method store, so replaying it is deterministic. " +
      "Spending a model to re-derive a body we already measured is spending tokens on a known answer",
    open: {
      kind: "HTTP_POST",
      url: `https://seethemoney.az.gov/Reporting/GetNEWTableData/?${AZ_DATATABLES_QUERY}`,
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      body: azDataTablesBody(),
      headers: {
        origin: "https://seethemoney.az.gov",
        referer: "https://seethemoney.az.gov/Reporting/AdvancedSearch",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json, text/javascript, */*; q=0.01",
      },
    },
    /*
     * THE TWO-BYTE 200 IS WHY THIS FIELD EXISTS. Between 2026-08-24 and
     * 2026-08-31 every guessed body here answered HTTP 200 with `""`. Without
     * a contract that is an INGESTED disposition over a two-byte artifact
     * calling itself the state's filer index.
     */
    yieldContract: {
      describe:
        "a server-side DataTables response carrying draw, data, recordsTotal and recordsFiltered",
      requireAll: ["recordsTotal", "data"],
      countAt: "recordsTotal",
    },
    citation:
      "data/method/knowledge.json — datatables-endpoint-needs-its-column-array, walked 2026-08-31, " +
      "recordsTotal 370 for the 2025-2026 cycle at JurisdictionId=0",
    awaitingAdapter:
      "LANE AZ's confirmed descriptor. The row semantics are UNDETERMINED — several rows share one " +
      "EntityID with differing Income/Expense and an identical CashBalance, and the sum identity " +
      "holds for 134 of 255 entities and BREAKS for 121 — so this route acquires and vaults, and " +
      "NOTHING here publishes a per-person total. Drop the confirmed shape at " +
      "data/campaign-finance/route-descriptors/az.json and it replaces this record wholesale.",
  },
  {
    routeId: "az-pima-easyvote-public-filings",
    label: "Pima County EasyVote public filings portal — PRIMARY records on a vendor platform",
    executorClass: "DETERMINISTIC",
    executorReason: "an HTTP GET against a portal page whose address is already recorded",
    open: {
      kind: "HTTP_GET",
      url: "https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings",
    },
    citation: "states/az/sources.md — Pima County EasyVote portal, recorded UNWALKED 2026-08-26",
  },
];

/* -------------------------------------------------- New Hampshire, statewide */

const NH_ROUTES: readonly RouteDescriptor[] = [
  {
    routeId: "nh-cfs-filing-entity-details",
    label: "cfsapi.sos.nh.gov PublicFilerDetails/GetFilingEntityDetails — the filer index",
    executorClass: "DETERMINISTIC",
    executorReason:
      "PROVEN as a plain server-side POST on 2026-08-31. CORS binds browsers and not servers, so " +
      "the recorded 'requires a visible browser' procedure is a script and needs no model",
    open: {
      kind: "HTTP_POST",
      url: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
      contentType: "application/json",
      body: JSON.stringify({ filerName: "", pageNumber: 1, pageSize: 6000 }),
      headers: {
        origin: "https://cfs.sos.nh.gov",
        referer: "https://cfs.sos.nh.gov/",
        accept: "application/json, text/plain, */*",
        ...identifiedHeaders(),
      },
    },
    yieldContract: {
      describe: "a CFS filer page carrying data.items[]",
      requireAll: ["items"],
      rowsAt: "data.items",
    },
    citation:
      "scripts/state-money-nh.mts and data/method/knowledge.json — " +
      "ask-what-the-browser-was-for-before-recording-human-only, walked 2026-08-31",
  },
  {
    routeId: "nh-cfs-transaction-detail",
    label: "NH CFS contribution and expenditure detail — the endpoints below filer totals",
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "the request shape has never been derived, so there is nothing graduated to replay. Finding " +
      "a route we do not hold is exactly what a bounded scout is for, and pointing deterministic " +
      "code at an unread surface would be a guess with a fixed shape",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "https://cfsapi.sos.nh.gov/api/",
      reason:
        "ONLY FILER-LEVEL TOTALS ARE TAKEN TODAY. The CFS holds contribution and expenditure " +
        "detail behind endpoints nobody in this project has read, and no descriptor for them " +
        "exists to replay. REQUIRES_NEW_ADAPTER: our tooling, not their publication.",
    },
    citation: "docs/frontier.md — Part F, 'Still open here'",
    awaitingAdapter:
      "one rung-7 observation of the CFS app calling its own detail endpoints, which is the same " +
      "move that turned the filer index from a procedure into a script.",
  },
  {
    routeId: "nh-sos-lobbyist-registry",
    label: "www.sos.nh.gov/lobbyists — a source class this product holds nothing of",
    executorClass: "DETERMINISTIC",
    executorReason: "an HTTP GET on a host whose permission question is now ANSWERED",
    open: {
      kind: "HTTP_GET",
      url: "https://www.sos.nh.gov/lobbyists",
      headers: {
        /*
         * The route executor's identified User-Agent stands (2026-09-25): leaving the project's name out of it to get
         * past this host's filter was a disguise, and access controls are never bypassed.
         */
        ...identifiedHeaders(),
      },
    },
    citation:
      "states/nh/sources.md — Lobbyist registry, HTTP 403 at rungs 2 and 3; " +
      "data/method/knowledge.json — unanswered-permission-may-be-the-agent-not-the-host",
  },
  {
    routeId: "nh-sos-records-request",
    label: "NH Department of State public-records path — rung 13",
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "no executor class can discharge this. It is carried so the obligation keeps a clock and a " +
      "name, and the class records that no deterministic client applies",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "New Hampshire Department of State, records request",
      reason:
        "PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED. Every machine-executable public " +
        "route above is worked independently; this one ends in a human or offline act, which under " +
        "RULING 205 keeps the obligation LIVE rather than closing it. RULING 215 removes external " +
        "workflow execution from this architecture, so no agent sends this request.",
    },
    citation: "docs/frontier.md — Part F: rung 13 unwalked, named as a start on 2026-08-19",
  },
];

/* ---------------------------------------------------------- the built-in set */

/**
 * The records this provider schedules when no lane descriptor file has landed.
 *
 * ## `readerImpactAt` IS NULL, AND THAT IS THE CORRECT READING
 *
 * The obvious value is the 2026 general election, and it was written that way
 * first. It is wrong, and the way it is wrong matters: `readerImpactAt` means
 * *when staleness in this record STARTS costing a reader something*, and for a
 * body's calendar that is genuinely the next sitting — nobody is hurt by a
 * stale agenda for a meeting that has not been scheduled. **Campaign-finance
 * staleness costs a reader TODAY.** A reader looking at a candidate's money is
 * shown a stale figure the moment it goes stale, not in November.
 *
 * Putting the election date here told the scheduler that staleness is free
 * until then: `scheduleObligation` halves the remaining time, clamps at
 * `MAX_DERIVED_CADENCE_HOURS`, and produces a THIRTY-DAY refresh for a filer
 * index that moves continuously in an election year. The derivation was working
 * correctly on a signal that was a misreading of the field.
 *
 * Null on both signals falls to RULING 212's surviving default of DAILY, and
 * the row's `cadenceSource` says `DEFAULT_NO_SIGNAL` — which is the honest
 * label. **We do not hold the filing calendars for either regime**, so we
 * cannot state a `declaredCycleHours` and will not invent one: a publisher
 * cycle nobody read is a fabricated citation with a number in it. Acquiring
 * those calendars is what would turn this into a `DECLARED_CYCLE`.
 */
export const AZ_PIMA_ELECTION_DATE = "2026-11-03";

function builtInRecords(): ProvidedObligation[] {
  return [
    {
      recordClass: "campaign-finance",
      subjectId: "az-sos-cfs-2026",
      scopeDivisions: ["ocd-division/country:us/state:az"],
      readerImpactAt: null,
      observedChangeRateHours: null,
      lastWorkedAt: null,
      routes: AZ_ROUTES,
    },
    {
      recordClass: "campaign-finance",
      subjectId: "nh-sos-cfs-2026",
      scopeDivisions: ["ocd-division/country:us/state:nh"],
      readerImpactAt: null,
      observedChangeRateHours: null,
      lastWorkedAt: null,
      routes: NH_ROUTES,
    },
  ];
}

/* ------------------------------- THE MODELLED OBLIGATIONS, MADE OPERATIONAL */

/**
 * **THE DEFECT THIS SECTION CLOSES, NAMED EXACTLY.**
 *
 * `arizonaLocalObligation()` in
 * `lib/control-plane/campaign-finance/obligations.ts` models Proposition 423's
 * genuinely local Pima County routes, each carrying its disposition,
 * permission state, rung and citation.
 *
 * **A domain obligation reachable only from tests is a failure.** The tests
 * were written beside the model and cannot disagree with it, so nine open
 * routes sat with no clock, no worker and no next-due while the digest reported
 * a healthy schedule over a different set of rows entirely.
 *
 * So the LOCAL model's OPEN routes are registered here. Each one gets an occurrence,
 * a RouteTask, an Attempt, a disposition, debt and a persisted next-due like
 * any other representation.
 *
 * PDC deliberately excludes the sibling federal AZ-06 model. The permanent
 * `fec-funding` contract is now the one clock and authority for FEC acquisition,
 * promotion, LKG and Reader delivery. Registering the federal model here would
 * restore a second set of FEC clocks and would also require this child process
 * to bootstrap a synchronous projection from the canonical store merely to
 * construct its registry.
 *
 * ## NO URL IS INVENTED, and that is why most of them do not fetch
 *
 * A `PlannedRoute` declares a `target` that is a HOST — `www.pima.gov`,
 * `ftp.azsos.gov` — and not an addressable representation. Turning a host into
 * `https://<host>/` would be guessing which page holds the record, and a guess
 * that returns HTTP 200 is the worst available outcome: a terminal INGESTED
 * over a front page, cited as a county's campaign-finance filings.
 *
 * So a modelled route is opened only where the model itself records an explicit
 * address. Every other one is `NOT_MACHINE_EXECUTABLE`, disposes
 * `REQUIRES_NEW_ADAPTER`, and its note carries the model's own note plus — where
 * one exists — a POINTER at the registry route that already addresses the same
 * representation. That pointer is the thing a later session needs: it says the
 * record is not stuck, it is being worked through a different route.
 */

/** The only addresses the model states explicitly. Nothing else is guessed. */
const MODELLED_ROUTE_URLS: Readonly<Record<string, string>> = {
  AZ_PIMA_EASYVOTE_PUBLIC_FILINGS:
    "https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings",
};

/** Where an already-registered route addresses the same representation. */
const MODELLED_ROUTE_SUPERSEDED_BY: Readonly<Record<string, string>> = {
  AZ_SEETHEMONEY_PLAIN_FETCH: "az-sos-seethemoney-datatables",
  AZ_SEETHEMONEY_LIVE_BROWSER: "az-sos-seethemoney-datatables",
  AZ_SOS_FTP_CFSDATA2: "az-sos-cfs-bulk-ftp",
};

function modelledRecords(nowIso: string): ProvidedObligation[] {
  const out: ProvidedObligation[] = [];
  for (const obligation of [arizonaLocalObligation(nowIso)]) {
    const routes: RouteDescriptor[] = obligation.openRoutes.map((planned) => {
      const id = planned.declaration.routeId;
      const url = MODELLED_ROUTE_URLS[id];
      const supersededBy = MODELLED_ROUTE_SUPERSEDED_BY[id];
      return {
        routeId: id,
        label: planned.declaration.label,
        executorClass: url ? "DETERMINISTIC" : "BOUNDED_MODEL_WORKER",
        executorReason: url
          ? "the model states an explicit address, so an HTTP GET opens it"
          : "the model states a HOST and not an addressable representation; finding the address is " +
            "a scout's job and a deterministic client pointed at a front page would guess",
        open: url
          ? { kind: "HTTP_GET", url }
          : {
              kind: "NOT_MACHINE_EXECUTABLE",
              target: planned.declaration.target,
              reason:
                `${planned.note} THIS ROUTE DECLARES A HOST, NOT AN ADDRESS, so nothing here can ` +
                "open it without guessing which page holds the record." +
                (supersededBy
                  ? ` The SAME representation is already worked by registered route ` +
                    `\`${supersededBy}\`, so the record is not stuck — this row is the model's own ` +
                    "entry for it and keeps its clock."
                  : ""),
            },
        citation: planned.citation,
        ...(supersededBy
          ? { awaitingAdapter: `an address for this host, or retirement in favour of \`${supersededBy}\`` }
          : {}),
      };
    });

    if (routes.length === 0) continue;
    out.push({
      recordClass: "campaign-finance",
      subjectId: obligation.coverage.contestId,
      /* Null for the same reason the statewide records are: campaign-finance
         staleness costs a reader today, not on election day. */
      readerImpactAt: null,
      observedChangeRateHours: null,
      lastWorkedAt: null,
      routes,
    });
  }
  return out;
}

/* ----------------------------------------- the descriptor-file drop-in path */

interface DescriptorFile {
  readonly records?: readonly ProvidedObligation[];
}

/**
 * Read every lane-supplied descriptor file, keyed by subject.
 *
 * A file that is present and yields no records is a FAILED read, not an empty
 * one, and the failure is returned rather than silently falling back — a lane
 * that shipped a broken descriptor must see that it shipped a broken
 * descriptor, not watch the built-ins quietly cover for it.
 */
export function readDescriptorFiles(root: string): {
  readonly bySubject: Map<string, ProvidedObligation>;
  readonly failures: readonly string[];
  readonly files: readonly string[];
} {
  const dir = join(root, ...DESCRIPTOR_DIR);
  const bySubject = new Map<string, ProvidedObligation>();
  const failures: string[] = [];
  const files: string[] = [];
  if (!existsSync(dir)) return { bySubject, failures, files };

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    files.push(`${DESCRIPTOR_DIR.join("/")}/${name}`);
    let parsed: DescriptorFile;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as DescriptorFile;
    } catch (error) {
      failures.push(
        `${name} did not parse (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    const records = parsed.records ?? [];
    if (records.length === 0) {
      failures.push(
        `${name} was READ and declared no records. A descriptor file that yields zero records is a ` +
          "failed read of that file, never a statement that the lane has no routes.",
      );
      continue;
    }
    for (const record of records) {
      if (!record.subjectId || !Array.isArray(record.routes) || record.routes.length === 0) {
        failures.push(`${name} carries a record with no subjectId or no routes; it is skipped`);
        continue;
      }
      bySubject.set(record.subjectId, record);
    }
  }
  return { bySubject, failures, files };
}

export function campaignFinanceProvider(readBallotInputs?: () => BallotFinanceInputs): ObligationProvider {
  return {
    id: CAMPAIGN_FINANCE_PROVIDER_ID,
    describe: readBallotInputs ? "campaign finance owed for admitted held ballot candidates, from registered source doors and recorded methods" :
      "state and county campaign-finance record universes (AZ SOS, NH SOS), each with its whole " +
      "route portfolio scheduled independently so no one 200 retires the others",

    /*
     * THE SCHEDULED UNIT IS THE REPRESENTATION. One durable row per route means
     * the FTP drop's wall accrues its own debt on its own clock while the
     * DataTables route keeps its own — which is RULING 207 expressed as state
     * rather than as a sentence in a report.
     */
    scheduledId: (record, route) =>
      readBallotInputs ? ballotFinanceScheduledId(record, route) : `freshness:campaign-finance:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      if (readBallotInputs) {
        try { return ballotFinanceObligations(readBallotInputs()); }
        catch { return { obligations: [], readFailure: "The admitted held ballot finance inputs could not be read.", emptyReason: null }; }
      }
      // Preserved way back until River checks the connected generic path live.
      const dropped = readDescriptorFiles(ctx.root);
      const records = [...builtInRecords(), ...modelledRecords(ctx.nowIso)].map(
        (r) => dropped.bySubject.get(r.subjectId) ?? r,
      );
      /* A lane descriptor for a subject the built-ins do not carry is ADDED,
         not ignored: a new jurisdiction is exactly what the contract is for. */
      const known = new Set(records.map((r) => r.subjectId));
      for (const [subject, record] of dropped.bySubject) {
        if (!known.has(subject)) records.push(record);
      }

      return {
        obligations: records,
        readFailure: dropped.failures.length === 0 ? null : dropped.failures.join("; "),
        emptyReason:
          records.length === 0
            ? "no built-in records and no descriptor files — this cannot happen while builtInRecords() " +
              "returns rows, so a zero here is a defect in this provider"
            : null,
      };
    },
  };
}
