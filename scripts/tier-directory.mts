/**
 * **WALK THE DIRECTORY THE TIER ABOVE PUBLISHES ABOUT THE TIER BELOW.**
 * (RULING 93, adopted 2026-08-22 by the author, NJ Hunt 6. Tier A by construction.)
 *
 * ```
 * pnpm tier:directory                     # every route below
 * pnpm tier:directory --route nj-localgov
 * pnpm tier:directory --list
 * ```
 *
 * ## The principle, and why it is not a list
 *
 * The federal government publishes directories of state governments. States
 * publish directories of their counties and municipalities. Counties publish
 * directories of their towns, school districts and special districts. **Before
 * hunting any tier, walk the directory the tier above publishes about it.**
 *
 * This inverts discovery from guessing sideways to descending a hierarchy. Every
 * route this project had built before it went sideways — search a name, guess a
 * host, read an encyclopedia article about one municipality at a time — and each
 * one costs per entity. A directory costs once and answers for everything below
 * it. `nj.gov/nj/gov/county/localgov.shtml` is one fetch and it names the
 * official website of all 564 New Jersey municipalities and all 21 counties.
 *
 * ## What it cost to not have this
 *
 * The county's *Cities and Towns* page reached 30 of Morris's 39 municipalities
 * and missed **Rockaway Township, the governing body of the target zip**. Six
 * sessions hunted municipal sites sideways. The state had published the list the
 * whole time, and USA.gov — the tier above THAT — links straight to it from
 * `usa.gov/states/new-jersey` under the heading *Local governments*.
 *
 * ## Licence
 *
 * Every route here is a `.gov` publication: US government works, public domain,
 * no attribution obligation and no terms to accept. `usmayors.org` is
 * deliberately NOT here — a nonprofit's directory is a discovery surface under
 * the Ballotpedia question (RULING 70), never a source of record.
 *
 * ## Honesty
 *
 * A 200 whose content is not about the thing asked for is not a document. Each
 * route declares a CONTROL string that must appear, and a route that answers
 * without it is recorded as a failed retrieval naming the wall — never as an
 * empty directory. A zero-row extraction is a FAILED extraction.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeEntities } from "../lib/hunt/roster-page.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA =
  "we-the-people/1.0 (civic data for a public-records product; contact: hello@wethepeople.vote)";
const SPACING_MS = 800;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ── The routes ─────────────────────────────────────────────────────────── */

export interface TierRoute {
  id: string;
  /** Which tier publishes it, and which tier it is about. RULING 93's shape. */
  publishedBy: string;
  aboutTier: string;
  url: string;
  /** A string that MUST appear in the response, or the fetch is a failure. */
  control: string;
  /** Only links whose text matches are entities; the rest is site furniture. */
  keep: RegExp;
  /** Links matching this are furniture even if `keep` matched. */
  drop?: RegExp;
  note: string;
}

export const TIER_ROUTES: TierRoute[] = [
  {
    id: "usagov-elected-officials",
    publishedBy: "federal (USAGov)",
    aboutTier: "elected officials, every level",
    url: "https://www.usa.gov/elected-officials",
    control: "elected officials",
    keep: /\b(?:senator|representative|governor|state legislat|mayor|county|local|contact)\b/i,
    note: "The federal front door to every level's officeholder directory.",
  },
  {
    id: "usagov-local-governments",
    publishedBy: "federal (USAGov)",
    aboutTier: "county and municipal governments",
    url: "https://www.usa.gov/local-governments",
    control: "local government",
    keep: /\b(?:state|local|county|municipal|city|town|election|governor)\b/i,
    note: "Federal directory of the state directories of local government.",
  },
  {
    id: "usagov-state-election-office",
    publishedBy: "federal (USAGov)",
    aboutTier: "state and local election offices",
    url: "https://www.usa.gov/state-election-office",
    control: "election office",
    keep: /^[A-Z][A-Za-z .'-]{3,40}$/,
    note: "One election authority per state — the office that publishes candidate filings.",
  },
  {
    id: "usagov-state-governor",
    publishedBy: "federal (USAGov)",
    aboutTier: "state governors",
    url: "https://www.usa.gov/state-governor",
    control: "governor",
    keep: /^[A-Z][A-Za-z .'-]{3,40}$/,
    note: "One governor's office per state.",
  },
  {
    id: "usagov-agency-index",
    publishedBy: "federal (USAGov)",
    aboutTier: "federal departments and agencies",
    url: "https://www.usa.gov/agency-index",
    control: "index of U.S. government departments",
    keep: /[A-Za-z]{4}/,
    drop: /^(?:home|about|contact|español|privacy|accessibility|skip to|search|all topics)/i,
    note: "The A–Z index. RULING 87-agencies: an agency that holds meetings is a governing body.",
  },
  {
    id: "usagov-state-new-jersey",
    publishedBy: "federal (USAGov)",
    aboutTier: "New Jersey state government",
    url: "https://www.usa.gov/states/new-jersey",
    control: "New Jersey",
    keep: /\b(?:department|division|office|governor|local|election|attorney|motor|emergency|health|education|corrections|agriculture|consumer)\b/i,
    note: "The federal page about one state — and the page that names the state's own local-government directory.",
  },
  {
    id: "usagov-state-arizona",
    publishedBy: "federal (USAGov)",
    aboutTier: "Arizona state government",
    url: "https://www.usa.gov/states/arizona",
    control: "Arizona",
    keep: /\b(?:department|division|office|governor|local|election|attorney|motor|emergency|health|education|corrections|agriculture|consumer)\b/i,
    note: "The same route for the next state in the zip order, walked before Arizona's hunt begins (RULING 86).",
  },
  {
    id: "nj-localgov",
    publishedBy: "State of New Jersey",
    aboutTier: "all 21 counties and all 564 municipalities",
    url: "https://www.nj.gov/nj/gov/county/localgov.shtml",
    control: "County and Municipal Web Sites",
    keep: /[A-Za-z]{3}/,
    drop: /^(?:home|about|contact|privacy|accessibility|skip|search|nj\.gov|services a to z|departments\/agencies|faqs?|feedback|translate|governor|open data|espa)/i,
    note:
      "THE ROUTE RULING 93 WAS ADOPTED OVER. The state's own directory of every " +
      "county and municipal website. The county's Cities-and-Towns page reached 30 of " +
      "Morris's 39 and missed Rockaway Township; this one page carries all 564.",
  },
];

/* ── Fetch and extract ──────────────────────────────────────────────────── */

interface Entity {
  name: string;
  url: string;
  /** Trailing disambiguation the directory itself provides — "(Morris County)". */
  qualifier: string | null;
}

interface RouteResult {
  route: TierRoute["id"];
  publishedBy: string;
  aboutTier: string;
  url: string;
  status: number;
  bytes: number;
  controlPassed: boolean;
  entities: Entity[];
  linksSeen: number;
  failure: string | null;
  walkedAt: string;
}

async function walkRoute(route: TierRoute): Promise<RouteResult> {
  const result: RouteResult = {
    route: route.id,
    publishedBy: route.publishedBy,
    aboutTier: route.aboutTier,
    url: route.url,
    status: 0,
    bytes: 0,
    controlPassed: false,
    entities: [],
    linksSeen: 0,
    failure: null,
    walkedAt: AS_OF,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let html = "";
  try {
    const res = await fetch(route.url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    result.status = res.status;
    html = await res.text();
    result.bytes = html.length;
  } catch (e) {
    result.failure = `unreachable at rung 2: ${(e as Error).message}. A WALL on ${route.url}, not an absence of a directory — the next rungs are the full browser header set, a different client, a different egress, and the live browser.`;
    return result;
  } finally {
    clearTimeout(timer);
  }

  if (result.status !== 200) {
    result.failure = `HTTP ${result.status}. A wall, not an empty directory.`;
    return result;
  }

  /*
   * A 200 whose content is not about the thing asked for is not a document.
   * NJ's own directory moved from `/nj/gov/county/` to
   * `/nj/gov/county/localgov.shtml`, and the old path answers 200 with a
   * styled "Page not found" — which a status check alone reads as success.
   */
  result.controlPassed = html.toLowerCase().includes(route.control.toLowerCase());
  if (!result.controlPassed) {
    result.failure =
      `HTTP 200 but the control string "${route.control}" is absent from ${result.bytes} bytes — ` +
      `this is not the document asked for. A guessed identifier yields a LEAD, never a HIT.`;
    return result;
  }

  const seen = new Map<string, Entity>();
  for (const m of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>([^<]{0,40})/gi,
  )) {
    result.linksSeen++;
    const name = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const trailing = decodeEntities(m[3] ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 80) continue;
    if (/^(?:mailto:|tel:|javascript:|#)/i.test(m[1])) continue;
    if (route.drop?.test(name)) continue;
    if (!route.keep.test(name)) continue;

    let url: string;
    try {
      url = new URL(m[1], route.url).toString();
    } catch {
      continue;
    }
    const qualifier = /^\(([^)]{2,40})\)/.exec(trailing)?.[1] ?? null;
    const dedupeKey = `${name}|${url}`;
    if (!seen.has(dedupeKey)) seen.set(dedupeKey, { name, url, qualifier });
  }
  result.entities = [...seen.values()];

  if (result.entities.length === 0) {
    result.failure =
      `the control string matched but ${result.linksSeen} links produced 0 entities. ` +
      `A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION — the page changed shape, and the ` +
      `keep/drop patterns for this route need re-reading against it.`;
  }
  return result;
}

/* ── Run ────────────────────────────────────────────────────────────────── */

if (process.argv.includes("--list")) {
  for (const r of TIER_ROUTES) console.log(`${r.id.padEnd(30)} ${r.publishedBy} → ${r.aboutTier}`);
  process.exit(0);
}

const only = arg("--route");
const routes = only === undefined ? TIER_ROUTES : TIER_ROUTES.filter((r) => r.id === only);
if (routes.length === 0) {
  console.error(`no such route. Known: ${TIER_ROUTES.map((r) => r.id).join(", ")}`);
  process.exit(2);
}

console.log(`RULING 93 — walking ${routes.length} tier-above directory route(s)`);

const results: RouteResult[] = [];
for (const route of routes) {
  const r = await walkRoute(route);
  results.push(r);
  console.log(
    r.failure === null
      ? `  ${r.route.padEnd(30)} ${String(r.entities.length).padStart(4)} entit(ies) from ${r.linksSeen} link(s)  [${r.publishedBy} → ${r.aboutTier}]`
      : `  ${r.route.padEnd(30)}    — ${r.failure.slice(0, 130)}`,
  );
  await sleep(SPACING_MS);
}

const totals = {
  routesWalked: results.length,
  routesAnswering: results.filter((r) => r.failure === null).length,
  routesFailed: results.filter((r) => r.failure !== null).length,
  entitiesFound: results.reduce((n, r) => n + r.entities.length, 0),
};

const outPath = join(ROOT, "data", "hunt", "tier-directories.json");
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      ruling: "RULING 93 — ask what the tier above publishes about the tier below",
      tier: "A",
      licence:
        "Every route is a .gov publication: US government work, public domain, no attribution " +
        "obligation and no terms to accept. usmayors.org is deliberately excluded — a nonprofit " +
        "directory is a discovery surface under RULING 70, never a source of record.",
      walkedAt: AS_OF,
      totals,
      routes: results,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `\n  routes ${totals.routesWalked} · answering ${totals.routesAnswering} · failed ${totals.routesFailed}\n` +
    `  entities named across all routes: ${totals.entitiesFound}\n` +
    `written ${outPath}`,
);
