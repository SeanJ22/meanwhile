/**
 * THE DISCOVERY PASS FOR ONE STATE, AS A COMMAND.
 * (2026-08-26, the sources-and-incumbency session. Items 5b and 9.)
 *
 * Runs the stored reconnaissance template in `lib/hunt/state-recon.ts` against
 * one state, collects candidate URLs, dedupes them against that state's
 * registry, and writes only what is NEW into `docs/sources/inbox.md` as a
 * proposal.
 *
 * **It proposes and never registers.** Classification needs judgement; a
 * crawler that registered its own finds would fill the registry with junk that
 * later reads as verified.
 *
 * **It records the queries it ran**, including the ones that returned nothing,
 * so a later session can see what was asked and what was not.
 *
 * **IT FAILS LOUDLY ON ZERO** (RULING 159). Zero civic sources for a US state
 * means the crawler broke, not that the state has none.
 *
 * **AND IT ASKS PERMISSION BEFORE REACHABILITY.** Every query goes through
 * `SEARCH_POOL`, which holds only engines whose own `robots.txt` permits the
 * query path (RULING 148). A disallowed engine is not in the pool and is never
 * reached from here.
 *
 * Usage:
 *   pnpm state:discover --state az            # run the pass
 *   pnpm state:discover --state az --dry-run  # print the queries, fetch nothing
 *   pnpm state:discover --state az --gate     # only check the RULING 86 gate
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { SEARCH_POOL } from "../lib/hunt/search-pool.ts";
import { checkStateRegistry } from "../lib/hunt/state-registry-gate.ts";
import { STATE_NAMES, queriesFor } from "../lib/hunt/state-recon.ts";
import { judgeUrl } from "./robots-sweep.mts";

const ROOT = process.cwd();
const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const code = (arg("state") ?? "").trim().toLowerCase();
if (!code) {
  console.error("state:discover: --state <code> is required. There is no default state, on purpose.");
  process.exit(1);
}

const stateName = STATE_NAMES[code];
if (!stateName) {
  console.error(
    `state:discover: no full name is recorded for "${code}" in lib/hunt/state-recon.ts. ` +
      "Add it there rather than passing one in — a name typed at the command line is a name the " +
      "next session cannot reproduce.",
  );
  process.exit(1);
}

/* ---------------------------------------------------------------- the gate --- */

const gate = checkStateRegistry(code, ROOT);
console.log(`state:discover · ${stateName} (${code.toUpperCase()})`);
console.log(`  RULING 86 gate: ${gate.verdict} — ${gate.reason}`);
if (process.argv.includes("--gate")) process.exit(gate.verdict === "REGISTERED" ? 0 : 1);

if (gate.verdict !== "REGISTERED") {
  console.log("");
  console.log("  The registry is missing or empty. That does NOT stop this pass — this pass is how the");
  console.log("  registry gets built. It stops the HUNT, which is a different thing and is enforced in");
  console.log("  lib/hunt/state-registry-gate.ts.");
}

/* --------------------------------------------------------------- the pass --- */

const queries = queriesFor(stateName, code);
console.log(`  ${queries.length} query(ies) across ${new Set(queries.map((q) => q.classId)).size} source class(es)`);
console.log("");

if (process.argv.includes("--dry-run")) {
  for (const { classId, query } of queries) console.log(`  [${classId}] ${query}`);
  console.log("");
  console.log("  --dry-run: nothing was fetched. These are the queries a run would ask.");
  process.exit(0);
}

if (SEARCH_POOL.length === 0) {
  console.error(
    "state:discover: SEARCH_POOL is EMPTY, so there is no compliant engine to ask. That is a wall to " +
      "report, not a state with no sources (RULING 159).",
  );
  process.exit(1);
}

interface Found {
  readonly classId: string;
  readonly query: string;
  readonly urls: readonly string[];
}

/**
 * THE CONTROL QUERY RUNS FIRST, AND IT DECIDES WHETHER ANYTHING ELSE COUNTS.
 * (RULING 68, and RULING 110 — an instrument must be shown catching the real
 * thing before its green means anything.)
 *
 * **This check was added because the first version of this script reported
 * `28 of 28 queries returned anything` while the engine returned no results at
 * all.** `4get.ca` answers HTTP 200 with a 7,354-byte page that is entirely
 * interface — an engine selector, a country selector — and exactly one URL in
 * it, a link to the search software's own repository. A per-query check that
 * asked *did the fetch succeed and did we extract at least one URL* said yes
 * twenty-eight times about a page with nothing in it.
 *
 * So: ask something that cannot exist. If the real query's page is
 * indistinguishable from the impossible query's page, the engine is not
 * answering and this run is a WALL to report, never a state with no sources.
 */
const CONTROL_QUERY = "zzqxwvnonexistent99 zzqxwvnonexistent98";

/** Links that are the search interface talking about itself, not results. */
const CHROME_HOSTS = ["4get.ca", "git.lolcat.ca", "lolcat.ca"];

function resultUrls(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/g)]
        .map((m) => m[0].replace(/[),.;:'"`>\]]+$/, ""))
        .filter((u) => {
          try {
            const h = new URL(u).host.toLowerCase();
            return !CHROME_HOSTS.some((c) => h === c || h.endsWith(`.${c}`));
          } catch {
            return false;
          }
        }),
    ),
  ];
}

const engine = SEARCH_POOL[0];
let controlBytes = 0;
let controlUrls = 0;
try {
  const res = await fetch(engine.url(CONTROL_QUERY), {
    headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!engine.refuses(res.status)) {
    const body = await res.text();
    controlBytes = body.length;
    controlUrls = resultUrls(body).length;
  }
} catch {
  controlBytes = 0;
}
console.log(
  `  control query on ${engine.id}: ${controlBytes} B, ${controlUrls} result URL(s) — an impossible query`,
);

const results: Found[] = [];
const asked: string[] = [];

for (const { classId, query } of queries) {
  asked.push(query);
  let urls: string[] = [];
  try {
    const res = await fetch(engine.url(query), {
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!engine.refuses(res.status)) {
      const body = await res.text();
      // A page the same size as the impossible query's page, carrying no more
      // result links than it did, is not an answer.
      const found = resultUrls(body);
      const indistinguishable = found.length <= controlUrls && Math.abs(body.length - controlBytes) < 200;
      urls = indistinguishable ? [] : found;
    }
  } catch {
    urls = [];
  }
  results.push({ classId, query, urls });
  // Serialized, spaced. The retrieval discipline binds every rung.
  await new Promise((r) => setTimeout(r, 1200));
}

const registry = gate.verdict === "REGISTERED" ? (await import("node:fs")).readFileSync(join(ROOT, gate.path), "utf8") : "";
const allUrls = [...new Set(results.flatMap((r) => r.urls))];
const fresh: string[] = [];
for (const u of allUrls) {
  let host: string;
  try {
    host = new URL(u).host.toLowerCase();
  } catch {
    continue;
  }
  if (registry.toLowerCase().includes(host)) continue;
  if (!/\.gov$|\.us$|\.org$|\.edu$/.test(host)) continue;
  fresh.push(u);
}

console.log(`  queries run          ${asked.length}`);
console.log(`  candidates found     ${allUrls.length}`);
console.log(`  already registered   ${allUrls.length - fresh.length}`);
console.log(`  genuinely new        ${fresh.length}`);

const answered = results.filter((r) => r.urls.length > 0).length;
console.log(`  queries that returned anything  ${answered} of ${asked.length}`);

if (answered === 0) {
  // RULING 159. Zero civic sources for a US state is a broken crawl, and it is
  // reported as a WALL naming the engine — never as a fact about the state.
  const lines = [
    "",
    `### \`pnpm state:discover --state ${code}\` — ${stateName} — **THE ENGINE RETURNED NOTHING**`,
    "",
    `Run 2026-08-26. ${asked.length} queries asked; **every one produced a page indistinguishable`,
    `from the page an impossible query produces** (control: ${controlBytes} B, ${controlUrls} result`,
    `URL(s)). That is a WALL at \`${engine.id}\`, dated, and it is NOT a finding about ${stateName}.`,
    "",
    "**The queries asked, so the next session can see what was not answered:**",
    "",
    ...results.map((r) => `- \`${r.query}\``),
    "",
  ];
  appendFileSync(join(ROOT, "docs/sources/inbox.md"), lines.join("\n"), "utf8");
  console.error("");
  console.error(
    `state:discover: EVERY one of ${asked.length} queries produced a page indistinguishable from the ` +
      `control. That is a WALL at ${engine.id}, not a state with no civic sources (RULING 159). ` +
      "The queries and the verdict are recorded in docs/sources/inbox.md.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------- the output --- */

const lines: string[] = [
  "",
  `### Proposed by \`pnpm state:discover --state ${code}\` — ${stateName}`,
  "",
  `Run 2026-08-26 in this session. **Proposals, not registrations** — classification, licence and`,
  `coverage need judgement, and a crawler that registered its own finds would fill the registry with`,
  `junk that later reads as verified.`,
  "",
  `${asked.length} queries asked · ${answered} returned anything · ${allUrls.length} candidates ·`,
  `${fresh.length} not already in \`${gate.path}\`.`,
  "",
];
if (fresh.length > 0) {
  for (const u of fresh.slice(0, 200)) lines.push(`- ${u}`);
} else {
  lines.push("*(nothing new — every candidate host is already registered)*");
}
lines.push("");
lines.push("**The queries asked, including the ones that returned nothing:**");
lines.push("");
for (const r of results) lines.push(`- \`${r.query}\` — ${r.urls.length} candidate(s)`);
lines.push("");

appendFileSync(join(ROOT, "docs/sources/inbox.md"), lines.join("\n"), "utf8");
console.log("");
console.log(`  written to docs/sources/inbox.md`);

// The permission question, asked about what was found, before anybody walks it.
if (fresh.length > 0) {
  console.log("");
  console.log("  permission verdicts for the first 10 new candidates (RULING 148, asked BEFORE reachability):");
  for (const u of fresh.slice(0, 10)) {
    const v = await judgeUrl(u);
    console.log(`    ${v.verdict.padEnd(12)} ${u}`);
  }
}
