/**
 * The .gov registry snapshot. `cisagov/dotgov-data` publishes
 * `current-full.csv`: every .gov domain with its registrant's organization,
 * city, state and CISA's own `Domain type`. It is a link-ladder rung ("where
 * might this government publish"), and CISA's election-office type names the
 * rung for ballot and candidate-filing hunts.
 *
 * Domains are not a denominator: a government with no .gov domain is missing
 * entirely, one government can hold several domains, and a domain is not a
 * body. Never count governments from it.
 *
 * The current commit touching the CSV is resolved first and the payload is read
 * at that exact SHA. Floors well below the observed counts refuse a truncation
 * or an HTML error page. US Government work, public domain.
 *
 * Production cadence and owner-initiated promotion enter through the installed
 * runtime dispatcher; this file is the internal `dotgov` acquisition adapter.
 *
 * @freshness-reads-here — the read stamp is minted only after the pinned CSV
 * body has been read and its complete structural denominator has validated.
 */

import { stamp } from "./stamp.mts";
import { DOTGOV_BOUNDARY, DOTGOV_PARSER_VERSION, DOTGOV_SCOPE, parseDotGovRegistry, type DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
export type { DotGovDomain, DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import { dotGovCandidate, sha256 } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { shortTransfer } from "../lib/sources/bulk-completeness.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const COMMITS_URL = "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1";

const UA = "we-the-people/1.0 (civic data; contact seanj22@gmail.com)";

/**
 * The floors, set well below what the registry actually held at this SHA and
 * far above zero. A normal week's churn does not trip them; a truncation
 * cannot pass them.
 */
const MIN_DOMAINS = 15_000;
const MIN_ELECTION_DOMAINS = 500;

export interface DotGovSourceAcquisition {
  readonly sourceSha: string;
  readonly rawText: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}
export interface DotGovAcquisition extends DotGovSourceAcquisition { readonly snapshot: DotGovSnapshot }

async function currentSourceSha(signal?: AbortSignal): Promise<string> {
  const response = await requestPublisher("CISA dotgov revision", () =>
    fetch(COMMITS_URL, {
      headers: { "user-agent": UA, accept: "application/vnd.github+json" },
      signal,
    }));
  if (!response.ok) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `dotgov: source revision lookup answered ${response.status}`,
    );
  }
  const text = await readPublisherBody("CISA dotgov revision", () => response.text());
  signal?.throwIfAborted();
  let rows: readonly { readonly sha?: string }[];
  try {
    rows = JSON.parse(text) as readonly { readonly sha?: string }[];
  } catch {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "dotgov: source revision lookup returned invalid JSON");
  }
  if (!Array.isArray(rows)) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "dotgov: source revision lookup did not return an array");
  }
  const sha = rows[0]?.sha;
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      "dotgov: current-full.csv source revision was not a full Git commit SHA",
    );
  }
  return sha.toLowerCase();
}

export async function acquireDotGovSource(signal?: AbortSignal): Promise<DotGovSourceAcquisition> {
  const sha = await currentSourceSha(signal);
  const csvUrl = `https://raw.githubusercontent.com/cisagov/dotgov-data/${sha}/current-full.csv`;
  const response = await requestPublisher("CISA dotgov registry", () =>
    fetch(csvUrl, { headers: { "user-agent": UA }, signal }));
  if (response.status !== 200) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `dotgov: ${csvUrl} answered ${response.status}`,
    );
  }
  const csv = await readPublisherBody("CISA dotgov registry", () => response.text());
  signal?.throwIfAborted();
  // Refuse a transfer shorter than the server's declared length: a dropped tail
  // could still clear the row floor.
  const short = shortTransfer(response.headers, csv);
  if (short !== null) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `dotgov: ${csvUrl} answered ${response.status} with ${short}`,
    );
  }
  return { sourceSha: sha, rawText: csv, finalUrl: response.url || csvUrl, retrievedAt: new Date().toISOString() };
}

function normalizeDotGovSource(acquired: DotGovSourceAcquisition): DotGovAcquisition {
  const { sourceSha: sha, rawText: csv, retrievedAt } = acquired;
  let domains;
  try {
    domains = parseDotGovRegistry(csv);
  } catch (error) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `dotgov: ${error instanceof Error ? error.message : String(error)}`);
  }
  const byType: Record<string, number> = {};
  for (const row of domains) byType[row.type] = (byType[row.type] ?? 0) + 1;
  const electionDomains = domains.filter(row => /election/i.test(row.type));

  if (domains.length < MIN_DOMAINS) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `dotgov: ${domains.length} domains is below the floor of ${MIN_DOMAINS} — refusing to write a thin snapshot`,
    );
  }
  if (electionDomains.length < MIN_ELECTION_DOMAINS) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `dotgov: ${electionDomains.length} election-typed domains is below the floor of ${MIN_ELECTION_DOMAINS} — refusing to write a thin snapshot`,
    );
  }

  const snapshot: DotGovSnapshot = {
    source: {
      name: "cisagov/dotgov-data",
      url: `https://github.com/cisagov/dotgov-data/blob/${sha}/current-full.csv`,
      sha,
      file: "current-full.csv",
      licence: "US Government work, public domain",
      readAt: stamp(new Date(retrievedAt)),
    },
    counts: {
      domains: domains.length,
      electionDomains: electionDomains.length,
      byType,
    },
    domains,
    boundary: DOTGOV_BOUNDARY,
  };
  return { ...acquired, snapshot };
}

export async function acquireDotGov(signal?: AbortSignal): Promise<DotGovAcquisition> {
  return normalizeDotGovSource(await acquireDotGovSource(signal));
}

/** Compare complete current publisher bytes before parsing or loading a held registry. */
export async function refreshDotGov(input: {
  readonly store: RoutineDataStore;
  readonly signal?: AbortSignal;
  readonly readSource?: typeof acquireDotGovSource;
}) {
  const source = await (input.readSource ?? acquireDotGovSource)(input.signal);
  const rawHash = sha256(source.rawText);
  const head = await input.store.readSourceHead("DOTGOV_REFERENCE", DOTGOV_SCOPE);
  const confirmation = head?.rawHashBasis === "SOURCE_CONTENT_V1" ? await confirmSourceHashUnchanged({
    store: input.store, sourceId: "cisa-dotgov-registry", recordClass: "DOTGOV_REFERENCE", scope: DOTGOV_SCOPE,
    parserVersion: DOTGOV_PARSER_VERSION, rawHash, now: source.retrievedAt, complete: true,
    retrieval: { requestedUrl: COMMITS_URL, finalUrl: source.finalUrl, httpStatus: 200, rawHash, retrievedAt: source.retrievedAt },
  }) : null;
  if (confirmation) return { confirmation, publication: null };
  const acquisition = normalizeDotGovSource(source), candidate = dotGovCandidate(acquisition);
  const outcome = await processRegisteredRoutineCandidate(input.store, "dotgov", candidate, source.retrievedAt);
  return { confirmation: null, publication: { acquisition, candidate, outcome } };
}

export async function fetchDotGov(): Promise<DotGovSnapshot> {
  return (await acquireDotGov()).snapshot;
}

async function main() {
  installNeonRequestDeadline();
  if (!process.argv.includes("--promote")) {
    throw new Error(
      "The tracked dotgov snapshot writer is retired. Run the registered dotgov contract " +
        "through the installed runtime dispatcher; direct production execution is refused.",
    );
  }
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  let refreshed: Awaited<ReturnType<typeof refreshDotGov>>;
  try {
    refreshed = await withPublisherAcquisitionDeadline(
      "CISA dotgov",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refreshDotGov({ store, signal }),
    );
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: "dotgov",
      failure: error,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }
  if (refreshed.confirmation) {
    console.log("RCD_RECEIPT=" + JSON.stringify({ source: "dotgov", ...sourceHashReceiptFields(refreshed.confirmation), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    return;
  }
  const { acquisition, candidate, outcome } = refreshed.publication!;
  const snapshot = acquisition.snapshot;
  console.log(`dotgov: ${snapshot.counts.domains} domains at ${snapshot.source.sha}`);
  console.log(
    `dotgov: ${snapshot.counts.electionDomains} typed as election offices — the named rung list`,
  );
  const types = Object.entries(snapshot.counts.byType)
    .filter(([type]) => /election/i.test(type))
    .sort((a, b) => b[1] - a[1]);
  for (const [type, n] of types) console.log(`  ${String(n).padStart(5)}  ${type}`);
  printSourceRunnerReceipt("dotgov", candidate, outcome);
  console.log(`dotgov: ${DOTGOV_BOUNDARY}`);
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
}

if (process.argv[1]?.endsWith("fetch-dotgov.mts")) {
  await main();
}
