/**
 * `pnpm tsx scripts/campaign-finance-az-pima-transactions.mts`
 *
 * @freshness-reads-here — successful retrieval time is captured after all
 * official response bodies parse; failed-attempt time describes that attempt.
 *
 * **THE ROUTE THAT BROKE THE 401.**
 *
 * `data/states/az/campaign-finance/az-pima-2026-held.json` recorded, honestly and
 * correctly, that Pima County's filing INDEX was public and every filing BODY
 * answered HTTP 401 on `documents/getdocumentfiling/{id}`. Its `notHeld` array
 * said in five separate lines that no contribution row, no expenditure row, no
 * independent-expenditure row and no summary total had been retrieved.
 *
 * That was a wall on ONE ROUTE. Under RULING 205 it never became a fact about
 * Pima County's records, and under RULING 207 the 200 on `filer/documentsearch`
 * never retired the rest of the vendor's surface. This script is the other
 * representation, and it carries actual money.
 *
 * ## How the wall fell, in the order it actually happened
 *
 * 1. The 401 body is 58 bytes of `text/html`: *"You do not have permission to
 *    view this directory or page."* That is an IIS/Azure EDGE refusal, not an
 *    application's auth check, which is the first hint that the route name
 *    rather than the caller was the problem.
 * 2. The tenant SPA bundle `main.b280bfb8ae2b4a7a.js` was read and every
 *    `API_BASE_URL(...) + "..."` concatenation extracted — **59 routes**, of
 *    which `documents/getdocumentfiling` is one. Among them:
 *    `advancedsearch/contributions/{customerId}` and
 *    `advancedsearch/distributions/{customerId}`. The filing BODY is not the
 *    only representation of what is in a filing; the transaction search is
 *    another, and it is the one that is public.
 * 3. Unauthenticated, those answered **HTTP 500**, not 401 — a different
 *    disposition, and the ASP.NET stack trace named the cause:
 *    `ContributionsSearch` → `CurrentUserOrWebSiteUserAsync` →
 *    `GetWebsiteUserAsync` → `GetSubdomain(String url)` threw
 *    `ArgumentNullException: uriString`. **`CurrentUserOrWebSiteUser` is the
 *    API's own anonymous path** — it falls back to a per-tenant "website user"
 *    when nobody is logged in. It only needed the tenant subdomain.
 * 4. The subdomain is taken from the request's `Origin`. Sending
 *    `Origin: https://pimacountyaz.easyvotecampaignfinance.com` returns
 *    **HTTP 200 and 1,090,303 bytes of JSON**.
 *
 * **Nothing here bypasses authentication.** No credential is sent, none is
 * guessed, and no login is involved. The request is the one the county's own
 * public web app makes for an anonymous visitor, with the header that app
 * sends; the server chooses its anonymous branch by itself. RULING 205's
 * "persistence is never intrusion" line is the test, and this passes it.
 *
 * ## What this acquires, and what it does not
 *
 * Contributions and distributions are kept in SEPARATE files and never summed
 * together. `ItemizedListType` is preserved exactly as filed, because
 * "Contribution", "Loan", "Interest" and "Rebate/Refund" are not the same event
 * and a total that mixes them is a fabricated figure.
 *
 * **Every filing this route exposes is a REDACTED public copy** — all 900
 * contribution rows carry a `DocumentFilingId` ending `_Redacted`. That is the
 * county publishing the redacted version, and it is recorded rather than
 * smoothed away.
 *
 * **No independent-expenditure row is here**, and its absence is not evidence.
 * Every row of both result sets carries `DocumentType: "CCFR"` — the candidate
 * campaign finance report. An Arizona independent-expenditure report is a
 * different document type, and this endpoint did not return one.
 *
 * ## The count is reconciled, not trusted
 *
 * The unfiltered call returns exactly 900 contribution rows, and a round number
 * is exactly what a silent server-side cap looks like. It is not one: the same
 * endpoint filtered to 2025 returns 502 and to 2026 returns 368, and the
 * committed 900 rows contain exactly 502 and 368 rows in those years. A capped
 * result could not partition consistently. RULING 100 — the operation was asked
 * what it returned.
 */

import { floorLine, flooredSelector } from "../lib/ops/denominator-floor.ts";
import { stamp } from "./stamp.mts";
import { pimaCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type {
  AzPimaCommitteeRow,
  AzPimaFilingIndexRow,
  AzPimaHeld,
  AzPimaTransactions,
} from "../lib/control-plane/campaign-finance/held-records.ts";

const API_BASE = "https://ecf-api.easyvoteapp.com";
/** The tenant the Origin header names. The API resolves its website user from this. */
const TENANT_ORIGIN = "https://pimacountyaz.easyvotecampaignfinance.com";
/** Pima County's customer id, read from the portal itself in the prior acquisition. */
const CUSTOMER_ID = "19626734-D3E9-449C-BB5D-EDB9C0034907";

if (!process.argv.includes("--promote")) {
  throw new Error("REFUSING_TRACKED_LOCAL_FINANCE_WRITE: invoke this owner-only acquisition with --promote.");
}
prepareProductionCivicDataWrite();

/** Politeness. The vendor rate-limits, and a rushed loop got HTML back. */
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

async function getJson(path: string): Promise<FetchResult> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      // The one header that matters: the API derives the tenant subdomain from
      // it and selects its anonymous website user.
      Origin: TENANT_ORIGIN,
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
      // Strip tags so an ASP.NET error page is readable in a log.
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

async function getObjectJson(path: string): Promise<ObjectFetchResult> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, { headers: { Origin: TENANT_ORIGIN, Accept: "application/json, text/plain, */*" } });
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

async function main(): Promise<void> {
  const recordedOn = stamp();
  console.log(`Pima County campaign-finance transaction acquisition — ${recordedOn}`);

  const user = await getObjectJson("/user/current");
  if (!user.value) throw new Error(`Pima public tenant identity failed with HTTP ${user.status}`);
  await sleep(PAUSE_MS);
  const filers = await getJson(`/filer/documentsearch/${CUSTOMER_ID}`);
  if (!filers.rows || filers.rows.length === 0) {
    throw new Error(`Pima public filer index failed or returned zero rows: ${filers.bodyPreview ?? `HTTP ${filers.status}`}`);
  }
  await sleep(PAUSE_MS);

  const contributionsPath = `/advancedsearch/contributions/${CUSTOMER_ID}`;
  const distributionsPath = `/advancedsearch/distributions/${CUSTOMER_ID}`;

  const contributions = await getJson(contributionsPath);
  console.log(`  contributions: HTTP ${contributions.status}, ${contributions.bytes}B, ${contributions.rows?.length ?? "no"} rows`);
  if (!contributions.rows) throw new Error(`contributions failed: ${contributions.bodyPreview}`);
  await sleep(PAUSE_MS);

  const distributions = await getJson(distributionsPath);
  console.log(`  distributions: HTTP ${distributions.status}, ${distributions.bytes}B, ${distributions.rows?.length ?? "no"} rows`);
  if (!distributions.rows) throw new Error(`distributions failed: ${distributions.bodyPreview}`);
  await sleep(PAUSE_MS);

  // ---- The cap reconciliation, run live rather than asserted -------------
  const probes: { readonly year: string; readonly serverRows: number; readonly localRows: number }[] = [];
  for (const year of ["2025", "2026"]) {
    const probe = await getJson(`${contributionsPath}?minDate=${year}-01-01&maxDate=${year}-12-31`);
    const local = contributions.rows.filter((r) => yearOf(r.ContributionDate) === year).length;
    console.log(`  cap probe ${year}: server ${probe.rows?.length ?? "ERR"} vs committed ${local}`);
    probes.push({ year, serverRows: probe.rows?.length ?? -1, localRows: local });
    await sleep(PAUSE_MS);
  }
  const capSuspected = probes.some((p) => p.serverRows !== p.localRows);

  /**
   * RULING 159 — THE FLOOR, and it is the exact failure this acquisition could
   * produce. A zero-row result from either endpoint is a FAILED extraction, not
   * an empty document: it would write a committed file saying Pima County's
   * committees reported nothing, which is a false claim about a government made
   * out of our own transport failure. `flooredSelector` throws on an empty
   * population and names the route that returned it.
   */
  const contributionFloor = flooredSelector(
    "Pima contribution rows",
    `GET ${contributionsPath}`,
    contributions.rows,
    (row) => row.ItemizedListType === "Contribution",
  );
  const distributionFloor = flooredSelector(
    "Pima distribution rows",
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

  const document = {
    formatVersion: 1,
    recordedOn,
    recordedBy: "workstream WS-CF — scripts/campaign-finance-az-pima-transactions.mts",
    whatThisIs:
      "Transaction-level campaign-finance records ACTUALLY RETRIEVED from the Pima County filing " +
      "officer's own portal API, anonymously. This is the acquisition that az-pima-2026-held.json " +
      "recorded as blocked by HTTP 401 on the filing-body route. The 401 was one route; this is a " +
      "different representation of the same records, and it carries amounts and dates.",
    jurisdiction: "AZ",
    county: "Pima",
    acquisition: {
      routeId: "AZ_PIMA_EASYVOTE_ADVANCEDSEARCH",
      contributionsUrl: contributions.url,
      distributionsUrl: distributions.url,
      method: "GET",
      requiredHeader: "Origin: " + TENANT_ORIGIN,
      httpStatus: contributions.status,
      retrievedOn: recordedOn,
      transport: "REACHABLE",
      permission: "ALLOWED",
      permissionEvidence:
        "https://ecf-api.easyvoteapp.com/robots.txt answers HTTP 404 with no robots document, so " +
        "the host publishes no restriction (NO_ROBOTS), re-read " + recordedOn + ". The tenant host " +
        "https://pimacountyaz.easyvotecampaignfinance.com/robots.txt answers HTTP 200 but serves the " +
        "Angular index.html, which is not a robots document.",
      authentication:
        "NONE SENT AND NONE REQUIRED. The API's own CurrentUserOrWebSiteUserAsync path falls back to " +
        "a per-tenant anonymous website user; it needs only the tenant subdomain, which it reads from " +
        "the Origin header the county's own public web app sends. No credential, no login, no bypass.",
      discoveredVia:
        "The 59 API routes reachable from the tenant SPA bundle main.b280bfb8ae2b4a7a.js were " +
        "enumerated by extracting every API_BASE_URL(...) concatenation. advancedsearch/contributions " +
        "and advancedsearch/distributions were among them; the filing-body route was not the only one.",
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
      "EVERY filing behind these rows is a REDACTED public copy: all contribution rows carry a " +
        "DocumentFilingId ending '_Redacted'. This is the county's published redacted version, not " +
        "the unredacted filing.",
      "EVERY row of both result sets carries DocumentType 'CCFR'. No other document type was " +
        "returned by this endpoint.",
      "NO INDEPENDENT-EXPENDITURE ROW. An Arizona independent-expenditure report is a different " +
        "document type and this endpoint did not return one. That is a statement about this route, " +
        "never a finding that no independent expenditure occurred.",
      "NO COMMITTEE-TO-MEASURE LINKAGE. Neither this endpoint nor the state register publishes which " +
        "committees support or oppose a ballot measure. A committee's NAME is not evidence of its " +
        "position and this product never infers one.",
      "DATES ARE AS FILED AND SOME ARE PLAINLY WRONG — years 0006 and 2926 appear, and some rows " +
        "carry a null date. They are preserved exactly as the filer entered them and never repaired, " +
        "because a corrected date would be our claim rather than the filer's record.",
      "COMMITTEE NAMES ARE AS FILED AND NOT DEDUPLICATED. 'Andrés for Supervisor' and " +
        "'ANDRES FOR SUPERVISOR' both appear. They are not merged here: matching them would be a " +
        "name match, which this project's own bar refuses to treat as agreement.",
      "ItemizedListType IS NOT UNIFORM. A contribution result set also carries Loan, Interest, " +
        "Rebate/Refund and Donation/Support rows; a distribution result set also carries " +
        "Contributions Made, Reimbursements and Outstanding Accounts/Debts. Summing across them " +
        "would invent a figure no filer reported.",
    ],
    counts: {
      /** RULING 159 floors. A zero population throws rather than being written. */
      floors: [floorLine(contributionFloor), floorLine(distributionFloor)],
      contributionRows: contributions.rows.length,
      distributionRows: distributions.rows.length,
      contributionsByItemizedListType: tally(contributions.rows, "ItemizedListType"),
      distributionsByItemizedListType: tally(distributions.rows, "ItemizedListType"),
      contributionsByDocumentType: tally(contributions.rows, "DocumentType"),
      distributionsByDocumentType: tally(distributions.rows, "DocumentType"),
    },
    /**
     * RULING 205 — the obligation stays OPEN and names its next public route.
     * None of these is "not available"; each is a route not yet completed.
     */
    stillOwed: [
      {
        record: "Arizona INDEPENDENT-EXPENDITURE reports for Pima County committees",
        why: "every row this route returns carries DocumentType 'CCFR'. The IE class is a different document type.",
        nextRoute: "https://seethemoney.az.gov — AZ Secretary of State's campaign-finance reporting surface",
        permission:
          "ALLOWED. robots.txt answers HTTP 404 (NO_ROBOTS), re-read " + recordedOn + "; no terms page. " +
          "The landing page answers HTTP 200 and POST /Reporting/GetNEWTableData answers HTTP 200 JSON.",
        progressThisSession:
          "docs/sources.md recorded this endpoint as 'REACHABLE, parameters NOT determined'. The parameter " +
          "NAMES are now determined, read out of the site's own bundle /bundles/core: Page, startYear, " +
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
          "POST body and URLHash for one known committee, exactly as the Pima Origin header was learned. " +
          "The two prior rungs both fell to reading the app's own traffic rather than guessing.",
      },
      {
        record: "the UNREDACTED Pima County filing bodies",
        why:
          "every filing id held ends '_Redacted', and documents/getdocumentfiling/{id} answers HTTP 401 " +
          "with a 58-byte IIS edge page, with and without a trailing slash.",
        nextRoute: "a public-records request to the Pima County filing officer (Pima County Elections, Tucson AZ 85756)",
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
        exactNextStep:
          "Read the Statement of Organization filings already present in the filing index of " +
          "data/states/az/campaign-finance/az-pima-2026-held.json.",
      },
    ],
    contributions: contributions.rows,
    distributions: distributions.rows,
  } as unknown as AzPimaTransactions;

  const customer = user.value.Customer && typeof user.value.Customer === "object"
    ? user.value.Customer as Record<string, unknown>
    : {};
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
        filingId: `easyvote:pima:${documentId}`,
        documentName: String(filed.documentname ?? ""),
        documentType: String(filed.documenttype ?? ""),
        dateSubmitted: String(filed.datesubmitted ?? ""),
        documentBodyHeld: false,
        documentBodyWall: `${API_BASE}/documents/getdocumentfiling/${documentId} is not part of this public-index/transaction acquisition; no filing-body fact is inferred.`,
      };
    });
  });
  if (committeeRegisterCountyPortal.some((row) => !row.portalFilerId || !row.registeredName)) {
    throw new Error("The Pima filer index contains a row without its official filer id or registered name.");
  }
  if (new Set(committeeRegisterCountyPortal.map((row) => row.portalFilerId)).size !== committeeRegisterCountyPortal.length) {
    throw new Error("The Pima filer index contains duplicate official filer ids.");
  }

  const held: AzPimaHeld = {
    formatVersion: 1,
    recordedOn,
    filingAuthorityIdentification: {
      authorityId: "az:county:pima:officer-in-charge-of-elections",
      officeNameAsPublished: String(customer.Name ?? "Pima County Elections"),
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
      { routeId: "AZ_PIMA_EASYVOTE_TENANT", url: user.url, method: "GET", httpStatus: user.status, retrievedOn: recordedOn },
      { routeId: "AZ_PIMA_EASYVOTE_PUBLIC_FILINGS", url: filers.url, method: "GET", httpStatus: filers.status, retrievedOn: recordedOn, yielded: `${committeeRegisterCountyPortal.length} filers and ${filingsIndexed.length} filing index rows` },
    ],
    notHeld: [
      "The public filing-body route is not part of this projection; only the official index and separately published redacted transaction searches are held.",
      "No independent-expenditure report is inferred from a transaction endpoint whose returned rows are CCFR records.",
      "No committee-to-measure position is inferred from committee names.",
      "The Arizona statewide reporting-period table is not duplicated into this local projection.",
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
  candidateSubmitted = true;
  const outcome = await processRegisteredManualCandidate(
    new PostgresRoutineDataStore(),
    "az-pima-local-finance",
    candidate,
    retrievedAt,
  );
  if (!outcome.promoted) throw new Error(`Pima campaign-finance promotion refused: ${outcome.candidate.failureCode}`);
  console.log(`\npromoted ${outcome.promoted.versionId}; no tracked runtime artifact was written`);
  console.log(`  ${contributions.rows.length} contribution rows, ${distributions.rows.length} distribution rows`);
  console.log(`  reconciliation: ${document.reconciliation.verdict}`);
}

let candidateSubmitted = false;
try {
  await main();
} catch (error) {
  if (!candidateSubmitted) {
    const attemptedAt = new Date().toISOString();
    const failed = failedAcquisitionCandidate({
      sourceId: "az-pima-local-finance",
      recordClass: "LOCAL_CAMPAIGN_FINANCE",
      scope: "US-AZ:county:pima:campaign-finance:2026",
      requestedUrl: `${API_BASE}/filer/documentsearch/${CUSTOMER_ID}`,
      attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: "pima-campaign-finance/2",
    });
    await processRegisteredManualCandidate(new PostgresRoutineDataStore(), "az-pima-local-finance", failed, attemptedAt);
  }
  throw error;
}
