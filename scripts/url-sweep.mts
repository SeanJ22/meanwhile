/**
 * EVERY URL THIS REPOSITORY HAS EVER WRITTEN DOWN, AGAINST WHAT IS REGISTERED.
 * (2026-08-26, the sources-and-incumbency session. Item 3a of that brief.)
 *
 * **The third bucket is the whole point.** A source discussed once in a brief,
 * a ruling or a hunt record and then abandoned looks EXACTLY like a source
 * nobody ever found. Both are absent from every register, so no instrument in
 * this repo can tell them apart, and the second one gets re-derived by the next
 * session at full cost.
 *
 * Three counts, and each has its own response:
 *
 *   IN USE AND REGISTERED       nothing owed
 *   IN USE BUT NEVER REGISTERED a DEFECT under RULING 96 — a source walked but
 *                               not recorded is one the next session re-derives
 *   WRITTEN DOWN, NEVER USED    a candidate. It goes to docs/sources/inbox.md
 *                               as a proposal for a session to classify
 *
 * "In use" is decided by where the URL appears, not by whether anybody liked
 * it: a URL under `lib/`, `app/`, `components/` or `data/` is wired into
 * something that runs. A URL that appears only under `docs/` was written about.
 *
 * "Registered" is decided by HOST against `docs/sources.md`, deliberately
 * loosely — the register writes hosts in prose and in table cells and a
 * path-exact match would report almost everything unregistered, which is a
 * sweep that finds a defect it invented.
 *
 * RULING 159 — the run FAILS if the sweep matches nothing. Zero URLs in a
 * repository that carries thousands is a broken sweep, never a clean board.
 *
 * NOISE, AND WHY IT IS EXCLUDED BY NAME. `tests/fixtures/` holds recorded HTTP
 * bodies — the bytes a server actually sent — so an unfiltered sweep returns
 * 67,265 URLs, of which essentially all are hyperlinks inside somebody else's
 * HTML. Those are not sources this project found; they are the contents of
 * pages it fetched. Excluding them is a deliberate clip and it is STATED here
 * and printed on every run rather than being silently convenient.
 *
 * Usage:  pnpm url:sweep [--json] [--limit N]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Where a URL was found, and what that says about whether it is wired in. */
export type UrlUse = "WIRED" | "WRITTEN_ABOUT" | "RETRIEVED_CONTENT";

export interface SweptUrl {
  readonly url: string;
  readonly host: string;
  readonly use: UrlUse;
  /** The exact host appears in `docs/sources.md`. The strict reading. */
  readonly registered: boolean;
  /**
   * The registrable DOMAIN appears in `docs/sources.md` — so `api.congress.gov`
   * counts as registered where the register writes `congress.gov`.
   *
   * BOTH READINGS ARE REPORTED, as a pair, because each is wrong in its own
   * direction and a single figure standing in front of two measurements is the
   * data-destruction pattern this repo names most often. Strict OVER-reports
   * the gap: the register writes `congress.gov` in prose and the API lives on a
   * subdomain. Loose UNDER-reports it: a register mentioning `nh.gov` would
   * absorb every New Hampshire host that has ever existed.
   */
  readonly registeredLoose: boolean;
  readonly files: readonly string[];
}

const WIRED_PREFIXES = ["lib/", "app/", "components/", "scripts/"];

/**
 * `data/` IS ITS OWN POPULATION AND IS COUNTED SEPARATELY, NEVER FOLDED IN.
 *
 * The first version of this sweep put `data/` in the WIRED bucket and reported
 * **63,210 sources in use but never registered** — a number that sounds like a
 * catastrophic register gap and is actually the `tests/fixtures` problem one
 * directory over. A committed snapshot carries two completely different kinds
 * of URL: the `source_url` this project chose to walk, and every hyperlink that
 * happened to be inside the page it fetched. Nothing cheap separates them.
 *
 * So they are reported as their own line with the ambiguity stated, rather than
 * blended into a count that would read as a finding (the two-numbers rule, and
 * RULING 105's three-way split). A blended figure here would have been a
 * partial that reconciles: it adds up, and it is wrong.
 */
const RETRIEVED_PREFIXES = ["data/"];

/** Hosts that are infrastructure rather than civic sources. Excluded by name. */
export const NOT_A_SOURCE = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "gmpg.org",
  "schemas.openxmlformats.org",
  "www.w3.org",
  "localhost",
  "127.0.0.1",
  "api.anthropic.com",
  "registry.npmjs.org",
  "nodejs.org",
  "www.iec.ch",
  "purl.org",
  "creativecommons.org",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "opensource.org",
  "spdx.org",
];

export function isInfrastructure(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return NOT_A_SOURCE.some((n) => h === n || h.endsWith(`.${n}`));
}

/** A URL's registrable host, or null when it does not parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * An approximate registrable domain — the last two labels, or the last three
 * where the second-to-last is a known two-part public suffix used by US
 * governments (`state.nh.us`, `az.gov` is one label so it is unaffected).
 *
 * APPROXIMATE, AND SAID SO. There is no public-suffix list in this repo and
 * fetching one at sweep time would make an offline instrument depend on a
 * network call. This is why the loose reading is reported BESIDE the strict one
 * rather than replacing it.
 */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/:\d+$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const twoPart = new Set(["state.nh.us", "state.nj.us", "state.az.us", "co.uk", "gov.uk"]);
  const lastThree = parts.slice(-3).join(".");
  if (twoPart.has(parts.slice(-3).join("."))) return parts.slice(-4).join(".") || lastThree;
  if (twoPart.has(parts.slice(-2).join("."))) return lastThree;
  return parts.slice(-2).join(".");
}

export function gitGrepUrls(paths: readonly string[]): Map<string, Set<string>> {
  // `-a --untracked` — a NUL byte and a hidden path each make a plain grep
  // report nothing found without having looked.
  const out = execFileSync(
    "git",
    [
      "grep",
      "-a",
      "--untracked",
      "-I",
      "-oE",
      "https?://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+",
      "--",
      ...paths,
      ":(exclude)tests/fixtures",
      ":(exclude)pnpm-lock.yaml",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );

  const byUrl = new Map<string, Set<string>>();
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const file = line.slice(0, sep);
    const url = line.slice(sep + 1).replace(/[),.;:'"`>\]]+$/, "");
    if (!url.startsWith("http")) continue;
    if (!byUrl.has(url)) byUrl.set(url, new Set());
    byUrl.get(url)!.add(file);
  }
  return byUrl;
}

export function sweep(): SweptUrl[] {
  const byUrl = gitGrepUrls(["docs/", "lib/", "scripts/", "states/", "app/", "components/", "data/", "CLAUDE.md"]);
  const register = readFileSync(join(ROOT, "docs/sources.md"), "utf8").toLowerCase();

  const out: SweptUrl[] = [];
  for (const [url, files] of byUrl) {
    const host = hostOf(url);
    if (!host || isInfrastructure(host)) continue;
    const fileList = [...files].sort();
    const wired = fileList.some((f) => WIRED_PREFIXES.some((p) => f.startsWith(p)));
    const retrieved = !wired && fileList.every((f) => RETRIEVED_PREFIXES.some((p) => f.startsWith(p)));
    // The bare host and the host without a leading `www.` — the register writes
    // both forms and a session should not have to guess which.
    const bare = host.replace(/^www\./, "");
    out.push({
      url,
      host,
      use: wired ? "WIRED" : retrieved ? "RETRIEVED_CONTENT" : "WRITTEN_ABOUT",
      registered: register.includes(host) || register.includes(bare),
      registeredLoose: register.includes(host) || register.includes(bare) || register.includes(registrableDomain(host)),
      files: fileList,
    });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host) || a.url.localeCompare(b.url));
}

export interface SweepCounts {
  readonly total: number;
  readonly hosts: number;
  /** The three counts Item 3a owes, computed over code and documents only. */
  readonly inUseRegistered: number;
  readonly inUseUnregistered: number;
  readonly inUseUnregisteredLoose: number;
  readonly writtenNeverUsed: number;
  readonly writtenNeverUsedLoose: number;
  /** Stated separately and never folded in. See RETRIEVED_PREFIXES. */
  readonly retrievedContent: number;
  readonly retrievedHosts: number;
}

export function countsFor(rows: readonly SweptUrl[]): SweepCounts {
  const retrieved = rows.filter((r) => r.use === "RETRIEVED_CONTENT");
  const judged = rows.filter((r) => r.use !== "RETRIEVED_CONTENT");
  return {
    total: judged.length,
    hosts: new Set(judged.map((r) => r.host)).size,
    inUseRegistered: judged.filter((r) => r.use === "WIRED" && r.registered).length,
    inUseUnregistered: judged.filter((r) => r.use === "WIRED" && !r.registered).length,
    inUseUnregisteredLoose: judged.filter((r) => r.use === "WIRED" && !r.registeredLoose).length,
    writtenNeverUsed: judged.filter((r) => r.use === "WRITTEN_ABOUT" && !r.registered).length,
    writtenNeverUsedLoose: judged.filter((r) => r.use === "WRITTEN_ABOUT" && !r.registeredLoose).length,
    retrievedContent: retrieved.length,
    retrievedHosts: new Set(retrieved.map((r) => r.host)).size,
  };
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/url-sweep.mts");

if (invokedDirectly) {
  const rows = sweep();
  if (rows.length === 0) {
    // RULING 159 — zero is a result that must be EARNED.
    console.error(
      "url:sweep: matched no URLs at all in docs/, lib/, scripts/, states/, app/, components/ or data/. " +
        "This repository is known to carry thousands, so this is a broken sweep, not a clean board.",
    );
    process.exit(1);
  }

  const counts = countsFor(rows);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ counts, rows }, null, 2));
  } else {
    console.log(`url:sweep · ${counts.total} distinct URL(s) across ${counts.hosts} host(s) in code and documents`);
    console.log(`  tests/fixtures EXCLUDED by name — recorded HTTP bodies, not sources this project found`);
    console.log(`  in use and registered        ${counts.inUseRegistered}`);
    console.log(
      `  in use but NEVER registered  ${counts.inUseUnregistered} strict / ${counts.inUseUnregisteredLoose} by ` +
        `registrable domain   <- a defect under RULING 96`,
    );
    console.log(
      `  written down, never used     ${counts.writtenNeverUsed} strict / ${counts.writtenNeverUsedLoose} by ` +
        `registrable domain   <- inbox candidates`,
    );
    console.log(
      `  data/ retrieved content      ${counts.retrievedContent} URL(s) across ${counts.retrievedHosts} host(s), ` +
        `counted SEPARATELY — a snapshot carries both the source_url we chose and every link inside the page we fetched, ` +
        `and nothing cheap separates them`,
    );

    const unregisteredHosts = new Map<string, number>();
    for (const r of rows) {
      if (r.use === "WIRED" && !r.registered) unregisteredHosts.set(r.host, (unregisteredHosts.get(r.host) ?? 0) + 1);
    }
    console.log(`\nWIRED IN AND UNREGISTERED, by host (${unregisteredHosts.size}):`);
    for (const [h, n] of [...unregisteredHosts].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`  ${String(n).padStart(4)}  ${h}`);
    }
  }
}
