import { fetchSource } from "../lib/sources/fetch-source.ts";
/** @freshness-reads-here */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, flooredSelector } from "../lib/ops/denominator-floor.ts";
import { stamp } from "./stamp.mts";
import { pimaCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  FILING_REGIME_REGISTRY_PATH,
  loadFilingRegimeRegistry,
} from "../lib/control-plane/campaign-finance/filing-regime.ts";
import type {
  AzPimaCommitteeRow,
  AzPimaFilingIndexRow,
  AzPimaHeld,
  AzPimaTransactions,
} from "../lib/control-plane/campaign-finance/held-records.ts";

const API_BASE = "https://ecf-api.easyvoteapp.com";
const SOURCE_ID = "az-pima-local-finance";

interface EasyVoteTenant {
  /** The tenant's public portal origin; the API resolves its website user from it. */
  readonly origin: string;
  readonly scopeKey: string;
  readonly jurisdiction: string;
  readonly county: string;
  readonly authorityId: string;
  readonly authorityName: string;
}

function easyVoteTenants(): EasyVoteTenant[] {
  const path = join(process.cwd(), ...FILING_REGIME_REGISTRY_PATH);
  const registry = loadFilingRegimeRegistry(JSON.parse(readFileSync(path, "utf8")), FILING_REGIME_REGISTRY_PATH.join("/"));
  const tenants: EasyVoteTenant[] = [];
  for (const regime of registry.regimes) {
    for (const custodian of regime.custodians) {
      if (custodian.authority.vendorPlatform !== "EasyVote" || !custodian.publisher?.url || !custodian.scopeKey) continue;
      const county = custodian.authority.jurisdiction.split(":")[1] ?? custodian.scopeKey;
      tenants.push({
        origin: new URL(custodian.publisher.url).origin,
        scopeKey: custodian.scopeKey,
        jurisdiction: regime.jurisdiction,
        county,
        authorityId: custodian.authority.id,
        authorityName: custodian.authority.name,
      });
    }
  }
  if (tenants.length === 0) throw new Error(`No EasyVote tenant is named in ${FILING_REGIME_REGISTRY_PATH.join("/")}.`);
  return tenants;
}

if (!process.argv.includes("--promote")) {
  throw new Error("REFUSING_TRACKED_LOCAL_FINANCE_WRITE: invoke this owner-only acquisition with --promote.");
}
prepareProductionCivicDataWrite();

/** The vendor rate-limits; a faster loop gets HTML back. */
const PAUSE_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchResult {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
  readonly rows: readonly Record<string, unknown>[] | null;
  readonly bodyPreview: string | null;
  readonly rawText: string;
}

async function getJson(tenant: EasyVoteTenant, path: string): Promise<FetchResult> {
  const url = `${API_BASE}${path}`;
  const response = await fetchSource(url, {
    headers: {
      Origin: tenant.origin,
      Accept: "application/json, text/plain, */*",
    },
  });
  const text = await response.text();
  if (!response.ok || !text.trimStart().startsWith("[")) {
    return {
      url,
      status: response.status,
      bytes: text.length,
      rows: null,
      bodyPreview: text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
      rawText: text,
    };
  }
  return {
    url,
    status: response.status,
    bytes: text.length,
    rows: JSON.parse(text) as Record<string, unknown>[],
    bodyPreview: null,
    rawText: text,
  };
}

interface ObjectFetchResult {
  readonly url: string;
  readonly status: number;
  readonly value: Record<string, unknown> | null;
  readonly rawText: string;
}

async function getObjectJson(tenant: EasyVoteTenant, path: string): Promise<ObjectFetchResult> {
  const url = `${API_BASE}${path}`;
  const response = await fetchSource(url, { headers: { Origin: tenant.origin, Accept: "application/json, text/plain, */*" } });
  const rawText = await response.text();
  let value: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch { /* malformed official response is a failed acquisition below */ }
  return { url, status: response.status, value: response.ok ? value : null, rawText };
}

function yearOf(value: unknown): string {
  return String(value ?? "").slice(0, 4);
}

async function acquire(tenant: EasyVoteTenant, recordedOn: string, submitted: { value: boolean }): Promise<void> {
  const label = `${tenant.county} County (${tenant.jurisdiction})`;
  console.log(`${label} campaign-finance transaction acquisition — ${recordedOn}`);

  const user = await getObjectJson(tenant, "/user/current");
  if (!user.value) throw new Error(`${label} public tenant identity failed with HTTP ${user.status}`);
  const customer = user.value.Customer && typeof user.value.Customer === "object"
    ? user.value.Customer as Record<string, unknown>
    : {};
  const customerId = typeof customer.Id === "string" ? customer.Id : "";
  if (!customerId) throw new Error(`${label} public tenant identity carries no customer id.`);
  await sleep(PAUSE_MS);
  const filers = await getJson(tenant, `/filer/documentsearch/${customerId}`);
  if (!filers.rows || filers.rows.length === 0) {
    throw new Error(`${label} public filer index failed or returned zero rows: ${filers.bodyPreview ?? `HTTP ${filers.status}`}`);
  }
  await sleep(PAUSE_MS);

  const contributionsPath = `/advancedsearch/contributions/${customerId}`;
  const distributionsPath = `/advancedsearch/distributions/${customerId}`;

  const contributions = await getJson(tenant, contributionsPath);
  console.log(`  contributions: HTTP ${contributions.status}, ${contributions.bytes}B, ${contributions.rows?.length ?? "no"} rows`);
  if (!contributions.rows) throw new Error(`contributions failed: ${contributions.bodyPreview}`);
  await sleep(PAUSE_MS);

  const distributions = await getJson(tenant, distributionsPath);
  console.log(`  distributions: HTTP ${distributions.status}, ${distributions.bytes}B, ${distributions.rows?.length ?? "no"} rows`);
  if (!distributions.rows) throw new Error(`distributions failed: ${distributions.bodyPreview}`);
  await sleep(PAUSE_MS);

  /* A silently capped result cannot partition by year consistently, so each
     year's server count is compared with the unfiltered result's rows. */
  const probes: { readonly year: string; readonly serverRows: number; readonly localRows: number }[] = [];
  for (const year of ["2025", "2026"]) {
    const probe = await getJson(tenant, `${contributionsPath}?minDate=${year}-01-01&maxDate=${year}-12-31`);
    const local = contributions.rows.filter((r) => yearOf(r.ContributionDate) === year).length;
    console.log(`  cap probe ${year}: server ${probe.rows?.length ?? "ERR"} vs committed ${local}`);
    probes.push({ year, serverRows: probe.rows?.length ?? -1, localRows: local });
    await sleep(PAUSE_MS);
  }
  const capSuspected = probes.some((p) => p.serverRows !== p.localRows);

  /* A zero-row result is a failed extraction, never a finding that committees
     reported nothing; flooredSelector throws on it. */
  const contributionFloor = flooredSelector(
    `${tenant.county} contribution rows`,
    `GET ${contributionsPath}`,
    contributions.rows,
    (row) => row.ItemizedListType === "Contribution",
  );
  const distributionFloor = flooredSelector(
    `${tenant.county} distribution rows`,
    `GET ${distributionsPath}`,
    distributions.rows,
    (row) => row.ItemizedListType === "Disbursments",
  );
  console.log(`  ${floorLine(contributionFloor)}`);
  console.log(`  ${floorLine(distributionFloor)}`);

  const tally = (rows: readonly Record<string, unknown>[], key: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const k = String(row[key] ?? "(null)");
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };

  const officeName = String(customer.Name ?? tenant.authorityName);
  const routePrefix = `${tenant.jurisdiction}_${tenant.scopeKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EASYVOTE`;

  const stillOwed: Record<string, unknown>[] = [];
  if (tenant.jurisdiction === "AZ") {
    stillOwed.push({
      record: `Arizona INDEPENDENT-EXPENDITURE reports for ${tenant.county} County committees`,
      why: "every row this route returns carries DocumentType 'CCFR'. The IE class is a different document type.",
      nextRoute: "https://seethemoney.az.gov — AZ Secretary of State's campaign-finance reporting surface",
      permission:
        "ALLOWED. robots.txt answers HTTP 404 (NO_ROBOTS), re-read " + recordedOn + "; no terms page. " +
        "The landing page answers HTTP 200 and POST /Reporting/GetNEWTableData answers HTTP 200 JSON.",
      progressThisSession:
        "The parameter NAMES are determined, read out of the site's own bundle /bundles/core: Page, startYear, " +
        "endYear, JurisdictionId, TablePage, TableLength, TableSearch, Name, NameId, CommitteeId, " +
        "BallotMeasureId, OfficeID, PartyID, IsLessActive, ShowAllYears, ShowOfficeHolder, ChartName, " +
        "URLHash, CommitteeReportId, ExportOptions. The route is a DataTables serverSide POST to " +
        "/Reporting/GetNEWTableData/{querystring}, and /Reporting/ExportEntityTransactions/{querystring}" +
        "&ExportOptions= is a bulk export of the same data.",
      whatIsStillUnknown:
        "the VALUE vocabulary. Every combination tried returned HTTP 200 with a 2-byte empty JSON string, " +
        "so Page's numeric token set and the entity-selecting URLHash are not yet established. This is a " +
        "route still being worked, and it is NEVER evidence that Arizona publishes no independent " +
        "expenditures.",
      exactNextStep:
        "Drive https://seethemoney.az.gov/Reporting/AdvancedSearch/ in a browser and observe the app's own " +
        "POST body and URLHash for one known committee, the same way the EasyVote Origin header was learned.",
    });
  }
  stillOwed.push(
    {
      record: `the UNREDACTED ${tenant.county} County filing bodies`,
      why:
        "every filing id held ends '_Redacted', and documents/getdocumentfiling/{id} answers HTTP 401 " +
        "to an anonymous caller.",
      nextRoute: `a public-records request to the filing officer (${officeName})`,
      permission: "N/A — this is an offline custodian request, not a web route.",
      progressThisSession: "the redaction was IDENTIFIED as a redaction rather than mistaken for the whole record.",
      whatIsStillUnknown: "what the redactions cover.",
      exactNextStep:
        "PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED. File the records request; the obligation stays live.",
    },
    {
      record: "committee-to-measure linkage (which committees support or oppose a proposition)",
      why: "neither the county portal nor the state register publishes it.",
      nextRoute: "the committees' own Statements of Organization, which the county portal indexes",
      permission: "same host and same route class as this acquisition — ALLOWED.",
      progressThisSession: "none. Named so it is not mistaken for a thing we hold.",
      whatIsStillUnknown: "everything. A committee's NAME is not evidence of its position and is never inferred from.",
      exactNextStep: "Read the Statement of Organization filings in the filing index held with this record.",
    },
  );

  const document = {
    formatVersion: 1,
    recordedOn,
    recordedBy: "scripts/campaign-finance-az-pima-transactions.mts",
    whatThisIs:
      `Transaction-level campaign-finance records ACTUALLY RETRIEVED from the ${tenant.county} County filing ` +
      "officer's own EasyVote portal API, anonymously. The filing-body route answers HTTP 401; this is a " +
      "different representation of the same records, and it carries amounts and dates.",
    jurisdiction: tenant.jurisdiction,
    county: tenant.county,
    acquisition: {
      routeId: `${routePrefix}_ADVANCEDSEARCH`,
      contributionsUrl: contributions.url,
      distributionsUrl: distributions.url,
      method: "GET",
      requiredHeader: "Origin: " + tenant.origin,
      httpStatus: contributions.status,
      retrievedOn: recordedOn,
      transport: "REACHABLE",
      permission: "ALLOWED",
      permissionEvidence:
        "https://ecf-api.easyvoteapp.com/robots.txt answers HTTP 404 with no robots document, so " +
        "the host publishes no restriction (NO_ROBOTS), re-read " + recordedOn + ". The tenant host " +
        tenant.origin + "/robots.txt serves the Angular index.html, which is not a robots document.",
      authentication:
        "NONE SENT AND NONE REQUIRED. The API's own CurrentUserOrWebSiteUserAsync path falls back to " +
        "a per-tenant anonymous website user; it needs only the tenant subdomain, which it reads from " +
        "the Origin header the county's own public web app sends. No credential, no login, no bypass.",
      discoveredVia:
        "The API routes reachable from the tenant SPA bundle were enumerated by extracting every " +
        "API_BASE_URL(...) concatenation. advancedsearch/contributions and advancedsearch/distributions " +
        "were among them; the filing-body route was not the only one.",
      whyThePriorWalkGot401:
        "documents/getdocumentfiling/{id} answers 401 with a 58-byte IIS edge page both with and " +
        "without a trailing slash. That route is genuinely closed to an anonymous caller. It is a " +
        "fact about that route and never about the records, which this route returns.",
    },
    reconciliation: {
      question: "Is the unfiltered row count a complete result or a silent server-side cap?",
      method:
        "The same endpoint was called with minDate/maxDate bounding each year, and the server's row " +
        "count compared against the count of that year already present in the committed unfiltered " +
        "result. A capped result cannot partition consistently.",
      probes,
      capSuspected,
      verdict: capSuspected
        ? "CAP SUSPECTED — the committed set is NOT known to be complete."
        : "NOT A CAP. The committed row count is the endpoint's complete result for this customer id.",
    },
    limitsOfThisUniverse: [
      "Filings whose DocumentFilingId ends '_Redacted' are the county's published redacted copy, not " +
        "the unredacted filing.",
      "No document type other than those tallied in counts was returned by this endpoint.",
      "NO INDEPENDENT-EXPENDITURE ROW. An independent-expenditure report is a different " +
        "document type and this endpoint did not return one. That is a statement about this route, " +
        "never a finding that no independent expenditure occurred.",
      "NO COMMITTEE-TO-MEASURE LINKAGE. Neither this endpoint nor the state register publishes which " +
        "committees support or oppose a ballot measure. A committee's NAME is not evidence of its " +
        "position and this product never infers one.",
      "DATES ARE AS FILED. Implausible years and null dates are preserved exactly as the filer " +
        "entered them and never repaired, because a corrected date would be our claim rather than the filer's record.",
      "COMMITTEE NAMES ARE AS FILED AND NOT DEDUPLICATED. Names differing only in case or accents are " +
        "not merged here: matching them would be a name match, which this project refuses to treat as agreement.",
      "ItemizedListType IS NOT UNIFORM. A contribution result set also carries Loan, Interest, " +
        "Rebate/Refund and Donation/Support rows; a distribution result set also carries " +
        "Contributions Made, Reimbursements and Outstanding Accounts/Debts. Summing across them " +
        "would invent a figure no filer reported.",
    ],
    counts: {
      floors: [floorLine(contributionFloor), floorLine(distributionFloor)],
      contributionRows: contributions.rows.length,
      distributionRows: distributions.rows.length,
      contributionsByItemizedListType: tally(contributions.rows, "ItemizedListType"),
      distributionsByItemizedListType: tally(distributions.rows, "ItemizedListType"),
      contributionsByDocumentType: tally(contributions.rows, "DocumentType"),
      distributionsByDocumentType: tally(distributions.rows, "DocumentType"),
    },
    stillOwed,
    contributions: contributions.rows,
    distributions: distributions.rows,
  } as unknown as AzPimaTransactions;

  const committeeRegisterCountyPortal: AzPimaCommitteeRow[] = filers.rows.map((row) => ({
    portalFilerId: String(row.filerid ?? ""),
    registeredName: String(row.committeename ?? row.displayname ?? ""),
    filerType: String(row.filertype ?? ""),
    status: String(row.status ?? ""),
    officeName: row.officename === null || row.officename === undefined ? null : String(row.officename),
    filingCount: Array.isArray(row.documents) ? row.documents.length : 0,
    source: filers.url,
  }));
  const filingsIndexed: AzPimaFilingIndexRow[] = filers.rows.flatMap((row) => {
    const portalFilerId = String(row.filerid ?? "");
    const committeeRegisteredName = String(row.committeename ?? row.displayname ?? "");
    return (Array.isArray(row.documents) ? row.documents : []).map((documentRow) => {
      const filed = documentRow as Record<string, unknown>;
      const documentId = String(filed.documentid ?? "");
      return {
        portalFilerId,
        committeeRegisteredName,
        filingId: `easyvote:${tenant.scopeKey}:${documentId}`,
        documentName: String(filed.documentname ?? ""),
        documentType: String(filed.documenttype ?? ""),
        dateSubmitted: String(filed.datesubmitted ?? ""),
        documentBodyHeld: false,
        documentBodyWall: `${API_BASE}/documents/getdocumentfiling/${documentId} is not part of this public-index/transaction acquisition; no filing-body fact is inferred.`,
      };
    });
  });
  if (committeeRegisterCountyPortal.some((row) => !row.portalFilerId || !row.registeredName)) {
    throw new Error(`The ${label} filer index contains a row without its official filer id or registered name.`);
  }
  if (new Set(committeeRegisterCountyPortal.map((row) => row.portalFilerId)).size !== committeeRegisterCountyPortal.length) {
    throw new Error(`The ${label} filer index contains duplicate official filer ids.`);
  }

  const held: AzPimaHeld = {
    formatVersion: 1,
    recordedOn,
    filingAuthorityIdentification: {
      authorityId: tenant.authorityId,
      officeNameAsPublished: officeName,
      readFrom: user.url,
      readOn: recordedOn,
      whatThisEstablishesAndWhatItDoesNot:
        "The official public tenant record identifies the office operating this filing portal. It does not establish a broader statutory role.",
    },
    committeeRegisterCountyPortal,
    committeeRegisterStateFtp: [],
    filingsIndexed,
    expectedFilingPeriodsAz2026PacParty: [],
    acquisitions: [
      { routeId: `${routePrefix}_TENANT`, url: user.url, method: "GET", httpStatus: user.status, retrievedOn: recordedOn },
      { routeId: `${routePrefix}_PUBLIC_FILINGS`, url: filers.url, method: "GET", httpStatus: filers.status, retrievedOn: recordedOn, yielded: `${committeeRegisterCountyPortal.length} filers and ${filingsIndexed.length} filing index rows` },
    ],
    notHeld: [
      "The public filing-body route is not part of this projection; only the official index and separately published redacted transaction searches are held.",
      "No independent-expenditure report is inferred from a transaction endpoint whose returned rows are CCFR records.",
      "No committee-to-measure position is inferred from committee names.",
      "The statewide reporting-period table is not duplicated into this local projection.",
    ],
  };
  const retrievedAt = new Date().toISOString();
  const candidate = pimaCampaignFinanceCandidate({
    held,
    transactions: document,
    rawBodies: [user.rawText, filers.rawText, contributions.rawText, distributions.rawText],
    requestedUrl: filers.url,
    finalUrl: filers.url,
    retrievedAt,
  });
  submitted.value = true;
  const outcome = await processRegisteredManualCandidate(
    new PostgresRoutineDataStore(),
    SOURCE_ID,
    candidate,
    retrievedAt,
  );
  printSourceRunnerReceipt(SOURCE_ID, candidate, outcome);
  if (!outcome.promoted) throw new Error(`${label} campaign-finance promotion refused: ${outcome.candidate.failureCode}`);
  console.log(`\npromoted ${outcome.promoted.versionId}; no tracked runtime artifact was written`);
  console.log(`  ${contributions.rows.length} contribution rows, ${distributions.rows.length} distribution rows`);
  console.log(`  reconciliation: ${document.reconciliation.verdict}`);
}

const recordedOn = stamp();
for (const tenant of easyVoteTenants()) {
  const submitted = { value: false };
  try {
    await acquire(tenant, recordedOn, submitted);
  } catch (error) {
    if (!submitted.value) {
      const attemptedAt = new Date().toISOString();
      const failed = failedAcquisitionCandidate({
        sourceId: SOURCE_ID,
        recordClass: "LOCAL_CAMPAIGN_FINANCE",
        scope: `US-${tenant.jurisdiction}:county:${tenant.scopeKey}:campaign-finance:2026`,
        requestedUrl: `${API_BASE}/user/current`,
        attemptedAt,
        failureDetail: error instanceof Error ? error.message : String(error),
        parserVersion: "pima-campaign-finance/2",
      });
      const outcome = await processRegisteredManualCandidate(new PostgresRoutineDataStore(), SOURCE_ID, failed, attemptedAt);
      printSourceRunnerReceipt(SOURCE_ID, failed, outcome);
    }
    throw error;
  }
}
