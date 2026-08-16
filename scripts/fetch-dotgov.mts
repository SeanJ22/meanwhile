/**
 * The .gov registry snapshot — item 9, 2026-08-16.
 *
 * `cisagov/dotgov-data` publishes `current-full.csv`: every domain in the
 * .gov TLD, with the registrant's own organization name, city, state, and
 * CISA's own `Domain type` classification. It is the closest thing that
 * exists to a machine-readable roster of American government web presence.
 *
 * ## What it is FOR here
 *
 * A LINK LADDER RUNG, and nothing else yet. When a hunt needs "does this
 * county publish anything, and where", a registry of every .gov domain with
 * its registrant is the cheapest first rung there is — and the 693 domains
 * CISA itself types as election offices are the named rung for the ballot
 * and candidate-filing hunts.
 *
 * ## THE BOUNDARY, and it is the important half: DOMAINS ARE NOT A
 * DENOMINATOR.
 *
 * CLAUDE.md's coverage rule is that "we watch N of M bodies here" takes M
 * from the Census of Governments and the official enumerations — never from
 * counting our own records. This file is not one of those enumerations and
 * must never be used as one:
 *
 * - **A government with no .gov domain is missing from it entirely.** Small
 *   towns, school districts and special districts routinely publish on a
 *   `.org`, a `.us`, a vendor subdomain, or a Facebook page. Counting .gov
 *   domains would undercount exactly the bodies hardest to cover, which is
 *   the Sunnyside class of miss the coverage rule exists to catch.
 * - **A government can hold several domains**, and one domain can front
 *   several governments, so the count is not a count of governments in
 *   either direction.
 * - **A domain is not a body.** `chicagoelections.gov` is one domain and the
 *   Chicago Board of Election Commissioners is one body; nothing here maps
 *   the two, and nothing here should be made to look as though it does.
 *
 * So the snapshot records what it is: a list of domains, with CISA's own
 * types and counts. It answers "where might this government publish", never
 * "how many governments are there".
 *
 * ## SHA-pinned, never `main`
 *
 * The repository commits a new zone file most days. Fetching `main` means
 * the same command returns different data on different days and nothing
 * records which. The pin is bumped deliberately, with a diff.
 *
 * ## Thin-guard
 *
 * The registry holds ~16,500 domains and CISA types ~693 of them as election
 * offices. A truncation, a redirect to an HTML error page, or a column
 * rename all present as "fewer rows than there should be", and every one of
 * them would otherwise write a snapshot that reports success while holding
 * nothing. An operation that can return nothing is asked what it returned.
 *
 * ## Licence
 *
 * US Government work, public domain. Cited; nothing else is owed.
 *
 *   pnpm dotgov:fetch
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stamp } from "./stamp.mts";

/**
 * The pin. Read from the GitHub commits API on 2026-08-16; the commit itself
 * is the zone-file update dated 2026-08-16T07:38:32Z.
 */
const SHA = "47f9693e15cf8927aebefabc05d8c34e184080b1";

const CSV_URL = `https://raw.githubusercontent.com/cisagov/dotgov-data/${SHA}/current-full.csv`;

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
  /**
   * The election subset, in full. The rest of the registry is recorded by
   * COUNT rather than committed: the ladder needs the election offices by
   * name, and 16,500 rows of JSON in the bundle would be a cost with no
   * reader on the other end of it.
   */
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

export async function fetchDotGov(): Promise<DotGovSnapshot> {
  const response = await fetch(CSV_URL, { headers: { "user-agent": UA } });
  if (!response.ok) {
    throw new Error(`dotgov: ${CSV_URL} answered ${response.status}`);
  }
  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = cells(lines[0] ?? "");
  if (header[0] !== "Domain name" || header[1] !== "Domain type") {
    throw new Error(
      `dotgov: the columns are not what this parser was written against — got ${header.join(", ")}`,
    );
  }

  const rows = lines.slice(1).map(cells);
  const byType: Record<string, number> = {};
  const electionDomains: DotGovDomain[] = [];
  for (const row of rows) {
    const type = row[1]?.trim() ?? "";
    byType[type] = (byType[type] ?? 0) + 1;
    // CISA's OWN type is the filter. Not a name match on "vote" or
    // "election", which would both miss `sos.gov`-style offices and sweep in
    // a city called Election. The registry classified these; we read it.
    if (!/election/i.test(type)) continue;
    electionDomains.push({
      domain: row[0].trim(),
      type,
      organization: value(row[2]) ?? "",
      suborganization: value(row[3]),
      city: value(row[4]),
      state: value(row[5]),
    });
  }

  if (rows.length < MIN_DOMAINS) {
    throw new Error(
      `dotgov: ${rows.length} domains is below the floor of ${MIN_DOMAINS} — refusing to write a thin snapshot`,
    );
  }
  if (electionDomains.length < MIN_ELECTION_DOMAINS) {
    throw new Error(
      `dotgov: ${electionDomains.length} election-typed domains is below the floor of ${MIN_ELECTION_DOMAINS} — refusing to write a thin snapshot`,
    );
  }

  electionDomains.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    source: {
      name: "cisagov/dotgov-data",
      url: `https://github.com/cisagov/dotgov-data/blob/${SHA}/current-full.csv`,
      sha: SHA,
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
}

async function main() {
  const snapshot = await fetchDotGov();
  const dir = join(process.cwd(), "data", "dotgov");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "snapshot.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  // Every count, stated. A run that says nothing about what it fetched is
  // indistinguishable from one that fetched nothing.
  console.log(`dotgov: ${snapshot.counts.domains} domains at ${SHA}`);
  console.log(
    `dotgov: ${snapshot.counts.electionDomains} typed as election offices — the named rung list`,
  );
  const types = Object.entries(snapshot.counts.byType)
    .filter(([type]) => /election/i.test(type))
    .sort((a, b) => b[1] - a[1]);
  for (const [type, n] of types) console.log(`  ${String(n).padStart(5)}  ${type}`);
  console.log(`dotgov: written to data/dotgov/snapshot.json`);
  console.log(`dotgov: ${BOUNDARY}`);
}

if (process.argv[1]?.endsWith("fetch-dotgov.mts")) {
  await main();
}
