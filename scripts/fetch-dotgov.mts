import { fetchSource } from "../lib/sources/fetch-source.ts";
/** @freshness-reads-here */

import { stamp } from "./stamp.mts";
import { DOTGOV_BOUNDARY, parseDotGovRegistry, type DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
export type { DotGovDomain, DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import { dotGovCandidate } from "../lib/civic-data/candidate-builders.ts";
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
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";

const COMMITS_URL = "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1";

const UA = "we-the-people/1.0 (civic data; contact seanj22@gmail.com)";


const MIN_DOMAINS = 15_000;
const MIN_ELECTION_DOMAINS = 500;

export interface DotGovAcquisition {
  readonly snapshot: DotGovSnapshot;
  readonly rawText: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}

async function currentSourceSha(signal?: AbortSignal): Promise<string> {
  const response = await requestPublisher("CISA dotgov revision", () =>
    fetchSource(COMMITS_URL, {
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

export async function acquireDotGov(signal?: AbortSignal): Promise<DotGovAcquisition> {
  const sha = await currentSourceSha(signal);
  const csvUrl = `https://raw.githubusercontent.com/cisagov/dotgov-data/${sha}/current-full.csv`;
  const response = await requestPublisher("CISA dotgov registry", () =>
    fetchSource(csvUrl, { headers: { "user-agent": UA }, signal }));
  if (!response.ok) {
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

  const retrievedAt = new Date().toISOString();

  const snapshot: DotGovSnapshot = {
    source: {
      name: "cisagov/dotgov-data",
      url: `https://github.com/cisagov/dotgov-data/blob/${sha}/current-full.csv`,
      sha,
      file: "current-full.csv",
      licence: "US Government work, public domain",
      readAt: stamp(),
    },
    counts: {
      domains: domains.length,
      electionDomains: electionDomains.length,
      byType,
    },
    domains,
    boundary: DOTGOV_BOUNDARY,
  };
  return { snapshot, rawText: csv, finalUrl: response.url || csvUrl, retrievedAt };
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
  let acquisition: DotGovAcquisition;
  try {
    acquisition = await withPublisherAcquisitionDeadline(
      "CISA dotgov",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      acquireDotGov,
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
  const snapshot = acquisition.snapshot;
  const candidate = dotGovCandidate(acquisition);
  const outcome = await processRegisteredRoutineCandidate(store, "dotgov", candidate, acquisition.retrievedAt);
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
  if (!outcome.promoted) process.exitCode = 2;
}

if (process.argv[1]?.endsWith("fetch-dotgov.mts")) {
  await main();
}
