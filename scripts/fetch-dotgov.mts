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

/**
 * The floors, set well below what the registry actually held at this SHA and
 * far above zero. A normal week's churn does not trip them; a truncation
 * cannot pass them.
 */
const MIN_DOMAINS = 15_000;
const MIN_ELECTION_DOMAINS = 500;

export interface DotGovDomain {
  domain: string;
  /** CISA's own classification, verbatim. Never re-derived by us. */
  type: string;
  organization: string;
  suborganization: string | null;
  city: string | null;
  state: string | null;
}

export interface DotGovSnapshot {
  source: {
    name: string;
    url: string;
    sha: string;
    file: string;
    licence: string;
    readAt: string;
  };
  counts: {
    /** Every domain in the file. */
    domains: number;
    /** Domains whose CISA type names elections — the named rung list. */
    electionDomains: number;
    /** Every CISA type, with its count. The file's own shape, stated. */
    byType: Record<string, number>;
  };
  /** The election subset, in full; the rest of the registry is recorded by count. */
  electionDomains: DotGovDomain[];
  /** Stated in the file so nobody has to find the script to learn it. */
  boundary: string;
}

const BOUNDARY =
  "A list of DOMAINS, not an enumeration of governments. A government with no .gov domain is absent from it; one government may hold several domains; a domain is not a body. Never use these counts as a coverage denominator — that comes from the Census of Governments and the official rosters.";

/** A CSV line into cells, honouring quoted fields. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** CISA writes "(blank)" where a field is empty. That is not a value. */
function value(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "(blank)") return null;
  return trimmed;
}

export interface DotGovAcquisition {
  readonly snapshot: DotGovSnapshot;
  readonly rawText: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}

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

export async function acquireDotGov(signal?: AbortSignal): Promise<DotGovAcquisition> {
  const sha = await currentSourceSha(signal);
  const csvUrl = `https://raw.githubusercontent.com/cisagov/dotgov-data/${sha}/current-full.csv`;
  const response = await requestPublisher("CISA dotgov registry", () =>
    fetch(csvUrl, { headers: { "user-agent": UA }, signal }));
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
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = cells(lines[0] ?? "");
  if (header[0] !== "Domain name" || header[1] !== "Domain type") {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `dotgov: the columns are not what this parser was written against — got ${header.join(", ")}`,
    );
  }

  const rows = lines.slice(1).map(cells);
  const byType: Record<string, number> = {};
  const electionDomains: DotGovDomain[] = [];
  for (const row of rows) {
    if ((row[0] ?? "").trim() === "" || (row[1] ?? "").trim() === "") {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        "dotgov: a registry row omitted its domain name or CISA domain type",
      );
    }
    const type = row[1]?.trim() ?? "";
    byType[type] = (byType[type] ?? 0) + 1;
    // CISA's own type is the filter, never a name match on "vote" or "election".
    if (!/election/i.test(type)) continue;
    electionDomains.push({
      domain: row[0]!.trim(),
      type,
      organization: value(row[2]) ?? "",
      suborganization: value(row[3]),
      city: value(row[4]),
      state: value(row[5]),
    });
  }

  if (rows.length < MIN_DOMAINS) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `dotgov: ${rows.length} domains is below the floor of ${MIN_DOMAINS} — refusing to write a thin snapshot`,
    );
  }
  if (electionDomains.length < MIN_ELECTION_DOMAINS) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `dotgov: ${electionDomains.length} election-typed domains is below the floor of ${MIN_ELECTION_DOMAINS} — refusing to write a thin snapshot`,
    );
  }

  electionDomains.sort((a, b) => a.domain.localeCompare(b.domain));
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
      domains: rows.length,
      electionDomains: electionDomains.length,
      byType,
    },
    electionDomains,
    boundary: BOUNDARY,
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
  console.log(`dotgov: ${BOUNDARY}`);
  if (!outcome.promoted) process.exitCode = 2;
}

if (process.argv[1]?.endsWith("fetch-dotgov.mts")) {
  await main();
}
