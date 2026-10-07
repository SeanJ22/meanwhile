/**
 * Campaign-finance records as scheduled obligations. Each record carries several routes, each scheduled
 * independently, so one route's success never marks another worked. A descriptor file in
 * `data/campaign-finance/route-descriptors/` replaces the built-in record with the same `subjectId`; a file
 * that yields zero records is a failed read.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ballotFinanceObligations, ballotFinanceScheduledId, type BallotFinanceInputs } from "../../campaign-finance/ballot-obligations.ts";

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

/** Identification headers. `INGEST_CONTACT_EMAIL` is read by name; unset, `From` is omitted. */
function identifiedHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  return {
    "x-purpose": "civic campaign-finance index for a public-records product",
    ...(from ? { from } : {}),
  };
}


/** The DataTables request the portal answers: filters in the query string, and a body that includes `columns[N][data]`, the projection the action builds its result from. */
/* The keys the action emits, as measured from a live response. */
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
        "That is the body-own-publication order's rung ZERO and it outranks every page-by-page route below it. The " +
        "missing piece is an adapter in this repository, which is a fact about OUR tooling and is " +
        "never a fact about the record — REQUIRES_NEW_ADAPTER, and the obligation stays live.",
    },
    citation:
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
    /* The yield contract keeps a two-byte HTTP 200 from being ingested as the filer index. */
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
        /* The route executor's identified User-Agent stands; access controls are never bypassed. */
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
        "the rules keep the obligation LIVE rather than closing it. External " +
        "workflow execution is outside this architecture, so no agent sends this request.",
    },
    citation: "docs/frontier.md — Part F: rung 13 unwalked, named as a start on 2026-08-19",
  },
];


/** The records this provider schedules when no descriptor file has landed. `readerImpactAt` is null: campaign-finance staleness costs a reader today, so the default cadence applies. */
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


interface DescriptorFile {
  readonly records?: readonly ProvidedObligation[];
}

/** Read every descriptor file, keyed by subject. A present file that yields no records is a failed read, returned rather than covered by the built-ins. */
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

    /* One durable row per route, so each route keeps its own debt and clock. */
    scheduledId: (record, route) =>
      readBallotInputs ? ballotFinanceScheduledId(record, route) : `freshness:campaign-finance:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      if (readBallotInputs) {
        try { return ballotFinanceObligations(readBallotInputs()); }
        catch { return { obligations: [], readFailure: "The admitted held ballot finance inputs could not be read.", emptyReason: null }; }
      }
      // Preserved way back until River checks the connected generic path live.
      const dropped = readDescriptorFiles(ctx.root);
      const records = builtInRecords().map(
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
